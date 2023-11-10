import {
    DataInterface,
} from "../../datamodel";

export type CRDTViewType = {list: Buffer[], transientHashes: {[id1: string]: Buffer}};

export interface AlgoInterface {
    getId(): number;
    getLength(): number;
    getAllNodes(): {[id1: string]: NodeAlgoValues};
    add(nodes: NodeAlgoValues[]): [NodeAlgoValues[], NodeAlgoValues[]];
    delete(indexes: number[]): void;
    get(cursorId1: Buffer | undefined, cursorIndex: number, head: number, tail: number,
        reverse: boolean): [NodeAlgoValues[], number[]] | undefined;
    getIndexes(nodes: NodeAlgoValues[]): number[];
    beginDeletionTracking(): void;
    commitDeletionTracking(): void;
    close(): void;
}

export type NodeAlgoValues = {
    id1: Buffer,
    refId?: Buffer,
    transientHash: Buffer,
    creationTime?: number,
    transientStorageTime?: number,
};

/**
 * Optional storage are for the consumer to use.
 *
 * Property _deleted?: number as timestamp, used for GC.
 *  _deleted?: number
 */
export type CRDTViewExternalData = {[key: string]: any};

export type CRDTViewItem = {
    index: number,
    id1: Buffer,
    node: DataInterface,
    data: CRDTViewExternalData,
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

export type CRDTVIEW_EVENT = {
    /** List of node ID1s which have been added to the model. */
    added: Buffer[],

    /** List of node ID1s of existing nodes who's transient values have been updated. */
    updated: Buffer[],

    /** List of node ID1s of nodes who have deen deleted from the model. */
    deleted: Buffer[],
};
