/**
 * At this level (2) a cert is specialized further into becoming a special
 * type of cert, a BaseSignCert.
 */

import {
    Fields,
    FieldType,
} from "../../PackSchema";

import {
    ParseSchemaType,
} from "../../../util/SchemaUtil";

import {
    IS_BIT_SET,
    SET_BIT,
} from "../../BaseModel";

import {
    BaseCert,
    BaseCertSchema,
    ParseBaseCertSchema,
    BaseCertType,
} from "../../level1/basecert";

import {
    MODELTYPE_INDEX,
} from "../../types";

import {
    BaseSignCertInterface,
    BaseSignCertProps,
    BaseSignCertFlags,
    BaseSignCertConfig,
    TARGETMAXEXPIRETIME_INDEX,
    BASESIGNCERTCONFIG_INDEX,
    TARGETTYPE_INDEX,
} from "./types";

function assert<T>(value: T, error: string): asserts value is NonNullable<T> {
    if (!value) {
        throw new Error(`Assertion error: ${error}`);
    }
}

export const BaseSignCertType = [...BaseCertType, 1] as const;

export const BaseSignCertSchema: Fields = {
    ...BaseCertSchema,
    modelType: {
        index: MODELTYPE_INDEX,
        type: FieldType.BYTE3,
        static: Buffer.from(BaseSignCertType),
        staticPrefix: true,
    },
    targetMaxExpireTime: {
        index: TARGETMAXEXPIRETIME_INDEX,
        type: FieldType.UINT48BE,
    },
    // modelType of model must match targetType.
    targetType: {
        index: TARGETTYPE_INDEX,
        type: FieldType.BYTE3,
        required: true,
    },
    baseSignCertConfig: {
        index: BASESIGNCERTCONFIG_INDEX,
        type: FieldType.UINT8,
    },
} as const;

export const ParseBaseSignCertSchema: ParseSchemaType = {
    ...ParseBaseCertSchema,
    "targetMaxExpireTime??": 0,
    "targetType??": new Uint8Array(0),
    "baseSignCertConfig??": 0,
    "isIndestructible??": false,
} as const;

export class BaseSignCert extends BaseCert implements BaseSignCertInterface {
    protected readonly fields = BaseSignCertSchema;
    protected props?: BaseSignCertProps;

    /**
     * @param packed
     */
    constructor(packed?: Buffer) {
        super(packed);
    }

    public getProps(): BaseSignCertProps {
        return super.getProps();
    }

    public setProps(props: BaseSignCertProps) {
        super.setProps(props);
    }

    public mergeProps(props: BaseSignCertProps) {
        super.mergeProps(props);

        const props1 = this.getProps();

        for (const p in props) {
            // The keys of BaseSignCertProps
            if (["signCert", "targetMaxExpireTime", "targetType", "baseSignCertConfig"].includes(p)) {
                //@ts-expect-error
                if (props[p] !== undefined) {
                    //@ts-expect-error
                    props1[p] = props[p];
                }
            }
        }
    }

    public static Is(modelType: Buffer | undefined): boolean {
        if (!modelType) {
            return false;
        }

        return modelType.slice(0, BaseSignCertType.length).equals(Buffer.from(BaseSignCertType));
    }

    public getAchillesHashes(): Buffer[] {
        assert(this.props, "Expected props to have been set");

        const hashes: Buffer[] = [];

        const flags = this.loadFlags();

        if (!flags.isIndestructible) {
            hashes.push(...super.getAchillesHashes());
        }

        if (this.props.signCert) {
            const signCert = this.loadSignCert();

            hashes.push(...signCert.getAchillesHashes());
        }

        return hashes;
    }

