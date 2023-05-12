import {
    Signature,
    KeyPair,
} from "../node";

import {
    DataModelInterface,
} from "../interface";

import Worker from "web-worker";

import {
    PocketConsole,
} from "pocket-console";

const console = PocketConsole({module: "SignatureOffloader"});

type SignaturesCollection = {
    index: number,
    signatures: Signature[],
};

type ToBeSigned = {
    index: number,
    message: Buffer,
    keyPair: KeyPair,
    crypto: string,
};

type SignedResult = {
    index: number,
    signature: Buffer,
};

declare const window: any;

// Check current environment: Node.js or Browser ?
import { strict as assert } from "assert";
const isNode = (typeof process !== "undefined" && process?.versions?.node);
let isBrowser = false;
if (!isNode) {
    isBrowser = (typeof (window as any) !== "undefined");
    if(!isBrowser) {
        assert(false, "Unexpected error: current environment is neither Node.js or Browser");
    }
}

// Add webworkify dependency only if Browser
let work: any;
if(isBrowser) {
    work = require("webworkify");
}

/**
 * The SignatureOffloader class is used to:
 *  using threads to verify signatures in nodes (recursively for embedded nodes and certs),
 *  using threads to sign nodes (not recursive).
 */
export class SignatureOffloader {
    protected cryptoWorkers: CryptoWorkerInterface[];
    protected maxWorkers: number;
    protected cryptoWorkerIndex: number;  // Round robin schema for applying workloads.

    /**
     * @param workers is the number of worker threads to spawn.
     * Recommended is to set this to the same amount of actual cores in the system.
     */
    constructor(workers: number = 4) {
        this.cryptoWorkers = [];
        this.maxWorkers = workers;
        this.cryptoWorkerIndex = 0;
    }

    /**
     * Set the desiered nr of workers to be available.
     * If scaling up then after calling this function call init() again to spawn more workers.
     * Note that it is not possible to scale down without closing and re-initing again.
     */
    public setMaxWorkers(maxWorkers: number) {
        this.maxWorkers = maxWorkers;
    }

    /**
     * Init all worker threads.
     */
    public async init() {
        const toSpawn = this.maxWorkers - this.cryptoWorkers.length;

        for (let i=0; i<toSpawn; i++) {
            const verifier = new CryptoWorker();
            await verifier.init();
            this.cryptoWorkers.push(verifier);
        }
    }

    public countWorkers(): number {
        return this.cryptoWorkers.length;
    }

    /**
     * Close must be called when shutting down so threads are terminated.
     */
    public close() {
        this.cryptoWorkers.forEach( verifier => verifier.close() );
        this.cryptoWorkers = [];
    }

    /**
     * Sign data models in place using workers threads, set signature and id1 of signed datamodels.
     * Note that for best performance do batch calls to this function, in contrast to calling the
     * function repeatedly with a single node to be signed (if there are multiple nodes to be signed).
     *
     * @param datamodels all data models to be signed in place.
     * @param keyPair the key pair to be used for signing.
     * @param deepValidate if true (default) then run a deep validation prior to signing,
     * if any datamodel does not validate then abort signing. Note that any signatures are not checked
     * as part of the validaton since this is prior to signing.
     *
     * @throws if threading is not available, validation fails or signing fails, in such case no datamodels will have been signed.
     */
    public async sign(datamodels: DataModelInterface[], keyPair: KeyPair, deepValidate: boolean = true) {
        const toBeSigned: ToBeSigned[] = [];
        const datamodelsLength = datamodels.length;
        for (let index=0; index<datamodelsLength; index++) {
            const datamodel = datamodels[index];

            const val = datamodel.validate(deepValidate ? 2 : 0);
            if (!val[0]) {
                throw new Error(`A datamodel did not validate prior to signing: ${val[1]}`);
            }

            // Might throw
            datamodel.enforceSigningKey(keyPair.publicKey);
            toBeSigned.push({index, message: datamodel.hash(), keyPair, crypto: datamodel.getCrypto()});
        }

        // Might throw
        const signatures: SignedResult[] = await this.signer(toBeSigned);
        if (signatures.length !== datamodels.length) {
            throw new Error("Not all datamodels could be signed.");
        }

        // Apply signatures to all datamodels.
        for (let i=0; i<signatures.length; i++) {
            const {index, signature} = signatures[i];
            const datamodel = datamodels[index];
            datamodel.addSignature(Buffer.from(signature), keyPair.publicKey);
            datamodel.setId1(datamodel.calcId1());
        }
    }

    /**
     * Cryptographically deep verify and deep validate datamodels (nodes/certs) using worker threads.
     * Note that for best performance do batch calls to this function, in contrast to calling the
     * function repeatedly with a single node to be verified (if there are multiple nodes to be verified).
     *
     * @param datamodels to validate.
     * @returns array datamodels which did verify.
     * @throws on threading failure.
     */
    public async verify(datamodels: DataModelInterface[]): Promise<DataModelInterface[]> {
        const verifiedNodes: DataModelInterface[] = [];
        // Extract all signatures from the node, also including from embedded nodes and certs.
        const signaturesList: SignaturesCollection[] = [];

        const datamodelsLength = datamodels.length;
        for (let index=0; index<datamodelsLength; index++) {
            const datamodel = datamodels[index];
            try {
                signaturesList.push({index, signatures: datamodel.extractSignatures()});
            }
            catch(e) {
                // Deep unpacking not available on model, skip this model.
                // Do nothing.
            }
        }

        // Cryptographically verify in separate threads all the signatures extracted
        // Will throw on threading failure.
        const verifiedIndexes = await this.signatureVerifyer(signaturesList);

        const verifiedIndexesLength = verifiedIndexes.length;
        for (let i=0; i<verifiedIndexesLength; i++) {
            const index = verifiedIndexes[i];

            const datamodel = datamodels[index];

            if (datamodel.validate(1)[0]) {
                verifiedNodes.push(datamodel);
            }
        }

        return verifiedNodes;
    }

