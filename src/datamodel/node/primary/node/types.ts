/**
 * On versioning.
 *
 * Nodes use the Model class for structuring, packing and unpacking data.
 * The Model class has a six byte header which is the ModelType.
 *
 * Nodes use the ModelType in the following way to manage versioning amongst nodes.
 *
 * These are the six bytes of the node's ModelType:
 * 0-1: Primary interface 16 bit BE encoded, first byte reserved to 0.
 * 2-3: Secondary interface 16 bit BE encoded,
 * 4: Class identifier of node primary+secondary+class makes identifies a specific class.
 * 5: Class major version- The major version of the specific node class.
 *
 * All nodes of the same primary interface are compatible on the primary level.
 * As are all nodes of the same secondary interface compatible on the secondary level.
 */

export type PrimaryInterface = number;      // 16 bit number BE encoded. Note only 8 bits allowed, first byte is reserved to zero.
export type SecondaryInterface = number;    // 16 bit BE number encoded
export type NodeClass = number;             // 8 bit number
export type MajorVersion = number;          // 8 bit number
export type MinorVersion = number;          // not encoded into data structure
export type PatchVersion = number;          // not encoded into data structure

/** major, minor, patch */
export type NodeVersion = [MajorVersion, MinorVersion, PatchVersion];

export type NodeParams = {
    modelType?: Buffer,
    id1?: Buffer,
    copiedId1?: Buffer,
    id2?: Buffer,
    parentId?: Buffer,
    copiedParentId?: Buffer,
    config?: number,
    onlineIdNetwork?: Buffer,
    owner?: Buffer,
    signature?: Buffer,
    signingPublicKeys?: Buffer[],  // Only set on getParams. Used internally between nodes and certs.
    copiedSignature?: Buffer,
    creationTime?: number,
    expireTime?: number,
    difficulty?: number,
    childMinDifficulty?: number,
    nonce?: Buffer,
    refId?: Buffer,
    cert?: Buffer,
    embedded?: Buffer,
    blobHash?: Buffer,
    blobLength?: bigint,
    licenseMinDistance?: number,
    licenseMaxDistance?: number,
    transientConfig?: number,
    transientStorageTime?: number,
    isLeaf?: boolean,
    hasOnlineValidation?: boolean,
    hasOnlineCert?: boolean,
    hasOnlineEmbedding?: boolean,
    isPublic?: boolean,
    isLicensed?: boolean,
    isPrivate?: boolean,  // Note that is for convenience only. It will make sure that isPublic and isLicensed are not set.
    hasRightsByAssociation?: boolean,
    allowEmbed?: boolean,
    allowEmbedMove?: boolean,
    isUnique?: boolean,
    isBeginRestrictiveWriteMode?: boolean,
    isEndRestrictiveWriteMode?: boolean,
    isIndestructible?: boolean,
    region?: string,
    jurisdiction?: string,
    disallowParentLicensing?: boolean,
    onlyOwnChildren?: boolean,
    disallowPublicChildren?: boolean,
    bubbleTrigger?: boolean,
    isOnlineIdValidated?: boolean,
    isOnlineCertOnline?: boolean,
    isOnlineEmbeddingOnline?: boolean,
    isOnlineValidated?: boolean,
    isOnlineRevoked?: boolean,
};

export const NodeSchema = {
    "modelType??": new Uint8Array(0),
    "id1??": new Uint8Array(0),
    "copiedId1??": new Uint8Array(0),
    "id2??": new Uint8Array(0),
    "parentId??": new Uint8Array(0),
    "copiedParentId??": new Uint8Array(0),
    "config??": 0,
    "onlineIdNetwork??": new Uint8Array(0),
    "owner??": new Uint8Array(0),
    "signature??": new Uint8Array(0),
    "signingPublicKeys??": [new Uint8Array(0)],
    "copiedSignature??": new Uint8Array(0),
    "creationTime??": 0,
    "expireTime??": 0,
    "difficulty??": 0,
    "childMinDifficulty??": 0,
    "nonce??": new Uint8Array(0),
    "refId??": new Uint8Array(0),
    "cert??": new Uint8Array(0),
    "embedded??": new Uint8Array(0),
    "blobHash??": new Uint8Array(0),
    "blobLength??": 0n,
    "licenseMinDistance??": 0,
    "licenseMaxDistance??": 0,
    "transientConfig??": 0,
    "transientStorageTime??": 0,
    "isLeaf??": false,
    "hasOnlineValidation??": false,
    "hasOnlineCert??": false,
    "hasOnlineEmbedding??": false,
    "isPublic??": false,
    "isLicensed??": false,
    "isPrivate??": false,
    "hasRightsByAssociation??": false,
    "allowEmbed??": false,
    "allowEmbedMove??": false,
    "isUnique??": false,
    "isBeginRestrictiveWriteMode??": false,
    "isEndRestrictiveWriteMode??": false,
    "isIndestructible??": false,
    "region??": "",
    "jurisdiction??": "",
    "disallowParentLicensing??": false,
    "onlyOwnChildren??": false,
    "disallowPublicChildren??": false,
    "bubbleTrigger??": false,
    "isOnlineIdValidated??": false,
    "isOnlineCertOnline??": false,
    "isOnlineEmbeddingOnline??": false,
    "isOnlineValidated??": false,
    "isOnlineRevoked??": false,
    _postFn: function(nodeParams: NodeParams): NodeParams {
        if (typeof nodeParams.expireTime === "number" && nodeParams.expireTime < 0) {
            nodeParams.expireTime = Date.now() -nodeParams.expireTime;
        }

        return nodeParams;
    }
} as const;

