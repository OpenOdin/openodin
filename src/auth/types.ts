import {
    FetchRequest,
    FetchResponse,
    StoreRequest,
    StoreResponse,
    UnsubscribeRequest,
    UnsubscribeResponse,
    WriteBlobRequest,
    WriteBlobResponse,
    ReadBlobRequest,
    ReadBlobResponse,
    GenericMessageResponse,
    GenericMessageRequest,
} from "../types";

import {
    ClientInterface,
} from "pocket-sockets";

import {
    HandshakeFactoryConfig,
    HandshakeFactoryInterface,
    ExpectingReply,
    HandshakeResult,
    PING_ROUTE,
} from "pocket-messaging";

import {
    RouteAction,
} from "../p2pclient/types";

import {
    SendResponse,
} from "./SendResponse";

export const RouteActions = [...Object.values(RouteAction), PING_ROUTE];

export interface AuthFactoryConfig {
    factory: "api" | "native",
}

export type APIAuthFactoryConfig = AuthFactoryConfig & HandshakeFactoryConfig & {
    factory: "api",
    clientAuth?: {
        method: string,
        config?: any,  // client config parameter
    },
    serverAuth?: {
        methods: {[method: string]: any},  // server config parameter
    },
};

export type NativeAuthFactoryConfig = AuthFactoryConfig & HandshakeFactoryConfig & {
    factory: "native",
};

export interface AuthFactoryInterface {
    create(authFactoryConfig: AuthFactoryConfig): Promise<HandshakeFactoryInterface>;
}

export interface NodeSignProxyInterface {
    signMissing(apiRequest: APIRequest): void;
    close(): void;
}

export interface AuthServerProcessInterface {
    next: (session: APISession, authRequest: APIAuthRequest) =>
        Promise<[boolean, APIAuthResponse?, HandshakeResult?, NodeSignProxyInterface?]>;
}

export interface AuthClientProcessInterface {
    auth: () => Promise<[HandshakeResult | undefined, string?]>;
}

export type APISession = {
    sessionToken: string,
    created: number,
    lastActive: number,
    keepAlive: boolean,
    authProcess?: AuthServerProcessInterface,
    webSocket?: ClientInterface,
    messagingClient?: ClientInterface,
    msgs: {[msgId: string]: [SendResponse, ExpectingReply]},
    proxy?: NodeSignProxyInterface,
};

/**
 * This structure is both for API requests and responses.
 *
 */
export type APIRequest = {
    sessionToken: string,

    /**
     * Required in parsing.
     * Parsed as string or hexstring.
     * String for target action,
     * hexstring if reply, then it is msgId as hexstring.
     */
    target: Buffer,

    /**
     * Optional in parsing.
     * Parsed as hexstring (MSG_ID_LENGTH bytes as *2 hex chars), if not set then autogenerated.
     */
    msgId: Buffer,

    /**
     * Optional in parsing.
     * ExpectingReply.SINGLE, ExpectingReply.MULTIPLE or ExpectingReply.NONE (default).
     */
    expectingReply: number,

    /**
     * Optional in parsing for "_PING", but all other targets require this to be set.
     * Parsed as JSON string.
     * All binary (Buffer) fields of every request and response must are encoded into text,
     *  the rule is that every fixed length binary field is encoded as hex string and every
     *  variable binary field is encoded using base64.
     *  See for each parse method in ParseUtil the exact format for each request and response type.
     */
    data: FetchRequest | FetchResponse | StoreRequest | StoreResponse | UnsubscribeRequest |
        UnsubscribeResponse | WriteBlobRequest | WriteBlobResponse | ReadBlobRequest |
        ReadBlobResponse | GenericMessageResponse | GenericMessageRequest | undefined,
};

export type APIAuthRequest = {
    /**
     * Must not be set in the first auth request message,
     * but in every subsequent auth message following.
     */
    sessionToken?: string,

    /**
     * The auth method to use.
     *
     * Must be set for all back-and-forth message exchange during the auth process.
     */
    auth: string,

    /**
     * Data passed to auth process.
     * Its format depends on the auth process used.
     */
    data: string | Record<string, any>,
};

export type APIAuthResponse = {
    /**
     * Set when a session has been created and must be used
     * in subsequent auth message exchange.
     * Can be set on error, but the session has already been invalidated.
     */
    sessionToken?: string,

    /** Same as in given APIAuthRequest. */
    auth: string,

    /** Set on successful message exchange. */
    data?: string | Record<string, any>,

    /** Set on error. */
    error?: string,
};
