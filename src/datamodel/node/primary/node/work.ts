import blake2b from "blake2b"

/**
 * Solve a nonce for the given message and number of difficulty bits.
 * @param message the message to hash together with the nonce.
 * @param difficulty the minimum number of bits making up the threshold.
 * @returns nonce or undefined if nonce could not be found.
 */
export function solve(message: Buffer, difficulty: number): Buffer | undefined {
    const threshold = makeThreshold(difficulty);
    const nonce = Buffer.alloc(8).fill(0);

    while (true) {
        const hashHex = blake2b(32).update(message).update(nonce).digest("hex").toLowerCase();
        if (hashHex >= threshold) {
            break;
        }
        // Increment nonce
        for (let index = 0; index < nonce.length; index++) {
            const byte = nonce.readUInt8(index);
            if (byte < 255) {
                nonce.writeUInt8(byte + 1, index);
                break;
            }
            else {
                if (index === nonce.length - 1) {
                    return undefined;
                }
                nonce.writeUInt8(0, index);
            }
        }
    }

    return nonce;
}

/**
 * Verify nonce for the given message and number of difficulty bits.
 * @param message the message to hash together with the nonce.
 * @param nonce the nonce to verify.
 * @param difficulty the minimum number of bits making up the threshold.
 * @return true if the nonce satisfies the difficulty
 */
export function verify(message: Buffer, nonce: Buffer, difficulty: number): boolean {
    const threshold = makeThreshold(difficulty);
    const hashHex = blake2b(32).update(message).update(nonce).digest("hex").toLowerCase();
    return hashHex >= threshold;
}

/**
 * Create a hexadecimal string representing the threshold required.
 * @param bits how many bits will make up the threshold
 * @return string of nr of set bits in hexadecimal format, 3 => "7", 4 => "f", 5 => "1f", etc.
 */
function makeThreshold(bits: number): string {
    const fullNibbles = Math.floor(bits / 4);
    const reminder = bits - fullNibbles * 4;
    const threshold = "f".repeat(fullNibbles) + parseInt("1".repeat(reminder).padStart(4, "0"), 2).toString(16).toLowerCase();
    return threshold;
}
