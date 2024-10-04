import {
    Data,
} from "../datamodel/node/secondary/data/Data";

import {
    License,
} from "../datamodel/node/secondary/license/License";

import {
    NodeInterface,
    PRIMARY_INTERFACE_NODE_ID,
} from "../datamodel/node/primary/interface/NodeInterface";

import {
    LicenseInterface,
} from "../datamodel/node/secondary/interface/LicenseInterface";

import {
    BaseCertInterface,
} from "../datamodel/cert/base/interface/BaseCertInterface";

import {
    AuthCert,
} from "../datamodel/cert/secondary/authcert/AuthCert";

import {
    AuthCertInterface,
} from "../datamodel/cert/secondary/interface/AuthCertInterface";

import {
    ChainCertInterface,
} from "../datamodel/cert/secondary/interface/ChainCertInterface";

import {
    FriendCertInterface,
} from "../datamodel/cert/secondary/interface/FriendCertInterface";

import {
    DataCert,
} from "../datamodel/cert/secondary/datacert/DataCert";

import {
    LicenseCert,
} from "../datamodel/cert/secondary/licensecert/LicenseCert";

import {
    FriendCert,
} from "../datamodel/cert/secondary/friendcert/FriendCert";

import {
    ChainCert,
} from "../datamodel/cert/secondary/chaincert/ChainCert";

import {
    PRIMARY_INTERFACE_CHAINCERT_ID,
} from "../datamodel/cert/primary/interface/PrimaryChainCertInterface";

import {
    PRIMARY_INTERFACE_DEFAULTCERT_ID,
} from "../datamodel/cert/primary/interface/PrimaryDefaultCertInterface";

import {
    PRIMARY_INTERFACE_NODECERT_ID,
    PrimaryNodeCertInterface,
} from "../datamodel/cert/primary/interface/PrimaryNodeCertInterface";

import {
    DataModelInterface,
} from "../datamodel/interface/DataModelInterface";

import {
    IsCert,
} from "../datamodel/node/primary/node/Node";

/**
 * Specifies all the node classes we support for decoding.
 * Node image headers are matched against the GetType() of the classes to match.
 */
const SUPPORTED_NODE_TYPES = [
    Data,
    License,
];

/**
 * Specifies all cert classes for known auth certs.
 */
const SUPPORTED_AUTH_CERTS = [
    AuthCert,
];

/**
 * Specifies all cert classes for known friend certs.
 */
const SUPPORTED_FRIEND_CERTS = [
    FriendCert,
];

/**
 * Specifies all known cert classes for node certs (which are used for signing nodes).
 */
const SUPPORTED_NODE_CERTS = [
    DataCert,
    LicenseCert,
];

/**
 * Specifies all cert classes for known chain certs.
 */
const SUPPORTED_CHAIN_CERTS = [
    ChainCert,
];

const ALL_SUPPORTED_CERTS = [
    ...SUPPORTED_AUTH_CERTS,
    ...SUPPORTED_FRIEND_CERTS,
    ...SUPPORTED_NODE_CERTS,
    ...SUPPORTED_CHAIN_CERTS,
];

/**
 * The Decoder class provides a set of static function which are used to decode data model raw data (images as we call them).
 */
export class Decoder {
    public static Decode(image: Buffer): DataModelInterface {
        for (let i=0; i<ALL_SUPPORTED_CERTS.length; i++) {
            const cls = ALL_SUPPORTED_CERTS[i];
            const modelType = cls.GetType();
            if (modelType.equals(image.slice(0, modelType.length))) {
                return Decoder.DecodeAnyCert(image);
            }
        }

        for (let index=0; index<SUPPORTED_NODE_TYPES.length; index++) {
            const NODECLASS = SUPPORTED_NODE_TYPES[index];
            if (NODECLASS.GetType().equals(image.slice(0, NODECLASS.GetType().length))) {
                return Decoder.DecodeNode(image);
            }
        }

        throw new Error("DataModel type is unknown.");
    }

    /**
     * Decodes any known cert, optionally decode recursively.
     * Note that this function does not validate nor cryptographically verify any certs.
     * @param certImage the encoded raw binary of the certificate.
     * @param decodeRecursively set to true (default) to also decode embedded certs.
     * @throws if any cert could not be decoded.
     */
    public static DecodeAnyCert(certImage: Buffer, decodeRecursively: boolean = true): BaseCertInterface {
        for (let i=0; i<ALL_SUPPORTED_CERTS.length; i++) {
            const cls = ALL_SUPPORTED_CERTS[i];
            const modelType = cls.GetType();
            if (modelType.equals(certImage.slice(0, modelType.length))) {
                const cert = new cls();
                try {
                    cert.load(certImage);
                }
                catch(e) {
                    throw new Error(`Could not load cert image for type ${modelType.toString("hex")}: ${e}`);
                }
                if (decodeRecursively) {
                    const embeddedCert = cert.getCert();
                    if (embeddedCert) {
                        try {
                            const embeddedCertObject = Decoder.DecodeChainCert(embeddedCert);
                            cert.setCertObject(embeddedCertObject);
                        }
                        catch(e) {
                            // Let the node deal with this it self, if it can.
                        }
                    }
                }
                return cert;
            }
        }
        throw new Error("Cert type is not known.");
    }

