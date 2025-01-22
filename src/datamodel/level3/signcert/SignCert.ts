/**
 * At this level (3) a special type of BaseSignCert is deviated into a fully
 * specified SignCert.
 */

import {
    Fields,
    FieldType,
    UnpackSchema,
} from "../../PackSchema";

import {
    ParseRawOrSchema,
    ParseSchemaType,
} from "../../../util/SchemaUtil";

import {
    BaseSignCert,
    BaseSignCertSchema,
    ParseBaseSignCertSchema,
    BaseSignCertConfig,
    BaseSignCertType,
    TARGETMAXEXPIRETIME_INDEX,
    TARGETTYPE_INDEX,
    COUNTDOWN_INDEX,
} from "../../level2/basesigncert";

import {
    CONSTRAINTS_INDEX,
} from "../../level1/basecert";

import {
    MODELTYPE_INDEX,
    SIGNCERT_INDEX,
    SIGNCERT_TARGET_PUBLICKEYS_INDEX,
    SIGNCERT_THRESHOLD_INDEX,
    ConstraintsFieldsMapping,
    ConstraintsFlagsMapping,
} from "../../types";

import {
    HashConstraints,
    CertTargetsSchema,
} from "../../BaseModel";

import {
    SignCertInterface,
    SignCertProps,
    SignCertLockedConfig,
    SIGNCERTLOCKEDCONFIG_INDEX,
} from "./types";

function assert<T>(value: T, error: string): asserts value is NonNullable<T> {
    if (!value) {
        throw new Error(`Assertion error: ${error}`);
    }
}

export const SignCertType = [...BaseSignCertType, 1] as const;

export const SignCertTypeAlias = "SignCert";

export const SignCertSchema: Fields = {
    ...BaseSignCertSchema,
    modelType: {
        index: MODELTYPE_INDEX,
        type: FieldType.BYTE3,
        static: Buffer.from(SignCertType),
    },
    signCert: {
        index: SIGNCERT_INDEX,
        type: FieldType.SCHEMA,
        maxSize: 2048,
        schema: undefined,  // means same schema
    },
    countdown: {
        index: COUNTDOWN_INDEX,
        type: FieldType.UINT8,
    },
    lockedConfig: {
        index: SIGNCERTLOCKEDCONFIG_INDEX,
        type: FieldType.UINT48BE,
        required: true,
    },
    targetPublicKeys: {
        index: SIGNCERT_TARGET_PUBLICKEYS_INDEX,
        type: FieldType.SCHEMA,
        schema: CertTargetsSchema,
        maxSize: 5,
    },
    multisigThreshold: {
        index: SIGNCERT_THRESHOLD_INDEX,
        type: FieldType.UINT8,
    },
} as const;

export const ParseSignCertSchema: ParseSchemaType = {
    ...ParseBaseSignCertSchema,
    "signCert??": ParseRawOrSchema(),  // No arg means same schema
    "countdown??": 0,
    "lockedConfig??": 0,
    "targetPublicKeys??": ParseRawOrSchema([new Uint8Array(0)]),
    "multisigThreshold??": 0,
} as const;

export class SignCert extends BaseSignCert implements SignCertInterface {
    protected readonly fields = SignCertSchema;
    protected props?: SignCertProps;

    /**
     * @param packed
     */
    constructor(packed?: Buffer) {
        super(packed);
    }

    public static Is(modelType: Buffer | undefined): boolean {
        if (!modelType) {
            return false;
        }

        return modelType.equals(Buffer.from(SignCertType));
    }

    public getProps(): SignCertProps {
        return super.getProps();
    }

    public setProps(props: SignCertProps) {
        super.setProps(props);
    }

    public mergeProps(props: SignCertProps) {
        super.mergeProps(props);

        const props1 = this.getProps();

        for (const p in props) {
            // The keys of SignCertProps
            if (["signCert", "countdown", "lockedConfig", "targetPublicKeys", "multisigThreshold"].includes(p)) {
                //@ts-expect-error
                if (props[p] !== undefined) {
                    //@ts-expect-error
                    props1[p] = props[p];
                }
            }
        }
    }

