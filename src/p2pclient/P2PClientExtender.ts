import {
    ExpectingReply,
} from "pocket-messaging";

import {
    P2PClient,
} from "./P2PClient";

import {
    SendResponseFn,
} from "./GetResponse";

import {
    P2PClientForwarder,
} from "./P2PClientForwarder";

import {
    NodeInterface,
    KeyPair,
    PrimaryNodeCertInterface,
    SignatureOffloaderInterface,
    Decoder,
    License,
} from "../datamodel";

import {
    FetchResponse,
    StoreRequest,
    ReadBlobRequest,
    ReadBlobResponse,
    FetchRequest,
    FetchResult,
    MESSAGE_SPLIT_BYTES,
} from "../types";

import {
    PocketConsole,
} from "pocket-console";

const console = PocketConsole({module: "P2PClientExtender"});

export class P2PClientExtender extends P2PClientForwarder {
    protected nodeCerts: PrimaryNodeCertInterface[];
    protected signatureOffloader: SignatureOffloaderInterface;
    protected publicKey: Buffer;

    /**
     * @param signatureOffloader is required to have a default keypair set for signing nodes.
     */
    constructor(senderClient: P2PClient, targetClient: P2PClient, publicKey: Buffer, nodeCerts: PrimaryNodeCertInterface[], signatureOffloader: SignatureOffloaderInterface, muteMsgIds?: Buffer[]) {
        super(senderClient, targetClient, muteMsgIds);

        this.publicKey = publicKey;
        this.nodeCerts = [];
        this.setNodeCerts(nodeCerts);
        this.signatureOffloader = signatureOffloader;
    }

    /**
     * When authorizing using an auth cert we need node certs to sign new nodes as the auth cert issuer public key.
     * @param nodeCert the node certs to have available for signing nodes as the auth cert issuer.
     */
    public setNodeCerts(nodeCerts: PrimaryNodeCertInterface[]) {
        this.nodeCerts = nodeCerts.slice();
    }

    protected handleFetch(senderClient: P2PClient, fetchRequest: FetchRequest, fromMsgId: Buffer, expectingReply: ExpectingReply, sendResponse?: SendResponseFn<FetchResponse>)  {
        fetchRequest.query.clientPublicKey = senderClient.getLocalPublicKey();
        fetchRequest.query.targetPublicKey = senderClient.getRemotePublicKey();

        super.handleFetch(senderClient, fetchRequest, fromMsgId, expectingReply, sendResponse);
    }

    protected handleFetchResponse(sendResponse: SendResponseFn<FetchResponse>, targetClient: P2PClient, fetchResponse: FetchResponse) {
        // Data incoming from storage
        // Transform and send to peer
        // If transient values were requested they are passed along here
        const imagesToEmbed: Buffer[] = fetchResponse.result.embed;
        const result: FetchResult = {
            ...fetchResponse.result,
            embed: [],
        };
        if (imagesToEmbed.length > 0) {
            // Extend licenses towards peerPublicKey, store them to Storage.
            // This will trigger a subscription so related nodes will be sent out subsequently.
            this.embedNodes(imagesToEmbed);
        }
        const fetchResponse2: FetchResponse = {
            status: fetchResponse.status,
            error: fetchResponse.error,
            result,
            transformResult: fetchResponse.transformResult,
            seq: fetchResponse.seq,
            endSeq: fetchResponse.endSeq,
            rowCount: fetchResponse.rowCount,
        };

        super.handleFetchResponse(sendResponse, targetClient, fetchResponse2);
    }

    protected handleReadBlob(senderClient: P2PClient, readBlobRequest: ReadBlobRequest, fromMsgId: Buffer, expectingReply: ExpectingReply, sendResponse?: SendResponseFn<ReadBlobResponse>) {
        readBlobRequest.clientPublicKey = senderClient.getLocalPublicKey();
        readBlobRequest.targetPublicKey = senderClient.getRemotePublicKey();

        super.handleReadBlob(senderClient, readBlobRequest, fromMsgId, expectingReply, sendResponse);
    }

    /**
     * Embed nodes towards senderClient and store them to Storage.
     * @param the proposed images to sign
     */
    protected async embedNodes(images: Buffer[]) {
        const targetPublicKey = this.senderClient.getRemotePublicKey();
        const clientPublicKey = this.senderClient.getLocalPublicKey();
        if (!targetPublicKey || !clientPublicKey) {
            return;
        }

        const nodes: (NodeInterface | undefined)[] = images.map( image => {
            try {
                // Note that we do not verify the node at this point since we trust our Storage to have done that.
                return Decoder.DecodeNode(image);
            }
            catch(e) {
                return undefined;
            }
        });

        const embeddedImages: Buffer[] = [];

        for (let i=0; i<nodes.length; i++) {
            const embeddingNode = nodes[i];
            if (!embeddingNode) {
                continue;
            }

            try {
                // Terms for a newly extended License node will depend on the terms set on the inner
                // most license object and the height of the license stack.

                // Note that the embeddingNode is what the Database proposes to be signed using our key.
                // If we do not trust the storage we should not have allowEmbed set to anything so that
                // we do not automatically sign embeddings.
                if (!embeddingNode.hasEmbedded()) {
                    continue;
                }

                if (!embeddingNode.getType(4).equals(License.GetType(4))) {
                    continue;
                }

                if (!clientPublicKey.equals(this.publicKey) && embeddingNode.getOwner()?.equals(clientPublicKey)) {
                    // We need to sign using a cert
                    if (!this.nodeCerts) {
                        // No certs provided, we can't sign
                        continue;
                    }
                    const cert = Decoder.MatchNodeCert(embeddingNode, this.publicKey, this.nodeCerts);
                    if (!cert) {
                        // No matching cert to sign it
                        continue;
                    }

                    embeddingNode.setCertObject(cert);
                }

                // We sign the new node, but we do not deep verify the stack of nodes at this point
                // because we trust the storage has already done that.
                await this.signatureOffloader.sign([embeddingNode], this.publicKey);

                const image = embeddingNode.export();

                if (image) {
                    embeddedImages.push(image);
                }
            }
            catch(e) {
                console.error("Failed embedding license", e);
            }
        }

        const imagesChunks = this.splitImages(embeddedImages);

        while (imagesChunks.length > 0) {
            const images = imagesChunks.shift();
            if (!images) {
                continue;
            }

            const storeRequest: StoreRequest = {
                nodes: images,
                clientPublicKey,
                targetPublicKey,
                sourcePublicKey: clientPublicKey,
                muteMsgIds: [],
                preserveTransient: false,  // No point trying preserving transient values since none have been set on these new nodes.
            };

            const {getResponse} = this.targetClient.store(storeRequest);

            if (!getResponse) {
                // Error has already been logged in P2PClient.store().
                continue;
            }

            await getResponse.onceAny();
        }
    }

    protected splitImages(images: Buffer[]): (Buffer[])[] {
        const chunks: (Buffer[])[] = [];
        while (images.length > 0) {
            let total = 0;
            const chunk: Buffer[] = [];
            while (images.length > 0 && total < MESSAGE_SPLIT_BYTES) {
                const image = images[0];
                if (total + image.length > MESSAGE_SPLIT_BYTES) {
                    break;
                }
                total = total + image.length;
                images.shift();
                chunk.push(image);
            }
            chunks.push(chunk);
        }

        return chunks;
    }
}
