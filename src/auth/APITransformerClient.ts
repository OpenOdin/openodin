import {
    WrappedClient,
    ClientInterface,
    SocketDataCallback,
} from "pocket-sockets"

import {
    APIDataTransformer,
} from "./APIDataTransformer";

export class APITransformerClient extends WrappedClient {
    protected aggregatedClientData = Buffer.alloc(0);
    protected apiDataTransformer = new APIDataTransformer();
    protected handlers: {[type: string]: ((data?: any) => void)[]} = {};

    constructor(client: ClientInterface, protected sessionToken: string) {
        super(client);
    }

    public onData(fn: SocketDataCallback) {
        this.hookEvent("data", fn);

        if ((this.handlers["data"] ?? []).length === 1) {
            this.client.onData( this.handleOnData );
        }
    }

    public offData(fn: SocketDataCallback) {
        this.unhookEvent("data", fn);

        if ((this.handlers["data"] ?? []).length === 0) {
            this.client.offData( this.handleOnData );
        }
    }

    public send(data: Buffer | string) {
        if (!Buffer.isBuffer(data)) {
            return;
        }

        this.aggregatedClientData = Buffer.concat([this.aggregatedClientData, data]);

        if (this.aggregatedClientData.length < 3) {
            return undefined;
        }

        const length = this.aggregatedClientData.readUInt32LE(1);

        if (length > this.aggregatedClientData.length) {
            return undefined;
        }

        const data2 = this.aggregatedClientData.slice(0, length);

        this.aggregatedClientData = Buffer.from(this.aggregatedClientData.slice(length));

        const apiRequest = this.apiDataTransformer.deserialize(data2);

        apiRequest.sessionToken = this.sessionToken;

        this.client.send(this.apiDataTransformer.stringifyAPIRequest(apiRequest));
    }

    protected handleOnData = async (body: Buffer | string) => {
        try {
            const request = JSON.parse(body as string);

            const apiRequest = this.apiDataTransformer.parseAPIRequest(request);

            if (apiRequest.sessionToken !== this.sessionToken) {
                return;
            }

            const data = this.apiDataTransformer.serialize(apiRequest);

            this.triggerEvent("data", data);
        }
        catch(e) {
            // Do nothing
        }
    };

    protected hookEvent(type: string, callback: (...args: any[]) => void) {
        const cbs = this.handlers[type] || [];
        this.handlers[type] = cbs;
        cbs.push(callback);
    }

    protected unhookEvent(type: string, callback: (...args: any[]) => void) {
        const cbs = (this.handlers[type] || []).filter( (cb: (data?: any[]) => void) =>
            callback !== cb );

        this.handlers[type] = cbs;
    }

    protected triggerEvent(type: string, ...args: any[]) {
        const cbs = this.handlers[type] || [];
        cbs.forEach( callback => {
            callback(...args);
        });
    }
}
