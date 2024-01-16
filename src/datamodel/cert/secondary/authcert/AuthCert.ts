import {
    ModelType,
    Fields,
} from "../../../model";

import {
    AUTHCERT_TYPE,
    AuthCertLockedConfig,
    AuthCertParams,
} from "./types";

import {
    AuthCertInterface,
    AuthCertConstraintValues,
} from "../interface/AuthCertInterface";

import {
    PrimaryDefaultCert,
} from "../../primary/defaultcert/PrimaryDefaultCert";

import {
    Hash,
} from "../../../hash";

import {
    StripObject,
} from "../../../../util/common";


/**
 * The auth cert is used to authenticate as a public key but cryptographically handshaking using a different key.
 */
export class AuthCert extends PrimaryDefaultCert implements AuthCertInterface {
    constructor(modelType?: ModelType, extraFields?: Fields) {
        const modelType2: Buffer = modelType ?? AUTHCERT_TYPE;
        super(modelType2, extraFields);
    }

    public static GetType(length?: number): Buffer {
        length = length ?? AUTHCERT_TYPE.length;
        return AUTHCERT_TYPE.slice(0, length);
    }

    public getType(length?: number): Buffer {
        length = length ?? AUTHCERT_TYPE.length;
        return AUTHCERT_TYPE.slice(0, length);
    }

    public validate(deepValidate: number = 1, timeMS?: number): [boolean, string] {
        const val = super.validate(deepValidate, timeMS);
        if (!val[0]) {
            return val;
        }

        if (this.getTargetType() !== undefined) {
            return [false, "Auth cert cannot have targetType set."];
        }

        if (this.getTargetMaxExpireTime() !== undefined) {
            return [false, "Auth cert cannot have targetMaxExpireTime set."];
        }

        if (this.getTargetPublicKeys().length !== 1) {
            return [false, "Auth cert must have targetPublicKeys set to single key."];
        }

        if (this.getMultiSigThreshold() !== undefined) {
            return [false, "multiSigThreshold cannot be set on AuthCert."];
        }

        return [true, ""];
    }

    /**
     * Note that the cert chain root issuer publicKey is not matched against anything in target,
     * but it dictates what publicKey the authorized target now takes as identity.
     */
    public validateAgainstTarget(authCertConstraintValues: AuthCertConstraintValues): [boolean, string] {
        const targetPublicKeys = this.getTargetPublicKeys();

        if (targetPublicKeys.length !== 1) {
            return [false, "Missing targetPublicKeys (must be set to single key)"];
        }

        // We only allow single key in targetPublicKeys.
        //
        if (!targetPublicKeys[0]?.equals(authCertConstraintValues.publicKey)) {
            return [false, `AuthCertConstraintValues.publicKey ${authCertConstraintValues.publicKey.toString("hex")} does not match targetPublicKeys[0]`];
        }

        // Check so the session time matches the certs valid time.
        //
        const certCreationTime = this.getCreationTime();

        const certExpireTime = this.getExpireTime();

        if (certCreationTime === undefined || certExpireTime === undefined) {
            // These are enforced to have been set in validate().
            //
            return [false, "Missing creation/expireTime in cert"];
        }

        if (certCreationTime > authCertConstraintValues.creationTime) {
            // Cert is not valid yet.
            //
            return [false, `Auth cert creationTime (${certCreationTime}) cannot be greater than the authCertConstraintValues creationTime (${authCertConstraintValues.creationTime})`];
        }

        if (certExpireTime <= authCertConstraintValues.creationTime) {
            // Cert has expired.
            //
            return [false, `Auth cert expireTime (${certExpireTime}) must be greater than the authCertConstraintValues creationTime (${authCertConstraintValues.creationTime})`];
        }

        // Check constraints, if set.
        // Note that if any chain certs have constraints set then this will
        // have been enforced to be the same value.
        //
        const constraints = this.getConstraints();

        if (constraints) {
            const targetConstraints = this.calcConstraintsOnTarget(authCertConstraintValues);

            if (!constraints.equals(targetConstraints)) {
                return [false, `Constraints of cert (${constraints.toString("hex")}) and those calculated from authCertConstraintValues (${targetConstraints.toString("hex")}) do not match.`];
            }
        }

        return [true, ""];
    }

