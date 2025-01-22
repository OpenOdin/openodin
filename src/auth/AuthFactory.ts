import {
    HandshakeFactory,
    HandshakeFactoryInterface,
} from "pocket-messaging";

import {
    KeyPair,
    Krypto,
} from "../datamodel";

import {
    AuthFactoryInterface,
} from "./types";

import {
    ConnectionConfig,
} from "../service/types";

import {
    APIHandshakeFactory,
} from "./APIHandshakeFactory";

import {
    DeepCopy,
    CopyBuffer,
} from "../util/common";

export class AuthFactory implements AuthFactoryInterface {
    protected keyPair: KeyPair;

    constructor(keyPair: KeyPair) {
        if (!Krypto.IsEd25519(keyPair.publicKey)) {
            throw new Error("AuthFactory must be constructed with an Ed25519 keypair.");
        }

        this.keyPair = {
            secretKey: CopyBuffer(keyPair.secretKey),
            publicKey: CopyBuffer(keyPair.publicKey),
        };
    }

    public async create(connection: ConnectionConfig["connection"]): Promise<HandshakeFactoryInterface> {
        if (connection.handshake) {
            const handshakeFactoryConfig = connection.handshake;

            handshakeFactoryConfig.keyPair = DeepCopy(this.keyPair);

            return new HandshakeFactory(handshakeFactoryConfig);
        }
        else if (connection.api) {
            const apiAuthFactoryConfig = connection.api;

            apiAuthFactoryConfig.keyPair = DeepCopy(this.keyPair);

            return new APIHandshakeFactory(apiAuthFactoryConfig);
        }

        throw new Error("Unknown handshake factory config provided");
    }
}
