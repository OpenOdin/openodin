import {
    APIRequest,
} from "./types";

import {
    SignatureOffloaderInterface,
} from "../signatureoffloader/types";

import {
    Decoder,
} from "../decoder/Decoder";

export class NodeSignProxy {
    constructor(protected signerPublicKey: Buffer,
        protected signatureOffloader: SignatureOffloaderInterface) {}

    /**
     * Attempt to sign any unsigned nodes.
     *
     */
    public async signMissing(apiRequest: APIRequest) {
        const nodes = (apiRequest.data as any).nodes;

        if (!nodes) {
            return;
        }

        const nodesLength = nodes.length;
        for (let i=0; i<nodesLength; i++) {
            try {
                const nodeBin = nodes[i];

                const node = Decoder.DecodeNode(nodeBin, true);

                if (!node.getOwner()) {
                    node.setOwner(this.signerPublicKey);
                }

                if (node.getEligibleSigningPublicKeys().length > node.getSignatures().length) {
                    const keys = node.getEligibleSigningPublicKeys(true);

                    if (keys.findIndex( key => key.equals(this.signerPublicKey) ) > -1) {
                        await this.signatureOffloader.sign([node], this.signerPublicKey);

                        nodes[i] = node.export(true);
                    }
                }
            }
            catch(e) {
                // Do nothing
            }
        }
    }

    public close() {
        this.signatureOffloader.close();
    }
}
