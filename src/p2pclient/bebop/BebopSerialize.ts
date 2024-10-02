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
    Match,
    AllowEmbed,
} from "../../types";

import {
    PackFilters,
} from "./util";

import {
    DeepCopy,
    CopyBuffer,
} from "../../util/common";

/**
 * Class of functions used to serialize request structures into buffers using Bebop.
 *
 */
export class BebopSerialize {

    /**
     * Attempt to serialize any request or response object.
     *
     * @throws
     */
    public Serialize(request: FetchRequest | FetchResponse | StoreRequest |
        StoreResponse | UnsubscribeRequest | UnsubscribeResponse | WriteBlobRequest |
        WriteBlobResponse | ReadBlobRequest | ReadBlobResponse | GenericMessageResponse |
        GenericMessageRequest): Buffer
    {
        if (typeof(request) !== "object" || request.constructor !== Object) {
            throw new Error("Could not detect object type for Bebop to serialize");
        }

        const obj = request as any;

        if (obj.query) {
            return this.FetchRequest(obj as FetchRequest);
        }
        else if (obj.result) {
            return this.FetchResponse(obj as FetchResponse);
        }
        else if (obj.nodes) {
            return this.StoreRequest(obj as StoreRequest);
        }
        else if (obj.storedId1s) {
            return this.StoreResponse(obj as StoreResponse);
        }
        else if (obj.originalMsgId) {
            return this.UnsubscribeRequest(obj as UnsubscribeRequest);
        }
        else if (obj.nodeId1 && obj.data) {
            return this.WriteBlobRequest(obj as WriteBlobRequest);
        }
        else if (obj.currentLength !== undefined) {
            return this.WriteBlobResponse(obj as WriteBlobResponse);
        }
        else if (obj.nodeId1 && obj.length!== undefined) {
            return this.ReadBlobRequest(obj as ReadBlobRequest);
        }
        else if (obj.blobLength !== undefined) {
            return this.ReadBlobResponse(obj as ReadBlobResponse);
        }
        else if (obj.action !== undefined) {
            return this.GenericMessageRequest(obj as GenericMessageRequest);
        }
        else if (obj.status !== undefined && obj.data !== undefined) {
            return this.GenericMessageResponse(obj as GenericMessageResponse);
        }
        else if (obj.status !== undefined && obj.error !== undefined) {
            return this.UnsubscribeResponse(obj as UnsubscribeResponse);
        }

        throw new Error("Could not detect object type for Bebop to serialize");
    }

    /**
     * @throws
     */
    public FetchRequest(fetchRequest: FetchRequest): Buffer {
        const obj = DeepCopy(fetchRequest) as FetchRequest;
        if (!obj || !obj.query) {
            throw new Error("Could not serialize FetchRequest");
        }
        obj.query.match = obj.query.match.map( (match: Match) => {
            return {
                ...match,
                filters: PackFilters(match.filters),
            };
        });
        obj.query.embed = obj.query.embed.map( (embed: AllowEmbed) => {
            return {
                ...embed,
                filters: PackFilters(embed.filters),
            };
        });
        const opcode = Buffer.alloc(4);
        opcode.writeUInt32BE(BopFetchRequest.opcode);
        return CopyBuffer(opcode, BopFetchRequest.encode(obj));
    }

    /**
     * @throws
     */
    public StoreRequest(storeRequest: StoreRequest): Buffer {
        const opcode = Buffer.alloc(4);
        opcode.writeUInt32BE(BopStoreRequest.opcode);
        return CopyBuffer(opcode, BopStoreRequest.encode(storeRequest));
    }

    /**
     * @throws
     */
    public UnsubscribeRequest(unsubscribeRequest: UnsubscribeRequest): Buffer {
        const opcode = Buffer.alloc(4);
        opcode.writeUInt32BE(BopUnsubscribeRequest.opcode);
        return CopyBuffer(opcode, BopUnsubscribeRequest.encode(unsubscribeRequest));
    }

    /**
     * @throws
     */
    public WriteBlobRequest(writeBlobRequest: WriteBlobRequest): Buffer {
        const opcode = Buffer.alloc(4);
        opcode.writeUInt32BE(BopWriteBlobRequest.opcode);
        return CopyBuffer(opcode, BopWriteBlobRequest.encode(writeBlobRequest));
    }

    /**
     * @throws
     */
    public ReadBlobRequest(readBlobRequest: ReadBlobRequest): Buffer {
        const opcode = Buffer.alloc(4);
        opcode.writeUInt32BE(BopReadBlobRequest.opcode);
        return CopyBuffer(opcode, BopReadBlobRequest.encode(readBlobRequest));
    }

    public ReadBlobResponse(readBlobResponse: ReadBlobResponse): Buffer {
        const opcode = Buffer.alloc(4);
        opcode.writeUInt32BE(BopReadBlobResponse.opcode);
        return CopyBuffer(opcode, BopReadBlobResponse.encode(readBlobResponse));
    }

    public WriteBlobResponse(writeBlobResponse: WriteBlobResponse): Buffer {
        const opcode = Buffer.alloc(4);
        opcode.writeUInt32BE(BopWriteBlobResponse.opcode);
        return CopyBuffer(opcode, BopWriteBlobResponse.encode(writeBlobResponse));
    }

    /**
     * @throws
     */
    public GenericMessageRequest(genericMessageRequest: GenericMessageRequest): Buffer {
        const opcode = Buffer.alloc(4);
        opcode.writeUInt32BE(BopGenericMessageRequest.opcode);
        return CopyBuffer(opcode, BopGenericMessageRequest.encode(genericMessageRequest));
    }

    public GenericMessageResponse(genericMessageResponse: GenericMessageResponse): Buffer {
        const opcode = Buffer.alloc(4);
        opcode.writeUInt32BE(BopGenericMessageResponse.opcode);
        return CopyBuffer(opcode, BopGenericMessageResponse.encode(genericMessageResponse));
    }

    public FetchResponse(fetchResponse: FetchResponse): Buffer {
        const opcode = Buffer.alloc(4);
        opcode.writeUInt32BE(BopFetchResponse.opcode);
        return CopyBuffer(opcode, BopFetchResponse.encode(fetchResponse));
    }

    public StoreResponse(storeResponse: StoreResponse): Buffer {
        const obj = {
            status: storeResponse.status,
            error: storeResponse.error,
            storedId1S: storeResponse.storedId1s,
            missingBlobId1S: storeResponse.missingBlobId1s,
            missingBlobSizes: storeResponse.missingBlobSizes,
        };

        const opcode = Buffer.alloc(4);
        opcode.writeUInt32BE(BopStoreResponse.opcode);
        return CopyBuffer(opcode, BopStoreResponse.encode(obj));
    }

    public UnsubscribeResponse(unsubscribeResponse: UnsubscribeResponse): Buffer {
        const opcode = Buffer.alloc(4);
        opcode.writeUInt32BE(BopUnsubscribeResponse.opcode);
        return CopyBuffer(opcode, BopUnsubscribeResponse.encode(unsubscribeResponse));
    }
}
