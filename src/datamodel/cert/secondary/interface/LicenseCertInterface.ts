import {
    PrimaryNodeCertInterface,
} from "../../primary/interface/PrimaryNodeCertInterface";

import {
    LicenseParams,
    LicenseNodeSchema,
} from "../../../node/secondary/license/types";

import {
    LicenseCertParams,
} from "../licensecert/types";

export const SECONDARY_INTERFACE_LICENSECERT_ID = 2;

export type LicenseCertConstraintValues = LicenseParams;

export const LicenseCertConstraintSchema = {
    ...LicenseNodeSchema,
} as const;

/**
 * A secondary interface for LicenseCerts.
 */
export interface LicenseCertInterface extends PrimaryNodeCertInterface {
    getMaxExtensions(): number | undefined;
    setMaxExtensions(maxExtensions: number | undefined): void;
    setLockedOnTerms(isLocked: boolean): void;
    isLockedOnTerms(): boolean | undefined;
    calcConstraintsOnTarget(target: LicenseCertConstraintValues): Buffer;
    validateAgainstTarget(target: LicenseCertConstraintValues, deepValidate?: number): [boolean, string];
    setLockedOnLicenseTargetPublicKey(isLocked: boolean): void;
    isLockedOnLicenseTargetPublicKey(): boolean | undefined;
    setLockedOnLicenseConfig(isLocked: boolean): void;
    isLockedOnLicenseConfig(): boolean | undefined;
    setLockedOnExtensions(isLocked: boolean): void;
    isLockedOnExtensions(): boolean | undefined;
    setLockedOnFriendLevel(isLocked: boolean): void;
    isLockedOnFriendLevel(): boolean | undefined;
    setLockedOnMaxExtensions(isLocked: boolean): void;
    isLockedOnMaxExtensions(): boolean | undefined;
    getParams(): LicenseCertParams;
    setParams(params: LicenseCertParams): void;
}
