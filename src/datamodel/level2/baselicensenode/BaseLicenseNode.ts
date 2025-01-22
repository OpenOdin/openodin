/**
 * At this level (2) a BaseNode is specialized into a BaseLicenseNode.
 * A BaseLicenseNode cannot be packed, but it can be used to unpack.
 *
 * A Licene node has some strict settings, such as always being a leaf node,
 * always being a private node, etc.
 */

import {
    Fields,
    FieldType,
    HashSpecificFields,
} from "../../PackSchema";

import {
    ParseSchemaType,
} from "../../../util/SchemaUtil";

import {
    BaseLicenseNodeInterface,
    BaseLicenseNodeProps,
    BaseLicenseNodeFlags,
    BaseLicenseNodeConfig,
    BASELICENSENODECONFIG_INDEX,
} from "./types";

import {
    MODELTYPE_INDEX,
    OWNER_INDEX,
    EXPIRETIME_INDEX,
    SIGNCERT_INDEX,
} from "../../types";

import {
    IS_BIT_SET,
    SET_BIT,
    HashList,
} from "../../BaseModel";

import {
    BaseNode,
    BaseNodeSchema,
    ParseBaseNodeSchema,
    BaseNodeType,
} from "../../level1/basenode/BaseNode";

import {
    PARENTID_INDEX,
    DIFFICULTY_INDEX,
    BASENODECONFIG_INDEX,
    REFID_INDEX,
    REGION_INDEX,
    JURISDICTION_INDEX,
    BaseNodeConfig,
} from "../../level1/basenode/types";

import {
    PARENTPATHHASH_INDEX,
    JUMPPEERPUBLICKEY_INDEX,
    EXTENSIONS_INDEX,
    TERMS_INDEX,
    TARGETPUBLICKEY_INDEX,
    MAXDISTANCE_INDEX,
} from "../../level2/baselicensenode/types";

import {
    EMBEDDED_LICENSE_INDEX,
} from "../../level3/licensenode/types";

function assert<T>(value: T, error: string): asserts value is NonNullable<T> {
    if (!value) {
        throw new Error(`Assertion error: ${error}`);
    }
}

export const BaseLicenseNodeType = [...BaseNodeType, 2] as const;

export const BaseLicenseNodeSchema: Fields = {
    ...BaseNodeSchema,
    modelType: {
        index: MODELTYPE_INDEX,
        type: FieldType.BYTE3,
        static: Buffer.from(BaseLicenseNodeType),
        staticPrefix: true,
    },
    baseLicenseNodeConfig: {
        index: BASELICENSENODECONFIG_INDEX,
        type: FieldType.UINT8,
    },
    targetPublicKey: {
        index: TARGETPUBLICKEY_INDEX,
        type: FieldType.BYTES,
        maxSize: 32,
        required: true,
    },
    terms: {
        index: TERMS_INDEX,
        type: FieldType.STRING,
        maxSize: 255,
    },
    extensions: {
        index: EXTENSIONS_INDEX,
        type: FieldType.UINT8,
    },
    jumpPeerPublicKey: {
        index: JUMPPEERPUBLICKEY_INDEX,
        type: FieldType.BYTES,
        maxSize: 32,
    },
    parentPathHash: {
        index: PARENTPATHHASH_INDEX,
        type: FieldType.BYTE32,
    },
    maxDistance: {
        index: MAXDISTANCE_INDEX,
        type: FieldType.UINT8,
    },
} as const;

export const ParseBaseLicenseNodeSchema: ParseSchemaType = {
    ...ParseBaseNodeSchema,
    "baseLicenseNodeConfig??": 0,
    "targetPublicKey??": new Uint8Array(0),
    "terms??": 0,
    "extensions??": 0,
    "jumpPeerPublicKey??": new Uint8Array(0),
    "parentPathHash??": new Uint8Array(0),
    "maxDistance??": 0,
    "allowTargetSendPrivately??": false,
    "disallowRetroLicensing??": false,
    "restrictiveModeWriter??": false,
    "restrictiveModeManager??": false,
} as const;

/**
 * LicenseNode implementation.
 */
export class BaseLicenseNode extends BaseNode implements BaseLicenseNodeInterface {
    protected readonly fields = BaseLicenseNodeSchema;
    protected props?: BaseLicenseNodeProps;

