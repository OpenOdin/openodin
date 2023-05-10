import {
    NodeInterface,
    FriendCertInterface,
} from "../datamodel";

import {
    Status,
    FetchRequest,
    FetchQuery,
} from "../types";

import {
    Transformer,
} from "./transformer";

/**
 * The maximum nr of nodes allowed to be returned for a single query.
 */
export const MAX_QUERY_LIMIT       = 100000;

/**
 * The maximum amount of nodes allowed to be processed for any single level when fetching.
 *
 */
export const MAX_QUERY_LEVEL_LIMIT = 100000;

/**
 * The minimum difficulty required for destroy nodes targeting ALL of the owners nodes.
 *
 */
export const MIN_DIFFICULTY_TOTAL_DESTRUCTION = 2;

/**
 * The split size of blob fragments.
 * This value should never be changed on a live database.
 */
export const BLOB_FRAGMENT_SIZE = 32 * 1024;

/**
 * The maximum amount of table rows allowed to be examined in a single query.
 * This is to prevent sloppy queries from wasting cycles.
 */
export const MAX_QUERY_ROWS_LIMIT = MAX_QUERY_LIMIT * 10;

/**
 * The data types follow the PostgreSQL conventions,
 * SQLite does not put much weight on the declaration types.
 */
export const TABLES: {[table: string]: any} = {
    "universe_nodes": {
        columns: [
            "id1 bytea PRIMARY KEY",
            "id2 bytea NULL",
            "id bytea NOT NULL",
            "parentid bytea NOT NULL",
            "creationtime bigint NOT NULL",
            "expiretime bigint NULL",
            "region char(2) NULL",
            "jurisdiction char(2) NULL",
            "owner bytea NOT NULL",
            "dynamic smallint NOT NULL",
            "active smallint NOT NULL",
            "ispublic smallint NOT NULL",
            "islicensed smallint NOT NULL",
            "disallowparentlicensing smallint NOT NULL",
            "isleaf smallint NOT NULL",
            "difficulty smallint NOT NULL",
            "transienthash bytea NOT NULL",
            "storagetime bigint NOT NULL",
            "updatetime bigint NOT NULL",
            "trailupdatetime bigint NOT NULL",

            /** This UNIQUE index MUST be defined here on the column and not below as a seperate index declaration 
             *  for Postgres to work as Sqlite when it comes to ON CONFLICT. */
            "sharedhash bytea UNIQUE NOT NULL",

            "bumphash bytea NULL",

            "image bytea NOT NULL",
        ],
        indexes: {
            "idx_universe_nodes_creationtime": {
                columns: ["creationtime"],
                unique: false,
            },
            "idx_universe_nodes_storagetime": {
                columns: ["storagetime"],
                unique: false,
            },
            "idx_universe_nodes_id2": {
                columns: ["id2"],
                unique: false,
            },
            "idx_universe_nodes_id": {
                columns: ["id"],
                unique: false,
            },
            "idx_universe_nodes_parentid": {
                columns: ["parentid"],
                unique: false,
            },
            "idx_universe_nodes_owner": {
                columns: ["owner"],
                unique: false,
            },
            "idx_universe_nodes_bumphash": {
                columns: ["bumphash"],
                unique: false,
            },
        },
    },
    "universe_destroy_hashes": {
        columns: [
            /** The id1 of the destroyer node bringing in this hash.
             *  If that node is deleted then we can also delete from here based on id1.
             */
            "id1 bytea NOT NULL",

            /** The destroy hash matches the achilles hash. */
            "hash bytea NOT NULL",
        ],
        indexes: {
            "idx_universe_destroy_hashes_id1": {
                columns: ["id1"],
                unique: false,
            },
            "idx_universe_destroy_hashes_hash": {
                columns: ["hash"],
                unique: false,
            },
            // We don't bother adding this unique constraint because it is not worth it.
            //"idx_universe_destroy_hashes_id1_hash": {
                //columns: ["id1", "hash"],
                //unique: true,
            //},
        },
    },
    "universe_achilles_hashes": {
        columns: [
            /** The id1 of the node this achilles hash belongs to. */
            "id1 bytea NOT NULL",

            /** An achilles hash of the node destroyable by this hash. */
            "hash bytea NOT NULL",
        ],
        indexes: {
            "idx_universe_achilles_hashes_id1": {
                columns: ["id1"],
                unique: false,
            },
            "idx_universe_achilles_hashes_hash": {
                columns: ["hash"],
                unique: false,
            },
            // We don't bother adding this unique constraint because it is not worth it.
            //"idx_universe_achilles_hashes_id1_hash": {
                //columns: ["id1", "hash"],
                //unique: true,
            //},
        },
    },
    "universe_licensee_hashes": {
        columns: [
            /** The id1 of the license node. */
            "id1 bytea NOT NULL",

            /** The hash which licenses licensed nodes. */
            "hash bytea NOT NULL",

            "disallowretrolicensing smallint NOT NULL",
            "parentpathhash bytea NULL",
            "restrictivemodewriter smallint NOT NULL",
            "restrictivemodemanager smallint NOT NULL",
        ],
        indexes: {
            "idx_universe_licensee_hashes_id1": {
                columns: ["id1"],
                unique: false,
            },
            "idx_universe_licensee_hashes_hash": {
                columns: ["hash"],
                unique: false,
            },
        },
    },
    "universe_friend_certs": {
        columns: [
            /** The id1 of the node bringing in the friend cert. */
            "id1 bytea NOT NULL",

            "issuer bytea NOT NULL",
            "constraints bytea NOT NULL",
            "image bytea NOT NULL",
        ],
        indexes: {
            "idx_universe_friend_certs_constraints": {
                columns: ["constraints"],
                unique: false,
            },
        },
    },
};

