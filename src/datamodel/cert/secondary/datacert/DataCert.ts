import {
    PrimaryNodeCert,
} from "../../primary/nodecert/PrimaryNodeCert";

import {
    ModelType,
    Fields,
} from "../../../model";

import {
    DATACERT_TYPE,
    DataCertLockedConfig,
    DataCertParams,
} from "./types";

import {
    DataCertInterface,
    DataCertConstraintValues,
} from "../interface/DataCertInterface";

import {
    Hash,
} from "../../../hash";

import {
    StripObject,
} from "../../../../util/common";

/**
 * A data cert is used to sign Data nodes using a different key than the owner key.
 */
export class DataCert extends PrimaryNodeCert implements DataCertInterface {

    constructor(modelType?: ModelType, extraFields?: Fields) {
        const modelType2: Buffer = modelType ?? DATACERT_TYPE;
        super(modelType2, extraFields);
    }

    public static GetType(length?: number): Buffer {
        length = length ?? DATACERT_TYPE.length;
        return DATACERT_TYPE.slice(0, length);
    }

    public getType(length?: number): Buffer {
        length = length ?? DATACERT_TYPE.length;
        return DATACERT_TYPE.slice(0, length);
    }

    /**
     * Look at constraints flags and calculate hash on locked values in node and data object.
     */
    public calcConstraintsOnTarget(target: DataCertConstraintValues): Buffer {
        const hash = super.calcConstraintsOnTarget(target);
        const values: (Buffer | string | number | undefined)[] = [hash];

        if (this.isLockedOnDataConfig()) {
            values.push(target.dataConfig);
        }
        else {
            values.push(undefined);
        }

        if (this.isLockedOnContentType()) {
            values.push(target.contentType);
        }
        else {
            values.push(undefined);
        }

        if (this.isLockedOnUserBits()) {
            values.push(target.userConfig);
        }
        else {
            values.push(undefined);
        }

        return Hash(values);
    }

    public setLockedOnContentType(isLocked: boolean = true) {
        this.setLockedConfigBit(DataCertLockedConfig.IS_LOCKED_ON_CONTENTTYPE, isLocked);
    }

    public isLockedOnContentType(): boolean | undefined {
        return this.isLockedConfigBitSet(DataCertLockedConfig.IS_LOCKED_ON_CONTENTTYPE);
    }

    public setLockedOnUserBits(isLocked: boolean = true) {
        this.setLockedConfigBit(DataCertLockedConfig.IS_LOCKED_ON_USERBITS, isLocked);
    }

    public isLockedOnUserBits(): boolean | undefined {
        return this.isLockedConfigBitSet(DataCertLockedConfig.IS_LOCKED_ON_USERBITS);
    }

    public setLockedOnDataConfig(isLocked: boolean = true) {
        this.setLockedConfigBit(DataCertLockedConfig.IS_LOCKED_ON_DATACONFIG, isLocked);
    }

    public isLockedOnDataConfig(): boolean | undefined {
        return this.isLockedConfigBitSet(DataCertLockedConfig.IS_LOCKED_ON_DATACONFIG);
    }

    /**
     * Get all properties of the cert.
     * @returns all properties of the cert.
     */
    public getParams(): DataCertParams {
        const isLockedOnDataConfig = this.isLockedOnDataConfig();
        const isLockedOnContentType = this.isLockedOnContentType();
        const isLockedOnUserBits = this.isLockedOnUserBits();

        return {
            ...super.getParams(),
            isLockedOnDataConfig,
            isLockedOnContentType,
            isLockedOnUserBits,
        };
    }

    /**
     * Populate the cert.
     * @param params all properties of the cert.
     */
    public setParams(params: DataCertParams) {
        super.setParams(params);
        if (params.isLockedOnDataConfig !== undefined) {
            this.setLockedOnDataConfig(params.isLockedOnDataConfig);
        }
        if (params.isLockedOnContentType !== undefined) {
            this.setLockedOnContentType(params.isLockedOnContentType);
        }
        if (params.isLockedOnUserBits !== undefined) {
            this.setLockedOnUserBits(params.isLockedOnUserBits);
        }
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
            name: "DataCert",
            type: this.getType(),
            "id1": this.calcId1(),
        };
        fields.forEach( fieldName => {
            o[fieldName] = this.model.getAny(fieldName);
        });

        return JSON.stringify(StripObject(o), null, 4);
    }
}
