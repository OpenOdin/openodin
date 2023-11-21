import {
    KeyPair,
} from "../datamodel/node";

import {
    DataModelInterface,
} from "../datamodel/interface";

import {
    ToBeSigned,
    SignaturesCollection,
    SignedResult,
} from "../datamodel/decoder/types";

import {
    SignatureOffloaderInterface,
} from "../datamodel/decoder/types";

import {
    RPC,
} from "../util/RPC";

export class SignatureOffloaderRPCClient implements SignatureOffloaderInterface {
    protected rpc: RPC;

    constructor(rpc: RPC) {
        this.rpc = rpc;
    }

    public async init(): Promise<void> {
        return await this.rpc.call("init");
    }

    public async addKeyPair(keyPair: KeyPair): Promise<void> {
        throw new Error("SignatureOffloaderRPCClient should not add key pairs of its own.");
    }

    public async getPublicKeys(): Promise<Buffer[]> {
        const publicKeys = await this.rpc.call("getPublicKeys");
        return publicKeys.map( (publicKey: Buffer | Uint8Array) => Buffer.from(publicKey) );
    }

    public async countWorkers(): Promise<number> {
        return await this.rpc.call("countWorkers");
    }

    public async sign(datamodels: DataModelInterface[], publicKey: Buffer, deepValidate: boolean = true): Promise<void> {
        const toBeSigned: ToBeSigned[] = [];

        const datamodelsLength = datamodels.length;
        for (let index=0; index<datamodelsLength; index++) {
            const dataModel = datamodels[index];

            const val = dataModel.validate(deepValidate ? 2 : 0);
            if (!val[0]) {
                throw new Error(`A datamodel did not validate prior to signing: ${val[1]}`);
            }

            // Might throw
            dataModel.enforceSigningKey(publicKey);

            // Note that we are sending the full datamodel export here, so that one cannot
            // sign arbitrary data, it must be a validatable datamodel.
            toBeSigned.push({index, message: dataModel.export(),
                publicKey, crypto: dataModel.getCrypto()});
        }

        // Might throw
        const signatures: SignedResult[] = await this.rpc.call("signer", [toBeSigned]);

        if (signatures.length !== datamodels.length) {
            throw new Error("Not all datamodels could be signed.");
        }

        // Apply signatures to all datamodels.
        for (let i=0; i<signatures.length; i++) {
            const {index, signature} = signatures[i];
            const dataModel = datamodels[index];
            dataModel.addSignature(Buffer.from(signature), publicKey);
            dataModel.setId1(dataModel.calcId1());
        }
    }

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
        const verifiedIndexes = await this.rpc.call("verifier", [signaturesList]);

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

    public async close(): Promise<void> {
        return await this.rpc.call("close");
    }
}
