import {
    DeepCopy,
} from "../../util/common";

import {
    AlgoInterface,
    NodeAlgoValues,
} from "./types";

/**
 * Sort nodes on how they reference other nodes in their refId field.
 * We guarantee that a node which references another node is sorted after the referenced node.
 */
export class AlgoRefId implements AlgoInterface {
    protected orderByStorageTime: boolean;

    /** Each node is stored here. */
    protected nodeById1: {[id1: string]: NodeAlgoValues};

    /** Each node is clustered on its refId to build a graph, as if refId is parentId. */
    protected childrenPerParent: {[parentId1: string]: {[id1: string]: boolean}};

    /** All node id1s per level, sorted on creationTime. */
    protected levels: string[][];

    protected _isClosed: boolean;

    protected isDeletionTracking: boolean = false;

    protected deletionTracking: {[id1: string]: NodeAlgoValues} = {};

    /**
     * @param orderByStorageTime if true then order by storage time insteadof creationTime.
     *
     */
    constructor(orderByStorageTime: boolean = false) {
        this.orderByStorageTime = orderByStorageTime;
        this.nodeById1 = {};
        this.childrenPerParent = {};
        this.levels = [];
        this._isClosed = false;
    }

    public static GetId(): number {
        return 2;
    }

    public getId(): number {
        return 2;
    }

    public getLength(): number {
        let length = 0;

        this.levels.forEach( level => length = length + level.length );

        return length;
    }

    public getAllNodes(): {[id1: string]: NodeAlgoValues} {
        const allNodes: {[id1: string]: NodeAlgoValues} = {};

        for (const id1 in this.nodeById1) {
            allNodes[id1] = this.nodeById1[id1];
        }

        return allNodes;
    }

    /**
     * Add node(s) to the tree and to their designated levels.
     * If a missing parent node is added then the whole index needs to be recalculated.
     *
     * @returns [newNodes, transientUpdatesNodes][]
     * @throws on overflow
     */
    public add(nodes: NodeAlgoValues[]): [NodeAlgoValues[], NodeAlgoValues[]] {
        // Nodes already existing but with changed transient values.
        // These do not alter the tree.
        const transientNodes: NodeAlgoValues[] = [];

        // New nodes, added as leafs.
        // These do not disrupt the current tree structure.
        const leafNodes: NodeAlgoValues[] = [];

        // New nodes who happen to already be parent nodes to orphan nodes.
        // Inserting these nodes disrupts the tree and levels need to be recalculated.
        const parentNodes: NodeAlgoValues[] = [];

        nodes.forEach( (node: NodeAlgoValues) => {
            const id1Str = (node.id1 ?? Buffer.alloc(0)).toString("hex");

            if (this.isDeletionTracking) {
                delete this.deletionTracking[id1Str];
            }

            const existingNode = this.nodeById1[id1Str];

            if (!existingNode) {
                // This node does not exist in the tree. First check this node as if it is a missing parent node.
                // This means that its child nodes no longer are orphans and all those nodes below changes level in the tree.
                if (this.childrenPerParent[id1Str]) {
                    // This node is a missing parent for other nodes,
                    // this will take a re-indexing of the whole tree.
                    parentNodes.push(node);
                }
                else {
                    // No other node uses this node as a parent,
                    // the node is a leaf node and can just slip into a level.
                    leafNodes.push(node);
                }

                // Second, add this node as child to another node to make up the tree structure.
                const parentIdStr = (node.refId ?? Buffer.alloc(0)).toString("hex");
                const childNodes = this.childrenPerParent[parentIdStr] ?? {};
                this.childrenPerParent[parentIdStr] = childNodes;
                childNodes[id1Str] = true;

                this.nodeById1[id1Str] = node;
            }
            else {
                // The node already exists in the index.
                // Check if the node has updated transient values.
                if (!existingNode.transientHash.equals(node.transientHash)) {
                    // Replace current with this node.
                    this.nodeById1[id1Str] = node;
                    transientNodes.push(node);
                }
            }
        });

        if (parentNodes.length > 0) {
            // Re-index the whole tree.
            this.reIndex();
        }
        else if (leafNodes.length > 0) {
            // Only re-index specific levels of the tree.
            this.indexNodes(leafNodes);
        }

        return [ [...parentNodes, ...leafNodes], transientNodes];
    }

    public beginDeletionTracking() {
        this.isDeletionTracking = true;

        // Take copy of current nodes model.
        this.deletionTracking = {...this.nodeById1};
    }

    public commitDeletionTracking() {
        const deletedNodes = Object.values(this.deletionTracking);

        const indexes = this.getIndexes(deletedNodes);

        this.delete(indexes);

        this.isDeletionTracking = false;

        this.deletionTracking = {};
    }

    protected indexNodes(nodes: NodeAlgoValues[]) {
        // Add nodes to specific levels and re-index those levels.

        const levelsVisited: {[level: string]: string[]} = {};

        nodes.forEach( node => {
            const levelHeight = this.findLevel(node);
            if (levelHeight < 0) {
                return;
            }
            const levelSiblings = this.levels[levelHeight] ?? [];
            this.levels[levelHeight] = levelSiblings;
            levelsVisited[levelHeight] = levelSiblings;
            const id1Str = (node.id1 ?? Buffer.alloc(0)).toString("hex");
            levelSiblings.push(id1Str);
        });

        Object.values(levelsVisited).forEach( levelSiblings => {
            this.sort(levelSiblings);
        });
    }

