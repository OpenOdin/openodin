import {
    HandshakeFactoryInterface,
    HandshakeFactoryConfig,
    HandshakeFactoryHandshakeCallback,
    HandshakeFactoryHandshakeErrorCallback,
    HandshakeResult,
    HandshakeFactoryPublicKeyOverflowCallback,
} from "pocket-messaging";

import {
    SocketFactoryServerInitErrorCallback,
    SocketFactoryServerListenErrorCallback,
    SocketFactoryStats,
    SocketFactoryConfig,
    SocketFactoryClientInitErrorCallback,
    SocketFactoryClientConnectErrorCallback,
    SocketFactoryConnectCallback,
    SocketFactoryCloseCallback,
    SocketFactoryClientIPRefuseCallback,
    SocketFactoryErrorCallback,
    SocketFactoryErrorCallbackNames,
    SocketFactoryClientIPRefuseDetail,
    WrappedClient,
} from "pocket-sockets";

import {
    RPC,
} from "../util/RPC";

import {
    ClientConfig,
} from "./types";

import {
    SocketRPCClient,
} from "./SocketRPCClient";

type Callback = (...args: any) => void;

export class CommonHandshakeFactoryRPCClient implements HandshakeFactoryInterface {
    protected rpc: RPC;
    protected _isClosed = false;
    protected _isShutdown = false;
    protected apiAuthFactoryConfig: HandshakeFactoryConfig;
    protected handlers: {[type: string]: Callback[]} = {};
    protected sockets: SocketRPCClient[] = [];