    /*
     * Decode an authentication certificate.
     * Note that this function does not validate nor cryptographically verify the cert.
     * @param authCertImage the encoded raw binary of the certificate.
     * @returns the decoded cert instance as an AuthCertInterface.
     * @throws if cert could not be decoded.
     */
    public static DecodeAuthCert(authCertImage: Buffer): AuthCertInterface {
        for (let i=0; i<SUPPORTED_AUTH_CERTS.length; i++) {
            const cls = SUPPORTED_AUTH_CERTS[i];
            const modelType = cls.GetType();
            if (modelType.equals(authCertImage.slice(0, modelType.length))) {
                const authCert = new cls();
                try {
                    authCert.load(authCertImage);
                }
                catch(e) {
                    throw new Error(`Could not load auth cert image: ${e}`);
                }
                const chainCertImage = authCert.getCert();
                if (chainCertImage) {
                    try {
                        const chainCert = Decoder.DecodeChainCert(chainCertImage);
                        authCert.setCertObject(chainCert);
                    }
                    catch(e) {
                        // Let the node deal with this it self, if it can.
                    }
                }
                return authCert;
            }
        }
        throw new Error("Could not decode auth cert, type is not supported");
    }

    /*
     * Decode a friend certificate.
     * Note that this function does not validate nor cryptographically verify the cert.
     * @param friendCertImage the encoded raw binary of the certificate.
     * @returns the decoded cert instance as a FriendCertInterface.
     * @throws if cert could not be decoded.
     */
    public static DecodeFriendCert(friendCertImage: Buffer): FriendCertInterface {
        for (let i=0; i<SUPPORTED_FRIEND_CERTS.length; i++) {
            const cls = SUPPORTED_FRIEND_CERTS[i];
            const modelType = cls.GetType();
            if (modelType.equals(friendCertImage.slice(0, modelType.length))) {
                const friendCert = new cls();
                try {
                    friendCert.load(friendCertImage);
                }
                catch(e) {
                    throw new Error(`Could not load friend cert image: ${e}`);
                }
                const chainCertImage = friendCert.getCert();
                if (chainCertImage) {
                    try {
                        const chainCert = Decoder.DecodeChainCert(chainCertImage);
                        friendCert.setCertObject(chainCert);
                    }
                    catch(e) {
                        // Let the node deal with this it self, if it can.
                    }
                }
                return friendCert;
            }
        }
        throw new Error("Could not decode friend cert, type is not supported");
    }

    /*
     * Decode a chain certificate.
     * Note that this function does not validate nor cryptographically verify the cert.
     * @param certImage the encoded raw binary of the certificate.
     * @returns the decoded cert instance as a ChainCertInterface or undefined if cert type is not recognized.
     * @throws if decoding fails or type is unknown.
     */
    public static DecodeChainCert(certImage: Buffer): ChainCertInterface | undefined {
        for (let i=0; i<SUPPORTED_CHAIN_CERTS.length; i++) {
            const cls = SUPPORTED_CHAIN_CERTS[i];
            const modelType = cls.GetType();
            if (modelType.equals(certImage.slice(0, modelType.length))) {
                const chainCert = new cls();
                try {
                    chainCert.load(certImage);
                }
                catch(e) {
                    throw new Error(`Could not load chain cert image: ${e}`);
                }
                const certImage2 = chainCert.getCert();
                if (certImage2) {
                    try {
                        const chainCert2 = Decoder.DecodeChainCert(certImage2);
                        chainCert.setCertObject(chainCert2);
                    }
                    catch(e) {
                        // Let the cert deal with this it self, if it can.
                    }
                }
                return chainCert;
            }
        }
        throw new Error("Could not decode chain cert, type is not supported");
    }

    /*
     * Decode a node certificate.
     * Note that this function does not validate nor cryptographically verify the cert.
     * @param nodeCertImage the encoded raw binary of the certificate.
     * @returns the decoded cert instance as a PrimaryNodeCertInterface.
     * @throws if cert could not be decoded.
     */
    public static DecodeNodeCert(nodeCertImage: Buffer): PrimaryNodeCertInterface {
        for (let i=0; i<SUPPORTED_NODE_CERTS.length; i++) {
            const cls = SUPPORTED_NODE_CERTS[i];
            const modelType = cls.GetType();
            if (modelType.equals(nodeCertImage.slice(0, modelType.length))) {
                const nodeCert = new cls();
                try {
                    nodeCert.load(nodeCertImage);
                }
                catch(e) {
                    throw new Error(`Could not load node cert image: ${e}`);
                }
                const chainCertImage = nodeCert.getCert();
                if (chainCertImage) {
                    try {
                        const chainCert = Decoder.DecodeChainCert(chainCertImage);
                        nodeCert.setCertObject(chainCert);
                    }
                    catch(e) {
                        // Let the node deal with this it self, if it can.
                    }
                }
                return nodeCert;
            }
        }
        throw new Error("Could not decode sign cert, type is not supported");
    }

