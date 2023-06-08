import {
    HandshakeFactoryConfig,
    HandshakeFactory,
    PeerDataGeneratorFunctionInterface,
} from "pocket-messaging";

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
    return (handshakeFactoryConfig: HandshakeFactoryConfig): HandshakeFactory => {
        const fn = handshakeFactoryConfig.peerData as PeerDataGeneratorFunctionInterface;
        delete handshakeFactoryConfig.peerData;

        const handshakeFactoryConfig2 = DeepCopy(handshakeFactoryConfig) as HandshakeFactoryConfig;
        handshakeFactoryConfig2.peerData = fn.bind(handshakeFactoryConfig2);

        handshakeFactoryConfig2.keyPair = keyPair;
        return new HandshakeFactory(handshakeFactoryConfig2);
    };
}
