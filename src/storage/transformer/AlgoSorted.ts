import {
    NodeInterface,
} from "../../datamodel";

import {
    MAX_TRANSFORMER_LENGTH,
    AlgoInterface,
} from "./types";

/**
 * Sort nodes on creationTime or storageTime and make sure there are no duplicate entries.
 */
export class AlgoSorted implements AlgoInterface {
    protected orderByStorageTime: boolean;
    protected nodeIndexById1: {[id1: string]: number};
    protected nodes: NodeInterface[];
    protected _isClosed: boolean;
    protected maxLength: number;

    /**
     * @param orderByStorageTime if true then order by storage time insteadof creationTime.
     * @param maxLength
     *
     */
    constructor(maxLength: number = MAX_TRANSFORMER_LENGTH, orderByStorageTime: boolean = false) {
        this.orderByStorageTime = orderByStorageTime;
        this.nodeIndexById1 = {};
        this.nodes = [];
        this._isClosed = true;
        this.maxLength = maxLength;
    }

    public static GetId(): number {
        return 1;
    }

    public getId(): number {
        return 1;
    }

    public getLength(): number {
        return this.nodes.length;
    }

    public copyModel(): any {
        return [{...this.nodeIndexById1}, this.nodes.slice()];
    }

    public setModel(model: any) {
        this.nodeIndexById1 = model[0];
        this.nodes = model[1];
    }

    public getAllNodes(): {[id1: string]: NodeInterface} {
        const allNodes: {[id1: string]: NodeInterface} = {};

        for (const id1 in this.nodeIndexById1) {
            allNodes[id1] = this.nodes[this.nodeIndexById1[id1]];
        }

        return allNodes;
    }

    /**
     * @returns [newNodes, transientUpdatesNodes][]
     * @throws on overflow
     */
    public add(nodes: NodeInterface[]): [NodeInterface[], NodeInterface[]] {
        if (this.getLength() + nodes.length > this.maxLength) {
            throw new Error(`maximum length of transformer (${this.maxLength}) overflowed`);
        }

        const newNodes: NodeInterface[] = [];
        const transientNodes: NodeInterface[] = [];

        if (nodes.length > 0) {
            nodes.forEach( (node: NodeInterface) => {
                const id1 = node.getId1();
                if (!id1) {
                    return;
                }

                const id1Str = id1.toString("hex");
                const existingIndex = this.nodeIndexById1[id1Str];
                if (existingIndex !== undefined) {
                    // Node already exists in the cache.
                    // See if the transient values have changed and in such
                    // case replace the node here and return it as inserted.
                    if (!node.hashTransient().equals(this.nodes[existingIndex].hashTransient())) {
                        this.nodes[existingIndex] = node;
                        transientNodes.push(node);
                    }
                }
                else {
                    newNodes.push(node);
                }
            });

            this.nodes.push(...newNodes);

            this.nodes.sort( (a: NodeInterface, b: NodeInterface) => {
                const diffCreationTime = (a.getCreationTime() ?? 0) - (b.getCreationTime() ?? 0);
                const diffStorageTime = (a.getTransientStorageTime() ?? 0) - (b.getTransientStorageTime() ?? 0);

                let diff = 0;

                if (this.orderByStorageTime) {
                    diff = diffStorageTime;
                    if (diff === 0) {
                        diff = diffCreationTime;
                    }
                }
                else {
                    diff = diffCreationTime;
                }

                if (diff === 0) {
                    const id1a = a.getId1();
                    const id1b = b.getId1();
                    if (id1a && id1b) {
                        diff = id1a.compare(id1b);
                    }
                }

                return diff;
            });
        }

        if (newNodes.length > 0 || transientNodes.length > 0) {
            this.updateIndexes();
        }

        return [newNodes, transientNodes];
    }

    /**
     * @returns undefined if cursor node does not exist.
     */
    public get(cursorId1: Buffer | undefined, head: number, tail: number, reverse: boolean):
        [NodeInterface[], number[]] | undefined {

        if ((tail === 0 && head === 0) || (tail !== 0 && head !== 0)) {
            return [[], []];
        }

        if (head !== 0) {
            if (head <= -1) {
                head = MAX_TRANSFORMER_LENGTH;
            }
            else {
                head = Math.min(head, MAX_TRANSFORMER_LENGTH);
            }
        }

        if (tail !== 0) {
            if (tail <= -1) {
                tail = MAX_TRANSFORMER_LENGTH;
            }
            else {
                tail = Math.min(tail, MAX_TRANSFORMER_LENGTH);
            }
        }

        if (reverse) {
            [tail, head] = [head, tail];
        }

        let startIndex  = 0;
        let endIndex    = head;

        if (tail) {
            endIndex = this.nodes.length;
            startIndex = Math.max(endIndex - tail, 0);
        }

        if (cursorId1 && cursorId1.length > 0) {
            const id1Str = cursorId1.toString("hex");

            const cursorIndex = this.nodeIndexById1[id1Str];

            if (cursorIndex === undefined) {
                return undefined;
            }

            if (head) {
                startIndex = cursorIndex + 1;
                endIndex = startIndex + head;
            }
            else {
                endIndex = cursorIndex;
                startIndex = Math.max(endIndex - tail, 0);
            }
        }

        const nodes = this.nodes.slice(startIndex, endIndex);
        const indexes = nodes.map( (node, index) => startIndex + index);

        if (reverse) {
            nodes.reverse();
            indexes.reverse();
        }

        return [nodes, indexes];
    }

    public delete(indexes: number[]) {
        indexes = indexes.slice();  // copy it
        indexes.sort();

        while (indexes.length > 0) {
            const index = indexes.pop();
            if (index !== undefined) {
                const node = this.nodes.splice(index, 1)[0];
                if (node) {
                    const id1 = node.getId1();
                    if (!id1) {
                        return;
                    }

                    const id1Str = id1.toString("hex");
                    delete this.nodeIndexById1[id1Str];
                }
            }
        }

        this.updateIndexes();
    }

    protected updateIndexes(start: number = 0) {
        for (let i=start; i<this.nodes.length; i++) {
            const node = this.nodes[i];
            const id1 = node.getId1();
            if (!id1) {
                continue;
            }
            const id1Str = id1.toString("hex");
            this.nodeIndexById1[id1Str] = i;
        }
    }

    /**
     * @throws if node does not exist in model
     */
    public getIndexes(nodes: NodeInterface[]): number[] {
        return nodes.map( (node: NodeInterface) => {
            const id1 = node.getId1();
            if (!id1) {
                // cannot happen
                throw new Error("Unexpected error in transformed model");
            }
            const id1Str = id1.toString("hex");
            const index = this.nodeIndexById1[id1Str];
            if (index === undefined) {
                throw new Error("Unexpected error in transformed model");
            }
            return index;
        });
    }

    public close() {
        if (this._isClosed) {
            return;
        }

        this._isClosed = true;

        // Clear out the memory used.
        this.nodeIndexById1 = {};
        this.nodes = [];
    }
}
