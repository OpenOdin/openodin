import {
    ModelType,
} from "../../../model";

import {
    PRIMARY_INTERFACE_DEFAULTCERT_ID,
} from "../../primary/interface/PrimaryDefaultCertInterface";

import {
    SECONDARY_INTERFACE_AUTHCERT_ID,
} from "../interface/AuthCertInterface";

import {
    BaseCertParams,
} from "../../base/types";

export const AUTHCERT_TYPE: ModelType = Buffer.from([0, PRIMARY_INTERFACE_DEFAULTCERT_ID, 0, SECONDARY_INTERFACE_AUTHCERT_ID, 0, 0]);

/** Params of an AuthCert. */
export type AuthCertParams = Omit<BaseCertParams & {
    isLockedOnPublicKey?: boolean,
    isLockedOnRegion?: boolean,
    isLockedOnJurisdiction?: boolean,
}, "targetMaxExpireTime" | "targetType" | "multiSigThreshold">;

/**
 * Extend config bits from general cert.
 * Bit numbers must not conflict with bits in PrimaryDefaultCertConfig.
 */
export enum AuthCertLockedConfig {
    /**
     * Lock constraints so that the auth cert can only target a specific public key.
     * This is useful when using chained certs so the root cert can dictate this constraints.
     * Note that the authcert targetPublicKeys must always contain the target.publicKey.
     */
    IS_LOCKED_ON_PUBLICKEY          = 0,
    IS_LOCKED_ON_REGION             = 1,
    IS_LOCKED_ON_JURISDICTION       = 2,
}
