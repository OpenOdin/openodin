import {
    ExpectingReply,
    Header,
    MSG_ID_LENGTH,
    PING_ROUTE,
    PONG_ROUTE,
    Messaging,
} from "pocket-messaging"

import {
    ParseSchema,
    ToJSONObject,
} from "../util/SchemaUtil";

import {
    FetchRequestSchema,
    FetchResponseSchema,
    StoreRequestSchema,
    StoreResponseSchema,
    UnsubscribeRequestSchema,
    WriteBlobRequestSchema,
    WriteBlobResponseSchema,
    ReadBlobRequestSchema,
    ReadBlobResponseSchema,
    GenericMessageRequestSchema,
    GenericMessageResponseSchema,
    UnsubscribeResponseSchema,
} from "../request/jsonSchema";

import {
    BebopSerialize,
} from "../request/BebopSerialize";

import {
    BebopDeserialize,
} from "../request/BebopDeserialize";

import {
    FetchRequest,
    FetchResponse, 
    StoreRequest,
    StoreResponse,
    UnsubscribeRequest,
    UnsubscribeResponse,
    WriteBlobRequest,
    GenericMessageRequest,
    WriteBlobResponse,
    ReadBlobRequest,
    ReadBlobResponse,
    GenericMessageResponse,
} from "../request/types";

import {
    APIRequest,
    APIAuthRequest,
    RouteActions,
} from "./types";

export class APIDataTransformer {
    protected bebopSerialize    = new BebopSerialize();
    protected bebopDeserialize  = new BebopDeserialize();

    constructor() {}

    /**
     * Parses body into request object.
     * @returns either APIRequest or APIAuthRequest
     */
    public parseRequest(body: string): [APIRequest?, APIAuthRequest?] {
        try {
            const request = JSON.parse(body);

            if (typeof(request) !== "object" || request.constructor !== Object) {
                return [undefined, undefined];
            }

            if (request.sessionToken != undefined && typeof(request.sessionToken) !== "string") {
                return [undefined, undefined];
            }

            if (request.auth != undefined) {
                if (!request.auth || typeof(request.auth) !== "string") {
                    return [undefined, undefined];
                }

                if (!request.data || (typeof(request.data) !== "string" && typeof(request.data) !== "object")) {
                    return [undefined, undefined];
                }

                const apiAuthRequest: APIAuthRequest = {
                    sessionToken: request.sessionToken,
                    auth: request.auth,
                    data: request.data,
                };

                return [undefined, apiAuthRequest];
            }
            else {
                const apiRequest = this.parseAPIRequest(request);

                return [apiRequest, undefined];
            }
        }
        catch(e) {
            return [undefined, undefined];
        }
    }

    /**
     * Parse incoming JSON-API request object.
     * {
     *  sessionToken?: string,
     *  target: string | hexstring,
     *  msgId?: hexstring,  // auto generated if not provided.
     *  expectingReply: number,
     *  data: FetchRequest | FetchResponse | etc,
     * }
     *
     * @hrows
     */
    public parseAPIRequest(request: any): APIRequest {
        if (typeof(request) !== "object" || request.constructor !== Object) {
            throw new Error("bad request, must be object");
        }

        if (!request.sessionToken || typeof(request.sessionToken) !== "string") {
            throw new Error("bad request, bad sessionToken");
        }

        if (typeof(request.target) !== "string") {
            throw new Error("bad request, missing target");
        }

        if (typeof(request.msgId) !== "string" || request.msgId.length === 0) {
            request.msgId = Messaging.GenerateMsgId().toString("hex");
        }

        if (typeof(request.expectingReply) !== "number" ||
            (request.expectingReply !== ExpectingReply.SINGLE &&
            request.expectingReply !== ExpectingReply.MULTIPLE))
        {
            request.expectingReply = ExpectingReply.NONE;
        }

        const targetStr = request.target.toLowerCase();

        const isRoute = RouteActions.includes(targetStr);

        // If target is a route action name just turn into Buffer as upper case,
        // else assume target is a msgId represented as hex and convert from hex into Buffer.
        //
        const target = Buffer.from(targetStr, !isRoute ? "hex" : undefined);

        const msgId = Buffer.from(request.msgId, "hex");

        if (msgId.length !== MSG_ID_LENGTH) {
            throw new Error("Bad request, bad msgId");
        }

        const data = (targetStr.toLowerCase() === PING_ROUTE.toLowerCase() ||
            targetStr.toLowerCase() === PONG_ROUTE.toLowerCase()) ? undefined :
            this.ParseRequestBody(request.data);

        return {
            sessionToken: request.sessionToken,
            target,
            msgId,
            expectingReply: request.expectingReply,
            data,
        };
    }

