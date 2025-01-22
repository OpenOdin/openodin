import {
    P2PClient,
} from "./P2PClient";

import {
    MAX_BATCH_SIZE,
} from "../storage/types";

import {
    SendResponseFn,
} from "./GetResponse";

import {
    P2PClientForwarder,
} from "./P2PClientForwarder";

import {
    LicenseNode,
    LicenseNodeInterface,
    SignCertInterface,
    GetModelType,
} from "../datamodel";

import {
    SignatureOffloaderInterface,
} from "../signatureoffloader/types";

import {
    FetchResponse,
    StoreRequest,
    FetchRequest,
    FetchResult,
    MESSAGE_SPLIT_BYTES,
} from "../types";

import {
    PocketConsole,
} from "pocket-console";

const console = PocketConsole({module: "P2PClientExtender"});

export class P2PClientExtender extends P2PClientForwarder {
    protected signCerts: SignCertInterface[] = [];
    protected signatureOffloader: SignatureOffloaderInterface;
    protected publicKey: Buffer;

    /**
     * @param publicKey The cryptographic public key of the user running the Service.
     * @param signatureOffloader is required to have a default keypair set for signing nodes.
     */
    constructor(senderClient: P2PClient, targetClient: P2PClient, publicKey: Buffer, signCerts: SignCertInterface[], signatureOffloader: SignatureOffloaderInterface, muteMsgIds?: Buffer[]) {
        super(senderClient, targetClient, muteMsgIds);

        this.publicKey = publicKey;
        this.setSignCerts(signCerts);
        this.signatureOffloader = signatureOffloader;
    }

    /**
     * When authorizing using an auth cert we need node certs to sign new nodes as the auth cert issuer public key.
     * @param nodeCert the node certs to have available for signing nodes as the auth cert issuer.
     */
    public setSignCerts(signCerts: SignCertInterface[]) {
        this.signCerts = signCerts.slice();
    }

    protected handleFetchResponse(sendResponse: SendResponseFn<FetchResponse>, targetClient: P2PClient, fetchResponse: FetchResponse, fetchRequest: FetchRequest) {
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
            this.embedNodes(imagesToEmbed, fetchRequest);
        }
        const fetchResponse2: FetchResponse = {
            status: fetchResponse.status,
            error: fetchResponse.error,
            result,
            crdtResult: fetchResponse.crdtResult,
            seq: fetchResponse.seq,
            endSeq: fetchResponse.endSeq,
            rowCount: fetchResponse.rowCount,
        };

        super.handleFetchResponse(sendResponse, targetClient, fetchResponse2, fetchRequest);
    }

    /**
     * Embed nodes towards senderClient and store them to Storage.
     * @param the proposed images to sign
     */
    protected async embedNodes(images: Buffer[], fetchRequest: FetchRequest) {
        const sourcePublicKey = this.targetClient.getLocalPublicKey();
        const targetPublicKey = fetchRequest.query.targetPublicKey;

        if (!targetPublicKey) {
            return;
        }

        const licenseNodes: (LicenseNodeInterface | undefined)[] = images.map( image => {
            try {
                // Note that we do not verify the node at this point since we trust our Storage to have done that.
                if (LicenseNode.Is(GetModelType(image))) {
                    return new LicenseNode(image);
                }

                return undefined;
            }
            catch(e) {
                return undefined;
            }
        });

        const embeddedImages: Buffer[] = [];

        for (let i=0; i<licenseNodes.length; i++) {
            const licenseNode = licenseNodes[i];

            if (!licenseNode) {
                continue;
            }

            try {
                const props = licenseNode.getProps();

                // Terms for a newly extended License node will depend on the terms set on the inner
                // most license object and the height of the license stack.

                // Note that the embeddingNode is what the Database proposes to
                // be signed using our key.
                // If we do not trust the storage we should not have allowEmbed
                // set to anything so that we do not automatically sign embeddings.
                if (!props.embedded) {
                    continue;
                }

                if (!props.owner?.equals(this.publicKey)) {
                    // We need to sign using a cert
                    if (!this.signCerts) {
                        // No certs provided, we can't sign
                        continue;
                    }

                    let signCert;
                    const l = this.signCerts.length;
                    for (let i=0; i<l; i++) {
                        signCert = this.signCerts[i];

                        const validated = licenseNode.matchSignCert(signCert.getProps(),
                            this.publicKey);

                        if (!validated[0]) {
                            signCert = undefined;
                            continue;
                        }

                        break;
                    }

                    if (!signCert) {
                        // No matching cert to sign it,
                        // skip it.
                        continue;
                    }

                    props.signCert = signCert.getProps();

                    licenseNode.pack();
                }

                // We sign the new node, but we do not deep verify the stack of nodes at this point
                // because we trust the storage has already done that.
                await this.signatureOffloader.sign([licenseNode], this.publicKey);

                embeddedImages.push(licenseNode.getPacked());
            }
            catch(e) {
                console.error("Failed embedding license", e);
            }
        }

        const imagesChunks = this.splitImages(embeddedImages);

        // Does not have to be secure random number.
        //
        const batchId = Math.floor(Math.random() * 100_000_000);

        while (imagesChunks.length > 0) {
            const images = imagesChunks.shift();
            if (!images) {
                continue;
            }

            const hasMore = imagesChunks.length > 0;

            const storeRequest: StoreRequest = {
                nodes: images,
                targetPublicKey,
                sourcePublicKey,
                muteMsgIds: [],
                preserveTransient: false,  // No point trying preserving transient values since none have been set on these new nodes.
                batchId,
                hasMore,
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
            while (images.length > 0 && total < MESSAGE_SPLIT_BYTES && chunk.length < MAX_BATCH_SIZE) {
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
