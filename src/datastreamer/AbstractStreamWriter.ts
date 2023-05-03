import {
    StreamReaderInterface,
    StreamWriterInterface,
    WriteStats,
    ReadData,
    OnStatsFn,
} from "./types";

/**
 * The writer reads from a read stream and writes to its target.
 */
export abstract class AbstractStreamWriter implements StreamWriterInterface {
    protected streamReader: StreamReaderInterface;
    protected allowResume: boolean;
    protected runPromise: {promise?: Promise<void>, resolve?: (...args: any) => void, reject?: (...args: any) => void};
    protected pausedPromise: {promise?: Promise<void>, resolve?: (...args: any) => void, reject?: (...args: any) => void};
    protected isClosed: boolean;
    protected stats: WriteStats;
    protected statsFn?: OnStatsFn;
    protected pausedTime: number;

    /**
     * @param streamReader the reader to consume data on
     * @param allowResume if set to true then detect if target has unfinished write and seek the reader forward.
     *
     */
    constructor(streamReader: StreamReaderInterface, allowResume: boolean) {
        this.streamReader = streamReader;
        this.allowResume = allowResume;
        this.pausedPromise = {};
        this.runPromise = {};
        this.isClosed = false;
        this.pausedTime = 0;
        this.stats = {
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
     * Pause the write until run() is called again.
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

    /**
     * Close this writer and the reader.
     */
    public close() {
        if (this.isClosed) {
            return;
        }

        this.isClosed = true;

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
     * @param readData the data to write
     * @throws
     */
    protected abstract write(readData: ReadData): Promise<boolean>;

    /**
     * Hook event to get notified on data throughput stats.
     */
    public onStats(statsFn: OnStatsFn) {
        this.statsFn = statsFn;
    }

    /**
     * Start writing by streaming data from the read stream and writing to the write stream.
     * @return Promise which resolves upon success or rejects upon failure.
     * @throws object of {errorOnRead: boolean, message: string} on error.
     */
    public async run(): Promise<void> {
        if (this.isClosed) {
            return Promise.reject({errorOnRead: false, message: "Writer is closed"});
        }

        if (this.runPromise.promise) {
            if (this.pausedPromise.resolve) {
                // If currently paused then resume now
                const pausedResolve = this.pausedPromise.resolve;
                delete this.pausedPromise.resolve;

                pausedResolve();

                this.stats.isPaused = false;
                this.stats.pausedDuration += Date.now() - this.pausedTime;
                this.triggerStats();
            }

            return this.runPromise.promise;
        }

        this.runPromise.promise = new Promise<void>( async (resolve, reject) => {  // eslint-disable-line no-async-promise-executor
            this.runPromise.resolve = resolve;
            this.runPromise.reject = reject;

            while (!this.isClosed) {
                if (this.pausedPromise.resolve) {
                    await this.pausedPromise.promise;
                    this.pausedPromise = {};
                    continue;
                }

                let readData: ReadData | undefined;

                try {
                    readData = await this.streamReader.next();  // Throws on error

                    if (!readData) {
                        // Reached EOL, but unexpectedly (which should not happen).
                        this.close();  // Will also triggerStats
                        reject({errorOnRead: true, message: "Stream reader reached EOL prematurely"});
                        return;
                    }
                }
                catch(e) {
                    this.stats.error = true;
                    this.close();  // Will also triggerStats
                    reject({errorOnRead: true, message: `${e}`});
                    return;
                }

                try {
                    if (!(await this.write(readData))) {
                        continue;
                    }
                }
                catch(e) {
                    this.stats.error = true;
                    this.close();  // Will also triggerStats
                    reject({errorOnRead: false, message: `${e}`});
                    return;
                }

                // Update stats
                this.stats.size = readData.size;
                this.stats.written += BigInt(readData.data.length);
                this.stats.pos = readData.pos + BigInt(readData.data.length);
                this.stats.duration = Date.now() - this.stats.startTime - this.stats.pausedDuration;
                this.stats.throughput = Math.ceil(1000 * Number(this.stats.written) / Math.max(this.stats.duration, 1));

                // Check if done.
                if (readData.pos >= readData.size) {
                    this.close();  // Will also triggerStats
                    resolve();
                    return;
                }

                this.triggerStats();
            }

            this.stats.error = true;
            this.triggerStats();

            reject({errorOnRead: false, message: "Closed while streaming"});
        });

        return this.runPromise.promise;
    }
}
