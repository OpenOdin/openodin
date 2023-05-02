import {
    NodeInterface,
} from "../../datamodel";

export const MAX_TRANSFORMER_LENGTH = 10000;

export interface AlgoInterface {
    getId(): number;
    getLength(): number;
    copyModel(): any;
    setModel(model: any): void;
    getAllNodes(): {[id1: string]: NodeInterface};
    add(nodes: NodeInterface[]): [NodeInterface[], NodeInterface[]];
    delete(indexes: number[]): void;
    get(cursorId1: Buffer | undefined, head: number, tail: number): [NodeInterface[], number[]] | undefined;
    getIndexes(nodes: NodeInterface[]): number[];
    close(): void;
}
