import fs from "fs";
import util from "util";

import {
    AbstractStreamWriter,
} from "./AbstractStreamWriter";

import {
    StreamReadData,
    StreamStatus,
    StreamReaderInterface,
} from "./types";

let write: Function;
let stat: Function;
let close: Function;
let open: Function;

declare const window: any;
declare const browser: any;
declare const chrome: any;
const isBrowser = typeof window !== "undefined" || typeof browser !== "undefined" || typeof chrome !== "undefined";
if (!isBrowser) {
    write = util.promisify(fs.write);
    stat = util.promisify(fs.stat);
    close = util.promisify(fs.close);
    open = util.promisify(fs.open);
}

/**
 * Opens a file for streamed writing.
 * Can resume a write operation if the file already exists.
 */
export class FileStreamWriter extends AbstractStreamWriter {
    protected filepath: string;
    protected fd?: number;

    protected readPosOffset: bigint;

    /**
     * @param filepath of the file.
     * @param streamReader the reader to consume.
     * @param allowResume if set to true then see if there already is a file to append to.
     */
    constructor(filepath: string, streamReader: StreamReaderInterface, allowResume: boolean = true) {
        super(streamReader, allowResume);

        this.filepath = filepath;

        if (streamReader.getPos() !== 0n && allowResume) {
            throw new Error("StreamReader must start at position 0 when using allowResume");
        }

        this.readPosOffset = streamReader.getPos();
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
     * Opens file for writing
     * @return size of current target file if this.allowResume is set.
     * this.fd will be set on success.
     */
    protected async open(): Promise<bigint> {
        if (this.fd !== undefined) {
            return 0n;
        }

        try {
            let size: bigint = 0n;

            if (this.allowResume) {
                try {
                    const stats: fs.BigIntStats = await stat(this.filepath, {bigint: true});

                    if (!stats.isFile()) {
                        return 0n;
                    }

                    size = stats.size;
                }
                catch(e) {
                    // Fall through
                }
            }

            if (size === 0n) {
                this.fd = await open(this.filepath, "w");  // Creates file for writing (truncates also)
            }
            else {
                this.fd = await open(this.filepath, "r+");  // Reading and writing, does not truncate
            }

            return size;
        }
        catch(e) {
            // this.fd is still undefined which indicates an error opening the file.
            return 0n;
        }
    }

    protected async write(readData: StreamReadData): Promise<[StreamStatus, string, bigint?]> {
        if (this.fd === undefined) {
            const fseek = await this.open();

            if (this.fd === undefined) {
                const error = `FileStreamWriter could not open the file: ${this.filepath}`;

                return [StreamStatus.UNRECOVERABLE, error];
            }

            if (fseek > 0n) {
                // Discard this readData and wait for next call since we have seeked in the reader.
                return [StreamStatus.RESULT, "", fseek];
            }
        }

        const pos = readData.pos - this.readPosOffset;

        if (pos < 0) {
            return [StreamStatus.ERROR, "StreamReader has been reset behind its initial pos."];
        }

        const {bytesWritten} = await write(this.fd, readData.data, 0,
            readData.data.length, Number(pos));

        if (bytesWritten !== readData.data.length) {
            const error = `All data could not be written to the file: ${this.filepath}. Disk full?`;

            return [StreamStatus.ERROR, error];
        }

        return [StreamStatus.RESULT, ""];
    }
}