    protected ParseRequestBody(body: string): FetchRequest | FetchResponse | StoreRequest |
        StoreResponse | UnsubscribeRequest | UnsubscribeResponse | WriteBlobRequest |
        WriteBlobResponse | ReadBlobRequest | ReadBlobResponse | GenericMessageResponse |
        GenericMessageRequest
    {
        const obj = JSON.parse(body);

        if (typeof(obj) !== "object" || obj.constructor !== Object) {
            throw new Error("Could not parse request/response type");
        }

        if (obj.query) {
            return ParseSchema(FetchRequestSchema, obj);
        }
        else if (obj.result) {
            return ParseSchema(FetchResponseSchema, obj);
        }
        else if (obj.nodes) {
            return ParseSchema(StoreRequestSchema, obj);
        }
        else if (obj.storedId1List) {
            return ParseSchema(StoreResponseSchema, obj);
        }
        else if (obj.originalMsgId) {
            return ParseSchema(UnsubscribeRequestSchema, obj);
        }
        else if (obj.nodeId1 && obj.data) {
            return ParseSchema(WriteBlobRequestSchema, obj);
        }
        else if (obj.currentLength !== undefined) {
            return ParseSchema(WriteBlobResponseSchema, obj);
        }
        else if (obj.nodeId1 && obj.length!== undefined) {
            return ParseSchema(ReadBlobRequestSchema, obj);
        }
        else if (obj.blobLength !== undefined) {
            return ParseSchema(ReadBlobResponseSchema, obj);
        }
        else if (obj.action !== undefined) {
            return ParseSchema(GenericMessageRequestSchema, obj);
        }
        else if (obj.status !== undefined && obj.data !== undefined) {
            return ParseSchema(GenericMessageResponseSchema, obj);
        }
        else if (obj.status !== undefined && obj.error !== undefined) {
            return ParseSchema(UnsubscribeResponseSchema, obj);
        }

        throw new Error("Could not parse request/response type");
    }

    public stringifyAPIRequest(request: APIRequest): string {
        const isRoute = RouteActions.includes(request.target.toString());

        const target = request.target.toString(!isRoute ? "hex" : undefined);

        const msgId = request.msgId.toString("hex");

        const obj = {
            sessionToken: request.sessionToken ?? "",
            target,
            msgId,
            expectingReply: request.expectingReply,
            data: ToJSONObject(request.data ?? {}, true),
        };

        return JSON.stringify(obj);
    }

    /**
     * Serialize JSON-RPC request object into its native binary format
     * ready to be sent on socket.
     *
     * @throws
     */
    public serialize(request: APIRequest): Buffer {
        let packed = Buffer.alloc(0);

        if (request.target.toString().toLowerCase() === PING_ROUTE.toLowerCase() ||
            request.target.toString().toLowerCase() === PONG_ROUTE.toLowerCase())
        {
            // Ping-pong messages
            // Do not pack anything.
        }
        else {
            if (request.data === undefined) {
                throw new Error("serialize expecting request.data to be set");
            }

            packed = this.bebopSerialize.Serialize(request.data);
        }

        const header: Header = {
            target: request.target,
            msgId: request.msgId,
            dataLength: packed.length,
            version: 0,
            config: request.expectingReply,
        };

        const packedHeader = Messaging.EncodeHeader(header);

        return Buffer.concat([packedHeader, packed]);
    }



    /**
     * Deserialize native binary format into JSON-RPC request object.
     *
     * @throws
     */
    public deserialize(data: Buffer): APIRequest {
        const ret = Messaging.DecodeHeader(data);

        const [header, packed] = ret;

        let dataObj = undefined;

        if (header.target.equals(Buffer.from(PING_ROUTE)) ||
            header.target.equals(Buffer.from(PONG_ROUTE)))
        {
            // Ping-pong message
            // Do not deserialize message, since there is none.
        }
        else {
            dataObj = this.bebopDeserialize.Deserialize(packed);
        }

        const apiRequest: APIRequest = {
            sessionToken: "",
            target: header.target,
            msgId: header.msgId,
            data: dataObj,
            expectingReply: header.config & (ExpectingReply.SINGLE + ExpectingReply.MULTIPLE),
        };

        return apiRequest;
    }
}
