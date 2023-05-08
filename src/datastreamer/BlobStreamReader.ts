import {
    EventType,
} from "pocket-messaging";

import {
    AbstractStreamReader,
} from "./AbstractStreamReader";

import {
    ReadBlobRequest,
    ReadBlobResponse,
    Status,
} from "../types";

import {
    P2PClient,
    AnyData,
} from "../p2pclient";

import {
    PocketConsole,
} from "pocket-console";

const console = PocketConsole({module: "BlobStreamReader"});

enum ReadError  {
    NONE = 0,
    PEER_ERROR = 1,
    UNRECOVERABLE = 2,
}

export class BlobStreamReader extends AbstractStreamReader {
    protected nodeId1: Buffer;
    protected peers: P2PClient[];
    protected peer?: P2PClient;

    /** Maximum chunk of bytes to read from storage in each sequence. */
    protected chunkSize: number;

    constructor(nodeId1: Buffer, peers: P2PClient[], pos: bigint = 0n, chunkSize: number = 1024 * 1024) {
        super(pos);
        this.nodeId1 = nodeId1;
        this.peers = peers.slice();  // Copy array since we will be modding it.
        this.peer = this.peers.shift();
        this.chunkSize = chunkSize;

        if (chunkSize <= 0) {
            throw new Error("chunkSize must be > 0");
        }
    }

    /**
     * Attempts to read more data into the buffer.
     * Will try next peer in list if current one fails.
     *
     * @throws on unrecoverable error
     */
    protected async read(): Promise<void> {
        if (this.isClosed) {
            throw new Error("Reader is closed");
        }

        return new Promise<void>( async (resolve, reject) => {
            let lastError: string | undefined;
            while (true) {
                if (!this.peer) {
                    reject("All peers to read blob from are offline");
                    return;
                }
                try {
                    await this.readBlobFromPeer(this.peer);
                    resolve();
                    return;
                }
                catch(e) {
                    const error = e as {message: string, error: ReadError};
                    lastError = error.message;
                    if (error.error === ReadError.UNRECOVERABLE) {
                        // Unrecoverable
                        reject(`Unrecoverable error reading blob: ${lastError}`);
                        return;
                    }

                    // Try next peer
                    this.peer = this.peers.shift();
                    if (!this.peer) {
                        reject(lastError);
                        return;
                    }

                    // Fall through
                }
            }
        });
    }

    protected readBlobFromPeer(peer: P2PClient): Promise<void> {
        return new Promise<void>( (resolve, reject) => {
            const readBlobRequest: ReadBlobRequest = {
                nodeId1: this.nodeId1,
                pos: this.pos,
                length: this.chunkSize,
                clientPublicKey: peer.getLocalPublicKey(),
                targetPublicKey: peer.getLocalPublicKey(),
            };

            const {getResponse} = peer.readBlob(readBlobRequest);

            if (!getResponse) {
                // Try next peer

                reject({error: ReadError.PEER_ERROR, message: "Other error"});

                return;
            }

            getResponse.onReply((peer: P2PClient, readBlobResponse: ReadBlobResponse) => {
                if (readBlobResponse.status === Status.RESULT) {
                    const data = readBlobResponse.data;
                    const blobLength = readBlobResponse.blobLength;

                    this.buffered.push({data, pos: this.pos, size: blobLength});

                    this.pos = this.pos + BigInt(data.length);

                    if (readBlobResponse.seq === readBlobResponse.endSeq) {
                        // Sequence done

                        // We need to send a final notice.
                        this.buffered.push({data: Buffer.alloc(0), pos: this.pos, size: blobLength});

                        resolve();
                    }
                }
                else if (readBlobResponse.status === Status.ERROR) {
                    // Try next peer
                    console.debug("Could not read blob from peer:", readBlobResponse);
                    reject({error: ReadError.PEER_ERROR, message: readBlobResponse.error});
                }
                else if (readBlobResponse.status === Status.FETCH_FAILED || readBlobResponse.status === Status.NOT_ALLOWED) {
                    // Try next peer
                    console.debug("Could not read blob from peer:", readBlobResponse);
                    reject({error: ReadError.PEER_ERROR, message: readBlobResponse.error});
                }
                else {
                    // Unrecoverable error
                    console.debug("Could not read blob from peer:", readBlobResponse);
                    reject({error: ReadError.UNRECOVERABLE, message: readBlobResponse.error});
                }
            });

            getResponse.onAny( (anyData: AnyData<ReadBlobResponse>) => {
                if (anyData.type === EventType.REPLY) {
                    // Handled separately above
                    return;
                }

                // Socket error, close, message timeout. Try next peer
                console.debug(`Could not read blob from peer, event type = ${anyData.type}`);

                reject({error: ReadError.PEER_ERROR, message: "Other error"});
            });
        });
    }
}
