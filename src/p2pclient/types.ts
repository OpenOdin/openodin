import {
    FetchRequest,
    AllowEmbed,
} from "../types";

import {
    AlgoSorted,
    AlgoRefId,
    AlgoSortedRefId,
} from "../storage/crdt";

import {
    EmbedSchema,
} from "../request/jsonSchema";

import {
    ParseEnum,
    ParseArrayWithDefault,
} from "../util/SchemaUtil";

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

/**
 * Type of a serialization format supported by OpenOdin.
 * Both peers must use the same serialization format.
 */
export type Format = {
    /** ID, 0-255 */
    id: number,

    /** Name of Format */
    name: string,

    /** Short description */
    description: string,

    /** In which OpenOdin version was this format added */
    fromVersion: string,

    /** UNIX time (in seconds) for when this format expires and no longer can be used, if ever */
    expires?: number,
};

/**
 * The list of formats is an append-only list.
 * Formats which are no longer supported can be removed but their ID must not be reused.
 */
export const Formats: {[id: string]: Format} = {
    0: {
        id: 0,
        name: "bebop",
        description: "Standard Bebop binary serialization",
        fromVersion: "0.8.9",
    },
};

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
     * For FetchRequests having includeLicenses set this value is matched against the
     * desired setting in the FetchQuery deciding if the FetchRequest is allowed to
     * use includeLicenses.
     *
     * This configuration is separate from allowEmbed and can be used
     * even if allowEmbed is set empty ([]).
     *
     * This setting is also seperate from Match against licenses.
     *
     * "" = do not allow.
     * "Include" = allow auto include of all licenses needed to license a matched node.
     *      Both read and write licenses are included.
     * "Extend" = allow auto include of licenses which can be embedded to give permissions to matched nodes.
     *      Both read and write licenses are included.
     * "IncludeExtend" = allow both "Include", "Extend", and "IncludeExtend".
     */
    allowIncludeLicenses: "" | "Include" | "Extend" | "IncludeExtend",

    /** Set if to allow fetch requests using triggers. */
    allowTrigger: boolean,

    /** List of node types which are allowed to be queried for by peer. The full node type is six bytes, however fewer bytes can be set to act as wildcards. */
    allowNodeTypes: Buffer[],

    /** Algo IDs supported for CRDT requests. */
    allowAlgos: string[],

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
        allowIncludeLicenses: "IncludeExtend",
        allowTrigger: true,
        allowNodeTypes: [Buffer.from("0004", "hex")],
        allowAlgos: [
            AlgoSorted.GetId(),
            AlgoRefId.GetId(),
            AlgoSortedRefId.GetId(),
        ],
        allowReadBlob: true,
    },
    storePermissions: {
        allowStore: true,
        allowWriteBlob: true,
    }
};

export const P2PClientPermissionsUncheckedPermissiveSchema = {
    "allowUncheckedAccess?": true,
    "fetchPermissions?": {
        "allowNodeTypes?": ParseArrayWithDefault([new Uint8Array(0)], ["0004"]),
        "allowIncludeLicenses?": ParseEnum(["Include", "Extend", "IncludeExtend", ""],
            "IncludeExtend"),
        "allowTrigger?": true,
        "allowEmbed?": ParseArrayWithDefault([EmbedSchema], [{nodeType: "0004", filters: []}]),
        "allowAlgos?": ParseArrayWithDefault([""], [
            AlgoSorted.GetId(),
            AlgoRefId.GetId(),
            AlgoSortedRefId.GetId(),
        ]),
        "allowReadBlob?": true,
    },
    "storePermissions?": {
        "allowStore?": true,
        "allowWriteBlob?": true,
    },
} as const;

export const DEFAULT_PEER_PERMISSIONS: P2PClientPermissions = {
    allowUncheckedAccess: false,
    fetchPermissions: {
        allowEmbed: [
            {
                nodeType: Buffer.from("0004", "hex"),
                "filters": []
            }
        ],
        allowIncludeLicenses: "IncludeExtend",
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

export const P2PClientPermissionsDefaultSchema = {
    "allowUncheckedAccess?": false,
    "fetchPermissions?": {
        "allowNodeTypes?": ParseArrayWithDefault([new Uint8Array(0)], ["0004"]),
        "allowIncludeLicenses?": ParseEnum(["Include", "Extend", "IncludeExtend", ""],
            "IncludeExtend"),
        "allowTrigger?": true,
        "allowEmbed?": ParseArrayWithDefault([EmbedSchema], [{nodeType: "0004", filters: []}]),
        "allowAlgos?": [""],
        "allowReadBlob?": true,
    },
    "storePermissions?": {
        "allowStore?": false,
        "allowWriteBlob?": false,
    },
} as const;

export const PERMISSIVE_PERMISSIONS: P2PClientPermissions = {
    allowUncheckedAccess: false,
    fetchPermissions: {
        allowEmbed: [
            {
                nodeType: Buffer.from("0004", "hex"),
                "filters": []
            }
        ],
        allowIncludeLicenses: "IncludeExtend",
        allowTrigger: true,
        allowNodeTypes: [Buffer.from("0004", "hex")],
        allowAlgos: [
            AlgoSorted.GetId(),
            AlgoRefId.GetId(),
            AlgoSortedRefId.GetId(),
        ],
        allowReadBlob: true,
    },
    storePermissions: {
        allowStore: true,
        allowWriteBlob: true,
    }
};

export const P2PClientPermissionsPermissiveSchema = {
    "allowUncheckedAccess?": false,
    "fetchPermissions?": {
        "allowNodeTypes?": ParseArrayWithDefault([new Uint8Array(0)], ["0004"]),
        "allowIncludeLicenses?": ParseEnum(["Include", "Extend", "IncludeExtend", ""],
            "IncludeExtend"),
        "allowTrigger?": true,
        "allowEmbed?": ParseArrayWithDefault([EmbedSchema], [{nodeType: "0004", filters: []}]),
        "allowAlgos?": ParseArrayWithDefault([""], [
            AlgoSorted.GetId(),
            AlgoRefId.GetId(),
            AlgoSortedRefId.GetId(),
        ]),
        "allowReadBlob?": true,
    },
    "storePermissions?": {
        "allowStore?": true,
        "allowWriteBlob?": true,
    },
} as const;

export const LOCKED_PERMISSIONS: P2PClientPermissions = {
    allowUncheckedAccess: false,
    fetchPermissions: {
        allowEmbed: [],
        allowIncludeLicenses: "",
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

export const P2PClientPermissionsLockedSchema = {
    "allowUncheckedAccess?": false,
    "fetchPermissions?": {
        "allowNodeTypes?": [new Uint8Array(0)],
        "allowIncludeLicenses?": ParseEnum(["Include", "Extend", "IncludeExtend", ""], ""),
        "allowTrigger?": false,
        "allowEmbed?": [EmbedSchema],
        "allowAlgos?": [""],
        "allowReadBlob?": false,
    },
    "storePermissions?": {
        "allowStore?": false,
        "allowWriteBlob?": false,
    },
} as const;

export type PeerDataParams = {
    version: string,
    serializeFormat: number,
    handshakePublicKey?: Buffer,
    authCert?: Buffer,
    authCertPublicKey?: Buffer,
    clockDiff?: number,
    region?: string,
    jurisdiction?: string,
    appVersion?: string,
    expireTime?: number,
};
