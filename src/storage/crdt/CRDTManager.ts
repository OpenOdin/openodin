import fs from "fs";

import {
    RPC,
} from "../../util/RPC";

import {
    DataInterface,
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

// Check current environment: Node.js, browser or browser plugin.
//
declare const window: any;
declare const process: any;
declare const browser: any;
declare const chrome: any;

import { strict as assert } from "assert";

const isNode = (typeof process !== "undefined" && process?.versions?.node);
let isBrowser = false;
if (!isNode) {
    isBrowser = typeof window !== "undefined" || typeof browser !== "undefined" || typeof chrome !== "undefined";
    if(!isBrowser) {
        assert(false, "Unexpected error: current environment is neither Node.js, browser or browser extension");
    }
}

export class CRDTManager {
    protected _isInited: boolean = false;
    protected rpcs: RPC[] = [];
    protected workerThreads: Worker[] = [];
    protected initPromise?: Promise<void>;
    protected rpcCounter: number = 0;
    protected rpcMap: {[key: string]: RPC} = {};

    public async init() {
        if (this._isInited) {
            return;
        }

        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = new Promise<void>( (resolve) => {
            const p1 = this.spawnThread();
            const p2 = this.spawnThread();

            Promise.all([p1, p2]).then( (rpcs: RPC[]) => {
                this.rpcs = rpcs;

                this._isInited = true;

                this.initPromise = undefined;

                resolve();
            });
        });

        return this.initPromise;
    }

    protected spawnThread(): Promise<RPC> {
        return new Promise<RPC>( resolve => {
            const workerURIs = [
                "./crdt-worker.js",
                "./node_modules/openodin/build/src/storage/crdt/crdt-worker.js",
                "./build/src/storage/crdt/crdt-worker.js",
                "crdt-worker-browser.js",
            ];

            let workerURI = workerURIs.pop();

            if (!isBrowser) {
                while (workerURI) {
                    if (fs.existsSync(workerURI)) {
                        break;
                    }
                    workerURI = workerURIs.pop();
                }

                if (!workerURI) {
                    throw new Error("Could not find crdt-worker.js");
                }
            }

            const workerThread = new Worker(workerURI);

            workerThread.onerror = (error: ErrorEvent) => {
                console.error(`Error loading ${workerURI}`, error);
            };

            const postMessageWrapped = (message: any) => {
                workerThread.postMessage({message});
            };

            const listenMessage = (listener: any) => {
                workerThread.addEventListener("message", (event: any) => {
                    listener(event.data?.message);
                });
            };

            this.workerThreads.push(workerThread);

            const rpc = new RPC(postMessageWrapped, listenMessage);

            rpc.onCall("hello", () => {
                rpc.offCall("hello");

                resolve(rpc);
            });
        });
    }

    protected getRPC(key: string): RPC {
        let rpc = this.rpcMap[key];

        if (!rpc) {
            rpc = this.rpcs[this.rpcCounter++ % this.rpcs.length];

            if (!rpc) {
                throw new Error("Missing RPC");
            }

            this.rpcMap[key] = rpc;
        }

        return rpc;
    }

    public close() {
        if (!this._isInited) {
            return;
        }

        this.rpcs.map( rpc => rpc.close() );
        this.workerThreads.map( thread => thread.terminate() );

        this._isInited = false;
    }

    /**
     * Update the model with the given list of nodes.
     * Already existing nodes are ignore, unless the algorithm also sorts
     * on transient values then an existing node can change position in the model.
     *
     * @throws if CRDT model with specified algo cannot be created
     */
    public async updateModel(fetchRequest: FetchRequest, nodes: DataInterface[]) {
        if (!this._isInited) {
            await this.init();
        }

        const key = CRDTManager.HashKey(fetchRequest);

        const algoId = fetchRequest.crdt.algo;

        const conf = fetchRequest.crdt.conf;

        const images: Buffer[] = nodes.map( node => node.export(true) );

        const rpc = this.getRPC(key);

        return rpc.call("updateModel", [key, algoId, conf, fetchRequest.query.orderByStorageTime,
            images, fetchRequest.query.targetPublicKey]);
    }

    public async beginDeletionTracking(key: string) {
        if (!this._isInited) {
            await this.init();
        }

        const rpc = this.getRPC(key);

        await rpc.call("beginDeletionTracking", [key]);
    }

    public async commitDeletionTracking(key: string) {
        if (!this._isInited) {
            await this.init();
        }

        const rpc = this.getRPC(key);

        await rpc.call("commitDeletionTracking", [key]);
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

        const rpc = this.getRPC(key);

        const result = await rpc.call("getView", [key, cursorId1, cursorIndex, head, tail, reverse]);

        if (!result) {
            return undefined;
        }

        const [newCRDTView, newCursorIndex, length] = result;

        // We need to re-buffer values in case they have been changed to Uint8Array
        // when serialized.
        //
        newCRDTView.list = newCRDTView.list.map( (id1: Uint8Array) => Buffer.from(id1) );

        for (const key in newCRDTView.transientHashes) {
            newCRDTView.transientHashes[key] = Buffer.from(newCRDTView.transientHashes[key]);
        }

        for (const key in newCRDTView.annotations) {
            newCRDTView.annotations[key] = Buffer.from(newCRDTView.annotations[key]);
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

            if (!transientHash) {
                // This is a new node.
                //
                missingNodesId1s.push(id1);

                return;
            }

            const newTransientHash = newCRDTView.transientHashes[id1Str];

            const annotations = crdtView.annotations[id1Str] ?? Buffer.alloc(0);

            const newAnnotations = newCRDTView.annotations[id1Str] ?? Buffer.alloc(0);

            if (!transientHash.equals(newTransientHash) ||
                (!annotations.equals(newAnnotations)))
            {
                // This node's transient hash has changed,
                // or the transient annotations have changed,
                // either way we want to refetch the node
                // to have it sent out to the client again.
                //
                missingNodesId1s.push(id1);

                return;
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
