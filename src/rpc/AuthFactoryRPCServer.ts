import {
    HandshakeFactoryInterface,
} from "pocket-messaging";

import {
    RPC,
} from "../util/RPC";

import {
    KeyPair,
    Krypto,
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
    ConnectionConfig,
} from "../service/types";

export class AuthFactoryRPCServer {
    protected rpc: RPC;
    protected keyPairs: KeyPair[];
    protected handshakeFactories: HandshakeFactoryInterface[] = [];
    protected triggerOnCreate?: (connection: ConnectionConfig["connection"]) => Promise<boolean>;

    constructor(rpc: RPC, keyPairs: KeyPair[], triggerOnCreate?: (connection: ConnectionConfig["connection"]) => Promise<boolean>) {
        this.rpc = rpc;
        this.keyPairs = keyPairs;
        this.triggerOnCreate = triggerOnCreate;

        this.rpc.onCall("create", async (connection: ConnectionConfig["connection"]) => {
            // User must confirm connection parameters of connection.
            //
            if (this.triggerOnCreate && ! (await this.triggerOnCreate(connection))) {
                return undefined;
            }

            const authFactoryConfig = connection.handshake ?? connection.api;

            if (authFactoryConfig) {
                const rpc2 = this.rpc.fork();

                const rpcId2 = rpc2.getId();

                // Override given nativeAuthFactoryConfig with the rpc server values.
                //
                let keyPair: KeyPair | undefined;

                if (authFactoryConfig.keyPair.publicKey.equals(Buffer.alloc(0)) ||
                    authFactoryConfig.keyPair.publicKey.equals(Buffer.alloc(32))) {

                    keyPair = this.keyPairs[0];
                }
                else {
                    keyPair = this.keyPairs.find( keyPair2 => keyPair2.publicKey.
                        equals(authFactoryConfig.keyPair.publicKey));
                }

                if (!keyPair) {
                    throw new Error("No KeyPair configured");
                }

                if (!Krypto.IsEd25519(keyPair.publicKey)) {
                    throw new Error("Auth must be done with an Ed25519 keypair.");
                }

                authFactoryConfig.keyPair = DeepCopy(keyPair) as KeyPair;

                const serverPublicKey = authFactoryConfig.serverPublicKey;

                if (serverPublicKey) {
                    if (!Krypto.IsEd25519(serverPublicKey)) {
                        throw new Error("Auth must be done with serverPublicKey being an Ed25519 public key.");
                    }
                }

                const allowedClients = authFactoryConfig.allowedClients;

                if (Array.isArray(allowedClients)) {
                    // We need to check every public key so it is Ed25519.
                    //
                    allowedClients.forEach( publicKey => {
                        if (!Krypto.IsEd25519(publicKey)) {
                            throw new Error("Auth must be done with native Ed25519 keypairs, also all public keys in allowedClients must be Ed25519 public keys.");
                        }
                    });
                }

                if (connection.handshake) {
                    const handshakeFactoryRPCServer = new HandshakeFactoryRPCServer(rpc2,
                        authFactoryConfig);

                    this.handshakeFactories.push(handshakeFactoryRPCServer);
                }
                else if (connection.api) {
                    const apiHandshakeFactoryRPCServer = new APIHandshakeFactoryRPCServer(rpc2,
                        authFactoryConfig);

                    this.handshakeFactories.push(apiHandshakeFactoryRPCServer);
                }
                else {
                    throw new Error("Unknown handshake factory config");
                }

                return rpcId2;
            }

            throw new Error("Unknown handshake factory config");
        });
    }

    public close() {
        this.rpc.close();

        this.handshakeFactories.forEach( handshakeFactoryRPCServer =>
            handshakeFactoryRPCServer.close() );
        this.handshakeFactories.length = 0;
    }
}
