import {
    Service,
    ServiceConfig,
} from "../service/Service";

import {
    HandshakeFactoryFactoryInterface,
} from "../service/types";

import {
    AnyData,
} from "../p2pclient";

import {
    StorageUtil,
} from "../util/StorageUtil";

import {
    SignatureOffloader,
    DataInterface,
    Data,
    CMP,
    NodeInterface,
} from "../datamodel";

import {
    StreamReaderInterface,
    StreamWriterInterface,
    BlobStreamWriter,
    BlobStreamReader,
} from "../datastreamer";

import {
    Status,
    ReadBlobResponse,
    FetchRequest,
    FetchResponse,
} from "../types";

import {
    MAX_READBLOB_LENGTH,
} from "../storage/types";

import {
    EventType,
} from "pocket-messaging";

import {
    PocketConsole,
} from "pocket-console";

const console = PocketConsole({module: "App"});

export class App extends Service {
    protected appNodeId1: Buffer | undefined;

    constructor(publicKey: Buffer, signatureOffloader: SignatureOffloader, handshakeFactoryFactory: HandshakeFactoryFactoryInterface, config?: ServiceConfig, appNodeId1?: Buffer) {
        super(publicKey, signatureOffloader, handshakeFactoryFactory, config);
        this.appNodeId1 = appNodeId1;
    }

    /**
     * Helper function to store nodes to configured storage of underlaying Service.
     * @param nodes list of node objects to store.
     * @returns list of stored ID1s
     * @throws on error
     */
    public async storeNodes(nodes: NodeInterface[]): Promise<Buffer[]> {
        if (!this.isConnected()) {
            throw new Error("App not connected to storage, cannot store nodes");
        }

        const storeRequest = StorageUtil.CreateStoreRequest({nodes: nodes.map( node => node.export() )});

        const storageClient = this.getStorageClient();

        if (!storageClient) {
            throw new Error("Missing storage client");
        }

        const {getResponse} = storageClient.store(storeRequest);

        if (!getResponse) {
            throw new Error("Could not communicate as expected.");
        }

        const anyData = await getResponse.onceAny();

        if (anyData.type === EventType.REPLY) {
            const storeResponse = anyData.response;

            if (!storeResponse || storeResponse.status !== Status.RESULT) {
                throw new Error(`Could not store nodes: ${storeResponse?.error}`);
            }

            return storeResponse.storedId1s;
        }
        else {
            throw new Error(`Could not store nodes: ${anyData.error}`);
        }
    }

    /**
     * Helper function to create and store a blob.
     * Maximum size allowed is 60 KiB, for larger blobs use the stream upload function.
     *
     * @param nodeId1
     * @param data the full data of the blob, maximum size allowed is 60 KiB.
     * @throws on error
     */
    public async storeBlob(nodeId1: Buffer, data: Buffer) {
        if (!this.isConnected()) {
            throw new Error("App not connected to storage, cannot store blob");
        }

        if (data.length > 1024 * 60) {
            throw new Error("Maximum blob size allowed is 60 KiB. For larger blobs use the stream uploder");
        }

        const writeBlobRequest = StorageUtil.CreateWriteBlobRequest({nodeId1, data});

        const storageClient = this.getStorageClient();

        if (!storageClient) {
            throw new Error("Missing storage client");
        }

        const {getResponse} = storageClient.writeBlob(writeBlobRequest);

        if (!getResponse) {
            throw new Error("Could not communicate as expected.");
        }

        const anyData = await getResponse.onceAny();

        if (anyData.type === EventType.REPLY) {
            const writeBlobResponse = anyData.response;

            if (!writeBlobResponse || writeBlobResponse.status !== Status.EXISTS) {
                throw new Error(`Could not store blob: ${writeBlobResponse?.error}`);
            }
        }
        else {
            throw new Error(`Could not store blob: ${anyData.error}`);
        }
    }

    /**
     * Read blob contents, maximum MAX_READBLOB_LENGTH (1 MiB) at a time.
     */
    public readBlob(nodeId1: Buffer, length?: number, pos?: bigint): Promise<Buffer> {
        if (!this.isConnected()) {
            throw new Error("App not connected to storage, cannot read blob");
        }

        length = length ?? MAX_READBLOB_LENGTH;

        if (length > MAX_READBLOB_LENGTH) {
            throw new Error(`Maximum blob read length is ${MAX_READBLOB_LENGTH}. For larger requests call readBlob multiple times or use the streamBlob function.`);
        }

        pos = pos ?? 0n;

        const readBlobRequest = StorageUtil.CreateReadBlobRequest({
            nodeId1,
            length,
            pos,
        });

        const storageClient = this.getStorageClient();

        if (!storageClient) {
            throw new Error("Missing storage client");
        }

        const {getResponse} = storageClient.readBlob(readBlobRequest);

        if (!getResponse) {
            throw new Error("Could not communicate as expected.");
        }

        return new Promise( (resolve, reject) => {
            const buffers: Buffer[] = [];

            getResponse.onAny( (anyData: AnyData<ReadBlobResponse>) => {
                if (anyData.type === EventType.REPLY) {
                    const readBlobResponse = anyData.response;

                    if (readBlobResponse?.status === Status.RESULT) {
                        buffers.push(readBlobResponse.data);

                        if (readBlobResponse.seq === readBlobResponse.endSeq) {
                            resolve(Buffer.concat(buffers));
                        }

                        return;
                    }
                }

                console.debug("Unexpected reply in readBlob()", anyData);

                reject("Unexpected reply in readblob()");
            });
        });
    }

