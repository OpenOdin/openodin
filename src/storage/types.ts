import {
    BaseNodeInterface,
    FriendCertInterface,
} from "../datamodel";

import {
    StatusValues,
    FetchRequest,
    FetchQuery,
} from "../types";

import {
    CRDTViewType,
} from "./crdt/types";

/**
 * The allowed tolerance for nodes with a creationTime larger than now().
 * There will always be a time skew between system clocks, most common the skew
 * is within the single digit seconds range, this value dictates that nodes
 * with a creationTime too far in the future will be ignored when reading from the database.
 * The reason to cut-off data to far in the future is that it might always be sorted to the top
 * if it is always considered fresher than other data if the sorting/CRDT algorithm is depending
 * heavily on creationTime as the basis of sorting.
 */
export const NOW_TOLERANCE = 60 * 1000;

/**
 * Max read length for a read blob request, any larger requests must be split into multiple requests.
 */
export const MAX_READBLOB_LENGTH = 1024 * 1024;

/**
 * Limit the number of parameters passed to `IN` in queries.
 * Queries for more than this value will be processed in chunks.
 */
export const MAX_BATCH_SIZE         = 100;

/**
 * The maximum amount of nodes allowed to be processed for any single level when fetching.
 *
 */
export const MAX_QUERY_LEVEL_LIMIT = 100_000;

/**
 * The split size of blob fragments.
 * This value should never be changed on a live database.
 */
export const BLOB_FRAGMENT_SIZE = 32 * 1024;

/**
 * The maximum amount of table rows allowed to be examined in a single query.
 * This is to prevent sloppy queries from wasting cycles.
 */
export const MAX_QUERY_ROWS_LIMIT = 1_000_000;

/**
 * The data types follow the PostgreSQL conventions,
 * SQLite does not put much weight on the declaration types.
 */
export const TABLES: {[table: string]: any} = {
    "openodin_nodes": {
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
            "isinactive smallint NOT NULL",
            "ispublic smallint NOT NULL",
            "islicensed smallint NOT NULL",
            "disallowparentlicensing smallint NOT NULL",
            "isleaf smallint NOT NULL",
            "difficulty smallint NOT NULL",
            "transienthash bytea NULL",
            "storagetime bigint NOT NULL",
            "updatetime bigint NOT NULL",
            "trailupdatetime bigint NOT NULL",

            /** This UNIQUE index MUST be defined here on the column and not below as a
             * seperate index declaration, for Postgres to work as Sqlite when it
             * comes to ON CONFLICT. */
            "uniquehash bytea UNIQUE NOT NULL",

            "bumphash bytea NULL",

            "image bytea NOT NULL",
        ],
        indexes: {
            "idx_openodin_nodes_creationtime": {
                columns: ["creationtime"],
                unique: false,
            },
            "idx_openodin_nodes_storagetime": {
                columns: ["storagetime"],
                unique: false,
            },
            "idx_openodin_nodes_trailupdatetime": {
                columns: ["trailupdatetime"],
                unique: false,
            },
            "idx_openodin_nodes_expiretime": {
                columns: ["expiretime"],
                unique: false,
            },
            "idx_openodin_nodes_id2": {
                columns: ["id2"],
                unique: false,
            },
            "idx_openodin_nodes_id": {
                columns: ["id"],
                unique: false,
            },
            "idx_openodin_nodes_parentid": {
                columns: ["parentid"],
                unique: false,
            },
            "idx_openodin_nodes_owner": {
                columns: ["owner"],
                unique: false,
            },
            "idx_openodin_nodes_bumphash": {
                columns: ["bumphash"],
                unique: false,
            },
        },
    },
    "openodin_destroy_hashes": {
        columns: [
            /** The id1 of the destroyer node bringing in this hash.
             *  If that node is deleted then we can also delete from here based on id1.
             */
            "id1 bytea NOT NULL",

            /** The destroy hash matches the achilles hash. */
            "hash bytea NOT NULL",
        ],
        indexes: {
            "idx_openodin_destroy_hashes_id1": {
                columns: ["id1"],
                unique: false,
            },
            "idx_openodin_destroy_hashes_hash": {
                columns: ["hash"],
                unique: false,
            },
            // We don't bother adding this unique constraint because it is not worth it.
            //"idx_openodin_destroy_hashes_id1_hash": {
                //columns: ["id1", "hash"],
                //unique: true,
            //},
        },
    },
    "openodin_achilles_hashes": {
        columns: [
            /** The id1 of the node this achilles hash belongs to. */
            "id1 bytea NOT NULL",

            /** An achilles hash of the node destroyable by this hash. */
            "hash bytea NOT NULL",
        ],
        indexes: {
            "idx_openodin_achilles_hashes_id1": {
                columns: ["id1"],
                unique: false,
            },
            "idx_openodin_achilles_hashes_hash": {
                columns: ["hash"],
                unique: false,
            },
            // We don't bother adding this unique constraint because it is not worth it.
            //"idx_openodin_achilles_hashes_id1_hash": {
                //columns: ["id1", "hash"],
                //unique: true,
            //},
        },
    },
    "openodin_licensing_hashes": {
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
            "idx_openodin_licensing_hashes_id1": {
                columns: ["id1"],
                unique: false,
            },
            "idx_openodin_licensing_hashes_hash": {
                columns: ["hash"],
                unique: false,
            },
        },
    },
    "openodin_friend_certs": {
        columns: [
            /** The id1 of the node bringing in the friend cert. */
            "id1 bytea NOT NULL",

            "owner bytea NOT NULL",
            "constraints bytea NOT NULL",
            "image bytea NOT NULL",
        ],
        indexes: {
            "idx_openodin_friend_certs_constraints": {
                columns: ["constraints"],
                unique: false,
            },
        },
    },
};

