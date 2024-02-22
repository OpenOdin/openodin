import {
    ClientInterface,
} from "pocket-sockets";

import {
    ServerResponse,
} from "http";

export class SendResponse {
    protected _isClosed: boolean = false;

    constructor(protected res?: ServerResponse, protected webSocket?: ClientInterface) {
        this.res?.socket?.on("close", this.handleResClose);
    }

    protected handleResClose = () => {
        this._isClosed = true;
    };

    public free() {
        this.res?.socket?.off("close", this.handleResClose);
    }

    public sendObj(obj: any) {
        if (this._isClosed) {
            return;
        }

        this.send(JSON.stringify(obj));
    }

    public send(data: string) {
        if (this._isClosed) {
            return;
        }

        if (this.res) {
            this.res.write(data);
            this.res.end();
        }
        else if (this.webSocket) {
            this.webSocket.send(data);
        }
    }

    public sendError(error: string = "unknown error") {
        if (this._isClosed) {
            return;
        }

        const errObj = {
            error,
        };

        this.sendObj(errObj);
    }

    public isWebSocket(): boolean {
        return this.webSocket !== undefined;
    }

    public isClosed(): boolean {
        if (this.webSocket) {
            return this.webSocket.isClosed();
        }

        if (this.res?.socket) {
            return this._isClosed;
        }

        return false;
    }
}

