import {
    HandshakeFactoryConfig,
    HandshakeFactoryInterface,
} from "pocket-messaging";

import {
    RPC,
} from "../util/RPC";

import {
    KeyPair,
    Crypto,
} from "../datamodel";

import {
    HandshakeFactoryRPCServer,
} from "./HandshakeFactoryRPCServer";

import {
    APIHandshakeFactoryRPCServer,
} from "./APIHandshakeFactoryRPCServer";

import {
    DeepCopy,
} from "../util/common";

import {
    AuthFactoryConfig,
    APIAuthFactoryConfig,
    NativeAuthFactoryConfig,
} from "../auth/types";

export class AuthFactoryRPCServer {
    protected rpc: RPC;
    protected keyPairs: KeyPair[];
    protected handshakeFactories: HandshakeFactoryInterface[] = [];

    constructor(rpc: RPC, keyPairs: KeyPair[]) {
        this.rpc = rpc;
        this.keyPairs = keyPairs;

        this.rpc.onCall("create", async (authFactoryConfig: AuthFactoryConfig) => {
            //
            // Note:
            // At this point we can pop a modal dialog to confirm the parameters of authFactoryConfig,
            // or to complement or override the parameters.
            //

            if (this.isNativeHandshake(authFactoryConfig)) {
                return this.createNativeHandshakeFactory(authFactoryConfig as unknown as
                    NativeAuthFactoryConfig);
            }

            if (this.isAPIHandshake(authFactoryConfig)) {
                return this.createAPIHandshakeFactory(authFactoryConfig as unknown as
                    APIAuthFactoryConfig);
            }

            throw new Error("Unknown handshake factory config");
        });
    }

    public isNativeHandshake(authFactoryConfig: AuthFactoryConfig): boolean {
        return authFactoryConfig.factory === "native";
    }

    public isAPIHandshake(authFactoryConfig: AuthFactoryConfig): boolean {
        return authFactoryConfig.factory === "api";
    }

    protected async createAPIHandshakeFactory(apiAuthFactoryConfig: APIAuthFactoryConfig):
        Promise<string | undefined>
    {
        const rpc2 = this.rpc.fork();

        const rpcId2 = rpc2.getId();

        const apiAuthFactoryConfig2 =
            DeepCopy(apiAuthFactoryConfig) as APIAuthFactoryConfig;

        // Override given apiAuthFactoryConfig with the rpc server values.
        //
        let keyPair: KeyPair | undefined;

        if (apiAuthFactoryConfig2.keyPair.publicKey.equals(Buffer.alloc(0)) ||
            apiAuthFactoryConfig2.keyPair.publicKey.equals(Buffer.alloc(32))) {

            keyPair = this.keyPairs[0];
        }
        else {
            keyPair = this.keyPairs.find( keyPair2 => keyPair2.publicKey.
                equals(apiAuthFactoryConfig2.keyPair.publicKey));
        }

        if (!keyPair) {
            return undefined;
        }

        if (!Crypto.IsEd25519(keyPair.publicKey)) {
            throw new Error("Auth must be done with an Ed25519 keypair.");
        }

        apiAuthFactoryConfig2.keyPair = DeepCopy(keyPair);

        const serverPublicKey = apiAuthFactoryConfig2.serverPublicKey;

        if (serverPublicKey) {
            if (!Crypto.IsEd25519(serverPublicKey)) {
                throw new Error("Auth must be done with serverPublicKey being an Ed25519 public key.");
            }
        }

        const allowedClients = apiAuthFactoryConfig2.allowedClients;

        if (Array.isArray(allowedClients)) {
            // We need to check every public key so it is Ed25519.
            //
            allowedClients.forEach( publicKey => {
                if (!Crypto.IsEd25519(publicKey)) {
                    throw new Error("Auth must be done with native Ed25519 keypairs, also all public keys in allowedClients must be Ed25519 public keys.");
                }
            });
        }

        const apiHandshakeFactoryRPCServer = new APIHandshakeFactoryRPCServer(rpc2,
            apiAuthFactoryConfig2);

        this.handshakeFactories.push(apiHandshakeFactoryRPCServer);

        return rpcId2;
    }

    protected async createNativeHandshakeFactory(nativeAuthFactoryConfig: NativeAuthFactoryConfig):
        Promise<string | undefined>
    {
        const rpc2 = this.rpc.fork();

        const rpcId2 = rpc2.getId();

        const userHandshakeFactoryConfig2 =
            DeepCopy(nativeAuthFactoryConfig) as HandshakeFactoryConfig;

        // Override given nativeAuthFactoryConfig with the rpc server values.
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

        if (!Crypto.IsEd25519(keyPair.publicKey)) {
            throw new Error("Auth must be done with an Ed25519 keypair.");
        }

        userHandshakeFactoryConfig2.keyPair = DeepCopy(keyPair);

        const serverPublicKey = userHandshakeFactoryConfig2.serverPublicKey;

        if (serverPublicKey) {
            if (!Crypto.IsEd25519(serverPublicKey)) {
                throw new Error("Auth must be done with serverPublicKey being an Ed25519 public key.");
            }
        }

        const allowedClients = userHandshakeFactoryConfig2.allowedClients;

        if (Array.isArray(allowedClients)) {
            // We need to check every public key so it is Ed25519.
            //
            allowedClients.forEach( publicKey => {
                if (!Crypto.IsEd25519(publicKey)) {
                    throw new Error("Auth must be done with native Ed25519 keypairs, also all public keys in allowedClients must be Ed25519 public keys.");
                }
            });
        }

        const handshakeFactoryRPCServer = new HandshakeFactoryRPCServer(rpc2,
            userHandshakeFactoryConfig2);

        this.handshakeFactories.push(handshakeFactoryRPCServer);

        return rpcId2;
    }

    public close() {
        this.rpc.close();

        this.handshakeFactories.forEach( handshakeFactoryRPCServer =>
            handshakeFactoryRPCServer.close() );
        this.handshakeFactories.length = 0;
    }
}