export const BLOB_TABLES: {[table: string]: any} = {
    "openodin_blob_data": {
        columns: [
            "dataid bytea NOT NULL",
            "fragmentnr integer NOT NULL",
            "finalized smallint NOT NULL",
            "fragment bytea NOT NULL",
            "creationtime bigint NOT NULL",
        ],
        indexes: {
            "idx_openodin_blob_data_creationtime": {
                columns: ["creationtime"],
                unique: false,
            },
            "idx_openodin_blob_data_dataid": {
                columns: ["dataid"],
                unique: false,
            },
            "idx_openodin_blob_data_dataid_fragmentnr": {
                columns: ["dataid", "fragmentnr"],
                unique: true,
            },
        },
    },
    "openodin_blob": {
        // Note that there is a chance that we can get multiple records of the
        // same nodeId1 and dataId, but that will not matter and forcing a unique
        // constraint on the combination is not worth it.
        columns: [
            "node_id1 bytea NOT NULL",
            "dataid bytea NOT NULL",
            "storagetime bigint NOT NULL",
        ],
        indexes: {
            "idx_openodin_blob_node_id1": {
                columns: ["node_id1"],
                unique: false,
            },
            "idx_openodin_blob_dataid": {
                columns: ["dataid"],
                unique: false,
            },
        },
    },
};