    constructor(rpc: RPC, apiAuthFactoryConfig: HandshakeFactoryConfig) {
        this.rpc = rpc;

        this.apiAuthFactoryConfig = apiAuthFactoryConfig;

        this.rpc.onCall("onHandshake",
            (clientId: string, longtermPk: Buffer, peerLongtermPk: Buffer,
                peerData: Buffer, clockDiff, number, isServer: boolean) =>
        {
            if (!Buffer.isBuffer(longtermPk)) {
                longtermPk = Buffer.from(longtermPk);
            }

            if (!Buffer.isBuffer(peerLongtermPk)) {
                peerLongtermPk = Buffer.from(peerLongtermPk);
            }

            if (!Buffer.isBuffer(peerData)) {
                peerData = Buffer.from(peerData);
            }

            const client = this.getSocketRPCClient(clientId);

            const handshakeResult: HandshakeResult = {
                longtermPk,
                peerLongtermPk,
                peerData,
                clockDiff,
                clientToServerKey: Buffer.alloc(0),
                clientNonce: Buffer.alloc(0),
                serverToClientKey: Buffer.alloc(0),
                serverNonce: Buffer.alloc(0),
            };

            const handshakeEvent: Parameters<HandshakeFactoryHandshakeCallback> =
                [isServer, client, new WrappedClient(client), handshakeResult];

            this.triggerEvent("handshake", ...handshakeEvent);
        });

        this.rpc.onCall("onHandshakeError", (error: string) => {
            const handshakeErrorEvent: Parameters<HandshakeFactoryHandshakeErrorCallback> =
                [new Error(error)];

            this.triggerEvent("handshakeError", ...handshakeErrorEvent);
        });

        this.rpc.onCall("onSocketFactoryError", (name: SocketFactoryErrorCallbackNames,
            error: string) => {

            const errorEvent: Parameters<SocketFactoryErrorCallback> =
                [name, new Error(error)];

            this.triggerEvent("socketFactoryError", ...errorEvent);
        });

        this.rpc.onCall("onServerInitError", (error: string) => {
            const serverInitErrorEvent: Parameters<SocketFactoryServerInitErrorCallback> =
                [new Error(error)];

            this.triggerEvent("serverInitError", ...serverInitErrorEvent);
        });

        this.rpc.onCall("onServerListenError", (error: string) => {
            const serverListenErrorEvent: Parameters<SocketFactoryServerListenErrorCallback> =
                [new Error(error)];

            this.triggerEvent("serverListenError", ...serverListenErrorEvent);
        });

        this.rpc.onCall("onClientInitError", (error: string) => {
            const clientInitErrorEvent: Parameters<SocketFactoryClientInitErrorCallback> =
                [new Error(error)];

            this.triggerEvent("clientInitError", ...clientInitErrorEvent);
        });

        this.rpc.onCall("onConnectError", (error: string) => {
            const clientConnectErrorEvent: Parameters<SocketFactoryClientConnectErrorCallback> =
                [new Error(error)];

            this.triggerEvent("connectError", ...clientConnectErrorEvent);
        });

        this.rpc.onCall("onConnect", (clientConfig: ClientConfig, isServer: boolean) => {
            const client = this.createSocketRPCClient(clientConfig);

            const connectEvent: Parameters<SocketFactoryConnectCallback> = [client, isServer];

            this.triggerEvent("connect", ...connectEvent);
        });

        this.rpc.onCall("onClose", (clientId: string, isServer: boolean, hadError: boolean) => {
            this._isClosed = true;
            this._isShutdown = true;

            const client = this.getSocketRPCClient(clientId);

            // Clean up with a delay since onHandshakeError needs to find the client.
            setTimeout( () => this.removeSocketRPCClient(clientId), 10000 );

            const closeEvent: Parameters<SocketFactoryCloseCallback> = [client, isServer, hadError];

            this.triggerEvent("close", ...closeEvent);
        });

        this.rpc.onCall("onClientIPRefuse", (detail: SocketFactoryClientIPRefuseDetail , ipAddress: string) => {
            const clientRefuseEvent: Parameters<SocketFactoryClientIPRefuseCallback> = [
                detail, ipAddress];

            this.triggerEvent("clientIPRefuse", ...clientRefuseEvent);
        });

        this.rpc.onCall("onPublicKeyOverflow", (publicKey: Buffer) => {
            if (!Buffer.isBuffer(publicKey)) {
                publicKey = Buffer.from(publicKey);
            }

            const publicKeyOverflowEvent: Parameters<HandshakeFactoryPublicKeyOverflowCallback> =
                [publicKey];

            this.triggerEvent("publicKeyOverflow", ...publicKeyOverflowEvent);
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
        return this.apiAuthFactoryConfig.socketFactoryConfig;
    }

    /**
     * Returns what it was initialized with but which might not be
     * the actual configuration used be the HandshakeFactoryRPCServer.
     */
    public getHandshakeFactoryConfig(): HandshakeFactoryConfig {
        return this.apiAuthFactoryConfig;
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

    public onSocketFactoryError(callback: SocketFactoryErrorCallback) {
        this.hookEvent("socketFactoryError", callback);
    }

    public onServerInitError(callback: SocketFactoryServerInitErrorCallback) {
        this.hookEvent("serverInitError", callback);
    }

    public onServerListenError(callback: SocketFactoryServerListenErrorCallback) {
        this.hookEvent("serverListenError", callback);
    }

    public onClientInitError(callback: SocketFactoryClientInitErrorCallback) {
        this.hookEvent("clientInitError", callback);
    }

    public onConnectError(callback: SocketFactoryClientConnectErrorCallback) {
        this.hookEvent("connectError", callback);
    }

    public onConnect(callback: SocketFactoryConnectCallback) {
        this.hookEvent("connect", callback);
    }

    public onClose(callback: SocketFactoryCloseCallback) {
        this.hookEvent("close", callback);
    }

    public onClientIPRefuse(callback: SocketFactoryClientIPRefuseCallback) {
        this.hookEvent("clientIPRefuse", callback);
    }

    public onHandshakeError(callback: HandshakeFactoryHandshakeErrorCallback) {
        this.hookEvent("handshakeError", callback);
    }

    public onHandshake(callback: HandshakeFactoryHandshakeCallback) {
        this.hookEvent("handshake", callback);
    }

    public onPublicKeyOverflow(callback: HandshakeFactoryPublicKeyOverflowCallback) {
        this.hookEvent("publicKeyOverflow", callback);
    }

    protected triggerEvent(type: string, ...args: any[]) {
        const cbs = this.handlers[type] || [];
        cbs.forEach( (callback: Callback) => {
            callback(...args);
        });
    }

    protected hookEvent(type: string, callback: Callback) {
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
