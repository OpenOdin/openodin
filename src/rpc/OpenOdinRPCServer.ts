import {
    SignatureOffloaderRPCServer,
} from "./SignatureOffloaderRPCServer";

import {
    AuthFactoryRPCServer,
} from "./AuthFactoryRPCServer";

import {
    SettingsManagerRPCServer,
} from "./SettingsManagerRPCServer";

import {
    KeyPair,
    DataModelInterface,
} from "../datamodel";

import {
    RPC,
} from "../util/RPC";

import {
    ParseSchema,
} from "../util/SchemaUtil";

import {
    WalletConfSchema,
} from "../service/types";

import {
    AuthResponse,
    AuthResponse2,
    AuthRequest,
    RemoteInfo,
} from "./types";

import {
    AuthFactoryConfig,
} from "../auth/types";

import {
    Version,
} from "../types";

export class OpenOdinRPCServer {
    protected triggerOnAuth?: (rpcId1: string, rpcId2: string) => Promise<AuthResponse2>;
    protected triggerOnCreate?: (authFactoryConfig: AuthFactoryConfig) => Promise<boolean>;
    protected triggerOnSign?: (dataModels: DataModelInterface[]) => Promise<boolean>;
    protected signatureOffloaderRPCServer?: SignatureOffloaderRPCServer;
    protected authFactoryRPCCserver?: AuthFactoryRPCServer;
    protected settingsManagerRPCServer?: SettingsManagerRPCServer;

    constructor(protected rpc: RPC, protected nrOfWorkers: number = 1,
        protected singleThreaded: boolean = false,
        protected appName: string,
        protected appVersion: string)
    {
        this.rpc.onCall("auth", this.auth);

        this.rpc.onCall("getInfo", async () => {
            const info: RemoteInfo = {
                version: Version,
                appVersion: this.appVersion,
                name: this.appName,
            };

            return info;
        });

        this.rpc.onCall("noop", async () => {
            return "noop";
        });
    }

    public onAuth(fn: (rpcId1: string, rpcId2: string) => Promise<AuthResponse2>) {
        this.triggerOnAuth = fn;
    }

    /**
     * The function to trigger to confirm connections parameters on the event of
     * creating the handshake factory.
     */
    public onAuthFactoryCreate(fn: (authFactoryConfig: AuthFactoryConfig) => Promise<boolean>) {
        this.triggerOnCreate = fn;
    }

    /**
     * The function to trigger to confirm signing data.
     */
    public onSign(fn: (dataModels: DataModelInterface[]) => Promise<boolean>) {
        this.triggerOnSign = fn;
    }

    /**
     * Free resources created when authed.
     * The RPC is not automatically closed.
     */
    public close = () => {
        this.signatureOffloaderRPCServer?.close();
        this.authFactoryRPCCserver?.close();
    }

    /**
     * The application is requesting to be authorized.
     * @returns AuthResponse.
     */
    protected auth = async (authRequest: AuthRequest): Promise<AuthResponse> => {
        if (this.signatureOffloaderRPCServer || this.authFactoryRPCCserver) {
            return {
                error: "OpenOdinRPCServer already authenticated",
            };
        }

        if (!this.triggerOnAuth) {
            return {
                error: "No auth callback defined in OpenOdinRPCServer",
            };
        }

        const rpc1 = this.rpc.fork();
        const rpc2 = this.rpc.fork();
        const rpc3 = this.rpc.fork();

        const signatureOffloaderRPCId   = rpc1.getId();
        const handshakeRPCId            = rpc2.getId();
        const settingsManagerRPCId      = rpc3.getId();

        const authResponse2 = await this.triggerOnAuth(signatureOffloaderRPCId, handshakeRPCId);

        const keyPairs = authResponse2.keyPairs ?? [];

        if (authResponse2.error || keyPairs.length === 0 || !authResponse2.url) {
            rpc1.close();

            rpc2.close();

            rpc3.close();

            return {
                error: authResponse2.error ?? "No keys provided",
            };
        }

        this.signatureOffloaderRPCServer = new SignatureOffloaderRPCServer(rpc1, this.nrOfWorkers,
            this.singleThreaded, this.triggerOnSign);

        await this.signatureOffloaderRPCServer.init();

        const keyPairs2: KeyPair[] = [];

        const keyPairsLength = keyPairs.length;
        for (let i=0; i<keyPairsLength; i++) {
            const keyPair = keyPairs[i];

            const keyPair2 = {
                publicKey: Buffer.from(keyPair.publicKey),
                secretKey: Buffer.from(keyPair.secretKey),
            };

            keyPairs2.push(keyPair2);

            await this.signatureOffloaderRPCServer.addKeyPair(keyPair2);
        }

        this.authFactoryRPCCserver = new AuthFactoryRPCServer(rpc2, keyPairs2, this.triggerOnCreate);

        this.settingsManagerRPCServer = new SettingsManagerRPCServer(rpc3, authResponse2.url);

        const applicationConf = authRequest.applicationConf;

        // Return basic wallet config without keys and default sqlite storage configuration.
        // Available public keys can be retrieved from the SignatureOffloader.
        // TODO: add authCert?
        //
        const walletConf = ParseSchema(WalletConfSchema, {});

        return {
            settingsManagerRPCId,
            signatureOffloaderRPCId,
            handshakeRPCId,
            applicationConf,
            walletConf,
        };
    }
}
