import {
    KeyPair,
} from "../datamodel/types";

import {
    DataModelInterface,
} from "../datamodel/interface/DataModelInterface";

import {
    Decoder,
} from "../decoder";

import {
    ToBeSigned,
    SignaturesCollection,
    SignatureOffloader,
} from "../signatureoffloader";

import {
    RPC,
} from "../util/RPC";

export class SignatureOffloaderRPCServer extends SignatureOffloader {
    protected rpc: RPC;
    protected triggerOnSign?: (dataModels: DataModelInterface[]) => Promise<boolean>;

    constructor(rpc: RPC, nrOfWorkers?: number, singleThreaded: boolean = false, triggerOnSign?: (dataModels: DataModelInterface[]) => Promise<boolean>) {
        super(nrOfWorkers, singleThreaded);

        this.triggerOnSign = triggerOnSign;

        this.rpc = rpc;

        this.rpc.onCall("init", () => {
            return this.init();
        });

        this.rpc.onCall("addKeyPair", (keyPair: KeyPair) => {
            return this.addKeyPair({
                publicKey: Buffer.from(keyPair.publicKey),
                secretKey: Buffer.from(keyPair.secretKey),
            });
        });

        this.rpc.onCall("getPublicKeys", () => {
            return this.getPublicKeys();
        });

        this.rpc.onCall("countWorkers", () => {
            return this.countWorkers();
        });

        this.rpc.onCall("close", () => {
            return this.close();
        });

        this.rpc.onCall("signer", async (toBeSigned: ToBeSigned[]) => {
            const signRequests: DataModelInterface[] = [];
            const toBeSigned2: ToBeSigned[] = [];

            const toBeSignedLength = toBeSigned.length;
            for (let i=0; i<toBeSignedLength; i++) {
                const toSign = toBeSigned[i];

                // Convert to Buffer as browser makes it into Uint8Array.
                //
                const message   = Buffer.isBuffer(toSign.message) ? toSign.message : Buffer.from(toSign.message);
                const publicKey = Buffer.isBuffer(toSign.publicKey) ? toSign.publicKey : Buffer.from(toSign.publicKey);

                const dataModel = Decoder.Decode(message);

                dataModel.enforceSigningKey(publicKey);

                const val = dataModel.validate(2);

                if (!val[0]) {
                    throw new Error(`A datamodel did not validate prior to signing: ${val[1]}`);
                }

                signRequests.push(dataModel);

                toBeSigned2.push({index: toSign.index, message: dataModel.hash(), publicKey});
            }

            if (this.triggerOnSign) {
                const allow = await this.triggerOnSign(signRequests);

                if (!allow) {
                    throw new Error("Not allowed to sign");
                }
            }

            return this.signer(toBeSigned2);
        });

        this.rpc.onCall("verifier", (signaturesCollections: SignaturesCollection[]) => {
            return this.verifier(signaturesCollections);
        });
    }

    public async close() {
        this.rpc.close();

        return super.close();
    }
}
