import {
    ModelType,
    Fields,
    FieldType,
} from "../../../model";

import {
    FRIENDCERT_TYPE,
    FriendCertLockedConfig,
    FriendCertParams,
} from "./types";

import {
    SPECIAL_NODES,
} from "../../../node/secondary/data/types";

import {
    FriendCertInterface,
    FriendCertConstraintValues,
} from "../interface/FriendCertInterface";

import {
    PrimaryDefaultCert,
} from "../../primary/defaultcert/PrimaryDefaultCert";

import {
    Hash,
} from "../../../hash";

import {
    ToJSONObject,
} from "../../../../util/SchemaUtil";

/** The added fields for FriendCert. */
const FIELDS: Fields = {
    // The shared secret key used to generate the common constraints hash.
    key: {
        name: "key",
        type: FieldType.BYTES,
        maxSize: 32,
        index: 30,
    },
}

/**
 * A concrete friend cert class.
 * This cert is used in Licenses to prove friendship between A and B when extending the license from A to B.
 */
export class FriendCert extends PrimaryDefaultCert implements FriendCertInterface {
    constructor(modelType?: ModelType, extraFields?: Fields) {
        extraFields = extraFields ?? {};
        const fields = {...FIELDS, ...extraFields};
        const modelType2: Buffer = modelType ?? FRIENDCERT_TYPE;
        super(modelType2, fields);
    }

    public static GetType(length?: number): Buffer {
        length = length ?? FRIENDCERT_TYPE.length;
        return FRIENDCERT_TYPE.slice(0, length);
    }

    public getType(length?: number): Buffer {
        length = length ?? FRIENDCERT_TYPE.length;
        return FRIENDCERT_TYPE.slice(0, length);
    }

    public getKey(): Buffer | undefined {
        return this.model.getBuffer("key");
    }

    public setKey(key: Buffer | undefined) {
        this.model.setBuffer("key", key);
    }

    public validate(deepValidate: number = 1, timeMS?: number): [boolean, string] {
        const val = super.validate(deepValidate, timeMS);
        if (!val[0]) {
            return val;
        }

        if (this.getConstraints() === undefined) {
            return [false, "Friend cert must have constraints set."];
        }

        if (this.getTargetPublicKeys().length === 0) {
            return [false, "Friend cert must have targetPublicKeys set (is shared secrey key)."];
        }

        if (this.isIndestructible()) {
            return [false, "Friend cert cannot be indestructible."];
        }

        return [true, ""];
    }

    public validateAgainstTarget(friendCertConstraintValues: FriendCertConstraintValues): [boolean, string] {
        const issuerPublicKey = this.getIssuerPublicKey();
        if (!issuerPublicKey || !issuerPublicKey.equals(friendCertConstraintValues.publicKey)) {
            return [false, `constraints publicKey must be same as cert issuerPublicKey.`];
        }

        const key = this.getKey();
        if (!key || !key.equals(friendCertConstraintValues.key)) {
            return [false, `constraints key must be same as cert.key.`];
        }

        // Check so the signing time matches the certs valid time.
        const certCreationTime = this.getCreationTime();
        const certExpireTime = this.getExpireTime();

        if (certCreationTime === undefined || certExpireTime === undefined) {
            return [false, "Missing creation/expireTime in cert"];
        }

        if (certCreationTime > friendCertConstraintValues.creationTime) {
            return [false, `Friend cert creationTime (${certCreationTime}) cannot be greater than the target (license) creationTime (${friendCertConstraintValues.creationTime})`];
        }

        if (certExpireTime <= friendCertConstraintValues.creationTime) {
            return [false, `Friend cert expireTime (${certExpireTime}) must be greater than the target (license) creationTime (${friendCertConstraintValues.creationTime})`];
        }

        // Check any maximum allowed expire time for target.
        const targetMaxExpireTime = this.getTargetMaxExpireTime();
        if (targetMaxExpireTime !== undefined) {
            if (friendCertConstraintValues.expireTime === undefined) {
                return [false, "Target expireTime is expected to be set"];
            }
            if (friendCertConstraintValues.expireTime > targetMaxExpireTime) {
                return [false, `Target (license) expireTime (${friendCertConstraintValues.expireTime}) cannot be greater than friendCert.targetMaxExpireTime (${targetMaxExpireTime})`];
            }
        }

        const targetType = this.getTargetType();
        if (targetType) {
            const modelType = friendCertConstraintValues.modelType;
            if (!targetType.equals(modelType.slice(0, targetType.length))) {
                return [false, `Target type from cert does not match target model type: ${targetType.toString("hex")} to ${modelType.slice(0, targetType.length).toString("hex")}`];
            }
        }


        const constraints = this.getConstraints();
        if (constraints && friendCertConstraintValues.otherConstraints) {
            if (!constraints.equals(friendCertConstraintValues.otherConstraints)) {
                return [false, "Constraints of friend cert and other friend cert do not match"];
            }

            const calcedConstraints = this.calcConstraintsOnTarget(friendCertConstraintValues);
            if (!calcedConstraints || !constraints.equals(calcedConstraints)) {
                return [false, "Calculated constraints of friend cert and other friend cert do not match"];
            }
        }

        return [true, ""];
    }

