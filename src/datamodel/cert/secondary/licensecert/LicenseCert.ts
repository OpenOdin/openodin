import {
    ModelType,
    Fields,
    FieldType,
} from "../../../model";

import {
    LICENSECERT_TYPE,
    LicenseCertLockedConfig,
    LicenseCertParams,
} from "./types";

import {
    LicenseCertInterface,
    LicenseCertConstraintValues,
} from "../interface/LicenseCertInterface";

import {
    PrimaryNodeCert,
} from "../../primary/nodecert/PrimaryNodeCert";

import {
    Hash,
} from "../../../hash";

import {
    ToJSONObject,
} from "../../../../util/SchemaUtil";

/** The added fields for LicenseCert. */
const FIELDS: Fields = {
    maxExtensions: {
        name: "maxExtensions",
        type: FieldType.UINT8,
        index: 30,
    },
}

/**
 * A license cert is used to sign License nodes using a different key than the owner key.
 */
export class LicenseCert extends PrimaryNodeCert implements LicenseCertInterface {
    constructor(modelType?: ModelType, extraFields?: Fields) {
        extraFields = extraFields ?? {};
        const fields = {...FIELDS, ...extraFields};
        const modelType2: Buffer = modelType ?? LICENSECERT_TYPE;
        super(modelType2, fields);
    }

    public static GetType(length?: number): Buffer {
        length = length ?? LICENSECERT_TYPE.length;
        return LICENSECERT_TYPE.slice(0, length);
    }

    public getType(length?: number): Buffer {
        length = length ?? LICENSECERT_TYPE.length;
        return LICENSECERT_TYPE.slice(0, length);
    }

    public validateAgainstTarget(target: LicenseCertConstraintValues): [boolean, string] {
        const val = super.validateAgainstTarget(target);
        if (!val[0]) {
            return val;
        }

        const maxExtensions = this.getMaxExtensions();
        const nodeMaxExtensions = target.extensions;
        if (maxExtensions !== undefined && nodeMaxExtensions !== undefined) {
            if (nodeMaxExtensions > maxExtensions) {
                return [false, "Cert does not allow the nr of extensions the license allocates for"];
            }
        }

        return [true, ""];
    }

    /**
     * Look at constraints flags and calculate hash on locked values in node and license object.
     */
    public calcConstraintsOnTarget(target: LicenseCertConstraintValues): Buffer {
        const hash = super.calcConstraintsOnTarget(target);
        const values: (string | Buffer | number | undefined)[] = [hash];

        if (this.isLockedOnLicenseTargetPublicKey()) {
            values.push(target.targetPublicKey);
        }
        else {
            values.push(undefined);
        }

        if (this.isLockedOnLicenseConfig()) {
            values.push(target.licenseConfig);
        }
        else {
            values.push(undefined);
        }

        if (this.isLockedOnTerms()) {
            values.push(target.terms);
        }
        else {
            values.push(undefined);
        }

        if (this.isLockedOnExtensions()) {
            values.push(target.extensions);
        }
        else {
            values.push(undefined);
        }

        if (this.isLockedOnFriendLevel()) {
            values.push(target.friendLevel);
        }
        else {
            values.push(undefined);
        }

        if (this.isLockedOnMaxExtensions()) {
            values.push(this.getMaxExtensions());
        }
        else {
            values.push(undefined);
        }

        return Hash(values);
    }

    public getMaxExtensions(): number | undefined {
        return this.model.getNumber("maxExtensions");
    }

    public setMaxExtensions(maxExtensions: number | undefined) {
        this.model.setNumber("maxExtensions", maxExtensions);
    }

    /**
     * Lock so Licenses must always be towards the same target public key.
     */
    public setLockedOnLicenseTargetPublicKey(isLocked: boolean = true) {
        this.setLockedConfigBit(LicenseCertLockedConfig.IS_LOCKED_ON_LICENSETARGETPUBLICKEY, isLocked);
    }

    public isLockedOnLicenseTargetPublicKey(): boolean | undefined {
        return this.isLockedConfigBitSet(LicenseCertLockedConfig.IS_LOCKED_ON_LICENSETARGETPUBLICKEY);
    }

    public setLockedOnLicenseConfig(isLocked: boolean = true) {
        this.setLockedConfigBit(LicenseCertLockedConfig.IS_LOCKED_ON_LICENSECONFIG, isLocked);
    }

    public isLockedOnLicenseConfig(): boolean | undefined {
        return this.isLockedConfigBitSet(LicenseCertLockedConfig.IS_LOCKED_ON_LICENSECONFIG);
    }

