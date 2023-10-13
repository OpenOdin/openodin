import {
    HandshakeFactoryConfig,
    HandshakeFactoryInterface,
} from "pocket-messaging";

import {
    PeerProps,
} from "../p2pclient";

import {
    RPC,
} from "./RPC";

import {
    HandshakeFactoryRPCClient,
} from "./HandshakeFactoryRPCClient";

import {
    HandshakeFactoryFactoryInterface,
} from "../service/types";

export function CreateHandshakeFactoryFactoryRPCClient(rpc1: RPC): HandshakeFactoryFactoryInterface {
    return async (userHandshakeFactoryConfig: HandshakeFactoryConfig, peerProps: PeerProps): Promise<HandshakeFactoryInterface> => {

        if (userHandshakeFactoryConfig.peerData) {
            throw new Error("handshakeFactoryConfig.peerData must be unset when using Handshake RPC.");
        }

        const rpcId2 = await rpc1.call("create", [userHandshakeFactoryConfig, peerProps]);

        if (!rpcId2) {
            throw new Error("Could not initialize HandshakeFactory");
        }

        const rpc2 = rpc1.clone(rpcId2);

        return new HandshakeFactoryRPCClient(rpc2, userHandshakeFactoryConfig);
    };
}