    /**
     * Calculate constraints hash on the values given.
     * The two friend certs paired must come to the same constraints hash to be compatible,
     * that is why keys are ordered and both sides need access to both secret keys.
     * The property targetType and the lock flags must be the same in both certs.
     */
    public calcConstraintsOnTarget(friendCertConstraintValues: FriendCertConstraintValues): Buffer | undefined {
        const values: (Buffer | number | undefined)[] = [];

        let pubKeyLow: Buffer | undefined;
        let pubKeyHigh: Buffer | undefined;
        let keyLow: Buffer | undefined;
        let keyHigh: Buffer | undefined;

        if (friendCertConstraintValues.publicKey.compare(friendCertConstraintValues.otherIssuerPublicKey) >= 0) {
            pubKeyHigh = friendCertConstraintValues.publicKey;
            pubKeyLow = friendCertConstraintValues.otherIssuerPublicKey;
        }
        else {
            pubKeyHigh = friendCertConstraintValues.otherIssuerPublicKey;
            pubKeyLow = friendCertConstraintValues.publicKey;
        }

        if (friendCertConstraintValues.key.compare(friendCertConstraintValues.otherKey) >= 0) {
            keyHigh = friendCertConstraintValues.key;
            keyLow = friendCertConstraintValues.otherKey;
        }
        else {
            keyHigh = friendCertConstraintValues.otherKey;
            keyLow = friendCertConstraintValues.key;
        }

        values.push(pubKeyLow, pubKeyHigh, this.getTargetType(), keyLow, keyHigh);

        if (this.isLockedOnLevel()) {
            values.push(friendCertConstraintValues.friendLevel);
        }
        else {
            values.push(undefined);
        }

        if (this.isLockedOnIntermediary()) {
            values.push(friendCertConstraintValues.intermediaryPublicKey);
        }
        else {
            values.push(undefined);
        }

        return Hash(values);
    }

    /**
     * Lock the cert on the intermediary key.
     * @param locked
     */
    public setLockedOnIntermediary(locked: boolean = true) {
        this.setLockedConfigBit(FriendCertLockedConfig.IS_LOCKED_ON_INTERMEDIARY, locked);
    }

    /**
     * @returns true if this cert is locked on the intermediary key.
     */
    public isLockedOnIntermediary(): boolean | undefined {
        return this.isLockedConfigBitSet(FriendCertLockedConfig.IS_LOCKED_ON_INTERMEDIARY);
    }

    /**
     * Set to lock this cert on the friendship level set.
     * @param locked
     */
    public setLockedOnLevel(locked: boolean = true) {
        this.setLockedConfigBit(FriendCertLockedConfig.IS_LOCKED_ON_LEVEL, locked);
    }

    /**
     * @returns true if this cert is locked on the friendship level.
     */
    public isLockedOnLevel(): boolean | undefined {
        return this.isLockedConfigBitSet(FriendCertLockedConfig.IS_LOCKED_ON_LEVEL);
    }

    /**
     * Get all properties of the cert.
     * @returns all properties of the cert.
     */
    public getParams(): FriendCertParams {
        const key = this.getKey();
        const isLockedOnIntermediary = this.isLockedOnIntermediary();
        const isLockedOnLevel = this.isLockedOnLevel();

        return {
            ...super.getParams(),
            key,
            isLockedOnIntermediary,
            isLockedOnLevel,
        };
    }

    /**
     * Populate the cert.
     * @param params all properties of the cert.
     */
    public setParams(params: FriendCertParams) {
        super.setParams(params);

        if (params.key !== undefined) {
            this.setKey(params.key);
        }

        if (params.isLockedOnIntermediary !== undefined) {
            this.setLockedOnIntermediary(params.isLockedOnIntermediary);
        }

        if (params.isLockedOnLevel !== undefined) {
            this.setLockedOnLevel(params.isLockedOnLevel);
        }
    }

    public getAchillesHashes(): Buffer[] {
        const hashes = super.getAchillesHashes();

        const key = this.getKey();

        // Note that a friend cert is not allowed to be indestructible.
        //
        if (key) {
            // This hash lets the owner destroy all their friend certs for the specific key.
            //
            const innerHash = Hash([SPECIAL_NODES.DESTROY_FRIEND_CERT,
                this.getOwner(), key]);

            hashes.push(Hash([SPECIAL_NODES.DESTROY_FRIEND_CERT,
                this.getOwner(), innerHash]));
        }

        return hashes;
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
            name: "FriendCert",
            type: this.getType(),
            "id1": this.calcId1(),
        };
        fields.forEach( fieldName => {
            o[fieldName] = this.model.getAny(fieldName);
        });

        return JSON.stringify(ToJSONObject(o), null, 4);
    }
}
