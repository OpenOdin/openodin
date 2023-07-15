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

    protected triggerOnAuth?: (rpcId1: string, rpcId2: string) => Promise<KeyPair[]>;

    constructor(postMessage: (message: any) => void, listenMessage: ( (message: any) => void)) {

        this.postMessage = postMessage;
        this.listenMessage = listenMessage;

        this.rpcId = Buffer.from(crypto.randomBytes(8)).toString("hex");

        this.rpc = new RPC(this.postMessage, this.listenMessage, this.rpcId);

        this.rpc.onCall("auth", this.auth);
    }

    public onAuth(fn: (rpcId1: string, rpcId2: string) => Promise<KeyPair[]>) {
        this.triggerOnAuth = fn;
    }

    /**
     * Close resources created when authed.
     */
    public closeAuth(rpcId1: string, rpcId2: string) {
        // TODO
    }

    /**
     * The application is requesting to be authorized.
     * @returns [rpcId1: string, rpcId2: string]
     * where rpcId1 is the RPC for signing using SignatureOffloader,
     * and rpcId2 us the RPC for connecting and handshaking.
     */
    protected auth = async (): Promise<[string?, string?]> => {
        const rpcId1 = Buffer.from(crypto.randomBytes(8)).toString("hex");
        const rpcId2 = Buffer.from(crypto.randomBytes(8)).toString("hex");

        if (!this.triggerOnAuth) {
            console.debug("No auth callback defined in KeyManager.");
            return [];
        }

        const keyPairs = await this.triggerOnAuth(rpcId1, rpcId2);

        if (!keyPairs || keyPairs.length === 0) {
            return [];
        }

        const rpc1 = new RPC(this.postMessage, this.listenMessage, rpcId1);
        const rpc2 = new RPC(this.postMessage, this.listenMessage, rpcId2);

        // TODO: keep track of browser's tab close event to close and remove objects.

        const signatureOffloaderServer = new SignatureOffloaderRPCServer(rpc1);
        await signatureOffloaderServer.init();

        const keyPairsLength = keyPairs.length;
        for (let i=0; i<keyPairsLength; i++) {
            const keyPair = keyPairs[i];
            await signatureOffloaderServer.addKeyPair(keyPair);
        }

        const handshakeFactoryFactoryRPCCserver = new HandshakeFactoryFactoryRPCServer(rpc2, keyPairs);

        return [rpcId1, rpcId2];
    }

    public getRPCId(): string {
        return this.rpcId;
    }
}
