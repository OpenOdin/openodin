import {
    StreamReaderInterface,
    ReadData,
} from "./types";

/**
 * The reader will buffer up a stream of responses then asking the source for another batch until all data is read.
 * The stream will automatically be closed when finished reading and on any error reading.
 */
export abstract class AbstractStreamReader implements StreamReaderInterface {
    protected pos: bigint;
    protected isClosed: boolean;
    protected buffered: ReadData[];

    /**
     * @param pos the preferred starting position in the stream
     */
    constructor (pos: bigint) {
        this.pos = pos;
        this.buffered = [];
        this.isClosed = false;

        if (pos < 0) {
            throw new Error("pos must be >= 0");
        }
    }

    /*
     * Read data from the source and adds to the `buffered` property.
     * Add data to this.buffered.
     * Must advance this.pos as it reads.
     * @throws on error
     */
    protected abstract read(chunkSize?: number): Promise<void>;

    /**
     * Closes all open file descriptions/resources.
     */
    public close() {
        this.isClosed = true;
    }

    /**
     * Return a ReadData struct read from the source.
     * @returns Promise on ReadData or undefined if EOF reached.
     * @throws on error
     */
    public async next(chunkSize?: number): Promise<ReadData | undefined> {
        if (this.isClosed) {
            throw new Error("StreamReader is closed");
        }

        if (this.buffered.length === 0) {
            // Throws on error
            try {
                await this.read(chunkSize);
            }
            catch(e) {
                this.close();
                throw e;
            }
        }

        if (this.buffered.length === 0) {
            // No more data available
            this.close();
            return undefined;
        }

        return this.buffered.shift();
    }

    /**
     * When resuming a read the consumer can seek to a new position in the stream.
     * This will empty the current buffer and a new fill up with happen on the following call to next().
     * @param newPos the position in the source to seek to.
     */
    public seek(newPos: bigint) {
        this.pos = newPos;
        this.buffered.length = 0;
    }
}
