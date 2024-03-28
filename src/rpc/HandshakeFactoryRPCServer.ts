import crypto from "crypto";

import {
    RPC,
} from "../util/RPC";

import {
    HandshakeFactory,
    HandshakeFactoryConfig,
    HandshakeResult,
} from "pocket-messaging";

import {
    ClientInterface,
    SocketFactoryErrorCallbackNames,
    SocketFactoryClientIPRefuseDetail,
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

        this.onHandshake( async (isServer: boolean, client: ClientInterface,
            wrappedClient: ClientInterface, handshakeResult: HandshakeResult) =>
        {
            const socket = this.getRPCServerByClient(client);

            await wrappedClient.init();

            const clientId = socket.clientConfig.clientId;
            const rpcServer = new SocketRPCServer(this.rpc, wrappedClient, clientId);
            socket.rpcServer = rpcServer;

            const longtermPk = handshakeResult.longtermPk;
            const peerLongtermPk = handshakeResult.peerLongtermPk;
            const peerData = handshakeResult.peerData;
            const clockDiff = handshakeResult.clockDiff;

            this.rpc.call("onHandshake",
                [clientId, longtermPk, peerLongtermPk, peerData, clockDiff, isServer]);
        });

        this.onHandshakeError( (error: Error) => {
            this.rpc.call("onHandshakeError", [error.message]);
        });

        this.onSocketFactoryError( (name: SocketFactoryErrorCallbackNames, error: Error) => {
            this.rpc.call("onSocketFactoryError", [name, error.message]);
        });

        this.onServerInitError( (error: Error) => {
            this.rpc.call("onServerInitError", [error.message]);
        });

        this.onServerListenError( (error: Error) => {
            this.rpc.call("onServerListenError", [error.message]);
        });

        this.onClientInitError( (error: Error) => {
            this.rpc.call("onClientInitError", [error.message]);
        });

        this.onConnectError( (error: Error) => {
            this.rpc.call("onConnectError", [error.message]);
        });

        this.onConnect( (client: ClientInterface, isServer: boolean) => {
            const clientId = Buffer.from(crypto.randomBytes(8)).toString("hex");

            const clientConfig: ClientConfig = {
                clientId,
                localAddress: client.getLocalAddress(),
                localPort: client.getLocalPort(),
                remoteAddress: client.getRemoteAddress(),
                remotePort: client.getRemotePort(),
                isWebSocket: client.isWebSocket(),
                isTextMode: client.isTextMode(),
            };

            this.rpcServers.push({
                client,
                clientConfig,
                rpcServer: undefined,
            });

            this.rpc.call("onConnect", [clientConfig, isServer]);
        });

        this.onClose( (client: ClientInterface, isServer: boolean, hadError: boolean) => {
            const socket = this.getRPCServerByClient(client);

            const clientId = socket.clientConfig.clientId;

            // Clean up with a delay since onHandshakeError needs to find the client.
            setTimeout( () => this.removeRPCServer(clientId), 10000 );

            this.rpc.call("onClose", [clientId, isServer, hadError]);
        });

        this.onClientIPRefuse( (detail: SocketFactoryClientIPRefuseDetail, ipAddress: string) => {
            this.rpc.call("onClientIPRefuse", [detail, ipAddress]);
        });
    }

    public close() {
        this.rpc.close();

        super.close();

        this.rpcServers.map( o => o.rpcServer?.close() );
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
