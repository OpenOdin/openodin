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
