import {
    Decoder,
} from "../datamodel/decoder";

import {
    ParseUtil,
} from "./ParseUtil";

import {
    NodeInterface,
    DataInterface,
    Filter,
    CMP,
    DATA_NODE_TYPE,
} from "../datamodel";

import {
    StoreRequest,
    FetchRequest,
    FetchResponse,
    LimitField,
    WriteBlobRequest,
    ReadBlobRequest,
} from "../requestTypes";

import {
    P2PClient,
    AnyData,
} from "../p2pclient";

import {
    Status,
    EventType,
    ReadBlobResponse,
} from "../types";

import {
    StreamReaderInterface,
    StreamWriterInterface,
    BlobStreamReader,
    BlobStreamWriter,
} from "../datastreamer";

import {
    MAX_READBLOB_LENGTH,
} from "../storage/types";

export type FetchRequestQueryParams = {
    match?: {
        limitField?: LimitField,
        filters?: Filter[]
        nodeType?: Buffer | string,
        limit?: number,
        discard?: boolean,
        level?: number[],
        id?: number,
        requireId?: number,
        bottom?: boolean,
        path?: number,
        parentPath?: number,
        cursorId1?: Buffer | string,
    }[],
    depth?: number,
    limit?: number,
    cutoffTime?: bigint,
    rootNodeId1?: Buffer | string,
    parentId?: Buffer | string,
    triggerNodeId?: Buffer | string,
    triggerInterval?: number,
    onlyTrigger?: boolean,
    descending?: boolean,
    orderByStorageTime?: boolean,
    targetPublicKey?: Buffer | string,
    sourcePublicKey?: Buffer | string,
    discardRoot?: boolean,
    preserveTransient?: boolean,
    embed?: {nodeType: Buffer | string, filters: Filter[]}[],
    ignoreInactive?: boolean,
    ignoreOwn?: boolean,
    region?: string,
    jurisdiction?: string,
};

export type FetchRequestTransformParams = {
    algos: number[],
    reverse?: boolean,
    cursorId1?: Buffer | string,
    head?: number,
    tail?: number,
    msgId?: Buffer | string,
};

export type FetchRequestParams = {
    query: FetchRequestQueryParams,
    transform?: FetchRequestTransformParams,
};

export type StoreRequestParams = {
    nodes: Buffer[],
    targetPublicKey?: Buffer,
    sourcePublicKey?: Buffer,
    muteMsgIds?: Buffer[],
    preserveTransient?: boolean,
};

export type WriteBlobRequestParams = {
    sourcePublicKey?: Buffer,
    targetPublicKey?: Buffer,
    copyFromId1?: Buffer,
    nodeId1: Buffer,
    data: Buffer,
    pos?: bigint,
    muteMsgIds?: Buffer[],
};

export type ReadBlobRequestParams = {
    targetPublicKey?: Buffer,
    sourcePublicKey?: Buffer,
    nodeId1: Buffer,
    length: number,
    pos?: bigint,
};

export class StorageUtil {
    constructor(protected storageClient: P2PClient) {}

