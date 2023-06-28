import crypto from "crypto";

import {
    SignatureOffloaderRPCServer,
} from "./SignatureOffloaderRPCServer";

import {
    HandshakeFactoryFactoryRPCServer,
} from "./HandshakeFactoryFactoryRPCServer";

import {
    KeyPair,
} from "../datamodel";

import {
    RPC,
} from "./RPC";

export class KeyManager {
    protected rpcId: string;
    protected rpc: RPC;
    protected postMessage: (message: any) => void;
    protected listenMessage: ( (message: any) => void);
    protected keyPairs: KeyPair[];

    constructor(postMessage: (message: any) => void,
        listenMessage: ( (message: any) => void),
        keyPairs: KeyPair[]) {

        this.postMessage = postMessage;
        this.listenMessage = listenMessage;
        this.keyPairs = keyPairs;

        this.rpcId = Buffer.from(crypto.randomBytes(8)).toString("hex");

        this.rpc = new RPC(this.postMessage, this.listenMessage, this.rpcId);

        this.rpc.onCall("auth", this.auth);
    }

    protected auth = async () => {
        const rpcId1 = Buffer.from(crypto.randomBytes(8)).toString("hex");
        const rpcId2 = Buffer.from(crypto.randomBytes(8)).toString("hex");

        const rpc1 = new RPC(this.postMessage, this.listenMessage, rpcId1);
        const rpc2 = new RPC(this.postMessage, this.listenMessage, rpcId2);

        // TODO: keep track of browser's tab close event to close and remove objects.

        const signatureOffloaderServer = new SignatureOffloaderRPCServer(rpc1);
        await signatureOffloaderServer.init();
        await signatureOffloaderServer.addKeyPair(this.keyPairs[0]);

        const handshakeFactoryFactoryRPCCserver = new HandshakeFactoryFactoryRPCServer(rpc2,
            this.keyPairs);

        return [rpcId1, rpcId2];
    }

    public getRPCId(): string {
        return this.rpcId;
    }
}
