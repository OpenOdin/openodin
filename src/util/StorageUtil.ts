import {
    Decoder,
} from "../datamodel/decoder";

import {
    ParseUtil,
} from "./ParseUtil";

import {
    NodeInterface,
    Filter,
} from "../datamodel";

import {
    StoreRequest,
    FetchRequest,
    FetchResponse,
    LimitField,
    WriteBlobRequest,
    ReadBlobRequest,
} from "../requestTypes";

export type FetchRequestQueryParams = {
    match?: {
        limitField?: LimitField,
        filters?: Filter[]
        nodeType?: string | Buffer,
        limit?: number,
        discard?: boolean,
        level?: number[],
        id?: number,
        requireId?: number,
        bottom?: boolean,
        path?: number,
        parentPath?: number,
        cursorId1?: Buffer,
    }[],
    depth?: number,
    limit?: number,
    cutoffTime?: bigint,
    rootNodeId1?: Buffer,
    parentId?: Buffer,
    triggerNodeId?: Buffer,
    triggerInterval?: number,
    onlyTrigger?: boolean,
    descending?: boolean,
    orderByStorageTime?: boolean,
    targetPublicKey?: Buffer,
    clientPublicKey?: Buffer,
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
    cursorId1?: Buffer,
    head?: number,
    tail?: number,
    cacheId?: number,
    cachedTriggerNodeId?: Buffer,
    includeDeleted?: boolean,
};

export type FetchRequestParams = {
    query: FetchRequestQueryParams,
    transform?: FetchRequestTransformParams,
};

export type StoreRequestParams = {
    nodes: Buffer[],
    clientPublicKey?: Buffer,
    targetPublicKey?: Buffer,
    sourcePublicKey?: Buffer,
    muteMsgIds?: Buffer[],
    preserveTransient?: boolean,
};

export type WriteBlobRequestParams = {
    clientPublicKey?: Buffer,
    copyFromId1?: Buffer,
    nodeId1: Buffer,
    data: Buffer,
    pos?: bigint,
    muteMsgIds?: Buffer[],
};

export type ReadBlobRequestParams = {
    clientPublicKey?: Buffer,
    targetPublicKey?: Buffer,
    nodeId1: Buffer,
    length: number,
    pos?: bigint,
};

export class StorageUtil {

    /**
     * Create a StoreRequest.
     * @param storeRequestParams nodes are required to be set
     * @returns StoreRequest
     */
    public static CreateStoreRequest(storeRequestParams: StoreRequestParams): StoreRequest {
        const storeRequest: StoreRequest = {
            nodes: storeRequestParams.nodes,
            clientPublicKey: storeRequestParams.clientPublicKey ?? Buffer.alloc(0),
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
            clientPublicKey: writeBlobRequestParams.clientPublicKey ?? Buffer.alloc(0),
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
            clientPublicKey: readBlobRequestParams.clientPublicKey ?? Buffer.alloc(0),
            targetPublicKey: readBlobRequestParams.targetPublicKey ?? Buffer.alloc(0),
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