export const BLOB_TABLES: {[table: string]: any} = {
    "universe_blob_data": {
        columns: [
            "dataid bytea NOT NULL",
            "fragmentnr integer NOT NULL",
            "finalized smallint NOT NULL",
            "fragment bytea NOT NULL",
        ],
        indexes: {
            "idx_universe_blob_data_dataid": {
                columns: ["dataid"],
                unique: false,
            },
            "idx_universe_blob_data_dataid_fragmentnr": {
                columns: ["dataid", "fragmentnr"],
                unique: true,
            },
        },
    },
    "universe_blob": {
        columns: [
            "node_id1 bytea NOT NULL",
            "dataid bytea NOT NULL",
            "storagetime bigint NOT NULL",
        ],
        indexes: {
            "idx_universe_blob_node_id1": {
                columns: ["node_id1"],
                unique: false,
            },
            "idx_universe_blob_dataid": {
                columns: ["dataid"],
                unique: false,
            },
        },
    },
};

export type FetchReplyData = {
    status?: Status,
    error?: string,
    nodes?: NodeInterface[],
    embed?: NodeInterface[],
    deletedNodesId1?: Buffer[],
    indexes?: number[],
    rowCount?: number,
    extra?: string,
    isFirst?: boolean,
    isLast?: boolean,
    now?: number,
};

export interface HandleFetchReplyData {
    (fetchReplyData: FetchReplyData): void;
}

export type BlobDriverInterface = {
    init(): void;

    /**
     * Create tables and indexes if non existing.
     * If all tables already exist returns true.
     * If only some tables exist returns false.
     * Else, create all tables and return true.
     */
    createTables(): Promise<boolean>;

    /**
     * Write blob data.
     *
     * @param dataId the hash of (nodeId1, clientPublicKey).
     * @param pos the position (0-based) of where in the blob to start writing.
     * @param data the data buffer to write.
     *
     * @throws if blob db not available or on malformed input parameters.
     */
    writeBlob(dataId: Buffer, pos: number, data: Buffer): Promise<void>;

    /**
     * Read data of finalized blob.
     *
     * Does not read beyond finalized blob length.
     *
     * @param nodeId1 the node to read blob data for.
     * @param pos the position (0-based) within the blob data to start reading from.
     * @param length the nr of bytes to read from starting position. It is OK to
     * request more bytes than actually finalized to read the full length.
     *
     * @returns finalized blob data requested.
     *
     * @throws if blob db not available or blob data has not been finalized.
     */
    readBlob(nodeId1: Buffer, pos: number, length: number): Promise<Buffer>;

    /**
     * Read the current size of the intermediary non-finalized storage.
     * Size is only counted for continuous data.
     * When the full size has been reached the function finalizeWriteBlob should be called.
     *
     * @returns the number of bytes available as a continuous segment.
     *
     * @throws if blob db not available.
     */
    readBlobIntermediaryLength(dataId: Buffer): Promise<number | undefined>;

    /**
     * Check if a specific intermediary writing matches the expected size and hash,
     * and in such case finalize the data.
     *
     * @param nodeId1
     * @param dataId
     * @param blobLength the expected blob length.
     * @param blobHash the expected blob hash.
     * @param now the storagetime to set.
     *
     * @throws if blob db not available or length or hash not matching.
     */
    finalizeWriteBlob(nodeId1: Buffer, dataId: Buffer, blobLength: number, blobHash: Buffer, now: number): Promise<void>;

    /**
     * @param nodeId1
     *
     * @returns dataId if the complete blob data exists ready to be consumed, otherwise undefined.
     *
     * @throws if blob db not available.
     */
    getBlobDataId(nodeId1: Buffer): Promise<Buffer | undefined>;

    /**
     * Copy blob data from one node to another.
     * @returns false if source blob is not available.
     * @throws on db failure
     */
    copyBlob(fromNodeId1: Buffer, toNodeId1: Buffer, now: number): Promise<boolean>;

    /**
     * Dissociate a node id1 from a blob data set.
     * If it is the last node referecing the data set then also delete the data set.
     */
    deleteBlobs(nodeId1: Buffer[]): Promise<void>;

    /**
     * Event hook for when the blob driver closes.
     * @throws if blob db not available.
     */
    onClose(fn: ()=>void): void;

    close(): void;
};

