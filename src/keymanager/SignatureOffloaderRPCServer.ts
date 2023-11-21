import {
    KeyPair,
} from "../datamodel/node";

import {
    Decoder,
} from "../datamodel/decoder";

import {
    ToBeSigned,
    SignaturesCollection,
} from "../datamodel/decoder/types";

import {
    SignatureOffloader,
} from "../datamodel/decoder/SignatureOffloader";

import {
    RPC,
} from "../util/RPC";

export class SignatureOffloaderRPCServer extends SignatureOffloader {
    protected rpc: RPC;

    constructor(rpc: RPC, workers?: number) {
        super(workers);

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

        this.rpc.onCall("signer", (toBeSigned: ToBeSigned[]) => {
            const toBeSigned2: ToBeSigned[] = toBeSigned.map( toBeSigned => {
                // Convert to Buffer as browser makes it into Uint8Array.
                //
                const message   = Buffer.isBuffer(toBeSigned.message) ? toBeSigned.message : Buffer.from(toBeSigned.message);
                const publicKey = Buffer.isBuffer(toBeSigned.publicKey) ? toBeSigned.publicKey : Buffer.from(toBeSigned.publicKey);

                const dataModel = Decoder.Decode(message);

                dataModel.enforceSigningKey(publicKey);

                const val = dataModel.validate(2);

                if (!val[0]) {
                    throw new Error(`A datamodel did not validate prior to signing: ${val[1]}`);
                }

                return {index: toBeSigned.index, message: dataModel.hash(),
                    publicKey, crypto: toBeSigned.crypto};
            });

            return this.signer(toBeSigned2);
        });

        this.rpc.onCall("verifier", (signaturesCollections: SignaturesCollection[]) => {
            return this.verifier(signaturesCollections);
        });
    }
}
