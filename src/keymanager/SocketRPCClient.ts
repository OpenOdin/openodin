import {
    ClientInterface,
    SocketErrorCallback,
    SocketDataCallback,
    SocketConnectCallback,
    SocketCloseCallback,
} from "pocket-sockets";

import {
    RPC,
} from "../util/RPC";

import {
    ClientConfig,
} from "./types";

type Callback = (...args: any) => void;

export class SocketRPCClient implements ClientInterface {
    protected rpc: RPC;
    protected clientConfig: ClientConfig;
    protected handlers: {[type: string]: Callback[]} = {};
    protected isClosed: boolean = false;
    protected rpcPrefix: string;

    constructor(rpc: RPC, clientConfig: ClientConfig) {
        this.rpc = rpc;
        this.clientConfig = clientConfig;

        this.rpcPrefix = `${clientConfig.clientId}_`;

        this.rpc.onCall(this.rpcPrefix + "onData", (data: Buffer) => {
            if (!Buffer.isBuffer(data)) {
                data = Buffer.from(data);
            }

            this.triggerEvent("data", data);
        });

        this.rpc.onCall(this.rpcPrefix + "onError", (message: string) => {
            this.triggerEvent("error", message);
        });

        this.rpc.onCall(this.rpcPrefix + "onConnect", () => {
            this.triggerEvent("connect");
        });

        this.rpc.onCall(this.rpcPrefix + "onClose", (hadError: boolean) => {
            this.triggerEvent("close", hadError);
        });
    }

    public connect() {
        this.rpc.call(this.rpcPrefix + "connect");
    }

    public sendString(data: string) {
        this.rpc.call(this.rpcPrefix + "sendString", [data]);
    }

    public send(data: Buffer) {
        this.rpc.call(this.rpcPrefix + "send", [data]);
    }

    public unRead(data: Buffer) {
        this.rpc.call(this.rpcPrefix + "unRead", [data]);
    }

    public close() {
        if (this.isClosed) {
            return;
        }

        this.isClosed = true;

        this.rpc.call(this.rpcPrefix + "close");
    }

    public onError(fn: SocketErrorCallback) {
        this.hookEvent("error", fn);
    }

    public offError(fn: SocketErrorCallback) {
        this.unhookEvent("error", fn);
    }

    public onData(fn: SocketDataCallback) {
        const triggers = this.handlers["data"] || [];

        this.hookEvent("data", fn);

        if (triggers.length === 0) {
            this.rpc.call(this.rpcPrefix + "hookOnData");
        }
    }

    /**
     * Note that the off-call is done asynchrounously which can result
     * in events not getting buffered until next onData call resulting
     * in missed events.
     */
    public offData(fn: SocketDataCallback) {
        this.unhookEvent("data", fn);

        const triggers = this.handlers["data"] || [];
        if (triggers.length === 0) {
            this.rpc.call(this.rpcPrefix + "unhookOnData");
        }
    }

    public onConnect(fn: SocketConnectCallback) {
        this.hookEvent("connect", fn);
    }

    public offConnect(fn: SocketConnectCallback) {
        this.unhookEvent("connect", fn);
    }

    public onClose(fn: SocketCloseCallback) {
        this.hookEvent("close", fn);
    }

    public offClose(fn: SocketCloseCallback) {
        this.unhookEvent("close", fn);
    }

    public getLocalAddress(): string | undefined {
        return this.clientConfig.localAddress;
    }

    public getRemoteAddress(): string | undefined {
        return this.clientConfig.remoteAddress;
    }

    public getRemotePort(): number | undefined {
        return this.clientConfig.remotePort;
    }

    public getLocalPort(): number | undefined {
        return this.clientConfig.localPort;
    }

    protected triggerEvent(type: string, ...args: any) {
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

    protected unhookEvent(type: string, callback: Callback) {
        const cbs = (this.handlers[type] || []).filter( cb => callback !== cb );
        this.handlers[type] = cbs;
    }

    public getClientId(): string {
        return this.clientConfig.clientId;
    }
}
