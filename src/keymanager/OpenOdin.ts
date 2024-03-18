import crypto from "crypto";

import {
    RPC,
} from "../util/RPC";

import {
    AuthFactoryRPCClient,
} from "./AuthFactoryRPCClient";

import {
    SignatureOffloaderInterface,
} from "../signatureoffloader";

import {
    SignatureOffloaderRPCClient,
} from "./SignatureOffloaderRPCClient";

import {
    Service,
} from "../service";

import {
    AuthFactoryInterface,
} from "../auth/types";

import {
    WalletConf,
    ApplicationConf,
} from "../service/types";

import {
    AuthResponse,
} from "./types";

import {
    ParseUtil,
} from "../util";

declare const window: any;

export class OpenOdin {
    protected rpc: RPC;
    protected _isActive: boolean = false;
    protected _onActive?: () => void;
    protected signatureOffloader?: SignatureOffloaderInterface;
    protected authFactory?: AuthFactoryInterface;
    protected walletConf?: WalletConf;
    protected pendingAuth: boolean = false;

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
                    else if (event.source === window && event?.data?.direction === "from-content-script-init") {
                        this.sendHello();
                    }
                });
            };

            const rpcId = Buffer.from(crypto.randomBytes(8)).toString("hex");

            this.rpc = new RPC(postMessage, listenMessage, rpcId);
        }
        else {
            this.rpc = rpc;
        }

        // In case the from-content-script-init has already been sent we send hello to activate.
        this.sendHello();
    }

    protected async sendHello() {
        if (this._isActive) {
            return;
        }

        const ret = await this.rpc.call("client-hello");

        if (ret === "keymanager-hello") {
            this._isActive = true;
            this._onActive && this._onActive();
        }
    }

    public isActive(): boolean {
        return this._isActive;
    }

    public isAuthed(): boolean {
        return this.signatureOffloader !== undefined;
    }

    /**
     * @throws on error
     */
    public async auth(): Promise<void> {
        this.pendingAuth = true;

        const authResponse = await this.rpc.call("auth") as AuthResponse;

        this.pendingAuth = false;

        if (authResponse.error || !authResponse.signatureOffloaderRPCId || !authResponse.handshakeRPCId) {
            throw new Error(authResponse.error ?? "Unknown error");
        }

        const rpc1 = this.rpc.clone(authResponse.signatureOffloaderRPCId);
        this.signatureOffloader = new SignatureOffloaderRPCClient(rpc1);

        const rpc2 = this.rpc.clone(authResponse.handshakeRPCId);
        this.authFactory = new AuthFactoryRPCClient(rpc2);

        // TODO
        this.walletConf = ParseUtil.ParseWalletConf({});
    }

    public isPendingAuth(): boolean {
        return this.pendingAuth;
    }

    public getSignatureOffloader(): SignatureOffloaderInterface | undefined {
        return this.signatureOffloader;
    }

    public getHandshakeFactoryFactory(): AuthFactoryInterface | undefined {
        return this.authFactory;
    }

    public getWalletConf(): WalletConf | undefined {
        return this.walletConf;
    }

    /**
     * @throws on error
     */
    public async initService(applicationConf: ApplicationConf): Promise<Service> {
        if (!this.walletConf) {
            throw new Error("Missing walletConf");
        }

        if (!this.signatureOffloader) {
            throw new Error("Missing signatureOffloader");
        }

        if (!this.authFactory) {
            throw new Error("Missing authFactory");
        }

        const service = new Service(applicationConf, this.walletConf, this.signatureOffloader, this.authFactory);

        await service.init()

        return service;
    }

    public close(): Promise<void> {
        delete this.signatureOffloader;
        delete this.authFactory;

        return this.rpc.call("close");
    }

    public onActive( cb: () => void ) {
        this._onActive = cb;
    }
}
