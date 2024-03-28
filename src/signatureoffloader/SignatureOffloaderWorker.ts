import {
    KeyPair,
} from "../datamodel/types";

import {
    Crypto,
} from "../datamodel/Crypto";

import {
    ToBeSigned,
    SignaturesCollection,
    SignedResult,
} from "./types";

const sodium = require("libsodium-wrappers");  //eslint-disable-line @typescript-eslint/no-var-requires

export class SignatureOffloaderWorker {
    protected keyPairs: KeyPair[] = [];

    public async init() {
        await sodium.ready;
    }

    public addKeyPair(keyPair: KeyPair) {
        this.keyPairs.push({
            publicKey: Buffer.from(keyPair.publicKey),
            secretKey: Buffer.from(keyPair.secretKey),
        });

        return;
    }

    public verify(signaturesCollections: SignaturesCollection[]): number[]  {
        const result: number[] = [];

        const l = signaturesCollections.length;
        for (let i=0; i<l; i++) {

            const {index, signatures} = signaturesCollections[i];

            let validCount = 0;

            const l2 = signatures.length;

            for (let j=0; j<l2; j++) {

                const {message, signature, publicKey} = signatures[j];

                // These can be Uint8Arrays after serialization so we make sure they are Buffers.
                //
                const message2   = Buffer.from(message);
                const signature2 = Buffer.from(signature);
                const publicKey2 = Buffer.from(publicKey);

                if (Crypto.IsEd25519(publicKey2)) {
                    // Use sodium to verify signature in high speed.
                    //
                    try {
                        if (sodium.crypto_sign_verify_detached(signature2, message2,
                            publicKey2))
                        {
                            validCount++;
                            continue;
                        }
                        else {
                            // Could not verify signature,
                            // do not attempt to verify any further.
                            //
                            break;
                        }
                    }
                    catch(e) {
                        // Could not verify signature,
                        // do not attempt to verify any further.
                        //
                        break;
                    }
                }
                else {
                    // Resolve other cases which are not ed25519
                    //
                    try {
                        if (Crypto.Verify({message: message2, signature: signature2,
                                publicKey: publicKey2, index}))
                        {
                            validCount++
                            continue;
                        }
                    }
                    catch(e) {
                        // Fall through
                    }

                    // Could not verify signature,
                    // do not attempt to verify any further.
                    //
                    break;
                }
            }

            if (validCount === l2) {
                // All signatures in the collection verified.
                //
                result.push(index);
            }
        }

        return result;
    }

    public sign(toBeSigned: ToBeSigned[]): SignedResult[] {
        const result: SignedResult[] = [];

        const l = toBeSigned.length;

        for (let j=0; j<l; j++) {
            const {index, message, publicKey} = toBeSigned[j];

            // These are serialized as Uint8Array so we want it back as Buffer to be able to use equals().
            //
            const publicKey2 = Buffer.from(publicKey);
            const message2   = Buffer.from(message);

            const keyPairsLength = this.keyPairs.length;

            // Find the matching secretKey so we can sign.
            //
            let secretKey: Buffer | undefined;

            for (let i=0; i<keyPairsLength; i++) {

                const keyPair = this.keyPairs[i];

                if (keyPair.publicKey.equals(publicKey2)) {
                    secretKey = keyPair.secretKey;
                    break;
                }
            }

            if (!secretKey) {
                continue;
            }

            if (Crypto.IsEd25519(publicKey)) {
                try {
                    // Use sodium to sign in high speed.
                    //
                    const signature = Buffer.from(sodium.crypto_sign_detached(message2, secretKey));

                    result.push({index, signature});
                }
                catch(e) {
                    // Abort
                    //
                    return [];
                }
            }
            else {
                try {
                    // Resolve other cases which are not ed25519
                    //
                    const keyPair = {
                        publicKey,
                        secretKey,
                    };

                    const signature = Crypto.Sign(message2, keyPair);

                    result.push({index, signature});
                }
                catch(e) {
                    // Abort
                    //
                    return [];
                }
            }
        }

        return result;
    }
}
