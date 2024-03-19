import {
    HandshakeFactoryInterface,
    HandshakeFactoryConfig,
} from "pocket-messaging";

import {
    RPC,
} from "../util/RPC";

import {
    CommonHandshakeFactoryRPCClient,
} from "./CommonHandshakeFactoryRPCClient";

import {
    AuthFactoryInterface,
    AuthFactoryConfig,
} from "../auth/types";

export class AuthFactoryRPCClient implements AuthFactoryInterface {
    constructor(protected rpc1: RPC) {}

    public async create(authFactoryConfig: AuthFactoryConfig): Promise<HandshakeFactoryInterface> {
        if (typeof((authFactoryConfig as any).peerData) === "function") {
            throw new Error("handshakeFactoryConfig.peerData cannot be a function when using Handshake RPC.");
        }

        const rpcId2 = await this.rpc1.call("create", [authFactoryConfig]);

        if (!rpcId2) {
            throw new Error("Could not initialize HandshakeFactory");
        }

        const rpc2 = this.rpc1.clone(rpcId2);

        // Same RPC client for both native and API handshake
        if (this.isNativeHandshake(authFactoryConfig)) {
            return new CommonHandshakeFactoryRPCClient(rpc2, authFactoryConfig as unknown as HandshakeFactoryConfig);
        }
        else if (this.isAPIHandshake(authFactoryConfig)) {
            return new CommonHandshakeFactoryRPCClient(rpc2, authFactoryConfig as unknown as HandshakeFactoryConfig);
        }

        throw new Error("Unknown handshake factory config");
    }

    protected isNativeHandshake(authFactoryConfig: AuthFactoryConfig): boolean {
        return authFactoryConfig.factory === "native";
    }

    protected isAPIHandshake(authFactoryConfig: AuthFactoryConfig): boolean {
        return authFactoryConfig.factory === "api";
    }

}
