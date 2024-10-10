import {
    EventType,
} from "pocket-messaging";

import {
    AbstractStreamWriter,
} from "./AbstractStreamWriter";

import {
    StreamReadData,
    StreamStatus,
    StreamReaderInterface,
} from "./types";

import {
    WriteBlobRequest,
    WriteBlobResponse,
    Status,
    MESSAGE_SPLIT_BYTES,
} from "../types";

import {
    P2PClient,
} from "../p2pclient";

/**
 * Write streaming data into a blob storage.
 */
export class BlobStreamWriter extends AbstractStreamWriter {
    protected nodeId1: Buffer;
    protected peer: P2PClient;
    protected retries: number;
    protected muteMsgIds: Buffer[];

    /**
     * @param nodeId1 the node's ID1 to write blob data for.
     * @param streamReader the reader to consume data from.
     * @param peer the (storage) peer to write data to.
     * @param allowResume if set then see if there already is data written to append.
     * @param muteMsgIds optional list of msg IDs to be muted from triggering when blob has finalized writing (same as StoreRequest).
     */
    constructor(nodeId1: Buffer, streamReader: StreamReaderInterface, peer: P2PClient, allowResume: boolean = true, muteMsgIds?: Buffer[]) {
        super(streamReader, allowResume);
        this.nodeId1 = nodeId1;
        this.peer = peer;
        this.muteMsgIds = muteMsgIds ?? [];
        this.retries = 0;

        // We need to restrict chunk size because sending WriteBlobRequests
        // cannot exceed the maximum messaging envelope size.
        if (streamReader.getChunkSize() > 60 * 1024) {
            streamReader.setChunkSize(60 * 1024);
        }

        if (streamReader.getPos() !== 0n) {
            throw new Error("StreamReader must start at position 0");
        }
    }

    protected async write(readData: StreamReadData): Promise<[StreamStatus, string, bigint?]> {
        const pos = readData.pos;
        const data = readData.data;

        // TODO: add logic too split up and handle larger datasets.
        //
        if (data.length > MESSAGE_SPLIT_BYTES) {
            const error = `BlobStreamWriter fed too large data chunk. Maximum ${MESSAGE_SPLIT_BYTES} KiB chunk size allowed.`;
            return [StreamStatus.UNRECOVERABLE, error];
        }

        const writeBlobRequest: WriteBlobRequest = {
            nodeId1: this.nodeId1,
            pos,
            data,
            sourcePublicKey: this.peer.getLocalPublicKey(),
            targetPublicKey: this.peer.getRemotePublicKey(),
            muteMsgIds: this.muteMsgIds,
        };

        const {getResponse} = this.peer.writeBlob(writeBlobRequest);

        if (!getResponse) {
            // Abort because our Storage is not working
            const error = "Could not send request to storage peer";
            return [StreamStatus.ERROR, error];
        }

        const anyData = await getResponse.onceAny();

        if (anyData.type !== EventType.REPLY || !anyData.response) {
            const error = "Storage peer error";
            return [StreamStatus.ERROR, error];
        }

        const writeBlobResponse: WriteBlobResponse = anyData.response;

        if (writeBlobResponse.status === Status.Mismatch) {
            // The written data's hash did not match.
            // Retry the full writing once from the start.
            if (this.retries++ === 0) {
                // Force to not resume on the next try.
                this.allowResume = false;

                return [StreamStatus.RESULT, "", 0n];
            }
            else {
                const error = "Hash of written data did not match, even after a retry.";

                return [StreamStatus.UNRECOVERABLE, error];
            }
        }
        else if (writeBlobResponse.status === Status.NotAllowed) {
            return [StreamStatus.NOT_ALLOWED, writeBlobResponse.error];
        }
        else if (writeBlobResponse.status === Status.Malformed) {
            return [StreamStatus.UNRECOVERABLE, writeBlobResponse.error];
        }
        else if (![Status.Result, Status.Exists].includes(writeBlobResponse.status as any)) {
            return [StreamStatus.ERROR, writeBlobResponse.error];
        }
        else {
            // Check if to resume upload at a position forward.
            if (this.allowResume) {
                const currentLength = writeBlobResponse.currentLength;

                if (currentLength > pos + BigInt(data.length)) {

                    return [StreamStatus.RESULT, "", currentLength];
                }
            }
        }

        return [StreamStatus.RESULT, ""];
    }
}
