import {
    AbstractStreamReader,
} from "./AbstractStreamReader";

import {
    StreamStatus,
} from "./types";

/**
 * Create a StreamReader to read from a Buffer object.
 *
 */
export class BufferStreamReader extends AbstractStreamReader {
    protected size: bigint;

    constructor(protected data: Buffer, pos: bigint = 0n, chunkSize: number = 1024 * 1024) {
        super(pos, chunkSize);

        this.size = BigInt(this.data.length);
    }

    protected async read(chunkSize?: number): Promise<boolean> {
        if (this.pos === this.size) {
            this.buffered.push({
                status: StreamStatus.EOF,
                size: this.size,
                data: Buffer.alloc(0),
                pos: this.pos,
                error: "",
            });

            return false;
        }

        if (this.pos > this.size) {
            const error = `Position has been seeked beyond data buffer. Run without resume to overwrite target`;

            this.buffered.push({
                status: StreamStatus.UNRECOVERABLE,
                error,
                data: Buffer.alloc(0),
                pos: 0n,
                size: 0n,
            });

            return false;
        }

        chunkSize = chunkSize ?? this.chunkSize;

        if (chunkSize < 1) {
            this.buffered.push({
                status: StreamStatus.UNRECOVERABLE,
                error: "chunkSize must be > 0",
                data: Buffer.alloc(0),
                pos: 0n,
                size: 0n,
            });

            return false;
        }

        const pos = Number(this.pos);

        const data = this.data.slice(pos, pos + chunkSize);

        this.pos = this.pos + BigInt(data.length);

        this.buffered.push({status: StreamStatus.RESULT, size: BigInt(this.data.length), data, pos: BigInt(pos), error: ""});

        return true;
    }
}
