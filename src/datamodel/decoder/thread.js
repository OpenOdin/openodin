"use strict";
/**
 * Note: This file is typescript compiled into "/build/src/datamodel/decoder/thread.js"
 *  then copied back to this directory as "thread.js", it is also browserified as
 *  "/build/src/datamodel/decoder/thread-browser.js" and that file should always be
 *  copied to the browser application public root directory so it is accessible to
 *  be loaded by the Worker().
 */
Object.defineProperty(exports, "__esModule", { value: true });
const sodium = require("libsodium-wrappers"); //eslint-disable-line @typescript-eslint/no-var-requires
/**
 * This function reponds to events and can either verify signatures or sign messages.
 * This function is to be run in a separate thread/worker and it communicates with its
 * parent via events.
 */
function main(self) {
    let ready = false;
    const keyPairs = [];
    /**
     * Receive message from parent thread.
     * @returns list of id1 which have all valid signatures
     */
    addEventListener("message", async (e) => {
        if (!ready) {
            await sodium.ready;
            ready = true;
        }
        const message = e.data;
        if (message.action === "addKeyPair") {
            const keyPair = message.data;
            keyPairs.push({
                publicKey: Buffer.from(keyPair.publicKey),
                secretKey: Buffer.from(keyPair.secretKey),
            });
            postMessage([]);
        }
        else if (message.action === "verify") {
            const nodeSignaturesCollections = message.data;
            const result = [];
            for (let i = 0; i < nodeSignaturesCollections.length; i++) {
                const { index, signatures } = nodeSignaturesCollections[i];
                let validCount = 0;
                for (let j = 0; j < signatures.length; j++) {
                    const { message, signature, publicKey, crypto } = signatures[j];
                    if (crypto === "ed25519") {
                        try {
                            // use sodium to verify
                            if (sodium.crypto_sign_verify_detached(signature, message, publicKey)) {
                                validCount++;
                                continue;
                            }
                            else {
                                break;
                            }
                        }
                        catch (e) {
                            break;
                        }
                    }
                    else {
                        // We don't know this crypto
                        break;
                    }
                }
                if (validCount === signatures.length) {
                    result.push(index);
                }
            }
            // Send result to parent thread.
            postMessage(result);
        }
        else if (message.action === "sign") {
            const toBeSigned = message.data;
            const result = [];
            for (let j = 0; j < toBeSigned.length; j++) {
                let secretKey;
                const { index, message, publicKey, crypto } = toBeSigned[j];
                const publicKey2 = Buffer.from(publicKey);
                const keyPairsLength = keyPairs.length;
                for (let i = 0; i < keyPairsLength; i++) {
                    const keyPair = keyPairs[i];
                    if (keyPair.publicKey.equals(publicKey2)) {
                        secretKey = keyPair.secretKey;
                    }
                }
                if (secretKey) {
                    if (crypto === "ed25519") {
                        try {
                            // use sodium to sign
                            const signature = sodium.crypto_sign_detached(Buffer.from(message), Buffer.from(secretKey));
                            result.push({ index, signature: Buffer.from(signature) });
                        }
                        catch (e) {
                            // Abort
                            result.length = 0;
                            break;
                        }
                    }
                }
            }
            // Send result to parent thread.
            postMessage(result);
        }
        else {
            postMessage([]);
        }
    });
    // In case of Browser, self is likely to be set.
    // This is where the event listener needs to get installed to.
    if (self) {
        self.addEventListener = addEventListener;
    }
}
main();
