import {
    HandshakeFactoryConfig,
    HandshakeFactory,
    HandshakeFactoryInterface,
    PeerDataGeneratorFunctionInterface,
} from "pocket-messaging";

import {
    PeerProps,
    PeerDataUtil,
} from "../p2pclient";

import {
    KeyPair,
} from "../datamodel";

import {
    HandshakeFactoryFactoryInterface,
} from "./types";

import {
    DeepCopy,
} from "../util/common";

export function CreateHandshakeFactoryFactory(keyPair: KeyPair): HandshakeFactoryFactoryInterface {
    return async (handshakeFactoryConfig: HandshakeFactoryConfig, peerProps: PeerProps): Promise<HandshakeFactoryInterface> => {
        const props = DeepCopy(peerProps);

        if (handshakeFactoryConfig.peerData) {
            throw new Error("handshakeFactoryConfig.peerData must be unset");
        }

        const handshakeFactoryConfig2 = DeepCopy(handshakeFactoryConfig) as HandshakeFactoryConfig;

        handshakeFactoryConfig2.keyPair = keyPair;

        handshakeFactoryConfig2.peerData = (/*isServer: boolean*/) => {
            // We need to get a fresh timestamp of when entering the handshake.
            // This is important for the calculated clock skew to be correct.
            props.clock = Date.now();
            return PeerDataUtil.PropsToPeerData(props).export();
        };

        return new HandshakeFactory(handshakeFactoryConfig2);
    };
}
