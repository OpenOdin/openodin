import { strict as assert } from "assert";

import {
    StreamReaderInterface,
} from "../../../datastreamer";

import {
    P2PClient,
    ConnectionType,
} from "../../../p2pclient";

import {
    FetchResponse,
    Status,
} from "../../../types";

import {
    DATANODE_TYPE,
    DataInterface,
    NodeInterface,
    SignatureOffloaderInterface,
    CMP,
} from "../../../datamodel";

import {
    StorageUtil,
    CopyBuffer,
    ParseUtil,
} from "../../../util";

import {
    TransformerCache,
} from "../../../storage";

import {
    Service,
} from "../../Service";

import {
    HandshakeFactoryFactoryInterface,
} from "../../types";

import {
    AppLib,
} from "../../lib";

import {
    PocketConsoleType,
} from "pocket-console";

export class SimpleChat extends Service {
    protected lib?: AppLib;

    /** This value is extracted from the parsed conf file. */
    protected channelNodeId?: Buffer;

    protected cache?: TransformerCache;

    constructor(publicKey: Buffer, signatureOffloader: SignatureOffloaderInterface,
        handshakeFactoryFactory: HandshakeFactoryFactoryInterface, protected console?: PocketConsoleType) {

        super(publicKey, signatureOffloader, handshakeFactoryFactory);
    }

    public async init(config: any) {
        if (config) {
            const [stat, err] = await this.parseConfig(config);
            if (!stat) {
                throw new Error(err);
            }
        }

        // Copy the parentId set in the conf to be used as channel ID.
        const autoFetchers = this.getAutoFetch();
        if (autoFetchers.length > 0) {
            this.channelNodeId = CopyBuffer(autoFetchers[0].fetchRequest.query.parentId);
        }

        this.onConnectionConnect( (e) => {
            const pubKey = e.p2pClient.getRemotePublicKey();
            this.console?.aced(`Connected to peer who has publicKey ${pubKey.toString("hex")}`);

            // TODO
            // const clockSkew = e.p2pClient.calcClockSkew();
            const clockSkew = e.p2pClient.getLocalProps().clock - e.p2pClient.getRemoteProps().clock;
            this.console?.info(`Time diff to peer ${clockSkew} ms`);
        });

        this.onConnectionClose( (e) => {
            const pubKey = e.p2pClient.getRemotePublicKey();
            this.console?.info(`Connection disconnected, who has publicKey ${pubKey.toString("hex")}`);
        });

        this.onConnectionError( (e) => {
            this.console?.warn("Connection error", `${e.e.error}`);
        });

        this.onStorageConnect( (e) => {
            this.console?.aced("Connected to storage, setting up fetch");

            const storageClient = e.p2pClient;
            const publicKey = this.getPublicKey();
            const signerPublicKey = this.getSignerPublicKey();
            const nodeCerts = this.getNodeCerts();
            const appConfig = this.getAppConfig() ?? {};

            this.lib = new AppLib(storageClient, this.signatureOffloader, publicKey, signerPublicKey, appConfig, nodeCerts);

            this.cache = new TransformerCache();

            this.fetch(storageClient);

            this.triggerEvent("chatReady", this.cache);
        });

        this.onStorageClose( () => {
            this.console?.warn("Storage disconnected");

            delete this.cache;
            delete this.lib;
        });
    }

    public getLib(): AppLib | undefined {
        return this.lib;
    }

