import {
    PrimaryDefaultCertInterface,
} from "../../primary/interface/PrimaryDefaultCertInterface";

import {
    AuthCertParams,
} from "../authcert/types";

export const SECONDARY_INTERFACE_AUTHCERT_ID = 1;

export type AuthCertConstraintValues = {
    /**
    * The cryptographic peer public key used to handshake.
    * This must match one of the targetPublicKeys of the cert.
    * It can also be locked for constraints.
    */
    publicKey: Buffer,

    /**
     * The creation time of the session (UNIX time milliseceonds).
     * The cert must have its interval within this time.
     */
    creationTime: number,

    /**
     * The expire time for the session (UNIX time milliseceonds).
     * If the cert has targetMaxExpireTime set then this property must be set
     * and it cannot be greater then the cert's targetMaxExpireTime.
     */
    expireTime?: number,

    /**
     * The local peer's jurisdiction.
     * Lockable constraint.
     */
    jurisdiction?: string,

    /**
     * The local peer's region.
     * Lockable constraint.
     */
    region?: string,

    /**
     * The local peer's connectionType.
     * Lockable constraint.
     */
    connectionType?: number,
}

/**
 * A secondary interface for AuthCerts.
 */
export interface AuthCertInterface extends PrimaryDefaultCertInterface {
    setLockedOnPublicKey(locked: boolean): void;
    isLockedOnPublicKey(): boolean | undefined;
    setLockedOnRegion(locked: boolean): void;
    isLockedOnRegion(): boolean | undefined;
    setLockedOnJurisdiction(locked: boolean): void;
    isLockedOnJurisdiction(): boolean | undefined;
    setLockedOnConnectionType(locked: boolean): void;
    isLockedOnConnectionType(): boolean | undefined;
    calcConstraintsOnTarget(constraintsValues: AuthCertConstraintValues): Buffer;
    validateAgainstTarget(constraintsValues: AuthCertConstraintValues, deepValidate?: number): [boolean, string];
    getParams(): AuthCertParams;
    setParams(params: AuthCertParams): void;
}
