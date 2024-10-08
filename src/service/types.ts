import {
    HandshakeFactoryInterface,
    HandshakeFactoryConfig,
} from "pocket-messaging";

import {
    SOCKET_WEBSOCKET,
    SOCKET_TCP,
    SocketFactoryConfig,
} from "pocket-sockets";

import {
    P2PClientPermissions,
} from "../p2pclient/types";

import {
    P2PClient,
} from "../p2pclient/P2PClient";

import {
    P2PClientPermissionsLockedSchema,
    P2PClientPermissionsDefaultSchema,
    P2PClientPermissionsPermissiveSchema,
    P2PClientPermissionsUncheckedPermissiveSchema,
} from "../p2pclient/types";

import {
    KeyPair,
    AuthCertInterface,
    PrimaryNodeCertInterface,
    KeyPairSchema,
} from "../datamodel";

import {
    ThreadTemplate,
    ThreadTemplateSchema,
    ThreadVariables,
} from "../storage/thread";

import {
    AuthFactoryConfig,
} from "../auth/types";

import {
    ParseEnum,
} from "../util/SchemaUtil";

export type ConnectionConfig = {
    authFactoryConfig: AuthFactoryConfig,
    permissions: P2PClientPermissions,
    region?: string,
    jurisdiction?: string,

    /**
     * If set then dictate the type of serialization used between peers.
     *
     * The peer running the oldest OpenOdin version has precedence over
     * which format to use (defaults to 0 if not set).
     *
     * When running the same OpenOdin version the format with the highest number is chosen.
     *
     * Must be between 0 and 255 (default is 0).
     */
    serializeFormat: number,
};

export const HandshakeFactoryConfigSchemaPost = function(obj: any): AuthFactoryConfig {
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

    return {
        factory: obj.factory,
        keyPair,
        discriminator: obj.discriminator,
        socketFactoryConfig,
        serverPublicKey: obj.client?.serverPublicKey,
        allowedClients: obj.server?.allowedClients,
        maxConnectionsPerClient: obj.maxConnectionsPerClient,
        maxConnectionsPerClientPair: obj.maxConnectionsPerClientPair,
        pingInterval: obj.pingInterval,
    } as AuthFactoryConfig;
    // TODO:
};

