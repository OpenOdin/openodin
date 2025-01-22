/**
 * At this level (3) a special type of BaseFriendCert is deviated into a fully
 * specified FriendCert.
 */

import {
    Fields,
    FieldType,
} from "../../PackSchema";

import {
    ParseSchemaType,
} from "../../../util/SchemaUtil";

import {
    BaseFriendCert,
    BaseFriendCertSchema,
    ParseBaseFriendCertSchema,
    BaseFriendCertType,
    FRIENDLEVEL_INDEX,
    LICENSEMAXEXPIRETIME_INDEX,
} from "../../level2/basefriendcert";

import {
    MODELTYPE_INDEX,
    ConstraintsFieldsMapping,
    ConstraintsFlagsMapping,
} from "../../types";

import {
    HashConstraints,
    HashList,
    IS_BIT_SET,
    SET_BIT,
} from "../../BaseModel";

import {
    FriendCertInterface,
    FriendCertProps,
    FriendCertLockedConfig,
    FriendCertFlags,
    FriendCertConfig,
    FRIENDCERT_REGION_INDEX,
    FRIENDCERT_JURISDICTION_INDEX,
    FRIENDCERTCONFIG_INDEX,
} from "./types";

function assert<T>(value: T, error: string): asserts value is NonNullable<T> {
    if (!value) {
        throw new Error(`Assertion error: ${error}`);
    }
}

export const FriendCertType = [...BaseFriendCertType, 1] as const;

export const FriendCertTypeAlias = "FriendCert";

export const FriendCertSchema: Fields = {
    ...BaseFriendCertSchema,
    modelType: {
        index: MODELTYPE_INDEX,
        type: FieldType.BYTE3,
        static: Buffer.from(FriendCertType),
    },
    region: {
        index: FRIENDCERT_REGION_INDEX,
        type: FieldType.STRING,
        maxSize: 2,
    },
    jurisdiction: {
        index: FRIENDCERT_JURISDICTION_INDEX,
        type: FieldType.STRING,
        maxSize: 2,
    },
    friendCertConfig: {
        index: FRIENDCERTCONFIG_INDEX,
        type: FieldType.UINT8,
    },
} as const;

export const ParseFriendCertSchema: ParseSchemaType = {
    ...ParseBaseFriendCertSchema,
    "region??": "",
    "jurisdiction??": "",
    "friendCertConfig??": 0,
} as const;

export class FriendCert extends BaseFriendCert implements FriendCertInterface {
    protected readonly fields = FriendCertSchema;
    protected props?: FriendCertProps;

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