    public setLockedOnTerms(isLocked: boolean = true) {
        this.setLockedConfigBit(LicenseCertLockedConfig.IS_LOCKED_ON_TERMS, isLocked);
    }

    public isLockedOnTerms(): boolean | undefined {
        return this.isLockedConfigBitSet(LicenseCertLockedConfig.IS_LOCKED_ON_TERMS);
    }

    public setLockedOnExtensions(isLocked: boolean = true) {
        this.setLockedConfigBit(LicenseCertLockedConfig.IS_LOCKED_ON_EXTENSIONS, isLocked);
    }

    public isLockedOnExtensions(): boolean | undefined {
        return this.isLockedConfigBitSet(LicenseCertLockedConfig.IS_LOCKED_ON_EXTENSIONS);
    }

    public setLockedOnFriendLevel(isLocked: boolean = true) {
        this.setLockedConfigBit(LicenseCertLockedConfig.IS_LOCKED_ON_FRIENDLEVEL, isLocked);
    }

    public isLockedOnFriendLevel(): boolean | undefined {
        return this.isLockedConfigBitSet(LicenseCertLockedConfig.IS_LOCKED_ON_FRIENDLEVEL);
    }

    public setLockedOnMaxExtensions(isLocked: boolean = true) {
        this.setLockedConfigBit(LicenseCertLockedConfig.IS_LOCKED_ON_MAXEXTENSIONS, isLocked);
    }

    public isLockedOnMaxExtensions(): boolean | undefined {
        return this.isLockedConfigBitSet(LicenseCertLockedConfig.IS_LOCKED_ON_MAXEXTENSIONS);
    }

    /**
     * Get all properties of the cert.
     * @returns all properties of the cert.
     */
    public getParams(): LicenseCertParams {
        const maxExtensions = this.getMaxExtensions();
        const isLockedOnLicenseTargetPublicKey = this.isLockedOnLicenseTargetPublicKey();
        const isLockedOnLicenseConfig = this.isLockedOnLicenseConfig();
        const isLockedOnTerms = this.isLockedOnTerms();
        const isLockedOnExtensions = this.isLockedOnExtensions();
        const isLockedOnFriendLevel = this.isLockedOnFriendLevel();
        const isLockedOnMaxExtensions = this.isLockedOnMaxExtensions();

        return {
            ...super.getParams(),
            maxExtensions,
            isLockedOnLicenseTargetPublicKey,
            isLockedOnLicenseConfig,
            isLockedOnTerms,
            isLockedOnExtensions,
            isLockedOnFriendLevel,
            isLockedOnMaxExtensions,
        };
    }

    /**
     * Populate the cert.
     * @param params all properties of the cert.
     */
    public setParams(params: LicenseCertParams) {
        super.setParams(params);
        if (params.maxExtensions !== undefined) {
            this.setMaxExtensions(params.maxExtensions);
        }
        if (params.isLockedOnLicenseTargetPublicKey !== undefined) {
            this.setLockedOnLicenseTargetPublicKey(params.isLockedOnLicenseTargetPublicKey);
        }
        if (params.isLockedOnLicenseConfig !== undefined) {
            this.setLockedOnLicenseConfig(params.isLockedOnLicenseConfig);
        }
        if (params.isLockedOnTerms !== undefined) {
            this.setLockedOnTerms(params.isLockedOnTerms);
        }
        if (params.isLockedOnExtensions !== undefined) {
            this.setLockedOnExtensions(params.isLockedOnExtensions);
        }
        if (params.isLockedOnFriendLevel !== undefined) {
            this.setLockedOnFriendLevel(params.isLockedOnFriendLevel);
        }
        if (params.isLockedOnMaxExtensions !== undefined) {
            this.setLockedOnMaxExtensions(params.isLockedOnMaxExtensions);
        }
    }

    public toString(short: boolean = false): string {
        const shortFields = ["owner", "targetPublicKeys", "creationTimeSeconds",
            "expireTimeSeconds", "constraints", "targetType", "maxChainLength", "targetMaxExpireTimeSeconds",
            "multiSigThreshold", "maxExtensions"];

        const longFields = ["owner", "targetPublicKeys", "config", "lockedConfig", "creationTimeSeconds",
            "expireTimeSeconds", "constraints", "targetType", "maxChainLength", "targetMaxExpireTimeSeconds",
            "transientConfig", "multiSigThreshold", "maxExtensions"];

        const fields = short ? shortFields : longFields;

        const o: any = {
            name: "LicenseCert",
            type: this.getType(),
            "id1": this.calcId1(),
        };
        fields.forEach( fieldName => {
            o[fieldName] = this.model.getAny(fieldName);
        });

        return JSON.stringify(ToJSONObject(o), null, 4);
    }
}
