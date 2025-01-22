import {
    SignatureOffloaderInterface,
} from "../signatureoffloader/types";

import {
    DataNode,
    DataNodeInterface,
    DataNodeProps,
    DataNodeFlags,
    SignCertInterface,
    LicenseNode,
    LicenseNodeProps,
    LicenseNodeFlags,
    LicenseNodeInterface,
    CarrierNode,
    CarrierNodeProps,
    CarrierNodeFlags,
    CarrierNodeInterface,
} from "../datamodel";

import {
    CopyBuffer,
} from "./common";

export class NodeUtil {
    /**
     * @param signatureOffloader if provided then signing will be threaded. Must already have been initialized.
     * @param signCerts sign certs to use if needed when signing nodes on behalf of others.
     */
    constructor(protected signatureOffloader?: SignatureOffloaderInterface,
        protected signCerts: SignCertInterface[] = []) {}

    public setSignCerts(signCerts: SignCertInterface[]) {
        this.signCerts = signCerts.slice();
    }

    /**
     * Create new Data node, optionally sign it.
     * Default parentId is set to 00...00
     * Default creationTime is set to Date.now().
     * Note that if using embedded nodes or certs those are expected to already have been verified at this point,
     * to make sure run a verify on the returned node.
     * @param props props and flags to set on the Data Node.
     * @param publicKey signer. Key pair should have been added to SignatureOffloader.
     * @param secretKey if provided then sign directly using this key pair instead of using SignatureOffloader.
     * @returns new data node as DataNodeInterface.
     * @throws on malformed data or if signing fails.
     */
    public async createDataNode(props: DataNodeProps & DataNodeFlags, publicKey?: Buffer, secretKey?: Buffer): Promise<DataNodeInterface> {
        // Set some defaults
        props.creationTime = props.creationTime ?? Date.now();
        if (props.parentId === undefined) {
            props.parentId = Buffer.alloc(32).fill(0);
        }

        const node = new DataNode();

        if (publicKey && !props.owner) {
            props.owner = CopyBuffer(publicKey);
        }

        node.mergeProps(props);

        node.storeFlags(props);

        const props2 = node.getProps();

        if (publicKey) {
            // Check if a signing cert is required.
            if (!props2.owner?.equals(publicKey)) {
                let signCert;
                const l = this.signCerts.length;
                for (let i=0; i<l; i++) {
                    signCert = this.signCerts[i];

                    const validated = node.matchSignCert(signCert.getProps(), publicKey);

                    if (!validated[0]) {
                        signCert = undefined;
                        continue;
                    }

                    break;
                }

                if (!signCert) {
                    throw new Error("Could not find matching data node signing cert.");
                }

                props2.signCert = signCert.getProps();
            }

            node.pack();

            if (secretKey) {
                node.sign({publicKey, secretKey});

                node.pack();
            }
            else if (this.signatureOffloader) {
                await this.signatureOffloader.sign([node], publicKey);
            }
        }

        return node;
    }

    /**
     * Create new Carrier node, optionally sign it.
     * Default parentId is set to 00...00
     * Default creationTime is set to Date.now().
     * Note that if using embedded nodes or certs those are expected to already have been verified at this point,
     * to make sure run a verify on the returned node.
     * @param props props and flags to set on the Carrier Node.
     * @param publicKey signer. Key pair should have been added to SignatureOffloader.
     * @param secretKey if provided then sign directly using this key pair instead of using SignatureOffloader.
     * @returns new Carrier node as CarrierNodeInterface.
     * @throws on malformed data or if signing fails.
     */
    public async createCarrierNode(props: CarrierNodeProps & CarrierNodeFlags, publicKey?: Buffer, secretKey?: Buffer): Promise<CarrierNodeInterface> {
        // Set some defaults
        props.creationTime = props.creationTime ?? Date.now();
        if (props.parentId === undefined) {
            props.parentId = Buffer.alloc(32).fill(0);
        }

        const node = new CarrierNode();

        if (publicKey && !props.owner) {
            props.owner = CopyBuffer(publicKey);
        }

        node.mergeProps(props);

        node.storeFlags(props);

        const props2 = node.getProps();

        if (publicKey) {
            // Check if a signing cert is required.
            if (!props2.owner?.equals(publicKey)) {
                let signCert;
                const l = this.signCerts.length;
                for (let i=0; i<l; i++) {
                    signCert = this.signCerts[i];

                    const validated = node.matchSignCert(signCert.getProps(), publicKey);

                    if (!validated[0]) {
                        signCert = undefined;
                        continue;
                    }

                    break;
                }

                if (!signCert) {
                    throw new Error("Could not find matching carrier node signing cert.");
                }

                props2.signCert = signCert.getProps();
            }

            node.pack();

            if (secretKey) {
                node.sign({publicKey, secretKey});

                node.pack();
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
     * @param props props and flags set on the License Node.
     * @param publicKey signer. Key pair should have been added to SignatureOffloader.
     * @param secretKey if provided then sign directly using this key pair instead of using SignatureOffloader.
     * @returns signed license node interface.
     * @throws on malformed data or if signing fails.
     */
    public async createLicenseNode(props: LicenseNodeProps & LicenseNodeFlags, publicKey?: Buffer, secretKey?: Buffer): Promise<LicenseNodeInterface> {
        // Set some defaults
        props.creationTime = props.creationTime ?? Date.now();
        props.expireTime = props.expireTime ?? props.creationTime + 3600 * 1000;
        if (props.parentId === undefined) {
            props.parentId = Buffer.alloc(32).fill(0);
        }

        const licenseNode = new LicenseNode();

        if (publicKey && !props.owner) {
            props.owner = CopyBuffer(publicKey);
        }

        licenseNode.mergeProps(props);

        licenseNode.storeFlags(props);

        const props2 = licenseNode.getProps();

        if (publicKey) {
            // Check if a signing cert is required.
            if (!props2.owner?.equals(publicKey)) {
                let signCert;
                const l = this.signCerts.length;
                for (let i=0; i<l; i++) {
                    signCert = this.signCerts[i];

                    const validated = licenseNode.matchSignCert(signCert.getProps(), publicKey);

                    if (!validated[0]) {
                        signCert = undefined;
                        continue;
                    }

                    break;
                }

                if (!signCert) {
                    throw new Error("Could not find matching data node signing cert.");
                }

                props2.signCert = signCert.getProps();
            }

            licenseNode.pack();

            if (secretKey) {
                licenseNode.sign({publicKey, secretKey});

                licenseNode.pack();
            }
            else if (this.signatureOffloader) {
                await this.signatureOffloader.sign([licenseNode], publicKey);
            }
        }

        return licenseNode;
    }
}
