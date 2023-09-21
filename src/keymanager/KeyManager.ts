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
    protected rpc: RPC;
    protected triggerOnAuth?: (rpcId1: string, rpcId2: string) => Promise<AuthResponse2>;
    protected signatureOffloaderRPCServer?: SignatureOffloaderRPCServer;
    protected handshakeFactoryFactoryRPCCserver?: HandshakeFactoryFactoryRPCServer;

    constructor(rpc: RPC) {
        this.rpc = rpc;
        this.rpc.onCall("auth", this.auth);
    }

    public onAuth(fn: (rpcId1: string, rpcId2: string) => Promise<AuthResponse2>) {
        this.triggerOnAuth = fn;
    }

    /**
     * Close resources created when authed.
     */
    public close() {
        this.signatureOffloaderRPCServer?.close();
        this.handshakeFactoryFactoryRPCCserver?.close();
    }

    /**
     * The application is requesting to be authorized.
     * @returns AuthResponse.
     */
    protected auth = async (): Promise<AuthResponse> => {
        if (this.signatureOffloaderRPCServer || this.handshakeFactoryFactoryRPCCserver) {
            return {
                error: "KeyManager already authenticated",
            };
        }

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

        const rpc1 = this.rpc.clone(signatureOffloaderRPCId);
        const rpc2 = this.rpc.clone(handshakeRPCId);

        this.signatureOffloaderRPCServer = new SignatureOffloaderRPCServer(rpc1, 1);  // Only use one separate worker thread in RPC (browser) scenarios.
        await this.signatureOffloaderRPCServer.init();

        const keyPairs2: KeyPair[] = [];

        const keyPairsLength = keyPairs.length;
        for (let i=0; i<keyPairsLength; i++) {
            const keyPair = keyPairs[i];

            const keyPair2 = {
                publicKey: Buffer.from(keyPair.publicKey),
                secretKey: Buffer.from(keyPair.secretKey),
            };

            keyPairs2.push(keyPair2);

            await this.signatureOffloaderRPCServer.addKeyPair(keyPair2);
        }

        this.handshakeFactoryFactoryRPCCserver = new HandshakeFactoryFactoryRPCServer(rpc2, keyPairs2);

        return {
            signatureOffloaderRPCId,
            handshakeRPCId,
        };
    }

    public getRPCId(): string {
        return this.rpc.getId();
    }
}
