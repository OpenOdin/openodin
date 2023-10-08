import {
    StreamReaderInterface,
    StreamReadData,
    StreamStatus,
} from "./types";

/**
 * The reader will buffer up a stream of responses then asking the source for another batch until all data is read.
 * The stream will automatically be closed when finished reading and on any error reading.
 */
export abstract class AbstractStreamReader implements StreamReaderInterface {
    protected pos: bigint;

    protected initPos: bigint;

    /** Maximum chunk of bytes to read from file each time. */
    protected chunkSize: number;

    protected _isClosed: boolean;

    protected buffered: StreamReadData[];

    protected autoClose: boolean = true;

    /**
     * @param pos the starting position in the stream to start reading from.
     *  If this StreamReader is passed to a StreamWriter pos is often requried to be 0.
     * @param chunkSize the chunk size in bytes to attempt to read.
     * This should not be set when using 
     */
    constructor(pos: bigint, chunkSize: number) {
        if (pos < 0) {
            throw new Error("pos must be >= 0");
        }

        if (chunkSize < 1) {
            throw new Error("chunkSize must be > 0");
        }

        this.pos = pos;

        this.initPos = pos;

        this.chunkSize = chunkSize;

        this.buffered = [];

        this._isClosed = false;
    }

    public reinit() {
        if (!this._isClosed) {
            throw new Error("StreamReader reinit() can only be called after being closed");
        }

        this.pos = this.initPos;

        this.buffered = [];

        this._isClosed = false;
    }

    /**
     * @param autoClose if true (default) then automatically close read stream when EOF is reached.
     * If wanting to seek back after reading auto close can be set to false to not have it accidentally closed.
     */
    public setAutoClose(autoClose: boolean) {
        this.autoClose = autoClose;
    }

    public getPos(): bigint {
        return this.pos;
    }

    public getChunkSize(): number {
        return this.chunkSize;
    }

    public setChunkSize(chunkSize: number) {
        if (chunkSize < 1) {
            throw new Error("chunkSize must be > 0");
        }

        this.chunkSize = chunkSize;
    }

    public isClosed(): boolean {
        return this._isClosed;
    }

    /*
     * Read data from the source and adds to the `buffered` property.
     * Add data to this.buffered.
     * Must advance this.pos as it reads.
     * Will try next peer in list if current one fails.
     * @return true if to keep reading, or false if to close streamer.
     */
    protected abstract read(chunkSize?: number): Promise<boolean>;

    /**
     * Closes all open file descriptions/resources.
     */
    public close() {
        if (this._isClosed === true) {
            return;
        }

        this._isClosed = true;
    }

    /**
     * Return a StreamReadData struct read from the source.
     *
     * status == RESULT
     *  comes with data
     *
     * status == EOF
     *  indicates end of stream and carries no data
     *  Always call next() until EOF is returned to have it properly closed.
     *
     * status == NOT_ALLOWED
     *  Reader does not have access to the node itself, or the node does not exist.
     *
     * status == NOT_AVAILABLE
     *  Blob data is not availble (at the moment, worth retrying in a while).
     *
     * status == ERROR
     *  error, see error message for details.
     *
     * status == UNRECOVERABLE
     *  unrecoverable error, see error message for details.
     *
     * @returns Promise<StreamReadData>
     */
    public async next(chunkSize?: number): Promise<StreamReadData> {
        if (this.buffered.length > 0) {
            return this.buffered.shift() as StreamReadData;
        }

        if (this._isClosed) {
            return {
                status: StreamStatus.ERROR,
                error: "StreamReader is closed",
                data: Buffer.alloc(0),
                pos: 0n,
                size: 0n,
            };
        }

        const keepAlive = await this.read(chunkSize);

        if (!keepAlive && this.autoClose) {
            this.close();
        }

        return this.buffered.shift() as StreamReadData;
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