    protected async signatureVerifyer(signaturesCollections: SignaturesCollection[]): Promise<number[]> {
        return new Promise( (resolve, reject) => {
            if (this.cryptoWorkers.length === 0) {
                reject("No cryptoWorkers available for signature verification.");
                return;
            }

            const n = Math.ceil(signaturesCollections.length / this.cryptoWorkers.length);
            const promises: Array<Promise<number[]>> = [];

            while(signaturesCollections.length > 0) {
                if (this.cryptoWorkerIndex >= this.cryptoWorkers.length) {
                    this.cryptoWorkerIndex = 0;
                }

                const verifier = this.cryptoWorkers[this.cryptoWorkerIndex];

                if (!verifier && this.cryptoWorkerIndex === 0) {
                    reject("No cryptoWorkers available for signature verification.");
                    return;
                }
                else if (!verifier) {
                    this.cryptoWorkerIndex = 0;
                    continue;
                }

                this.cryptoWorkerIndex++;

                const p = verifier.verify(signaturesCollections.splice(0, n));

                promises.push(p);
            }

            Promise.all(promises).then( (values: number[][]) => {
                const verifiedList: number[] = [];

                const valuesLength = values.length;
                for (let i=0; i<valuesLength; i++) {
                    const valueList = values[i];
                    const valueLength = valueList.length;
                    for (let i=0; i<valueLength; i++) {
                        const value = valueList[i];
                        verifiedList.push(value);
                    }
                }

                resolve(verifiedList);
            });
        });
    }

    protected async signer(toBeSigned: ToBeSigned[]): Promise<SignedResult[]> {
        return new Promise( (resolve, reject) => {
            if (this.cryptoWorkers.length === 0) {
                reject("No cryptoWorkers available for signing.");
                return;
            }

            const n = Math.ceil(toBeSigned.length / this.cryptoWorkers.length);
            const promises: Array<Promise<SignedResult[]>> = [];

            while(toBeSigned.length > 0) {
                if (this.cryptoWorkerIndex >= this.cryptoWorkers.length) {
                    this.cryptoWorkerIndex = 0;
                }

                const verifier = this.cryptoWorkers[this.cryptoWorkerIndex];

                if (!verifier && this.cryptoWorkerIndex === 0) {
                    reject("No cryptoWorkers available for signing.");
                    return;
                }
                else if (!verifier) {
                    this.cryptoWorkerIndex = 0;
                    continue;
                }

                this.cryptoWorkerIndex++;

                const p = verifier.sign(toBeSigned.splice(0, n));

                promises.push(p);
            }

            Promise.all(promises).then( (values: SignedResult[][]) => {
                const signedResults: SignedResult[] = [];
                const valuesLength = values.length;
                for (let i=0; i<valuesLength; i++) {
                    const valueList = values[i];
                    const valueLength = valueList.length;
                    for (let i=0; i<valueLength; i++) {
                        const value = valueList[i];
                        signedResults.push(value);
                    }
                }

                resolve(signedResults);
            });
        });
    }
}

interface CryptoWorkerInterface {
    verify(signaturesCollection: SignaturesCollection[]): Promise<number[]>;
    sign(toBeSigned: ToBeSigned[]): Promise<{index: number, signature: Buffer}[]>;
    close(): void;
}

class CryptoWorker implements CryptoWorkerInterface {
    protected queue: Array<{resolve: (data: any) => void, message: {action: string, data?: SignaturesCollection[] | ToBeSigned[]}}>;
    protected isBusy: boolean;
    protected workerThread?: any;

    constructor() {
        this.isBusy = false;
        this.queue = [];
    }

    public async init() {
        try {
            if (isBrowser) {
                this.workerThread = work(require("./thread.js"));  // eslint-disable-line @typescript-eslint/no-var-requires
            } else {
                const dirname = __dirname;
                const url = `${dirname}/thread.js`;
                this.workerThread = new Worker(url);
            }
        }
        catch(e) {
            console.error("Could not initiate worker thread", e);
            return;
        }
        this.workerThread?.addEventListener("message", (e: any)/*(e.data: Buffer[])*/ => {
            const obj = this.queue.shift();
            if (obj) {
                obj.resolve(e.data);
            }
            this.isBusy = false;
            this.sendNext();
        });
    }

    protected sendNext() {
        if (this.isBusy) {
            return;
        }
        if (this.queue.length > 0) {
            this.isBusy = true;
            this.workerThread?.postMessage(this.queue[0].message);
        }
    }

    public async verify(signaturesCollection: SignaturesCollection[]): Promise<number[]> {
        return new Promise( resolve => {
            this.queue.push({resolve, message: {data: signaturesCollection, action: "verify"}});
            this.sendNext();
        });
    }

    public async sign(toBeSigned: ToBeSigned[]): Promise<SignedResult[]> {
        return new Promise( resolve => {
            this.queue.push({resolve, message: {data: toBeSigned, action: "sign"}});
            this.sendNext();
        });
    }

    public close() {
        this.workerThread?.terminate();
    }
}
