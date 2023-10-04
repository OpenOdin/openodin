import {
    NodeInterface,
} from "../../datamodel";

import {
    DeepCopy,
} from "../../util/common";

import {
    AlgoInterface,
    MAX_TRANSFORMER_LENGTH,
} from "./types";

/**
 * Sort nodes on how they reference other nodes in their refId field.
 * We guarantee that a node which references another node is sorted after the referenced node.
 */
export class AlgoRefId implements AlgoInterface {
    /** Each node is stored here. */
    protected nodeById1: {[id1: string]: NodeInterface};

    /** Each node is clustered on its refId to build a graph, as if refId is parentId. */
    protected childrenPerParent: {[parentId1: string]: {[id1: string]: boolean}};

    /** All node id1s per level, sorted on creationTime. */
    protected levels: string[][];

    protected _isClosed: boolean;

    protected maxLength: number;

    constructor(maxLength: number = MAX_TRANSFORMER_LENGTH) {
        this.nodeById1 = {};
        this.childrenPerParent = {};
        this.levels = [];
        this._isClosed = false;
        this.maxLength = maxLength;
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

    public copyModel(): any {
        return [{...this.nodeById1}, {...this.childrenPerParent}, DeepCopy(this.levels)];
    }

    public setModel(model: any) {
        this.nodeById1          = model[0];
        this.childrenPerParent  = model[1];
        this.levels             = model[2];
    }

    public getAllNodes(): {[id1: string]: NodeInterface} {
        const allNodes: {[id1: string]: NodeInterface} = {};

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
    public add(nodes: NodeInterface[]): [NodeInterface[], NodeInterface[]] {
        if (this.getLength() + nodes.length > this.maxLength) {
            throw new Error(`maximum length of transformer (${this.maxLength}) overflown`);
        }

        // Nodes already existing but with changed transient values.
        // These do not alter the tree.
        const transientNodes: NodeInterface[] = [];

        // New nodes, added as leafs.
        // These do not disrupt the current tree structure.
        const leafNodes: NodeInterface[] = [];

        // New nodes who happen to already be parent nodes to orphan nodes.
        // Inserting these nodes disrupts the tree and levels need to be recalculated.
        const parentNodes: NodeInterface[] = [];

        nodes.forEach( (node: NodeInterface) => {
            const id1Str = (node.getId1() ?? Buffer.alloc(0)).toString("hex");

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
                const parentIdStr = (node.getRefId() ?? Buffer.alloc(0)).toString("hex");
                const childNodes = this.childrenPerParent[parentIdStr] ?? {};
                this.childrenPerParent[parentIdStr] = childNodes;
                childNodes[id1Str] = true;

                this.nodeById1[id1Str] = node;
            }
            else {
                // The node already exists in the index.
                // Check if the node has updated transient values.
                if (!existingNode.hashTransient().equals(node.hashTransient())) {
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

    protected indexNodes(nodes: NodeInterface[]) {
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
            const id1Str = (node.getId1() ?? Buffer.alloc(0)).toString("hex");
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
            let diff = (a.getCreationTime() || 0) - (b.getCreationTime() || 0);

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

    protected findLevel(node: NodeInterface): number {
        const id1Str = (node.getId1() ?? Buffer.alloc(0)).toString("hex");

        if (!this.nodeById1[id1Str]) {
            return -1;
        }

        let levelHeight = 0;

        while (true) {
            const parentIdStr = (node.getRefId() ?? Buffer.alloc(0)).toString("hex");
            node = this.nodeById1[parentIdStr];
            if (!node) {
                break;
            }
            levelHeight++;
        }

        return levelHeight;
    }

    public getNodeAtIndex(index: number): NodeInterface | undefined {
        let level: string[] | undefined;
        let aggregatedCount = 0;

        for (let levelIndex=0; levelIndex<this.levels.length; levelIndex++) {
            level = this.levels[levelIndex];

            if (!level) {
                return undefined;
            }

            if (aggregatedCount + level.length >= index) {
                break;
            }

            aggregatedCount = aggregatedCount + level.length;
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

            const parentIdStr = (node.getRefId() ?? Buffer.alloc(0)).toString("hex");
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
            endIndex = this.getLength();
            startIndex = Math.max(endIndex - tail, 0);
        }

        if (cursorId1 && cursorId1.length > 0) {
            const id1Str = cursorId1.toString("hex");

            const cursorNode = this.nodeById1[id1Str];

            if (cursorNode === undefined) {
                return undefined;
            }

            try {
                const cursorIndex = this.getIndexes([cursorNode])[0];

                if (head) {
                    startIndex = cursorIndex + 1;
                    endIndex = startIndex + head;
                }
                else {
                    endIndex = cursorIndex;
                    startIndex = Math.max(endIndex - tail, 0);
                }
            }
            catch(e) {
                return undefined;
            }
        }

        const nodes: NodeInterface[] = [];
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
    public getIndexes(nodes: NodeInterface[]): number[] {
        return nodes.map( (node: NodeInterface) => {
            const id1 = node.getId1();
            if (!id1) {
                // cannot happen
                throw new Error("Unexpected error in transformed model");
            }
            const id1Str = id1.toString("hex");
            const level = this.findLevel(node);
            if (level < 0) {
                throw new Error("Unexpected error in transformed model");
            }

            const levelSiblings = this.levels[level];

            if (!levelSiblings) {
                throw new Error("Unexpected error in transformed model");
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

            throw new Error("Unexpected error in transformed model");
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