        return modelType.equals(Buffer.from(FriendCertType));
    }

    public getProps(): FriendCertProps {
        return super.getProps();
    }

    public setProps(props: FriendCertProps) {
        super.setProps(props);
    }

    public mergeProps(props: FriendCertProps) {
        super.mergeProps(props);

        const props1 = this.getProps();

        for (const p in props) {
            // The keys of AuthCertProps
            if (["region", "jurisdiction", "friendCertConfig"].includes(p)) {
                //@ts-expect-error
                if (props[p] !== undefined) {
                    //@ts-expect-error
                    props1[p] = props[p];
                }
            }
        }
    }

    /**
     * Hash constraints on the friend cert together with friend's friend cert.
     * This is the value also stored in the constriants field, which needs
     * to be matched to the other friend cert when added to the license node.
     *
     * @param friendCert friend's friend cert
     * @param extenderPublicKey optionally include the license signer public key
     * into the constraints hash. This means that the friend certs pair are
     * locked for a specific middleman to use for extending licenses from A to B.
     * The HashExtenderPublicKey flag must be set also for this to have effect.
     *
     * @returns hash
     */
    public hashFriendConstraints(friendCert: FriendCertProps, extenderPublicKey?: Buffer): Buffer {
        assert(this.props,
            "Expected props to be set before calling hashConstraints");

        assert(this.props.salt, "Expected salt to be set");

        assert(friendCert.salt, "Expected friend cert salt to be set");

        assert(!this.props.salt.equals(friendCert.salt),
            "salt in both friend cert's are not allowed to be the same");

        assert(this.props.owner, "Expected owner to be set");
        assert(friendCert.owner, "Expected friend cert owner to be set");

        assert(this.props.creationTime === friendCert.creationTime,
            "Expected creationTime to be equal in friend certs");

        assert(this.props.expireTime === friendCert.expireTime,
            "Expected expireTime to be equal in friend certs");

        assert(this.props.licenseMaxExpireTime === friendCert.licenseMaxExpireTime,
            "Expected licenseMaxExpireTime to be equal in friend certs");

        assert(this.props.friendLevel === friendCert.friendLevel,
            "Expected friendLevel to be equal in friend certs");

        assert(this.props.region === friendCert.region,
            "Expected region to be equal in friend certs");

        assert(this.props.jurisdiction === friendCert.jurisdiction,
            "Expected jurisdiction to be equal in friend certs");

        const creationTime = this.props.creationTime;
        assert(creationTime !== undefined,
            "Expected creationTime be set in friend cert");

        const expireTime = this.props.expireTime;
        assert(expireTime !== undefined,
            "Expected expireTime be set in friend cert");

        const licenseMaxExpireTime = this.props.licenseMaxExpireTime;
        assert(licenseMaxExpireTime !== undefined,
            "Expected licenseMaxExpireTime be set in friend cert");

        const friendLevel = this.props.friendLevel;
        assert(friendLevel !== undefined,
            "Expected friendLevel be set in friend cert");

        const values: Buffer[] = [creationTime, expireTime,
            licenseMaxExpireTime, friendLevel].map( (i: number | undefined) =>
        {
            const buf = Buffer.alloc(8);
            if (i !== undefined) {
                buf.writeBigInt64BE(BigInt(i));
            }
            return buf;
        });

        values.push(this.props.owner, friendCert.owner, this.props.salt, friendCert.salt);

        if (this.props.region) {
            values.push(Buffer.from(this.props.region));
        }

        if (this.props.jurisdiction) {
            values.push(Buffer.from(this.props.jurisdiction));
        }

        values.sort( (a: Buffer, b: Buffer) => a.compare(b));

        const flags = this.loadFlags();

        if (flags.hashExtenderPublicKey) {
            assert(extenderPublicKey, "extenderPublicKey must be passed as argument when hashing friend constraints");

            values.push(extenderPublicKey);
        }

        return HashList(values);
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
            FriendCertLockedConfigFieldsMapping,
            FriendCertLockedConfigFlagsMapping,
            {
                // key matches in FriendCertLockedConfigFlagsMapping
                //
            }
        );
    }

    /**
     * Load config flags from config numbers and return.
     */
    public loadFlags(): FriendCertFlags {
        assert(this.props, "Expected props to have been set");

        const flags = super.loadFlags();

        LoadFriendCertFlags(this.props.friendCertConfig ?? 0, flags);

        return flags;
    }

    /**
     * Store back modified flags.
     */
    public storeFlags(friendCertFlags: FriendCertFlags) {
        assert(this.props, "Expected props to have been set");

        super.storeFlags(friendCertFlags);

        this.props.friendCertConfig = FriendCertFlagsToConfig(friendCertFlags, this.props.friendCertConfig ?? 0);
    }
}

function LoadFriendCertFlags(friendCertConfig: number, flags: FriendCertFlags) {
    flags.hashExtenderPublicKey =
        IS_BIT_SET(friendCertConfig, FriendCertConfig.HashExtenderPublicKey);
}

function FriendCertFlagsToConfig(flags: FriendCertFlags, friendCertConfig: number = 0): number {
    if (flags.hashExtenderPublicKey !== undefined) {
        friendCertConfig =
            SET_BIT(friendCertConfig, FriendCertConfig.HashExtenderPublicKey, flags.hashExtenderPublicKey);
    }

    return friendCertConfig;
}

/**
 * Map FriendCertLockedConfig bits to corresponding field indexes.
 * Note that locked flags are not mapped here.
 */
export const FriendCertLockedConfigFieldsMapping: ConstraintsFieldsMapping = {
    [FriendCertLockedConfig.LicenseMaxExpireTime]: LICENSEMAXEXPIRETIME_INDEX,
    [FriendCertLockedConfig.FriendLevel]: FRIENDLEVEL_INDEX,
    [FriendCertLockedConfig.Region]: FRIENDCERT_REGION_INDEX,
    [FriendCertLockedConfig.Jurisdiction]: FRIENDCERT_JURISDICTION_INDEX,
}

export const FriendCertLockedConfigFlagsMapping: ConstraintsFlagsMapping = {}