    public validate(deepValidate: boolean = false,
        time?: number): [boolean, string]
    {
        assert(this.props, "Expected props to have been set");

        const validated = super.validate(deepValidate, time);

        if (!validated[0]) {
            return validated;
        }

        if (!this.props.targetPublicKeys?.length) {
            return [false,
                "Expected targetPublicKeys to have been set"];
        }

        const targetPublicKeys = this.loadTargetPublicKeys();

        if (targetPublicKeys.length > 5) {
            return [false, "Expected targetPublicKeys.length to be maximum five"];
        }

        if (targetPublicKeys.length > 1) {
            if (!this.props.multisigThreshold) {
                return [false,
                    "Expected multisigThreshold to have been set as there are multiple targetPublicKeys"];
            }

            if (this.props.multisigThreshold > 3) {
                return [false,
                    "Expected multisigThreshold to be less or equal than three"];
            }

            if (this.props.multisigThreshold > targetPublicKeys.length) {
                return [false,
                    "Expected multisigThreshold to be less or equal targetPublicKeys.length"];
            }
        }
        else {
            if (this.props.multisigThreshold !== undefined) {
                return [false,
                    "Expected multisigThreshold to not have been set as there is a single targetPublicKeys element"];
            }
        }

        if (deepValidate) {
            if (this.props.signCert) {
                let signCert;

                if (Buffer.isBuffer(this.props.signCert)) {
                    signCert = new SignCert(this.props.signCert);

                    signCert.unpack();
                }
                else {
                    signCert = new SignCert();

                    signCert.setProps(this.props.signCert);
                }

                const validated = signCert.validate(deepValidate, time);

                if (!validated[0]) {
                    return [false,
                        `Could not validate signCert: ${validated[1]}`];
                }

                const certProps = signCert.getProps();

                // When signing the cert we require countdown to be smaller.
                //
                if ((certProps.countdown ?? 0) <= (this.props.countdown ?? 0)) {
                    return [false,
                        "signCerts countdown must be greater than 0 and greater then certs countdown (if set)"];
                }

                const certConstraints = certProps.constraints;

                if (!certConstraints) {
                    return [false,
                        "signCert constraints must be set"];
                }

                const lockedConfig = certProps.lockedConfig ?? 0;

                const constraints =
                    this.hashConstraints(lockedConfig);

                if (!certConstraints.equals(constraints)) {
                    return [false,
                        "cert constraints do not match expected signCert constraints"];
                }
            }
        }

        return [true, ""];
    }

    public loadTargetPublicKeys(): Buffer[] {
        assert(this.props?.targetPublicKeys, "Expected props targetPublicKeys to have been set");

        if (Buffer.isBuffer(this.props.targetPublicKeys)) {
            const targetPublicKeys = UnpackSchema(this.props.targetPublicKeys,
                CertTargetsSchema) as Buffer[];

            this.props.targetPublicKeys = targetPublicKeys;
        }

        return this.props.targetPublicKeys;
    }

    /**
     * Calculate constraints on the cert bound to specific fields dictated by
     * the lockedConfig bits.
     *
     * All fields are hashed iteratively as their packed representions,
     * then all flags are hashed together with the hash of the fields.
     *
     * @param lockedConfig bit representation of fields to hash
     * @returns hash
     */
    public hashConstraints(lockedConfig: number): Buffer {
        assert(this.packed,
            "Expected to been packed before calling hashConstraints");

        assert(this.props,
            "Expected props to be set before calling hashConstraints");

        return HashConstraints(lockedConfig,
            this.packed,
            this.props,
            SignCertLockedConfigFieldsMapping,
            SignCertLockedConfigFlagsMapping,
            {
                // key matches in SignCertLockedConfigFlagsMapping
                //
                basesigncert: this.props.baseSignCertConfig ?? 0,
            }
        );
    }
}

/**
 * Map SignCertLockedConfig bits to corresponding field indexes.
 * Note that locked flags are not mapped here.
 */
export const SignCertLockedConfigFieldsMapping: ConstraintsFieldsMapping = {
    [SignCertLockedConfig.TargetType]: TARGETTYPE_INDEX,
    [SignCertLockedConfig.TargetPublicKeys]: SIGNCERT_TARGET_PUBLICKEYS_INDEX,
    [SignCertLockedConfig.MultisigThreshold]: SIGNCERT_THRESHOLD_INDEX,
    [SignCertLockedConfig.TargetMaxExpireTime]: TARGETMAXEXPIRETIME_INDEX,
    [SignCertLockedConfig.LockedConfig]: SIGNCERTLOCKEDCONFIG_INDEX,
    [SignCertLockedConfig.Constraints]: CONSTRAINTS_INDEX,
}

export const SignCertLockedConfigFlagsMapping: ConstraintsFlagsMapping = {
    [SignCertLockedConfig.IsIndestructible]: ["basesigncert", BaseSignCertConfig.IsIndestructible],
}
