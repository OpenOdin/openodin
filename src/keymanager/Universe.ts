import {
    RPC,
} from "./RPC";

import {
    CreateHandshakeFactoryFactoryRPCClient,
} from "./HandshakeFactoryFactoryRPCClient";

import {
    SignatureOffloaderInterface,
} from "../datamodel/decoder";

import {
    SignatureOffloaderRPCClient,
} from "./SignatureOffloaderRPCClient";

import {
    HandshakeFactoryFactoryInterface,
} from "../service/types";

import {
    AuthResponse,
} from "./types";

declare const window: any;

export class Universe {
    protected rpc: RPC;
    protected _isActive: boolean = false;
    protected _onActive?: () => void;

    constructor(rpc?: RPC) {
        if (!rpc) {
            const postMessage = (message: any) => {
                window.postMessage({message, direction: "from-page-script"}, "*");
            };

            const listenMessage = (listener: any) => {
                window.addEventListener("message", (event: any) => {
                    if (event.source === window && event?.data?.direction === "from-content-script") {
                        listener(event.data.message);
                    }
                });
            };

            this.rpc = new RPC(postMessage, listenMessage, "keyManager");
        }
        else {
            this.rpc = rpc;
        }

        this.rpc.onCall("active", () => {
            this._isActive = true;
            this._onActive && this._onActive();
        });
    }

    public isActive(): boolean {
        return this._isActive;
    }

    public async auth(): Promise<{
        signatureOffloader?: SignatureOffloaderInterface,
        handshakeFactoryFactory?: HandshakeFactoryFactoryInterface,
        error?: string,
    }> {

        const authResponse = await this.rpc.call("auth") as AuthResponse;

        if (authResponse.error || !authResponse.signatureOffloaderRPCId || !authResponse.handshakeRPCId) {
            return {
                error: authResponse.error ?? "Unknown error",
            };
        }

        const rpc1 = this.rpc.clone(authResponse.signatureOffloaderRPCId);
        const signatureOffloader = new SignatureOffloaderRPCClient(rpc1);

        const rpc2 = this.rpc.clone(authResponse.handshakeRPCId);
        const handshakeFactoryFactory = CreateHandshakeFactoryFactoryRPCClient(rpc2);

        return {
            signatureOffloader,
            handshakeFactoryFactory,
        };
    }

    public onActive( cb: () => void ) {
        this._onActive = cb;
    }
}
