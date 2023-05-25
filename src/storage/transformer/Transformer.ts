import {
    NodeInterface,
} from "../../datamodel";

import {
    DeepHash,
} from "../../util/common";

import {
    AlgoSorted,
} from "./AlgoSorted";

import {
    AlgoRefId,
} from "./AlgoRefId";

import {
    AlgoInterface,
} from "./types";

import {
    FetchReplyData,
    HandleFetchReplyData,
} from "../types";

import {
    FetchRequest,
    Status,
} from "../../types";

export class Transformer {
    protected algoFunctions: AlgoInterface[];
    protected _isClosed: boolean;
    protected fetchRequest: FetchRequest;
    protected isPristine = true;
    protected maxLength: number;

    /**
     * @throws if algos are not supported.
     */
    constructor(fetchRequest: FetchRequest, maxLength: number = 10000) {
        this.fetchRequest = fetchRequest;
        this.maxLength = maxLength;

        this.algoFunctions = [];

        this._isClosed = false;

        let previousAlgo: AlgoInterface | undefined;
        this.fetchRequest.transform.algos.forEach( algoId => {
            let algo: AlgoInterface | undefined;

            if (algoId === AlgoSorted.GetId()) {
                if (previousAlgo) {
                    throw new Error("AlgoSorted does not support using a previous algo object.");
                }
                algo = new AlgoSorted(this.fetchRequest.transform.reverse, fetchRequest.query.orderByStorageTime, this.maxLength);
            }
            else if (algoId === AlgoRefId.GetId()) {
                if (previousAlgo) {
                    throw new Error("AlgoRefId does not support using a previous algo object.");
                }
                algo = new AlgoRefId(this.maxLength);
            }
            else {
                throw new Error(`Transformer algo function with ID ${algoId} not available.`);
            }

            this.algoFunctions.push(algo);
            previousAlgo = algo;
        });
    }

    public getLength(): number {
        const algo = this.algoFunctions.slice(-1)[0];

        if (algo) {
            return algo.getLength();
        }

        return 0;
    }

    public copy(fetchRequest: FetchRequest): Transformer {
        const algoFunctions = this.getAlgoFunctions();

        const transformer = new Transformer(fetchRequest);

        const algoFunctions2 = transformer.getAlgoFunctions();

        algoFunctions.forEach( (fn: AlgoInterface, i) => {
            algoFunctions2[i].setModel(fn.copyModel());
        });

        return transformer;
    }

    public getAlgoFunctions(): AlgoInterface[] {
        return this.algoFunctions;
    }

    public getAllNodes(): {[id1: string]: NodeInterface} {
        const algo = this.algoFunctions.slice(-1)[0];

        if (algo) {
            return algo.getAllNodes();
        }

        return {};
    }

    /** Add data to last algo in sequence. */
    public add(nodes: NodeInterface[]): [NodeInterface[], NodeInterface[]] {
        const algo = this.algoFunctions.slice(-1)[0];

        if (algo) {
            return algo.add(nodes);
        }

        return [nodes, []];
    }

    /** Deleted data from last algo in sequence. */
    public delete(indexes: number[]) {
        const algo = this.algoFunctions.slice(-1)[0];

        if (algo) {
            return algo.delete(indexes);
        }
    }

    /** Get data from the last algo. */
    public get(cursorId1: Buffer, head: number, tail: number): [NodeInterface[], number[]] | undefined {
        const algo = this.algoFunctions.slice(-1)[0];

        if (algo) {
            return algo.get(cursorId1, head, tail);
        }

        return [[], []];
    }

    public getIndexes(nodes: NodeInterface[]): number[] {
        const algo = this.algoFunctions.slice(-1)[0];

        if (algo) {
            return algo.getIndexes(nodes);
        }

        return [];
    }

    public close() {
        if (this._isClosed) {
            return;
        }

        this._isClosed = true;
        this.algoFunctions.forEach( (algoFn: AlgoInterface) => algoFn.close() );
    }