    public calcConstraintsOnTarget(authCertConstraintValues: AuthCertConstraintValues): Buffer {
        const values: (string | Buffer | number | undefined)[] = [];

        if (this.isLockedOnPublicKey()) {
            values.push(authCertConstraintValues.publicKey);
        }
        else {
            values.push(undefined);
        }

        if (this.isLockedOnRegion()) {
            values.push(authCertConstraintValues.region);
        }
        else {
            values.push(undefined);
        }

        if (this.isLockedOnJurisdiction()) {
            values.push(authCertConstraintValues.jurisdiction);
        }
        else {
            values.push(undefined);
        }

        return Hash(values);
    }

    /**
     * Lock constraints so that targetPublicKey must be set to this.
     */
    public setLockedOnPublicKey(locked: boolean = true) {
        this.setLockedConfigBit(AuthCertLockedConfig.IS_LOCKED_ON_PUBLICKEY, locked);
    }

    public isLockedOnPublicKey(): boolean | undefined {
        return this.isLockedConfigBitSet(AuthCertLockedConfig.IS_LOCKED_ON_PUBLICKEY);
    }

    /**
     * Lock constraints on region provided by the remote peer.
     */
    public setLockedOnRegion(locked: boolean = true) {
        this.setLockedConfigBit(AuthCertLockedConfig.IS_LOCKED_ON_REGION, locked);
    }

    public isLockedOnRegion(): boolean | undefined {
        return this.isLockedConfigBitSet(AuthCertLockedConfig.IS_LOCKED_ON_REGION);
    }

    /**
     * Lock constraints on jurisdiction provided by the remote peer.
     */
    public setLockedOnJurisdiction(locked: boolean = true) {
        this.setLockedConfigBit(AuthCertLockedConfig.IS_LOCKED_ON_JURISDICTION, locked);
    }

    public isLockedOnJurisdiction(): boolean | undefined {
        return this.isLockedConfigBitSet(AuthCertLockedConfig.IS_LOCKED_ON_JURISDICTION);
    }

    public setParams(params: AuthCertParams) {
        super.setParams(params);
        if (params.isLockedOnPublicKey !== undefined) {
            this.setLockedOnPublicKey(params.isLockedOnPublicKey);
        }
        if (params.isLockedOnRegion !== undefined) {
            this.setLockedOnRegion(params.isLockedOnRegion);
        }
        if (params.isLockedOnJurisdiction !== undefined) {
            this.setLockedOnJurisdiction(params.isLockedOnJurisdiction);
        }
    }

    public getParams(): AuthCertParams {
        const isLockedOnPublicKey = this.isLockedOnPublicKey();
        const isLockedOnRegion = this.isLockedOnRegion();
        const isLockedOnJurisdiction = this.isLockedOnJurisdiction();

        return {
            ...super.getParams(),
            isLockedOnPublicKey,
            isLockedOnRegion,
            isLockedOnJurisdiction,
        };
    }

    public toString(short: boolean = false): string {
        const shortFields = ["owner", "targetPublicKeys", "creationTimeSeconds",
            "expireTimeSeconds", "constraints", "targetType", "maxChainLength", "targetMaxExpireTimeSeconds",
            "multiSigThreshold"];

        const longFields = ["owner", "targetPublicKeys", "config", "lockedConfig", "creationTimeSeconds",
            "expireTimeSeconds", "constraints", "targetType", "maxChainLength", "targetMaxExpireTimeSeconds",
            "transientConfig", "multiSigThreshold"];

        const fields = short ? shortFields : longFields;

        const o: any = {
            name: "AuthCert",
            type: this.getType(),
            "id1": this.calcId1(),
        };
        fields.forEach( fieldName => {
            o[fieldName] = this.model.getAny(fieldName);
        });

        return JSON.stringify(StripObject(o), null, 4);
    }
}