// These are general configs on nodes, deriving nodes might not allow or require some of these bit to be set.
// For example License requires IS_LEAF but does not allow IS_PUBLIC or IS_LICENSED to be set.
export enum NodeConfig {
    // If set then no children are recognized
    IS_LEAF                         = 0,

    HAS_ONLINE_VALIDATION           = 1,

    // If set then any cert used will be validated online.
    HAS_ONLINE_CERT                 = 2,

    // If set then this node is embedding nodes which are expected to have online properties
    // and must be validated online.
    HAS_ONLINE_EMBEDDING            = 3,

    // If set then there are no restrictions on sharing
    IS_PUBLIC                       = 4,

    // If set then node requires a valid license to exist and be shared
    IS_LICENSED                     = 5,

    // If set then this node is allowed to be embedded into another node
    ALLOW_EMBED                     = 6,

    // If set then embedding is allowed to be below different parent id
    ALLOW_EMBED_MOVE                = 7,

    // If set then the Database will ensure that nodes with the same parent will only have one unique node.
    // The uniqueness of a node is the composition of some of the fields, only one of the unique nodes with these fields can be present below the parent.
    IS_UNIQUE                       = 8,

    /**
     * If this is set on a node then the fetch process enter a "restrictive writer mode" from there and downwards.
     * This means that the fetcher will only allow nodes below if the owner of the node has a write license flagged as RESTRICTIVEMODE_WRITER
     * on the node which initiated this mode.
     * The initiator node it self does not need to be licensed to start the restrictive writer mode,
     * because write licenses can target public and private nodes, and also regular licensed nodes.
     *
     * Any node owner can begin a restrictive writer mode as long as it is not already active.
     * To end such a mode or to restart it for another node the write license must also be flagged as RESTRICTIVEMODE_MANAGER.
     * If starting a new mode that replaces the current mode.
     */
    IS_BEGIN_RESTRICTIVEWRITE_MODE  = 9,

    /**
     * If this is set on a node it ends the current restrictive writer mode.
     * The owner of the node must have the a license to the initiator node which is flagged with RESTRICTIVEMODE_MANAGER.
     */
    IS_END_RESTRICTIVEWRITE_MODE    = 10,

    /** If set then node cannot be destroyed by offline destruction nodes. */
    IS_INDESTRUCTIBLE               = 11,

    /**
     * If set on private node then the reader is allowed to fetch the node if they
     * have fetch permissions to a sibling node which the private node is referencing
     * using the refId (set to the siblings node's id1).
     *
     * The referenced node:
     *  - cannot use rights by association it self,
     *  - must be referenced on its id1,
     *  - can be public, licensed or private.
     *  - must have the same parent as the node who permissions are checked for.
     *
     * The private node which the client gets access to via rights by association
     * is still considered private.
     *
     * The node with permissions checked must be online if using online validation.
     *
     */
    HAS_RIGHTS_BY_ASSOCIATION       = 12,

    /**
     * If set then this node cannot be used when traversing upwards looking for parent licenses,
     * meaning the process stops and no parent license can be found.
     */
    DISALLOW_PARENT_LICENSING       = 13,

    /**
     * If set then when fetching only children with same owner are recognized, all others are ignored.
     */
    ONLY_OWN_CHILDREN               = 14,

    /**
     * If set then when fetching any public nodes below the node will be ignored.
     */
    DISALLOW_PUBLIC_CHILDREN        = 15,

    /**
     * If set then bubble trigger events to parent(s).
     */
    BUBBLE_TRIGGER                  = 16,
}

// Config bits set on objects by its environment.
// Embedded nodes and certs never have transient values set to anything than default.
export enum TransientConfig {
    ONLINE_VALIDATED        = 0,

    ONLINE_REVOKED          = 1,

    /**
     * Set to true on nodes who uses a online ID when its id2 is validated.
     */
    ONLINE_ID_VALIDATED     = 2,

    /**
     * Set to true on certs who uses an online cert when the
     * online cert is online.
     */
    ONLINE_CERT_ONLINE      = 3,

    /**
     * Set to true on nodes embedding an online node when the embedded node is online.
     */
    ONLINE_EMBEDDING_ONLINE = 4,
}
