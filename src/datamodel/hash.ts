import blake2b from "blake2b"

/**
 * @param content - a single buffer, string or an array of mised buffer,
 * string, numbers, bigint or undefined to be hashed
 *
 * A single buffer will be hashed without adding prefix, just as it is.
 *
 * A single string will be utf8 encoded into a buffer and hashed without adding prefix,
 * just as it is.
 *
 * An array of content will have each value prefixed on both index and length to mitigate the
 * potential length extensions attack vector when hashing.
 *
 * Numbers will be packed to buffers as signed 32 bit BE numbers.
 * Out of range numbers will throw exception.
 *
 * Strings will be utf8 encoded into buffers.
 *
 * Bigints will be converted to strings then encoded into buffers.
 *
 * @returns resulting blake2b hash
 * @throws on overflow or out of range
 **/
export function Hash(content: Buffer | string | (Buffer | string | number | bigint | undefined)[]): Buffer {
    if (Buffer.isBuffer(content)) {
        const h = blake2b(32);
        h.update(content);
        return Buffer.from(h.digest());
    }

    if (typeof content === "string") {
        const h = blake2b(32);
        h.update(Buffer.from(content, "utf8"));
        return Buffer.from(h.digest());
    }

    if (content.length > 1024) {
        throw new Error("Numbers of content to hash cannot exceed 1024");
    }

    const MAX_BUF_LENGTH = 1024 * 1024 * 1024;
    const h = blake2b(32);
    content.forEach( (data, index) => {
        const indexBuf = Buffer.alloc(4);
        indexBuf.writeUInt32BE(index);
        h.update(indexBuf);
        let data2: Buffer | undefined;

        if (Buffer.isBuffer(data)) {
            data2 = data;
        }
        else if (typeof(data) === "string") {
            data2 = Buffer.from(data, "utf8");
        }
        else if (typeof(data) === "bigint") {
            data2 = Buffer.from(data.toString(), "utf8");
        }
        else if (typeof(data) === "number") {
            if (isNaN(data)) {
                throw new Error("NaN is not supported");
            }
            data2 = Buffer.alloc(4);
            data2.writeInt32BE(data);
        }
        else if (data === undefined) {
            // Do nothing
        }
        else {
            throw new Error("Invalid type to hash");
        }

        if (data2) {
            if (data2.length > MAX_BUF_LENGTH) {
                throw new Error(`Buffer length cannot exceed ${MAX_BUF_LENGTH} bytes when hashing`);
            }
            const lengthBuf = Buffer.alloc(4);
            lengthBuf.writeUInt32BE(data2.length);
            h.update(lengthBuf);
            h.update(data2);
        }
        else {
            // Add a length which could not happen if there was a buffer which is unique for undefined values.
            const impossibleLengthBuf = Buffer.alloc(4);
            impossibleLengthBuf.writeUInt32BE(MAX_BUF_LENGTH + 1);
            h.update(impossibleLengthBuf);
        }
    });

    return Buffer.from(h.digest());
}
