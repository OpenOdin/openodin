import {
    AbstractStreamReader,
} from "./AbstractStreamReader";

import {
    StreamStatus,
} from "./types";

/**
 * Opens a file and stream from it.
 */
export class BrowserFileStreamReader extends AbstractStreamReader {
    protected file: File;

    protected size: bigint;

    /**
     * @param file
     * @param pos where in the stream to start reading.
     * @param chunkSize the chunk size in bytes to batch read.
     */
    constructor(file: File, pos: bigint = 0n, chunkSize: number = 1024 * 1024) {
        super(pos, chunkSize);

        this.file = file;

        this.size = 0n;
    }

    /**
     * Close the file descriptor.
     */
    public close() {
        super.close();
    }

    /**
     * @return the size of the source file
     * @throws
     */
    protected async open(): Promise<bigint> {
        try {
            return BigInt(this.file.size);
        }
        catch(e) {
            throw new Error(`The file could not be opened for reading: ${this.file}. ${e}`);
        }
    }

    protected async read(chunkSize?: number): Promise<boolean> {
        try {
            this.size = await this.open();

            if (this.pos > this.size) {
                const error = `Position has been seeked beyond file '${this.file.name}'. Run without resume to overwrite target to avoid seeking`;

                this.buffered.push({
                    status: StreamStatus.ERROR,
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

            // NOTE: FIXME: Is this performant?
            const value = (await this.file.slice(Number(this.pos)).stream().getReader().read()).value;

            if (!value) {
                this.buffered.push({
                    status: StreamStatus.EOF,
                    size: this.size,
                    data: Buffer.alloc(0),
                    pos: this.pos,
                    error: "",
                });

                return false;
            }

            // In the case the streamer returns alot of data at once we split it up into chunks.
            for (let localPos=0; localPos<value.length; localPos += chunkSize) {
                const data = value.slice(localPos, localPos + chunkSize);
                this.buffered.push({
                    status: StreamStatus.RESULT,
                    size: this.size,
                    data: Buffer.from(data),
                    pos: this.pos,
                    error: "",
                });

                this.pos = this.pos + BigInt(data.length);
            }

            return true;
        }
        catch(e) {
            const error = `Browser could not read from file: ${this.file.name}: ${e}`;

            this.buffered.push({
                status: StreamStatus.ERROR,
                error,
                data: Buffer.alloc(0),
                pos: 0n,
                size: 0n,
            });

            return false;
        }
    }
}
