import {
    BaseNodeProps,
    BaseNodeFlags,
    BaseNodeInterface,
} from "../../level1/basenode/types";

export const CONTENTTYPE_INDEX          = 48;
export const DATA_INDEX                 = 49;
export const DATA2_INDEX                = 50;
export const BLOBHASH_INDEX             = 51;
export const BLOBLENGTH_INDEX           = 52;
export const BASEDATANODECONFIG_INDEX   = 53;

// in transient range but not part of transient hash
export const ANNOTATIONS_INDEX          = 161;

export type BaseDataNodeProps = BaseNodeProps & {
    contentType?: string,
    data?: Buffer,  // implemented in deriving nodes
    data2?: number,
    blobHash?: Buffer,
    blobLength?: bigint,
    baseDataNodeConfig?: number,
    annotations?: Buffer,
};

export type BaseDataNodeFlags = BaseNodeFlags & {
    isDestroy?: boolean,
    isAnnotationEdit?: boolean,
    isAnnotationReaction?: boolean,
};

export interface BaseDataNodeInterface extends BaseNodeInterface {
    setProps(props: BaseDataNodeProps): void;
    getProps(): BaseDataNodeProps;
    mergeProps(props: BaseDataNodeProps): void;
    loadFlags(): BaseDataNodeFlags;
    storeFlags(baseDataNodeFlags: BaseDataNodeFlags): void;
}

/**
 * The data config number bits.
 */
export enum BaseDataNodeConfig {
     /**
      * A data node having this flag set is a Destroy Node and a destroy hash
      * will be extracted from its owner and refId fields and if matched with
      * other nodes achilles hashes those nodes will get destroyed.
      *
      * Achilles hashes are hash(["destroy", owner, id1]).
      *
      * The destroy target hashes are not calculated in this class, but will
      * be calculated by the outside, as hash(["destroy", owner, refId]).
      *
      * Embedded nodes who are destroyed will also tear down their embedding
      * nodes with them.
      *
      * An embedded Destroy node does not have the destroying effect.
      */
    IsDestroy               = 0,

    /**
     * This bit is set to indicate that this node is an annotation node
     * to its parent.
     * What annotation means is application dependant where one example is that 
     * if represents a "like" on a message.
     * The CRDT models can handle annotations and bundle them up with their
     * parent node.
     */
    IsAnnotationsEdit       = 1,

    /**
     * If this flag is set then the node is meant to be the edited version
     * of its parent node.
     * This can be handled by the CRDT models if configured to do so,
     * otherwise this node is just handled as any other node.
     *
     * The CRDT models require that the owner of the edit node is the
     * same as its parent.
     * If there are many edit nodes then the one with the newest creationTime
     * is selected.
     */
    IsAnnotationsReaction   = 2,
}
