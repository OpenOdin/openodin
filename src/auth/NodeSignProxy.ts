import {
    APIRequest,
} from "./types";

import {
    SignatureOffloaderInterface,
} from "../signatureoffloader/types";

import {
    UnpackNode,
} from "../datamodel";

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

                const node = UnpackNode(nodeBin, true);

                const props = node.getProps();

                if (!props.owner) {
                    props.owner = this.signerPublicKey;
                }

                if (node.canKeySign(this.signerPublicKey) >= 0) {
                    await this.signatureOffloader.sign([node], this.signerPublicKey);

                    nodes[i] = node.pack(true);
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
