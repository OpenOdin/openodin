import {
    HandshakeFactoryInterface,
    HandshakeFactoryConfig,
    HandshakeCallback,
    HandshakeErrorCallback,
    Messaging,
} from "pocket-messaging";

import {
    ServerInitErrorCallback,
    ServerListenErrorCallback,
    ErrorCallback,
    SocketFactoryStats,
    SocketFactoryConfig,
    ClientInitErrorCallback,
    ClientConnectErrorCallback,
    ConnectCallback,
    CloseCallback,
    ClientRefuseCallback,
} from "pocket-sockets";

import {
    RPC,
} from "./RPC";

import {
    ClientConfig,
} from "./types";

import {
    SocketRPCClient,
} from "./SocketRPCClient";


export class HandshakeFactoryRPCClient implements HandshakeFactoryInterface {
    protected rpc: RPC;
    protected _isClosed = false;
    protected _isShutdown = false;
    protected userHandshakeFactoryConfig: HandshakeFactoryConfig;
    protected handlers: {[type: string]: Function[]} = {};
    protected sockets: SocketRPCClient[] = [];

    constructor(rpc: RPC, userHandshakeFactoryConfig: HandshakeFactoryConfig) {
        this.rpc = rpc;

        this.userHandshakeFactoryConfig = userHandshakeFactoryConfig;

        this.rpc.onCall("onHandshake", (clientId: string, peerData: Buffer, peerLongtermPk: Buffer, isServer: boolean) => {
            const client = this.getSocketRPCClient(clientId);

            const messaging = new Messaging(client);

            const handshakeResult = {
                peerData,
                peerLongtermPk,
            };

            const e = {
                messaging,
                isServer,
                handshakeResult,
            };

            this.triggerEvent("handshake", e);
        });

        this.rpc.onCall("onHandshakeError", (error: Error, clientId: string) => {
            const client = this.getSocketRPCClient(clientId);

            const e = {
                error,
                client,
            };

            this.triggerEvent("handshakeError", e);
        });

        this.rpc.onCall("onError", (subEvent: string, error: Error) => {
            const e = {
                subEvent,
                e: {error},
            };

            this.triggerEvent("error", e);
        });

        this.rpc.onCall("onServerInitError", (error: Error) => {
            this.triggerEvent("serverInitError", error);
        });

        this.rpc.onCall("onServerListenError", (error: Error) => {
            this.triggerEvent("serverListenError", error);
        });

        this.rpc.onCall("onClientInitError", (error: Error) => {
            this.triggerEvent("clientInitError", {error});
        });

        this.rpc.onCall("onConnectError", (error: Error) => {
            this.triggerEvent("connectError", error);
        });

        this.rpc.onCall("onConnect", (clientConfig: ClientConfig, isServer: boolean) => {
            const client = this.createSocketRPCClient(clientConfig);

            const e = {
                client,
                isServer
            };

            this.triggerEvent("connect", e);
        });

        this.rpc.onCall("onClose", (clientId: string, isServer: boolean, hadError: boolean) => {
            this._isClosed = true;
            this._isShutdown = true;

            const client = this.getSocketRPCClient(clientId);

            const e = {
                client,
                isServer,
                hadError,
            };

            this.removeSocketRPCClient(clientId);

            this.triggerEvent("close", e);
        });

        this.rpc.onCall("onRefusedClientConnection", (reason: string, key: string) => {
            const e = {
                reason,
                key,
            };

            this.triggerEvent("refusedClientConnection", e);
        });
    }

    public init() {
        this.rpc.call("init");
    }

    /**
     * Returns what it was initialized with which might not be
     * the actual configuration used be the HandshakeFactoryRPCServer.
     */
    public getSocketFactoryConfig(): SocketFactoryConfig {
        return this.userHandshakeFactoryConfig.socketFactoryConfig;
    }

    /**
     * Returns what it was initialized with which might not be
     * the actual configuration used be the HandshakeFactoryRPCServer.
     */
    public getHandshakeFactoryConfig(): HandshakeFactoryConfig {
        return this.userHandshakeFactoryConfig;
    }

    /**
     * Shutdown factories and close all open sockets.
     */
    public close() {
        if (this._isClosed) {
            return;
        }

        this._isClosed = true;

        this._isShutdown = true;

        this.rpc.call("close");
    }

    /**
     * Leave existing connections open but do not attempt any new connections.
     */
    public shutdown() {
        if (this._isShutdown) {
            return;
        }

        this._isShutdown = true;

        this.rpc.call("shutdown");
    }

    public isClosed(): boolean {
        return this._isClosed;
    }

    public isShutdown(): boolean {
        return this._isShutdown;
    }

    public getStats(): SocketFactoryStats {
        const stats = this.rpc.call("getStats") as any;

        return stats;
    }

    public onError(callback: ErrorCallback) {
        this.hookEvent("error", callback);
    }

    public onServerInitError(callback: ServerInitErrorCallback) {
        this.hookEvent("serverInitError", callback);
    }

    public onServerListenError(callback: ServerListenErrorCallback) {
        this.hookEvent("serverListenError", callback);
    }

    public onClientInitError(callback: ClientInitErrorCallback) {
        this.hookEvent("clientInitError", callback);
    }

    public onConnectError(callback: ClientConnectErrorCallback) {
        this.hookEvent("connectError", callback);
    }

    public onConnect(callback: ConnectCallback) {
        this.hookEvent("connect", callback);
    }

    public onClose(callback: CloseCallback) {
        this.hookEvent("close", callback);
    }

    public onRefusedClientConnection(callback: ClientRefuseCallback) {
        this.hookEvent("refusedClientConnection", callback);
    }

    public onHandshakeError(callback: HandshakeErrorCallback) {
        this.hookEvent("handshakeError", callback);
    }

    public onHandshake(callback: HandshakeCallback) {
        this.hookEvent("handshake", callback);
    }

    protected triggerEvent(type: string, ...args: any) {
        const cbs = this.handlers[type] || [];
        cbs.forEach( (callback: Function) => {
            callback(...args);
        });
    }

    protected hookEvent(type: string, callback: Function) {
        const cbs = this.handlers[type] || [];
        this.handlers[type] = cbs;
        cbs.push(callback);
    }

    protected createSocketRPCClient(clientConfig: ClientConfig): SocketRPCClient {
        const client = new SocketRPCClient(this.rpc, clientConfig);

        this.sockets.push(client);

        return client;
    }

    protected getSocketRPCClient(clientId: string): SocketRPCClient {
        const client = this.sockets.find( rpcClient => rpcClient.getClientId() === clientId );

        if (!client) {
            throw new Error("Socket RPC Client not available");
        }

        return client;
    }

    protected removeSocketRPCClient(clientId: string) {
        const index = this.sockets.findIndex( rpcClient => rpcClient.getClientId() === clientId );

        if (index > -1) {
            this.sockets.splice(index, 1);
        }
    }
}
