import {
    HandshakeFactoryConfig,
} from "pocket-messaging";

import {
    P2PClientPermissions,
} from "../p2pclient/types";

export type ConnectionConfig = {
    handshakeFactoryConfig: HandshakeFactoryConfig,
    connectionType: number,
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
};

export type LocalStorageConfig = {
    /** The permissions the local storage allows on incoming requests. */
    permissions: P2PClientPermissions,

    /** Required to be set. */
    driver: DriverConfig,

    /** Optional. Must be set if accessing blob data. */
    blobDriver?: DriverConfig,
};
