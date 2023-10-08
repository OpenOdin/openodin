import {
    AbstractStreamWriter,
} from "./AbstractStreamWriter";

import {
    StreamReadData,
    StreamStatus,
    StreamReaderInterface,
} from "./types";

/**
 * This is a sink for exhausting a StreamReader.
 *
 * Read data from streamer and place into array of buffers.
 */
export class BufferStreamWriter extends AbstractStreamWriter {
    protected buffers: Buffer[] = [];

    /**
     * @param streamReader the reader to consume.
     */
    constructor(streamReader: StreamReaderInterface) {
        super(streamReader, false);
    }

    public getBuffers(): Buffer[] {
        return this.buffers;
    }

    /**
     * Close the file descriptor.
     */
    public close() {
        super.close();
    }

    protected async write(readData: StreamReadData): Promise<[StreamStatus, string, bigint?]> {
        this.buffers.push(readData.data);

        return [StreamStatus.RESULT, ""];
    }
}
