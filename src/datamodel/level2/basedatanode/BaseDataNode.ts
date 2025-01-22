/**
 * At this level (2) a BaseNode is specialized into a BaseDataNode.
 * A BaseDataNode cannot be packed, but it can be used to unpack.
 */

import {
    Fields,
    FieldType,
} from "../../PackSchema";

import {
    ParseSchemaType,
} from "../../../util/SchemaUtil";

import {
    BaseDataNodeInterface,
    BaseDataNodeProps,
    BaseDataNodeFlags,
    CONTENTTYPE_INDEX,
    DATA2_INDEX,
    BLOBHASH_INDEX,
    BLOBLENGTH_INDEX,
    BASEDATANODECONFIG_INDEX,
    ANNOTATIONS_INDEX,
    DATA_INDEX,
    BaseDataNodeConfig,
} from "./types";

import {
    MODELTYPE_INDEX,
} from "../../types";

import {
    IS_BIT_SET,
    SET_BIT,
} from "../../BaseModel";

import {
    BaseNode,
    BaseNodeSchema,
    ParseBaseNodeSchema,
    BaseNodeType,
} from "../../level1/basenode/BaseNode";

import {
    LICENSEMINDISTANCE_INDEX,
    LICENSEMAXDISTANCE_INDEX,
    CHILDMINDIFFICULTY_INDEX,
} from "../../level1/basenode/types";

function assert<T>(value: T, error: string): asserts value is NonNullable<T> {
    if (!value) {
        throw new Error(`Assertion error: ${error}`);
    }
}

export const BaseDataNodeType = [...BaseNodeType, 1] as const;

export const BaseDataNodeSchema: Fields = {
    ...BaseNodeSchema,
    modelType: {
        index: MODELTYPE_INDEX,
        type: FieldType.BYTE3,
        static: Buffer.from(BaseDataNodeType),
        staticPrefix: true,
    },
    contentType: {
        index: CONTENTTYPE_INDEX,
        type: FieldType.STRING,
        maxSize: 64,
    },
    data: {
        index: DATA_INDEX,
        type: FieldType.BYTES,
        maxSize: 1024,
    },
    data2: {
        index: DATA2_INDEX,
        type: FieldType.UINT16BE,
    },
    blobHash: {
        index: BLOBHASH_INDEX,
        type: FieldType.BYTE32,
    },
    blobLength: {
        index: BLOBLENGTH_INDEX,
        type: FieldType.UINT64BE,
    },
    baseDataNodeConfig: {
        index: BASEDATANODECONFIG_INDEX,
        type: FieldType.UINT8,
    },
    annotations: {
        index: ANNOTATIONS_INDEX,
        type: FieldType.BYTES,
        maxSize: 10240,
    },
    licenseMinDistance: {
        index: LICENSEMINDISTANCE_INDEX,
        type: FieldType.UINT8,
    },
    licenseMaxDistance: {
        index: LICENSEMAXDISTANCE_INDEX,
        type: FieldType.UINT8,
    },
    childMinDifficulty: {
        index: CHILDMINDIFFICULTY_INDEX,
        type: FieldType.UINT8,
    },
} as const;

export const ParseBaseDataNodeSchema: ParseSchemaType = {
    ...ParseBaseNodeSchema,
    "contentType??": "",
    "data??": new Uint8Array(0),
    "data2??": 0,
    "blobHash??": new Uint8Array(0),
    "blobLength??": 0n,
    "baseDataNodeConfig??": 0,
    "annotations??": new Uint8Array(0),
    "licenseMinDistance??": 0,
    "licenseMaxDistance??": 0,
    "childMinDifficulty??": 0,
    "isDestroy??": false,
    "isAnnotationEdit??": false,
    "isAnnotationReaction??": false,
} as const;

export class BaseDataNode extends BaseNode implements BaseDataNodeInterface {
    protected readonly fields = BaseDataNodeSchema;
    protected props?: BaseDataNodeProps;

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

