/**
 * NOTE: This file is TypeScript compiled into "./build/src/storage/crdt/crdt-worker.js"
 *  then browserified to "./build/src/storage/crdt/crdt-worker-browser.js" for the CRDTManager
 *  to load.
 *
 *  When running in browser this browserified file ("crdt-worker-browser.js") must always
 *  be copied to the browser application public root directory so it is accessible to be loaded
 *  by the browser's Worker() in run-time.
 */

import {
    RPC,
} from "../../util/RPC";

import {
    CRDTViewType,
    AlgoInterface,
    NodeValues,
} from "./types";

import {
    AlgoSorted,
} from "./AlgoSorted";

import {
    AlgoRefId,
} from "./AlgoRefId";

import {
    AlgoSortedRefId,
} from "./AlgoSortedRefId";

import {
    DataInterface,
} from "../../datamodel/node/secondary/interface";

import {
    Decoder,
} from "../../decoder";

// TODO when to ever garbage collect cached algos?
export class CRDTManagerWorker {
    protected algos: {[key: string]: AlgoInterface} = {};

    public async updateModel(key: string, algoId: number, conf: string, orderByStorageTime: boolean,
        images: Buffer[], targetPublicKey: Buffer)
    {
        targetPublicKey = Buffer.from(targetPublicKey);

        let algo = this.algos[key];

        if (!algo) {
            if (algoId === AlgoSorted.GetId()) {
                algo = new AlgoSorted(orderByStorageTime, conf, targetPublicKey.toString("hex"));
            }
            else if (algoId === AlgoRefId.GetId()) {
                algo = new AlgoRefId(orderByStorageTime, conf, targetPublicKey.toString("hex"));
            }
            else if (algoId === AlgoSortedRefId.GetId()) {
                algo = new AlgoSortedRefId(orderByStorageTime, conf, targetPublicKey.toString("hex"));
            }
            else {
                throw new Error(`CRDT algo function with ID ${algoId} not available.`);
            }

            this.algos[key] = algo;
        }

        const nodes = images.map( image => Decoder.DecodeNode(Buffer.from(image)) ) as DataInterface[];

        algo.add(nodes);
    }

    public beginDeletionTracking(key: string) {
        const algo = this.algos[key];

        if (algo) {
            algo.beginDeletionTracking();
        }
    }

    public commitDeletionTracking(key: string) {
        const algo = this.algos[key];

        if (algo) {
            algo.commitDeletionTracking();
        }
    }

    public async getView(key: string, cursorId1: Buffer, cursorIndex: number,
        head: number, tail: number, reverse: boolean = false):
        Promise<[crdtView: CRDTViewType, cursorIndex: number, length: number] | undefined>
    {
        cursorId1 = Buffer.from(cursorId1);

        const algo = this.algos[key];

        if (!algo) {
            throw new Error("CRDT model does not exist");
        }

        const result = algo.get(cursorId1, cursorIndex, head, tail, reverse);

        if (!result) {
            return undefined;
        }

        const [nodeValues, indexes] = result;

        const cursorIndex2 = (head !== 0 && !reverse ? indexes[indexes.length -1 ]: indexes[0]) ?? -1;

        const length = algo.getLength();

        const transientHashes: {[id1: string]: Buffer} = {};
        const annotations: {[id1: string]: Buffer} = {};
        const list: Buffer[] = [];

        nodeValues.forEach( (nodeValues: NodeValues) => {
            if (nodeValues) {
                const id1 = nodeValues.id1;

                list.push(id1);

                const id1Str = id1.toString("hex");

                transientHashes[id1Str] = nodeValues.transientHash;

                if (nodeValues.annotations) {
                    annotations[id1Str] = nodeValues.annotations.export();
                }
            }
        });

        const crdtView: CRDTViewType = {
            list,
            transientHashes,
            annotations,
        };

        return [crdtView, cursorIndex2, length];
    }
}

function main(self?: any) {
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
        orderByStorageTime: boolean, images: Buffer[], targetPublicKey: Buffer) => {

        crdtManagerWorker.updateModel(key, algoId, conf, orderByStorageTime, images,
            targetPublicKey);
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