    protected fetch(storageClient: P2PClient, cursorId1?: Buffer) {
        const fetchRequest = StorageUtil.CreateFetchRequest({
            query: {
                parentId: this.channelNodeId,
                triggerNodeId: this.channelNodeId,
                discardRoot: true,
                match: [
                    {
                        nodeType: "00040001",
                        filters: [
                            {
                                field: "contentType",
                                cmp: CMP.EQ,
                                value: "app/chat/message"
                            }
                        ]
                    },
                    {
                        nodeType: "00040001",
                        filters: [
                            {
                                field: "contentType",
                                cmp: CMP.EQ,
                                value: "app/chat/attachment"
                            }
                        ]
                    }
                ],
                embed: [],
                cutoffTime: 0n,
            },
            transform: {
                algos: [2],
                cacheId: 1,
                tail: 30,
                includeDeleted: true,
            }
        });

        if (storageClient.getLocalProps().connectionType === ConnectionType.EXTENDER_CLIENT) {
            // Extender client, meaning we also want to trigger license extension,
            // hence we need to ask for licenses in the fetch request.
            const match = ParseUtil.ParseMatch([{
                nodeType: "00040002",
            }]);

            if (match.length > 0) {
                fetchRequest.query.match.push(match[0]);
            }

            fetchRequest.query.embed.push({
                nodeType: Buffer.from("00040002", "hex"),
                filters: [],
            });
        }

        if (cursorId1) {
            // If using a cursor we instead fetch from head to tail, starting from the cursor.
            fetchRequest.transform.cursorId1 = cursorId1;
            fetchRequest.transform.tail = 0;
            fetchRequest.transform.head = -1;
        }

        const {getResponse} = storageClient.fetch(fetchRequest, /*timeout=*/0);

        if (!getResponse) {
            throw new Error("unexpectedly missing getResponse");
        }

        getResponse.onTimeout( () => {
            // NOTE: if this happens then we should unsubscribe from the remote.
            this.console?.error("fetch timeouted");
        });

        getResponse.onClose( (hadError: boolean) => {
            this.cache?.close();
        });

        getResponse.onError( (error: string) => {
            this.console?.error("Error on socket:", error);
        });

        getResponse.onReply( (peer: P2PClient, fetchResponse: FetchResponse) => {
            if (fetchResponse.status === Status.TRY_AGAIN) {
                // We do this just in case, pending messages are auto-cancelled on seq==0.
                getResponse.cancel();

                // Transformer cache has been invalidated
                this.fetch(storageClient, this.cache?.getLast()?.node.getId1());
                return;
            }

            if (fetchResponse.status === Status.MISSING_CURSOR) {
                // We do this just in case, pending messages are auto-cancelled on seq==0.
                getResponse.cancel();

                this.console?.error("Expected cursor node not existing, will instead re-fetch.");
                this.fetch(storageClient);
                return;
            }
            else if (fetchResponse.status !== Status.RESULT) {
                this.console?.error(`Error code (${fetchResponse.status}) returned on fetch, error message: ${fetchResponse.error}`);
                return;
            }

            if (fetchResponse.transformResult.deletedNodesId1.length > 0) {
                this.cache?.delete(fetchResponse.transformResult.indexes);
            }

            const nodes = StorageUtil.ExtractFetchResponseNodes(fetchResponse);
            nodes.forEach( (node: NodeInterface, i) => {
                const id1 = node.getId1();
                if (!id1) {
                    return;
                }
                if (node.getType().equals(DATANODE_TYPE)) {
                    const dataNode = node as DataInterface;
                    const index = fetchResponse.transformResult.indexes[i];
                    if (index < 0) {
                        // These events are subscription events of new nodes merging with the model,
                        // and trigger either "add" or "insert" events.
                        this.cache?.merge(dataNode, index);
                    }
                    else {
                        if (getResponse.getBatchCount() === 1) {
                            // First result, just set the cache without triggering any events.
                            this.cache?.set(dataNode, index);
                        }
                        else {
                            // Subscription events updates existing nodes and triggers "update" events.
                            this.cache?.update(dataNode, index);
                        }
                    }
                }
            });
        });
    }

    public async sendChat(message: string) {
        if (!this.lib) {
            throw new Error("Not inited properly. lib missing.");
        }

        const refId = this.cache?.getLast()?.node.getId1();

        const dataNode = await this.lib.createDataNode({
            data: Buffer.from(message),
            parentId: this.channelNodeId,
            contentType: "app/chat/message",
            isLicensed: true,
            refId,
        });

        const nodeId1 = dataNode.getId1();

        assert(nodeId1);

        const licenseNodes = await this.lib.createLicenseNodes({
            nodeId1,
            parentId: this.channelNodeId,
        });

        await this.lib.storeNodes([dataNode, ...licenseNodes]);
    }

    public async sendAttachment(message: string, blobHash: Buffer, blobLength: bigint, streamReader: StreamReaderInterface) {
        if (!this.lib) {
            throw new Error("Not inited properly. lib missing.");
        }

        const refId = this.cache?.getLast()?.node.getId1();

        const dataNode = await this.lib.createDataNode({
            data: Buffer.from(message),
            parentId: this.channelNodeId,
            contentType: "app/chat/attachment",
            isLicensed: true,
            refId,
            blobHash,
            blobLength,
        });

        const nodeId1 = dataNode.getId1();

        assert(nodeId1);

        const licenseNodes = await this.lib.createLicenseNodes({
            nodeId1,
            parentId: this.channelNodeId,
        });

        await this.lib.storeNodes([dataNode, ...licenseNodes]);

        await this.lib.streamStoreBlob(nodeId1, streamReader);
    }

    public getAttachment(nodeId1: Buffer): [StreamReaderInterface | undefined, DataInterface | undefined] {
        if (!this.lib) {
            throw new Error("Not inited properly. lib missing.");
        }

        const node = this.cache?.find(nodeId1)?.node;

        if (!node) {
            return [undefined, undefined];
        }

        const streamReader = this.lib.getBlobStreamReader(nodeId1);

        return [streamReader, node as DataInterface];
    }

    public getCache(): TransformerCache | undefined {
        return this.cache;
    }

    public onChatReady(cb: (cache: TransformerCache) => void ) {
        this.hookEvent("chatReady", cb);
    }
}
