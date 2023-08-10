import {
    AbstractStreamReader,
} from "./AbstractStreamReader";

/**
 * Opens a file and stream from it.
 */
export class BrowserFileStreamReader extends AbstractStreamReader {
    protected file: File;
    protected size: bigint;

    /** Maximum chunk of bytes to read from file each time. */
    protected chunkSize: number;

    /**
     * @param file
     * @param pos where in the stream to start reading.
     * @param chunkSize the chunk size in bytes to batch read.
     */
    constructor(file: File, pos: bigint = 0n, chunkSize: number = 1024 * 60) {
        super(pos);
        this.file = file;
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

    /**
     * Attempts to read more data into the buffer.
     * @throws on unrecoverable error
     */
    protected async read(chunkSize?: number): Promise<void> {
        if (this.isClosed) {
            throw new Error("Reader is closed");
        }

        this.size = await this.open();

        if (this.pos > this.size) {
            throw new Error(`Position has been seeked beyond file '${this.file.name}'. Run without resume to overwrite target to avoid seeking`);
            return;
        }

        chunkSize = chunkSize ?? this.chunkSize;

        try {
            // NOTE: FIXME: Is this performant?
            const dataRead = (await this.file.slice(Number(this.pos)).stream().getReader().read()).value;
            if (!dataRead) {
                this.buffered.push({size: this.size, data: Buffer.alloc(0), pos: this.pos});
                return;
            }

            // In the case the streamer returns alot of data at once we split it up into chunks.
            for (let localPos=0; localPos<dataRead.length; localPos += chunkSize) {
                const data = dataRead.slice(localPos, localPos + chunkSize);
                this.buffered.push({size: this.size, data: Buffer.from(data), pos: this.pos});

                this.pos = this.pos + BigInt(data.length);
            }
        }
        catch(e) {
            throw new Error(`Could not read from file: ${this.file.name}: ${e}`);
        }
    }
}
