import {
    BaseDataNodeInterface,
    BaseDataNodeProps,
    BaseDataNodeFlags,
} from "../../level2/basedatanode/types";

import {
    SignatureObject,
} from "../../types";

// in range for automatic verification
export const EMBEDDED_NODE_INDEX        =  9;

export const COPIEDSIGNATURES_INDEX     = 65;
export const COPIEDPARENTID_INDEX       = 66;
export const COPIEDCREATIONTIME_INDEX   = 67;

export type DataNodeProps = BaseDataNodeProps & {
    embedded?: Buffer | DataNodeProps,
    copiedSignatures?: Buffer | SignatureObject[],
    copiedParentId?: Buffer,
    copiedCreationTime?: number,
};

export type DataNodeFlags = BaseDataNodeFlags;

export interface DataNodeInterface extends BaseDataNodeInterface {
    getProps(): DataNodeProps;
    setProps(props: DataNodeProps): void;
    mergeProps(props: DataNodeProps): void;
    loadEmbedded(): DataNodeInterface;
    loadFlags(): DataNodeFlags;
    storeFlags(dataNodeFlags: DataNodeFlags): void;
    copy(parentId: Buffer, creationTime?: number): DataNodeInterface;
    getCopiedNode(): DataNodeProps | undefined;
    embed(targetPublicKey: Buffer, creationTime?: number): DataNodeInterface | undefined;
    hashConstraints(lockedConfig: number): Buffer;
    loadCopiedSignatures(): SignatureObject[];
}

export enum DataNodeLockedConfig {
    // Lock on specific fields
    //
    ParentId            = 0,
    Id2                 = 1,
    RefId               = 2,
    Region              = 3,
    Jurisdiction        = 4,
    LicenseMinDistance  = 5,
    LicenseMaxDistance  = 6,
    Difficulty          = 7,
    ContentType         = 8,
    CopiedSignatures    = 9,
    CopiedParentId      = 10,
    CopiedCreationTime  = 11,
    Embedded            = 12,
    Data                = 13,
    Data2               = 14,
    BlobHash            = 15,
    BlobLength          = 16,
    ChildMinDifficulty  = 17,
    BaseNodeConfig      = 18,
    BaseDataNodeConfig  = 19,

    // Lock on specific bits of config fields.
    // This is useful as we can lock on only specific bits in the config and
    // not the full config it self (although that can be done using above).
    //
    // As example to lock a node to be private, we need to lock IsPublic
    // and IsLicensed (both flags as being not set).
    //
    // BaseNode
    IsLeaf                          = 20,
    IsPublic                        = 21,
    IsLicensed                      = 22,
    AllowEmbed                      = 24,
    AllowEmbedMove                  = 25,
    IsUnique                        = 26,
    IsBeginRestrictiveWriterMode    = 27,
    IsEndRestrictiveWriterMode      = 28,
    IsIndestructible                = 29,
    HasRightsByAssociation          = 30,
    DisallowParentLicensing         = 31,
    OnlyOwnChildren                 = 32,
    DisallowPublicChildren          = 33,

    // BaseDataNode
    IsDestroy                       = 34,
    IsAnnotationsEdit               = 35,
    IsAnnotationsReaction           = 36,
}
