import {
    EventType,
} from "pocket-messaging";

import {
    P2PClient,
} from "./P2PClient";

import {
    Decoder,
} from "../datamodel";

import {
    FetchResponse,
    StoreRequest,
    UnsubscribeRequest,
    MESSAGE_SPLIT_BYTES,
    Status,
} from "../types";

import {
    AutoFetch,
    BlobEvent,
} from "./types";

import {
    BlobStreamWriter,
    BlobStreamReader,
} from "../datastreamer";

import {
    DeepEquals,
    DeepCopy,
} from "../util/common";

import {
    PocketConsole,
} from "pocket-console";

const console = PocketConsole({module: "P2PClientAutoFetcher"});

export type BlobEventHandler = (blobEvent: BlobEvent, autoFetcher: P2PClientAutoFetcher) => void;

export class P2PClientAutoFetcher {
    protected serverClient: P2PClient;
    protected storageClient: P2PClient;

    protected blobHandlers: BlobEventHandler[];

    /** Keep track of blobs being downloaded. */
    protected downloadingBlobs: {[key: string]: Promise<void>};

    /**
     * A given list of message IDs which we will mute when storing.
     * This list is populated by a P2PClientForwarder/Extender which shares the underlaying P2PClient
     * with this P2PClientAutoFetcher and might have active subscriptions we do not want to trigger.
     */
    protected muteMsgIds: Buffer[];

    /**
     * A given list of message IDs which we will mute when storing in reverse mode,
     * and adding to in normal mode.
     */
    protected reverseMuteMsgIds: Buffer[];

    /**
     * Keep track of subscriptions initiated by AutoFetches,
     * so we can unsubscribe from them when removing an AutoFetch object.
     */
    protected autoFetchSubscriptions: {autoFetch: AutoFetch, msgId: Buffer, clientPublicKey: Buffer}[];

    /**
     * If set then reverse serverClient and storageClient, and only match non reverse AutoFetch objects.
     * This makes the auto fetcher fetch from local storage and store to remote storage.
     */
    protected reverse: boolean;

    protected queuedImageChunks: (Buffer[])[];

    protected busyProcessing: boolean;

    /**
     * @param serverClient the client to fetch on (or store to if reverse).
     * @param storageClient the client to store to (or fetch from if reverse).
     */
    constructor(serverClient: P2PClient, storageClient: P2PClient, muteMsgIds?: Buffer[], reverseMuteMsgIds?: Buffer[], reverse: boolean = false) {
        this.serverClient = reverse ? storageClient : serverClient;
        this.storageClient = reverse ? serverClient : storageClient;
        this.muteMsgIds = muteMsgIds ?? [];
        this.reverseMuteMsgIds = reverseMuteMsgIds ?? [];
        this.reverse = reverse;
        this.autoFetchSubscriptions = [];
        this.downloadingBlobs = {};
        this.queuedImageChunks = [];
        this.busyProcessing = false;
        this.blobHandlers = [];
    }

    /**
     * Issue a fetch/subscription request to the server and put the result to the Storage.
     * If we requested transient values and they are returned they will be passed along to the storage.
     *
     * @param autoFetch
     * @return Buffer msgId or undefined on error
     */
    protected fetch(autoFetch: AutoFetch): Buffer | undefined {
        if (this.autoFetchSubscriptions.findIndex( item => DeepEquals(item.autoFetch, autoFetch) ) > -1) {
            return undefined;
        }

        const fetchRequest = DeepCopy(autoFetch.fetchRequest);
        fetchRequest.query.clientPublicKey = this.serverClient.getLocalPublicKey() ?? Buffer.alloc(0);
        fetchRequest.query.targetPublicKey = this.storageClient.getRemotePublicKey() ?? Buffer.alloc(0);

        const {getResponse, msgId} = this.serverClient.fetch(fetchRequest);

        if (!getResponse) {
            console.debug("Got no getResponse on fetch, socket is likely closed or not connected.");
            return undefined;
        }

        getResponse.onTimeout( () => {
            // Unsubscribe from peer for this particular fetch.
            this.removeFetch(autoFetch);
        });

        getResponse.onReply( async (peer: P2PClient, fetchResponse: FetchResponse) => {
            // Transformer cache was invalidated in Storage.
            // Fetch again.
            if (fetchResponse.status === Status.TRY_AGAIN) {
                this.removeFetch(autoFetch);
                this.fetch(autoFetch);
                return;
            }

            // Data is incoming from server peer, put it to storage.
            if (fetchResponse.status === Status.RESULT) {
                // If we requested transient values to be kept on the nodes when fetching from peer,
                // we try to preserve them into the Storage (this requires that the Storage is OK with that).
                this.processFetch(fetchResponse.result.nodes, autoFetch.downloadBlobs, fetchRequest.query.preserveTransient);
            }
        });

        if (msgId) {
            const clientPublicKey = autoFetch.fetchRequest.query.clientPublicKey;
            this.autoFetchSubscriptions.push({autoFetch, msgId, clientPublicKey});

            const isSubscription = fetchRequest.query.triggerNodeId.length > 0 || fetchRequest.query.triggerInterval > 0;

            if (isSubscription) {
                if (this.reverse) {
                    this.muteMsgIds.push(msgId);
                }
                else {
                    this.reverseMuteMsgIds.push(msgId);
                }
            }
        }

        return msgId;
    }

