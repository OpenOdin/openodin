import {
    ApplicationConf,
    WalletConf,
} from "../service/types";

export type ClientConfig = {
    clientId: string,
    localAddress?: string,
    remoteAddress?: string,
    remotePort?: number,
    localPort?: number,
    isWebSocket: boolean,
    isTextMode: boolean,
};

export type AuthRequest = {
    applicationConf: ApplicationConf,
};

export type AuthResponse = {
    error?: string,
    signatureOffloaderRPCId?: string,
    handshakeRPCId?: string,
    settingsManagerRPCId?: string,
    applicationConf?: ApplicationConf,
    walletConf?: WalletConf,
};

export type WalletKeyPair = {
    publicKey: number[],
    secretKey: number[],
    crypto: string,
};

export type AuthResponse2 = {
    error?: string,
    keyPairs?: WalletKeyPair[],
    url?: string,
};