    /**
     * This chains the Storage.handleFetchReplyDataFactory function.
     */
    public handleFetchReplyDataFactory(handleFetchReplyData: HandleFetchReplyData): HandleFetchReplyData {

        let allNodes: {[id1: string]: NodeInterface} = {};
        let embed: NodeInterface[] = [];
        let rowCount = 0;

        return (fetchReplyData: FetchReplyData) => {
            try {
                const status = fetchReplyData.status ?? Status.RESULT;

                if (status !== Status.RESULT) {
                    handleFetchReplyData(fetchReplyData);
                    return;
                }

                if (this.isPristine) {
                    // First time, fill model.
                    this.add(fetchReplyData.nodes ?? []);
                    embed.push(...fetchReplyData.embed ?? []);

                    rowCount += fetchReplyData.rowCount ?? 0;

                    if (fetchReplyData.isLast) {
                        this.isPristine = false;

                        const result = this.get(this.fetchRequest.transform.cursorId1, this.fetchRequest.transform.head, this.fetchRequest.transform.tail);

                        if (!result) {
                            const fetchReplyData: FetchReplyData = {
                                status: Status.MISSING_CURSOR,
                            };

                            handleFetchReplyData(fetchReplyData);

                            embed = [];
                            rowCount = 0;

                            return;
                        }

                        const [nodes, indexes] = result;

                        const fetchReplyData: FetchReplyData = {
                            nodes,
                            indexes,
                            embed,
                            rowCount,
                        };

                        handleFetchReplyData(fetchReplyData);

                        embed = [];
                        rowCount = 0;
                    }
                }
                else if (this.fetchRequest.transform.includeDeleted && this.fetchRequest.query.cutoffTime === 0n) {
                    // This is a full refetch done to diff deleted nodes.
                    //

                    if (fetchReplyData.isFirst) {
                        allNodes = this.getAllNodes();
                    }

                    const nodesToAdd    = fetchReplyData.nodes ?? [];
                    const embed         = fetchReplyData.embed ?? [];
                    rowCount            += fetchReplyData.rowCount ?? 0;

                    // For every node which comes in we tick it off from the current model.
                    //
                    const nodesLength = nodesToAdd.length;
                    for (let index=0; index<nodesLength; index++) {
                        const node = nodesToAdd[index];
                        const id1Str = (node.getId1() as Buffer).toString("hex");
                        delete allNodes[id1Str];
                    }

                    // Send positive diff.
                    //
                    const [nodes, indexes] = this.handleAdd(nodesToAdd);

                    if (nodes.length > 0 || embed.length > 0) {
                        const fetchReplyData: FetchReplyData = {
                            nodes,
                            indexes,
                            embed,
                            rowCount,
                        };

                        handleFetchReplyData(fetchReplyData);
                    }

                    if (fetchReplyData.isLast) {
                        // Send negative diff
                        //

                        const deletedNodes = Object.values(allNodes);
                        allNodes = {};

                        const deletedNodesId1 = this.handleDiff(deletedNodes);

                        if (deletedNodesId1.length > 0) {
                            const fetchReplyData: FetchReplyData = {
                                deletedNodesId1,
                                rowCount,
                            };

                            handleFetchReplyData(fetchReplyData);
                        }

                        rowCount = 0;
                    }
                }
                else {
                    // Add nodes and return positive diff.
                    //

                    const nodesToAdd    = fetchReplyData.nodes ?? [];
                    const embed         = fetchReplyData.embed ?? [];

                    const [nodes, indexes] = this.handleAdd(nodesToAdd);

                    if (nodes.length > 0 || embed.length > 0) {
                        const fetchReplyData: FetchReplyData = {
                            nodes,
                            indexes,
                            embed,
                        };

                        handleFetchReplyData(fetchReplyData);
                    }
                }
            }
            catch(e) {
                const error = `Transformer failed: ${e}`;
                const fetchReplyData: FetchReplyData = {
                    status: Status.ERROR,
                    error,
                };

                handleFetchReplyData(fetchReplyData);
            }
        };
    }

    protected handleAdd(nodesToAdd: NodeInterface[]): [NodeInterface[], number[]] {
        const [insertedNodes, transientUpdatedNodes] = this.add(nodesToAdd);

        const insertedNodesIndexes = this.getIndexes(insertedNodes);

        const items = insertedNodes.map( (node, i) => { return {node, index: insertedNodesIndexes[i]} } );

        items.sort( (a, b) => a.index - b.index );

        const nodes = items.map( item => item.node );

        // Turn this index negative according to our formula,
        // negative indexes signal that the node is inserted into the model.
        const indexes = items.map( item => (item.index + 1) * -1 );

        if (this.fetchRequest.query.preserveTransient) {
            // Also add already existing nodes which has updated
            // transient values.
            //
            // Since these nodes are for existing indexes we.
            //
            // Updated nodes are not needed to be sorted, so we don't.
            const updatedNodesIndexes = this.getIndexes(transientUpdatedNodes);

            nodes.push(...transientUpdatedNodes);

            // Updated indexes are expected to be posive or zero (compared to insert node indexes
            // which are negative).
            indexes.push(...updatedNodesIndexes);
        }

        return [nodes, indexes];
    }

    protected handleDiff(deletedNodes: NodeInterface[]): Buffer[] {
        const indexes = this.getIndexes(deletedNodes);

        this.delete(indexes);

        const id1s: Buffer[] = deletedNodes.map( node => node.getId1() as Buffer );

        return id1s;
    }

    public static HashKey(fetchRequest: FetchRequest): string {
        const triggerNodeId = fetchRequest.transform.cachedTriggerNodeId.length > 0 ? fetchRequest.transform.cachedTriggerNodeId : fetchRequest.query.triggerNodeId;

        const values: any = [
            fetchRequest.query.clientPublicKey,
            fetchRequest.query.targetPublicKey,
            fetchRequest.query.depth,
            fetchRequest.query.rootNodeId1,
            fetchRequest.query.discardRoot,
            fetchRequest.query.descending,
            fetchRequest.query.ignoreInactive,
            fetchRequest.query.ignoreOwn,
            fetchRequest.query.match,
            fetchRequest.query.preserveTransient,
            fetchRequest.transform.algos,
            fetchRequest.transform.reverse,
            triggerNodeId,
            fetchRequest.transform.cacheId,
        ];

        return DeepHash(values).toString("hex");
    }
}
