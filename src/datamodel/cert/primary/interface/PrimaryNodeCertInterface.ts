import {
    BaseTopCertInterface,
} from "../../base/interface/BaseTopCertInterface";

import {
    PrimaryNodeCertParams,
} from "../nodecert/types";

import {
    NodeParams,
} from "../../../node/primary/node/types";

export const PRIMARY_INTERFACE_NODECERT_ID = 3;

export type PrimaryNodeCertConstraintValues = NodeParams;

/**
 * A primary interface for NodeCerts.
 */
export interface PrimaryNodeCertInterface extends BaseTopCertInterface {
    calcConstraintsOnTarget(target: PrimaryNodeCertConstraintValues): Buffer;
    validateAgainstTarget(target: PrimaryNodeCertConstraintValues, deepValidate?: number): [boolean, string];
    setLockedOnParentId(locked: boolean): void;
    isLockedOnParentId(): boolean | undefined;
    setLockedOnNetwork(locked: boolean): void;
    isLockedOnNetwork(): boolean | undefined;
    setLockedOnId2(isLocked: boolean): void;
    isLockedOnId2(): boolean;
    setLockedOnConfig(isLocked: boolean): void;
    isLockedOnConfig(): boolean;
    setLockedOnDifficulty(isLocked: boolean): void;
    isLockedOnDifficulty(): boolean;
    setLockedOnRefId(isLocked: boolean): void;
    isLockedOnRefId(): boolean;
    setLockedOnEmbedded(isLocked: boolean): void;
    isLockedOnEmbedded(): boolean;
    setLockedOnLicenseMinDistance(isLocked: boolean): void;
    isLockedOnLicenseMinDistance(): boolean;
    setLockedOnLicenseMaxDistance(isLocked: boolean): void;
    isLockedOnLicenseMaxDistance(): boolean;
    setLockedOnRegion(isLocked: boolean): void;
    isLockedOnRegion(): boolean;
    setLockedOnJurisdiction(isLocked: boolean): void;
    isLockedOnJurisdiction(): boolean;
    setLockedOnChildMinDifficulty(isLocked: boolean): void;
    isLockedOnChildMinDifficulty(): boolean;
    setLockedOnBlobHash(isLocked: boolean): void;
    isLockedOnBlobHash(): boolean;
    setLockedOnCopiedParentId(isLocked: boolean): void;
    isLockedOnCopiedParentId(): boolean;
    setLockedOnCopiedId1(isLocked: boolean): void;
    isLockedOnCopiedId1(): boolean;
    getParams(): PrimaryNodeCertParams;
    setParams(params: PrimaryNodeCertParams): void;
}
