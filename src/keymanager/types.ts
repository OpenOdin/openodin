import {
    KeyPair,
} from "../datamodel";

export type ClientConfig = {
    clientId: string,
    localAddress?: string,
    remoteAddress?: string,
    remotePort?: number,
    localPort?: number,
};

export type RPCMessage = {
    /**
     * Set to the function name we are calling.
     * Leave empty for return responses.
     */
    name?: string,

    /**
     * The function parameters when calling a function.
     * Leave empty for return responses.
     */
    parameters?: any[],

    /**
     * Set for return calls.
     * The return value of the function called.
     */
    response?: any,

    /**
     * Set when returning exceptions.
     */
    error?: string,

    /**
     * Auto generated random string set when calling a function
     * and used to identify return calls.
     * Automatically generated and set.
     */
    messageId: string,

    /** Unique identifier for this channel. */
    rpcId: string,
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
