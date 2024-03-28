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

/**
 * OpenOdin is used in a browser application to authenticate with the Datawallet browser extension.
 *
 * It's job is to facilitate the authentication and finally pass an initiated
 * Service instance on the onAuth() event handler.
 *
 * The Service instance passed on the onAuth handler is inititated but not started, the app will need
 * to call service.start() itself when it desires to do so.
 *
 * However if waiting for too long to do so the Datawallet extension might get unloaded by the
 * browser because it is idle.
 * If that happens the OpenOdin instance's onClose handler will be called and the Service instance
 * will not be startable anymore. In such case the application will need to created a new OpenOdin
 * instance to start over with the authorization.
 *
 * After an OpenOdin instance is closed or failed authorization (which closes it) it cannot be reused.
 */
export class OpenOdin {
    protected rpc: RPC;
    protected _onOpen?: () => void;
    protected _onAuth?: (service: Service) => void;
    protected _onAuthFail?: (error: string) => void;
    protected _onClose?: () => void;

    protected _isClosed: boolean = false;
    protected _isOpen: boolean = false;
    protected pendingAuth: boolean = false;

    protected signatureOffloader?: SignatureOffloaderInterface;
    protected authFactory?: AuthFactoryInterface;
    protected service?: Service;
    protected walletConf?: WalletConf;

    /**
     * @param appConf the application configuration to init the Service instance with.
     * The conf will be sent to the Datawallet when authing for verbosity and potential
     * reconfiguration by the user.
     *
     * @param autoAuth if set then automatically called auth() when extension allows authentication.
     * Default is true.
     */
    constructor(protected appConf: ApplicationConf, protected autoAuth: boolean = true) {
        const rpcId = Buffer.from(crypto.randomBytes(8)).toString("hex");

        const postMessage2 = (message: any) => {
            postMessage({message, direction: "openodin-page-script-message"}, "*");
        };

        addEventListener("message", (event: any) => {
            // Make sure the event comes from this window, as the content-script has the same)
            // window object.
            //
            if (event.source !== window) {
                // NOTE: see if we can use CustomEvent to narrow it down even more.
                //
                return;
            }

            if (event?.data?.direction === "openodin-content-script-open") {
                // Extension has been opened.
                //
                this.handleOpen();
            }
            else if (event?.data?.direction === "openodin-content-script-port-closed") {
                // Port to background script closed.
                //
                const rpcId2 = event?.data?.message?.rpcId;

                rpcId2 === rpcId && this.handleClose();
            }
        });

        const listenMessage = (listener: any) => {
            addEventListener("message", (event: any) => {
                // Make sure the event comes from this window, as the content-script has the same)
                // window object.
                //
                if (event.source !== window) {
                    // NOTE: see if we can use CustomEvent to narrow it down even more.
                    //
                    return;
                }

                if (event?.data?.direction === "openodin-content-script-message") {
                    // Incoming data from background-script to be passed to the RPC instance.
                    //
                    listener(event.data.message);
                }
            });
        };

        this.rpc = new RPC(postMessage2, listenMessage, rpcId);
    }

    /**
     * Helper function to fetch() and parse an ApplicationConf JSON file.
     *
     * @throws on error
     */
    public static async LoadAppConf(location: string): Promise<ApplicationConf> {
        const appJSON = await (await fetch(location)).json();

        const appConf = ParseUtil.ParseApplicationConf(appJSON);

        return appConf;
    }

    /**
     * Return the unique RPC id used for this OpenOdin instance.
     */
    public getId(): string {
        return this.rpc.getId();
    }

    /**
     * Handler called everytime the Datawallet is opened for the tab,
     * technically each time the content-script is injected.
     * If the instance is closed the event is not triggered.
     * If autoAuth is set an auth process is initiated.
     */
    protected async handleOpen() {
        if (this._isClosed) {
            return;
        }

        if (!this._isOpen) {
            // If first time open the port to the background by sending a noop.
            //
            const ret = await this.rpc.call("noop");

            if (ret !== "noop") {
                this.close();

                throw new Error("Could not open port");
            }
        }

        this._isOpen = true;

        this._onOpen?.();

        if (this.autoAuth && !this.pendingAuth && !this.isAuthed()) {
            this.auth();
        }
    }

