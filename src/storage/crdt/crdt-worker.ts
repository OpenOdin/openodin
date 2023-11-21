/**
 * NOTE: This file is TypeScript compiled into "./build/src/storage/crdt/crdt-worker.js"
 *  then browserified to "./build/src/storage/crdt/crdt-worker-browser.js" for the CRDTManager
 *  to load.
 *
 *  When running in browser this browserified file ("crdt-worker-browser.js") must always
 *  be copied to any browser application public root directory so it is accessible to be loaded
 *  by the browser's Worker() in run-time.
 *
 *  NodeJS and Browser use the same browserified JS file for their worker threads.
 */

import {
    RPC,
} from "../../keymanager/RPC";

import {
    CRDTViewType,
    AlgoInterface,
    NodeAlgoValues,
} from "./types";

import {
    AlgoSorted,
} from "./AlgoSorted";

import {
    AlgoRefId,
} from "./AlgoRefId";

class CRDTManagerWorker {
    // TODO when to ever garbage collect cached algos?
    protected algos: {[key: string]: AlgoInterface} = {};

    public async updateModel(key: string, algoId: number, conf: string, orderByStorageTime: boolean,
        nodes: NodeAlgoValues[])
    {
        let algo = this.algos[key];

        if (!algo) {
            if (algoId === AlgoSorted.GetId()) {
                algo = new AlgoSorted(orderByStorageTime);
            }
            else if (algoId === AlgoRefId.GetId()) {
                algo = new AlgoRefId(orderByStorageTime);
            }
            else {
                throw new Error(`CRDT algo function with ID ${algoId} not available.`);
            }

            this.algos[key] = algo;
        }

        nodes = nodes.map( (node: NodeAlgoValues) => {
            return {
                id1: Buffer.from(node.id1),
                refId: node.refId ? Buffer.from(node.refId) : undefined,
                transientHash: Buffer.from(node.transientHash),
                creationTime: node.creationTime,
                transientStorageTime: node.transientStorageTime,
            };
        });

        algo.add(nodes);
    }

    public beginDeletionTracking(key: string) {
        let algo = this.algos[key];

        if (algo) {
            algo.beginDeletionTracking();
        }
    }

    public commitDeletionTracking(key: string) {
        let algo = this.algos[key];

        if (algo) {
            algo.commitDeletionTracking();
        }
    }

    public async getView(key: string, cursorId1: Buffer, cursorIndex: number,
        head: number, tail: number, reverse: boolean = false):
        Promise<[crdtView: CRDTViewType, cursorIndex: number, length: number] | undefined>
    {
        const algo = this.algos[key];

        if (!algo) {
            throw new Error("CRDT model does not exist");
        }

        const result = algo.get(cursorId1, cursorIndex, head, tail, reverse);

        if (!result) {
            return undefined;
        }

        const [nodes, indexes] = result;

        const cursorIndex2 = (head !== 0 && !reverse ? indexes[indexes.length -1 ]: indexes[0]) ?? -1;

        const length = algo.getLength();

        const transientHashes: {[id1: string]: Buffer} = {};
        const list: Buffer[] = [];

        nodes.forEach( node => {
            if (node) {
                const id1 = Buffer.from(node.id1);

                const id1Str = id1.toString("hex");

                list.push(id1);

                transientHashes[id1Str] = node.transientHash;
            }
        });

        const crdtView: CRDTViewType = {
            list,
            transientHashes,
        };

        return [crdtView, cursorIndex2, length];

    }
}

function main (self?: any) {
    const postMessageWrapped = (message: any) => {
        postMessage({message});
    };

    const listenMessage = (listener: any) => {
        addEventListener("message", (event: any) => {
            listener(event.data.message);
        });
    };

    const crdtManagerWorker = new CRDTManagerWorker();

    const rpc = new RPC(postMessageWrapped, listenMessage);

    rpc.onCall("updateModel", (key: string, algoId: number, conf: string,
        orderByStorageTime: boolean, nodes: NodeAlgoValues[]) => {

        crdtManagerWorker.updateModel(key, algoId, conf, orderByStorageTime, nodes);
    });

    rpc.onCall("beginDeletionTracking", (key: string) => {
        crdtManagerWorker.beginDeletionTracking(key);
    });

    rpc.onCall("commitDeletionTracking", (key: string) => {
        crdtManagerWorker.commitDeletionTracking(key);
    });

    rpc.onCall("getView", async (key: string, cursorId1: Buffer, cursorIndex: number,
        head: number, tail: number, reverse: boolean) =>
    {
        return crdtManagerWorker.getView(key, cursorId1, cursorIndex, head, tail, reverse);
    });

    rpc.call("hello");

    // In case of Browser, self is likely to be set.
    // This is where the event listener needs to get installed to.
    if(self) {
        self.addEventListener = addEventListener;
    }
}

main();
