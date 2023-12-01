import {
    HandshakeFactoryConfig,
    HandshakeFactory,
    HandshakeFactoryInterface,
} from "pocket-messaging";

import {
    PeerProps,
    PeerDataUtil,
} from "../p2pclient";

import {
    KeyPair,
    Crypto,
} from "../datamodel";

import {
    HandshakeFactoryFactoryInterface,
} from "./types";

import {
    DeepCopy,
    CopyBuffer,
} from "../util/common";


export function CreateHandshakeFactoryFactory(keyPair: KeyPair): HandshakeFactoryFactoryInterface {
    if (!Crypto.IsEd25519(keyPair.publicKey)) {
        throw new Error("Handshake must be done with a Ed25519 keypair.");
    }

    const keyPair2 = {
        secretKey: CopyBuffer(keyPair.secretKey),
        publicKey: CopyBuffer(keyPair.publicKey),
    };

    return async (handshakeFactoryConfig: HandshakeFactoryConfig, peerProps: PeerProps): Promise<HandshakeFactoryInterface> => {
        const props = DeepCopy(peerProps, true);

        if (handshakeFactoryConfig.peerData) {
            throw new Error("handshakeFactoryConfig.peerData must be unset");
        }

        const handshakeFactoryConfig2 = DeepCopy(handshakeFactoryConfig) as HandshakeFactoryConfig;

        handshakeFactoryConfig2.keyPair = keyPair2;

        const serverPublicKey = handshakeFactoryConfig2.serverPublicKey;

        if (serverPublicKey) {
            if (!Crypto.IsEd25519(keyPair.publicKey)) {
                throw new Error("Handshake must be done with serverPublicKey beging an Ed25519 public key.");
            }

            handshakeFactoryConfig2.serverPublicKey = CopyBuffer(serverPublicKey);
        }

        const allowedClients = handshakeFactoryConfig2.allowedClients;

        if (Array.isArray(allowedClients)) {
            // We need to check so every key is Ed22519.
            //
            handshakeFactoryConfig2.allowedClients = allowedClients.map( publicKey => {
                if (!Crypto.IsEd25519(publicKey)) {
                    throw new Error("Handshake must be done with Ed25519 keypairs, where all public keys in allowedClients must be Ed25519 public keys.");
                }

                return CopyBuffer(publicKey);
            });
        }

        handshakeFactoryConfig2.peerData = (/*isServer: boolean*/) => {
            // We need to get a fresh timestamp of when entering the handshake.
            // This is important for the calculated clock skew to be correct.
            props.clock = Date.now();
            return PeerDataUtil.PropsToPeerData(props).export();
        };

        return new HandshakeFactory(handshakeFactoryConfig2);
    };
}
