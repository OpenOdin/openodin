import {
    PrimaryDefaultCertInterface,
} from "../../primary/interface/PrimaryDefaultCertInterface";

import {
    FriendCertParams,
} from "../friendcert/types";

export const SECONDARY_INTERFACE_FRIENDCERT_ID = 2;

export type FriendCertConstraintValues = {
    /**
     * The embedding License's creationTime.
     * The cert must have its interval within this time.
     */
    creationTime: number,

    /**
     * The embedding License's expireTime.
     * If the cert has targetMaxExpireTime set then this property must be set
     * and it cannot be greater then the cert's targetMaxExpireTime.
     */
    expireTime?: number,

    /**
     * The embedding license's model type which needs to match the certs targetType.
     * Set this to the embedding licenses's GetType value.
     */
    modelType: Buffer,

    /**
     * The other cert's constraints, which also must exactly match the constraints set in this cert,
     * and also the constraints calculated on the target license.
     */
    otherConstraints: Buffer,

    /**
     * This must match the issuer public key of the cert.
     * For A cert set as the owner public key of the embedded license,
     * for B cert set as the targetPublicKeys[0] of the embedding license.
     * */
    publicKey: Buffer,

    /** The other cert's issuer public key. This is part of the calculated constraints. */
    otherIssuerPublicKey: Buffer,

    /**
     * The cert's targetPublicKeys[0] value which is the shared secret key.
     * This is part of the calculated constraints.
     */
    key: Buffer,

    /** The other cert's secret shared key. This is part of the calculated constraints. */
    otherKey: Buffer,

    /** This is part of the constraints. This value comes from the embedded licenses's targetPublicKeys[0]. */
    intermediaryPublicKey: Buffer,

    /** This is part of the constraints. This value comes from the license getting embedded. */
    friendLevel: number,
}

/**
 * A secondary interface for FriendCerts.
 */
export interface FriendCertInterface extends PrimaryDefaultCertInterface {
    calcConstraintsOnTarget(constraintsValues: FriendCertConstraintValues): Buffer | undefined;
    validateAgainstTarget(constraintsValues: FriendCertConstraintValues, deepValidate?: number): [boolean, string];
    getKey(): Buffer | undefined;
    setKey(key: Buffer | undefined): void;
    setLockedOnIntermediary(locked: boolean): void;
    isLockedOnIntermediary(): boolean | undefined;
    setLockedOnLevel(locked: boolean): void;
    isLockedOnLevel(): boolean | undefined;
    getParams(): FriendCertParams;
    setParams(params: FriendCertParams): void;
}
