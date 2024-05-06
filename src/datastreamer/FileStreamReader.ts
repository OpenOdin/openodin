import fs from "fs";
import util from "util";

import {
    AbstractStreamReader,
} from "./AbstractStreamReader";

import {
    StreamStatus,
} from "./types";

let stat: Function;
let read: Function;
let close: Function;
let open: Function;

const isBrowser = typeof window !== "undefined";
if (!isBrowser) {
    stat = util.promisify(fs.stat);
    read = util.promisify(fs.read);
    close = util.promisify(fs.close);
    open = util.promisify(fs.open);
}

/**
 * Opens a file and stream from it.
 */
export class FileStreamReader extends AbstractStreamReader {
    protected filepath: string;

    protected fd?: number;

    protected size: bigint;

    /**
     * @param filepath of the file.
     * @param pos where in the file to start reading.
     * @param chunkSize the chunk size in bytes to batch read.
     */
    constructor(filepath: string, pos: bigint = 0n, chunkSize: number = 1024 * 1024) {
        super(pos, chunkSize);

        this.filepath = filepath;

        this.size = 0n;
    }

    /**
     * Close the file descriptor.
     */
    public close() {
        if (this.fd) {
            close(this.fd);
            delete this.fd;
        }

        super.close();
    }

    /**
     * @return the size of the source file
     * @throws
     */
    protected async open(): Promise<bigint> {
        if (this.fd !== undefined) {
            return 0n;
        }

        try {
            const stats: fs.BigIntStats = await stat(this.filepath, {bigint: true});

            if (!stats.isFile()) {
                return 0n;
            }

            this.fd = await open(this.filepath, "r");  // Open for reading

            return stats.size;
        }
        catch(e) {
            // this.fd will not have been set which does indicate an error.
            return 0n;
        }
    }

    protected async read(chunkSize?: number): Promise<boolean> {
        if (this.fd === undefined) {
            this.size = await this.open();

            if (this.fd === undefined) {
                this.buffered.push({
                    status: StreamStatus.UNRECOVERABLE,
                    error: `FileStreamReader could not open the file: ${this.filepath}`,
                    data: Buffer.alloc(0),
                    pos: 0n,
                    size: 0n,
                });

                return false;
            }
        }

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
            const error = `Position has been seeked beyond file '${this.filepath}'. Run without resume to overwrite target`;

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

        try {
            const length = Math.min(chunkSize, Number(this.size - this.pos));

            const data = Buffer.alloc(length);

            const {bytesRead} = await read(this.fd, data, 0, data.length, Number(this.pos));

            this.buffered.push({
                status: StreamStatus.RESULT,
                size: this.size,
                data: data.slice(0, bytesRead),
                pos: this.pos,
                error: "",
            });

            this.pos = this.pos + BigInt(bytesRead);

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

            return true;
        }
        catch(e) {
            const error = `FileStreamReader could not read from file: ${this.filepath}: ${e}`;

            this.buffered.push({
                status: StreamStatus.UNRECOVERABLE,
                error,
                data: Buffer.alloc(0),
                pos: 0n,
                size: 0n,
            });

            return false;
        }
    }
}
