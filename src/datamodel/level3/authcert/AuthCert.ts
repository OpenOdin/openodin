/**
 * At this level (3) a special type of BaseSignCert is deviated into a fully
 * specified AuthCert.
 *
 * The "constraints" field is undefined what it is for AuthCert,
 * it will depend on the environment targeted by "targetType".
 */

import {
    Fields,
    FieldType,
} from "../../PackSchema";

import {
    ParseRawOrSchema,
    ParseSchemaType,
} from "../../../util/SchemaUtil";

import {
    SignCert,
    ParseSignCertSchema,
} from "../signcert/SignCert";

import {
    SignCertInterface,
} from "../signcert/types";

import {
    BaseSignCert,
    BaseSignCertSchema,
    ParseBaseSignCertSchema,
    BaseSignCertConfig,
    BaseSignCertType,
    TARGETMAXEXPIRETIME_INDEX,
    TARGETTYPE_INDEX,
} from "../../level2/basesigncert";

import {
    CONSTRAINTS_INDEX,
} from "../../level1/basecert";

import {
    MODELTYPE_INDEX,
    SIGNCERT_INDEX,
    ConstraintsFieldsMapping,
    ConstraintsFlagsMapping,
} from "../../types";

import {
    HashConstraints,
} from "../../BaseModel";

import {
    AuthCertInterface,
    AuthCertProps,
    AuthCertLockedConfig,
    HANDSHAKEPUBLICKEY_INDEX,
    AUTHCERT_REGION_INDEX,
    AUTHCERT_JURISDICTION_INDEX,
} from "./types";

function assert<T>(value: T, error: string): asserts value is NonNullable<T> {
    if (!value) {
        throw new Error(`Assertion error: ${error}`);
    }
}

export const AuthCertType = [...BaseSignCertType, 2] as const;

export const AuthCertTypeAlias = "AuthCert";

export const AuthCertSchema: Fields = {
    ...BaseSignCertSchema,
    modelType: {
        index: MODELTYPE_INDEX,
        type: FieldType.BYTE3,
        static: Buffer.from(AuthCertType),
    },
    signCert: {
        index: SIGNCERT_INDEX,
        type: FieldType.SCHEMA,
        maxSize: 2048,
        schema: undefined,  // means same schema
    },
    handshakePublicKey: {
        index: HANDSHAKEPUBLICKEY_INDEX,
        type: FieldType.BYTES,
        maxSize: 32,
        required: true,
    },
    region: {
        index: AUTHCERT_REGION_INDEX,
        type: FieldType.STRING,
        maxSize: 2,
    },
    jurisdiction: {
        index: AUTHCERT_JURISDICTION_INDEX,
        type: FieldType.STRING,
        maxSize: 2,
    },
} as const;

export const ParseAuthCertSchema: ParseSchemaType = {
    ...ParseBaseSignCertSchema,
    "signCert??": ParseRawOrSchema(ParseSignCertSchema),
    "handshakePublicKey??": new Uint8Array(0),
    "region??": "",
    "jurisdiction??": "",
} as const;

export class AuthCert extends BaseSignCert implements AuthCertInterface {
    protected readonly fields = AuthCertSchema;
    protected props?: AuthCertProps;

    /**
     * @param packed
     */
    constructor(packed?: Buffer) {
        super(packed);
    }

    protected defaultProps(): AuthCertProps {
        const props = super.defaultProps() as AuthCertProps;

        props.targetType = Buffer.from([0, 0, 0]);

        return props;
    }

    public getProps(): AuthCertProps {
        return super.getProps();
    }

    public setProps(props: AuthCertProps) {
        super.setProps(props);
    }

    public mergeProps(props: AuthCertProps) {
        super.mergeProps(props);

        const props1 = this.getProps();

        for (const p in props) {
            // The keys of AuthCertProps
            if (["signCert", "handshakePublicKey", "region", "jurisdiction"].includes(p)) {
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

        return modelType.equals(Buffer.from(AuthCertType));
    }

    public validate(deepValidate: boolean = false,
        time?: number): [boolean, string]
    {
        assert(this.props, "Expected props to have been set");

        const validated = super.validate(deepValidate, time);

        if (!validated[0]) {
            return validated;
        }

        if (!this.props.handshakePublicKey?.length) {
            return [false,
                "Expected handshakePublicKey to have been set"];
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

    public loadSignCert(): SignCertInterface {
        assert(this.props?.signCert, "Expected signCert to have been set");

        if (Buffer.isBuffer(this.props.signCert)) {
            const signCert = new SignCert(this.props.signCert);

            signCert.unpack();

            this.props.signCert = signCert.getProps();

            return signCert;
        }
        else {
            const signCert = new SignCert();

            signCert.setProps(this.props.signCert);

            return signCert;
        }
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
            AuthCertLockedConfigFieldsMapping,
            AuthCertLockedConfigFlagsMapping,
            {
                // key matches in AuthCertLockedConfigFlagsMapping
                //
                basesigncert: this.props.baseSignCertConfig ?? 0,
            }
        );
    }
}

/**
 * Map AuthCertLockedConfig bits to corresponding field indexes.
 * Note that locked flags are not mapped here.
 */
export const AuthCertLockedConfigFieldsMapping: ConstraintsFieldsMapping = {
    [AuthCertLockedConfig.TargetType]: TARGETTYPE_INDEX,
    [AuthCertLockedConfig.HandshakePublicKey]: HANDSHAKEPUBLICKEY_INDEX,
    [AuthCertLockedConfig.TargetMaxExpireTime]: TARGETMAXEXPIRETIME_INDEX,
    [AuthCertLockedConfig.Constraints]: CONSTRAINTS_INDEX,
    [AuthCertLockedConfig.Region]: AUTHCERT_REGION_INDEX,
    [AuthCertLockedConfig.Jurisdiction]: AUTHCERT_JURISDICTION_INDEX,
}

export const AuthCertLockedConfigFlagsMapping: ConstraintsFlagsMapping = {
    [AuthCertLockedConfig.IsIndestructible]: ["basesigncert", BaseSignCertConfig.IsIndestructible],
}
