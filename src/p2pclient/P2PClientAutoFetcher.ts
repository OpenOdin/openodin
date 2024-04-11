import {
    EventType,
} from "pocket-messaging";

import {
    P2PClient,
} from "./P2PClient";

import {
    MAX_BATCH_SIZE,
} from "../storage/types";

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
    StreamStatus,
    StreamWriterInterface,
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

    /** Keep track of blobs being synced. */
    protected syncingBlobs: {[key: string]: {
        promise: Promise<boolean>,
        streamWriter: StreamWriterInterface,
    }};

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
    protected autoFetchSubscriptions: {autoFetch: AutoFetch, msgId: Buffer, targetPublicKey: Buffer}[];

    /**
     * If set then reverse serverClient and storageClient, and only match non reverse AutoFetch objects.
     * This makes the auto fetcher fetch from the storage and store to remote peer.
     */
    protected reverse: boolean;

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
        this.syncingBlobs = {};
        this.blobHandlers = [];

        this.serverClient.onClose( () => this.close() );
        this.storageClient.onClose( () => this.close() );
    }

    /**
     * Issue a fetch/subscription request to the server and put the result to the Storage.
     * If we requested transient values and they are returned they will be passed along to the storage.
     *
     * @param autoFetch
     * @return Buffer msgId or undefined on error or undefined when the autoFetch has already been added.
     */
    protected fetch(autoFetch: AutoFetch): Buffer | undefined {
        autoFetch = DeepCopy(autoFetch);

        const fetchRequest = autoFetch.fetchRequest;

        const targetPublicKey = this.reverse ?
            // If reverse then this is the publicKey of where we are storing to.
            this.storageClient.getRemotePublicKey() :
            // If not reverse we are the target of the fetch.
            this.serverClient.getLocalPublicKey();

        const sourcePublicKey = this.reverse ?
            // If reverse the source is our side.
            this.serverClient.getLocalPublicKey() :
            // If not reverse the source is the remote side.
            this.serverClient.getRemotePublicKey();

        fetchRequest.query.sourcePublicKey = sourcePublicKey;
        fetchRequest.query.targetPublicKey = targetPublicKey;

        if (this.autoFetchSubscriptions.findIndex( item => DeepEquals(item.autoFetch, autoFetch) ) > -1) {
            return undefined;
        }

        const {getResponse, msgId} = this.serverClient.fetch(fetchRequest);

        if (!getResponse) {
            console.debug("Got no getResponse on fetch, socket is likely closed or not connected.");
            return undefined;
        }

        getResponse.onTimeout( () => {
            // Unsubscribe from peer for this particular fetch.
            this.removeFetch(autoFetch);
        });

        // Does not have to be secure random number.
        //
        let batchId = Math.floor(Math.random() * 100_000_000);

        getResponse.onReply( (fetchResponse: FetchResponse) => {
            // Data is incoming from server peer, put it to storage.
            if (fetchResponse.status === Status.RESULT) {
                // If we requested transient values to be kept on the nodes when fetching from peer,
                // we try to preserve them into the Storage
                // (this requires that the Storage is OK with that).
                const preserveTransient = fetchRequest.query.preserveTransient;

                const isLast = fetchResponse.seq === fetchResponse.endSeq;

                this.processFetch(fetchResponse.result.nodes, autoFetch.blobSizeMaxLimit,
                    fetchRequest.query.preserveTransient, batchId, isLast);

                if (isLast) {
                    // Genereate a new batchId.
                    // Does not have to be secure random number.
                    //
                    batchId = Math.floor(Math.random() * 100_000_000);
                }
            }
            else if (fetchResponse.error) {
                console.debug("AutoFetcher got error on response:", fetchResponse.error);
                this.removeFetch(autoFetch);
            }
        });

        if (msgId) {
            const targetPublicKey = autoFetch.fetchRequest.query.targetPublicKey;

            this.autoFetchSubscriptions.push({autoFetch, msgId, targetPublicKey});

            const isSubscription = (fetchRequest.query.triggerNodeId.length > 0 ||
                fetchRequest.query.triggerInterval > 0) && fetchRequest.crdt.msgId.length === 0;

            if (isSubscription) {
                if (this.reverse) {
                    // This is so that other non reverse AutoFetchers do not trigger this subscription when storing.
                    this.muteMsgIds.push(msgId);
                }
                else {
                    // This is so that other reverse AutoFetchers do not trigger this subscription when storing.
                    this.reverseMuteMsgIds.push(msgId);
                }
            }
        }

        return msgId;
    }

    protected processFetch(images: Buffer[], blobSizeMaxLimit: number,
        preserveTransient: boolean, batchId: number, isLast: boolean)
    {
        // For all subscriptions the serverClient P2PClient has to the storage we mute those
        // subscriptions when storing data because the data comes from the serverClient and
        // there is no point echoing it back.
        //
        const imagesChunks = this.splitImages(images);

        const muteMsgIds = this.reverse ?
            // When fetching in reverse we do not want to trigger the reverseMuteMsgIds.
            this.reverseMuteMsgIds :
            // When fetching in normal we do not want to trigger the muteMsgIds.
            this.muteMsgIds;

        if (isLast && imagesChunks.length === 0) {
            // We need to send a final empty store request to finalize the batch.
            //
            const storeRequest: StoreRequest = {
                nodes: [],
                targetPublicKey: this.storageClient.getLocalPublicKey(),
                sourcePublicKey: this.serverClient.getRemotePublicKey(),
                muteMsgIds,
                preserveTransient,
                batchId,
                hasMore: false,
            };

            this.storageClient.store(storeRequest);

            return;
        }

        while (imagesChunks.length > 0) {
            const images = imagesChunks.shift();

            if (!images) {
                continue;
            }

            const hasMore = !isLast || imagesChunks.length > 0;

            const storeRequest: StoreRequest = {
                nodes: images,
                targetPublicKey: this.storageClient.getLocalPublicKey(),
                sourcePublicKey: this.serverClient.getRemotePublicKey(),
                muteMsgIds,
                preserveTransient,
                batchId,
                hasMore,
            };

            const {getResponse} = this.storageClient.store(storeRequest);

            if (!getResponse) {
                console.debug("Got no getResponse on store, socket is likely closed or not connected.");
                break;
            }

            getResponse.onceAny().then( anyData => {
                if (anyData.type !== EventType.REPLY || anyData.response?.status !== Status.RESULT) {
                    const reverse = this.reverse ? " (reverse store) " : "";

                    console.error(`Could not store the incoming fetched data to Storage${reverse}. Store response type: ${anyData.type}. Response status: ${anyData.response?.status}. Error: ${anyData.response?.error}`);
                    return;
                }

                // The IDs of stored nodes we can trust have now been cryptographically verified by the Storage.
                if (!anyData.response) {
                    return;
                }

                const len = anyData.response.missingBlobId1s.length;

                for (let i=0; i<len; i++) {
                    const id1: Buffer = anyData.response.missingBlobId1s[i];

                    const id1Str = id1.toString("hex");

                    const blobSize = anyData.response.missingBlobSizes[i];

                    if (!this.syncingBlobs[id1Str] && blobSize !== undefined) {
                        if (blobSizeMaxLimit < 0 ||
                            (blobSizeMaxLimit > 0 && blobSizeMaxLimit >= blobSize)) {

                            this.syncBlob(id1);
                        }
                    }
                }
            });
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
     * Attempt to sync a blob from the peer.
     *
     * @param nodeId1 the ID1 of the node who's blob we want to sync and save to the storage.
     * @param retry if true then retry forever
     * @returns Promise which resolves with boolean true when blob is stored to storage.
     */
    public syncBlob(nodeId1: Buffer, retry: boolean = true):
        {promise: Promise<boolean>, streamWriter: StreamWriterInterface} {

        const nodeId1Str = nodeId1.toString("hex");

        if (retry) {
            const ret = this.syncingBlobs[nodeId1Str];

            if (ret) {
                return ret;
            }
        }

        const muteMsgIds = this.reverse ?
            // When fetching in reverse we do not want to trigger the reverseMuteMsgIds.
            this.reverseMuteMsgIds :
            // When fetching in normal we do not want to trigger the muteMsgIds.
            this.muteMsgIds;

        const blobReader = new BlobStreamReader(nodeId1, [this.serverClient]);

        const streamWriter = new BlobStreamWriter(nodeId1, blobReader,
            this.storageClient, /*allowResume=*/true, muteMsgIds);

        const promise = new Promise<boolean>( (resolve) => {
            // -1 means retry forever.
            streamWriter.run(retry ? -1 : 0).then( writeData => {
                if (retry) {
                    delete this.syncingBlobs[nodeId1Str];
                }

                if (writeData.status === StreamStatus.RESULT) {
                    this.triggerBlobEvent({nodeId1});
                    resolve(true);
                }
                else {
                    resolve(false);
                }
            });
        });

        if (retry) {
            this.syncingBlobs[nodeId1Str] = {promise, streamWriter};
        }

        return {promise, streamWriter};
    }

    public getSyncingBlob(nodeId1: Buffer):
        {promise: Promise<boolean>, streamWriter: StreamWriterInterface} | undefined {

        const nodeId1Str = nodeId1.toString("hex");
        return this.syncingBlobs[nodeId1Str];
    }

    /**
     * This function provides a structured way of issuing fetch and subscription requests to the server client.
     * @param autoFetches array of AutoFetch objects to check if they trigger against the server, and if so issue
     * the fetch/subscription requests.
     */
    public addFetch(autoFetches: AutoFetch[]) {
        autoFetches.forEach( autoFetch => {
            if (autoFetch.reverse !== this.reverse) {
                return;
            }

            // Take into account if the clients are reversed.
            // We always want the auto fetch to filter on the actual remote client.
            const remotePublicKey = this.reverse ? this.storageClient.getRemotePublicKey() :
                this.serverClient.getRemotePublicKey();

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

                this.unsubscribe({originalMsgId: item.msgId, targetPublicKey: item.targetPublicKey});

                let index = this.reverseMuteMsgIds.findIndex( msgId2 => msgId2.equals(item.msgId) );

                if (index > -1) {
                    this.reverseMuteMsgIds.splice(index, 1);
                }

                index = this.muteMsgIds.findIndex( msgId2 => msgId2.equals(item.msgId) );

                if (index > -1) {
                    this.muteMsgIds.splice(index, 1);
                }

                break;
            }
        }
    }

    /**
     * Unsubscribe from all subscriptions and cancel any ongoing or pending blob syncings.
     */
    public close() {
        while (this.autoFetchSubscriptions.length > 0) {
            const item = this.autoFetchSubscriptions[0];
            this.removeFetch(item.autoFetch);
        }

        Object.keys(this.syncingBlobs).forEach( id1Str => {
            const ret = this.syncingBlobs[id1Str];

            ret?.streamWriter.close();

            delete this.syncingBlobs[id1Str];
        });
    }

    public isClosed(): boolean {
        return this.serverClient.isClosed() || this.storageClient.isClosed();
    }

    public isReverse(): boolean {
        return this.reverse;
    }

    /**
     * Event handler for blob events.
     * Blob successfully synced and stored,
     * blob failed in fetching, or
     * blob failed in storing.
     *
     * @param callback callback function
     */
    public onBlob(callback: BlobEventHandler) {
        this.blobHandlers.push(callback);
    }

    protected triggerBlobEvent(blobEvent: BlobEvent) {
        this.blobHandlers.forEach( blobHandler => {
            blobHandler(blobEvent, this);
        });
    }

    protected splitImages(images: Buffer[]): (Buffer[])[] {
        const chunks: (Buffer[])[] = [];
        while (images.length > 0) {
            let total = 0;
            const chunk: Buffer[] = [];
            while (images.length > 0 && total < MESSAGE_SPLIT_BYTES && chunk.length < MAX_BATCH_SIZE) {
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
