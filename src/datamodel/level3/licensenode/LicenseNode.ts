/**
 * At this level (3) a BaseLicenseNode is specialized into a LicenseNode.
 * A LicenseNode can be signed and packed.
 */

import {
    Fields,
    FieldType,
    FieldIterator,
} from "../../PackSchema";

import {
    ParseRawOrSchema,
    ParseSchemaType,
} from "../../../util/SchemaUtil";

import {
    LicenseNodeInterface,
    LicenseNodeProps,
    LicenseNodeLockedConfig,
    EMBEDDED_LICENSE_INDEX,
    LICENSEFRIENDLEVEL_INDEX,
    FRIENDCERT1_INDEX,
    FRIENDCERT2_INDEX,
} from "./types";

import {
    PARENTID_INDEX,
    REFID_INDEX,
    REGION_INDEX,
    JURISDICTION_INDEX,
    BASENODECONFIG_INDEX,
    DIFFICULTY_INDEX,
    DIFFICULTY_NONCE_INDEX,
    BaseNodeConfig,
} from "../../level1/basenode/types";
import {
    BaseLicenseNode,
    BaseLicenseNodeSchema,
    ParseBaseLicenseNodeSchema,
    BaseLicenseNodeType,
    BaseLicenseNodeConfig,
    TARGETPUBLICKEY_INDEX,
    TERMS_INDEX,
    EXTENSIONS_INDEX,
    BASELICENSENODECONFIG_INDEX,
} from "../../level2/baselicensenode";

import {
    MODELTYPE_INDEX,
    OWNER_INDEX,
    ConstraintsFlagsMapping,
    ConstraintsFieldsMapping,
} from "../../types";

import {
    CopyBuf,
    HashConstraints,
} from "../../BaseModel";

import {
    FriendCertSchema,
    FriendCert,
    ParseFriendCertSchema,
} from "../friendcert/FriendCert";

import {
    FriendCertInterface,
} from "../friendcert/types";

function assert<T>(value: T, error: string): asserts value is NonNullable<T> {
    if (!value) {
        throw new Error(`Assertion error: ${error}`);
    }
}

export const LicenseNodeType = [...BaseLicenseNodeType, 1] as const;

export const LicenseNodeTypeAlias = "LicenseNode";

export const LicenseNodeSchema: Fields = {
    ...BaseLicenseNodeSchema,
    modelType: {
        index: MODELTYPE_INDEX,
        type: FieldType.BYTE3,
        static: Buffer.from(LicenseNodeType),
    },
    embedded: {
        index: EMBEDDED_LICENSE_INDEX,
        type: FieldType.SCHEMA,
        maxSize: 8192,
        schema: undefined,  // means same schema
    },
    difficulty: {
        index: DIFFICULTY_INDEX,
        type: FieldType.UINT8,
    },
    difficultyNonce: {
        index: DIFFICULTY_NONCE_INDEX,
        type: FieldType.BYTE8,
    },
    // If set then the embedding LicenseNode MUST have friendCert1 and friendCert2
    // set and also matching on friendLevel.
    friendLevel: {
        index: LICENSEFRIENDLEVEL_INDEX,
        type: FieldType.UINT8,
    },
    friendCert1: {
        index: FRIENDCERT1_INDEX,
        type: FieldType.SCHEMA,
        maxSize: 1024,
        schema: FriendCertSchema,
    },
    friendCert2: {
        index: FRIENDCERT2_INDEX,
        type: FieldType.SCHEMA,
        maxSize: 1024,
        schema: FriendCertSchema,
    },
} as const;

export const ParseLicenseNodeSchema: ParseSchemaType = {
    ...ParseBaseLicenseNodeSchema,
    "embedded??": ParseRawOrSchema(),  // no arg means same schema
    "difficulty??": 0,
    "difficultyNonce??": new Uint8Array(0),
    "friendLevel??": 0,
    "friendCert1??": ParseRawOrSchema(ParseFriendCertSchema),
    "friendCert2??": ParseRawOrSchema(ParseFriendCertSchema),
} as const;

/**
 * LicenseNode implementation.
 */
export class LicenseNode extends BaseLicenseNode implements LicenseNodeInterface {
    protected readonly fields = LicenseNodeSchema;
    protected props?: LicenseNodeProps;

    public static Is(modelType: Buffer | undefined): boolean {
        if (!modelType) {
            return false;
        }

        return modelType.equals(Buffer.from(LicenseNodeType));
    }

    public getProps(): LicenseNodeProps {
        return super.getProps();
    }

    public setProps(props: LicenseNodeProps) {
        super.setProps(props);
    }

