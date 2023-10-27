import {
    NodeInterface,
    DataInterface,
} from "../../datamodel";

export const MAX_TRANSFORMER_LENGTH = 100000;

export interface AlgoInterface {
    getId(): number;
    getLength(): number;
    copyModel(): any;
    setModel(model: any): void;
    getAllNodes(): {[id1: string]: NodeInterface};
    add(nodes: NodeInterface[]): [NodeInterface[], NodeInterface[]];
    delete(indexes: number[]): void;
    get(cursorId1: Buffer | undefined, head: number, tail: number, reverse: boolean):
        [NodeInterface[], number[]] | undefined;
    getIndexes(nodes: NodeInterface[]): number[];
    close(): void;
}

/**
 * Optional storage are for the consumer to use.
 *
 * Property _deleted?: number as timestamp, used for GC.
 *  _deleted?: number
 */
export type TransformerExternalData = {[key: string]: any};

export type TransformerItem = {
    index: number,
    id1: Buffer,
    node: DataInterface,
    data: TransformerExternalData,
};

export type TransformerModel = {
    /**
     * Ordered list of node Id1s.
     */
    list: Buffer[],

    /** Exactly all nodes referenced in above list. */
    nodes: {[id1: string]: DataInterface},

    /**
     * Storage area for the controller and UI to use.
     */
    datas: {[id1: string]: TransformerExternalData},
};

export type TRANSFORMER_EVENT = {
    /** List of node ID1s which have been added to the model. */
    added: Buffer[],

    /** List of node ID1s of existing nodes who's transient values have been updated. */
    updated: Buffer[],

    /** List of node ID1s of nodes who have deen deleted from the model. */
    deleted: Buffer[],
};
