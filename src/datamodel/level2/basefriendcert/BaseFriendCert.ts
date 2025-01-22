/**
 * At this level (2) a cert is specialized further into becoming a special
 * type of cert, a BaseFriendCert.
 */

import {
    Fields,
    FieldType,
} from "../../PackSchema";

import {
    ParseSchemaType,
} from "../../../util/SchemaUtil";

import {
    BaseCert,
    BaseCertSchema,
    ParseBaseCertSchema,
    BaseCertType,
} from "../../level1/basecert";

import {
    SignCert,
    SignCertInterface,
} from "../../level3/signcert";

import {
    MODELTYPE_INDEX,
} from "../../types";

import {
    BaseFriendCertInterface,
    BaseFriendCertProps,
    BaseFriendCertFlags,
    LICENSEMAXEXPIRETIME_INDEX,
    SALT_INDEX,
    FRIENDLEVEL_INDEX,
} from "./types";

function assert<T>(value: T, error: string): asserts value is NonNullable<T> {
    if (!value) {
        throw new Error(`Assertion error: ${error}`);
    }
}

export const BaseFriendCertType = [...BaseCertType, 2] as const;

export const BaseFriendCertSchema: Fields = {
    ...BaseCertSchema,
    modelType: {
        index: MODELTYPE_INDEX,
        type: FieldType.BYTE3,
        static: Buffer.from(BaseFriendCertType),
        staticPrefix: true,
    },
    licenseMaxExpireTime: {
        index: LICENSEMAXEXPIRETIME_INDEX,
        type: FieldType.UINT48BE,
    },
    salt: {
        index: SALT_INDEX,
        type: FieldType.BYTE8,
        required: true,
    },
    friendLevel: {
        index: FRIENDLEVEL_INDEX,
        type: FieldType.UINT8,
        required: true,
    }
} as const;

export const ParseBaseFriendCertSchema: ParseSchemaType = {
    ...ParseBaseCertSchema,
    "licenseMaxExpireTime??": 0,
    "salt??": new Uint8Array(0),
    "friendLevel??": 0,
} as const;

export class BaseFriendCert extends BaseCert implements BaseFriendCertInterface {
    protected readonly fields = BaseFriendCertSchema;
    protected props?: BaseFriendCertProps;

    /**
     * @param packed
     */
    constructor(packed?: Buffer) {
        super(packed);
    }

    public getProps(): BaseFriendCertProps {
        return super.getProps();
    }

    public setProps(props: BaseFriendCertProps) {
        super.setProps(props);
    }

    public mergeProps(props: BaseFriendCertProps) {
        super.mergeProps(props);

        const props1 = this.getProps();

        for (const p in props) {
            // The keys of BaseFriendCertProps
            if (["signCert", "licenseMaxExpireTime", "salt", "friendLevel"].includes(p)) {
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

        return modelType.slice(0, BaseFriendCertType.length).equals(Buffer.from(BaseFriendCertType));
    }

    public getAchillesHashes(): Buffer[] {
        assert(this.props, "Expected props to have been set");

        const hashes = super.getAchillesHashes();

        if (this.props.signCert) {
            const signCert = this.loadSignCert();

            hashes.push(...signCert.getAchillesHashes());
        }

        return hashes;
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

    public validate(deepValidate: boolean = false,
        time?: number): [boolean, string]
    {
        assert(this.props, "Expected props to have been set");

        const validated = super.validate(deepValidate, time);

        if (!validated[0]) {
            return validated;
        }

        if (this.props.friendLevel === undefined) {
            return [false, "Expected friendLevel to be set"];
        }

        if (this.props.salt === undefined) {
            return [false, "Expected salt to be set"];
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
                    if (this.props.licenseMaxExpireTime === undefined) {
                        return [false,
                            "cert must have licenseMaxExpireTime set if signCert has targetMaxExpireTime set"];
                    }

                    if (this.props.licenseMaxExpireTime > certProps.targetMaxExpireTime) {
                        return [false,
                            "cert cannot have larger licenseMaxExpireTime than signCert targetMaxExpireTime"];
                    }

                    if (expireTime > certProps.targetMaxExpireTime) {
                        return [false,
                            "cert cannot expire after signCerts targetMaxExpireTime"];
                    }
                }

                // When signing the friend cert we require any chain of cert to have been fully made up.
                //
                if ((certProps.countdown ?? 0) !== 0) {
                    return [false, "signCerts countdown value if set must be 0 when signing node"];
                }

                // We don't use SignCert constraints as FriendCert's constraints are used differently.
                //
                if (certProps.constraints) {
                    // TODO
                    // friendLevel, targetMaxExpire
                    return [false,
                        "signCert constraints must not be set"];
                }
            }
        }

        return [true, ""];
    }

    /**
     * Load config flags from config numbers and return.
     */
    public loadFlags(): BaseFriendCertFlags {
        assert(this.props, "Expected props to have been set");

        const flags = super.loadFlags();

        return flags;
    }

    /**
     * Store back modified flags.
     */
    public storeFlags(baseSignCertFlags: BaseFriendCertFlags) {
        assert(this.props, "Expected props to have been set");

        super.storeFlags(baseSignCertFlags);
    }
}