    /**
     * Note that this function does not validate nor cryptographically verify the node.
     * @param image is the encoded raw node data.
     * @param preserveTransient if true then if the encoded image has any transient fields those will be decoded into the instantiated node object.
     * @returns the decoded node instance as a NodeInterface. The instance can be casted to its exact class type by inspecting the return of getType() of the instance.
     * @throws on decoding error or if the node type is not supported.
     */
    public static DecodeNode(image: Buffer, preserveTransient: boolean = false): NodeInterface {
        for (let index=0; index<SUPPORTED_NODE_TYPES.length; index++) {
            const NODECLASS = SUPPORTED_NODE_TYPES[index];
            if (NODECLASS.GetType().equals(image.slice(0, NODECLASS.GetType().length))) {
                const node = new NODECLASS();
                try {
                    node.load(image, preserveTransient);
                }
                catch(e) {
                    throw new Error(`Could not load node image: ${e}`);
                }
                const embeddedImage = node.getEmbedded();
                if (embeddedImage) {
                    if (Decoder.IsNode(embeddedImage)) {
                        try {
                            const embeddedNode = Decoder.DecodeNode(embeddedImage);
                            node.setEmbeddedObject(embeddedNode as any);  // We force this "as any" to let the node decide if it wants this embedded object.
                        }
                        catch(e) {
                            // If the embedded node could not be decoded then ignore and move on.
                            // The node might know how to deal with this itself.
                        }
                    }
                    else if (IsCert(embeddedImage)) {
                        try {
                            const embeddedCert = Decoder.DecodeAnyCert(embeddedImage);
                            node.setEmbeddedObject(embeddedCert as any);  // We force this "as any" to let the node decide if it wants this embedded object.
                        }
                        catch(e) {
                            // If the embedded cert could not be decoded then ignore and move on.
                            // The node might know how to deal with this itself.
                        }
                    }
                    else {
                        // Not node and not cert.
                        // Do nothing, let the node sort out the embedding it self.
                    }
                }

                const certImage = node.getCert();
                if (certImage) {
                    try {
                        const cert = Decoder.DecodeNodeCert(certImage);
                        node.setCertObject(cert as any);  // We force this "as any" to let the node decide if it wants this embedded object.
                    }
                    catch(e) {
                        // Do nothing, let the node it self deal with this.
                    }
                }

                // License's might also have friend certs
                if (License.GetType(4).equals(node.getType(4))) {
                    const licenseNode = node as LicenseInterface;
                    const friendCertAImage = licenseNode.getFriendACert();
                    if (friendCertAImage) {
                        try {
                            const cert = Decoder.DecodeFriendCert(friendCertAImage);
                            licenseNode.setFriendACertObject(cert);
                        }
                        catch(e) {
                            // Do nothing, let the node it self handle this.
                        }
                    }

                    const friendCertBImage = licenseNode.getFriendBCert();
                    if (friendCertBImage) {
                        try {
                            const cert = Decoder.DecodeFriendCert(friendCertBImage);
                            licenseNode.setFriendBCertObject(cert);
                        }
                        catch(e) {
                            // Do nothing, let the node it self handle this.
                        }
                    }
                }

                return node as NodeInterface;
            }
        }

        throw new Error("Could not decode node, type not supported");
    }

    /**
     * The point of this function is to find in a list of certificates a certificate which can be used to sign a node given the signers public key and the node owner.
     * @param node The node we want to sign.
     * @param signerPublicKey the public key of the keypair which will be used to sign the node.
     * @param cert a list of certificates in which to find a matching certificate.
     * @returns a matching certificate as PrimaryNodeCertInterface or undefined if none matched.
     */
    public static MatchNodeCert(node: NodeInterface, signerPublicKey: Buffer, certs: PrimaryNodeCertInterface[]): PrimaryNodeCertInterface | undefined {
        const ownerPublicKey = node.getOwner();

        if (!ownerPublicKey) {
            return undefined;
        }

        for (let i=0; i<certs.length; i++) {
            const cert = certs[i];
            if (cert.getTargetPublicKeys().findIndex( (targetPublicKey: Buffer) => targetPublicKey.equals(signerPublicKey) ) > -1) {
                if (node.isCertTypeAccepted(cert.getType())) {
                    const val = cert.validateAgainstTarget(node.getParams(), 2);  // 2 means deepvalidate but do not check signatures (since node is not signed).
                    if (val[0]) {
                        return cert;
                    }
                }
            }
        }

        return undefined;
    }

    /**
    * Check in the image header data if it looks like a node.
    * @param image the node image
    * @returns true if the image header is recognized as being of primary interface node.
    */
    protected static IsNode(image: Buffer): boolean {
        const nodePrimaryInterface = Buffer.from([0, PRIMARY_INTERFACE_NODE_ID]);
        if (image.slice(0, 2).equals(nodePrimaryInterface)) {
            return true;
        }

        return false;
    }
}
