/**
 * At this level (2) a BaseNode is specialized into a BaseCarrierNode.
 * A BaseCarrierNode cannot be packed, but it can be used to unpack.
 */

import {
    Fields,
    FieldType,
} from "../../PackSchema";

import {
    ParseSchemaType,
} from "../../../util/SchemaUtil";

import {
    BaseCarrierNodeInterface,
    BaseCarrierNodeProps,
    INFOFIELD_INDEX,
} from "./types";

import {
    MODELTYPE_INDEX,
} from "../../types";

import {
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
    BaseNodeConfig,
} from "../../level1/basenode/types";

function assert<T>(value: T, error: string): asserts value is NonNullable<T> {
    if (!value) {
        throw new Error(`Assertion error: ${error}`);
    }
}

export const BaseCarrierNodeType = [...BaseNodeType, 3] as const;

export const BaseCarrierNodeSchema: Fields = {
    ...BaseNodeSchema,
    modelType: {
        index: MODELTYPE_INDEX,
        type: FieldType.BYTE3,
        static: Buffer.from(BaseCarrierNodeType),
        staticPrefix: true,
    },
    info: {
        index: INFOFIELD_INDEX,
        type: FieldType.STRING,
        maxSize: 64,
    },
    licenseMinDistance: {
        index: LICENSEMINDISTANCE_INDEX,
        type: FieldType.UINT8,
    },
    licenseMaxDistance: {
        index: LICENSEMAXDISTANCE_INDEX,
        type: FieldType.UINT8,
    },
} as const;

export const ParseBaseCarrierNodeSchema: ParseSchemaType = {
    ...ParseBaseNodeSchema,
    "info??": "",
    "licenseMinDistance??": 0,
    "licenseMaxDistance??": 0,
} as const;

export class BaseCarrierNode extends BaseNode implements BaseCarrierNodeInterface {
    protected readonly fields = BaseCarrierNodeSchema;
    protected props?: BaseCarrierNodeProps;

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

        return modelType.slice(0, BaseCarrierNodeType.length).equals(Buffer.from(BaseCarrierNodeType));
    }

    public getProps(): BaseCarrierNodeProps {
        return super.getProps();
    }

    public setProps(props: BaseCarrierNodeProps) {
        super.setProps(props);
    }

    public mergeProps(props: BaseCarrierNodeProps) {
        super.mergeProps(props);

        const props1 = this.getProps();

        for (const p in props) {
            // The keys of BaseCarrierNodeProps
            if (["info"].includes(p)) {
                //@ts-expect-error
                if (props[p] !== undefined) {
                    //@ts-expect-error
                    props1[p] = props[p];
                }
            }
        }
    }

    protected defaultProps(): BaseCarrierNodeProps {
        const defaultProps = super.defaultProps() as BaseCarrierNodeProps;

        let baseNodeConfig = 0;

        baseNodeConfig =
            SET_BIT(baseNodeConfig, BaseNodeConfig.IsLeaf, true);

        defaultProps.baseNodeConfig = baseNodeConfig;

        return defaultProps;
    }

    /**
     * Enforces so that private nodes can only be sent to targetPublicKey if it is the owner.
     *
     * @param sourcePublicKey the public key embedding, signing and sending the node.
     * @param targetPublicKey the target public key the embedding is towards.
     *
     * @returns true if this node can be sent as embedded.
     */
    public canSendEmbedded(): boolean {
        return false;
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
}
