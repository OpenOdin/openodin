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
} from "../bebop";

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
} from "./types";

import {
    DeepCopy,
} from "../util/common";


/**
 * Class of functions used to deserialize buffers into request objects from Bebop.
 *
 */
export class BebopDeserialize {

    /**
     * Attempts to deserialize to bebop struct then return as plain old JS object of given type.
     *
     * @throws on error
     */
    public Deserialize(data: Buffer): FetchRequest | FetchResponse | StoreRequest |
        StoreResponse | UnsubscribeRequest | UnsubscribeResponse | WriteBlobRequest |
        WriteBlobResponse | ReadBlobRequest | ReadBlobResponse | GenericMessageResponse |
        GenericMessageRequest
    {
        const opcode = data.readUInt32BE(0);

        switch (opcode) {
            case BopFetchRequest.opcode:
                return this.FetchRequest(data);

            case BopFetchResponse.opcode:
                return this.FetchResponse(data);

            case BopStoreRequest.opcode:
                return this.StoreRequest(data);

            case BopStoreResponse.opcode:
                return this.StoreResponse(data);

            case BopUnsubscribeRequest.opcode:
                return this.UnsubscribeRequest(data);

            case BopUnsubscribeResponse.opcode:
                return this.UnsubscribeResponse(data);

            case BopWriteBlobRequest.opcode:
                return this.WriteBlobRequest(data);

            case BopWriteBlobResponse.opcode:
                return this.WriteBlobResponse(data);

            case BopReadBlobRequest.opcode:
                return this.ReadBlobRequest(data);

            case BopReadBlobResponse.opcode:
                return this.ReadBlobResponse(data);

            case BopGenericMessageRequest.opcode:
                return this.GenericMessageRequest(data);

            case BopGenericMessageResponse.opcode:
                return this.GenericMessageResponse(data);

            default:
                throw new Error("Could not detect object type for Bebop to deserialize");
        }
    }

    /**
     * @throws on error
     */
    public FetchRequest(data: Buffer): FetchRequest {
        const opcode = Buffer.alloc(4);
        opcode.writeUInt32BE(BopFetchRequest.opcode);

        if (!opcode.equals(data.slice(0, 4))) {
            throw new Error("Could not deserialize FetchRequest, wrong opcode");
        }

        return DeepCopy(BopFetchRequest.decode(data.slice(4)), true);
    }

    /**
     * @throws on error
     */
    public FetchResponse(data: Buffer): FetchResponse {
        const opcode = Buffer.alloc(4);
        opcode.writeUInt32BE(BopFetchResponse.opcode);

        if (!opcode.equals(data.slice(0, 4))) {
            throw new Error("Could not deserialize FetchResponse, wrong opcode");
        }

        const fetchResponse = DeepCopy(BopFetchResponse.decode(data.slice(4)), true) as FetchResponse;

        if (!Object.values(Status).includes(fetchResponse.status)) {
            throw new Error("Could not deserialize FetchResponse, unknown status");
        }

        return fetchResponse;
    }

    /**
     * @throws on error
     */
    public StoreRequest(data: Buffer): StoreRequest {
        const opcode = Buffer.alloc(4);
        opcode.writeUInt32BE(BopStoreRequest.opcode);

        if (!opcode.equals(data.slice(0, 4))) {
            throw new Error("Could not deserialize StoreRequest, wrong opcode");
        }

        return DeepCopy(BopStoreRequest.decode(data.slice(4)), true);
    }

    /**
     * @throws on error
     */
    public StoreResponse(data: Buffer): StoreResponse {
        const opcode = Buffer.alloc(4);
        opcode.writeUInt32BE(BopStoreResponse.opcode);

        if (!opcode.equals(data.slice(0, 4))) {
            throw new Error("Could not deserialize StoreResponse, wrong opcode");
        }

        const storeResponse = DeepCopy(BopStoreResponse.decode(data.slice(4)), true) as StoreResponse;

        if (!Object.values(Status).includes(storeResponse.status)) {
            throw new Error("Could not deserialize StoreResponse, unknown status");
        }

        return storeResponse;
    }

    /**
     * @throws on error
     */
    public UnsubscribeRequest(data: Buffer): UnsubscribeRequest {
        const opcode = Buffer.alloc(4);
        opcode.writeUInt32BE(BopUnsubscribeRequest.opcode);

        if (!opcode.equals(data.slice(0, 4))) {
            throw new Error("Could not deserialize UnsubscribeRequest, wrong opcode");
        }

        return DeepCopy(BopUnsubscribeRequest.decode(data.slice(4)), true);
    }

