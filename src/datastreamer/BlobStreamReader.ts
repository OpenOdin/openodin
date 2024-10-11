import { strict as assert } from "assert";

import {
    EventType,
} from "pocket-messaging";

import {
    AbstractStreamReader,
} from "./AbstractStreamReader";

import {
    StreamStatus,
} from "./types";

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


export class BlobStreamReader extends AbstractStreamReader {
    protected nodeId1: Buffer;

    protected peers: P2PClient[];

    protected expectedLength: bigint;

    constructor(nodeId1: Buffer, peers: P2PClient[], expectedLength: bigint = -1n, pos: bigint = 0n, chunkSize: number = 1024 * 1024) {
        if (peers.length < 1) {
            throw new Error("At least one peer must be provided in constructor");
        }

        super(pos, chunkSize);

        this.nodeId1 = nodeId1;
        this.expectedLength = expectedLength;

        this.peers = peers.slice();
    }

    protected async read(chunkSize?: number): Promise<boolean> {
        const peers = this.peers.slice();

        let peer = peers.shift();

        let lastError = "";

        const savedErrors: [StreamStatus, string][] = [];

        while (true) {
            assert(peer);

            const [readBlobStatus, error] = await this.readBlobFromPeer(peer, chunkSize);

            if (readBlobStatus === StreamStatus.RESULT) {
                return true;
            }
            else if (readBlobStatus === StreamStatus.EOF) {
                return false;
            }
            else if (readBlobStatus === StreamStatus.ERROR) {
                lastError = error;
                // Fall through to try next peer.
            }
            else if (readBlobStatus === StreamStatus.NOT_ALLOWED) {
                // The second most interesting error
                savedErrors.push([readBlobStatus, error]);

                // Fall through to try next peer.
            }
            else if (readBlobStatus === StreamStatus.NOT_AVAILABLE) {
                // The most interesting error
                savedErrors.unshift([readBlobStatus, error]);

                // Fall through to try next peer.
            }
            else {
                // Unrecoverable
                this.buffered.push({
                    status: StreamStatus.UNRECOVERABLE,
                    error,
                    data: Buffer.alloc(0),
                    pos: 0n,
                    size: 0n,
                });

                return false;
            }

            // Try next peer, if any.
            //
            peer = peers.shift();

            if (!peer) {
                // Return the most useful error message from all peers
                let [readBlobStatus, error] = savedErrors.shift() ?? [];

                if (readBlobStatus === undefined || error === undefined) {
                    readBlobStatus = StreamStatus.ERROR;
                    error = lastError;
                }

                this.buffered.push({
                    status: readBlobStatus,
                    error,
                    data: Buffer.alloc(0),
                    pos: 0n,
                    size: 0n,
                });

                return false;
            }
        }
    }

    protected readBlobFromPeer(peer: P2PClient, chunkSize?: number): Promise<[StreamStatus, string]> {
        return new Promise<[StreamStatus, string]>( (resolve) => {
            chunkSize = chunkSize ?? this.chunkSize;

            if (chunkSize < 1) {
                resolve([StreamStatus.UNRECOVERABLE, "Bad chunkSize provided"]);
            }

            const readBlobRequest: ReadBlobRequest = {
                nodeId1: this.nodeId1,
                pos: this.pos,
                length: chunkSize,
                targetPublicKey: peer.getLocalPublicKey(),
                sourcePublicKey: peer.getRemotePublicKey(),
            };

            const {getResponse} = peer.readBlob(readBlobRequest);

            if (!getResponse) {
                // Try next peer

                resolve([StreamStatus.ERROR, ""]);
                return;
            }

            getResponse.onReply((readBlobResponse: ReadBlobResponse) => {
                if (readBlobResponse.status === Status.Result) {
                    const data = readBlobResponse.data;
                    const blobLength = readBlobResponse.blobLength;

                    if (this.expectedLength > -1) {
                        if (this.expectedLength !== blobLength) {
                            // Unrecoverable error
                            //
                            console.debug("Mismatch in blob length expected", readBlobResponse);
                            resolve([StreamStatus.UNRECOVERABLE, "Mismatch in blob length expected"]);
                            return;
                        }
                    }

                    this.buffered.push({
                        status: StreamStatus.RESULT,
                        data,
                        pos: this.pos,
                        size: blobLength,
                        error: "",
                    });

                    this.pos = this.pos + BigInt(data.length);

                    if (this.pos > blobLength) {
                        // Unrecoverable error
                        //
                        console.debug("Overflow of blob length", readBlobResponse);
                        resolve([StreamStatus.UNRECOVERABLE, "Overflow of blob length"]);
                        return;
                    }

                    if (readBlobResponse.seq === readBlobResponse.endSeq) {
                        // Sequence done

                        if (this.pos === blobLength) {
                            this.buffered.push({
                                status: StreamStatus.EOF,
                                data: Buffer.alloc(0),
                                pos: this.pos,
                                size: blobLength,
                                error: "",
                            });

                            resolve([StreamStatus.EOF, ""]);
                        }
                        else {
                            resolve([StreamStatus.RESULT, ""]);
                        }
                    }
                }
                else if (readBlobResponse.status === Status.Error) {
                    // Try next peer
                    console.debug("Could not read blob from peer:", readBlobResponse);
                    resolve([StreamStatus.ERROR, readBlobResponse.error]);
                }
                else if (readBlobResponse.status === Status.NotAllowed) {
                    // Try next peer
                    console.debug("Could not read blob from peer:", readBlobResponse);
                    resolve([StreamStatus.NOT_ALLOWED, readBlobResponse.error]);
                }
                else if (readBlobResponse.status === Status.FetchFailed) {
                    // Try next peer
                    // Do not output debug message here since it might spam.
                    resolve([StreamStatus.NOT_AVAILABLE, readBlobResponse.error]);
                }
                else {
                    // Unrecoverable error
                    console.debug("Could not read blob from peer:", readBlobResponse);
                    resolve([StreamStatus.UNRECOVERABLE, readBlobResponse.error]);
                }
            });

            getResponse.onAny( (anyData: AnyData<ReadBlobResponse>) => {
                if (anyData.type === EventType.REPLY) {
                    // Handled separately above
                    return;
                }

                // Socket error, close, message timeout. Try next peer
                console.debug(`Could not read blob from peer, event type = ${anyData.type}`);

                resolve([StreamStatus.ERROR, "Other error"]);
            });
        });
    }
}
