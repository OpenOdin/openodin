import {
    KeyPair,
} from "../datamodel/node";

import {
    ToBeSigned,
    SignaturesCollection,
} from "../datamodel/decoder/types";

import {
    SignatureOffloader,
} from "../datamodel/decoder/SignatureOffloader";

import {
    RPC,
} from "./RPC";

export class SignatureOffloaderRPCServer extends SignatureOffloader {
    protected rpc: RPC;

    constructor(rpc: RPC, workers?: number) {
        super(workers);

        this.rpc = rpc;

        this.rpc.onCall("init", () => {
            return this.init();
        });

        this.rpc.onCall("addKeyPair", (keyPair: KeyPair) => {
            return this.addKeyPair(keyPair);
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
            return this.signer(toBeSigned);
        });

        this.rpc.onCall("verifier", (signaturesCollections: SignaturesCollection[]) => {
            return this.verifier(signaturesCollections);
        });
    }
}
