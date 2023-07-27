import {
    KeyPair,
} from "../node";

import {
    DataModelInterface,
} from "../interface";

import Worker from "web-worker";

import {
    PocketConsole,
} from "pocket-console";

import {
    CopyBuffer,
} from "../../util/common";

import {
    ToBeSigned,
    SignaturesCollection,
    SignatureOffloaderInterface,
    SignedResult,
} from "./types";

const console = PocketConsole({module: "SignatureOffloader"});

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

/**
 * The SignatureOffloader class is used to:
 *  using threads to verify signatures in nodes (recursively for embedded nodes and certs),
 *  using threads to sign nodes (not recursive).
 */
export class SignatureOffloader implements SignatureOffloaderInterface {
    protected cryptoWorkers: CryptoWorkerInterface[];
    protected nrOfWorkers: number;
    protected cryptoWorkerIndex: number;  // Round robin schema for applying workloads.

    // Keeping track of the public keys of the keypairs added.
    protected publicKeys: Buffer[] = [];

    /**
     * @param workers is the number of worker threads to spawn.
     * Recommended is to set this to the same amount of actual cores in the system.
     */
    constructor(workers: number = 4) {
        this.cryptoWorkers = [];
        this.nrOfWorkers = workers ?? 4;
        this.cryptoWorkerIndex = 0;
    }

    /**
     * Init all worker threads.
     */
    public async init(): Promise<void> {
        if (this.cryptoWorkers.length > 0) {
            return;
        }

        for (let i=0; i<this.nrOfWorkers; i++) {
            const worker = new CryptoWorker();
            this.cryptoWorkers.push(worker);
            await worker.init();
        }
    }

    /**
     * Always call this after init().
     *
     */
    public async addKeyPair(keyPair: KeyPair): Promise<void> {
        this.publicKeys.push(CopyBuffer(keyPair.publicKey));

        const promises = this.cryptoWorkers.map( worker => worker.addKeyPair(keyPair) );

        Promise.all(promises);
    }

    public async getPublicKeys(): Promise<Buffer[]> {
        // copy
        return this.publicKeys.map( publicKey => CopyBuffer(publicKey) );
    }

    public async countWorkers(): Promise<number> {
        return this.cryptoWorkers.length;
    }

    /**
     * Close must be called when shutting down so threads are terminated.
     */
    public async close(): Promise<void> {
        this.cryptoWorkers.forEach( worker => worker.close() );
        this.cryptoWorkers = [];
    }

    /**
     * Sign data models in place using workers threads, set signature and id1 of signed datamodels.
     * Note that for best performance do batch calls to this function, in contrast to calling the
     * function repeatedly with a single node to be signed (if there are multiple nodes to be signed).
     *
     * @param datamodels all data models to be signed in place.
     * @param publicKey the public key used for signing. The key pair must already have been added.
     * @param deepValidate if true (default) then run a deep validation prior to signing,
     * if any datamodel does not validate then abort signing. Note that any signatures are not checked
     * as part of the validaton since this is prior to signing.
     *
     * @throws if threading is not available, validation fails or signing fails, in such case no datamodels will have been signed.
     */
    public async sign(datamodels: DataModelInterface[], publicKey: Buffer, deepValidate: boolean = true): Promise<void> {
        if (!this.publicKeys.some( publicKey2 => publicKey2.equals(publicKey))) {
            assert(false, "expecting keypair to have been added to SignatureOffloader");
        }

        const toBeSigned: ToBeSigned[] = [];
        const datamodelsLength = datamodels.length;
        for (let index=0; index<datamodelsLength; index++) {
            const datamodel = datamodels[index];

            const val = datamodel.validate(deepValidate ? 2 : 0);
            if (!val[0]) {
                throw new Error(`A datamodel did not validate prior to signing: ${val[1]}`);
            }

            // Might throw
            datamodel.enforceSigningKey(publicKey);
            toBeSigned.push({index, message: datamodel.hash(), publicKey, crypto: datamodel.getCrypto()});
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
            datamodel.addSignature(Buffer.from(signature), publicKey);
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
        const verifiedIndexes = await this.verifier(signaturesList);

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

    protected async verifier(signaturesCollections: SignaturesCollection[]): Promise<number[]> {
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

                const worker = this.cryptoWorkers[this.cryptoWorkerIndex];

                if (!worker && this.cryptoWorkerIndex === 0) {
                    reject("No cryptoWorkers available for signature verification.");
                    return;
                }
                else if (!worker) {
                    this.cryptoWorkerIndex = 0;
                    continue;
                }

                this.cryptoWorkerIndex++;

                const p = worker.verify(signaturesCollections.splice(0, n));

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

                const worker = this.cryptoWorkers[this.cryptoWorkerIndex];

                if (!worker && this.cryptoWorkerIndex === 0) {
                    reject("No cryptoWorkers available for signing.");
                    return;
                }
                else if (!worker) {
                    this.cryptoWorkerIndex = 0;
                    continue;
                }

                this.cryptoWorkerIndex++;

                const p = worker.sign(toBeSigned.splice(0, n));

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
    addKeyPair(keyPair: KeyPair): Promise<void>;
}

class CryptoWorker implements CryptoWorkerInterface {
    protected queue: Array<{resolve: (data: any) => void, message: {action: string, data?: SignaturesCollection[] | ToBeSigned[] | KeyPair}}>;
    protected isBusy: boolean;
    protected workerThread?: Worker;

    constructor() {
        this.isBusy = false;
        this.queue = [];
    }

    public async init() {
        try {
            if (isBrowser) {
                this.workerThread = new Worker("thread-browser.js");

                this.workerThread.onerror = (event: any) => {
                    console.error("Error loading thread-browser.js", event);
                };
            } else {
                const dirname = __dirname;

                const url = `${dirname}/thread.js`;

                this.workerThread = new Worker(url);

                this.workerThread.onerror = (error: ErrorEvent) => {
                    console.error("Error loading thread.js", error);
                };
            }
        }
        catch(e) {
            console.error("Could not initiate worker thread", e);
            return;
        }
        this.workerThread?.addEventListener("message", (e: any)/*(e.data: Buffer[])*/ => {
            const obj = this.queue.shift();
            if (obj) {
                obj.resolve(e.data as Buffer[]);
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

    public async addKeyPair(keyPair: KeyPair): Promise<void> {
        return new Promise( resolve => {
            this.queue.push({resolve, message: {data: keyPair, action: "addKeyPair"}});
            this.sendNext();
        });
    }

    public close() {
        this.workerThread?.terminate();
    }
}
