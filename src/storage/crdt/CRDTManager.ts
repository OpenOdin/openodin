import {
    RPC,
} from "../../keymanager";

import {
    NodeInterface,
} from "../../datamodel";

import {
    CRDTViewType,
} from "./types";

import {
    FetchRequest,
} from "../../types";

import {
    DeepHash,
} from "../../util/common";

import * as fossilDelta from "fossil-delta";

import Worker from "web-worker";

// Check current environment: Node.js or Browser ?
declare const window: any;
import { strict as assert } from "assert";
const isNode = (typeof process !== "undefined" && process?.versions?.node);
let isBrowser = false;
if (!isNode) {
    isBrowser = (typeof (window as any) !== "undefined");
    if(!isBrowser) {
        assert(false, "Unexpected error: current environment is neither Node.js or Browser");
    }
}

export class CRDTManager {
    protected _isInited: boolean = false;
    protected rpc?: RPC;
    protected workerThread?: Worker;
    protected initPromise?: Promise<void>;

    public async init() {
        if (this._isInited) {
            return;
        }

        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = new Promise<void>( async (resolve) => {
            try {
                const workerURI = isBrowser ? "crdt-worker-browser.js" :
                    "./build/src/storage/crdt/crdt-worker-browser.js";

                this.workerThread = new Worker(workerURI);

                this.workerThread.onerror = (error: ErrorEvent) => {
                    console.error("Error loading crdt-worker-browser.js", error);
                };
            }
            catch(e) {
                console.error("Could not initiate crdt worker", e);

                this.initPromise = undefined;

                return;
            }

            const postMessageWrapped = (message: any) => {
                this.workerThread?.postMessage({message});
            };

            const listenMessage = (listener: any) => {
                this.workerThread?.addEventListener("message", (event: any) => {
                    listener(event.data.message);
                });
            };

            this.rpc = new RPC(postMessageWrapped, listenMessage);

            const promise = new Promise<void>( resolve => {
                this.rpc?.onCall("hello", () => {

                    this.rpc?.offCall("hello");

                    resolve();
                });
            });

            await promise;

            this._isInited = true;

            this.initPromise = undefined;

            resolve();
        });

        return this.initPromise;
    }

    public close() {
        if (!this._isInited) {
            return;
        }

        this.workerThread?.terminate();

        this._isInited = false;
    }

    /**
     * Update the model with the given list of nodes.
     * Already existing nodes are ignore, unless the algorithm also sorts
     * on transient values then an existing node can change position in the model.
     *
     * @throws if CRDT model with specified algo cannot be created
     */
    public async updateModel(fetchRequest: FetchRequest, nodes: NodeInterface[]) {
        if (!this._isInited) {
            await this.init();
        }

        const key = CRDTManager.HashKey(fetchRequest);

        const algoId = fetchRequest.crdt.algo;

        const conf = fetchRequest.crdt.conf;

        const nodeValues = nodes.map( node => {
            return {
                id1: node.getId1() as Buffer,
                refId: node.getRefId(),
                transientHash: node.hashTransient(),
                creationTime: node.getCreationTime(),
                transientStorageTime: node.getTransientStorageTime(),
            }
        });


        await this.rpc?.call("updateModel", [key, algoId, conf, fetchRequest.query.orderByStorageTime,
            nodeValues]);
    }

    public async beginDeletionTracking(key: string) {
        if (!this._isInited) {
            await this.init();
        }

        await this.rpc?.call("beginDeletionTracking", [key]);
    }

    public async commitDeletionTracking(key: string) {
        if (!this._isInited) {
            await this.init();
        }

        await this.rpc?.call("commitDeletionTracking", [key]);
    }

    /**
     * Read data from an existing model.
     *
     * @returns [nodes, cursorIndex, length] where cursorIndex == -1 if length == 0.
     * @returns undefined if cursor used but element not found.
     */
    public async getView(key: string, cursorId1: Buffer, cursorIndex: number,
        head: number, tail: number, reverse: boolean = false):
        Promise<[crdtView: CRDTViewType, cursorIndex: number, length: number] | undefined>
    {
        if (!this._isInited) {
            await this.init();
        }

        const result = await this.rpc?.call("getView", [key, cursorId1, cursorIndex, head, tail, reverse]);

        if (!result) {
            return undefined;
        }

        const [newCRDTView, newCursorIndex, length] = result;

        newCRDTView.list = newCRDTView.list.map( (id1: Uint8Array) => Buffer.from(id1) );

        for (let key in newCRDTView.transientHashes) {
            newCRDTView.transientHashes[key] = Buffer.from(newCRDTView.transientHashes[key]);
        }

        return [newCRDTView, newCursorIndex, length];
    }

    public async diff(crdtView: CRDTViewType, key: string, cursorId1: Buffer, cursorIndex: number,
        head: number, tail: number, reverse: boolean = false):
        Promise<[missingNodeIds1: Buffer[], delta: Buffer, crdtView: CRDTViewType,
            cursorIndex: number, length: number] | undefined>
    {
        if (!this._isInited) {
            await this.init();
        }


        const result = await this.getView(key, cursorId1, cursorIndex, head, tail, reverse);

        if (!result) {
            return undefined;
        }

        const [newCRDTView, newCursorIndex, length] = result;

        const missingNodesId1s: Buffer[] = [];

        // Compare the two views to find out which nodes we need to fetch
        //
        newCRDTView.list.forEach( id1 => {
            const id1Str = id1.toString("hex");

            const transientHash = crdtView.transientHashes[id1Str];

            const newTransientHash = newCRDTView.transientHashes[id1Str];

            if (!transientHash || !transientHash.equals(newTransientHash)) {
                // New or updated node.
                missingNodesId1s.push(id1);
            }
        });

        // Diff the two views.
        const patch = fossilDelta.create(Buffer.concat(crdtView.list),
            Buffer.concat(newCRDTView.list));

        // Note: the prefixing 0 byte indicates we are using fossilDelta.
        const delta = Buffer.concat([Buffer.from([0]), Buffer.from(JSON.stringify({patch}))]);

        return [missingNodesId1s, delta, newCRDTView, newCursorIndex, length];
    }

    /**
     * Create a hash which is unique for the query and the client.
     *
     * Running the exact same query means that the same underlying CRDT
     * model is shared for all queries.
     *
     * Intentionally excluded values are:
     *
     * query.cutoffTime, triggerInterval, onlyTrigger, triggerNodeId and
     * crdt.head, tail, cursorId1, cursorIndex, reverse.
     *
     * query.embed is not interesting for the results, so it is ignored.
     *
     * query.cutoffTime is ignored in the hashing as it must always be initially set to
     * 0 when fetching with CRDT.
     */
    public static HashKey(fetchRequest: FetchRequest): string {
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
            fetchRequest.crdt.algo,
            fetchRequest.crdt.conf,
        ];

        return DeepHash(values).toString("hex");
    }
}