    protected reIndex() {
        // Clear all levels, refill each level and re-sort all levels.
        this.levels.length = 0;
        this.indexNodes(Object.values(this.nodeById1));
    }

    protected sort(nodes: string[]) {
        nodes.sort( (idA: string, idB: string) => {
            const a = this.nodeById1[idA];
            const b = this.nodeById1[idB];
            if (!a || !b) {
                return 0;
            }

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

    protected findLevel(node: NodeAlgoValues): number {
        const id1Str = (node.id1 ?? Buffer.alloc(0)).toString("hex");

        if (!this.nodeById1[id1Str]) {
            return -1;
        }

        let levelHeight = 0;

        while (true) {
            const parentIdStr = (node.refId ?? Buffer.alloc(0)).toString("hex");
            node = this.nodeById1[parentIdStr];
            if (!node) {
                break;
            }
            levelHeight++;
        }

        return levelHeight;
    }

    public getNodeAtIndex(index: number): NodeAlgoValues | undefined {
        let level: string[] | undefined;
        let aggregatedCount = 0;

        for (let levelIndex=0; levelIndex<this.levels.length; levelIndex++) {
            level = this.levels[levelIndex];

            if (!level) {
                return undefined;
            }

            if (aggregatedCount + level.length > index) {
                break;
            }

            aggregatedCount = aggregatedCount + level.length;

            level = undefined;
        }

        if (!level) {
            return undefined;
        }

        const id1Str = level[index - aggregatedCount];

        return this.nodeById1[id1Str];
    }

    public delete(indexes: number[]) {
        indexes = indexes.slice();  // copy it
        indexes.sort();

        while (indexes.length > 0) {
            const index = indexes.pop();

            if (index === undefined) {
                continue;
            }

            const [level, index2] = this.indexToLevel(index);
            if (level === -1) {
                continue;
            }

            const levelSiblings = this.levels[level];
            if (!levelSiblings) {
                continue;
            }

            const id1Str = levelSiblings[index2];
            if (!id1Str) {
                continue;
            }
            const node = this.nodeById1[id1Str];
            if (!node) {
                continue;
            }

            delete this.nodeById1[id1Str];

            const parentIdStr = (node.refId ?? Buffer.alloc(0)).toString("hex");
            const childNodes = this.childrenPerParent[parentIdStr] ?? {};
            delete childNodes[id1Str];
            if (Object.keys(childNodes).length === 0) {
                delete this.childrenPerParent[parentIdStr];
            }
        }

        this.reIndex();
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
            endIndex = this.getLength();
            startIndex = Math.max(endIndex - tail, 0);
        }

        if ((cursorId1 && cursorId1.length > 0) || cursorIndex > -1) {

            if (cursorId1 && cursorId1.length > 0) {
                const id1Str = cursorId1.toString("hex");

                const cursorNode = this.nodeById1[id1Str];

                try {
                    if (cursorNode) {
                        const cursorIndex2 = this.getIndexes([cursorNode])[0];
                        cursorIndex = cursorIndex2;
                    }
                }
                catch(e) {
                    // Cursor not found
                    // fall through to use default cursorIndex, if set.
                }
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

        const nodes: NodeAlgoValues[] = [];
        const indexes: number[] = [];

        for (let index = startIndex; index < endIndex; index++) {
            const node = this.getNodeAtIndex(index);

            if (!node) {
                break;
            }

            nodes.push(node);

            indexes.push(index);
        }

        if (reverse) {
            nodes.reverse();
            indexes.reverse();
        }

        return [nodes, indexes];
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
            const level = this.findLevel(node);
            if (level < 0) {
                throw new Error("Unexpected error in CRDT model");
            }

            const levelSiblings = this.levels[level];

            if (!levelSiblings) {
                throw new Error("Unexpected error in CRDT model");
            }

            let aggregatedIndex = 0;
            for (let levelIndex=0; levelIndex<level; levelIndex++) {
                aggregatedIndex = aggregatedIndex + (this.levels[levelIndex] ?? []).length;
            }

            for (let subIndex=0; subIndex<levelSiblings.length; subIndex++) {
                const node2Id1Str = levelSiblings[subIndex];
                if (node2Id1Str) {
                    if (node2Id1Str === id1Str) {
                        return aggregatedIndex + subIndex;
                    }
                }
            }

            throw new Error("Unexpected error in CRDT model");
        });
    }

    protected indexToLevel(index: number): [number, number] {
        for (let level=0; level<this.levels.length; level++) {
            if (this.levels[level].length > index) {
                return [level, index];
            }
            index = index - this.levels[level].length;
        }

        return [-1, -1];
    }

    public close() {
        if (this._isClosed) {
            return;
        }

        this._isClosed = true;

        // Clear out the memory used.
        this.nodeById1 = {};
        this.childrenPerParent = {};
        this.levels = [];
    }
}
