import {
    BopFetchRequest,
    BopStoreRequest,
    BopUnsubscribeRequest,
    BopWriteBlobRequest,
    BopReadBlobRequest,
    BopGenericMessageRequest,
    BopStoreResponse,
    BopFetchResponse,
    BopUnsubscribeResponse,
    BopWriteBlobResponse,
    BopReadBlobResponse,
    BopGenericMessageResponse,
} from "./bebop";

import {
    FetchRequest,
    StoreRequest,
    UnsubscribeRequest,
    WriteBlobRequest,
    ReadBlobRequest,
    GenericMessageRequest,
    WriteBlobResponse,
    ReadBlobResponse,
    StoreResponse,
    FetchResponse,
    UnsubscribeResponse,
    GenericMessageResponse,
    Status,
} from "../../types";

import {
    UnpackFilters,
    MakeIntoBuffer,
} from "./util";


/**
 * Class of functions used to deserialize buffers into request objects from Bebop.
 *
 */
export class BebopDeserialize {
    /**
     * @throws on error
     */
    public FetchRequest(data: Buffer): FetchRequest {
        const obj = BopFetchRequest.decode(data);
        if (!obj || !obj.query || !obj.crdt) {
            throw new Error("Could not deserialize FetchRequest");
        }
        obj.crdt.cursorId1 = MakeIntoBuffer(obj.crdt.cursorId1);
        obj.crdt.msgId = MakeIntoBuffer(obj.crdt.msgId);
        obj.query.rootNodeId1 = MakeIntoBuffer(obj.query.rootNodeId1);
        obj.query.parentId = MakeIntoBuffer(obj.query.parentId);
        obj.query.targetPublicKey = MakeIntoBuffer(obj.query.targetPublicKey);
        obj.query.sourcePublicKey = MakeIntoBuffer(obj.query.sourcePublicKey);
        obj.query.triggerNodeId = MakeIntoBuffer(obj.query.triggerNodeId);
        obj.query.match = obj.query.match.map( match => {
            return {
                ...match,
                nodeType: MakeIntoBuffer(match.nodeType),
                filters: UnpackFilters(match.filters),
                cursorId1: MakeIntoBuffer(match.cursorId1),
            };
        });
        obj.query.embed = obj.query.embed.map( embed => {
            return {
                ...embed,
                nodeType: MakeIntoBuffer(embed.nodeType),
                filters: UnpackFilters(embed.filters),
            };
        });
        return (obj as unknown) as FetchRequest;
    }

    /**
     * @throws on error
     */
    public FetchResponse(data: Buffer): FetchResponse {
        const obj = BopFetchResponse.decode(data);
        if (!obj || !obj.result || !obj.crdtResult) {
            throw new Error("Could not deserialize FetchResponse");
        }
        obj.result.nodes = (obj.result.nodes || []).map( MakeIntoBuffer );
        obj.result.embed = (obj.result.embed || []).map( MakeIntoBuffer );
        obj.crdtResult.delta = MakeIntoBuffer(obj.crdtResult.delta);
        return (obj as unknown) as FetchResponse;
    }

    /**
     * @throws on error
     */
    public StoreRequest(data: Buffer): StoreRequest {
        const obj = BopStoreRequest.decode(data);
        obj.nodes = (obj.nodes || []).map( MakeIntoBuffer );
        obj.sourcePublicKey = MakeIntoBuffer(obj.sourcePublicKey);
        obj.targetPublicKey = MakeIntoBuffer(obj.targetPublicKey);
        obj.muteMsgIds = (obj.muteMsgIds || []).map( MakeIntoBuffer );
        return obj as unknown as StoreRequest;
    }

    /**
     * @throws on error
     */
    public StoreResponse(data: Buffer): StoreResponse {
        const obj = BopStoreResponse.decode(data);

        const storeResponse: StoreResponse = {
            error: obj.error as string,
            status: obj.status as Status,
            storedId1s: (obj.storedId1S || []).map( MakeIntoBuffer ),
            missingBlobId1s: (obj.missingBlobId1S || []).map( MakeIntoBuffer ),
            missingBlobSizes: obj.missingBlobSizes ?? [],
        };

        return storeResponse;
    }

    /**
     * @throws on error
     */
    public UnsubscribeRequest(data: Buffer): UnsubscribeRequest {
        const obj = BopUnsubscribeRequest.decode(data);
        obj.originalMsgId = MakeIntoBuffer(obj.originalMsgId);
        obj.targetPublicKey = MakeIntoBuffer(obj.targetPublicKey);
        return obj as unknown as UnsubscribeRequest;
    }

    /**
     * @throws on error
     */
    public UnsubscribeResponse(data: Buffer): UnsubscribeResponse {
        const obj = BopUnsubscribeResponse.decode(data);
        return obj as unknown as UnsubscribeResponse;
    }

    /**
     * @throws on error
     */
    public WriteBlobRequest(data: Buffer): WriteBlobRequest {
        const obj = BopWriteBlobRequest.decode(data);
        obj.nodeId1 = MakeIntoBuffer(obj.nodeId1);
        obj.data = MakeIntoBuffer(obj.data);
        obj.sourcePublicKey = MakeIntoBuffer(obj.sourcePublicKey);
        obj.targetPublicKey = MakeIntoBuffer(obj.targetPublicKey);
        obj.copyFromId1 = MakeIntoBuffer(obj.copyFromId1);
        obj.muteMsgIds = (obj.muteMsgIds || []).map( MakeIntoBuffer );
        return obj as unknown as WriteBlobRequest;
    }

    /**
     * @throws on error
     */
    public WriteBlobResponse(data: Buffer): WriteBlobResponse {
        const obj = BopWriteBlobResponse.decode(data);
        return obj as unknown as WriteBlobResponse;
    }

    /**
     * @throws on error
     */
    public ReadBlobRequest(data: Buffer): ReadBlobRequest {
        const obj = BopReadBlobRequest.decode(data);
        obj.nodeId1 = MakeIntoBuffer(obj.nodeId1);
        obj.targetPublicKey = MakeIntoBuffer(obj.targetPublicKey);
        obj.sourcePublicKey = MakeIntoBuffer(obj.sourcePublicKey);
        return obj as unknown as ReadBlobRequest;
    }

    /**
     * @throws on error
     */
    public ReadBlobResponse(data: Buffer): ReadBlobResponse {
        const obj = BopReadBlobResponse.decode(data);
        obj.data = MakeIntoBuffer(obj.data);
        return obj as unknown as ReadBlobResponse;
    }

    /**
     * @throws on error
     */
    public GenericMessageRequest(data: Buffer): GenericMessageRequest {
        const obj = BopGenericMessageRequest.decode(data);
        obj.data = MakeIntoBuffer(obj.data);
        obj.sourcePublicKey = MakeIntoBuffer(obj.sourcePublicKey);
        return obj as unknown as GenericMessageRequest;
    }

    /**
     * @throws on error
     */
    public GenericMessageResponse(data: Buffer): GenericMessageResponse {
        const obj = BopGenericMessageResponse.decode(data);
        obj.data = MakeIntoBuffer(obj.data);
        return obj as unknown as GenericMessageResponse;
    }
}
