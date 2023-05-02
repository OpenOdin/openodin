import {
    DataModelInterface,
} from "../../../interface/DataModelInterface";

import {
    BaseCertParams,
} from "../types";

export type BaseCertConstraintValues = BaseCertParams;

/**
 * An abstract base interface for primary interfaces to extend from.
 */
export interface BaseCertInterface extends DataModelInterface {
    load(image: Buffer): void;
    export(): Buffer;
    countChainLength(): number;
    getIssuerPublicKey(): Buffer | undefined;
    getConfig(): number | undefined;
    setConfig(config: number | undefined): void;
    isConfigBitSet(index: number): boolean;
    getLockedConfig(): number | undefined;
    setLockedConfig(lockedConfig: number | undefined): void;
    isLockedConfigBitSet(index: number): boolean;
    setCertObject(cert: BaseCertInterface | undefined): void;
    getCertObject(): BaseCertInterface;
    setTargetPublicKeys(targetPublicKeys: Buffer[] | undefined): void;  // Who is allowed to sign on behalf of issuer
    getTargetPublicKeys(): Buffer[];
    setConstraints(constraints: Buffer | undefined): void;
    getConstraints(): Buffer | undefined;
    setTargetType(targetType: Buffer | undefined): void;
    getTargetType(): Buffer | undefined;
    validateAgainstTarget(target: unknown, deepValidate?: number): [boolean, string];
    calcConstraintsOnTarget(target: unknown): Buffer | unknown;
    getMaxChainLength(): number | undefined;
    setMaxChainLength(maxLength: number | undefined): void;
    setTargetMaxExpireTime(expireTime: number | undefined): void;
    getTargetMaxExpireTime(): number | undefined;
    getParams(): BaseCertParams;
    setParams(params: BaseCertParams): void;
    setMultiSigThreshold(multiSigThreshold: number | undefined): void;
    getMultiSigThreshold(): number | undefined;
}
