import {
    ModelType,
} from "../../../model";

import {
    PRIMARY_INTERFACE_NODECERT_ID,
} from "../../primary/interface/PrimaryNodeCertInterface";

import {
    SECONDARY_INTERFACE_LICENSECERT_ID,
} from "../interface/LicenseCertInterface";

import {
    PrimaryNodeCertParams,
} from "../../primary/nodecert/types";

export const LICENSECERT_TYPE: ModelType = Buffer.from([0, PRIMARY_INTERFACE_NODECERT_ID, 0, SECONDARY_INTERFACE_LICENSECERT_ID, 0, 0]);

export type LicenseCertParams = PrimaryNodeCertParams & {
    maxExtensions?: number,
    isLockedOnLicenseTargetPublicKey?: boolean,
    isLockedOnLicenseConfig?: boolean,
    isLockedOnTerms?: boolean,
    isLockedOnExtensions?: boolean,
    isLockedOnFriendLevel?: boolean,
    isLockedOnMaxExtensions?: boolean,
};

/**
 * Extends Node cert locked config.
 * Bit numbers must not conflict with bits in PrimaryNodeCertLockedConfig.
 */
export enum LicenseCertLockedConfig {
    IS_LOCKED_ON_LICENSETARGETPUBLICKEY = 18,
    IS_LOCKED_ON_LICENSECONFIG          = 19,
    IS_LOCKED_ON_TERMS                  = 20,
    IS_LOCKED_ON_EXTENSIONS             = 21,
    IS_LOCKED_ON_FRIENDLEVEL            = 22,
    IS_LOCKED_ON_MAXEXTENSIONS          = 23,
}
