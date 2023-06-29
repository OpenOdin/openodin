import crypto from "crypto";

import {
    RPCMessage,
} from "./types";

export class RPC {
    protected eventHandlers: {[name: string]: Function} = {};
    protected postMessage: Function;
    protected listenMessage: Function;
    protected rpcId: string;

    protected promises: {[rpcId: string]: [Function, Function]} = {};

    /**
     * @param postMessage to send to the RPC server.
     */
    constructor(postMessage: Function, listenMessage: Function, rpcId: string) {
        this.postMessage = postMessage;
        this.listenMessage = listenMessage;
        this.rpcId = rpcId;

        this.listenMessage(this.handleMessage);
    }

    public clone(rpcId: string): RPC {

        const rpc = new RPC(this.postMessage, this.listenMessage, rpcId);

        return rpc;
    }

    /**
     * Make a remote call.
     */
    public call(name: string, parameters?: any[]): Promise<any> {
        parameters = parameters ?? [];

        const messageId = Buffer.from(crypto.randomBytes(8)).toString("hex");

        const message: RPCMessage = {
            name,
            parameters,
            rpcId: this.rpcId,
            messageId,
        };

        return new Promise<any>( (resolve, reject) => {
            this.promises[messageId] = [resolve, reject];

            this.postMessage(message);
        });
    }

    /**
     * Called by outside event listener on incoming message.
     */
    protected handleMessage = async (message: RPCMessage) => {
        if (message.rpcId !== this.rpcId) {
            // Message not for us, ignore.
            return;
        }

        if (!message.name) {
            // A response
            const [resolve, reject] = this.promises[message.messageId] ?? [];
            delete this.promises[message.messageId];

            if (message.error) {
                reject(message.error);
            }
            else {
                resolve(message.response);
            }
        }
        else {
            // A function call
            const fn = this.eventHandlers[message.name];

            if (!fn) {
                throw new Error(`Function: ${message.name} is not registered.`);
            }

            try {
                const response = await fn(...(message.parameters ?? []));

                const returnResponse: RPCMessage = {
                    response,
                    messageId: message.messageId,
                    rpcId: this.rpcId,
                };

                this.postMessage(returnResponse);
            }
            catch(error) {
                const errorResponse: RPCMessage = {
                    error: error as Error,
                    messageId: message.messageId,
                    rpcId: this.rpcId,
                };

                this.postMessage(errorResponse);
            }
        }
    }

    public onCall(name: string, eventHandler: Function) {
        this.eventHandlers[name] = eventHandler;
    }
}
