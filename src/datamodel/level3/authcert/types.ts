import {
    BaseSignCertProps,
    BaseSignCertFlags,
    BaseSignCertInterface,
} from "../../level2/basesigncert/types";

import {
    SignCertProps,
    SignCertInterface,
} from "../signcert/types";

export const HANDSHAKEPUBLICKEY_INDEX           = 65;
export const AUTHCERT_REGION_INDEX              = 66;
export const AUTHCERT_JURISDICTION_INDEX        = 67;

export type AuthCertProps = BaseSignCertProps & {
    signCert?: Buffer | SignCertProps,
    handshakePublicKey?: Buffer[],
    region?: string,
    jurisdiction?: string,
};

export type AuthCertFlags = BaseSignCertFlags;

export interface AuthCertInterface extends BaseSignCertInterface {
    getProps(): AuthCertProps;
    setProps(props: AuthCertProps): void;
    mergeProps(props: AuthCertProps): void;
    loadFlags(): AuthCertFlags;
    storeFlags(authCertFlags: AuthCertFlags): void;
    loadSignCert(): SignCertInterface;
    hashConstraints(lockedConfig: number): Buffer;
}

export enum AuthCertLockedConfig {
    // Lock on specific fields
    //
    TargetType          = 0,
    HandshakePublicKey  = 1,
    TargetMaxExpireTime = 2,
    Constraints         = 3,
    Region              = 4,
    Jurisdiction        = 5,

    // Lock on specific bits of config fields.
    // This is useful as we can lock on only specific bits in the config and
    // not the full config it self (although that can be done using above).
    //
    // BaseSignCert
    IsIndestructible    = 6,
}
