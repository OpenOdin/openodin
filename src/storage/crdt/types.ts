import {
    DataInterface,
} from "../../datamodel";

import {
    CRDTMessagesAnnotations,
} from "./CRDTMessagesAnnotations";

export type CRDTViewType = {
    /** List of ID1s. */
    list: Buffer[],

    /** Transient hash for the node. */
    transientHashes: {[id1: string]: Buffer},

    /** Exported annotations model for the node. */
    annotations: {[id1: string]: Buffer},
};

export interface AlgoInterface {
    getId(): string;
    getLength(): number;
    getAllNodes(): {[id1: string]: NodeValues};
    add(nodes: DataInterface[]): [NodeValues[], Buffer[]];
    delete(indexes: number[]): void;
    get(cursorId1: Buffer | undefined, cursorIndex: number, head: number, tail: number,
        reverse: boolean): [NodeValues[], number[]] | undefined;
    getIndexes(nodes: NodeValues[]): number[];
    beginDeletionTracking(): void;
    commitDeletionTracking(): void;
    close(): void;
}

/** The values stored to keep track of the model. */
export interface NodeValues {
    id1: Buffer,
    id2?: Buffer,
    owner: Buffer,
    transientHash: Buffer,
    creationTime: number,
    transientStorageTime: number,
    annotations?: CRDTMessagesAnnotations,
}

export interface NodeValuesRefId extends NodeValues {
    refId?: Buffer,
}

export function ExtractNodeValues(node: DataInterface): NodeValues {
    const id1 = node.getId1();

    const owner = node.getOwner();

    if (!id1 || !owner) {
        throw new Error("Missing id1|owner");
    }

    return {
        id1,
        owner,
        id2: node.getId2(),
        transientHash: node.hashTransient(),
        creationTime: node.getCreationTime() ?? 0,
        transientStorageTime: node.getTransientStorageTime() ?? 0,
    }
}

export function ExtractNodeValuesRefId(node: DataInterface): NodeValuesRefId {
    const nodeValues = ExtractNodeValues(node);

    return {
        ...nodeValues,
        refId: node.getRefId(),
    };
}

export type CRDTCustomData = Record<string, any>;

/**
 * Optional storage are for the consumer to use.
 *
 * Property _deleted?: number as timestamp, used for GC.
 * Property custom is for node associated data set by setData() and setDataFn callback.
 *  _deleted?: number
 */
export type CRDTViewExternalData = {_deleted?: number, custom: CRDTCustomData};

export type CRDTViewItem = {
    /** The index of the node in the model. */
    index: number,

    id1: Buffer,
    node: DataInterface,
    data: CRDTCustomData,
};

export type CRDTViewModel = {
    /**
     * Ordered list of node Id1s.
     */
    list: Buffer[],

    /** Exactly all nodes referenced in above list. */
    nodes: {[id1: string]: DataInterface},

    /**
     * Storage area for the controller and UI to use.
     */
    datas: {[id1: string]: CRDTViewExternalData},
};

export type CRDTEvent = {
    /** Nodes added/inserted to the model, at any index */
    added: CRDTViewItem[],

    /** Updated nodes */
    updated: CRDTViewItem[],

    /** id1 of deleted node */
    deleted: Buffer[],

    /** subset (or all) of the added nodes who are at the end of the model list */
    appended: CRDTViewItem[],
};

export type CRDTOnChangeCallback = (crdtEvent: CRDTEvent) => void;

export type UpdateStreamParams = {
    head?: number,
    tail?: number,
    cursorId1?: Buffer,
    cursorIndex?: number,
    reverse?: boolean,
    triggerInterval?: number,
};

export type SetDataFn = (node: DataInterface, data: CRDTCustomData) => void;
export type UnsetDataFn = (id1: Buffer, data: CRDTCustomData) => void;
