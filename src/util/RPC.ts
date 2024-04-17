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
    protected _isClosed: boolean = false;

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
            parameters: this.serialize(parameters),
            rpcId: this.rpcId,
            messageId,
        };

        return new Promise<any>( (resolve, reject) => {
            this.promises[messageId] = [resolve, reject];

            try {
                !this._isClosed && this.postMessage(message);
            }
            catch(e) {
                console.debug(e);
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
                resolve(this.deserialize(message.response));
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
                throw new Error(`RPC function: ${message.name} is not registered.`);
            }

            try {
                const parameters = this.deserialize(message.parameters ?? []);

                const response = await (useCatchAll ? fn(message.name, ...parameters) : fn(...parameters));

                const returnResponse: RPCMessage = {
                    response: this.serialize(response),
                    messageId: message.messageId,
                    rpcId: this.rpcId,
                };

                try {
                    !this._isClosed && this.postMessage(returnResponse);
                }
                catch(e) {
                    console.debug(e);
                }
            }
            catch(error) {
                console.debug(error);

                const errorResponse: RPCMessage = {
                    error: `${error}`,
                    messageId: message.messageId,
                    rpcId: this.rpcId,
                };

                try {
                    !this._isClosed && this.postMessage(errorResponse);
                }
                catch(e) {
                    console.debug(e);
                }
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
        if (this._isClosed) {
            return;
        }

        this._isClosed = true;

        this.eventHandlers = {};

        const messageIds = Object.keys(this.promises);

        messageIds.forEach( messageId => {
            //eslint-disable-next-line @typescript-eslint/no-unused-vars
            const [resolve, reject] = this.promises[messageId] ?? [];
            delete this.promises[messageId];
            reject("RPC endpoint closed");
        });
    }

    protected serialize(obj: any): any {
        if (Buffer.isBuffer(obj)) {
            return obj.toJSON();
        }
        else if (obj instanceof Uint8Array) {
            return Buffer.from(obj).toJSON();
        }
        else if (Array.isArray(obj)) {
            return obj.map( (elm: any) => {
                return this.serialize(elm);
            });
        }
        else if (obj && typeof obj === "object" && obj.constructor === Object) {
            const keys = Object.keys(obj);

            const data: Record<string, any> = {};

            keys.forEach( (key: string) => {
                data[key] = this.serialize(obj[key]);
            });

            return {
                type: "object",
                data,
            };
        }
        else if (typeof obj === "bigint") {
            return {
                type: "bigint",
                data: obj.toString(),
            };
        }
        else if (obj && typeof obj === "function") {
            return undefined;
        }
        else if (typeof obj === "number") {
            return obj;
        }
        else if (typeof obj === "string") {
            return obj;
        }
        else if (typeof obj === "boolean") {
            return obj;
        }
        else if (typeof obj === "undefined") {
            return obj;
        }

        throw new Error("Could not serialize object");
    }

    protected deserialize(obj: any): any {
        if (Array.isArray(obj)) {
            return obj.map( (elm: any) => {
                return this.deserialize(elm);
            });
        }
        else if (obj && typeof obj === "object" && obj.constructor === Object) {
            if (obj.type === "Buffer" && Array.isArray(obj.data)) {
                return Buffer.from(obj.data);
            }
            else if (obj.type === "bigint") {
                return BigInt(obj.data);
            }
            else if (obj.type === "object") {
                const keys = Object.keys(obj.data);

                const obj2: Record<string, any> = {};

                keys.forEach( (key: string) => {
                    obj2[key] = this.deserialize(obj.data[key]);
                });

                return obj2;
            }
        }

        return obj;
    }
}
