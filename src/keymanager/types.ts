export type ClientConfig = {
    clientId: string,
    localAddress?: string,
    remoteAddress?: string,
    remotePort?: number,
    localPort?: number,
};

export type AuthResponse = {
    error?: string,
    signatureOffloaderRPCId?: string,
    handshakeRPCId?: string,
};

export type WalletKeyPair = {
    publicKey: number[],
    secretKey: number[],
    crypto: string,
};

export type AuthResponse2 = {
    error?: string,
    keyPairs?: WalletKeyPair[],
};