    /**
     * Helper function to store nodes to configured storage.
     *
     * @param nodes list of node objects to store.
     * @returns list of stored ID1s
     * @throws on error
     */
    public async storeNodes(nodes: NodeInterface[]): Promise<Buffer[]> {
        const storeRequest = StorageUtil.CreateStoreRequest({nodes: nodes.map( node => node.export() )});

        const {getResponse} = this.storageClient.store(storeRequest);

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
     * Helper function to create and store a blob using a StreamReader,
     *
     * The given streamReader is automatically closed when finished (also on error).
     *
     * This function runs in the background and it immediately returns the StreamWriter.
     *
     * @param nodeId1
     * @param streamReader a ready to go stream reader to read data from.
     * @return StreamWriterInterface
     */
    public streamStoreBlob(nodeId1: Buffer, streamReader: StreamReaderInterface): StreamWriterInterface {
        const streamWriter = new BlobStreamWriter(nodeId1, streamReader, this.storageClient);

        streamWriter.run().catch(e => {
            console.error(e);

            throw e;
        });

        return streamWriter;
    }

    /**
     * Helper function to get a StreamReader to stream a blob from storage.
     *
     * @param nodeId1
     * @returns streamReader
     * @throws on error
     */
    public getBlobStreamReader(nodeId1: Buffer): StreamReaderInterface {
        const streamReader = new BlobStreamReader(nodeId1, [this.storageClient]);
        return streamReader;
    }

    /**
     * Helper function to fetch a single data node. Permissions apply.
     *
     * @param nodeId1 the nodes id1.
     * @param parentId the nodes parentId.
     */
    public async fetchDataNode(nodeId1: Buffer, parentId: Buffer): Promise<DataInterface | undefined> {
        const fetchRequest = StorageUtil.CreateFetchRequest({
            query: {
                parentId,
                match: [
                    {
                        nodeType: DATA_NODE_TYPE,
                        filters: [
                            {
                                field: "id1",
                                cmp: CMP.EQ,
                                value: nodeId1,
                            }
                        ],
                    },
                ],
                limit: 1,
            },
        });

        const {getResponse} = this.storageClient.fetch(fetchRequest);

        if (!getResponse) {
            return undefined;
        }

        const anyDataPromise = getResponse.onceAny();

        const anyData = await anyDataPromise;

        if (anyData.type === EventType.REPLY) {
            const fetchResponse = anyData.response;

            if (fetchResponse && fetchResponse.status === Status.RESULT) {
                const nodes = StorageUtil.ExtractFetchResponseNodes(fetchResponse);
                if (nodes.length > 0) {
                    return nodes[0] as DataInterface;
                }
            }
        }

        return undefined;
    }

    /**
     * Helper function to create and store a small blob.
     * Maximum size allowed is 60 KiB, for larger blobs use the stream upload function.
     *
     * @param nodeId1
     * @param data the full data of the blob, maximum size allowed is 60 KiB.
     * @throws on error
     */
    public async storeBlob(nodeId1: Buffer, data: Buffer) {
        if (data.length > 1024 * 60) {
            throw new Error("Maximum blob size allowed is 60 KiB. For larger blobs use a stream uploader");
        }

        const writeBlobRequest = StorageUtil.CreateWriteBlobRequest({nodeId1, data});

        const {getResponse} = this.storageClient.writeBlob(writeBlobRequest);

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

        const {getResponse} = this.storageClient.readBlob(readBlobRequest);

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
     * Create a StoreRequest.
     * @param storeRequestParams nodes are required to be set
     * @returns StoreRequest
     */
    public static CreateStoreRequest(storeRequestParams: StoreRequestParams): StoreRequest {
        const storeRequest: StoreRequest = {
            nodes: storeRequestParams.nodes,
            targetPublicKey: storeRequestParams.targetPublicKey ?? Buffer.alloc(0),
            sourcePublicKey: storeRequestParams.sourcePublicKey ?? Buffer.alloc(0),
            muteMsgIds: storeRequestParams.muteMsgIds ?? [],
            preserveTransient: Boolean(storeRequestParams.preserveTransient),
        }

        return storeRequest;
    }

    /**
     * Create a WriteBlobRequest.
     * @param writeBlobRequestParams
     * @returns WriteBlobRequest
     */
    public static CreateWriteBlobRequest(writeBlobRequestParams: WriteBlobRequestParams): WriteBlobRequest {
        const writeBlobRequest: WriteBlobRequest = {
            sourcePublicKey: writeBlobRequestParams.sourcePublicKey ?? Buffer.alloc(0),
            targetPublicKey: writeBlobRequestParams.targetPublicKey ?? Buffer.alloc(0),
            copyFromId1: writeBlobRequestParams.copyFromId1 ?? Buffer.alloc(0),
            nodeId1: writeBlobRequestParams.nodeId1,
            data: writeBlobRequestParams.data,
            pos: writeBlobRequestParams.pos ?? 0n,
            muteMsgIds: writeBlobRequestParams.muteMsgIds ?? [],
        };

        return writeBlobRequest;
    }

    /**
     * Create a ReadBlobRequest.
     * @param readBlobRequestParams
     * @returns ReadBlobRequest
     */
    public static CreateReadBlobRequest(readBlobRequestParams: ReadBlobRequestParams): ReadBlobRequest {
        const readBlobRequest: ReadBlobRequest = {
            targetPublicKey: readBlobRequestParams.targetPublicKey ?? Buffer.alloc(0),
            sourcePublicKey: readBlobRequestParams.sourcePublicKey ?? Buffer.alloc(0),
            nodeId1: readBlobRequestParams.nodeId1,
            pos: readBlobRequestParams.pos ?? 0n,
            length: readBlobRequestParams.length,
        };

        return readBlobRequest;
    }

    /**
     * Create a FetchRequest.
     * @param fetchRequestParams
     * @returns FetchRequest
     */
    public static CreateFetchRequest(fetchRequestParams: FetchRequestParams): FetchRequest {
        const query = ParseUtil.ParseQuery(fetchRequestParams.query);
        const transform = ParseUtil.ParseTransform(fetchRequestParams.transform ?? {});
        const fetchRequest: FetchRequest = {
            query,
            transform,
        };

        return fetchRequest;
    }

    /**
     * Note that this function does not verify nodes decoded.
     * Any node which could not be decoded is not part of the result.
     * @param fetchResponse struct whos nodes we want to extract, decode and return.
     * @returns array of decoded nodes.
     */
    public static ExtractFetchResponseNodes(fetchResponse: FetchResponse, preserveTransient: boolean = false): NodeInterface[] {
        const nodes: NodeInterface[] = [];
        fetchResponse.result.nodes.forEach( image => {
            try {
                const node = Decoder.DecodeNode(image, preserveTransient);
                nodes.push(node);
            }
            catch(e) {
                // continue
            }
        });

        return nodes;
    }
}
