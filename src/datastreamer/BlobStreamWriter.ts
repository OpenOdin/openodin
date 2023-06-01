import {
    EventType,
} from "pocket-messaging";

import {
    AbstractStreamWriter,
} from "./AbstractStreamWriter";

import {
    ReadData,
    StreamReaderInterface,
} from "./types";

import {
    WriteBlobRequest,
    WriteBlobResponse,
    Status,
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
    }

    /**
     * @param readData the data to write.
     * @returns promise which will resolve on success or reject on error.
     * On success a boolean is returned, if false then the write was discarded due to an fseek.
     */
    protected async write(readData: ReadData): Promise<boolean> {
        const pos = readData.pos;
        const data = readData.data;

        const writeBlobRequest: WriteBlobRequest = {
            nodeId1: this.nodeId1,
            pos,
            data,
            clientPublicKey: this.peer.getLocalPublicKey(),
            copyFromId1: Buffer.alloc(0),
            muteMsgIds: this.muteMsgIds,
        };

        const {getResponse} = this.peer.writeBlob(writeBlobRequest);

        if (!getResponse) {
            // Abort because our Storage is not working
            throw new Error("Could not send request to storage peer");
        }

        const anyData = await getResponse.onceAny();

        if (anyData.type !== EventType.REPLY || !anyData.response) {
            throw new Error("Storage peer returned error");
        }

        const writeBlobResponse: WriteBlobResponse = anyData.response;

        if (writeBlobResponse.status === Status.MISMATCH) {
            // The written data's hash did not match.
            // Retry the full writing once from the start.
            if (this.retries++ === 0) {
                this.allowResume = false;
                this.streamReader.seek(0n);
                return false;
            }
            else {
                throw new Error("Hash of written data did not match, even after a retry.");
            }
        }
        else if (![Status.RESULT, Status.EXISTS].includes(writeBlobResponse.status)) {
            throw new Error(`Storage peer returned error in response: ${writeBlobResponse.error}`);
        }
        else {
            // Check if to resume upload at a position forward.
            if (this.allowResume) {
                const currentLength = writeBlobResponse.currentLength;
                if (currentLength > pos + BigInt(data.length)) {
                    this.streamReader.seek(currentLength);
                    return false;
                }
            }
        }

        return true;
    }
}