export type FetchReplyData = {
    status?: StatusValues,
    error?: string,
    nodes?: BaseNodeInterface[],
    embed?: BaseNodeInterface[],
    rowCount?: number,
    delta?: Buffer,
    cursorIndex?: number,
    length?: number,
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
     * @param dataId the hash of (nodeId1, sourcePublicKey).
     * @param pos the position (0-based) of where in the blob to start writing.
     * @param data the data buffer to write.
     * @param now the creationtime to set. This is relevant for the GC to be able
     * to eventually garbage collect unfinished writes.
     *
     * @throws if blob db not available or on malformed input parameters.
     */
    writeBlob(dataId: Buffer, pos: number, data: Buffer, now: number): Promise<void>;

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
     * @returns finalized blob data requested, or undefined if blob does not
     * exists or is not finalized.
     *
     * @throws if blob db not available.
     */
    readBlob(nodeId1: Buffer, pos: number, length: number): Promise<Buffer | undefined>;

    /**
     * Read the current size of the intermediary non-finalized or finalized storage.
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
     * Dissociate a node id1 from a blob data set.
     * If it is the last node referecing the data set then also delete the data set.
     *
     * @param nodeId1s
     * @returns how many blobs where deleted.
     */
    deleteBlobs(nodeId1: Buffer[]): Promise<number>;

    /**
     * Delete old non finalized blob data.
     * This is part of the GC to garbage collect old stored blob data which never got finalized.
     *
     * @param timestamp UNIX time milliseconds timetstamp threshold, delete all non finalized data
     * older than given timestamp.
     * @param limit how many rows to delete. Do not set too high as it runs in a transaction and
     * can stall the system if too many rows are considered.
     * @returns nr of rows deleted.
     */
    deleteNonfinalizedBlobData(timestamp: number, limit?: number): Promise<number>;

    /**
     * Check which blobs do exist.
     * @param nodeId1s list of node ID1s to check if their blobs exist.
     * @return list of node ID1s of blobs who do exist.
     */
    blobExists(nodeId1s: Buffer[]): Promise<Buffer[]>;

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
    getNodeById1(nodeId1: Buffer, now: number): Promise<BaseNodeInterface | undefined>;

    /**
     * Fetch nodes by their id1.
     * @returns found nodes
     * @throws on decoding error.
     */
    getNodesById1(nodesId1: Buffer[], now: number): Promise<BaseNodeInterface[]>;

    /**
     * Fetch nodes by their id.
     * @returns found nodes
     * @throws on decoding error.
     */
    getNodesById(nodesId: Buffer[], now: number): Promise<BaseNodeInterface[]>;

    /**
     * Fetch a single node based on its id1, permissions apply.
     *
     * Licenses are allowed to be checked upwards from the node in a generous fashion.
     *
     * @returns the node if found and permissions allow.
     */
    fetchSingleNode(nodeId1: Buffer, now: number, sourcePublicKey: Buffer, targetPublicKey: Buffer):
        Promise<BaseNodeInterface | undefined>;

    /**
     * Insert nodes into the database.
     *
     * Maximum MAX_BATCH_SIZE nodes for each call is allowed.
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
     * @returns triple of inserted node id1s and their parentIds, also list of node ID1s of nodes who are configured with blobs.
     * @throws
     */
    store(nodes: BaseNodeInterface[], now: number, preserveTransient?: boolean):
        Promise<[Buffer[], Buffer[], Buffer[]]>;

    /**
     * Automatically wraps the deletion in a transaction and rollbacks on error.
     *
     * @throws on error (already rollbacked).
     */
    deleteNodes(id1s: Buffer[]): void;

    /**
     * Bumps a specific node and the parent trail upwards.
     * Call this when the blob has finalized and exists to trigger peers to download the blob.
     * This function is not meant to bump license nodes.
     */
    bumpBlobNode(node: BaseNodeInterface, now: number): Promise<void>;

    onClose(fn: ()=>void): void;

    offClose(fn: ()=>void): void;

    close(): Promise<void>;

    /**
     * Fetch list of node ID1s of expired nodes.
     * @param now timestamp for expiration threshold.
     * @param limit max limit of IDs to return, default is 1000.
     */
    getExpiredNodeId1s(now: number, limit?: number): Promise<Buffer[]>;
};

export type InsertAchillesHash = {
    id1: Buffer,
    hash: Buffer,
};

export type InsertLicensingHash = {
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
    owner: Buffer,
    constraints: Buffer,
    image: Buffer,
    id1: Buffer,
};

export type LicenseNodeEntry = {
    licenseHashes: Buffer[],
    pathHashes: Buffer[],
    distance: number,
};

export type SelectLicensingHash = {
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
    aowner: Buffer,
    aconstraints: Buffer,
    aimage: Buffer,
    aCert?: FriendCertInterface,  // Set later, decoded image.
    bid1: Buffer,
    bowner: Buffer,
    bconstraints: Buffer,
    bimage: Buffer,
    bCert?: FriendCertInterface,  // Set later, decoded image.
};

export type Trigger = {
    key: string,
    msgId: Buffer,
    fetchRequest: FetchRequest,
    isRunning: boolean,
    isCorked: boolean,
    isPending: boolean,
    handleFetchReplyData?: HandleFetchReplyData,
    lastIntervalRun: number,
    closed: boolean,

    /**
     * The current CRDT view.
     * This view is diffed against and updated.
     */
    crdtView: CRDTViewType,
};
