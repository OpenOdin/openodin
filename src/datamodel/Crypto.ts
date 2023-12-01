import crypto from "crypto";

import nacl from "tweetnacl";

import {
    keccak256,
} from "ethereum-cryptography/keccak";

import {
    ecsign,
    ecrecover,
    publicToAddress,
} from "@ethereumjs/util";

import {
    Wallet,
} from "@ethereumjs/wallet";

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

export class Crypto {
    public static readonly MAX_SIGNATURE_LENGTH = 65;

    public static readonly Ed25519: CryptoSchema = {
        PUBLICKEY_LENGTH: 32,
        SIGNATURE_LENGTH: 64,
    };

    public static readonly Ethereum: CryptoSchema = {
        /** This is the Ethereum address, not the public key. */
        PUBLICKEY_LENGTH: 20,

        SIGNATURE_LENGTH: 65,
    };

    /**
     * @param message bytes to sign
     * @param keyPair to sign with
     * @returns signature
     * @throws on malformed input
     */
    public static Sign(message: Buffer, keyPair: KeyPair): Buffer {
        if (Crypto.IsEd25519(keyPair.publicKey)) {
            const signature = nacl.sign.detached(message, keyPair.secretKey);

            return Buffer.from(signature);
        }
        else if (Crypto.IsEthereum(keyPair.publicKey)) {
            const prefix = `\x19Ethereum Signed Message:\n${message.length}`;

            const actualMessage = Buffer.from(keccak256(
                Buffer.concat([Buffer.from(prefix), message])));

            const signature = ecsign(actualMessage, keyPair.secretKey);

            return Buffer.concat([signature.r, signature.s, Buffer.from([Number(signature.v)])]);
        }
        else {
            throw new Error("Crypto schema not recognized");
        }
    }

    /**
     * Verify signature
     * @params Signature object
     * @returns true on verifified
     * @throws on malformed input
     */
    public static Verify(signature: Signature): boolean {
        if (Crypto.IsEd25519(signature.publicKey)) {
            if (nacl.sign.detached.verify(signature.message, signature.signature,
                signature.publicKey))
            {
                return true;
            }
        }
        else if (Crypto.IsEthereum(signature.publicKey)) {
            const r = signature.signature.slice(0, 32);

            const s = signature.signature.slice(32, 64);

            const v = BigInt(signature.signature.slice(64, 65)[0]);

            const prefix = `\x19Ethereum Signed Message:\n${signature.message.length}`;

            const actuallySigned = Buffer.from(keccak256(
                Buffer.concat([Buffer.from(prefix), signature.message])));

            const recoveredPublicKey = ecrecover(actuallySigned, v, r, s);

            const signerAddress = Buffer.from(publicToAddress(recoveredPublicKey));

            return signerAddress.equals(signature.publicKey);
        }
        else {
            throw new Error("Crypto schema not recognized");
        }

        return false;
    }

    /**
     * Returns the length in bytes of the signature for the crypto algorithm associated
     * with the public key given.
     *
     * @params publicKey the public key prefixed with the algorithm ID byte.
     * @return length in bytes of the signature
     * @throws if crypto algorithm cannot be determined.
     */
    public static GetSignatureLength(publicKey: Buffer): number {
        if (Crypto.IsEd25519(publicKey)) {
            return Crypto.Ed25519.SIGNATURE_LENGTH;
        }
        else if (Crypto.IsEthereum(publicKey)) {
            return Crypto.Ethereum.SIGNATURE_LENGTH;
        }
        else {
            throw new Error("Crypto schema not recognized");
        }
    }

    public static IsEd25519(publicKey: Buffer): boolean {
        return publicKey.length === Crypto.Ed25519.PUBLICKEY_LENGTH;
    }

    public static IsEthereum(publicKey: Buffer): boolean {
        return publicKey.length === Crypto.Ethereum.PUBLICKEY_LENGTH;

        return false;
    }

    /**
     * Static helper function to generate a new Ed25519 NaCl key pair used for signing.
     *
     * @returns a newly created Ed25519 NaCl key pair for signing.
     */
    public static GenKeyPair(): KeyPair {
        const keyPair = nacl.sign.keyPair();

        return {
            publicKey: Buffer.from(keyPair.publicKey),
            secretKey: Buffer.from(keyPair.secretKey)
        };
    }

    /**
     * Static helper function to generate a new ECDSA Ethereum key pair used for signing.
     *
     * @returns a newly created ECDSA Ethereum key pair for signing where publicKey returned
     * is actually the public Ethereum address.
     */
    public static GenEthereumKeyPair(): KeyPair {
        const wallet = Wallet.generate();

        const secretKey = Buffer.from(wallet.getPrivateKey());
        const address   = Buffer.from(wallet.getAddress());

        return {
            secretKey,
            publicKey: address,
        };
    }
};
