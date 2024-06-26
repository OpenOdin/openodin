import {
    ClientInterface,
} from "pocket-sockets";
import {
    RPC,
} from "../util/RPC";

import {
    ClientConfig,
} from "./types";

export class SocketRPCServer {
    protected rpc: RPC;
    protected client: ClientInterface;
    protected clientConfig: ClientConfig;
    protected rpcPrefix: string;

    constructor(rpc: RPC, client: ClientInterface, clientId: string) {
        this.rpc = rpc;
        this.client = client;

        this.rpcPrefix = `${clientId}_`;

        this.clientConfig = {
            clientId,
            localAddress: client.getLocalAddress(),
            localPort: client.getLocalPort(),
            remoteAddress: client.getRemoteAddress(),
            remotePort: client.getRemotePort(),
            isWebSocket: client.isWebSocket(),
            isTextMode: client.isTextMode(),
        };

        this.rpc.onCall(this.rpcPrefix + "connect", () => {
            return this.client.connect();
        });

        this.rpc.onCall(this.rpcPrefix + "send", (data: Buffer | string) => {
            if (typeof(data) !== "string") {
                if (!Buffer.isBuffer(data)) {
                    data = Buffer.from(data);
                }
            }

            return this.client.send(data);
        });

        this.rpc.onCall(this.rpcPrefix + "unRead", (data: Buffer | string) => {
            if (typeof(data) !== "string") {
                if (!Buffer.isBuffer(data)) {
                    data = Buffer.from(data);
                }
            }

            return this.client.unRead(data);
        });

        this.rpc.onCall(this.rpcPrefix + "close", () => {
            return this.client.close();
        });

        this.rpc.onCall(this.rpcPrefix + "hookOnData", () => {
            return this.client.onData(this.socketData);
        });

        this.rpc.onCall(this.rpcPrefix + "unhookOnData", () => {
            return this.client.offData(this.socketData);
        });

        this.client.onError( (message: string) => {
            this.rpc.call(this.rpcPrefix + "onError", [message]);
        });

        this.client.onConnect( () => {
            this.rpc.call(this.rpcPrefix + "onConnect");
        });

        this.client.onClose( (hadError: boolean) => {
            this.rpc.call(this.rpcPrefix + "onClose", [hadError]);
        });
    }

    public close() {
        this.rpc.close();

        this.client.close();
    }

    protected socketData = (data: Buffer | string) => {
        this.rpc.call(this.rpcPrefix + "onData", [data]);
    }

    /**
     * @returns the underlying client.
     */
    public getClient(): ClientInterface {
        return this.client;
    }

    public getClientConfig(): ClientConfig {
        return this.clientConfig;
    }
}
