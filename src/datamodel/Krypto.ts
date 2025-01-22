import nacl from "tweetnacl";

import {
    ParseSchemaType,
} from "../util/SchemaUtil";

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

import {
    SignatureVerification,
    KeyPair,
    KryptoSchema,
    KryptoSchemaType,
} from "./types";

export class Krypto {
    public static readonly MAX_SIGNATURE_LENGTH = 65;
    public static readonly MAX_PUBLICKEY_LENGTH = 32;

    public static readonly ED25519: KryptoSchema = {
        TYPE: 0,
        PUBLICKEY_LENGTH: 32,
        SIGNATURE_LENGTH: 64,
    };

    public static readonly ETHEREUM: KryptoSchema = {
        TYPE: 1,

        /** This is the Ethereum address, not the public key. */
        PUBLICKEY_LENGTH: 20,

        SIGNATURE_LENGTH: 65,
    };

    /**
     * @param message bytes to sign
     * @param keyPair to sign with
     * @param type can be set to cryptographic schema type,
     * if not set then auto detect based on public key length
     * @returns signature
     * @throws on malformed input
     */
    public static Sign(message: Buffer, keyPair: KeyPair,
        type?: KryptoSchemaType): Buffer
    {
        type = type ?? Krypto.GetType(keyPair.publicKey);

        if (type === Krypto.ED25519.TYPE) {
            const signature = nacl.sign.detached(message, keyPair.secretKey);

            return Buffer.from(signature);
        }
        else if (type === Krypto.ETHEREUM.TYPE) {
            const prefix = `\x19Ethereum Signed Message:\n${message.length}`;

            const actualMessage = Buffer.from(keccak256(
                Buffer.concat([Buffer.from(prefix), message])));

            const signature = ecsign(actualMessage, keyPair.secretKey);

            return Buffer.concat([signature.r, signature.s,
                Buffer.from([Number(signature.v)])]);
        }
        else {
            throw new Error("Krypto schema type not recognized");
        }
    }

    /**
     * Verify signature
     * @params SignatureVerification object
     * @returns true on verifified
     * @throws on malformed input
     */
    public static Verify(signature: SignatureVerification): boolean {
        if (signature.type === Krypto.ED25519.TYPE) {
            if (nacl.sign.detached.verify(signature.message, signature.signature,
                signature.publicKey))
            {
                return true;
            }
        }
        else if (signature.type === Krypto.ETHEREUM.TYPE) {
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
            throw new Error("Krypto schema type not recognized");
        }

        return false;
    }

    /**
     * Returns the length in bytes of the signature for the crypto algorithm
     * associated with the public key given.
     *
     * @params publicKey the public key prefixed with the algorithm ID byte.
     * @return length in bytes of the signature
     * @throws if crypto algorithm cannot be determined.
     */
    public static GetSignatureLength(publicKey: Buffer): number {
        if (Krypto.IsEd25519(publicKey)) {
            return Krypto.ED25519.SIGNATURE_LENGTH;
        }
        else if (Krypto.IsEthereum(publicKey)) {
            return Krypto.ETHEREUM.SIGNATURE_LENGTH;
        }
        else {
            throw new Error("Public key length not recognized");
        }
    }

    public static IsEd25519(publicKey: Buffer): boolean {
        return publicKey.length === Krypto.ED25519.PUBLICKEY_LENGTH;
    }

    public static IsEthereum(publicKey: Buffer): boolean {
        return publicKey.length === Krypto.ETHEREUM.PUBLICKEY_LENGTH;
    }

    public static GetType(publicKey: Buffer):
        KryptoSchemaType | undefined
    {
        if (Krypto.IsEd25519(publicKey)) {
            return Krypto.ED25519.TYPE;
        }
        else if (Krypto.IsEthereum(publicKey)) {
            return Krypto.ETHEREUM.TYPE;
        }

        return undefined;
    }

    /**
     * Static helper function to generate a new Ed25519 NaCl key pair used for
     * signing.
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
     * Static helper function to generate a new ECDSA Ethereum key pair used for
     * signing.
     *
     * @returns a newly created ECDSA Ethereum key pair for signing where
     * publicKey returned is actually the public Ethereum address.
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
}

export const ParseKeyPairSchema: ParseSchemaType = {
    publicKey: new Uint8Array(0),
    secretKey: new Uint8Array(0),
} as const;
