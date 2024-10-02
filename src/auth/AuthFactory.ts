import {
    HandshakeFactoryConfig,
    HandshakeFactory,
    HandshakeFactoryInterface,
} from "pocket-messaging";

import {
    KeyPair,
    Crypto,
} from "../datamodel";

import {
    AuthFactoryConfig,
    AuthFactoryInterface,
    NativeAuthFactoryConfig,
    APIAuthFactoryConfig,
} from "./types";

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
        if (!Crypto.IsEd25519(keyPair.publicKey)) {
            throw new Error("AuthFactory must be constructed with an Ed25519 keypair.");
        }

        this.keyPair = {
            secretKey: CopyBuffer(keyPair.secretKey),
            publicKey: CopyBuffer(keyPair.publicKey),
        };
    }

    public async create(authFactoryConfig: AuthFactoryConfig): Promise<HandshakeFactoryInterface> {
        if (AuthFactory.IsNativeHandshake(authFactoryConfig)) {
            return this.createNativeHandshakeFactory(authFactoryConfig as unknown as
                NativeAuthFactoryConfig, this.keyPair);
        }

        if (AuthFactory.IsAPIHandshake(authFactoryConfig)) {
            return this.createAPIHandshakeFactory(authFactoryConfig as unknown as
                APIAuthFactoryConfig, this.keyPair);
        }

        throw new Error(`Unknown handshake factory config: ${authFactoryConfig.factory}`);
    }

    public static IsNativeHandshake(authFactoryConfig: AuthFactoryConfig): boolean {
        return authFactoryConfig.factory === "native";
    }

    public static IsAPIHandshake(authFactoryConfig: AuthFactoryConfig): boolean {
        return authFactoryConfig.factory === "api";
    }

    protected async createAPIHandshakeFactory(apiAuthFactoryConfig: APIAuthFactoryConfig,
        keyPair: KeyPair): Promise<APIHandshakeFactory>
    {
        const apiAuthFactoryConfig2 = DeepCopy(apiAuthFactoryConfig) as APIAuthFactoryConfig;

        apiAuthFactoryConfig2.keyPair = DeepCopy(keyPair) as KeyPair;

        const serverPublicKey = apiAuthFactoryConfig2.serverPublicKey;

        if (serverPublicKey) {
            if (!Crypto.IsEd25519(serverPublicKey)) {
                throw new Error("Handshake must be done with serverPublicKey being an Ed25519 public key.");
            }
        }

        const allowedClients = apiAuthFactoryConfig2.allowedClients;

        if (Array.isArray(allowedClients)) {
            // We need to check so every key is Ed22519.
            //
            allowedClients.forEach( publicKey => {
                if (!Crypto.IsEd25519(publicKey)) {
                    throw new Error("Handshake must be done with Ed25519 keypairs, where all public keys in allowedClients must be Ed25519 public keys.");
                }
            });
        }

        return new APIHandshakeFactory(apiAuthFactoryConfig2);
    }

    protected async createNativeHandshakeFactory(nativeAuthFactoryConfig: NativeAuthFactoryConfig,
        keyPair: KeyPair): Promise<HandshakeFactory>
    {
        const handshakeFactoryConfig2 = DeepCopy(nativeAuthFactoryConfig) as HandshakeFactoryConfig;

        handshakeFactoryConfig2.keyPair = DeepCopy(keyPair) as KeyPair;

        const serverPublicKey = handshakeFactoryConfig2.serverPublicKey;

        if (serverPublicKey) {
            if (!Crypto.IsEd25519(serverPublicKey)) {
                throw new Error("Handshake must be done with serverPublicKey being an Ed25519 public key.");
            }
        }

        const allowedClients = handshakeFactoryConfig2.allowedClients;

        if (Array.isArray(allowedClients)) {
            // We need to check so every key is Ed22519.
            //
            allowedClients.forEach( publicKey => {
                if (!Crypto.IsEd25519(publicKey)) {
                    throw new Error("Handshake must be done with Ed25519 keypairs, where all public keys in allowedClients must be Ed25519 public keys.");
                }
            });
        }

        return new HandshakeFactory(handshakeFactoryConfig2);
    }
}
