import {
    Krypto,
    KeyPair,
    BaseModelInterface,
} from "../datamodel";

import {
    ToBeSigned,
    SignaturesCollection,
    SignedResult,
    SignatureOffloaderInterface,
} from "../signatureoffloader/types";

import {
    SignatureOffloader,
} from "../signatureoffloader/SignatureOffloader";

import {
    RPC,
} from "../util/RPC";

export class SignatureOffloaderRPCClient implements SignatureOffloaderInterface {
    protected rpc: RPC;
    protected dedicatedVerifier?: SignatureOffloader;

    constructor(rpc: RPC, nrOfSignatureVerifiers: number = 0) {
        this.rpc = rpc;
        if (nrOfSignatureVerifiers > 0) {
            this.dedicatedVerifier = new SignatureOffloader(nrOfSignatureVerifiers);
        }
    }

    public async init(): Promise<void> {
        if (this.dedicatedVerifier) {
            await this.dedicatedVerifier.init();
        }

        return await this.rpc.call("init");
    }

    public async addKeyPair(keyPair: KeyPair): Promise<void> {  //eslint-disable-line @typescript-eslint/no-unused-vars
        throw new Error("SignatureOffloaderRPCClient should not add key pairs of its own.");
    }

    public async getPublicKeys(): Promise<Buffer[]> {
        const publicKeys = await this.rpc.call("getPublicKeys");
        return publicKeys.map( (publicKey: Buffer | Uint8Array) => Buffer.from(publicKey) );
    }

    public async countWorkers(): Promise<number> {
        return await this.rpc.call("countWorkers");
    }

    public async sign(baseModels: BaseModelInterface[], publicKey: Buffer, deepValidate: boolean = true): Promise<void> {
        const toBeSigned: ToBeSigned[] = [];

        const datamodelsLength = baseModels.length;
        for (let index=0; index<datamodelsLength; index++) {
            const baseModel = baseModels[index];

            const val = baseModel.validate(deepValidate);
            if (!val[0]) {
                throw new Error(`A baseModel did not validate prior to signing: ${val[1]}`);
            }

            // Note that we are sending the full model export here, so that one cannot
            // sign arbitrary data, it must be a validatable model.
            toBeSigned.push({index, message: baseModel.pack(), publicKey});
        }

        // Might throw
        const signatures: SignedResult[] = await this.rpc.call("signer", [toBeSigned]);

        if (signatures.length !== baseModels.length) {
            throw new Error("Not all baseModels could be signed.");
        }

        let type = -1;
        if (Krypto.IsEd25519(publicKey)) {
            type = Krypto.ED25519.TYPE;
        }
        else if (Krypto.IsEthereum(publicKey)) {
            type = Krypto.ETHEREUM.TYPE;
        }

        // Apply signatures to all baseModels.
        for (let i=0; i<signatures.length; i++) {
            const {index, signature} = signatures[i];
            const baseModel = baseModels[index];
            baseModel.addSignature(Buffer.from(signature), publicKey, type);
        }
    }

    public async verify(baseModels: BaseModelInterface[]): Promise<BaseModelInterface[]> {
        if (this.dedicatedVerifier) {
            return this.dedicatedVerifier.verify(baseModels);
        }

        const verifiedNodes: BaseModelInterface[] = [];
        // Extract all signatures from the node, also including from embedded nodes and certs.
        const signaturesList: SignaturesCollection[] = [];

        const datamodelsLength = baseModels.length;
        for (let index=0; index<datamodelsLength; index++) {
            const baseModel = baseModels[index];
            try {
                signaturesList.push({index, signatures: baseModel.getSignatures()});
            }
            catch(e) {
                // Deep unpacking not available on model, skip this model.
                // Do nothing.
            }
        }

        // Cryptographically verify in separate threads all the signatures extracted
        // Will throw on threading failure.
        const verifiedIndexes = await this.rpc.call("verifier", [signaturesList]);

        const verifiedIndexesLength = verifiedIndexes.length;
        for (let i=0; i<verifiedIndexesLength; i++) {
            const index = verifiedIndexes[i];

            const baseModel = baseModels[index];

            if (baseModel.validate(true)[0]) {
                verifiedNodes.push(baseModel);
            }
        }

        return verifiedNodes;
    }

    public async close(): Promise<void> {
        return await this.rpc.call("close");
    }
}
