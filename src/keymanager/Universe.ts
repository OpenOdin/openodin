import crypto from "crypto";

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
    Service,
} from "../service";

import {
    HandshakeFactoryFactoryInterface,
    WalletConf,
    UniverseConf,
} from "../service/types";

import {
    AuthResponse,
} from "./types";

import {
    ParseUtil,
} from "../util";

declare const window: any;

export class Universe {
    protected rpc: RPC;
    protected _isActive: boolean = false;
    protected _onActive?: () => void;
    protected signatureOffloader?: SignatureOffloaderInterface;
    protected handshakeFactoryFactory?: HandshakeFactoryFactoryInterface;
    protected walletConf?: WalletConf;

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
    }

    protected async sendHello() {
        const ret = await this.rpc.call("universe-hello");

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
        const authResponse = await this.rpc.call("auth") as AuthResponse;

        if (authResponse.error || !authResponse.signatureOffloaderRPCId || !authResponse.handshakeRPCId) {
            throw new Error(authResponse.error ?? "Unknown error");
        }

        const rpc1 = this.rpc.clone(authResponse.signatureOffloaderRPCId);
        this.signatureOffloader = new SignatureOffloaderRPCClient(rpc1);

        const rpc2 = this.rpc.clone(authResponse.handshakeRPCId);
        this.handshakeFactoryFactory = CreateHandshakeFactoryFactoryRPCClient(rpc2);

        // TODO
        this.walletConf = ParseUtil.ParseWalletConf({});
    }

    public getSignatureOffloader(): SignatureOffloaderInterface | undefined {
        return this.signatureOffloader;
    }

    public getHandshakeFactoryFactory(): HandshakeFactoryFactoryInterface | undefined {
        return this.handshakeFactoryFactory;
    }

    public getWalletConf(): WalletConf | undefined {
        return this.walletConf;
    }

    /**
     * @throws on error
     */
    public async initService(universeConf: UniverseConf): Promise<Service> {
        if (!this.walletConf) {
            throw new Error("Missing walletConf");
        }

        if (!this.signatureOffloader) {
            throw new Error("Missing signatureOffloader");
        }

        if (!this.handshakeFactoryFactory) {
            throw new Error("Missing handshakeFactoryFactory");
        }

        const service = new Service(universeConf, this.walletConf, this.signatureOffloader, this.handshakeFactoryFactory);

        await service.init()

        return service;
    }

    public close() {
        this.rpc.call("close");

        delete this.signatureOffloader;
        delete this.handshakeFactoryFactory;
    }

    public onActive( cb: () => void ) {
        this._onActive = cb;
    }
}
