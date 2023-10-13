import {
    StreamReaderInterface,
    StreamWriterInterface,
    WriteStats,
    StreamReadData,
    StreamStatus,
    StreamWriteData,
    OnStatsFn,
} from "./types";

/**
 * The writer reads from a read stream and writes to its target.
 */
export abstract class AbstractStreamWriter implements StreamWriterInterface {
    protected streamReader: StreamReaderInterface;

    protected allowResume: boolean;

    protected pausedPromise: {promise?: Promise<void>, resolve?: () => void} = {};

    protected _isClosed: boolean = false;

    //@ts-ignore TS2564: This does get initialized in the constructor by calling initState().
    protected stats: WriteStats;

    protected statsFn?: OnStatsFn;

    protected pausedTime: number = 0;

    protected error: string = "";

    /**
     * @param streamReader the reader to consume data on it is automatically closed upon completion or error.
     * @param allowResume if set to true then detect if target has unfinished write and seek the reader forward.
     */
    constructor(streamReader: StreamReaderInterface, allowResume: boolean) {
        this.streamReader = streamReader;
        this.allowResume = allowResume;

        this.initState();
    }

    protected initState() {
        this.pausedPromise = {};

        this._isClosed = false;

        this.pausedTime = 0;

        this.stats = {
            resumed: false,
            written: 0n,
            pos: 0n,
            size: 0n,
            throughput: 0,
            isPaused: false,
            error: false,
            startTime: Date.now(),
            pausedDuration: 0,
            duration: 0,
            finishTime: undefined,
        };

        this.streamReader.setAutoClose(false);
    }

    public reinit() {
        if (!this._isClosed) {
            throw new Error("StreamWriter reinit() can only be called after being closed");
        }

        this.streamReader.reinit();

        this.initState();
    }

    public isClosed(): boolean {
        return this._isClosed;
    }

    /**
     * @returns the error message which also was returned in run() after streamer got closed.
     */
    public getError(): string {
        if (this._isClosed) {
            return this.error;
        }

        return "";
    }

    protected triggerStats() {
        if (this.statsFn) {
            try {
                this.statsFn( {...this.stats} );
            }
            catch(e) {
                // Do nothing
            }
        }
    }

    /**
     * Pause the write until unpause() or close() is called.
     */
    public pause() {
        if (this.pausedPromise.promise) {
            return;
        }

        this.pausedPromise.promise = new Promise( (resolve) => {
            this.pausedPromise.resolve = resolve;
        });

        this.stats.isPaused = true;

        this.pausedTime = Date.now();

        this.triggerStats();
    }

    public unpause() {
        if (this.pausedPromise.resolve) {
            // If currently paused then resume now
            const pausedResolve = this.pausedPromise.resolve;
            delete this.pausedPromise.resolve;

            this.stats.isPaused = false;

            this.stats.pausedDuration += Date.now() - this.pausedTime;

            this.pausedTime = 0;

            pausedResolve();
        }
    }

    /**
     * Close this writer and the reader.
     */
    public close() {
        if (this._isClosed) {
            return;
        }

        this._isClosed = true;

        this.streamReader.close();

        this.stats.finishTime = Date.now();

        // If paused resume it so run can end its loop
        if (this.pausedPromise.resolve) {
            this.pausedPromise.resolve();
            this.pausedPromise = {};
        }

        this.triggerStats();
    }

    /**
     * Write to the underlaying medium.
     *
     * @param readData the data to write
     * @returns [StreamStatus, error: string, fseek?: number]
     *  StreamStatus is either RESULT, ERROR or UNRECOVERABLE.
     *  If fseek is set that indicates an fseek should be done and that the write must start over.
     */
    protected abstract write(readData: StreamReadData): Promise<[StreamStatus, string, bigint?]>;

    /**
     * Hook event to get notified on data throughput stats.
     */
    public onStats(statsFn: OnStatsFn) {
        this.statsFn = statsFn;
    }