    public mergeProps(props: LicenseNodeProps) {
        super.mergeProps(props);

        const props1 = this.getProps();

        for (const p in props) {
            // The keys of LicenseNodeProps
            if (["embedded", "friendLevel", "friendCert1", "friendCert2"].includes(p)) {
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

        if (this.props.friendCert1 || this.props.friendCert2) {
            if (!this.props.friendCert1 || !this.props.friendCert2) {
                return [false, "Both friendCerts must be set, if any set"];
            }

            if (!this.props.embedded) {
                return [false, "friendCerts are not expected to be set as embedded is not set"];
            }
        }

        if (deepValidate) {
            if (this.props.embedded) {
                const instance = this.loadEmbedded();

                let friendCert1: FriendCertInterface | undefined;
                let friendCert2: FriendCertInterface | undefined;

                if (this.props.friendCert1 || this.props.friendCert2) {
                    friendCert1 = this.loadFriendCert1();
                    friendCert2 = this.loadFriendCert2();
                }

                const eProps = instance.getProps();

                if (eProps.friendLevel !== undefined) {
                    if (!friendCert1) {
                        return [false, "Expected friendCerts to have been set as friendLevel is set"];
                    }
                }

                if (friendCert1 && friendCert2) {
                    if (eProps.friendLevel === undefined) {
                        return [false, "Expected embedded license friendLevel to be set"];
                    }

                    if (eProps.friendLevel !== friendCert1.getProps().friendLevel) {
                        // Note that the constraints force both certs to have same friendLevel
                        return [false,
                            "Expected embedded license friendLevel to equal to friendCert's friendLevel"];
                    }

                    const constraints1 = friendCert1.getProps().constraints;

                    if (!constraints1) {
                        return [false, "Expected constraints to be set on friendCert1"];
                    }

                    const constraints2 = friendCert2.getProps().constraints;

                    if (!constraints2) {
                        return [false, "Expected constraints to be set on friendCert2"];
                    }

                    if (!constraints1.equals(constraints2)) {
                        return [false, "Expected constraints to be equal on friendCerts"];
                    }

                    if (!friendCert1.hashFriendConstraints(friendCert2.getProps())) {
                        return [false, "Friend certs do not match"];
                    }

                    if (!friendCert2.hashFriendConstraints(friendCert1.getProps())) {
                        return [false, "Friend certs do not match"];
                    }

                    if ((this.props.creationTime ?? 0) < (friendCert1.getProps().creationTime ?? 0)) {
                        return [false,
                            "License creationTime cannot be lesser than the friendCert's creationTime"];
                    }

                    if ((this.props.creationTime ?? 0) > (friendCert1.getProps().expireTime ?? 0)) {
                        return [false,
                            "License creationTime cannot be greater then friendCert's expireTime"];
                    }

                    const licenseMaxExpireTime = friendCert1.getProps().licenseMaxExpireTime;

                    if (licenseMaxExpireTime !== undefined) {
                        if (this.props.expireTime === undefined) {
                            return [false,
                                "License expireTime must be set if friendCert's licenseMaxExpireTime is set"];
                        }

                        if ((licenseMaxExpireTime ?? 0) < this.props.expireTime) {
                            return [false,
                                "License expireTime cannot be greater than friendCert's licenseMaxExpireTime"];
                        }
                    }
                }
            }
        }

        return [true, ""];
    }

    /**
     * Return embedded object as class instance.
     *
     * @returns embedded class instance
     * @throws if no embedded prop is set or on failure decoding embedded data
     */
    public loadEmbedded(): LicenseNodeInterface {
        assert(this.props, "Expected props to have been set");

        if (!this.props.embedded) {
            throw new Error("Expected embedded to have been set");
        }

        if (Buffer.isBuffer(this.props.embedded)) {
            const instance = new LicenseNode(this.props.embedded);

            instance.unpack();

            this.props.embedded = instance.getProps();

            return instance;
        }
        else {
            const instance = new LicenseNode();

            instance.setProps(this.props.embedded)

            instance.pack();

            return instance;
        }
    }

    /**
     * Return embedded friendcert 1 object as class instance.
     *
     * @returns friend cert class instance
     * @throws if no embedded friend cert 1 prop is set or on failure decoding embedded data
     */
    public loadFriendCert1(): FriendCertInterface {
        assert(this.props, "Expected props to have been set");

        if (!this.props.friendCert1) {
            throw new Error("Expected friendCert1 to have been set");
        }

        if (Buffer.isBuffer(this.props.friendCert1)) {
            const instance = new FriendCert(this.props.friendCert1);

            instance.unpack();

            this.props.friendCert1 = instance.getProps();

            return instance;
        }
        else {
            const instance = new FriendCert();

            instance.setProps(this.props.friendCert1)

            return instance;
        }
    }

    /**
     * Return embedded friendcert 2 object as class instance.
     *
     * @returns friend cert class instance
     * @throws if no embedded friend cert 2 prop is set or on failure decoding embedded data
     */
    public loadFriendCert2(): FriendCertInterface {
        assert(this.props, "Expected props to have been set");

        if (!this.props.friendCert2) {
            throw new Error("Expected friendCert2 to have been set");
        }

        if (Buffer.isBuffer(this.props.friendCert2)) {
            const instance = new FriendCert(this.props.friendCert2);

            instance.unpack();

            this.props.friendCert2 = instance.getProps();

            return instance;
        }
        else {
            const instance = new FriendCert();

            instance.setProps(this.props.friendCert2)

            return instance;
        }
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
            LicenseNodeLockedConfigFieldsMapping,
            LicenseNodeLockedConfigFlagsMapping,
            {
                basenode: this.props.baseNodeConfig ?? 0,
                baselicensenode: this.props.baseLicenseNodeConfig ?? 0,
            }
        );
    }

    /**
     * Suger function to help embed this license into another license.
     *
     * The returned license need to be signed.
     *
     * @param targetPublicKey the target of the new license.
     * @param creationTime the creationTime of the embedding node, default is Date.now().
     * @returns embedding license with this license set as its embedded,
     * or undefined if not allowed to embed.
     * @throws on embedding error (such as field overflow).
     */
    public embed(targetPublicKey: Buffer, creationTime?: number): LicenseNode | undefined {
        assert(this.props, "Expected props to have been set");

        const flags = this.loadFlags();

        if (!flags.allowEmbed) {
            return undefined;
        }

        creationTime = Math.max(creationTime ?? Date.now(), this.props.creationTime ?? 0);

        const expireTime = this.props.expireTime;

        if (expireTime !== undefined) {
            if (expireTime <= creationTime) {
                return undefined;
            }
        }

        const extensions = (this.props.extensions ?? 0) - 1;

        assert(extensions >= 0, "Expected extensions to be equal or greater then 0");

        const newProps: LicenseNodeProps = {
            embedded: this.props,
            owner: this.props.targetPublicKey,
            targetPublicKey,
            refId: this.props.refId,
            parentId: this.props.parentId,
            baseNodeConfig: this.props.baseNodeConfig,
            baseLicenseNodeConfig: this.props.baseLicenseNodeConfig,
            creationTime,
            expireTime,
            terms: this.props.terms,
            extensions,
        };

        const licenseNode = new LicenseNode();

        licenseNode.setProps(newProps);

        const flags2 = licenseNode.loadFlags();

        // Do not automatically inherit these flags
        //
        flags2.allowTargetSendPrivately  = false;
        flags2.hasRightsByAssociation    = false;

        licenseNode.storeFlags(flags2);

        return licenseNode;
    }

    /**
     * If this license embeds another license find the innermost license and
     * return the owner public key of that license,
     * this is the issuer of the license stack.
     *
     * @returns owner public key of the top most (first) license.
     * @throws if embedded node cannot be decoded.
     */
    public getRootOwner(): Buffer | undefined {
        assert(this.packed, "Expected to have been packed");

        let packed = this.packed;

        while (packed) {
            const fieldIterator = FieldIterator(packed);

            const packed2 = fieldIterator.get(EMBEDDED_LICENSE_INDEX)?.value;

            if (packed2) {
                packed = packed2;
            }
            else {
                break;
            }
        }

        const fieldIterator = FieldIterator(packed);

        const owner = fieldIterator.get(OWNER_INDEX)?.value;

        assert(owner, "Expected owner to be set");

        return CopyBuf(owner);
    }
}

export const LicenseNodeLockedConfigFieldsMapping: ConstraintsFieldsMapping = {
    [LicenseNodeLockedConfig.ParentId]: PARENTID_INDEX,
    [LicenseNodeLockedConfig.RefId]: REFID_INDEX,
    [LicenseNodeLockedConfig.Region]: REGION_INDEX,
    [LicenseNodeLockedConfig.Jurisdiction]: JURISDICTION_INDEX,
    [LicenseNodeLockedConfig.TargetPublicKey]: TARGETPUBLICKEY_INDEX,
    [LicenseNodeLockedConfig.Terms]: TERMS_INDEX,
    [LicenseNodeLockedConfig.Extensions]: EXTENSIONS_INDEX,
    [LicenseNodeLockedConfig.BaseNodeConfig]: BASENODECONFIG_INDEX,
    [LicenseNodeLockedConfig.BaseLicenseNodeConfig]: BASELICENSENODECONFIG_INDEX,
    [LicenseNodeLockedConfig.FriendLevel]: LICENSEFRIENDLEVEL_INDEX,
    [LicenseNodeLockedConfig.FriendCert1]: FRIENDCERT1_INDEX,
    [LicenseNodeLockedConfig.FriendCert2]: FRIENDCERT2_INDEX,
    [LicenseNodeLockedConfig.Difficulty]: DIFFICULTY_INDEX,
}

export const LicenseNodeLockedConfigFlagsMapping: ConstraintsFlagsMapping = {
    [LicenseNodeLockedConfig.IsIndestructible]: ["basenode", BaseNodeConfig.IsIndestructible],
    [LicenseNodeLockedConfig.AllowTargetSendPrivately]: ["baselicensenode",
        BaseLicenseNodeConfig.AllowTargetSendPrivately],
    [LicenseNodeLockedConfig.DisallowRetroLicensing]: ["baselicensenode",
        BaseLicenseNodeConfig.DisallowRetroLicensing],
    [LicenseNodeLockedConfig.RestrictiveModeWriter]: ["baselicensenode",
        BaseLicenseNodeConfig.RestrictiveModeWriter],
    [LicenseNodeLockedConfig.RestrictiveModeManager]: ["baselicensenode",
        BaseLicenseNodeConfig.RestrictiveModeManager],
}