    protected async processFetch(images: Buffer[], syncBlobs: boolean, preserveTransient: boolean) {
        // For all subscriptions the serverClient P2PClient has to the storage we mute those subscriptions
        // when storing data because the data comes from the serverClient and there is no point echoing it back.
        const imagesChunks = this.splitImages(images);
        this.queuedImageChunks.push(...imagesChunks);

        if (this.busyProcessing) {
            return;
        }

        this.busyProcessing = true;

        const storedId1s: Buffer[] = [];  // id1 of all nodes which just got stored.
        const missingBlobId1s: {[id1: string]: Buffer} = {};

        while (this.queuedImageChunks.length > 0) {
            const images = this.queuedImageChunks.shift();

            if (!images) {
                continue;
            }

            const storeRequest: StoreRequest = {
                nodes: images,
                clientPublicKey: this.storageClient.getLocalPublicKey() ?? Buffer.alloc(0),
                targetPublicKey: this.storageClient.getLocalPublicKey() ?? Buffer.alloc(0),
                sourcePublicKey: this.serverClient.getRemotePublicKey() ?? Buffer.alloc(0),
                muteMsgIds: this.reverse ? this.reverseMuteMsgIds : this.muteMsgIds,
                preserveTransient,
            };

            const {getResponse} = this.storageClient.store(storeRequest);

            if (!getResponse) {
                break;
            }

            const anyData = await getResponse.onceAny();

            if (anyData.type !== EventType.REPLY || anyData.response?.status !== Status.RESULT) {
                console.error(`Could not store the incoming fetched data to Storage. Store response type: ${anyData.type}. Response status: ${anyData.response?.status}. Error: ${anyData.response?.error}`);
                // Abort the storage operation.
                break;
            }

            // The IDs of stored nodes we can trust have now been cryptographically verified by the Storage.
            storedId1s.push(...anyData.response.storedId1s);

            const l = anyData.response.missingBlobId1s.length;
            for (let i=0; i<l; i++) {
                const id1: Buffer = anyData.response.missingBlobId1s[i];
                const id1Str = id1.toString("hex");
                if (!this.downloadingBlobs[id1Str]) {
                    missingBlobId1s[id1Str] = id1;
                }
            }
        }

        // We reset this in the case the iteration was breaked.
        this.queuedImageChunks.length = 0;
        this.busyProcessing = false;

        // When getting nodes from the peer we can also download blob data, if any.
        if (syncBlobs) {
            this.downloadBlobs(Object.values(missingBlobId1s));
        }
    }

    /**
     * Unsubscribe from server client on prior fetch.
     * @param msgId message Id as returned from the fetch() function.
     */
    protected unsubscribe(unsubscribeRequest: UnsubscribeRequest) {
        this.serverClient.unsubscribe(unsubscribeRequest);
    }

    /**
     * Download blobs from serverClient.
     */
    protected async downloadBlobs(nodeId1s: Buffer[]) {
        for (let i=0; i<nodeId1s.length; i++) {
            const nodeId1 = nodeId1s[i];
            if (!nodeId1) {
                continue;
            }

            try {
                await this.downloadBlob(nodeId1);
                this.emitBlobEvent({nodeId1});
            }
            catch(blobEvent) {
                // NOTE: this is not beyond beautiful since we are parsing the error string,
                // we should add an error code.
                if ((blobEvent as any).error?.message?.indexOf("finalized") > -1) {
                    console.debug("Could not read blob:", blobEvent);
                }
                else {
                    console.error("Could not download/write blob:", blobEvent);
                }
                this.emitBlobEvent(blobEvent as any as BlobEvent);
            }
        }
    }

