import crypto from "crypto";

import {
    RPC,
} from "./RPC";

import {
    PeerData,
} from "../p2pclient";

import {
    HandshakeFactory,
    HandshakeFactoryConfig,
    Messaging,
    HandshakeResult,
    EncryptedClient,
} from "pocket-messaging";

import {
    ClientInterface,
} from "pocket-sockets";

import {
    SocketRPCServer,
} from "./SocketRPCServer";

import {
    ClientConfig,
} from "./types";

type RPCServer = {
    client: ClientInterface,
    clientConfig: ClientConfig,
    rpcServer?: SocketRPCServer,
};

/**
 * Wrap a HandshakeFactory and provide RPC communication to it.
 *
 */
export class HandshakeFactoryRPCServer extends HandshakeFactory {
    protected rpc: RPC;
    protected rpcServers: RPCServer[] = [];

    constructor(rpc: RPC, handshakeFactoryConfig: HandshakeFactoryConfig) {
        super(handshakeFactoryConfig);

        this.rpc = rpc;

        this.rpc.onCall("init", () => {
            return this.init();
        });

        this.rpc.onCall("close", () => {
            return this.close();
        });

        this.rpc.onCall("shutdown", () => {
            return this.shutdown();
        });

        this.rpc.onCall("getStats", () => {
            return this.getStats();
        });

        // Note: the following functions are only implemented on the RPC client.
        // getSocketFactoryConfig
        // getHandshakeFactoryConfig
        // isClosed
        // isShutdown

        this.onHandshake( (e: {messaging: Messaging, isServer: boolean, handshakeResult: HandshakeResult}) => {
            const encryptedClient = e.messaging.getClient() as EncryptedClient;

            const socket = this.getRPCServerByClient(encryptedClient.getClient());

            const clientId = socket.clientConfig.clientId;
            const rpcServer = new SocketRPCServer(this.rpc, encryptedClient, clientId);
            socket.rpcServer = rpcServer;

            const peerData = e.handshakeResult.peerData;

            const peerLongtermPk = e.handshakeResult.peerLongtermPk;

            this.rpc.call("onHandshake", [clientId, peerData, peerLongtermPk, e.isServer]);
        });

        this.onHandshakeError( (e: {error: Error, client: ClientInterface}) => {
            const socket = this.getRPCServerByClient(e.client);

            const clientId = socket.clientConfig.clientId;

            this.rpc.call("onHandshakeError", [e.error, clientId]);
        });

        this.onError( (e: {subEvent: string, e: {error: Error}}) => {
            this.rpc.call("onError", [e.subEvent, e.e.error]);
        });

        this.onServerInitError( (error: Error) => {
            this.rpc.call("onServerInitError", [error]);
        });

        this.onServerListenError( (error: Error) => {
            this.rpc.call("onServerListenError", [error]);
        });

        this.onClientInitError( (e: {error: Error}) => {
            this.rpc.call("onClientInitError", [e.error]);
        });

        this.onConnectError( (error: Error) => {
            this.rpc.call("onConnectError", [error]);
        });

        this.onConnect( (e: {client: ClientInterface, isServer: boolean}) => {
            const clientId = Buffer.from(crypto.randomBytes(8)).toString("hex");

            const clientConfig: ClientConfig = {
                clientId,
                localAddress: e.client.getLocalAddress(),
                localPort: e.client.getLocalPort(),
                remoteAddress: e.client.getRemoteAddress(),
                remotePort: e.client.getRemotePort(),
            };

            this.rpcServers.push({
                client: e.client,
                clientConfig,
                rpcServer: undefined,
            });

            this.rpc.call("onConnect", [clientConfig, e.isServer]);
        });

        this.onClose( (e: {client: ClientInterface, isServer: boolean, hadError: boolean}) => {
            const socket = this.getRPCServerByClient(e.client);

            const clientId = socket.clientConfig.clientId;

            // Clean up with a delay since onHandshakeError needs to find the client.
            setTimeout( () => this.removeRPCServer(clientId), 10000 );

            this.rpc.call("onClose", [clientId, e.isServer, e.hadError]);
        });

        this.onRefusedClientConnection( (e: {reason: string, key: string}) => {
            this.rpc.call("onRefusedClientConnection", [e.reason, e.key]);
        });
    }

    protected getRPCServerByClient(client: ClientInterface): RPCServer {
        const socket = this.rpcServers.find( socket => socket.client === client );

        if (!socket) {
            throw new Error("RPCServer not available as expected");
        }

        return socket;
    }

    protected removeRPCServer(clientId: string) {
        const index = this.rpcServers.findIndex( socket => socket.clientConfig.clientId === clientId );

        if (index > -1) {
            this.rpcServers.splice(index, 1);
        }
    }
}