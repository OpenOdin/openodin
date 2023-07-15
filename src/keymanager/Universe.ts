import {
    RPC,
} from "./RPC";

import {
    CreateHandshakeFactoryFactoryRPCClient,
} from "./HandshakeFactoryFactoryRPCClient";

import {
    SignatureOffloaderInterface,
} from "../datamodel/decoder";

import {
    SignatureOffloaderRPCClient,
} from "./SignatureOffloaderRPCClient";

import {
    HandshakeFactoryFactoryInterface,
} from "../service/types";

import {
    AuthResponse,
} from "./types";

export class Universe {
    protected postMessage: (message: any) => void;
    protected listenMessage: ( (message: any) => void);
    protected mainRPC: RPC;

    constructor(postMessage: (message: any) => void,
        listenMessage: ( (message: any) => void), mainRPCId: string) {

        this.postMessage = postMessage;
        this.listenMessage = listenMessage;

        this.mainRPC = new RPC(this.postMessage, this.listenMessage, mainRPCId);
    }

    public async auth(): Promise<{
        signatureOffloader?: SignatureOffloaderInterface,
        handshakeFactoryFactory?: HandshakeFactoryFactoryInterface,
        error?: string,
    }> {

        const authResponse = await this.mainRPC.call("auth") as AuthResponse;

        if (authResponse.error || !authResponse.signatureOffloaderRPCId || !authResponse.handshakeRPCId) {
            return {
                error: authResponse.error ?? "Unknown error",
            };
        }

        const rpc1 = new RPC(this.postMessage, this.listenMessage, authResponse.signatureOffloaderRPCId);
        const signatureOffloader = new SignatureOffloaderRPCClient(rpc1);

        const rpc2 = new RPC(this.postMessage, this.listenMessage, authResponse.handshakeRPCId);
        const handshakeFactoryFactory = CreateHandshakeFactoryFactoryRPCClient(rpc2);

        return {
            signatureOffloader,
            handshakeFactoryFactory,
        };
    }
}
