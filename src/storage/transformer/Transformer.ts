import {
    NodeInterface,
    DATA_NODE_TYPE,
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
    MAX_TRANSFORMER_LENGTH,
} from "./types";

import {
    FetchReplyData,
    HandleFetchReplyData,
} from "../types";

import {
    FetchRequest,
    Status,
} from "../../types";

const fossilDelta = require("fossil-delta");

/**
 * Transformers ignore any nodes who are not of DATA_NODE_TYPE,
 * that are not returned in the response.
 */
export class Transformer {
    protected algoFunctions: AlgoInterface[] = [];
    protected _isClosed: boolean;
    protected fetchRequest: FetchRequest;
    protected isPristine = true;
    protected maxLength: number;

    /**
     * @throws if algos are not supported.
     */
    constructor(fetchRequest: FetchRequest, maxLength: number = MAX_TRANSFORMER_LENGTH) {
        this.fetchRequest = fetchRequest;
        this.maxLength = maxLength;

        this.initAlgoFunctions();

        this._isClosed = false;
    }

    protected initAlgoFunctions() {
        this.algoFunctions = [];

        let previousAlgo: AlgoInterface | undefined;

        this.fetchRequest.transform.algos.forEach( algoId => {
            let algo: AlgoInterface | undefined;

            if (algoId === AlgoSorted.GetId()) {
                if (previousAlgo) {
                    throw new Error("AlgoSorted does not support using a previous algo object.");
                }
                algo = new AlgoSorted(this.maxLength, this.fetchRequest.query.orderByStorageTime);
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
    public get(cursorId1: Buffer, head: number, tail: number, reverse: boolean = false):
        [NodeInterface[], number[]] | undefined {

        const algo = this.algoFunctions.slice(-1)[0];

        if (algo) {
            return algo.get(cursorId1, head, tail, reverse);
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

    /**
     * Empty the model and start over with empty model.
     */
    public empty() {
        this.algoFunctions.forEach( (algoFn: AlgoInterface) => algoFn.close() );

        this.initAlgoFunctions();
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
    public handleFetchReplyDataFactory(
        handleFetchReplyData: HandleFetchReplyData): HandleFetchReplyData {

        // These are variables used to keep a cache.
        let embed: NodeInterface[] = [];

        let rowCount = 0;

        // Ordered list of node ID1s of the transformer view of the full model.
        let nodeModel: string[] = [];

        let transientUpdatedNodes: NodeInterface[] = [];


        return (fetchReplyData: FetchReplyData) => {
            try {
                const status = fetchReplyData.status ?? Status.RESULT;

                if (status !== Status.RESULT) {
                    handleFetchReplyData(fetchReplyData);
                    return;
                }

                const isFullRefetch = !this.isPristine &&
                    this.fetchRequest.query.cutoffTime === 0n;

                const isSingleQuery = this.fetchRequest.query.triggerNodeId.length === 0 &&
                    this.fetchRequest.query.triggerInterval === 0;

                if (isFullRefetch && fetchReplyData.isFirst) {
                    // Note that here is room for optimization if the model
                    // can signal if there are no untouched nodes then we know
                    // if we can skip emptying the model.
                    this.empty();
                }

                const nodesToAdd = (fetchReplyData.nodes ?? []).
                    filter( node => node.getType().equals(DATA_NODE_TYPE) );

                const [_, transientUpdatedNodes2] = this.add(nodesToAdd);

                transientUpdatedNodes.push(...transientUpdatedNodes2);

                embed.push(...fetchReplyData.embed ?? []);

                rowCount += fetchReplyData.rowCount ?? 0;

                if (!fetchReplyData.isLast) {
                    // More data is expected.
                    return;
                }

                const sendNoDelta = this.isPristine;

                this.isPristine = false;

                const result = this.get(this.fetchRequest.transform.cursorId1,
                    this.fetchRequest.transform.head, this.fetchRequest.transform.tail,
                    this.fetchRequest.transform.reverse);

                if (!result) {
                    const fetchReplyData: FetchReplyData = {
                        status: Status.MISSING_CURSOR,
                        embed,  // Still send embed
                        rowCount,
                        isLast: true,
                    };

                    embed    = [];
                    rowCount = 0;
                    transientUpdatedNodes = [];

                    handleFetchReplyData(fetchReplyData);

                    return;
                }

                const [nodes] = result;

                if (sendNoDelta) {
                    // No diff necessary.
                    // Return the window of data as a regular query response.

                    const fetchReplyData: FetchReplyData = {
                        nodes,
                        embed,
                        rowCount,
                        isLast: true,
                    };

                    embed    = [];
                    rowCount = 0;
                    transientUpdatedNodes = [];

                    handleFetchReplyData(fetchReplyData);

                    return;
                }

                // Respond with a diff
                //

                const nodeModelKeyed: {[id1: string]: boolean} = {};

                nodeModel.forEach( id1Str => {
                    nodeModelKeyed[id1Str] = true;
                });

                const nodeModel2: string[] = [];

                const nodeModel2Keyed: {[id1: string]: boolean} = {};

                const addedNodes: NodeInterface[] = [];

                const addedNodesKeyed: {[id1: string]: boolean} = {};

                nodes.forEach( node => {
                    const id1Str = node.getId1()!.toString("hex");

                    nodeModel2.push(id1Str);

                    nodeModel2Keyed[id1Str] = true;

                    if (!nodeModelKeyed[id1Str]) {
                        addedNodes.push(node);
                        addedNodesKeyed[id1Str] = true;
                    }
                });

                const transientUpdatedNodes3 = transientUpdatedNodes.filter( node => {
                    const id1Str = node.getId1()!.toString("hex");
                    return nodeModel2Keyed[id1Str] && !addedNodesKeyed[id1Str];
                });

                const nodeModelStr  = nodeModel.join(" ");
                const nodeModel2Str = nodeModel2.join(" ");

                if (nodeModelStr === nodeModel2Str && transientUpdatedNodes3.length === 0) {
                    // Nothing to respond with
                    return;
                }

                const delta = fossilDelta.create(nodeModelStr, nodeModel2Str);

                nodeModel = nodeModel2;

                const fetchReplyData2: FetchReplyData = {
                    nodes: [...addedNodes, ...transientUpdatedNodes3],
                    delta: Buffer.concat([Buffer.from([0]), Buffer.from(JSON.stringify(delta))]),
                    embed,
                    rowCount,
                    isLast: true,
                };

                embed = [];
                rowCount = 0;
                transientUpdatedNodes = [];

                handleFetchReplyData(fetchReplyData2);
            }
            catch(e) {
                const error = `Transformer failed: ${e}`;
                const fetchReplyData: FetchReplyData = {
                    status: Status.ERROR,
                    error,
                    isLast: true,
                };

                handleFetchReplyData(fetchReplyData);
            }
        };
    }

    public static HashKey(fetchRequest: FetchRequest): string {
        // Intentionally excluded values are:
        // query.cutoffTime,triggerInterval,onlyTrigger.
        // transform.head,tail,cursorId1,reverse.
        //
        // query.embed is not interesting for the results, so it is ignored.
        //
        // query.cutoffTime is ignored as it must always be initially set to
        // 0 when fetching with transform.
        //
        // When reusing a transformer model for a query then all values in the hashing
        // must be identical, and msgId must be set to the original triggerNodeId while
        // triggerNodeId and triggerInterval must not be set in the query.
        //
        // The only interesting values to change when running a query against an exising
        // transformer model is transformer.head,tail,cursorId1,reverse and msgId
        // must have been set to the original msgId of the streaming request and
        // triggerInterval must be set to 0.
        //
        // When *updating* the underlaying FetchRequest for an existing transformer model, all
        // values in the hashing must be equal except transform.head,tail,cursorId1,reverse
        // and triggerInterval which are the values relevant to update to change the model view.
        // Furthermore, msgId must be set same as triggerNodeId and triggerInterval
        // is allowed to be set differently but must still be within the allowed range and > 0.
        const values: any = [
            fetchRequest.query.sourcePublicKey,
            fetchRequest.query.targetPublicKey,
            fetchRequest.query.depth,
            fetchRequest.query.limit,
            fetchRequest.query.rootNodeId1,
            fetchRequest.query.discardRoot,
            fetchRequest.query.parentId,
            fetchRequest.query.descending,
            fetchRequest.query.orderByStorageTime,
            fetchRequest.query.ignoreInactive,
            fetchRequest.query.ignoreOwn,
            fetchRequest.query.match,
            fetchRequest.query.preserveTransient,
            fetchRequest.query.region,
            fetchRequest.query.jurisdiction,
            fetchRequest.transform.algos,
            fetchRequest.query.triggerNodeId,
            fetchRequest.transform.msgId,
        ];

        return DeepHash(values).toString("hex");
    }
}