    /**
     * Start writing by streaming data from the read stream and writing to the write stream.
     * Both this StreamWriter and the provided StreamReader will be closed automatically,
     * both on success and on error.
     *
     * @return Promise<StreamWriteData> which resolves upon success and failure.
     *
     * StreamWriteData is:
     * status == RESULT
     *  success
     * stats is set
     *
     * status == NOT_ALLOWED
     *  Reader does not have permissions to the source it self, or the source does not exist.
     * error is set
     *
     * status == NOT_AVAILABLE
     *  data is not availble (at the moment, worth retrying in a while).
     * error is set
     *
     * status == ERROR
     *  any error, see error message for details.
     * error is set
     *
     * status == UNRECOVERABLE
     *  unrecoverable error, see error message for details.
     * error is set
     *
     * @param retryTimeout if set > 0 then retry repeatedly until retryTimeout milliseconds
     * have passed, then return error. Retry is only done when the StreamReader returns
     * NOT_AVAILABLE status. Default is 10000 ms.
     * If set to <0 then retry forever.
     * @param retryDelay how many milliseconds to delay until retrying again. Requires
     * that retryTimeout > 0. Default is 1000 ms. Lowest value allowed is 100.
     * If retryTimeout is < 0 (retry forever) then the retryDelay value will increase over time.
     *
     * @throws if an unexpected EOF stream response status is ever retrieved
     */
    public async run(retryTimeout: number = 10000, retryDelay: number = 1000): Promise<StreamWriteData> {
        retryDelay = Math.max(retryDelay, 100);

        const originalRetryDelay = retryDelay;

        if (this._isClosed) {
            this.error = "StreamWriter is closed";

            return {
                status: StreamStatus.ERROR,
                error: this.error,
            };
        }

        let firstRetryTimestamp = 0;

        while (true) {
            if (this._isClosed) {
                this.error = "StreamWriter closed unexpectedly";

                return({
                    status: StreamStatus.ERROR,
                    stats: this.stats,
                    error: this.error,
                });
            }

            if (retryTimeout < 0) {
                if (firstRetryTimestamp > 0) {
                    const diff = Date.now() - firstRetryTimestamp;
                    // Double the delay for each 10 seconds. But have a maximum 1 hour delay.
                    retryDelay = Math.min(originalRetryDelay * Math.ceil(diff/10000), 3600*1000);
                }
            }

            if (this.pausedPromise.promise) {
                await this.pausedPromise.promise;

                this.pausedPromise = {};

                this.triggerStats();

                continue;
            }

            const readData = await this.streamReader.next();

            if (readData.status === StreamStatus.NOT_AVAILABLE) {
                const ts = Date.now();

                if (firstRetryTimestamp === 0) {
                    firstRetryTimestamp = ts;
                }

                if (ts - firstRetryTimestamp < retryTimeout || retryTimeout < 0) {
                    this.pause();

                    setTimeout( () => this.unpause(), retryDelay);

                    continue;
                }

                // Fall through.
            }

            if (readData.status === StreamStatus.EOF) {
                this.close();

                return({
                    status: StreamStatus.RESULT,
                    error: "",
                    stats: this.stats,
                });
            }
            else if (readData.status === StreamStatus.RESULT) {
                // Fall through to write
            }
            else {
                this.error = readData.error || "Unknown error";

                this.stats.error = true;
                this.close();  // Will also triggerStats

                return({
                    status: readData.status,
                    error: this.error,
                    stats: this.stats,
                    readError: true,
                });
            }

            const [streamStatus, error, fseek] = await this.write(readData);

            if (fseek !== undefined) {
                // an fseek happened, start over.

                this.streamReader.seek(fseek);

                this.stats.resumed = true;

                continue;
            }

            if (streamStatus === StreamStatus.RESULT) {
                // Update stats
                this.stats.size = readData.size;

                this.stats.written += BigInt(readData.data.length);

                this.stats.pos = readData.pos + BigInt(readData.data.length);

                this.stats.duration = Date.now() - this.stats.startTime - this.stats.pausedDuration;

                this.stats.throughput =
                    Math.ceil(1000 * Number(this.stats.written) / Math.max(this.stats.duration, 1));

                this.triggerStats();
            }
            else if (streamStatus === StreamStatus.EOF) {
                // Can't happen.
                throw new Error("Unexpected EOF response.");
            }
            else {
                this.error = error || "Unknown error";

                this.stats.error = true;

                this.close();  // Will also triggerStats

                return({
                    status: streamStatus,
                    error: this.error,
                    stats: this.stats,
                });
            }
        }
    }

    /**
     * Re run the streaming process from start.
     * Can only be called after closed.
     */
    public rerun(retryTimeout: number = 10000, retryDelay: number = 1000):
        Promise<StreamWriteData> {

        this.reinit();

        return this.run(retryTimeout, retryDelay);
    }
}