    public validate(deepValidate: boolean = false,
        time?: number): [boolean, string]
    {
        assert(this.props, "Expected props to have been set");

        const validated = super.validate(deepValidate, time);

        if (!validated[0]) {
            return validated;
        }

        if (this.props.targetType === undefined) {
            return [false, "targetType must be set in cert"];
        }

        if (deepValidate) {
            if (this.props.signCert) {
                const signCert = this.loadSignCert();

                const validated = signCert.validate(deepValidate, time);

                if (!validated[0]) {
                    return [false,
                        `Could not validate signCert: ${validated[1]}`];
                }

                const certProps = signCert.getProps();

                const targetType = certProps.targetType;

                if (targetType) {
                    if (this.props.modelType === undefined) {
                        return [false, "Expected modelType to be set"];
                    }

                    if (!targetType.equals(this.props.modelType)) {
                        return [false,
                            "cert targetType must match the top cert's modelType"];
                    }
                }

                const owner = certProps.owner;

                if (owner === undefined) {
                    return [false, "Expected cert owner to be set"];
                }

                if (this.props.owner === undefined) {
                    return [false, "Expected cert owner to be set"];
                }

                if (!this.props.owner.equals(owner)) {
                    return [false,
                        "top cert owner public key must match cert owner public key"];
                }

                const certCreationTime = certProps.creationTime;

                const certExpireTime = certProps.expireTime;

                if (certCreationTime === undefined ||
                    certExpireTime === undefined)
                {
                    return [false, "Missing creationTime/expireTime in cert"];
                }

                const expireTime = this.props.expireTime;

                const creationTime = this.props.creationTime;

                if (creationTime === undefined) {
                    return [false, "creationTime must be set in cert"];
                }

                if (expireTime === undefined) {
                    return [false, "expireTime must be set in cert"];
                }

                // Check so that the topCert is not created before the
                // signCert's fromTime.
                //
                if (creationTime < certCreationTime) {
                    return [false,
                        "cert cannot be created before the signCerts creationTime"];
                }

                if (creationTime > certExpireTime) {
                    return [false,
                        "cert cannot be created after the signCerts expireTime"];
                }

                // Check the maximum allowed expire time.
                //
                if (certProps.targetMaxExpireTime !== undefined) {
                    if (this.props.targetMaxExpireTime === undefined) {
                        return [false, "cert must have targetMaxExpireTime set if signCert has"];
                    }

                    if (this.props.targetMaxExpireTime > certProps.targetMaxExpireTime) {
                        return [false,
                            "cert cannot have larger targetMaxExpireTime than signCert has"];
                    }

                    if (expireTime > certProps.targetMaxExpireTime) {
                        return [false,
                            "cert cannot expire after signCerts targetMaxExpireTime"];
                    }
                }
            }
        }

        return [true, ""];
    }

    public loadSignCert(): BaseSignCertInterface {
        assert(this.props?.signCert, "Expected signCert to have been set");

        if (Buffer.isBuffer(this.props.signCert)) {
            const signCert = new BaseSignCert(this.props.signCert);

            signCert.unpack();

            // Note we do not store back props as we have only loaded a level 2 cert.

            return signCert;
        }
        else {
            const signCert = new BaseSignCert();

            signCert.setProps(this.props.signCert);

            return signCert;
        }
    }

    /**
     * Load config flags from config numbers and return.
     */
    public loadFlags(): BaseSignCertFlags {
        assert(this.props, "Expected props to have been set");

        const flags = super.loadFlags();

        LoadBaseSignCertConfigFlags(this.props.baseSignCertConfig ?? 0, flags);

        return flags;
    }

    /**
     * Store back modified flags.
     */
    public storeFlags(baseSignCertFlags: BaseSignCertFlags) {
        assert(this.props, "Expected props to have been set");

        super.storeFlags(baseSignCertFlags);

        this.props.baseSignCertConfig = BaseSignCertFlagsToConfig(baseSignCertFlags, this.props.baseSignCertConfig ?? 0);
    }
}

function LoadBaseSignCertConfigFlags(baseSignCertConfig: number, flags: BaseSignCertFlags) {
    flags.isIndestructible =
        IS_BIT_SET(baseSignCertConfig, BaseSignCertConfig.IsIndestructible);
}

function BaseSignCertFlagsToConfig(flags: BaseSignCertFlags, baseSignCertConfig: number = 0): number {
    if (flags.isIndestructible !== undefined) {
        baseSignCertConfig =
            SET_BIT(baseSignCertConfig, BaseSignCertConfig.IsIndestructible,
                flags.isIndestructible);
    }

    return baseSignCertConfig;
}
