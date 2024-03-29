import {
    PocketConsole,
} from "pocket-console";

const console = PocketConsole({module: "RPC"});

export type RPCMessage = {
    /**
     * Set to the function name we are calling.
     * Leave empty for return responses.
     */
    name?: string,

    /**
     * The function parameters when calling a function.
     * Leave empty for return responses.
     */
    parameters?: any[],

    /**
     * Set for return calls.
     * The return value of the function called.
     */
    response?: any,

    /**
     * Set when returning exceptions.
     */
    error?: string,

    /**
     * Auto generated random string set when calling a function
     * and used to identify return calls.
     * Automatically generated and set.
     */
    messageId: string,

    /** Unique identifier for this channel. */
    rpcId: string,
};

type Callback = (...args: any) => void;

export class RPC {
    protected eventHandlers: {[name: string]: Callback} = {};
    protected postMessage: (message: RPCMessage) => void;
    protected listenMessage: (cb: (message: RPCMessage) => void) => void;
    protected rpcId: string;
    protected promises: {[messageId: string]: [(response: any) => void, (error: string) => void]} = {};
    protected messageCounter = 0;
    protected forkCounter = 0;

    /**
     * @param postMessage to send to the RPC server.
     */
    constructor(postMessage: (message: RPCMessage) => void,
        listenMessage: ( cb: (message: RPCMessage) => void) => void, rpcId: string = "") {
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
     * Clone the RPC but use the existing rpcId as base for the new rpcId.
     */
    public fork(): RPC {
        const rpc = new RPC(this.postMessage, this.listenMessage, `${this.rpcId}_${this.forkCounter++}`);

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

            try {
                this.postMessage(message);
            }
            catch(e) {
                console.error("Could not invoke postMessage, error object in the message?", message, e);
            }
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

                try {
                    this.postMessage(returnResponse);
                }
                catch(e) {
                    console.error("Could not invoke postMessage, error object in the message?", returnResponse, e);
                    throw e;
                }
            }
            catch(error) {
                console.debug(error);

                const errorResponse: RPCMessage = {
                    error: `${error}`,
                    messageId: message.messageId,
                    rpcId: this.rpcId,
                };

                this.postMessage(errorResponse);
            }
        }
    }

    public onCall(name: string, eventHandler: Callback) {
        this.eventHandlers[name] = eventHandler;
    }

    public offCall(name: string) {
        delete this.eventHandlers[name];
    }

    public close() {
        this.eventHandlers = {};

        const messageIds = Object.keys(this.promises);

        messageIds.forEach( messageId => {
            //eslint-disable-next-line @typescript-eslint/no-unused-vars
            const [resolve, reject] = this.promises[messageId] ?? [];
            delete this.promises[messageId];
            reject("RPC endpoint closed");
        });
    }
}
