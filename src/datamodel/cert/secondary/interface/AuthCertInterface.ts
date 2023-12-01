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
    * This must match targetPublicKeys[0] of the cert.
    * It can also be locked in constraints if a chain cert has locked it.
    */
    publicKey: Buffer,

    /**
     * The creation time of the session (UNIX time milliseceonds).
     * The cert must have its interval within this time.
     */
    creationTime: number,

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
    calcConstraintsOnTarget(constraintsValues: AuthCertConstraintValues): Buffer;
    validateAgainstTarget(constraintsValues: AuthCertConstraintValues, deepValidate?: number): [boolean, string];
    getParams(): AuthCertParams;
    setParams(params: AuthCertParams): void;
}
