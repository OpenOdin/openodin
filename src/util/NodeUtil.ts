import {
    Decoder,
} from "../decoder/Decoder";

import {
    SignatureOffloaderInterface,
} from "../signatureoffloader/types";

import {
    Data,
    License,
    DataInterface,
    LicenseInterface,
    PrimaryNodeCertInterface,
    DataCertInterface,
    LicenseCertInterface,
    DataParams,
    LicenseParams,
} from "../datamodel";

import {
    CopyBuffer,
} from "./common";

export class NodeUtil {
    /**
     * @param signatureOffloader if provided then signing will be threaded. Must already have been initialized.
     * @param nodeCerts sign certs to use if needed when signing nodes on behalf of others.
     */
    constructor(protected signatureOffloader?: SignatureOffloaderInterface,
        protected nodeCerts: PrimaryNodeCertInterface[] = []) {}

    public setNodeCerts(nodeCerts: PrimaryNodeCertInterface[]) {
        this.nodeCerts = nodeCerts.slice();
    }

    /**
     * Create new Data node, optionally sign it.
     * Default parentId is set to 00...00
     * Default creationTime is set to Date.now().
     * Note that if using embedded nodes or certs those are expected to already have been verified at this point,
     * to make sure run a verify on the returned node.
     * @param params object of data attributes to set on the Data Node.
     * @param publicKey signer. Key pair should have been added to SignatureOffloader.
     * @param secretKey if provided then sign directly using this key pair instead of using SignatureOffloader.
     * @returns new data node as DataInterface.
     * @throws on malformed data or if signing fails.
     */
    public async createDataNode(params: DataParams, publicKey?: Buffer, secretKey?: Buffer): Promise<DataInterface> {
        // Set some defaults
        params.creationTime = params.creationTime ?? Date.now();
        if (params.parentId === undefined) {
            params.parentId = Buffer.alloc(32).fill(0);
        }

        const node = new Data();

        if (publicKey && !params.owner) {
            params.owner = CopyBuffer(publicKey);
        }

        node.setParams(params);

        if (publicKey) {
            // Check if a signing cert is required.
            if (!params.owner?.equals(publicKey)) {
                const nodeCert = Decoder.MatchNodeCert(node, publicKey, this.nodeCerts);

                if (!nodeCert) {
                    throw new Error("Could not find matching data node signing cert.");
                }

                node.setCertObject(nodeCert as DataCertInterface);
            }

            if (secretKey) {
                node.sign({publicKey, secretKey});
            }
            else if (this.signatureOffloader) {
                await this.signatureOffloader.sign([node], publicKey);
            }
        }

        return node;
    }

    /**
     * Create new License node, optionally sign it.
     * Default parentId is set to 00...00
     * Default creationTime is set to Date.now().
     * Default expireTime is set to creationTime + 1 hour.
     * Note that if using embedded nodes or certs those are expected to have been verified at this point,
     * to make sure run a verify on the returned node.
     * @param params object of data attributes to set on the License Node.
     * @param publicKey signer. Key pair should have been added to SignatureOffloader.
     * @param secretKey if provided then sign directly using this key pair instead of using SignatureOffloader.
     * @returns signed license node interface.
     * @throws on malformed data or if signing fails.
     */
    public async createLicenseNode(params: LicenseParams, publicKey?: Buffer, secretKey?: Buffer): Promise<LicenseInterface> {
        // Set some defaults
        params.creationTime = params.creationTime ?? Date.now();
        params.expireTime = params.expireTime ?? params.creationTime + 3600 * 1000;
        if (params.parentId === undefined) {
            params.parentId = Buffer.alloc(32).fill(0);
        }

        const license = new License();

        if (publicKey && !params.owner) {
            params.owner = CopyBuffer(publicKey);
        }

        license.setParams(params);

        if (publicKey) {
            // Check if a signing cert is required.
            if (!params.owner?.equals(publicKey)) {
                const nodeCert = Decoder.MatchNodeCert(license, publicKey, this.nodeCerts);

                if (!nodeCert) {
                    throw new Error("Could not find matching license node signing cert");
                }

                license.setCertObject(nodeCert as LicenseCertInterface);
            }

            if (secretKey) {
                license.sign({publicKey, secretKey});
            }
            else if (this.signatureOffloader) {
                await this.signatureOffloader.sign([license], publicKey);
            }
        }

        return license;
    }
}
