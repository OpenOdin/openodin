import fs from "fs";
import util from "util";

import {
    AbstractStreamReader,
} from "./AbstractStreamReader";

const stat = util.promisify(fs.stat);
const read = util.promisify(fs.read);
const close = util.promisify(fs.close);
const open = util.promisify(fs.open);

/**
 * Opens a file and stream from it.
 */
export class FileStreamReader extends AbstractStreamReader {
    protected filepath: string;
    protected fd?: number;
    protected size: bigint;

    /** Maximum chunk of bytes to read from file each time. */
    protected chunkSize: number;

    /**
     * @param filepath of the file.
     * @param pos where in the file to start reading.
     * @param chunkSize the chunk size in bytes to batch read.
     */
    constructor(filepath: string, pos: bigint = 0n, chunkSize: number = 1024 * 1024) {
        super(pos);
        this.filepath = filepath;
        this.chunkSize = chunkSize;
        this.size = 0n;

        if (chunkSize <= 0) {
            throw new Error("chunkSize must be > 0");
        }
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
            throw new Error("File is already open");
        }

        try {
            const stats: fs.BigIntStats = await stat(this.filepath, {bigint: true});
            this.fd = await open(this.filepath, "r");  // Open for reading

            return stats.size;
        }
        catch(e) {
            throw new Error(`The file could not be opened for reading: ${this.filepath}. ${e}`);
        }
    }

    /**
     * Attempts to read more data into the buffer.
     * @throws on unrecoverable error
     */
    protected async read(chunkSize?: number): Promise<void> {
        if (this.isClosed) {
            throw new Error("Reader is closed");
        }

        if (!this.fd) {
            this.size = await this.open();
        }

        if (!this.fd) {
            throw new Error(`Reader could not open the file: ${this.filepath}`);
        }

        if (this.pos > this.size) {
            throw new Error(`Position has been seeked beyond file '${this.filepath}'. Run without resume to overwrite target to avoid seeking`);
            return;
        }

        chunkSize = chunkSize ?? this.chunkSize;

        try {
            const length = Math.min(chunkSize, Number(this.size - this.pos));

            const data = Buffer.alloc(length);

            const {bytesRead} = await read(this.fd, data, 0, data.length, Number(this.pos));

            this.buffered.push({size: this.size, data: data.slice(0, bytesRead), pos: this.pos});

            this.pos = this.pos + BigInt(bytesRead);
        }
        catch(e) {
            throw new Error(`Could not read from file: ${this.filepath}: ${e}`);
        }
    }
}
