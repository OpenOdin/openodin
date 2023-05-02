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
    CopyToBuffer,
} from "./util";


/**
 * Class of functions used to serialize request structures into buffers using Bebop.
 *
 */
export class BebopSerialize {

    /**
     * @throws
     */
    public FetchRequest(fetchRequest: FetchRequest): Buffer {
        const obj = fetchRequest as any;
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
        return CopyToBuffer(BopFetchRequest.encode(obj));
    }

    /**
     * @throws
     */
    public StoreRequest(storeRequest: StoreRequest): Buffer {
        return CopyToBuffer(BopStoreRequest.encode(storeRequest));
    }

    /**
     * @throws
     */
    public UnsubscribeRequest(unsubscribeRequest: UnsubscribeRequest): Buffer {
        return CopyToBuffer(BopUnsubscribeRequest.encode(unsubscribeRequest));
    }

    /**
     * @throws
     */
    public WriteBlobRequest(writeBlobRequest: WriteBlobRequest): Buffer {
        return CopyToBuffer(BopWriteBlobRequest.encode(writeBlobRequest));
    }

    /**
     * @throws
     */
    public ReadBlobRequest(readBlobRequest: ReadBlobRequest): Buffer {
        return CopyToBuffer(BopReadBlobRequest.encode(readBlobRequest));
    }

    public ReadBlobResponse(readBlobResponse: ReadBlobResponse): Buffer {
        return CopyToBuffer(BopReadBlobResponse.encode(readBlobResponse));
    }

    public WriteBlobResponse(writeBlobResponse: WriteBlobResponse): Buffer {
        return CopyToBuffer(BopWriteBlobResponse.encode(writeBlobResponse));
    }

    /**
     * @throws
     */
    public GenericMessageRequest(genericMessageRequest: GenericMessageRequest): Buffer {
        return CopyToBuffer(BopGenericMessageRequest.encode(genericMessageRequest));
    }

    public GenericMessageResponse(genericMessageResponse: GenericMessageResponse): Buffer {
        return CopyToBuffer(BopReadBlobResponse.encode(genericMessageResponse));
    }

    public FetchResponse(fetchResponse: FetchResponse): Buffer {
        return CopyToBuffer(BopFetchResponse.encode(fetchResponse));
    }

    public StoreResponse(storeResponse: StoreResponse): Buffer {
        return CopyToBuffer(BopStoreResponse.encode(storeResponse));
    }

    public UnsubscribeResponse(unsubscribeResponse: UnsubscribeResponse): Buffer {
        return CopyToBuffer(BopUnsubscribeResponse.encode(unsubscribeResponse));
    }
}
