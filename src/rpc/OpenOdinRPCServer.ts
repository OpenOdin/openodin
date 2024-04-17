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
} from "../datamodel";

import {
    RPC,
} from "../util/RPC";

import {
    ParseUtil,
} from "../util/ParseUtil";

import {
    AuthResponse,
    AuthResponse2,
    AuthRequest,
} from "./types";

export class OpenOdinRPCServer {
    protected triggerOnAuth?: (rpcId1: string, rpcId2: string) => Promise<AuthResponse2>;
    protected signatureOffloaderRPCServer?: SignatureOffloaderRPCServer;
    protected authFactoryRPCCserver?: AuthFactoryRPCServer;
    protected settingsManagerRPCServer?: SettingsManagerRPCServer;

    constructor(protected rpc: RPC, protected nrOfWorkers: number = 1,
        protected singleThreaded: boolean = false)
    {
        this.rpc.onCall("auth", this.auth);

        this.rpc.onCall("noop", async () => {
            return "noop";
        });
    }

    public onAuth(fn: (rpcId1: string, rpcId2: string) => Promise<AuthResponse2>) {
        this.triggerOnAuth = fn;
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
            this.singleThreaded);

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

        this.authFactoryRPCCserver = new AuthFactoryRPCServer(rpc2, keyPairs2);

        this.settingsManagerRPCServer = new SettingsManagerRPCServer(rpc3, authResponse2.url);

        const applicationConf = authRequest.applicationConf;

        const walletConf = ParseUtil.ParseWalletConf({});

        return {
            settingsManagerRPCId,
            signatureOffloaderRPCId,
            handshakeRPCId,
            applicationConf,
            walletConf,
        };
    }
}
