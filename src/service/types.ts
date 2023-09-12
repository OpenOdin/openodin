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

export type LocalStorageConfig = {
    /**
     * The permissions the local storage allows on incoming requests.
     * This is usually unchecked since peer and app permissions are enforced already.
     */
    permissions: P2PClientPermissions,

    /**
     * The permissions the local application is allowed to the local storage.
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
    database?:  LocalStorageConfig,
};

export type SyncConf = {
    peerPublicKeys:    Buffer[],
    blobSizeMaxLimit:  number,
    threads: {
        name: string,
        stream: boolean,
        direction: "pull" | "push" | "both",
        threadParams: ThreadFetchParams,
    }[],
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
