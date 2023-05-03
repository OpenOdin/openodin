import fs from "fs";
import util from "util";

import {
    AbstractStreamWriter,
} from "./AbstractStreamWriter";

import {
    ReadData,
    StreamReaderInterface,
} from "./types";

const write = util.promisify(fs.write);
const stat = util.promisify(fs.stat);
const close = util.promisify(fs.close);
const open = util.promisify(fs.open);

/**
 * Opens a file for streamed writing.
 * Can resume a write operation if the file already exists.
 */
export class FileStreamWriter extends AbstractStreamWriter {
    protected filepath: string;
    protected fd?: number;

    /**
     * @param filepath of the file.
     * @param streamReader the reader to consume.
     * @param allowResume if set to true then see if there already is a file to append to.
     */
    constructor(filepath: string, streamReader: StreamReaderInterface, allowResume: boolean = true) {
        super(streamReader, allowResume);
        this.filepath = filepath;
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
     * @return size of current target file if this.allowResume is set
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
                    size = stats.size;
                }
                catch(e) {
                    // Do nothing
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
            const message = (typeof (e as any)?.message) === "string" ? (e as any).message : "";
            throw new Error(`File ${this.filepath} could not be opened for writing: ${message}`);
        }
    }

    /**
     * Write data to target file.
     * @param readData the data to write.
     * @returns promise which will resolve on success or reject on error.
     * On success a boolean is returned, if false then the write was discarded due to a fseek.
     */
    protected async write(readData: ReadData): Promise<boolean> {
        if (this.fd === undefined) {
            const fseek = await this.open();  // Throws
            if (fseek > 0) {
                this.streamReader.seek(fseek);
                // Discard this readData and wait for next call since we have seeked in the reader.
                return false;
            }
        }

        if (!this.fd) {
            throw new Error(`Writer could not open the file: ${this.filepath}`);
        }

        const {bytesWritten} = await write(this.fd, readData.data, 0, readData.data.length, Number(readData.pos));

        if (bytesWritten !== readData.data.length) {
            throw new Error(`All data could not be written to the file: ${this.filepath}. Disk full?`);
        }

        return true;
    }
}