    /**
     * Triggers onAuth(Service) on successful auth, or onAuthFail(error) on failed auth.
     * In case of failed auth check isClosed() before attempting to reuse the OpenOdin instance.
     *
     * @throws if cannot be reused for auth, if port is closed, already authed or pending auth.
     */
    public auth = async () => {
        if (this._isClosed || this.pendingAuth || this.isAuthed()) {
            throw new Error("Cannot reuse OpenOdin instance");
        }

        try {
            this.pendingAuth = true;

            // TODO: pass along this.appConf and take back changes.
            //
            const authResponse = await this.rpc.call("auth") as AuthResponse;

            this.pendingAuth = false;

            if (authResponse.error || !authResponse.signatureOffloaderRPCId || !authResponse.handshakeRPCId) {
                this._onAuthFail?.(authResponse.error ?? "Unknown error");

                this.close();

                return;
            }

            const rpc1 = this.rpc.clone(authResponse.signatureOffloaderRPCId);
            this.signatureOffloader = new SignatureOffloaderRPCClient(rpc1);

            const rpc2 = this.rpc.clone(authResponse.handshakeRPCId);
            this.authFactory = new AuthFactoryRPCClient(rpc2);

            // TODO
            this.walletConf = ParseUtil.ParseWalletConf({});
        }
        catch(e) {
            this._onAuthFail?.(`Error in auth process: ${e}`);

            this.close();

            return;
        }

        try {
            this.service = new Service(this.appConf, this.walletConf, this.signatureOffloader,
                this.authFactory);

            await this.service.init();
        }
        catch(e) {
            this._onAuthFail?.(`Could not init Service: ${e}`);

            this.close();

            return;
        }

        this._onAuth?.(this.service);
    }

    public isAuthed = (): boolean => {
        return this.service !== undefined;
    }

    public isPendingAuth = (): boolean => {
        return this.pendingAuth;
    }

    public getSignatureOffloader = (): SignatureOffloaderInterface | undefined => {
        return this.signatureOffloader;
    }

    public getHandshakeFactoryFactory = (): AuthFactoryInterface | undefined => {
        return this.authFactory;
    }

    public getWalletConf = (): WalletConf | undefined => {
        return this.walletConf;
    }

    public getService = (): Service | undefined => {
        return this.service;
    }

    /**
     * Close the connection to the datawallet resulting in logout.
     * The OpenOdin instance cannot be used any further after close.
     */
    public close = () => {
        if (this._isClosed) {
            return;
        }

        const rpcId = this.rpc.getId();

        postMessage({message: {rpcId}, direction: "openodin-page-script-close-port"}, "*");
    }

    public isClosed = () => {
        return this._isClosed;
    }

    public isOpen = () => {
        return this._isOpen;
    }

    /**
     * Handle when port is closed or cannot be opened.
     */
    protected handleClose() {
        if (this._isClosed) {
            return;
        }

        this._isClosed = true;
        this.pendingAuth = false;
        delete this.signatureOffloader;
        delete this.authFactory;

        this.service?.close();

        delete this.service;

        this._onClose?.();
    }

    /**
     * Event triggered when the Datawallet is opened and activated for the tab.
     * After this event one can all auth(), if autoAuth is set auth() is called automatically.
     */
    public onOpen = ( cb: () => void ) => {
        this._onOpen = cb;
    }

    public onPreAuth = ( cb: () => void ) => {
        // TODO
    }

    /**
     * Event triggered on successful authorization.
     * A newly created and init'd Service instance is passed as argument to the event handler.
     *
     * From this point the OpinOdin instance is only useful for calling close() on and/or listening
     * for the close event, as everything else is now provided in the Service instance.
     * For handling close events either hook the OpenOdin instance onClose() or the Service onClose().
     */
    public onAuth = ( cb: (service: Service) => void ) => {
        this._onAuth = cb;
    }

    /**
     * Event triggered on failed authorization or if port closed during pending authorization.
     * The OpenOdin instance cannot be reused.
     */
    public onAuthFail = ( cb: (error: string) => void ) => {
        this._onAuthFail = cb;
    }

    /**
     * Event triggered when port to background is disconnected or when calling close().
     *
     * The OpenOdin instance cannot be used any further after close.
     */
    public onClose = ( cb: () => void ) => {
        this._onClose = cb;
    }
}