    /**
     * @throws on error
     */
    public UnsubscribeResponse(data: Buffer): UnsubscribeResponse {
        const opcode = Buffer.alloc(4);
        opcode.writeUInt32BE(BopUnsubscribeResponse.opcode);

        if (!opcode.equals(data.slice(0, 4))) {
            throw new Error("Could not deserialize UnsubscribeResponse, wrong opcode");
        }

        const unsubscribeResponse =
            DeepCopy(BopUnsubscribeResponse.decode(data.slice(4)), true) as UnsubscribeResponse;

        if (!Object.values(Status).includes(unsubscribeResponse.status)) {
            throw new Error("Could not deserialize UnsubscribeResponse, unknown status");
        }

        return unsubscribeResponse;
    }

    /**
     * @throws on error
     */
    public WriteBlobRequest(data: Buffer): WriteBlobRequest {
        const opcode = Buffer.alloc(4);
        opcode.writeUInt32BE(BopWriteBlobRequest.opcode);

        if (!opcode.equals(data.slice(0, 4))) {
            throw new Error("Could not deserialize WriteBlobRequest, wrong opcode");
        }

        return DeepCopy(BopWriteBlobRequest.decode(data.slice(4)), true);
    }

    /**
     * @throws on error
     */
    public WriteBlobResponse(data: Buffer): WriteBlobResponse {
        const opcode = Buffer.alloc(4);
        opcode.writeUInt32BE(BopWriteBlobResponse.opcode);

        if (!opcode.equals(data.slice(0, 4))) {
            throw new Error("Could not deserialize WriteBlobResponse, wrong opcode");
        }

        const writeBlobResponse =
            DeepCopy(BopWriteBlobResponse.decode(data.slice(4)), true) as WriteBlobResponse;

        if (!Object.values(Status).includes(writeBlobResponse.status)) {
            throw new Error("Could not deserialize WriteBlobResponse, unknown status");
        }

        return writeBlobResponse;
    }

    /**
     * @throws on error
     */
    public ReadBlobRequest(data: Buffer): ReadBlobRequest {
        const opcode = Buffer.alloc(4);
        opcode.writeUInt32BE(BopReadBlobRequest.opcode);

        if (!opcode.equals(data.slice(0, 4))) {
            throw new Error("Could not deserialize ReadBlobRequest, wrong opcode");
        }

        return DeepCopy(BopReadBlobRequest.decode(data.slice(4)), true);
    }

    /**
     * @throws on error
     */
    public ReadBlobResponse(data: Buffer): ReadBlobResponse {
        const opcode = Buffer.alloc(4);
        opcode.writeUInt32BE(BopReadBlobResponse.opcode);

        if (!opcode.equals(data.slice(0, 4))) {
            throw new Error("Could not deserialize ReadBlobReResponse, wrong opcode");
        }

        const readBlobResponse =
            DeepCopy(BopReadBlobResponse.decode(data.slice(4)), true) as ReadBlobResponse;

        if (!Object.values(Status).includes(readBlobResponse.status)) {
            throw new Error("Could not deserialize ReadBlobResponse, unknown status");
        }

        return readBlobResponse;
    }

    /**
     * @throws on error
     */
    public GenericMessageRequest(data: Buffer): GenericMessageRequest {
        const opcode = Buffer.alloc(4);
        opcode.writeUInt32BE(BopGenericMessageRequest.opcode);

        if (!opcode.equals(data.slice(0, 4))) {
            throw new Error("Could not deserialize GenericMessageRequest, wrong opcode");
        }

        return DeepCopy(BopGenericMessageRequest.decode(data.slice(4)), true);
    }

    /**
     * @throws on error
     */
    public GenericMessageResponse(data: Buffer): GenericMessageResponse {
        const opcode = Buffer.alloc(4);
        opcode.writeUInt32BE(BopGenericMessageResponse.opcode);

        if (!opcode.equals(data.slice(0, 4))) {
            throw new Error("Could not deserialize GenericMessageResponse, wrong opcode");
        }

        const genericMessageResponse =
            DeepCopy(BopGenericMessageResponse.decode(data.slice(4)), true) as GenericMessageResponse;

        if (!Object.values(Status).includes(genericMessageResponse.status)) {
            throw new Error("Could not deserialize GenericMessageResponse, unknown status");
        }

        return genericMessageResponse;
    }
}