export type DriverInterface = {
    init(): void;

    /**
     * Create tables and indexes if non existing.
     * If all tables already exist returns true.
     * If only some tables exist returns false.
     * Else, create all tables and return true.
     */
    createTables(): Promise<boolean>;

    /**
     * Drive data from the data layer according to the query and permissions.
     *
     * @param now nodes with expiretime equal or older than "now" will be ignored.
     * @throws on error
     */
    fetch(fetchQuery: FetchQuery, now: number, replyFn: HandleFetchReplyData): void;

    /**
     * Fetch node by its id1.
     * @returns node if found, undefined if not found.
     * @throws on decoding error.
     */
    getNodeById1(nodeId1: Buffer, now: number): Promise<NodeInterface | undefined>;

    /**
     * Fetch a single node based on its id1 for the permissions combo of
     * clientPublicKey, targetPublicKey.
     * Licenses are allowed to be checked upwards from the node in a generous fashion.
     *
     * @returns the node if found and permissions allow.
     */
    fetchSingleNode(nodeId1: Buffer, now: number, clientPublicKey: Buffer, targetPublicKey: Buffer):
        Promise<NodeInterface | undefined>;

    /**
     * Insert nodes into the database.
     *
     * Maximum 1000 nodes for each call is allowed.
     * It is also recommended to not call on a ony-by-one basis since that adds up in roundtrips.
     *
     * @param nodes nodes to be stored. If destroy hashes are present for any node then that node is
     * ignored and not stored.
     * Already existing nodes are not stored, unless preserveTransient is true and the incoming
     * nodes transient hash is different than the already stored one.
     *
     * @param now storage timestamp
     *
     * @param preserveTransient if set to true then store the node again if the stored node's
     * transient values are different from the incoming nodes transient values. Storing a node
     * again will trigger listeners.
     *
     * @returns tuple of inserted node id1s and their parentIds.
     * @throws
     */
    store(nodes: NodeInterface[], now: number, preserveTransient: boolean):
        Promise<[Buffer[], Buffer[]]>;

    /**
     * Automatically wraps the deletion in a transaction and rollbacks on error.
     *
     * @throws on error (already rollbacked).
     */
    deleteNodes(id1s: Buffer[]): void;

    onClose(fn: ()=>void): void;

    offClose(fn: ()=>void): void;

    close(): void;
};

export type InsertAchillesHash = {
    id1: Buffer,
    hash: Buffer,
};

export type InsertLicenseeHash = {
    id1: Buffer,
    hash: Buffer,
    disallowretrolicensing: number,
    parentpathhash?: Buffer,
    restrictivemodewriter: number,
    restrictivemodemanager: number,
};

export type InsertDestroyHash = {
    id1: Buffer,
    hash: Buffer,
};

export type InsertFriendCert = {
    issuer: Buffer,
    constraints: Buffer,
    image: Buffer,
    id1: Buffer,
};

export type LicenseNodeEntry = {
    licenseHashes: Buffer[],
    pathHashes: Buffer[],
    distance: number,
};

export type SelectLicenseeHash = {
    hash: Buffer,
    disallowretrolicensing: number,
    parentpathhash?: Buffer,
    restrictivemodewriter: number,
    restrictivemodemanager: number,
    creationtime: number,
    id1: Buffer,
};

export type SelectFriendCertPair = {
    aid1: Buffer,
    aissuer: Buffer,
    aconstraints: Buffer,
    aimage: Buffer,
    aCertObject?: FriendCertInterface,  // Set later, decoded image.
    bid1: Buffer,
    bissuer: Buffer,
    bconstraints: Buffer,
    bimage: Buffer,
    bCertObject?: FriendCertInterface,  // Set later, decoded image.
};

export type Trigger = {
    key: string,
    msgId: Buffer,
    fetchRequest: FetchRequest,
    isRunning: boolean,
    isCorked: boolean,
    isPending: boolean,
    handleFetchReplyData?: HandleFetchReplyData,
    transformer?: Transformer,
    lastRun: number,
    closed: boolean,

    /** Set when the query has been fetched the first time. This is imporant if using this trigger with transformers. */
    hasFetched: boolean,
};
