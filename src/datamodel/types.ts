export type Signature = {
    message: Buffer,
    signature: Buffer,
    publicKey: Buffer,
    index: number,  // The index of the public key used
}

export type KeyPair = {
    publicKey: Buffer,
    secretKey: Buffer
};

export type CryptoSchema = {
    /**
     * Length of public key in bytes.
     */
    PUBLICKEY_LENGTH: number,

    /**
     * Length of signature in bytes.
     */
    SIGNATURE_LENGTH: number,
};
