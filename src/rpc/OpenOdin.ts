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
    SettingsManagerRPCClient,
} from "./SettingsManagerRPCClient";

import {
    Service,
} from "../service";

import {
    AuthFactoryInterface,
} from "../auth/types";

import {
    ApplicationConf,
    ApplicationConfSchema,
} from "../service/types";

import {
    AuthResponse,
} from "./types";

import {
    ParseSchema,
} from "../util/SchemaUtil";

import {
    Version,
} from "../types";

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
    protected handlers: {[name: string]: ( (...args: any) => void)[]} = {};

    protected _isClosed: boolean = false;
    protected _isOpened: boolean = false;
    protected pendingAuth: boolean = false;

    /** Set if auth fails. */
    protected authFailed: boolean = false;

    /** Set on event attentionNeeded and reset and the next onOpen event. */
    protected attentionNeeded: boolean = false;


    protected signatureOffloader?: SignatureOffloaderInterface;
    protected authFactory?: AuthFactoryInterface;
    protected settingsManager?: SettingsManagerRPCClient;
    protected service?: Service;

    /**
     * @param nrOfSignatureVerifiers is set > 0 (default 2) then instantiate local threaded
     * SignatureOffloader to only do signature verification. This offloads the SignatureOffloader
     * in the browser extension and can especially benefit Chrome because in Chrome the extension
     * runs single threaded (Service Worker cannot spawn threads).
     * Signing is still done in the extension, as no secret keys are present in the local
     * SignatureOffloader as it is only for verifying signatures.
     */
    constructor(protected nrOfSignatureVerifiers: number = 2) {

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

        window.addEventListener("beforeunload", () => {
            if (!this._isClosed) {
                console.error("Window unloading, closing connection to DataWallet.");

                this.close();
            }
        });

        this.rpc = new RPC(postMessage2, listenMessage, rpcId);

        this.rpc.onCall("attentionNeeded", (count: number) => {
            this.attentionNeeded = true;
            this.triggerEvent("attentionNeeded", count);
        });
    }

    /**
     * Helper function to parse an ApplicationConf JSON file.
     *
     * This is a wrapper function over ParseSchema(ApplicationConfSchema).
     *
     * @returns ApplicationConf
     *
     * @throws on error
     */
    public static ParseAppConf(appJSON: Record<string, any>): ApplicationConf {
        return ParseSchema(ApplicationConfSchema, appJSON);
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
     */
    protected async handleOpen() {
        if (this._isClosed) {
            return;
        }

        // Reset flag.
        this.attentionNeeded = false;

        if (!this._isOpened) {
            // If first time open the port to the background by sending a noop.
            //
            const ret = await this.rpc.call("noop");

            if (ret !== "noop") {
                this.close();

                throw new Error("Could not open port");
            }

            setTimeout( () => this.noopInterval(), 1000);
        }

        this._isOpened = true;

        this.triggerEvent("open");
    }

    protected noopInterval() {
        if (this._isClosed || !this._isOpened) {
            return;
        }

        this.rpc.call("noop", [Math.random()]);

        setTimeout( () => this.noopInterval(), 1000);
    }

    /**
     * Triggers onAuth(Service) on successful auth, or onAuthFail(error) on failed auth.
     * In case of failed auth check isClosed() before attempting to reuse the OpenOdin instance.
     *
     * @param applicationConf the application configuration to init the Service instance with.
     * The conf will be sent to the Datawallet when authing for verbosity and potential
     * reconfiguration by the user. The Datawallet will respond with the same or an altered
     * version of the applicationConf which is then used.
     *
     * @throws if cannot be reused for auth, if port is closed, already authed or pending auth.
     */
    public auth = async (applicationConf: ApplicationConf) => {
        if (this._isClosed || this.pendingAuth || this.isAuthed()) {
            throw new Error("Cannot reuse OpenOdin instance");
        }

        try {
            this.pendingAuth = true;

            this.triggerEvent("preAuth");

            const authResponse = await this.rpc.call("auth",
                [{applicationConf: applicationConf}]) as AuthResponse;

            this.pendingAuth = false;

            if (authResponse.error || !authResponse.signatureOffloaderRPCId ||
                !authResponse.handshakeRPCId || !authResponse.applicationConf ||
                !authResponse.walletConf || !authResponse.settingsManagerRPCId)
            {
                this.authFailed = true;

                this.triggerEvent("authFail", authResponse.error ?? "Unknown error");

                this.close();

                return;
            }

            const rpc1 = this.rpc.clone(authResponse.signatureOffloaderRPCId);
            this.signatureOffloader = new SignatureOffloaderRPCClient(rpc1,
                this.nrOfSignatureVerifiers);

            const rpc2 = this.rpc.clone(authResponse.handshakeRPCId);
            this.authFactory = new AuthFactoryRPCClient(rpc2);

            const rpc3 = this.rpc.clone(authResponse.settingsManagerRPCId);
            this.settingsManager = new SettingsManagerRPCClient(rpc3);

            try {
                this.service = new Service(authResponse.applicationConf, authResponse.walletConf,
                    this.signatureOffloader, this.authFactory);

                await this.signatureOffloader.init();

                await this.service.init();
            }
            catch(e) {
                console.error(e);

                this.authFailed = true;

                this.triggerEvent("authFail", `Could not init Service: ${e}`);

                this.close();

                return;
            }

            // Chrome specific Page Lifecycle API event.
            //
            window.addEventListener("freeze", () => {
                console.error("freeze event received, closing application.");

                this.close();
            });

        }
        catch(e) {
            this.authFailed = true;

            this.triggerEvent("authFail", `Error in auth process: ${e}`);

            this.close();

            return;
        }

        this.triggerEvent("auth", this.service);
    }

    public isAuthed = (): boolean => {
        return this.service !== undefined;
    }

    public isPendingAuth = (): boolean => {
        return this.pendingAuth;
    }

    public isAuthFailed = (): boolean => {
        return this.authFailed;
    }

    public isAttentionNeeded = (): boolean => {
        return this.attentionNeeded;
    }

    public getSignatureOffloader = (): SignatureOffloaderInterface | undefined => {
        return this.signatureOffloader;
    }

    public getHandshakeFactoryFactory = (): AuthFactoryInterface | undefined => {
        return this.authFactory;
    }

    public getService = (): Service | undefined => {
        return this.service;
    }

    /**
     * @returns the OpenOdin version
     */
    public getVersion(): string {
        return Version;
    }

    /**
     * Returns information about the remote DataWallet.
     *
     * @returns {
     *  version: <OpenOdin version of DataWallet>,
     *  appVersion: <version of the DataWallet>,
     *  name: "OpenOdin DataWallet (official)",
     * }
     */
    public getRemoteInfo = async (): Promise<string | undefined> => {
        if (this._isClosed || !this._isOpened) {
            return undefined;
        }

        return this.rpc.call("getInfo");
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

    public isOpened = () => {
        return this._isOpened;
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

        this.triggerEvent("close");
    }

    /**
     * Event triggered when the Datawallet is opened and activated for the tab.
     * After this event one can all auth().
     */
    public onOpen = ( cb: () => void ) => {
        this.hookEvent("open", cb);
    }

    public offOpen = ( cb: () => void ) => {
        this.unhookEvent("open", cb);
    }

    public onPreAuth = ( cb: () => void ) => {
        this.hookEvent("preAuth", cb);
    }

    public offPreAuth = ( cb: () => void ) => {
        this.unhookEvent("preAuth", cb);
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
        this.hookEvent("auth", cb);
    }

    public offAuth = ( cb: (service: Service) => void ) => {
        this.unhookEvent("auth", cb);
    }

    /**
     * Event triggered on failed authorization or if port closed during pending authorization.
     * The OpenOdin instance cannot be reused.
     */
    public onAuthFail = ( cb: (error: string) => void ) => {
        this.hookEvent("authFail", cb);
    }

    public offAuthFail = ( cb: (error: string) => void ) => {
        this.unhookEvent("authFail", cb);
    }

    /**
     * Event triggered by DataWallet when the user's attention is needed
     * by the DataWallet.
     */
    public onAttentionNeeded = ( cb: (count: number) => void ) => {
        this.hookEvent("attentionNeeded", cb);
    }

    public offAttentionNeeded = ( cb: (count: number) => void ) => {
        this.unhookEvent("attentionNeeded", cb);
    }

    /**
     * Event triggered when port to background is disconnected or when calling close().
     *
     * The OpenOdin instance cannot be used any further after close.
     */
    public onClose = ( cb: () => void ) => {
        this.hookEvent("close", cb);
    }

    public offClose = ( cb: () => void ) => {
        this.unhookEvent("close", cb);
    }

    public getSettingsManager(): SettingsManagerRPCClient {
        if (!this.settingsManager) {
            throw new Error("SettingsManager not initiated");
        }

        return this.settingsManager;
    }

    protected hookEvent(name: string, callback: (...args: any[]) => void) {
        const cbs = this.handlers[name] || [];
        this.handlers[name] = cbs;
        cbs.push(callback);
    }

    protected unhookEvent(name: string, callback: (...args: any[]) => void) {
        const cbs = (this.handlers[name] || []).filter( (cb: ( (...args: any) => void)) => callback !== cb );
        this.handlers[name] = cbs;
    }

    protected triggerEvent(name: string, ...args: any[]) {
        const cbs = this.handlers[name] || [];
        cbs.forEach( (callback: ( (...args: any[]) => void)) => {
            setImmediate( () => callback(...args) );
        });
    }
}
