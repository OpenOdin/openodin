export interface StreamReaderInterface {
    next: (chunkSize?: number) => Promise<StreamReadData>;
    seek: (pos: bigint) => void;
    close: () => void;
    isClosed: () => boolean;
    getChunkSize: () => number;
    setChunkSize: (chunkSize: number) => void;
    getPos: () => bigint;
    setAutoClose: (autoClose: boolean) => void;
    reinit: () => void;
}

export interface StreamWriterInterface {
    run: (retryTimeout?: number, retryDelay?: number) => Promise<StreamWriteData>;
    pause: () => void;
    close: () => void;
    onStats: (fn: OnStatsFn) => void;
    isClosed: () => boolean;
    getError: () => string
    reinit: () => void;
}

/**
 * Struct for stream writer stats triggered on specific events when writing.
 */
export type WriteStats = {
    /** Set to true if the streaming got resumed. */
    resumed: boolean,

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

export enum StreamStatus {
    RESULT          = 1,
    EOF             = 2,
    ERROR           = 3,
    NOT_ALLOWED     = 4,
    NOT_AVAILABLE   = 5,
    UNRECOVERABLE   = 6,
}

/**
 * The data struct passed from a stream reader to a stream writer.
 */
export type StreamReadData = {
    status: StreamStatus,

    /** Data bytes read from source. */
    data: Buffer,

    /** Position of where the data starts in the source from where the data bytes where read. */
    pos: bigint,

    /** Total size of source. */
    size: bigint,

    /** Set on errors. */
    error: string,
};

/**
 * Returned on streamWriter.run()
 */
export type StreamWriteData = {
    status: StreamStatus.RESULT | StreamStatus.ERROR | StreamStatus.NOT_ALLOWED | StreamStatus.NOT_AVAILABLE | StreamStatus.UNRECOVERABLE,

    error: string,

    stats?: WriteStats,

    /** If set then the error was reading data, not writing the data. */
    readError?: boolean,
};

export type OnStatsFn = (stats: WriteStats) => void;
