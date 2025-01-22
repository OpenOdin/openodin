import {
    BaseSignCertProps,
    BaseSignCertFlags,
    BaseSignCertInterface,
} from "../../level2/basesigncert/types";

export const SIGNCERTLOCKEDCONFIG_INDEX         = 65;

export type SignCertProps = BaseSignCertProps & {
    signCert?: Buffer | SignCertProps,
    countdown?: number,
    lockedConfig?: number,
    targetPublicKeys?: Buffer[],
    multisigThreshold?: number,
};

export type SignCertFlags = BaseSignCertFlags;

export interface SignCertInterface extends BaseSignCertInterface {
    getProps(): SignCertProps;
    setProps(props: SignCertProps): void;
    mergeProps(props: SignCertProps): void;
    loadFlags(): SignCertFlags;
    storeFlags(signCertFlags: SignCertFlags): void;
    hashConstraints(lockedConfig: number): Buffer;
    loadTargetPublicKeys(): Buffer[];
}

export enum SignCertLockedConfig {
    // Lock on specific fields
    //
    TargetType          = 0,
    TargetPublicKeys    = 1,
    MultisigThreshold   = 2,
    TargetMaxExpireTime = 3,
    LockedConfig        = 4,
    Constraints         = 5,

    // Lock on specific bits of config fields.
    // This is useful as we can lock on only specific bits in the config and
    // not the full config it self (although that can be done using above).
    //
    // BaseSignCert
    IsIndestructible    = 6,
}
