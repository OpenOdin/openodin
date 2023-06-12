const sodium = require("libsodium-wrappers");

/**
 * This function reponds to events and can either verify signatures or sign messages.
 * This function is to be run in a separate thread/worker and it communicates with its
 * parent via events.
 */
const isNode = typeof process !== "undefined" && process?.versions?.node;
function main (self) {
    let ready = false;

    let keyPairs /*: KeyPair[] */ = [];

    /**
     * Receive message from parent thread.
     * @returns list of id1 which have all valid signatures
     */
    addEventListener("message", async (e /*e.data:SignaturesCollection[]*/) /*: number[]*/ => {
        if (!ready) {
            await sodium.ready;
            ready = true;
        }

        const message = e.data;

        if (message.action === "addKeyPair") {
            keyPairs.push({
                publicKey: Buffer.from(message.data.keyPair.publicKey),
                secretKey: Buffer.from(message.data.keyPair.secretKey),
            });
            postMessage();
        }
        else if (message.action === "verify") {
            const nodeSignaturesCollections = message.data; // as SignaturesCollection[];
            const result /*: number[] */ = [];
            for (let i=0; i<nodeSignaturesCollections.length; i++) {
                const {index, signatures} = nodeSignaturesCollections[i];
                let validCount = 0;
                for (let j=0; j<signatures.length; j++) {
                    const {message, signature, publicKey, crypto} = signatures[j];
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
                        catch(e) {
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
            const toBeSigned = message.data; // as ToBeSigned[]
            const result /*: SignedResult[] */ = [];
            for (let j=0; j<toBeSigned.length; j++) {
                let secretKey;

                const {index, message, publicKey, crypto} = toBeSigned[j];

                const keyPairsLength = keyPairs.length;
                for (let i=0; i<keyPairsLength; i++) {
                    const keyPair = keyPairs[i];
                    if (keyPair.publicKey.equals(publicKey)) {
                        secretKey = keyPair.secretKey;
                    }
                }

                if (secretKey) {
                    if (crypto === "ed25519") {
                        try {
                            // use sodium to sign
                            const signature = sodium.crypto_sign_detached(Buffer.from(message), Buffer.from(secretKey));
                            result.push({index, signature});
                        }
                        catch(e) {
                            // Abort
                            result = [];
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
    if(self) {
        self.addEventListener = addEventListener;
    }
}

// In case of Node.js, call the worker thread.
// Otherwise, just export it to become an accessible module to be called elsewhere.
if(isNode) {
    main();
} else {
    module.exports = main;
}
