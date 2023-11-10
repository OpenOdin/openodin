import {
    AlgoInterface,
    NodeAlgoValues,
} from "./types";

/**
 * Sort nodes on creationTime or storageTime and make sure there are no duplicate entries.
 */
export class AlgoSorted implements AlgoInterface {
    protected orderByStorageTime: boolean;
    protected nodeIndexById1: {[id1: string]: number};
    protected nodes: NodeAlgoValues[];
    protected _isClosed: boolean;
    protected isDeletionTracking: boolean = false;
    protected deletionTracking: {[id1: string]: number} = {};

    /**
     * @param orderByStorageTime if true then order by storage time insteadof creationTime.
     *
     */
    constructor(orderByStorageTime: boolean = false) {
        this.orderByStorageTime = orderByStorageTime;
        this.nodeIndexById1 = {};
        this.nodes = [];
        this._isClosed = true;
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

    public getAllNodes(): {[id1: string]: NodeAlgoValues} {
        const allNodes: {[id1: string]: NodeAlgoValues} = {};

        for (const id1 in this.nodeIndexById1) {
            allNodes[id1] = this.nodes[this.nodeIndexById1[id1]];
        }

        return allNodes;
    }

    /**
     * @returns [newNodes, transientUpdatesNodes][]
     * @throws on overflow
     */
    public add(nodes: NodeAlgoValues[]): [NodeAlgoValues[], NodeAlgoValues[]] {
        const newNodes: NodeAlgoValues[] = [];
        const transientNodes: NodeAlgoValues[] = [];

        if (nodes.length > 0) {
            nodes.forEach( (node: NodeAlgoValues) => {
                const id1 = node.id1;
                if (!id1) {
                    return;
                }

                const id1Str = id1.toString("hex");

                if (this.isDeletionTracking) {
                    delete this.deletionTracking[id1Str];
                }

                const existingIndex = this.nodeIndexById1[id1Str];

                if (existingIndex !== undefined) {
                    // Node already exists in the cache.
                    // See if the transient values have changed and in such
                    // case replace the node here and return it as inserted.
                    if (!node.transientHash.equals(this.nodes[existingIndex].transientHash)) {
                        this.nodes[existingIndex] = node;
                        transientNodes.push(node);
                    }
                }
                else {
                    newNodes.push(node);
                }
            });

            this.nodes.push(...newNodes);

            this.nodes.sort( (a: NodeAlgoValues, b: NodeAlgoValues) => {
                const diffCreationTime = (a.creationTime ?? 0) - (b.creationTime ?? 0);
                const diffStorageTime = (a.transientStorageTime ?? 0) - (b.transientStorageTime ?? 0);

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
                    const id1a = a.id1;
                    const id1b = b.id1;
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

    public beginDeletionTracking() {
        this.isDeletionTracking = true;

        // Take copy of current nodes model.
        this.deletionTracking = {...this.nodeIndexById1};
    }

    public commitDeletionTracking() {
        const deletedNodeId1s = Object.keys(this.deletionTracking);

        const indexes = deletedNodeId1s.map( id1Str => this.nodeIndexById1[id1Str] );

        this.delete(indexes);

        this.isDeletionTracking = false;

        this.deletionTracking = {};
    }

    /**
     * @returns undefined if cursor node does not exist.
     */
    public get(cursorId1: Buffer | undefined, cursorIndex: number, head: number, tail: number, reverse: boolean):
        [NodeAlgoValues[], number[]] | undefined
    {

        if ((tail === 0 && head === 0) || (tail !== 0 && head !== 0)) {
            return [[], []];
        }

        const length = this.getLength();

        if (head !== 0) {
            if (head <= -1) {
                head = length;
            }
            else {
                head = Math.min(head, length);
            }
        }

        if (tail !== 0) {
            if (tail <= -1) {
                tail = length;
            }
            else {
                tail = Math.min(tail, length);
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

        if ((cursorId1 && cursorId1.length > 0) || cursorIndex > -1) {

            if (cursorId1 && cursorId1.length > 0) {
                const id1Str = cursorId1.toString("hex");

                const cursorIndex2 = this.nodeIndexById1[id1Str];

                if (cursorIndex2 !== undefined) {
                    cursorIndex = cursorIndex2;
                }
                //else fallback to use default cursorIndex, if set.
            }

            if (cursorIndex < 0) {
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
                    const id1 = node.id1;
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
            const id1 = node.id1;
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
    public getIndexes(nodes: NodeAlgoValues[]): number[] {
        return nodes.map( (node: NodeAlgoValues) => {
            const id1 = node.id1;
            if (!id1) {
                // cannot happen
                throw new Error("Unexpected error in CRDT model");
            }
            const id1Str = id1.toString("hex");
            const index = this.nodeIndexById1[id1Str];
            if (index === undefined) {
                throw new Error("Unexpected error in CRDT model");
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