    /**
     * Helper function to create and store a blob using a StreamReader,
     *
     * The given streamReader is automatically closed when finished (also on error).
     *
     * @param nodeId1
     * @param streamReader a ready to go stream reader to read data from.
     * @throws on error
     */
    public async streamStoreBlob(nodeId1: Buffer, streamReader: StreamReaderInterface) {
        if (!this.isConnected()) {
            throw new Error("App not connected to storage, cannot stream store blob");
        }

        const storageClient = this.getStorageClient();

        if (!storageClient) {
            throw new Error("Missing storage client");
        }

        const streamWriter = new BlobStreamWriter(nodeId1, streamReader, storageClient);

        try {
            await streamWriter.run();
        }
        catch(e) {
            console.error(e);
            throw e;
        }
        finally {
            streamWriter.close();
            streamReader.close();
        }
    }

    /**
     * Helper function to stream a blob from storage.
     *
     * @param nodeId1
     * @returns streamReader
     * @throws on error
     */
    public getBlobStreamReader(nodeId1: Buffer): StreamReaderInterface {
        if (!this.isConnected()) {
            throw new Error("App not connected to storage, cannot stream read blob");
        }

        const storageClient = this.getStorageClient();

        if (!storageClient) {
            throw new Error("Missing storage client");
        }

        const streamReader = new BlobStreamReader(nodeId1, [storageClient]);

        return streamReader;
    }

    /**
     * Helper function to fetch and decode nodes and pass them to a callback function.
     * @param fetchRequest
     * @param callback
     * @param errorCallback optional
     */
    public fetchNodes(fetchRequest: FetchRequest, callback: (nodes: NodeInterface[]) => void, errorCallback?: (anyData: AnyData<FetchResponse>) => void) {
        // TODO: how to handle unsubscribe?
        if (!this.isConnected()) {
            throw new Error("App not connected to storage, cannot fetch nodes");
        }

        const storageClient = this.getStorageClient();

        if (!storageClient) {
            throw new Error("Missing storage client");
        }

        const {getResponse} = storageClient.fetch(fetchRequest);

        if (!getResponse) {
            throw new Error("Could not communicate as expected.");
        }

        return new Promise( (resolve, reject) => {
            getResponse.onAny( (anyData: AnyData<FetchResponse>) => {
                if (anyData.type === EventType.REPLY) {
                    const fetchResponse = anyData.response;

                    if (fetchResponse?.status === Status.RESULT) {
                        const nodes = StorageUtil.ExtractFetchResponseNodes(fetchResponse);
                        callback(nodes);
                        return;
                    }
                }

                console.debug("Unexpected reply in fetchNodes()", anyData);

                if (errorCallback) {
                    errorCallback(anyData);
                }
            });
        });
    }

    public setAppNodeId(appNodeId1: Buffer | undefined) {
        this.appNodeId1 = appNodeId1;
    }

    /**
     * Run a discovery of app-func-nodes below the root node.
     * @param parentId Optionally set from where below to start the discovery.
     * Default is the appNodeId1 passed into the constructor used as rootNodeId1.
     * A parentId is is required to be set if the app is not configured for an app root node.
     */
    public async discover(parentId?: Buffer): Promise<DataInterface[]> {
        const nodes: DataInterface[] = [];

        const fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            rootNodeId1: parentId ? undefined : this.appNodeId1,
            depth: 2,
            cutoffTime: 0n,
            preserveTransient: false,
            discardRoot: true,
            descending: true,

            match: [
                {
                    nodeType: Data.GetType(),
                    filters: [
                        {
                            field: "contentType",
                            operator: ":0,4",
                            cmp: CMP.EQ,
                            value: "app/",
                        },
                        {
                            field: "contentType",
                            cmp: CMP.NE,
                            value: "app/profiles",
                        },
                    ],
                    level: [1],
                },
                {
                    nodeType: Data.GetType(),
                    filters: [
                        {
                            field: "contentType",
                            cmp: CMP.EQ,
                            value: "app/profiles",
                        },
                    ],
                    limit: 1,
                    level: [1],
                },
                {
                    nodeType: Data.GetType(),
                    filters: [
                        {
                            field: "contentType",
                            operator: ":0,4",
                            cmp: CMP.NE,
                            value: "app/",
                        },
                    ],
                    level: [1],
                    path: 1,
                },
                {
                    nodeType: Data.GetType(),
                    filters: [
                        {
                            field: "contentType",
                            operator: ":0,4",
                            cmp: CMP.EQ,
                            value: "app/",
                        },
                    ],
                    level: [2],
                    parentPath: 1,
                },
            ]
        }});

        const storageClient = this.getStorageClient();
        if (!storageClient) {
            throw new Error("Expecting storage client existing.");
        }

        const {getResponse} = storageClient.fetch(fetchRequest);
        if (!getResponse) {
            throw new Error("Could not query for discovery.");
        }
        const anyDataPromise = getResponse.onceAny();

        const anyData = await anyDataPromise;

        if (anyData.type === EventType.REPLY) {
            const fetchResponse = anyData.response;
            if (fetchResponse && fetchResponse.status === Status.RESULT) {
                nodes.push(...StorageUtil.ExtractFetchResponseNodes(fetchResponse) as DataInterface[]);
            }
        }
        else {
            throw new Error("Unexpected reply in discovery");
        }

        return nodes;
    }
}
