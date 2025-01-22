import {
    BaseModelProps,
    BaseModelFlags,
    BaseModelInterface,
} from "../../types";

import {
    SignCertProps,
    SignCertInterface,
} from "../../level3/signcert/types";

export const PARENTID_INDEX             =  32;
export const DIFFICULTY_INDEX           =  33;
export const BASENODECONFIG_INDEX       =  34;
export const REFID_INDEX                =  35;
export const REGION_INDEX               =  36;
export const JURISDICTION_INDEX         =  37;
export const CHILDMINDIFFICULTY_INDEX   =  38;
export const LICENSEMINDISTANCE_INDEX   =  39;
export const LICENSEMAXDISTANCE_INDEX   =  40;

// We place this high as it can depend on all
// values before it including nonce.
export const ID2_INDEX                  = 122;

// We place this high since its value will
// depend on all values before it.
export const DIFFICULTY_NONCE_INDEX     = 127;

// Transient config flags.
// Part of transient hashing.
export const BASENODETRANSIENTCONFIG_INDEX =  128;

// In transient range but not part of transient hash
export const TRANSIENTSTORAGETIME_INDEX = 160;

export const MAX_LICENSE_DISTANCE = 4;

/**
 * Base configuration properties for nodes.
 * Note that not all deriving nodes need to
 * support all configurations below, for instance
 * License nodes will not support licenseMinDistance,
 * hasRightsByAssociation, etc, and require such
 * properties to be unset.
 */
export type BaseNodeProps = BaseModelProps & {
    /** Some nodes can have an id2 */
    id2?: Buffer,

    /** id = id2 ?? id1 */
    id?: Buffer,

    signCert?: Buffer | SignCertProps,

    /** A node alwayas has a parent node ID (parent node not required to exist) */
    parentId?: Buffer,

    /** Configuration flags */
    baseNodeConfig?: number,

    /** Transient configuration flags */
    baseNodeTransientConfig?: number,

    /**
     * Optionally refer to some other Id or value.
     * Its meaning depends on the specific node.
     */
    refId?: Buffer,

    /**
     * Transient value of when the node was stored in the current database.
     */
    transientStorageTime?: number,

    /**
     * Nodes can set for specific regions.
     */
    region?: string,

    /**
     * Nodes can set for specific jurisdiction.
     */
    jurisdiction?: string,


    //
    // Note: Below properties are not stored at this level.
    //

    /**
     * For licensed nodes this is the minimum distance from where to look
     * for a license. 0 means on same parent (sibling nodes).
     */
    licenseMinDistance?: number,

    /**
     * For licensed nodes this is the maximum distance to look at license nodes.
     * Must be same or greater then licenseMinDistance.
     */
    licenseMaxDistance?: number,

    /**
     * A node can have a difficulty signalling the effort the creator had to
     * go through to create it.
     * The meaning of what "effort" is is not defined at this level and
     * is not implemented at this level and will always be unset.
     */
    difficulty?: number,

    /**
     * The solution for the difficulty.
     */
    difficultyNonce?: Buffer,

    /**
     * A node can require its child nodes to fulfill a certain minimal difficulty.
     */
    childMinDifficulty?: number,
};

/**
 * Contains both config flags and transient config flags.
 */
export type BaseNodeFlags = BaseModelFlags & {
    /**
     * If set then no children are recognized.
     */
    isLeaf?: boolean,

    /**
     * If set then there are no restrictions on sharing.
     *
     * A node not having isPublic or isLicensed set is a private node.
     */
    isPublic?: boolean,

    /**
     * If set then the node requires a valid license to exist and to be shared.
     *
     * Note that not all nodes will implement this feature (eg: License nodes).
     *
     * A node not having isPublic or isLicensed set is a private node.
     */
    isLicensed?: boolean,

    /**
     * If set then this node is allowed to be embedded into another node.
     */
    allowEmbed?: boolean,

    /**
     * If set then the embedding node is allowed to be below different parent id
     * than the embedded node.
     */
    allowEmbedMove?: boolean,

    /**
     * If set then the Database will ensure that nodes with the same parent will
     * only have one unique node.
     * The uniqueness of a node is the composition of some of the fields, only
     * one of the unique nodes with these fields can be present below the parent.
     */
    isUnique?: boolean,

    /**
     * If this is set on a node then the fetch process enters a
     * "restrictive writer mode" from there and downwards.
     *
     * This means that the fetcher will only allow nodes below if the owner of
     * the node has a write license flagged as RestrictiveModeWriter
     * on the node which initiated this mode.
     *
     * The initiator node it self does not need to be licensed to start the
     * restrictive writer mode, because write licenses can target public and
     * private nodes, and also regular licensed nodes.
     *
     * Any node owner can begin a restrictive writer mode as long as it is not
     * already active.
     *
     * To end such a mode or to restart it for another node the write license
     * must also be flagged as RestrictiveModeManager.
     *
     * If starting a new mode that replaces the current mode.
     */
    isBeginRestrictiveWriteMode?: boolean,

    /**
     * If this is set on a node it ends the current restrictive writer mode.
     * The owner of the node must have the a license to the initiator node
     * which is flagged with RestrictiveModeManager.
     */
    isEndRestrictiveWriteMode?: boolean,

    /** If set then node cannot be destroyed by offline destruction nodes. */
    isIndestructible?: boolean,

    /**
     * If set on private node then the reader is allowed to fetch the node
     * if they have fetch permissions to a sibling node which the private node
     * is referencing using the refId (set to the siblings node's id1).
     *
     * The referenced node:
     *  - cannot use rights by association it self,
     *  - must be referenced on its id1,
     *  - can be public, licensed or private,
     *  - must have the same parent as the node who permissions are checked for,
     *  - is not allowed to have allowEmbed set
     *
     * The private node which the client gets access to via rights by association
     * is still considered private.
     *
     */
    hasRightsByAssociation?: boolean,

    /**
     * If set then this node cannot be used when traversing upwards looking
     * for parent licenses, meaning the process stops and no parent license
     * can be found.
     */
    disallowParentLicensing?: boolean,

    /**
     * If set then when fetching only children with same owner are recognized,
     * all others are ignored.
     */
    onlyOwnChildren?: boolean,

    /**
     * If set then when fetching any public nodes below the node will be ignored.
     */
    disallowPublicChildren?: boolean,

    /**
     * If set then bubble trigger events to parent(s).
     */
    bubbleTrigger?: boolean,

    /**
     * Transient flag.
     * If set then node becomes less relevant,
     * for example id2 nodes loose their id2,
     * node is treated as leaf node, etc.
     * Setting a node as inactive is a way of brushing it aside
     * but the value is transient and does not normally
     * sync between peers.
     * To sync inactive nodes they have to be explicitly asked for
     * when fetching.
     */
    isInactive?: boolean,
};