    private cachedLicensingHashes: Buffer[] | undefined = undefined;

    public static Is(modelType: Buffer | undefined): boolean {
        if (!modelType) {
            return false;
        }

        return modelType.slice(0, BaseLicenseNodeType.length).equals(Buffer.from(BaseLicenseNodeType));
    }

    protected defaultProps(): BaseLicenseNodeProps {
        const defaultProps = super.defaultProps() as BaseLicenseNodeProps;

        let baseNodeConfig = 0;

        baseNodeConfig =
            SET_BIT(baseNodeConfig, BaseNodeConfig.IsLeaf, true);

        baseNodeConfig =
            SET_BIT(baseNodeConfig, BaseNodeConfig.AllowEmbed, true);

        baseNodeConfig =
            SET_BIT(baseNodeConfig, BaseNodeConfig.IsUnique, true);

        defaultProps.baseNodeConfig = baseNodeConfig;

        return defaultProps;
    }

    public getProps(): BaseLicenseNodeProps {
        return super.getProps();
    }

    public setProps(props: BaseLicenseNodeProps) {
        super.setProps(props);
    }

    public mergeProps(props: BaseLicenseNodeProps) {
        super.mergeProps(props);

        const props1 = this.getProps();

        for (const p in props) {
            // The keys of BaseLicenseNodeProps
            if (["embedded", "baseLicenseNodeConfig", "targetPublicKey", "terms", "extensions", "jumpPeerPublicKey", "parentPathHash", "maxDistance"].includes(p)) {
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

        const flags = this.loadFlags();

        if (flags.isLicensed) {
            return [false,
                "License nodes cannot be licensed them selves"];
        }

        if (flags.isPublic) {
            return [false,
                "License nodes cannot be public"];
        }

        if (!flags.isLeaf) {
            return [false,
                "License nodes are required to be leaf nodes"];
        }

        if (!flags.isUnique) {
            return [false,
                "License nodes are required to be flagged as unique"];
        }

        if (flags.allowEmbedMove) {
            return [false,
                "License nodes are cannot be flagged as allowEmbedMove"];
        }

        if (this.props.terms?.length) {
            if (this.props.embedded) {
                return [false, "Only first license in stack can have terms set"];
            }
        }

        if (deepValidate) {
            if (this.props.embedded) {
                const instance = this.loadEmbedded();

                const eProps = instance.getProps();
                const eFlags = instance.loadFlags();

                // Check so targetPublicKey of embedded is equal to owner.
                //
                const embeddedTargetPublicKey = eProps.targetPublicKey;
                if (embeddedTargetPublicKey === undefined) {
                    return [false, "Expected targetPublicKey to be set"];
                }

                const owner = this.props.owner;
                if (owner === undefined) {
                    return [false, "Expected owner to be set"];
                }

                if (!owner.equals(embeddedTargetPublicKey)) {
                    return [false,
                        "owner of license must be same as targetPublicKey of embedded license"];
                }

                const refId = this.props.refId;

                if (refId === undefined) {
                    return [false, "Expected refId to bet set"];
                }

                const embeddedRefId = eProps.refId;

                if (embeddedRefId === undefined) {
                    return [false, "Expected embedded refId to bet set"];
                }

                if (!refId.equals(embeddedRefId)) {
                    return [false, "Expected refId to be equal embedded refId"];
                }

                const extensions = this.props.extensions ?? 0;
                const embeddedExtensions = eProps.extensions ?? 0;

                if (extensions >= embeddedExtensions) {
                    return [false, "Expected extension to be lesser than embedded extensions"];
                }

                if ((this.props.creationTime ?? 0) < (eProps.creationTime ?? 0)) {
                    return [false,
                        "Expected creationTime to be equal or greater than embedded creationTime"];
                }

                if ((this.props.expireTime ?? 0) > (eProps.expireTime ?? 0)) {
                    return [false,
                        "Expected expireTime to be equal or lesser than embedded expireTime"];
                }

                if (flags.disallowRetroLicensing !== eFlags.disallowRetroLicensing) {
                    return [false,
                        "Expected disallowRetroLicensing to match in license and embedded license"];
                }

                if (flags.restrictiveModeWriter !== eFlags.restrictiveModeWriter) {
                    return [false, "Expected restrictiveModeWriter to match in license and embedded license"];
                }

                if (flags.restrictiveModeManager !== eFlags.restrictiveModeManager) {
                    return [false,
                        "Expected restrictiveModeManager to match in license and embedded license"];
                }

                if (flags.allowTargetSendPrivately && !eFlags.allowTargetSendPrivately) {
                    return [false,
                        "allowTargetSendPrivately must also be set in original license if set in extended"];
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
    public loadEmbedded(): BaseLicenseNodeInterface {
        assert(this.props, "Expected props to have been set");

        if (!this.props.embedded) {
            throw new Error("Expected embedded to have been set");
        }

        if (Buffer.isBuffer(this.props.embedded)) {
            const instance = new BaseLicenseNode(this.props.embedded);

            instance.unpack();

            // Note we do not store back props as we have only loaded a level 2 node.

            return instance;
        }
        else {
            const instance = new BaseLicenseNode();

            instance.setProps(this.props.embedded)

            instance.pack();

            return instance;
        }
    }

    /**
     * Return combination of hashes for which this license licenses for.
     *
     * If a node.getLicenseHashes() intersects with this output then this
     * license does license that node.
     *
     * License hashes returned are different for read license and write licenses.
     * Write licenses are licenses who are flagged as isRestrictiveModeWriter or
     * isRestrictiveModeManager.
     *
     * @returns list of hashes to match with a node to be licensed.
     */
    public getLicensingHashes(): Buffer[] {
        assert(this.props, "Expected props to have been set");

        if (this.cachedLicensingHashes) {
            return this.cachedLicensingHashes;
        }

        const hashes: Buffer[] = [];

        const flags = this.loadFlags();

        const isWrite = flags.restrictiveModeWriter || flags.restrictiveModeManager;

        const prefix = isWrite ? Buffer.from("write") : Buffer.from("read");

        // We always hash with the parentId of the license to be sure that it is the same
        // as the parentId of the node being targeted.
        //
        const parentId = this.props.parentId;
        assert(parentId, "Expected props.parentId to have been set");

        // The id1 of the node being licensed.
        //
        const refId = this.props.refId;
        assert(refId, "Expected props.refId to have been set");

        // The owner of the node being licensed, is the same as the owner
        // of the first license in the stack.
        //
        const firstIssuer = this.getRootOwner();
        assert(firstIssuer, "Expected props.owner to have been set");

        // The owner of the current license (top most in the stack) is the
        // one issuing a license to the targetPublicKey.
        //
        const lastIssuer = this.props.owner;
        assert(lastIssuer, "Expected props.owner to have been set");

        // This is the public key of the user getting a license for the node,
        // as set in this (top most) license.
        //
        const targetPublicKey = this.props.targetPublicKey;
        assert(targetPublicKey, "Expected props.targetPublicKey to have been set");

        // Generate a set of hashes which identify the allowance of the license.
        //

        // This hash says that there exists a license for the specific node.
        // This is only useful for the Storage to know not to garbage collect the node.
        //
        hashes.push(HashList([prefix, refId, parentId, firstIssuer]));

        // This hash says there is a license for the specific node targeted
        // at a specific public key, but does not say who is the last issuer.
        //
        hashes.push(HashList([prefix, refId, parentId, firstIssuer, undefined, targetPublicKey]));

        // This hash says there is a license for the specific node and who
        // is the last issuer, but not who the target public key is.
        //
        hashes.push(HashList([prefix, refId, parentId, firstIssuer, lastIssuer, undefined]));

        // This hash says there is a license for the specific,  who
        // is the last issuer, and also who the target public key is.
        //
        hashes.push(HashList([prefix, refId, parentId, firstIssuer, lastIssuer, targetPublicKey]));

        const jumpPeerPublicKey = this.props.jumpPeerPublicKey;

        if (jumpPeerPublicKey) {
            // A license which has jumpPeerPublicKey set allows this public key the license
            // for the node and also rights to copy the license it self, for the purpose
            // of relaying the node and the license to the targetPublicKey.
            //
            hashes.push(HashList([prefix, refId, parentId, firstIssuer, undefined, jumpPeerPublicKey]));

            hashes.push(HashList([prefix, refId, parentId, firstIssuer, lastIssuer, jumpPeerPublicKey]));
        }

        this.cachedLicensingHashes = hashes;

        return hashes;
    }

    public getRootOwner(): Buffer | undefined {
        throw new Error("Not implemented");
    }

    /**
     * Enforces so that licenses only can be sent embedded to targetPublicKey if the
     * sourcePublicKey (sender) is the current license target.
     *
     * @param sourcePublicKey the public key embedding, signing and sending the node.
     * @param targetPublicKey the target public key the embedding is towards.
     *
     * @returns true if this node can be sent as embedded.
     */
    public canSendEmbedded(sourcePublicKey: Buffer, targetPublicKey: Buffer): boolean {
        assert(this.props, "Expected props to have been set");

        // Cannot embed license to self.
        //
        if (sourcePublicKey.equals(targetPublicKey)) {
            return false;
        }

        assert(this.props.targetPublicKey, "Expected targetPublicKey to be set");

        // The owner of the license can always send to the target of the license.
        //
        if (this.props.targetPublicKey.equals(sourcePublicKey)) {
            return true;
        }

        const flags = this.loadFlags();

        if (!flags.allowEmbed) {
            return false;
        }

        const extensions = this.props.extensions ?? 0;

        // License has no more extensions left.
        //
        if (extensions <= 0) {
            return false;
        }

        return true;
    }

    /**
     * Check if this node can be sent privately to targetPublicKey from sourcePublicKey.
     *
     * A private node is a node which is not public and it not licensed.
     *
     * All license nodes are private.
     *
     * Allow to send if:
     * targetPublicKey is the owner of the license.
     * targetPublicKey is the target of the license.
     * targetPublicKey is the jumpPeerPublicKey of the license.
     * sourcePublicKey is the target of the license and allowTargetSendPrivately is true.
     *
     * @param sourcePublicKey the public key of the peer holding the node.
     * @param targetPublicKey the public key the node is to be sent to.
     *
     * @returns whether or not this node can send privately
     */
    public canSendPrivately(sourcePublicKey: Buffer, targetPublicKey: Buffer): boolean {
        assert(this.props, "Expected props to have been set");

        const owner = this.props.owner;
        assert(owner, "Expected owner to be set");

        assert(this.props.targetPublicKey, "Expected targetPublicKey to be set");

        if (owner.equals(targetPublicKey)) {
            return true;
        }

        if (this.props.targetPublicKey.equals(targetPublicKey)) {
            return true;
        }

        if (this.props.jumpPeerPublicKey?.equals(targetPublicKey)) {
            // If the target is designated intermediary holder of the
            // license then they can hold it.
            // Note that this doesn't grant the possessor rights to the licensed
            // data only that they can help forward the license to where it shold be.
            return true;
        }

        const flags = this.loadFlags();

        // If allowTargetSendPrivately is set then the source can always share
        // the license if the source is also the target of the license.
        if (flags.allowTargetSendPrivately) {
            if (this.props.targetPublicKey.equals(sourcePublicKey)) {
                return true;
            }
        }

        return false;
    }

    /**
     * This is used to be able to refuse nodes from entering the storage.
     *
     * @param sourcePublicKey the public key from where the node is coming from.
     * @param targetPublicKey the public key of the party to receive the node.
     * @returns true if this node can be received privately.
     */
    public canReceivePrivately(sourcePublicKey: Buffer, targetPublicKey: Buffer): boolean {
        assert(this.props, "Expected props to have been set");

        const owner = this.props.owner;
        assert(owner, "Expected owner to be set");

        assert(this.props.targetPublicKey, "Expected targetPublicKey to be set");

        // If the receiver created the license then they can hold it.
        //
        if (owner.equals(targetPublicKey)) {
            return true;
        }

        // If the receiver is the target of the license then they can hold it.
        //
        if (this.props.targetPublicKey.equals(targetPublicKey)) {
            return true;
        }

        if (this.props.jumpPeerPublicKey?.equals(targetPublicKey)) {
            // If the possessor is designated intermediary holder of the
            // license then they can hold it.
            // Note that this doesn't grant the possessor rights to the licensed
            // data only that they can help forward the license to where it shold be.
            return true;
        }

        const flags = this.loadFlags();

        // If the source is the target then anyone can accept to store this license
        // if allowTargetSendPrivately is set, because the target of the license
        // has decided to share the license.
        //
        if (flags.allowTargetSendPrivately) {
            if (this.props.targetPublicKey.equals(sourcePublicKey)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Calculate the unique hash for the license by hashing the fields that matter:
     * owner, targetPublicKey, refId, expireTime, parentId, etc.
     *
     * @returns unique hash.
     */
    public uniqueHash(): Buffer {
        assert(this.packed, "Expected to be packed");

        const fields: number[] = [
            MODELTYPE_INDEX,
            OWNER_INDEX,
            PARENTID_INDEX,
            DIFFICULTY_INDEX,
            BASENODECONFIG_INDEX,
            REFID_INDEX,
            EXPIRETIME_INDEX,
            REGION_INDEX,
            JURISDICTION_INDEX,
            PARENTPATHHASH_INDEX,
            EXTENSIONS_INDEX,
            TERMS_INDEX,
            TARGETPUBLICKEY_INDEX,
            BASELICENSENODECONFIG_INDEX,
            MAXDISTANCE_INDEX,
            EMBEDDED_LICENSE_INDEX,
            SIGNCERT_INDEX,
        ];

        return HashSpecificFields(this.packed, fields);
    }

    /**
     * Load config flags from config numbers and return.
     */
    public loadFlags(): BaseLicenseNodeFlags {
        assert(this.props, "Expected props to have been set");

        const flags = super.loadFlags();

        LoadBaseLicenseNodeConfigFlags(this.props.baseLicenseNodeConfig ?? 0, flags);

        return flags;
    }

    /**
     * Store back modified flags.
     */
    public storeFlags(baseLicenseNodeFlags: BaseLicenseNodeFlags) {
        assert(this.props, "Expected props to have been set");

        super.storeFlags(baseLicenseNodeFlags);

        this.props.baseLicenseNodeConfig = BaseLicenesNodeFlagsToConfig(baseLicenseNodeFlags, this.props.baseLicenseNodeConfig ?? 0);
    }
}

function LoadBaseLicenseNodeConfigFlags(baseLicenseNodeConfig: number, flags: BaseLicenseNodeFlags) {
    flags.allowTargetSendPrivately =
        IS_BIT_SET(baseLicenseNodeConfig, BaseLicenseNodeConfig.AllowTargetSendPrivately);

    flags.disallowRetroLicensing =
        IS_BIT_SET(baseLicenseNodeConfig, BaseLicenseNodeConfig.DisallowRetroLicensing);

    flags.restrictiveModeWriter =
        IS_BIT_SET(baseLicenseNodeConfig, BaseLicenseNodeConfig.RestrictiveModeWriter);

    flags.restrictiveModeManager =
        IS_BIT_SET(baseLicenseNodeConfig, BaseLicenseNodeConfig.RestrictiveModeManager);
}

function BaseLicenesNodeFlagsToConfig(flags: BaseLicenseNodeFlags, baseLicenseNodeConfig: number = 0): number {
    if (flags.allowTargetSendPrivately !== undefined) {
        baseLicenseNodeConfig =
            SET_BIT(baseLicenseNodeConfig, BaseLicenseNodeConfig.AllowTargetSendPrivately,
                flags.allowTargetSendPrivately);
    }

    if (flags.disallowRetroLicensing !== undefined) {
        baseLicenseNodeConfig =
            SET_BIT(baseLicenseNodeConfig, BaseLicenseNodeConfig.DisallowRetroLicensing,
                flags.disallowRetroLicensing);
    }

    if (flags.restrictiveModeWriter !== undefined) {
        baseLicenseNodeConfig =
            SET_BIT(baseLicenseNodeConfig, BaseLicenseNodeConfig.RestrictiveModeWriter,
                flags.restrictiveModeWriter);
    }

    if (flags.restrictiveModeManager !== undefined) {
        baseLicenseNodeConfig =
            SET_BIT(baseLicenseNodeConfig, BaseLicenseNodeConfig.RestrictiveModeManager,
                flags.restrictiveModeManager);
    }

    return baseLicenseNodeConfig;
}
