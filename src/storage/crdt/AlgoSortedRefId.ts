import {
    AlgoInterface,
    ExtractNodeValuesRefId,
    NodeValuesRefId,
} from "./types";

import {
    DataInterface,
} from "../../datamodel/node/secondary/interface";

import {
    CRDTMessagesAnnotations,
} from "./CRDTMessagesAnnotations";

/**
 * Sort nodes on creationTime or storageTime and make sure there are no duplicate entries.
 */
export class AlgoSortedRefId implements AlgoInterface {
    protected orderByStorageTime: boolean;
    protected nodeIndexById1: {[id1: string]: number} = {};
    protected nodesId1ById: {[id: string]: {[id1: string]: Buffer}} = {};
    protected nodes: NodeValuesRefId[] = [];
    protected _isClosed: boolean;
    protected isDeletionTracking: boolean = false;
    protected deletionTracking: {[id1: string]: number} = {};
    protected annotations?: string;

    /** If set then annotations returned are prioritized for this key. */
    protected targetPublicKey: string;

    /**
     * @param orderByStorageTime if true then order by storage time insteadof creationTime.
     * @param conf if set should be JSON.
     * @param targetPublicKey is using annotations this should be set.
     */
    constructor(orderByStorageTime: boolean = false, conf: string = "", targetPublicKey: string = "") {
        this.orderByStorageTime = orderByStorageTime;
        this._isClosed = true;

        if (conf) {
            try {
                const obj = JSON.parse(conf);

                this.annotations = obj.annotations?.format;
            }
            catch(e) {
                // Do nothing
            }
        }

        this.targetPublicKey = targetPublicKey;
    }

    public static GetId(): number {
        return 3;
    }

    public getId(): number {
        return 3;
    }

    public getLength(): number {
        return this.nodes.length;
    }

    public getAllNodes(): {[id1: string]: NodeValuesRefId} {
        const allNodes: {[id1: string]: NodeValuesRefId} = {};

        for (const id1 in this.nodeIndexById1) {
            allNodes[id1] = this.nodes[this.nodeIndexById1[id1]];
        }

        return allNodes;
    }

    /**
     * @returns [newNodes, transientUpdatesNodesId1s][]
     * @throws on overflow
     */
    public add(nodes: DataInterface[]): [NodeValuesRefId[], Buffer[]] {
        const newNodes: NodeValuesRefId[] = [];
        const transientNodes: Set<Buffer> = new Set();

        const nodesLength = nodes.length;
        for (let i=0; i<nodesLength; i++) {
            const node = nodes[i];

            const id1 = node.getId1();

            const parentId = node.getParentId();

            if (!id1 || !parentId) {
                continue;
            }

            // Check if this is a child node and if we are using annotations.
            // If not using annotations then child nodes will not be treated differently.
            //
            if (this.annotations === "messages") {
                // Get all parents, in case multiple nodes are leveraging
                // the id2 feature using the same id.
                //
                const parentNodes = this.getNodesById(parentId);

                if (parentNodes.length > 0) {
                    const updatedNodesId1s =
                        CRDTMessagesAnnotations.Factory(node, parentNodes, this.targetPublicKey);

                    updatedNodesId1s.forEach( id1 => transientNodes.add(id1) );

                    continue;
                }
                else {
                    // Fall through as this cannot be an annotation node.
                }
            }

            const id1Str = id1.toString("hex");

            if (this.isDeletionTracking) {
                delete this.deletionTracking[id1Str];
            }

            const nodeValues = ExtractNodeValuesRefId(node);

            const existingIndex = this.nodeIndexById1[id1Str];

            if (existingIndex !== undefined) {
                // Node already exists in the cache.

                // See if the transient values have changed and in such
                // case replace the node here and return it as inserted.
                if (!nodeValues.transientHash.equals(this.nodes[existingIndex].transientHash)) {
                    this.nodes[existingIndex] = nodeValues;
                    transientNodes.add(nodeValues.id1);
                }

                if (this.isDeletionTracking) {
                    // Remove the annotations of the node since they will be added back
                    // accordingly.
                    delete nodeValues.annotations;
                }
            }
            else {
                const id = nodeValues.id2 ?? nodeValues.id1;

                const idStr = id.toString("hex");

                const o = this.nodesId1ById[idStr] ?? {};

                this.nodesId1ById[idStr] = o;

                o[id1Str] = id1;

                // Note that we are appending the nodes at first,
                // the array will be sorted below.
                //
                this.nodeIndexById1[id1Str] = this.nodes.length;
                this.nodes.push(nodeValues);

                newNodes.push(nodeValues);
            }
        }

        // Note: this could be optimzed since new nodes are more likely to be
        // appended, not inserted.
        //

        this.nodes.sort( (a: NodeValuesRefId, b: NodeValuesRefId) => {
            return this.isGreater(a, b) ? 1 : -1;
        });

        // After nodes have been sorted on time,
        // check their refId.
        //

        let changed = true;
        while (changed) {
            changed = false;

            this.updateIndexes();

            for (let index = this.nodes.length - 1; index >= 0; index--) {
                const nodeValues = this.nodes[index];

                if (nodeValues.refId) {
                    const id1Str = nodeValues.refId.toString("hex");
                    const referencedIndex = this.nodeIndexById1[id1Str];

                    if (referencedIndex !== undefined && referencedIndex > index) {
                        // Move this node to be beyond its refId node.
                        //
                        // Remove from current index
                        this.nodes.splice(index, 1);

                        // Find best position to insert after referenced node
                        //
                        let referencedIndex2 = referencedIndex;

                        for (referencedIndex2 = referencedIndex; referencedIndex2 < this.nodes.length; referencedIndex2++) {
                            const nodeValues2 = this.nodes[referencedIndex2];

                            if (this.isGreater(nodeValues2, nodeValues)) {
                                break;
                            }
                        }

                        this.nodes.splice(referencedIndex2, 0, nodeValues);

                        // Start over from the top
                        //
                        changed = true;

                        break;
                    }
                }
            }
        }

        return [newNodes, Array.from(transientNodes.values())];
    }

    protected isGreater(a: NodeValuesRefId, b: NodeValuesRefId): boolean {
        const diffCreationTime = (a.creationTime ?? 0) - (b.creationTime ?? 0);

        const diffStorageTime = (a.transientStorageTime ?? 0) -
            (b.transientStorageTime ?? 0);

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

        return diff > 0;
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
        [NodeValuesRefId[], number[]] | undefined
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

                    const id = node.id2 ?? node.id1;

                    const id1Str = id1.toString("hex");

                    delete this.nodeIndexById1[id1Str];

                    const idStr = id.toString("hex");

                    delete (this.nodesId1ById[idStr] ?? {})[id1Str];
                }
            }
        }

        this.updateIndexes();
    }

    /**
     * @returns nodes based on their id (id2 || id1).
     */
    protected getNodesById(id: Buffer): NodeValuesRefId[] {
        const idStr = id.toString("hex");

        const id1sStr = Object.keys(this.nodesId1ById[idStr] ?? {});

        return id1sStr.map( id1Str => this.nodes[this.nodeIndexById1[id1Str]] ).filter( nodeValues => nodeValues );
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
     * Get indexes of nodes based on their id1.
     *
     * @throws if node does not exist in model
     */
    public getIndexes(nodes: NodeValuesRefId[]): number[] {
        return nodes.map( (node: NodeValuesRefId) => {
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
        this.nodesId1ById = {};
        this.nodes = [];
    }
}