export interface BaseNodeInterface extends BaseModelInterface {
    getProps(): BaseNodeProps;
    setProps(props: BaseNodeProps): void;
    mergeProps(props: BaseNodeProps): void;
    verifyWork(): void;
    solveWork(): void;
    loadFlags(): BaseNodeFlags;
    storeFlags(baseNodeFlags: BaseNodeFlags): void;
    getLicenseHashes(isWrite: boolean, lastIssuer?: Buffer, targetPublicKey?: Buffer,
        otherParentId?: Buffer): Buffer[];
    canSendEmbedded(sourcePublicKey: Buffer, targetPublicKey: Buffer): boolean;
    canSendPrivately(sourcePublicKey: Buffer, targetPublicKey: Buffer): boolean;
    canReceivePrivately(sourcePublicKey: Buffer, targetPublicKey: Buffer): boolean;
    uniqueHash(): Buffer;
    getAchillesHashes(): Buffer[];
    matchSignCert(signCertProps: SignCertProps, signerPublicKey?: Buffer): [boolean, string];
    usesParentLicense(): boolean;
    loadSignCert(): SignCertInterface;
    getId(): Buffer;
}

export enum BaseNodeConfig {
    /**
     * If set then no children are recognized.
     */
    IsLeaf                          = 0,

    /**
     * If set then there are no restrictions on sharing.
     */
    IsPublic                        = 1,

    /**
     * If set then the node requires a valid license to exist and to be shared.
     */
    IsLicensed                      = 2,

    /**
     * If set then this node is allowed to be embedded into another node.
     */
    AllowEmbed                      = 3,

    /**
     * If set then the embedding node is allowed to be below different parent id
     * than the embedded node.
     */
    AllowEmbedMove                  = 4,

    /**
     * If set then the Database will ensure that nodes with the same parent will
     * only have one unique node.
     * The uniqueness of a node is the composition of some of the fields, only
     * one of the unique nodes with these fields can be present below the parent.
     */
    IsUnique                        = 5,

    /**
     * If this is set on a node then the fetch process enters a
     * "restrictive writer mode" from there and downwards.
     *
     * This means that the fetcher will only allow nodes below if the owner of
     * the node has a write license flagged as RestrictiveModeWriter
     * on the node which initiated this mode.
     *
     * The initiator node it self does not need to be licensed to start the
     * restrictive writer mode, because write licenses can target public and
     * private nodes, and also regular licensed nodes.
     *
     * Any node owner can begin a restrictive writer mode as long as it is not
     * already active.
     *
     * To end such a mode or to restart it for another node the write license
     * must also be flagged as RestrictiveModeManager.
     *
     * If starting a new mode that replaces the current mode.
     */
    IsBeginRestrictiveWriterMode    = 6,

    /**
     * If this is set on a node it ends the current restrictive writer mode.
     * The owner of the node must have the a license to the initiator node
     * which is flagged with RestrictiveModeManager.
     */
    IsEndRestrictiveWriterMode      = 7,

    /** If set then node cannot be destroyed by offline destruction nodes. */
    IsIndestructible                = 8,

    /**
     * If set on private node then the reader is allowed to fetch the node
     * if they have fetch permissions to a sibling node which the private node
     * is referencing using the refId (set to the siblings node's id1).
     *
     * The referenced node:
     *  - cannot use rights by association it self,
     *  - must be referenced on its id-2,
     *  - can be public, licensed or private.
     *  - must have the same parent as the node who permissions are checked for.
     *
     * The private node which the client gets access to via rights by association
     * is still considered private.
     *
     */
    HasRightsByAssociation          = 9,

    /**
     * If set then this node cannot be used when traversing upwards looking
     * for parent licenses, meaning the process stops and no parent license
     * can be found.
     */
    DisallowParentLicensing         = 10,

    /**
     * If set then when fetching only children with same owner are recognized,
     * all others are ignored.
     */
    OnlyOwnChildren                 = 11,

    /**
     * If set then when fetching any public nodes below the node will be ignored.
     */
    DisallowPublicChildren          = 12,

    /**
     * If set then bubble trigger events to parent(s).
     *
     * This is a configuration which affects how events are bubbled in the graph,
     * where this node is present.
     */
    BubbleTrigger                   = 13,
}

export enum BaseNodeTransientConfig {
    /**
     * If set then node is treated as inactive.
     */
    IsInactive                      = 0,
}
