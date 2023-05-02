import {
    Decoder,
    SignatureOffloader,
} from "../datamodel/decoder";

import {
    Data,
    License,
    DataInterface,
    LicenseInterface,
    PrimaryNodeCertInterface,
    KeyPair,
    DataCertInterface,
    LicenseCertInterface,
    DataParams,
    LicenseParams,
    PRIMARY_INTERFACE_NODE_ID,
} from "../datamodel";

export class NodeUtil {
    protected signatureOffloader?: SignatureOffloader;

    /**
     * @param signatureOffloader if provided then signing will be threaded. Must already have been initialized.
     */
    constructor(signatureOffloader?: SignatureOffloader) {
        this.signatureOffloader = signatureOffloader;
    }

    /**
    * Check in the image header data if it looks like a node.
    * @param image the node image
    * @returns true if the image header is recognized as being of primary interface node.
    */
    public static IsNode(image: Buffer): boolean {
        const nodePrimaryInterface = Buffer.from([0, PRIMARY_INTERFACE_NODE_ID]);
        if (image.slice(0, 2).equals(nodePrimaryInterface)) {
            return true;
        }

        return false;
    }

    /**
     * Create new Data node, optionally sign it.
     * Default parentId is set to 00...00
     * Default creationTime is set to Date.now().
     * Note that if using embedded nodes or certs those are expected to already have been verified at this point,
     * to make sure run a verify on the returned node.
     * @param params object of data attributes to set on the Data Node.
     * @param keyPair if provided then sign using this key pair.
     * @returns new data node as DataInterface.
     * @throws on malformed data or if signing fails.
     */
    public async createDataNode(params: DataParams, keyPair?: KeyPair, nodeCerts?: PrimaryNodeCertInterface[]): Promise<DataInterface> {
        // Set some defaults
        params.creationTime = params.creationTime ?? Date.now();
        if (params.parentId === undefined) {
            params.parentId = Buffer.alloc(32).fill(0);
        }

        const node = new Data();

        if (!params.owner && keyPair) {
            params.owner = keyPair.publicKey;
        }

        node.setParams(params);

        // Check if a signing cert is required.
        if (keyPair && !params.owner?.equals(keyPair.publicKey)) {
            if (!nodeCerts) {
                throw new Error("Missing node certs.");
            }
            const nodeCert = Decoder.MatchNodeCert(node, keyPair.publicKey, nodeCerts);
            if (!nodeCert) {
                throw new Error("Could not find matching data node signing cert.");
            }
            node.setCertObject(nodeCert as DataCertInterface);
        }

        if (keyPair) {
            if (this.signatureOffloader) {
                await this.signatureOffloader.sign([node], keyPair);
            }
            else {
                node.sign(keyPair);
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
     * @param keyPair if provided then sign using this key pair.
     * @returns signed license node interface.
     * @throws on malformed data of if signing fails.
     */
    public async createLicenseNode(params: LicenseParams, keyPair?: KeyPair, nodeCerts?: PrimaryNodeCertInterface[]): Promise<LicenseInterface> {
        // Set some defaults
        params.creationTime = params.creationTime ?? Date.now();
        params.expireTime = params.expireTime ?? params.creationTime + 3600 * 1000;
        if (params.parentId === undefined) {
            params.parentId = Buffer.alloc(32).fill(0);
        }

        const license = new License();

        if (!params.owner && keyPair) {
            params.owner = keyPair.publicKey;
        }

        license.setParams(params);

        // Check if a signing cert is required.
        if (keyPair && !params.owner?.equals(keyPair.publicKey)) {
            if (!nodeCerts) {
                throw new Error("Missing node certs");
            }
            const nodeCert = Decoder.MatchNodeCert(license, keyPair.publicKey, nodeCerts);
            if (!nodeCert) {
                throw new Error("Could not find matching license node signing cert");
            }
            license.setCertObject(nodeCert as LicenseCertInterface);
        }

        if (keyPair) {
            if (this.signatureOffloader) {
                await this.signatureOffloader.sign([license], keyPair);
            }
            else {
                license.sign(keyPair);
            }
        }

        return license;
    }
}
