export function MakeIntoBuffer(data: Uint8Array | undefined): Buffer {
    if (!data) {
        return Buffer.alloc(0);
    }

    if (Buffer.isBuffer(data)) {
        return data;
    }

    return Buffer.from(data);
}
