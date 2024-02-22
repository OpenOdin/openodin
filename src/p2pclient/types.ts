import {
    FetchRequest,
    AllowEmbed,
} from "../types";

export enum RouteAction {
    STORE       = "store",
    FETCH       = "fetch",
    UNSUBSCRIBE = "unsubscribe",
    WRITE_BLOB  = "write-blob",
    READ_BLOB   = "read-blob",
    MESSAGE     = "message",
}

export type SerializeInterface<DataType> = (data: DataType) => Buffer;
export type DeserializeInterface<DataType> = (serialized: Buffer) => DataType;

/** Internally used struct for keeping track of subscriptions. */
export type SubscriptionMap = {
    /** fromMsgId is the ID of the message received from a peer. */
    fromMsgId: Buffer,

    /**
     * This is the ID of message this client created when sending fetch request to the Storage.
     * This is is used to unsubscribe from a fetch request in the Storage.
     */
    originalMsgId: Buffer,

    /** The target we are fetching for creating the subscription. */
    targetPublicKey: Buffer,
};

/**
 * A AutoFetch is a fetch request which is automatically run when a peer is connected.
 * It matches on the peer's publicKey, then it fetches data from the
 * peer to store to the storage.
 * If set in `reverse` mode it will fetch from storage and store to remote peer.
 */
export type AutoFetch = {
    /**
     * If remotePublicKey is an empty buffer then this fetch request matches for any publicKey connecting,
     * otherwise it must match the publicKey of the peer connecting for it to match.
     */
    remotePublicKey: Buffer,

    /** The fetch/subscription to request */
    fetchRequest: FetchRequest,

    /**
     * If >0 then automatically fetch blob data for nodes who have blobs at maximum this size limit.
     * If ==0 then do not automatically sync blobs.
     * If <0 then sync without any limits.
     * */
    blobSizeMaxLimit: number,

    /** If true then reverse the fetch and store so we fetch from storage and store to remote. */
    reverse: boolean,
};

/**
 * A P2PClient is instantiated with permissions which regulate the incoming requests it receives.
 */
export type P2PClientPermissions = {
    /**
     * If set then does not enforce matching of sourcePublicKey and targetPublicKey for incoming requests.
     *
     * This feature is useful when chaining together P2PClients to tunnel requests unaltered,
     * but it comes with security implications if not used properly.
     *
     * Databases have this by default set to true, and the permissions handling is done in the Service layer.
     */
    allowUncheckedAccess: boolean,

    /** The permissions which limits the incoming fetch requests from the remote peer. */
    fetchPermissions: P2PClientFetchPermissions,

    /** The permissions which limits the incoming store requests from the remote peer. */
    storePermissions: P2PClientStorePermissions,
};

/**
 * A struct that states what permissions the local client grants the remote client on fetching.
 */
export type P2PClientFetchPermissions = {
    /**
     * The types of the nodes to allow to be embedded before sent to peer. Shorter types work as wildcards.
     * The P2PClientExtender will automatically sign embedded nodes and store them back to the Storage,
     * so do not set allowEmbed if not trusting the Storage to propose correct nodes.
     */
    allowEmbed: AllowEmbed[],

    /**
     * For FetchRequests having includeLicenses set this value is bit masked against the
     * desired setting in the FetchQuery.
     *
     * This configuration is separate from allowEmbed and can be used
     * even if allowEmbed is set empty ([]).
     *
     * This setting is also seperate from Match against licenses.
     *
     * 0 = do not allow.
     * 1 = allow auto include of all licenses needed to license a matched node.
     *      Both read and write licenses are included.
     * 2 = allow auto include of licenses which can be embedded to give permissions to matched nodes.
     *      Both read and write licenses are included.
     * 3 = allow both 1 and 2.
     */
    allowIncludeLicenses: number,

    /** Set if to allow fetch requests using triggers. */
    allowTrigger: boolean,

    /** List of node types which are allowed to be queried for by peer. The full node type is six bytes, however fewer bytes can be set to act as wildcards. */
    allowNodeTypes: Buffer[],

    /** Algo IDs supported for CRDT requests. */
    allowAlgos: number[],

    /** Is the peer allowed to read blob data? The peer must also have access to the node it self. */
    allowReadBlob: boolean,
};

/**
 * A struct that states what permissions the local client grants the remote client on storing.
 */
export type P2PClientStorePermissions = {
    /** Is the peer allowed to store nodes to this side? */
    allowStore: boolean,

    /** Is the peer allowed to write blob data to this side? This is regardless the value of allowStore. */
    allowWriteBlob: boolean,
};

/**
 * Event emitted when successfully synced blob to storage.
 */
export type BlobEvent = {nodeId1: Buffer};

export const UNCHECKED_PERMISSIVE_PERMISSIONS: P2PClientPermissions = {
    allowUncheckedAccess: true,
    fetchPermissions: {
        allowEmbed: [
            {
                nodeType: Buffer.from("0004", "hex"),
                filters: []
            }
        ],
        allowIncludeLicenses: 3,
        allowTrigger: true,
        allowNodeTypes: [Buffer.from("0004", "hex")],
        allowAlgos: [1, 2],
        allowReadBlob: true,
    },
    storePermissions: {
        allowStore: true,
        allowWriteBlob: true,
    }
};

export const DEFAULT_PEER_PERMISSIONS: P2PClientPermissions = {
    allowUncheckedAccess: false,
    fetchPermissions: {
        allowEmbed: [
            {
                nodeType: Buffer.from("0004", "hex"),
                "filters": []
            }
        ],
        allowIncludeLicenses: 3,
        allowTrigger: true,
        allowNodeTypes: [Buffer.from("0004", "hex")],
        allowAlgos: [],
        allowReadBlob: true,
    },
    storePermissions: {
        allowStore: false,
        allowWriteBlob: false,
    }
};

export const PERMISSIVE_PERMISSIONS: P2PClientPermissions = {
    allowUncheckedAccess: false,
    fetchPermissions: {
        allowEmbed: [
            {
                nodeType: Buffer.from("0004", "hex"),
                "filters": []
            }
        ],
        allowIncludeLicenses: 3,
        allowTrigger: true,
        allowNodeTypes: [Buffer.from("0004", "hex")],
        allowAlgos: [1, 2],
        allowReadBlob: true,
    },
    storePermissions: {
        allowStore: true,
        allowWriteBlob: true,
    }
};

export const LOCKED_PERMISSIONS: P2PClientPermissions = {
    allowUncheckedAccess: false,
    fetchPermissions: {
        allowEmbed: [],
        allowIncludeLicenses: 0,
        allowTrigger: false,
        allowNodeTypes: [],
        allowAlgos: [],
        allowReadBlob: false,
    },
    storePermissions: {
        allowStore: false,
        allowWriteBlob: false,
    }
};
