/**
 * At this level (3) a BaseCarrierNode is specialized into a CarrierNode.
 * A CarrierNode can be signed and packed.
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
    CarrierNodeInterface,
    CarrierNodeProps,
    CarrierNodeLockedConfig,
    EMBEDDED_AUTHCERT_INDEX,
    EMBEDDED_FRIENDCERT_INDEX,
} from "./types";

import {
    PARENTID_INDEX,
    REFID_INDEX,
    REGION_INDEX,
    JURISDICTION_INDEX,
    LICENSEMINDISTANCE_INDEX,
    LICENSEMAXDISTANCE_INDEX,
    DIFFICULTY_INDEX,
    DIFFICULTY_NONCE_INDEX,
    BASENODECONFIG_INDEX,
    BaseNodeConfig,
} from "../../level1/basenode/types";

import {
    BaseCarrierNode,
    BaseCarrierNodeSchema,
    ParseBaseCarrierNodeSchema,
    BaseCarrierNodeType,
    INFOFIELD_INDEX,
} from "../../level2/basecarriernode";

import {
    MODELTYPE_INDEX,
    ConstraintsFlagsMapping,
    ConstraintsFieldsMapping,
} from "../../types";

import {
    HashConstraints,
    SET_BIT,
} from "../../BaseModel";

import {
    AuthCertInterface,
} from "../authcert/types";

import {
    AuthCert,
    AuthCertSchema,
    ParseAuthCertSchema,
} from "../authcert/AuthCert";

import {
    FriendCertInterface,
} from "../friendcert/types";

import {
    FriendCert,
    FriendCertSchema,
    ParseFriendCertSchema,
} from "../friendcert/FriendCert";


function assert<T>(value: T, error: string): asserts value is NonNullable<T> {
    if (!value) {
        throw new Error(`Assertion error: ${error}`);
    }
}

export const CarrierNodeType = [...BaseCarrierNodeType, 1] as const;

export const CarrierNodeTypeAlias = "CarrierNode";

export const CarrierNodeSchema: Fields = {
    ...BaseCarrierNodeSchema,
    modelType: {
        index: MODELTYPE_INDEX,
        type: FieldType.BYTE3,
        static: Buffer.from(CarrierNodeType),
    },
    authCert: {
        index: EMBEDDED_AUTHCERT_INDEX,
        type: FieldType.SCHEMA,
        maxSize: 8192,
        schema: AuthCertSchema,
    },
    friendCert: {
        index: EMBEDDED_FRIENDCERT_INDEX,
        type: FieldType.SCHEMA,
        maxSize: 8192,
        schema: FriendCertSchema,
    },
    difficulty: {
        index: DIFFICULTY_INDEX,
        type: FieldType.UINT8,
    },
    difficultyNonce: {
        index: DIFFICULTY_NONCE_INDEX,
        type: FieldType.BYTE8,
    },
} as const;

export const ParseCarrierNodeSchema: ParseSchemaType = {
    ...ParseBaseCarrierNodeSchema,
    "authCert??": ParseRawOrSchema(ParseAuthCertSchema),
    "friendCert??": ParseRawOrSchema(ParseFriendCertSchema),
    "difficulty??": 0,
    "difficultyNonce??": new Uint8Array(0),
} as const;

/**
 * CarrierNode implementation.
 */
export class CarrierNode extends BaseCarrierNode implements CarrierNodeInterface {
    protected readonly fields = CarrierNodeSchema;
    protected props?: CarrierNodeProps;

    public static Is(modelType: Buffer | undefined): boolean {
        if (!modelType) {
            return false;
        }

        return modelType.equals(Buffer.from(CarrierNodeType));
    }

    public getProps(): CarrierNodeProps {
        return super.getProps();
    }

    public setProps(props: CarrierNodeProps) {
        super.setProps(props);
    }

    public mergeProps(props: CarrierNodeProps) {
        super.mergeProps(props);

        const props1 = this.getProps();

        for (const p in props) {
            // The keys of CarrierNodeProps
            if (["authCert", "friendCert"].includes(p)) {
                //@ts-expect-error
                if (props[p] !== undefined) {
                    //@ts-expect-error
                    props1[p] = props[p];
                }
            }
        }
    }

    protected defaultProps(): CarrierNodeProps {
        const defaultProps = super.defaultProps() as CarrierNodeProps;

        let baseNodeConfig = 0;

        baseNodeConfig =
            SET_BIT(baseNodeConfig, BaseNodeConfig.IsLeaf, true);

        baseNodeConfig =
            SET_BIT(baseNodeConfig, BaseNodeConfig.IsUnique, true);

        defaultProps.baseNodeConfig = baseNodeConfig;

        return defaultProps;
    }

