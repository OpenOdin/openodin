import {
    RPCMessage,
} from "./types";

export class RPC {
    protected eventHandlers: {[name: string]: Function} = {};
    protected postMessage: Function;
    protected listenMessage: Function;
    protected rpcId: string;
    protected promises: {[messageId: string]: [Function, Function]} = {};
    protected messageCounter = 0;

    /**
     * @param postMessage to send to the RPC server.
     */
    constructor(postMessage: Function, listenMessage: Function, rpcId: string = "") {
        this.postMessage = postMessage;
        this.listenMessage = listenMessage;
        this.rpcId = rpcId;

        this.listenMessage(this.handleMessage);
    }

    public clone(rpcId: string): RPC {

        const rpc = new RPC(this.postMessage, this.listenMessage, rpcId);

        return rpc;
    }

    public getId(): string {
        return this.rpcId;
    }

    /**
     * Make a remote call.
     */
    public call(name: string, parameters?: any[]): Promise<any> {
        parameters = parameters ?? [];

        if (!Array.isArray(parameters)) {
            throw new Error("Parameters to call function must be inside array.");
        }

        const messageId = `${this.rpcId}_${this.messageCounter++}`;

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

            if (!resolve || !reject) {
                throw new Error(`RPC cannot handle response, rpcId: ${this.rpcId}, messageId: ${message.messageId}`);
            }

            if (message.error) {
                reject(message.error);
            }
            else {
                resolve(message.response);
            }
        }
        else {
            // A function call
            let useCatchAll = false;
            let fn = this.eventHandlers[message.name];

            if (!fn) {
                fn = this.eventHandlers["*"];
                useCatchAll = true;
            }

            if (!fn) {
                throw new Error(`Function: ${message.name} is not registered.`);
            }

            try {
                const response = await (useCatchAll ? fn(message.name, ...(message.parameters ?? [])) : fn(...(message.parameters ?? [])));

                const returnResponse: RPCMessage = {
                    response,
                    messageId: message.messageId,
                    rpcId: this.rpcId,
                };

                this.postMessage(returnResponse);
            }
            catch(error) {
                const errorResponse: RPCMessage = {
                    error: `${error}`,
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
