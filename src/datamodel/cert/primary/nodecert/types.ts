import {
    BaseCertParams,
    BaseCertSchema,
} from "../../base/types";

export type PrimaryNodeCertParams = BaseCertParams & {
    isLockedOnId2?: boolean,
    isLockedOnParentId?: boolean,
    isLockedOnConfig?: boolean,
    isLockedOnNetwork?: boolean,
    isLockedOnDifficulty?: boolean,
    isLockedOnRefId?: boolean,
    isLockedOnEmbedded?: boolean,
    isLockedOnLicenseMinDistance?: boolean
    isLockedOnLicenseMaxDistance?: boolean,
    isLockedOnRegion?: boolean,
    isLockedOnJurisdiction?: boolean,
    isLockedOnChildMinDifficulty?: boolean,
    isLockedOnBlobHash?: boolean,
    isLockedOnCopiedParentId?: boolean,
    isLockedOnCopiedId1?: boolean,
};

export const PrimaryNodeCertSchema = {
    ...BaseCertSchema,
    "isLockedOnId2??": false,
    "isLockedOnParentId??": false,
    "isLockedOnConfig??": false,
    "isLockedOnNetwork??": false,
    "isLockedOnDifficulty??": false,
    "isLockedOnRefId??": false,
    "isLockedOnEmbedded??": false,
    "isLockedOnLicenseMinDistance??": false,
    "isLockedOnLicenseMaxDistance??": false,
    "isLockedOnRegion??": false,
    "isLockedOnJurisdiction??": false,
    "isLockedOnChildMinDifficulty??": false,
    "isLockedOnBlobHash??": false,
    "isLockedOnCopiedParentId??": false,
    "isLockedOnCopiedId1??": false,
} as const;

/**
 * Extended locked config bits for the primary node cert class.
 * Bit numbers must not conflict with bits in BaseCertLockedConfig.
 */
export enum PrimaryNodeCertLockedConfig {
    IS_LOCKED_ON_ID2                = 0,
    IS_LOCKED_ON_PARENT_ID          = 1,
    IS_LOCKED_ON_CONFIG             = 2,
    IS_LOCKED_ON_NETWORK            = 3,
    IS_LOCKED_ON_DIFFICULTY         = 4,
    IS_LOCKED_ON_REFID              = 5,
    IS_LOCKED_ON_EMBEDDED           = 6,
    IS_LOCKED_ON_ISLICENSED         = 7,
    IS_LOCKED_ON_ISPUBLIC           = 8,
    IS_LOCKED_ON_ISLEAF             = 9,
    IS_LOCKED_ON_LICENSEMINDISTANCE = 10,
    IS_LOCKED_ON_LICENSEMAXDISTANCE = 11,
    IS_LOCKED_ON_REGION             = 12,
    IS_LOCKED_ON_JURISDICTION       = 13,
    IS_LOCKED_ON_CHILDMINDIFFICULTY = 14,
    IS_LOCKED_ON_BLOBHASH           = 15,
    IS_LOCKED_ON_COPIEDPARENTID     = 16,
    IS_LOCKED_ON_COPIEDID1          = 17,
}
