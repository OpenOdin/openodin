import {
    HandshakeFactoryConfig,
    HandshakeFactoryInterface,
} from "pocket-messaging";

import {
    PeerProps,
} from "../p2pclient";

import {
    P2PClientPermissions,
} from "../p2pclient/types";

import {
    KeyPair,
    AuthCertInterface,
    PrimaryNodeCertInterface,
} from "../datamodel";

import {
    ThreadTemplate,
    ThreadFetchParams,
} from "../storage/thread";


export type ConnectionConfig = {
    handshakeFactoryConfig: HandshakeFactoryConfig,
    permissions: P2PClientPermissions,
    region?: string,
    jurisdiction?: string,
};

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

export interface HandshakeFactoryFactoryInterface {
    (handshakeFactoryConfig: HandshakeFactoryConfig, peerProps: PeerProps): Promise<HandshakeFactoryInterface>;
}

export type PeerConf = {
    handshakeFactoryConfig: HandshakeFactoryConfig,
    permissions:            P2PClientPermissions,
    region?:                string,
    jurisdiction?:          string,
};

export type StorageConf = {
    peer?:      PeerConf,
    database?:  DatabaseConfig,
};

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
         * defaults to "pull".
         */
        direction: "pull" | "push" | "both",

        threadFetchParams: ThreadFetchParams,
    }[],
};

/**
 * This is an alternative approach of adding auto sync
 * using an instantiated thread as template.
 */
export type ThreadSyncConf = {
    /**
     * @default true
     */
    stream?: boolean,

    /**
     * @default "both"
     */
    direction?: "pull" | "push" | "both",  // defaults to "both"

    /**
     * @default -1
     */
    blobSizeMaxLimit?:  number,

    /**
     * @default
     * [Buffer.alloc(0)]
     * which means match every remote public key.
     */
    peerPublicKeys?:    Buffer[],
};

export type UniverseConf = {
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
    peers:          PeerConf[],
    sync:           SyncConf[],
};

export type WalletConf = {
    keyPairs:       KeyPair[],
    authCert?:      AuthCertInterface,
    nodeCerts:      PrimaryNodeCertInterface[],
    storage:        StorageConf,
};
