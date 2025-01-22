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
    Krypto,
} from "../datamodel";

import {
    ClientInterface,
    SOCKET_WEBSOCKET,
    SOCKET_TCP,
    SocketFactoryConfig,
} from "pocket-sockets";

import {
    HandshakeFactoryConfig,
    HandshakeFactoryInterface,
    ExpectingReply,
    HandshakeResult,
    PING_ROUTE,
    PONG_ROUTE,
} from "pocket-messaging";

import {
    RouteAction,
} from "../p2pclient/types";

import {
    ConnectionConfig,
} from "../service/types";

import {
    ParseEnum,
    ParseSchemaType,
} from "../util/SchemaUtil";

import {
    SendResponse,
} from "./SendResponse";

export const RouteActions = [...Object.values(RouteAction), PING_ROUTE, PONG_ROUTE];

// Reformat the simplified format into pocket-messaging format.
//
export const HandshakeFactoryConfigSchemaPost = function(obj: any): HandshakeFactoryConfig {
    const keyPair = {
        publicKey: Buffer.alloc(0),
        secretKey: Buffer.alloc(0),
    };

    const client = !obj.client ? undefined : {
        socketType: obj.client.socketType,
        reconnectDelay: obj.client.reconnectDelay,
        clientOptions: {
            host: obj.client.host,
            port: obj.client.port,
            secure: obj.client.secure,
            rejectUnauthorized: obj.client.rejectUnauthorized,
            cert: obj.client.cert,
            key: obj.client.key,
            ca: obj.client.ca,
        },
    };

    const server = !obj.server ? undefined : {
        socketType: obj.server.socketType,
        deniedIPs: obj.server.deniedIPs,
        allowedIPs: obj.server.allowedIPs,
        serverOptions: {
            host: obj.server.host,
            port: obj.server.port,
            ipv6Only: obj.server.ipv6Only,
            requestCert: obj.server.requestCert,
            rejectUnauthorized: obj.server.rejectUnauthorized,
            cert: obj.server.cert,
            key: obj.server.key,
            ca: obj.server.ca,
        },
    };

    const socketFactoryConfig: SocketFactoryConfig = {
        client,
        server,
        maxConnections: obj.maxConnections,
        maxConnectionsPerIp: obj.maxConnectionsPerIp,
    };

    const serverPublicKey = obj.client?.serverPublicKey;

    if (serverPublicKey) {
        if (!Krypto.IsEd25519(serverPublicKey)) {
            throw new Error("HandshakeFactoryConfig serverPublicKey must be Ed25519 public key.");
        }
    }

    const allowedClients = obj.server?.allowedClients;

    if (Array.isArray(allowedClients)) {
        // We need to check so every key is Ed22519.
        //
        allowedClients.forEach( publicKey => {
            if (!Krypto.IsEd25519(publicKey)) {
                throw new Error("HandshakeFactoryConfig allowedClients must all be Ed25519 public keys.");
            }
        });
    }

    return {
        keyPair,
        discriminator: obj.discriminator,
        socketFactoryConfig,
        serverPublicKey,
        allowedClients,
        maxConnectionsPerClient: obj.maxConnectionsPerClient,
        maxConnectionsPerClientPair: obj.maxConnectionsPerClientPair,
        pingInterval: obj.pingInterval,
    };
};

// A simplified format of the HandshakeFactoryConfig structure.
//
export const HandshakeFactoryConfigSchema: ParseSchemaType = {
    "discriminator?": new Uint8Array(0),
    "maxConnections??": 0,
    "maxConnectionsPerIp??": 0,
    "maxConnectionsPerClient??": 0,
    "maxConnectionsPerClientPair??": 0,
    "pingInterval??": 0,
    "client??": {
        socketType: ParseEnum([SOCKET_WEBSOCKET, SOCKET_TCP]),
        serverPublicKey: new Uint8Array(0),
        "reconnectDelay??": 0,
        "host??": "",
        port: 0,
        "secure??": false,
        "rejectUnauthorized??": false,
        "cert??": [""], // PEM formatted strings
        "key??": "",    // PEM formatted client private key, required if cert is set
        "ca??": [""],
    },
    "server??": {
        socketType: ParseEnum([SOCKET_WEBSOCKET, SOCKET_TCP]),
        "allowedClients??": [new Uint8Array(0)],
        "deniedIPs?": [""],
        "allowedIPs??": [""],
        "host??": "",
        port: 0,
        "ipv6Only??": false,
        "requestCert??": false,
        "rejectUnauthorized??": false,
        "cert??": [""],
        "key??": "",
        "ca??": [""],
    },
    _postFn: HandshakeFactoryConfigSchemaPost,
};

export type APIAuthFactoryConfig = HandshakeFactoryConfig & {
    clientAuth?: {
        method: string,
        config?: any,  // client config parameter
    },
    serverAuth?: {
        methods: {[method: string]: any},  // server config parameter
    },
};

export const APIAuthFactoryConfigSchema: ParseSchemaType = {
    "discriminator?": new Uint8Array(0),
    "maxConnections??": 0,
    "maxConnectionsPerIp??": 0,
    "maxConnectionsPerClient??": 0,
    "maxConnectionsPerClientPair??": 0,
    "pingInterval??": 0,
    "client??": {
        socketType: ParseEnum([SOCKET_WEBSOCKET]),
        serverPublicKey: new Uint8Array(0),
        "reconnectDelay??": 0,
        "host??": "",
        port: 0,
        "secure??": false,
        "rejectUnauthorized??": false,
        "cert??": [""], // PEM formatted strings
        "key??": "",    // PEM formatted client private key, required if cert is set
        "ca??": [""],
    },
    "server??": {
        socketType: ParseEnum([SOCKET_TCP]),
        "allowedClients??": [new Uint8Array(0)],
        "deniedIPs?": [""],
        "allowedIPs??": [""],
        "host??": "",
        port: 0,
        "ipv6Only??": false,
        "requestCert??": false,
        "rejectUnauthorized??": false,
        "cert??": [""],
        "key??": "",
        "ca??": [""],
    },
    "clientAuth??": {
        "method": "",
        "config??": {},
    },
    "serverAuth??": {
        methods: {
            "": {},
        },
    },
    _postFn: function(obj: APIAuthFactoryConfig): APIAuthFactoryConfig {
        const obj2 = HandshakeFactoryConfigSchema._postFn(obj) as APIAuthFactoryConfig;

        if ((!obj.clientAuth && !obj.serverAuth) || (obj.clientAuth && obj.serverAuth)) {
            throw new Error("Expecting clientAuth or serverAuth to be set in connection config");
        }

        obj2.clientAuth = obj.clientAuth;
        obj2.serverAuth = obj.serverAuth;

        return obj2;
    },
} as const;

export interface AuthFactoryInterface {
    create(connection: ConnectionConfig["connection"]): Promise<HandshakeFactoryInterface>;
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
     * Optional in parsing for "_ping/_pong", but all other targets require this to be set.
     * Parsed as JSON string.
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
