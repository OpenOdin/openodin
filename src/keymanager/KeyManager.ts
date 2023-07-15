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

import {
    AuthResponse,
    AuthResponse2,
} from "./types";

export class KeyManager {
    protected rpcId: string;
    protected rpc: RPC;
    protected postMessage: (message: any) => void;
    protected listenMessage: ( (message: any) => void);

    protected triggerOnAuth?: (rpcId1: string, rpcId2: string) => Promise<AuthResponse2>;

    constructor(postMessage: (message: any) => void, listenMessage: ( (message: any) => void)) {

        this.postMessage = postMessage;
        this.listenMessage = listenMessage;

        this.rpcId = Buffer.from(crypto.randomBytes(8)).toString("hex");

        this.rpc = new RPC(this.postMessage, this.listenMessage, this.rpcId);

        this.rpc.onCall("auth", this.auth);
    }

    public onAuth(fn: (rpcId1: string, rpcId2: string) => Promise<AuthResponse2>) {
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
     * @returns AuthResponse.
     */
    protected auth = async (): Promise<AuthResponse> => {
        const signatureOffloaderRPCId = Buffer.from(crypto.randomBytes(8)).toString("hex");
        const handshakeRPCId = Buffer.from(crypto.randomBytes(8)).toString("hex");

        if (!this.triggerOnAuth) {
            return {
                error: "No auth callback defined in KeyManager",
            };
        }

        const authResponse2 = await this.triggerOnAuth(signatureOffloaderRPCId, handshakeRPCId);

        const keyPairs = authResponse2.keyPairs ?? [];

        if (authResponse2.error || keyPairs.length === 0) {
            return {
                error: authResponse2.error ?? "No keys provided",
            };
        }

        const rpc1 = new RPC(this.postMessage, this.listenMessage, signatureOffloaderRPCId);
        const rpc2 = new RPC(this.postMessage, this.listenMessage, handshakeRPCId);

        // TODO: keep track of browser's tab close event to close and remove objects.

        const signatureOffloaderServer = new SignatureOffloaderRPCServer(rpc1);
        await signatureOffloaderServer.init();

        const keyPairsLength = keyPairs.length;
        for (let i=0; i<keyPairsLength; i++) {
            const keyPair = keyPairs[i];
            await signatureOffloaderServer.addKeyPair(keyPair);
        }

        const handshakeFactoryFactoryRPCCserver = new HandshakeFactoryFactoryRPCServer(rpc2, keyPairs);

        return {
            signatureOffloaderRPCId,
            handshakeRPCId,
        };
    }

    public getRPCId(): string {
        return this.rpcId;
    }
}