    public validate(deepValidate: boolean = false,
        time?: number): [boolean, string]
    {
        assert(this.props, "Expected props to have been set");

        const validated = super.validate(deepValidate, time);

        if (!validated[0]) {
            return validated;
        }

        const flags = this.loadFlags();

        if (!flags.isLeaf) {
            return [false,
                "CarrierNodes nodes are required to be leaf nodes"];
        }

        if (!flags.isUnique) {
            return [false,
                "Carrier nodes are required to be flagged as unique"];
        }

        if (flags.isIndestructible) {
            return [false,
                "Carrier nodes cannot be flagged as indestructable"];
        }

        if (deepValidate) {
            if (this.props.authCert) {
                const instance = this.loadAuthCert();

                const validated = instance.validate(deepValidate, time);

                if (!validated[0]) {
                    return [false,
                        `Could not validate AuthCert: ${validated[1]}`];
                }

                //TODO: check expire time, etc
            }

            if (this.props.friendCert) {
                const instance = this.loadFriendCert();

                const validated = instance.validate(deepValidate, time);

                if (!validated[0]) {
                    return [false,
                        `Could not validate FriendCert: ${validated[1]}`];
                }

                const certOwner = instance.getProps().owner;

                if (!certOwner?.equals(this.props.owner!)) {
                    return [false, "CarrierNode can only carry friend certs of same owner"];
                }

                //TODO: check expire time, etc
            }
        }

        return [true, ""];
    }

    /**
     * Return auth cert object class instance as interface.
     *
     * @returns authCert interface
     * @throws if no authCert prop is set or on failure decoding authCert data
     */
    public loadAuthCert(): AuthCertInterface {
        assert(this.props?.authCert, "Expected authCert prop to have been set");

        if (Buffer.isBuffer(this.props.authCert)) {
            const instance = new AuthCert(this.props.authCert);

            instance.unpack();

            this.props.authCert = instance.getProps();

            return instance;
        }
        else {
            const instance = new AuthCert();

            instance.setProps(this.props.authCert)

            return instance;
        }
    }

    /**
     * Return friend cert object class instance as interface.
     *
     * @returns friendCert interface
     * @throws if no friendCert prop is set or on failure decoding friendCert data
     */
    public loadFriendCert(): FriendCertInterface {
        assert(this.props?.friendCert, "Expected friendCert prop to have been set");

        if (Buffer.isBuffer(this.props.friendCert)) {
            const instance = new FriendCert(this.props.friendCert);

            instance.unpack();

            this.props.friendCert = instance.getProps();

            return instance;
        }
        else {
            const instance = new FriendCert();

            instance.setProps(this.props.friendCert)

            instance.pack();

            return instance;
        }
    }

    public getAchillesHashes(): Buffer[] {
        assert(this.props, "Expected props to have been set");

        const owner = this.props.owner;

        assert(owner, "Expected owner to have been set");

        const hashes = super.getAchillesHashes();

        if (this.props.authCert) {
            const instance = this.loadAuthCert();

            hashes.push(...instance.getAchillesHashes());
        }

        if (this.props.friendCert) {
            const instance = this.loadFriendCert();

            instance.pack();

            hashes.push(...instance.getAchillesHashes());
        }

        return hashes;
    }

    /**
     * Calculate constraints on the node bound to specific fields dictated by
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
            CarrierNodeLockedConfigFieldsMapping,
            CarrierNodeLockedConfigFlagsMapping,
            {
                basenode: this.props.baseNodeConfig ?? 0,
            }
        );
    }
}

/**
 * Map CarrierNodeLockedConfig bits to corresponding field indexes.
 * Note that locked flags are not mapped here.
 */
export const CarrierNodeLockedConfigFieldsMapping: ConstraintsFieldsMapping = {
    [CarrierNodeLockedConfig.ParentId]: PARENTID_INDEX,
    [CarrierNodeLockedConfig.RefId]: REFID_INDEX,
    [CarrierNodeLockedConfig.Region]: REGION_INDEX,
    [CarrierNodeLockedConfig.Jurisdiction]: JURISDICTION_INDEX,
    [CarrierNodeLockedConfig.LicenseMinDistance]: LICENSEMINDISTANCE_INDEX,
    [CarrierNodeLockedConfig.LicenseMaxDistance]: LICENSEMAXDISTANCE_INDEX,
    [CarrierNodeLockedConfig.Difficulty]: DIFFICULTY_INDEX,
    [CarrierNodeLockedConfig.Info]: INFOFIELD_INDEX,
    [CarrierNodeLockedConfig.AuthCert]: EMBEDDED_AUTHCERT_INDEX,
    [CarrierNodeLockedConfig.FriendCert]: EMBEDDED_FRIENDCERT_INDEX,
    [CarrierNodeLockedConfig.BaseNodeConfig]: BASENODECONFIG_INDEX,
}

export const CarrierNodeLockedConfigFlagsMapping: ConstraintsFlagsMapping = {
    [CarrierNodeLockedConfig.IsPublic]: ["basenode", BaseNodeConfig.IsPublic],

    [CarrierNodeLockedConfig.IsLicensed]: ["basenode", BaseNodeConfig.IsLicensed],

    [CarrierNodeLockedConfig.IsUnique]: ["basenode", BaseNodeConfig.IsUnique],

    [CarrierNodeLockedConfig.IsIndestructible]: ["basenode",
        BaseNodeConfig.IsIndestructible],

    [CarrierNodeLockedConfig.HasRightsByAssociation]: ["basenode",
        BaseNodeConfig.HasRightsByAssociation],

    [CarrierNodeLockedConfig.DisallowParentLicensing]: ["basenode",
        BaseNodeConfig.DisallowParentLicensing],
}
