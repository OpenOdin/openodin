export interface StreamReaderInterface {
    next: (chunkSize?: number) => Promise<ReadData | undefined>;
    seek: (pos: bigint) => void;
    close: () => void;
}

export interface StreamWriterInterface {
    run: () => Promise<void>;
    pause: () => void;
    close: () => void;
    onStats: (fn: OnStatsFn) => void;
}

/**
 * Struct for stream writer stats triggered on specific events when writing.
 */
export type WriteStats = {
    /** Bytes written so far. */
    written: bigint,

    /** Current position of the read source (after last write). */
    pos: bigint,

    /** Total size of source (unrelated to start position). */
    size: bigint,

    /** Average bytes per second. Only counted for when running and not paused. */
    throughput: number,

    /** set if currently paused. */
    isPaused: boolean,

    /** set to true if ending with error. */
    error: boolean,

    /** Timestamp of when the the streaming started, UNIX time ms. */
    startTime: number,

    /** For how many milliseconds have we been streaming (not counting paused time). */
    duration: number,

    /** For how many ms have the streaming been set to pause. */
    pausedDuration: number,

    /** When did we successfully finish streaming, UNIX time ms. */
    finishTime?: number,
};

/**
 * The data struct passed from a stream reader to a stream writer.
 */
export type ReadData = {
    /** Data bytes read from source. */
    data: Buffer,

    /** Position of where the data starts in the source from where the data bytes where read. */
    pos: bigint,

    /** Total size of source. */
    size: bigint,
};

export type OnStatsFn = (stats: WriteStats) => void;