        return modelType.slice(0, BaseDataNodeType.length).equals(Buffer.from(BaseDataNodeType));
    }

    public getProps(): BaseDataNodeProps {
        return super.getProps();
    }

    public setProps(props: BaseDataNodeProps) {
        super.setProps(props);
    }

    public mergeProps(props: BaseDataNodeProps) {
        super.mergeProps(props);

        const props1 = this.getProps();

        for (const p in props) {
            // The keys of BaseDataNodeProps
            if (["contentType", "data", "data2", "blobHash", "blobLength", "baseDataNodeConfig", "annotations"].includes(p)) {
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

        if (this.props.blobHash !== undefined ||
            this.props.blobLength !== undefined)
        {
            if (this.props.blobHash === undefined ||
                this.props.blobLength === undefined)
            {
                return [false,
                    "blobHash and blobLength must both be set, if set"];
            }
        }

        if (flags.isAnnotationEdit && flags.isAnnotationReaction) {
            return [false,
                "Annotation edit and annotation reaction cannot be set together"];
        }

        if (flags.isDestroy) {
            if (flags.isAnnotationEdit || flags.isAnnotationReaction) {
                return [false,
                    "Data nodes flagged as isDestroy cannot be annotation nodes"];
            }
        }

        return [true, ""];
    }

    /**
     * Enforces so that private nodes can only be sent to targetPublicKey if it is the owner.
     *
     * @param sourcePublicKey the public key embedding, signing and sending the node.
     * @param targetPublicKey the target public key the embedding is towards.
     *
     * @returns true if this node can be sent as embedded.
     */
    public canSendEmbedded(sourcePublicKey: Buffer,
        targetPublicKey: Buffer): boolean
    {
        assert(this.props, "Expected props to have been set");

        const flags = super.loadFlags();

        if (!flags.allowEmbed) {
            return false;
        }

        const owner = this.props.owner;
        assert(owner, "Expected owner to have been set");

        const isPrivate = !flags.isPublic && !flags.isLicensed;

        if (isPrivate) {
            // Private node can only be embedded to the same owner.
            if (!owner.equals(targetPublicKey)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Check if this node can be sent privately to targetPublicKey from sourcePublicKey.
     *
     * A private node is a node which is not public and is not licensed,
     * and in such case it is up to each node type to determine what private means.
     *
     * Override this in deriving nodes to implement the node types own logic.
     *
     * The default behaviour is that private nodes can only be sent from their owner
     * to their owner.
     *
     * @param sourcePublicKey the public key of the peer holding the node.
     * @param targetPublicKey the public key the node is to be sent to.
     *
     * @returns true if this node can be sent privately to targetPublicKey.
     */
    public canSendPrivately(sourcePublicKey: Buffer, targetPublicKey: Buffer): boolean {
        assert(this.props, "Expected props to have been set");

        if (!sourcePublicKey.equals(targetPublicKey)) {
            return false;
        }

        const owner = this.props.owner;

        assert(owner, "Expected owner to have been set");

        if (owner.equals(targetPublicKey)) {
            return true;
        }

        return false;
    }

    /**
     * This is used to be able to refuse nodes from entering the storage.
     *
     * Default behaviour is that only owner can hold private nodes.
     *
     * @param sourcePublicKey the public key from where the node is coming from.
     * @param targetPublicKey the public key of the party to receive the node.
     * @returns true if this node can be received privately.
     */
    public canReceivePrivately(sourcePublicKey: Buffer, targetPublicKey: Buffer): boolean {
        assert(this.props, "Expected props to have been set");

        const owner = this.props.owner;

        assert(owner, "Expected owner to have been set");

        if (owner.equals(targetPublicKey)) {
            return true;
        }

        return false;
    }

    /**
     * Load config flags from config numbers and return.
     */
    public loadFlags(): BaseDataNodeFlags {
        assert(this.props, "Expected props to have been set");

        const flags = super.loadFlags();

        LoadBaseDataNodeConfigFlags(this.props.baseDataNodeConfig ?? 0, flags);

        return flags;
    }

    /**
     * Store back modified flags.
     */
    public storeFlags(baseDataNodeFlags: BaseDataNodeFlags) {
        assert(this.props, "Expected props to have been set");

        super.storeFlags(baseDataNodeFlags);

        this.props.baseDataNodeConfig = BaseDataNodeFlagsToConfig(baseDataNodeFlags, this.props.baseDataNodeConfig ?? 0);
    }
}

function LoadBaseDataNodeConfigFlags(baseDataNodeConfig: number, flags: BaseDataNodeFlags) {
    flags.isDestroy =
        IS_BIT_SET(baseDataNodeConfig, BaseDataNodeConfig.IsDestroy);

    flags.isAnnotationEdit =
        IS_BIT_SET(baseDataNodeConfig, BaseDataNodeConfig.IsAnnotationsEdit);

    flags.isAnnotationReaction =
        IS_BIT_SET(baseDataNodeConfig, BaseDataNodeConfig.IsAnnotationsReaction);
}

function BaseDataNodeFlagsToConfig(flags: BaseDataNodeFlags, baseDataNodeConfig: number = 0): number {
    if (flags.isDestroy !== undefined) {
        baseDataNodeConfig =
            SET_BIT(baseDataNodeConfig, BaseDataNodeConfig.IsDestroy,
                flags.isDestroy);
    }

    if (flags.isAnnotationEdit !== undefined) {
        baseDataNodeConfig =
            SET_BIT(baseDataNodeConfig, BaseDataNodeConfig.IsAnnotationsEdit,
                flags.isAnnotationEdit);
    }

    if (flags.isAnnotationReaction !== undefined) {
        baseDataNodeConfig =
            SET_BIT(baseDataNodeConfig, BaseDataNodeConfig.IsAnnotationsReaction,
                flags.isAnnotationReaction);
    }

    return baseDataNodeConfig;
}
