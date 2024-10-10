import {
    HandshakeFactoryInterface,
} from "pocket-messaging";

import {
    RPC,
} from "../util/RPC";

import {
    CommonHandshakeFactoryRPCClient,
} from "./CommonHandshakeFactoryRPCClient";

import {
    AuthFactoryInterface,
} from "../auth/types";

import {
    ConnectionConfig,
} from "../service/types";

export class AuthFactoryRPCClient implements AuthFactoryInterface {
    constructor(protected rpc1: RPC) {}

    public async create(connection: ConnectionConfig["connection"]): Promise<HandshakeFactoryInterface> {

        const authFactoryConfig = connection.handshake ?? connection.api;

        if (typeof((authFactoryConfig as any).peerData) === "function") {
            throw new Error("handshakeFactoryConfig.peerData cannot be a function when using Handshake RPC.");
        }

        const rpcId2 = await this.rpc1.call("create", [connection]);

        if (!rpcId2) {
            throw new Error("Could not initialize HandshakeFactory");
        }

        const rpc2 = this.rpc1.clone(rpcId2);


        if (authFactoryConfig) {
            // Same RPC client for both handshake and api auth.
            //
            return new CommonHandshakeFactoryRPCClient(rpc2, authFactoryConfig);
        }

        throw new Error("Unknown handshake factory config");
    }
}
