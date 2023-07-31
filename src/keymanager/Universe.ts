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
    protected rpc: RPC;

    constructor(rpc: RPC) {

        this.rpc = rpc;
    }

    public async auth(): Promise<{
        signatureOffloader?: SignatureOffloaderInterface,
        handshakeFactoryFactory?: HandshakeFactoryFactoryInterface,
        error?: string,
    }> {

        const authResponse = await this.rpc.call("auth") as AuthResponse;

        if (authResponse.error || !authResponse.signatureOffloaderRPCId || !authResponse.handshakeRPCId) {
            return {
                error: authResponse.error ?? "Unknown error",
            };
        }

        const rpc1 = this.rpc.clone(authResponse.signatureOffloaderRPCId);
        const signatureOffloader = new SignatureOffloaderRPCClient(rpc1);

        const rpc2 = this.rpc.clone(authResponse.handshakeRPCId);
        const handshakeFactoryFactory = CreateHandshakeFactoryFactoryRPCClient(rpc2);

        return {
            signatureOffloader,
            handshakeFactoryFactory,
        };
    }
}
