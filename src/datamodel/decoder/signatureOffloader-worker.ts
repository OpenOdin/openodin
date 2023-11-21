/**
 * NOTE: This file is TypeScript compiled into
 * "./build/src/datamodel/decoder/signatureOffloader-worker.js" which is the file loaded into
 * the worker thread when running in NodeJS.
 *
 * That compiled file is also browserified during the build process to
 * "./build/src/storage/crdt/signatureOffloader-worker-browser.js" which is the file loaded
 * when running in a browser, and this file must always be copied to the browser application
 * public root directory so it is accessible to be loaded by the browser's Worker() in run-time.
 *
 */

import {
    RPC,
} from "../../util/RPC";

import {
    KeyPair,
} from "../node";

import {
    ToBeSigned,
    SignaturesCollection,
    SignedResult,
} from "./types";

const sodium = require("libsodium-wrappers");  //eslint-disable-line @typescript-eslint/no-var-requires

export class SignatureOffloaderWorker {
    protected keyPairs: KeyPair[] = [];

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

                const {message, signature, publicKey, crypto} = signatures[j];

                if (crypto !== "ed25519") {
                    // We do not know this crypto.
                    // No point checking any more in this collection since at least
                    // one signature is not valid.
                    //
                    break;
                }

                // use sodium to verify signature.
                //
                try {
                    if (sodium.crypto_sign_verify_detached(signature, message, publicKey)) {

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
            let secretKey: Buffer | undefined;

            const {index, message, publicKey, crypto} = toBeSigned[j];

            if (crypto !== "ed25519") {
                continue;
            }

            // This is serialized as Uint8Array so we want it back as Buffer to use equals().
            //
            const publicKey2 = Buffer.from(publicKey);

            const keyPairsLength = this.keyPairs.length;

            // Find the matching secretKey so we can sign.
            //
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

            try {
                // use sodium to sign
                //
                const signature = sodium.crypto_sign_detached(Buffer.from(message), secretKey);

                result.push({index, signature: Buffer.from(signature)});
            }
            catch(e) {
                // Abort
                //
                return [];
            }
        }

        return result;
    }
}

function main(self?: any) {
    // In case of Browser, self is likely to be set.
    // This is where the event listener needs to get installed to.
    if(self) {
        self.addEventListener = addEventListener;
    }

    const postMessageWrapped = (message: any) => {
        postMessage({message});
    };

    const listenMessage = (listener: any) => {
        addEventListener("message", (event: any) => {
            listener(event.data.message);
        });
    };

    const signatureOffloaderWorker = new SignatureOffloaderWorker();

    const rpc = new RPC(postMessageWrapped, listenMessage);

    rpc.onCall("addKeyPair", (keyPair: KeyPair) => {
        return signatureOffloaderWorker.addKeyPair(keyPair);
    });

    rpc.onCall("verify", (signaturesCollections: SignaturesCollection[]) => {
        return signatureOffloaderWorker.verify(signaturesCollections);
    });

    rpc.onCall("sign", (toBeSigned: ToBeSigned[]) => {
        return signatureOffloaderWorker.sign(toBeSigned);
    });

    sodium.ready.then( () => {
        rpc.call("hello");
    });
}

main();