    /**
     * @param nodeId1 the ID1 of the node who's blob we want to download and save to the storage.
     * @returns Promise which resolves on success when blob is stored to storage.
     */
    protected downloadBlob(nodeId1: Buffer): Promise<void> {
        const nodeId1Str = nodeId1.toString("hex");
        let promise = this.downloadingBlobs[nodeId1Str];
        if (promise) {
            return promise;
        }

        promise = new Promise<void>( (resolve, reject) => {
            try {
                const blobReader = new BlobStreamReader(nodeId1, [this.serverClient]);
                const blobWriter = new BlobStreamWriter(nodeId1, blobReader, this.storageClient, /*allowResume=*/true, this.muteMsgIds);

                blobWriter.run().then( () => {
                    delete this.downloadingBlobs[nodeId1Str];
                    resolve();
                }).catch( (error) => {
                    delete this.downloadingBlobs[nodeId1Str];
                    reject({nodeId1, error});
                });
            }
            catch(e) {
                reject({nodeId1, error: {message: `${e}`}});
            }
            finally {
                delete this.downloadingBlobs[nodeId1Str];
            }
        });

        this.downloadingBlobs[nodeId1Str] = promise;

        return promise;
    }

    /**
     * This function provides a structured way of issuing fetch and subscription requests to the server client.
     * @param autoFetches array of AutoFetch objects to check if they trigger against the server, and if so issue the fetch/subscription requests.
     */
    public addFetch(autoFetches: AutoFetch[]) {
        autoFetches.forEach( autoFetch => {
            if (autoFetch.reverse !== this.reverse) {
                return;
            }

            // Take into account if the clients are reversed.
            // We always want the auto fetch to filter on the actual remote client.
            const remotePublicKey = this.reverse ? this.storageClient.getRemotePublicKey() : this.serverClient.getRemotePublicKey();

            if (autoFetch.remotePublicKey.length === 0 || remotePublicKey?.equals(autoFetch.remotePublicKey)) {
                this.fetch(autoFetch);
            }
        });
    }

    public removeFetch(autoFetch: AutoFetch) {
        for (let i=0; i<this.autoFetchSubscriptions.length; i++) {
            const item = this.autoFetchSubscriptions[i];
            if (DeepEquals(item.autoFetch, autoFetch)) {
                this.autoFetchSubscriptions.splice(i, 1);
                this.unsubscribe({originalMsgId: item.msgId, clientPublicKey: item.clientPublicKey});
                const index = this.reverseMuteMsgIds.findIndex( msgId2 => msgId2.equals(item.msgId) );
                if (index > -1) {
                    this.reverseMuteMsgIds.splice(index, 1);
                }
                break;
            }
        }
    }

    /**
     * Unsubscribe from all subscriptions.
     * Note that any downloading blobs will not be cancelled, unless the socket it self is closed.
     */
    public close() {
        while (this.autoFetchSubscriptions.length > 0) {
            const item = this.autoFetchSubscriptions[0];
            this.removeFetch(item.autoFetch);
        }
    }

    public isClosed(): boolean {
        return this.serverClient.isClosed() || this.storageClient.isClosed();
    }

    /**
     * Event handler for blob events.
     * Blob successfully downloaded and stored,
     * blob failed in fetching, or
     * blob failed in storing.
     *
     * @param callback callback function
     */
    public onBlob(callback: BlobEventHandler) {
        this.blobHandlers.push(callback);
    }

    protected emitBlobEvent(blobEvent: BlobEvent) {
        this.blobHandlers.forEach( blobHandler => {
            blobHandler(blobEvent, this);
        });
    }

    protected splitImages(images: Buffer[]): (Buffer[])[] {
        const chunks: (Buffer[])[] = [];
        while (images.length > 0) {
            let total = 0;
            const chunk: Buffer[] = [];
            while (images.length > 0 && total < MESSAGE_SPLIT_BYTES) {
                const image = images[0];
                if (total + image.length > MESSAGE_SPLIT_BYTES) {
                    break;
                }
                total = total + image.length;
                images.shift();
                chunk.push(image);
            }
            chunks.push(chunk);
        }

        return chunks;
    }
}
