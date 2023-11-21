import {
    HandshakeFactoryConfig,
} from "pocket-messaging";

import {
    RPC,
} from "../util/RPC";

import {
    KeyPair,
} from "../datamodel";

import {
    HandshakeFactoryRPCServer,
} from "./HandshakeFactoryRPCServer";

import {
    PeerProps,
    PeerDataUtil,
} from "../p2pclient";

import {
    DeepCopy,
} from "../util/common";

export class HandshakeFactoryFactoryRPCServer {
    protected rpc: RPC;
    protected keyPairs: KeyPair[];
    protected handshakeFactories: HandshakeFactoryRPCServer[] = [];

    constructor(rpc: RPC, keyPairs: KeyPair[]) {
        this.rpc = rpc;
        this.keyPairs = keyPairs;

        this.rpc.onCall("create", async (userHandshakeFactoryConfig: HandshakeFactoryConfig, peerProps: PeerProps) => {
            //
            // Note:
            // At this point we can pop a modal dialog to confirm the parameters of userHandshakeFactoryConfig,
            // or to complement or override the parameters.
            //

            const rpc2 = this.rpc.fork();

            const rpcId2 = rpc2.getId();

            const userHandshakeFactoryConfig2 = DeepCopy(userHandshakeFactoryConfig) as HandshakeFactoryConfig;
            const props = DeepCopy(peerProps);

            // Override given userHandshakeFactoryConfig with the keymanager values.
            //
            let keyPair: KeyPair | undefined;

            if (userHandshakeFactoryConfig2.keyPair.publicKey.equals(Buffer.alloc(0)) ||
                userHandshakeFactoryConfig2.keyPair.publicKey.equals(Buffer.alloc(32))) {

                keyPair = this.keyPairs[0];
            }
            else {
                keyPair = this.keyPairs.find( keyPair2 => keyPair2.publicKey.
                    equals(userHandshakeFactoryConfig2.keyPair.publicKey));
            }

            if (!keyPair) {
                return undefined;
            }

            userHandshakeFactoryConfig2.keyPair = keyPair;


            userHandshakeFactoryConfig2.peerData = (/*isServer: boolean*/) => {
                // We need to get a fresh timestamp of when entering the handshake.
                // This is important for the calculated clock skew to be correct.
                props.clock = Date.now();
                return PeerDataUtil.PropsToPeerData(props).export();
            };

            const handshakeFactoryRPCServer = new HandshakeFactoryRPCServer(rpc2,
                userHandshakeFactoryConfig2);

            this.handshakeFactories.push(handshakeFactoryRPCServer);

            return rpcId2;
        });
    }

    public close() {
        this.handshakeFactories.forEach( handshakeFactoryRPCServer => handshakeFactoryRPCServer.close() );
        this.handshakeFactories.length = 0;
    }
}