export const HandshakeFactoryConfigSchema = {
    "factory?": ParseEnum(["native", "api"], "native"),
    "discriminator?": new Uint8Array(0),
    "maxConnections??": 0,
    "maxConnectionsPerIp??": 0,
    "maxConnectionsPerClient??": 0,
    "maxConnectionsPerClientPair??": 0,
    "pingInterval??": 0,
    "client??": {
        "auth??": {
            method: "",
            "config??": {},
        },
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
        "auth??": {
            "method": {
                "": {},
            }
        },
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

export const ConnectionConfigSchema = {
    connection: HandshakeFactoryConfigSchema,
    "permissions?": P2PClientPermissionsLockedSchema,
    "region??": "",
    "jurisdiction??": "",
    "serializeFormat?": 0,
    _postFn: function(obj: any): ConnectionConfig {
        const obj2: any = {};

        Object.keys(obj).forEach(key => obj2[key] = obj[key]);

        obj2.authFactoryConfig = obj.connection;

        delete obj2.connection;

        return obj2;
    },
} as const;

export type ExposeStorageToApp = {
    permissions?: P2PClientPermissions,
};

export type DriverConfig = {
    /**
     * File path of SQLite database.
     * Set to ":memory:" for SQLite in-mem database.
     *
     * Mutually exclusive to pg config.
     */
    sqlite?: string,

    /**
     * PostgreSQL connection URI.
     * pg://localhost?db=abc?user=postgres
     * Other common formats are valid too.
     * Missing parameters are taken from ENV variables if available.
     *
     * Mutually exclusive to sqlite config.
     */
    pg?: string,

    /**
     * If set >0 then retry failed connection after x seconds.
     *
     */
    reconnectDelay?: number,
};

export type DatabaseConfig = {
    /**
     * The permissions the database allows on incoming requests.
     * This is usually unchecked since peer and app permissions are enforced already.
     */
    permissions: P2PClientPermissions,

    /**
     * The permissions the local application is allowed to the database.
     * This is usually permissive but should not be unchecked without good reason
     * so that the app is not tricked into exposing data.
     */
    appPermissions: P2PClientPermissions,

    /** Required to be set. */
    driver: DriverConfig,

    /** Optional. Must be set if accessing blob data. */
    blobDriver?: DriverConfig,
};

const DriverConfigSchemaPost = function(obj: DriverConfig): DriverConfig {
    if (obj.sqlite && obj.pg) {
        delete obj.sqlite;
    }

    if (!obj.sqlite && !obj.pg) {
        throw new Error("DriverConfig must have either sqlite or pg set");
    }

    return obj;
};

const DriverConfigSchema = {
    "sqlite?": ":memory:",
    "pg??": "",
    "reconnectDelay?": 0,
    _postFn: DriverConfigSchemaPost,
} as const;

export const DatabaseConfigSchema = {
    "permissions?": P2PClientPermissionsUncheckedPermissiveSchema,
    "appPermissions?": P2PClientPermissionsPermissiveSchema,
    "driver?": DriverConfigSchema,
    "blobDriver?": DriverConfigSchema,
} as const;

export type StorageConf = {
    peer?:      ConnectionConfig,
    database?:  DatabaseConfig,
};

/**
 * Configuration for automatically instantiating Threads for synchronization.
 */
export type SyncConf = {
    peerPublicKeys:    Buffer[],

    /**
     * @default -1
     */
    blobSizeMaxLimit:  number,

    threads: {
        name: string,

        /**
         * Set to true to stream. This will make sure the FetchQuery is properly setup
         * for streaming. If set to false then it will make sure FetchQuery is not
         * setup for streaming.
         *
         * @default false
         */
        stream: boolean,

        /**
         * defaults to "Pull".
         */
        direction: "Pull" | "Push" | "PushPull",

        threadVariables: ThreadVariables,
    }[],
};

export const SyncConfSchema = {
    peerPublicKeys: [new Uint8Array(0)],
    "blobSizeMaxLimit?": -1,
    threads: [{
        name: "",
        "stream?": false,
        "direction?": ParseEnum(["Push", "Pull", "PushPull"], "Pull"),
        "threadVariables?": {},
    }
    ],
} as const;

export type ApplicationConf = {
    format:         1,
    name:           string,
    version:        string,
    title:          string,
    description:    string,
    homepage:       string,
    author:         string,
    repository:     string,
    custom:         {[key: string]: any};
    threads:        {[name: string]: ThreadTemplate};
    peers:          ConnectionConfig[],
    sync:           SyncConf[],
};

const ApplicationConfSchemaPost = function(obj: ApplicationConf): ApplicationConf {
    const [major, minor, patch] = obj.version.split(".").map((i: string) => parseInt(i));

    if(obj.format !== 1) {
        throw new Error("ApplicationConf format expected to be 1");
    }

    if (`${major}.${minor}.${patch}` !== obj.version) {
        throw new Error(`ApplicationConf expecting version in semver format major.minor.patch, got: ${obj.version}`);
    }

    if(!obj.name) {
        throw new Error("ApplicationConf expecting name to be set");
    }

    return obj;
};

export const ApplicationConfSchema = {
    "format?": 1,
    name: "",
    version: "",
    "title?": "",
    "description?": "",
    "homepage?": "",
    "author?": "",
    "repository?": "",
    "custom?": {},
    "threads?": {
        "": ThreadTemplateSchema,
    },
    "peers?": [
        {...ConnectionConfigSchema, "permissions?": P2PClientPermissionsDefaultSchema},
    ],
    "sync?": [
        SyncConfSchema,
    ],
    _postFn: ApplicationConfSchemaPost,
} as const;

export type WalletConf = {
    format:     1,
    keyPairs:   KeyPair[],
    authCert?:  Buffer,
    nodeCerts:  Buffer[],
    storage:    StorageConf,
};

export const StorageConfSchema = {
    "peer??": ConnectionConfigSchema,
    "database?": DatabaseConfigSchema,
} as const;

export const WalletConfSchema = {
    "format?":  1,
    "keyPairs?": [KeyPairSchema],
    "authCert??": new Uint8Array(0),
    "nodeCerts?": [new Uint8Array(0)],
    "storage?": StorageConfSchema,
    _postFn: function(obj: WalletConf): WalletConf {
        if(obj.format !== 1) {
            throw new Error("WalletConf format expected to be 1");
        }

        const storage = obj.storage;

        if (storage.peer) {
            delete storage.database;
        }

        return obj;
    }
} as const;

/** Event emitted when user calls start(). */
export type ServiceStartCallback = () => void;

/** Event emitted when user calls stop(). */
export type ServiceStopCallback = () => void;

/**
 * Event emitted when a connected peer has closed.
 */
export type ServicePeerCloseCallback = (p2pClient: P2PClient) => void;

/**
 * Event emitted when a peer has connected.
 */
export type ServicePeerConnectCallback = (p2pClient: P2PClient) => void;

/**
 * Event emitted when the handshake factory for a peer connection has been setup.
 * This factory can be used to more closely monitor events directly on the factory,
 * and also to tune and set parameters such as blocked IP addresses.
 */
export type ServicePeerFactoryCreateCallback =
    (handshakeFactory: HandshakeFactoryInterface) => void;

export type ServicePeerFactoryCreateErrorCallback = (error: Error) => void;

export type ServicePeerParseErrorCallback = (error: Error) => void;

export type ServicePeerAuthCertErrorCallback = (error: Error, authCert: Buffer) => void;

/** Event emitted when the storage connection has closed. */
export type ServiceStorageCloseCallback = (p2pClient: P2PClient) => void;

/**
 * Event emitted when a connection to Storage has been setup.
 */
export type ServiceStorageConnectCallback = (p2pClient: P2PClient) => void;

/**
 * Event emitted when the handshake factory for storage connections has been setup.
 * This factory can be used to more closely monitor events directly on the factory.
 */
export type ServiceStorageFactoryCreateCallback = (handshakeFactory: HandshakeFactoryInterface) => void;

export type ServiceStorageFactoryCreateErrorCallback = (error: Error) => void;

export type ServiceStorageParseErrorCallback = (error: Error) => void;

export type ServiceStorageAuthCertErrorCallback = (error: Error, authCert: Buffer) => void;

export const EVENT_SERVICE_START = "SERVICE_START";
export const EVENT_SERVICE_STOP = "SERVICE_STOP";
export const EVENT_SERVICE_BLOB = "SERVICE_BLOB";
export const EVENT_SERVICE_STORAGE_CLOSE = "SERVICE_STORAGE_CLOSE";
export const EVENT_SERVICE_STORAGE_CONNECT = "SERVICE_STORAGE_CONNECT";
export const EVENT_SERVICE_STORAGE_FACTORY_CREATE = "SERVICE_STORAGE_FACTORY_CREATE";
export const EVENT_SERVICE_STORAGE_AUTHCERT_ERROR = "SERVICE_STORAGE_AUTHCERT_ERROR";
export const EVENT_SERVICE_STORAGE_PARSE_ERROR = "SERVICE_STORAGE_PARSE_ERROR";
export const EVENT_SERVICE_STORAGE_FACTORY_CREATE_ERROR = "SERVICE_STORAGE_FACTORY_CREATE_ERROR";
export const EVENT_SERVICE_PEER_FACTORY_CREATE = "SERVICE_PEER_FACTORY_CREATE";
export const EVENT_SERVICE_PEER_CONNECT = "SERVICE_PEER_CONNECT";
export const EVENT_SERVICE_PEER_CLOSE = "SERVICE_PEER_CLOSE";
export const EVENT_SERVICE_PEER_AUTHCERT_ERROR = "SERVICE_PEER_AUTHCERT_ERROR";
export const EVENT_SERVICE_PEER_PARSE_ERROR = "SERVICE_PEER_PARSE_ERROR";
export const EVENT_SERVICE_PEER_FACTORY_CREATE_ERROR = "SERVICE_PEER_FACTORY_CREATE_ERROR";
