import {
    Node,
    Version,
} from "../../primary/node";

import {
    Signature,
} from "../../../types";

import {
    Hash,
} from "../../../hash";

import {
    LicenseCert,
    LICENSECERT_TYPE,
    FriendCert,
    FriendCertInterface,
    FRIENDCERT_TYPE,
    FriendCertConstraintValues,
} from "../../../cert/secondary";

import {
    Fields,
    FieldType,
    ModelType,
} from "../../../model";

import {
    StripObject,
} from "../../../../util/common";

import {
    LICENSE_NODE_TYPE,
    LicenseConfig,
    LicenseTransientConfig,
    LicenseParams,
} from "./types";

import {
    CLASS_MAJOR_VERSION,
    CLASS_MINOR_VERSION,
    CLASS_PATCH_VERSION,
} from "./versionTypes";

import {
    NodeInterface,
} from "../../primary/interface/NodeInterface";

import {
    LicenseInterface,
} from "../interface/LicenseInterface";

import {
    LicenseCertInterface,
} from "../../../cert/secondary/interface/LicenseCertInterface";

import {
    DataModelInterface,
} from "../../../interface/DataModelInterface";

import {
    SPECIAL_NODES,
} from "../data/types";

/**
 * The extra fields added on top of Node.
 * Also the disabling of fields is declared here.
 * Disabled fields always return undefined and cannot be set to any value.
 */
const FIELDS: Fields = {
    /**
     * Override this with new length.
     *
     */
    cert: {
        name: "cert",
        type: FieldType.BYTES,
        index: 12,

        /**
         * Max length for DataCert needed is 1982 bytes.
         */
        maxSize: 1985,
    },

    /**
     * Override this with new length.
     *
     * Note: this value is still an approximation of the maximum supported.
     */
    embedded: {
        name: "embedded",
        type: FieldType.BYTES,
        index: 13,

        maxSize: 9216,
    },

    // Add license specific fields
    licenseConfig: {
        name: "licenseConfig",
        type: FieldType.UINT8,
        index: 30,
    },
    targetPublicKey: {
        name: "targetPublicKey",
        type: FieldType.BYTES,
        maxSize: 32,
        index: 31,
    },
    terms: {
        name: "terms",
        type: FieldType.STRING,
        maxSize: 255,
        index: 32,
    },
    extensions: {
        name: "extensions",
        type: FieldType.UINT8,
        index: 33,
    },
    friendLevel: {
        name: "friendLevel",
        type: FieldType.UINT8,
        index: 34,
    },
    friendCertA: {
        name: "friendCertA",
        type: FieldType.BYTES,
        maxSize: 2018,
        index: 35,
    },
    friendCertB: {
        name: "friendCertB",
        type: FieldType.BYTES,
        maxSize: 2018,
        index: 36,
    },
    licenseTransientConfig: {
        name: "licenseTransientConfig",
        type: FieldType.UINT8,
        index: 37,
        transient: true,
    },
    jumpPeerPublicKey: {
        name: "jumpPeerPublicKey",
        type: FieldType.BYTES,
        maxSize: 32,
        index: 38,
    },
    parentPathHash: {
        name: "parentPathHash",
        type: FieldType.BYTE32,
        index: 39,
    },
    maxDistance: {
        name: "maxDistance",
        type: FieldType.UINT8,
        index: 40,
    },

    // Disable the following fields by overriding them with FieldType NONE
    id2: {
        name: "id2",
        type: FieldType.NONE,
        index: 1,
        hash: false,
    },
    network: {
        name: "network",
        type: FieldType.NONE,
        index: 4,
    },
    licenseMinDistance: {
        name: "licenseMinDistance",
        type: FieldType.NONE,
        index: 16,
    },
    licenseMaxDistance: {
        name: "licenseMaxDistance",
        type: FieldType.NONE,
        index: 17,
    },
    childMinDifficulty: {
        name: "childMinDifficulty",
        type: FieldType.NONE,
        index: 18,
    },
    copiedSignature: {
        name: "copiedSignature",
        type: FieldType.NONE,
        index: 20,
    },
    copiedParentId: {
        name: "copiedParentId",
        type: FieldType.NONE,
        index: 21,
    },
    copiedId1: {
        name: "copiedId1",
        type: FieldType.NONE,
        index: 22,
    },
};

/**
 * A License node has the power to grant allowances to other nodes (Data node) so that users can hold the nodes.
 *
 * Licenses are special in how they act when embedded: a License can embed another License to extend that license to a new user (if allowed).
 *
 */
export class License extends Node implements LicenseInterface {
    protected cachedCertObject: LicenseCertInterface | undefined;
    protected cachedEmbeddedObject: LicenseInterface | undefined;
    protected cachedFriendACertObject: FriendCertInterface | undefined;
    protected cachedFriendBCertObject: FriendCertInterface | undefined;
    protected cachedLicenseeHashes: Buffer[] | undefined;

    /**
     * Instantiates a new License node.
     *
     * @param nodeType set this from a deriving node, otherwise leave as default.
     * @param nodeFields set this from a derviing node, otherwise leave as default.
     */
    constructor(nodeType: ModelType = LICENSE_NODE_TYPE, nodeFields: Fields = {}) {
        const fields = {...FIELDS, ...nodeFields};
        super(nodeType, fields);
        this.setLeaf();
        this.setUnique();  // To avoid unnecessary duplicate licenses.
    }

    /**
     * @param length optional number of bytes if the node type to return.
     * @returns the License node's model type.
     */
    public static GetType(length?: number): Buffer {
        length = length ?? LICENSE_NODE_TYPE.length;
        return LICENSE_NODE_TYPE.slice(0, length);
    }

    /**
     * @param length optional number of bytes if the node type to return.
     * @returns the Licene node's model type.
     */
    public getType(length?: number): Buffer {
        length = length ?? LICENSE_NODE_TYPE.length;
        return LICENSE_NODE_TYPE.slice(0, length);
    }

    /**
     * Return this node's version.
     * @returns semver version of this node.
     */
    public getVersion(): Version {
        return [CLASS_MAJOR_VERSION, CLASS_MINOR_VERSION, CLASS_PATCH_VERSION];
    }

    /**
     * Return this node's version.
     * @returns semver version of this node.
     */
    public static GetVersion(): Version {
        return [CLASS_MAJOR_VERSION, CLASS_MINOR_VERSION, CLASS_PATCH_VERSION];
    }

    /**
     * @param modelType the model type of the node to embed. First four bytes of the cert model are matched for and has to match the License type.
     * @returns true if model type is of primary+secondary bytes of LICENSE_NODE_TYPE.
     */
    public isEmbeddedTypeAccepted(embeddedType: Buffer): boolean {
        // Compare primary + secondary interfaces.
        return embeddedType.slice(0, 4).equals(LICENSE_NODE_TYPE.slice(0, 4));
    }

    /**
     * @param certType the model type of the cert potentially signing for this node. First four bytes of the cert model are matched for.
     * @returns true if cert type is of primary+secondary bytes of LICENSECERT_TYPE.
     */
    public isCertTypeAccepted(certType: Buffer): boolean {
        // Compare primary + secondary interfaces.
        return certType.slice(0, 4).equals(LICENSECERT_TYPE.slice(0, 4));
    }

    /**
     * @param certType the model type of a cert potentially used as a friend cert in this licene. First four bytes of the cert model are matched for.
     * @returns true if cert type is of primary+secondary bytes of FRIENDCERT_TYPE.
     */
    public isFriendCertTypeAccepted(certType: Buffer): boolean {
        // Check primary+secondary interfaces
        return certType.slice(0, 4).equals(FRIENDCERT_TYPE.slice(0, 4));
    }

    /**
     * Override export to also export any friend certs.
     * @param exportTransient if true then also export fields marked as transient.
     * @returns exported data Buffer
     * @throws a string containing a message error when unable to export the data model or any ambedded data model.
     */
    public export(exportTransient: boolean = false): Buffer {
        if (this.cachedFriendACertObject) {
            this.setFriendACert(this.cachedFriendACertObject.export());
        }
        if (this.cachedFriendBCertObject) {
            this.setFriendBCert(this.cachedFriendBCertObject.export());
        }
        return super.export(exportTransient);
    }

    /**
     * The user public key getting the allowance of this license.
     *
     * @param targetPublicKey
     */
    public setTargetPublicKey(targetPublicKey: Buffer | undefined) {
        this.model.setBuffer("targetPublicKey", targetPublicKey);
    }

    /**
     * @returns targetPublicKey
     */
    public getTargetPublicKey(): Buffer | undefined {
        return this.model.getBuffer("targetPublicKey");
    }

    /**
     * Sets the node id1 of the node this license is to license for.
     * Note that this is a suger function over setRefId().
     *
     * @param nodeId1 the node id1 of the node this license is licensing.
     */
    public setNodeId1(nodeId1: Buffer | undefined) {
        this.setRefId(nodeId1);
    }

    /**
     * Gets the node id1 of the node this license is to license for.
     * Note that this is a suger function over getRefId().
     * @returns the node id1 of the node this license is licensing.
     */
    public getNodeId1(): Buffer | undefined {
        return this.getRefId();
    }

    /**
     * Set the maximum number of times this license can be embedded.
     * Allow embedding is automatically set if extensions are set greater than 0.
     * @param extensions maximum number of embeddings to allow for
     */
    public setExtensions(extensions: number | undefined) {
        if (extensions && extensions > 0) {
            this.setAllowEmbed();
        }
        this.model.setNumber("extensions", extensions);
    }

    /**
     * @returns the value of the extensions field
     */
    public getExtensions(): number | undefined {
        return this.model.getNumber("extensions");
    }

    /**
     * If the licene has jumpPeerPublicKey set then that peer is allowed
     * to hold on to the license for the purpose of passing it to its actual target.
     * The jump peer can access the underlying data due to this license, but the licene
     * does not allow any usage of that data other than storing it for the sole purpose
     * of sending it to the target of the license.
     */
    public getJumpPeerPublicKey(): Buffer | undefined {
        return this.model.getBuffer("jumpPeerPublicKey");
    }

    public setJumpPeerPublicKey(jumpPeerPublicKey: Buffer | undefined) {
        this.model.setBuffer("jumpPeerPublicKey", jumpPeerPublicKey);
    }

    /**
     * If this is set and the license is used by nodes as a parent license,
     * then this license can set this hash to dictate which children are allowed to use this license as a parent license.
     *
     * Any nodes to leverage this license as a parent license must lay on the path (or further below) dictated in the hash.
     * The hash is calculated backwards, starting from the deepest node ID the parent path upwards including the precice node this licenes is targeting.
     *
     * A<-B<-C<-D1,D2
     *
     * h1=Hash(D1.id1)
     * parentPathHash=Hash(C.id1 || 0x01 || h1)
     *
     * This parentPathHash says that D1 is allowed and everything below D1, but it also must pass via C.
     * D2, C or B are not allowed to use this License.
     *
     * @return parentPathHash if set
     */
    public getParentPathHash(): Buffer | undefined {
        return this.model.getBuffer("parentPathHash");
    }

    public setParentPathHash(parentPathHash: Buffer | undefined) {
        this.model.setBuffer("parentPathHash", parentPathHash);
    }

    public setMaxDistance(maxDistance: number | undefined) {
        this.model.setNumber("maxDistance", maxDistance);
    }

    /**
     * If this is set then it dictates the maximum distance this License will allow when being used as a parent license.
     * If `undefined` maximum distance supported is allowed.
     * If set to 0 then it will not license any child nodes,
     * if set to 1 then it will allow licensing of direct child nodes, etc.
     * @returns the value of the maxDistance field
     */
    public getMaxDistance(): number | undefined {
        return this.model.getNumber("maxDistance");
    }

    /**
     * @param friendLevel the required friend level of friend certs for extending this license.
     */
    public setFriendLevel(friendLevel: number | undefined) {
        this.model.setNumber("friendLevel", friendLevel);
    }

    /**
     * @returns the value of the friendLevel field
     */
    public getFriendLevel(): number | undefined {
        return this.model.getNumber("friendLevel");
    }

    /**
     * Sets the friend cert image A.
     */
    public setFriendACert(friendConnection: Buffer | undefined) {
        this.model.setBuffer("friendCertA", friendConnection);
    }

    /**
     * @returns the value of the friendCertA field
     */
    public getFriendACert(): Buffer | undefined {
        return this.model.getBuffer("friendCertA");
    }

    /**
     * Sets the friend cert image B.
     */
    public setFriendBCert(friendConnection: Buffer | undefined) {
        this.model.setBuffer("friendCertB", friendConnection);
    }

    /**
     * @returns the value of the friendCertB field
     */
    public getFriendBCert(): Buffer | undefined {
        return this.model.getBuffer("friendCertB");
    }

    /**
     * Set the cached cert object for friend cert A.
     * This is automatically exported and set as friend cert A image.
     * @param cert
     */
    public setFriendACertObject(cert: FriendCertInterface | undefined) {
        this.cachedFriendACertObject = cert;
    }

    /**
     * Returns the chached friend cert object or decodes and returns the image.
     * @returns cert object
     * @throws if cannot be decoded
     */
    public getFriendACertObject(): FriendCertInterface {
        if (this.cachedFriendACertObject) {
            return this.cachedFriendACertObject;
        }
        // Attempt to decode as the FriendCert we know of
        const image = this.getFriendACert();
        if (!image) {
            throw new Error("Expected friend A cert image");
        }
        const friendCert = new FriendCert();
        friendCert.load(image);
        this.cachedFriendACertObject = friendCert;
        return friendCert;
    }

    /**
     * Set the cached cert object for friend cert B.
     * This is automatically exported and set as friend cert B image.
     * @param cert
     */
    public setFriendBCertObject(cert: FriendCertInterface | undefined) {
        this.cachedFriendBCertObject = cert;
    }

    /**
     * Returns the chached friend cert object or decodes and returns the image.
     * @returns cert object
     * @throws if cannot be decoded
     */
    public getFriendBCertObject(): FriendCertInterface {
        if (this.cachedFriendBCertObject) {
            return this.cachedFriendBCertObject;
        }
        // Attempt to decode as the FriendCert we know of
        const image = this.getFriendACert();
        if (!image) {
            throw new Error("Expected friend A cert image");
        }
        const friendCert = new FriendCert();
        friendCert.load(image);
        this.cachedFriendBCertObject = friendCert;
        return friendCert;
    }

    /**
     * @param terms data to set terms field to.
     * This should be a JSON encoded string where each extender level is representet by
     * it index:
     *  {0: "Terms for original license", 1: "Terms for first extension", 2: 1, 3: 1}
     *  height 2 and 3 refer to the smae term of height 1 ("Terms for first extension").
     */
    public setTerms(terms: string | undefined) {
        this.model.setString("terms", terms);
    }

    /**
     * @returns the value of the terms field.
     */
    public getTerms(): string | undefined {
        return this.model.getString("terms");
    }

    /**
     * @param height get terms for given height. Default is to get terms for current height
     * of the license stack.
     * @returns string representng terms for height or undefined if no terms can be found.
     * @throws if license stack (embedded licenses) cannot be decoded or
     * if the terms are not parsable.
     */
    public getCurrentTerms(height?: number): string | undefined {
        const nrLicenses = this.countLicenses();
        height = height ?? nrLicenses - 1;

        const terms = this.getOriginalTerms();

        if (terms === undefined) {
            return undefined;
        }

        const obj = JSON.parse(terms);
        let currentTerms: string | undefined;
        for (let i=0; i<nrLicenses; i++) {
            currentTerms = obj[height];
            if (currentTerms === undefined || currentTerms === null) {
                return undefined;
            }

            if (typeof currentTerms === "number") {
                height = currentTerms;
            }

            if (typeof currentTerms === "string") {
                return currentTerms;
            }
        }

        return undefined;
    }

    /**
     * Get the terms of the first license in the stack.
     * @returns terms of first license in stack.
     * @throws if embedded node cannot be decoded.
     */
    public getOriginalTerms(): string | undefined {
        let license: LicenseInterface = this as LicenseInterface;

        while (license.getEmbedded()) {
            license = license.getEmbeddedObject();
        }

        return license.getTerms();
    }

    /**
     * Adds further checks to the validation of license.
     * @see Node.validate().
     */
    public validate(deepValidate: number = 1, timeMS?: number): [boolean, string] {
        const validation = super.validate(deepValidate, timeMS);
        if (!validation[0]) {
            return validation;
        }

        if (this.getId2()) {
            return [false, `License cannot have an id2`];
        }

        if (this.hasDynamicSelf()) {
            return [false, `License cannot be configured for dynamic ID`];
        }

        if (!this.getNodeId1()) {
            return [false, `License must have nodeId1 set pointing to the node to be licensed`];
        }

        if (!this.getTargetPublicKey()) {
            return [false, `License must have target public key set pointing to the user who this license grants permissions to`];
        }

        if (!this.isLeaf()) {
            return [false, `License must be leaf node`];
        }

        if (this.isPublic()) {
            return [false, `License cannot be public`];
        }

        if (this.isLicensed()) {
            return [false, `License cannot it self be licensed`];
        }

        if (this.disallowParentLicensing()) {
            return [false, `License cannot have the disallowParentLicensing flag set`];
        }

        if (this.onlyOwnChildren()) {
            return [false, `License cannot have the onlyOwnChildren flag set`];
        }

        if (this.disallowPublicChildren()) {
            return [false, `License cannot have the disallowPublicChildren flag set`];
        }

        if (this.getChildMinDifficulty() !== undefined) {
            return [false, `License cannot have childMinDifficulty set`];
        }

        const extensions = this.getExtensions();
        if (extensions !== undefined && extensions > 6) {
            return [false, `License cannot have more than 6 extensions allowed`];
        }

        if (extensions !== undefined && extensions < 0) {
            return [false, `License cannot have negative extensions set`];
        }

        if (this.getExpireTime() === undefined) {
            return [false, "License must have expireTime set"];
        }

        const terms = this.getTerms();
        if (terms) {
            try {
                JSON.parse(terms);
            }
            catch(e) {
                return [false, "Terms could not successfully be parsed as JSON"];
            }
        }

        if ( (this.getFriendACert() && !this.getFriendBCert()) ||
           (!this.getFriendACert() && this.getFriendBCert())) {
            return [false, "Both friend cert images must be set, when set"];
        }

        if (this.hasFriendACert() && this.hasFriendBCert()) {
            if (!this.getEmbedded()) {
                return [false, "License using friend certs must also embed a license which has friendLevel set"];
            }
            let certA;
            let certB;
            let embedded;
            try {
                certA = this.getFriendACertObject();
                certB = this.getFriendBCertObject();
                embedded = this.getEmbeddedObject();
            }
            catch(e) {
                return [false, `Could not unpack friend certs or embedded node`];
            }

            // Check that this node accepts the interface of this certificate.
            if (!this.isFriendCertTypeAccepted(certA.getType())) {
                return [false, "Friend certA type is not accepted by license"];
            }
            if (!this.isFriendCertTypeAccepted(certB.getType())) {
                return [false, "Friend certB type is not accepted by license"];
            }

            if ((certA.isDynamic() || certB.isDynamic()) && !this.hasDynamicFriendCert()) {
                return [false, "If either friend cert A or B is dynamic then license must be flagged as hasDynamicFriendCert"];
            }
            if ( (!certA.isDynamic() && !certB.isDynamic()) && this.hasDynamicFriendCert()) {
                return [false, "If neither friend cert A or B is dynamic then license must not be flagged with hasDynamicFriendCert"];
            }

            const creationTime = this.getCreationTime();
            const expireTime = this.getExpireTime();
            const modelType = this.getType();
            const friendLevel = embedded.getFriendLevel();
            const intermediaryPublicKey = embedded.getTargetPublicKey();
            const embeddedOwnerPublicKey = embedded.getOwner();
            const targetPublicKey = this.getTargetPublicKey();
            const keyA = certA.getKey();
            const certAIssuerPublicKey = certA.getIssuerPublicKey();
            const certAConstraints = certA.getConstraints();
            const keyB = certB.getKey();
            const certBIssuerPublicKey = certB.getIssuerPublicKey();
            const certBConstraints = certB.getConstraints();

            if (keyA === undefined || certAIssuerPublicKey === undefined || certAConstraints === undefined ||
                keyB === undefined || certBIssuerPublicKey === undefined || certBConstraints === undefined ||
                creationTime === undefined || embeddedOwnerPublicKey === undefined || targetPublicKey === undefined || friendLevel === undefined || intermediaryPublicKey === undefined) {
                // This can't happen in practice since values have been verified already
                return [false, "Lacking values"];
            }

            // Let the cert A validate against this license node.
            const friendAConstraintValues: FriendCertConstraintValues = {
                publicKey: embeddedOwnerPublicKey,
                key: keyA,
                otherKey: keyB,
                otherIssuerPublicKey: certBIssuerPublicKey,
                otherConstraints: certBConstraints,
                creationTime,
                expireTime,
                modelType,
                intermediaryPublicKey,
                friendLevel,
            };
            const val = certA.validateAgainstTarget(friendAConstraintValues);
            if (!val[0]) {
                return [false, `The friend cert A used does not validate against the license, reason: ${val[1]}`];
            }

            // Let the cert B validate against this license node.
            const friendBConstraintValues: FriendCertConstraintValues = {
                publicKey: targetPublicKey,
                key: keyB,
                otherKey: keyA,
                otherIssuerPublicKey: certAIssuerPublicKey,
                otherConstraints: certAConstraints,
                creationTime,
                expireTime,
                modelType,
                intermediaryPublicKey,
                friendLevel,
            };
            const val2 = certB.validateAgainstTarget(friendBConstraintValues);
            if (!val2[0]) {
                return [false, `The friend cert B used does not validate against the license, reason: ${val2[1]}`];
            }
        }

        return [true, ""];
    }

    protected hasFriendACert(): boolean {
        if (this.getFriendACert()) {
            return true;
        }
        if (this.cachedFriendACertObject) {
            return true;
        }
        return false;
    }

    protected hasFriendBCert(): boolean {
        if (this.getFriendBCert()) {
            return true;
        }
        if (this.cachedFriendBCertObject) {
            return true;
        }
        return false;
    }

    /**
     * Set the cert object uses for signing as the cached cert.
     * When exprting this node this cached cert will get exported and set as the certImage.
     * @param cert the certificate object.
     */
    public setCertObject(cert: LicenseCertInterface | undefined) {
        if (cert && !this.isCertTypeAccepted(cert.getType())) {
            throw new Error("Cert type of cert object set is not accepted as cert in this License node");
        }
        this.cachedCertObject = cert;
    }

    /**
     * @returns either the ceched cert object or the decoded cert object.
     * @throws if no cert available to be returned or if cert cannot be decoded.
     */
    public getCertObject(): LicenseCertInterface {
        if (this.cachedCertObject) {
            return this.cachedCertObject;
        }
        const image = this.getCert();
        if (!image) {
            throw new Error("Expecting license cert image");
        }
        const cert = this.decodeCert(image);
        this.cachedCertObject = cert;
        return cert;
    }

    /**
     * Decode a image into a DataCert object.
     * @param image the cert image data.
     */
    protected decodeCert(image: Buffer): LicenseCertInterface {
        const cert = new LicenseCert();
        cert.load(image);
        return cert;
    }

    /**
     * Add the extraction of friend certs.
     * @see Node.extractDynamicObjects().
     */
    public extractDynamicObjects(): DataModelInterface[] {
        const objects = super.extractDynamicObjects();
        if (this.hasDynamicFriendCert()) {
            const certA = this.getFriendACertObject();
            const certB = this.getFriendBCertObject();
            if (certA.isDynamic()) {
                objects.push(...certA.extractDynamicObjects());
            }
            if (certB.isDynamic()) {
                objects.push(...certB.extractDynamicObjects());
            }
        }
        return objects;
    }

    /**
     * Adds to check for dynamic friend certs.
     * @see Node.isDynamicActive();
     */
    public isDynamicActive(): boolean {
        if (!super.isDynamicActive()) {
            return false;
        }
        if (this.hasDynamicFriendCert() && !this.isDynamicFriendCertsActive()) {
            return false;
        }
        return true;
    }

    /**
     * Transient value set by Storage layer on object.
     *
     * @param isActive state to be set
     */
    public setDynamicFriendCertsActive(isActive: boolean = true) {
        this.setLicenseTransientBit(LicenseTransientConfig.DYNAMIC_FRIENDCERTS_ACTIVE, isActive);
    }

    /**
     * If this license uses dynamic friend certs and the certs are active then this function returns true 
     * This is a transient value set by the environment.
     *
     * @returns whether or not the node has active friend certs.
     */
    public isDynamicFriendCertsActive(): boolean {
        return this.isLicenseTransientBitSet(LicenseTransientConfig.DYNAMIC_FRIENDCERTS_ACTIVE);
    }

    /**
     * Adds checks of the friend certs.
     * @see Node.updateDynamicStatus().
     */
    public updateDynamicStatus() {
        super.updateDynamicStatus();
        if (this.hasDynamicFriendCert()) {
            const certA = this.getFriendACertObject();
            const certB = this.getFriendBCertObject();
            let isActive = true;
            if (certA.isDynamic()) {
                if (!certA.isDynamicActive()) {
                    isActive = false;
                }
            }
            if (certB.isDynamic()) {
                if (!certB.isDynamicActive()) {
                    isActive = false;
                }
            }
            this.setDynamicFriendCertsActive(isActive);
        }
    }

    /**
     * @returns license transient config integer.
     */
    public getLicenseTransientConfig(): number | undefined {
        return this.model.getNumber("licenseTransientConfig");
    }

    /**
     * @param licenseTransientConfig the license transient config number.
     */
    public setLicenseTransientConfig(licenseTransientConfig: number | undefined) {
        this.model.setNumber("licenseTransientConfig", licenseTransientConfig);
    }

    /**
     * Set a bit in the transient state integer.
     *
     * @param index the bit index in the integer.
     * @param isSet state to set the bit to.
     */
    protected setLicenseTransientBit(index: LicenseTransientConfig, isSet: boolean) {
        const mask = 1 << index;
        const config = this.model.getNumber("licenseTransientConfig") || 0;
        if (isSet) {
            this.model.setNumber("licenseTransientConfig", config | mask);
        }
        else {
            this.model.setNumber("licenseTransientConfig", config & ~mask);
        }
    }

    /**
     * @param index the bit index to read in the transient integer.
     * @returns the state of the configuration bit.
     */
    protected isLicenseTransientBitSet(index: LicenseTransientConfig): boolean {
        const config = this.model.getNumber("licenseTransientConfig") || 0;
        return Boolean(config & (2**index));
    }

    /**
     * Adds verification of the friend certs.
     * @see Node.verify().
     */
    public verify(): boolean {
        if (!super.verify()) {
            return false;
        }

        try {
            if (this.getFriendACert()) {
                const certA = this.getFriendACertObject();
                if (!certA.verify()) {
                    return false;
                }
            }
            if (this.getFriendBCert()) {
                const certB = this.getFriendBCertObject();
                if (!certB.verify()) {
                    return false;
                }
            }
        }
        catch(e) {
            return false;
        }

        return true;
    }

    /**
     * Count the total nr of licenses embedded and also including this license.
     * @returns the total number of licenses including all embedded and this license.
     * @throws if embedded license cannot be decoded.
     */
    public countLicenses(): number {
        let count = 1;
        let license: LicenseInterface = this as LicenseInterface;
        while (license.getEmbedded()) {
            count++;
            license = license.getEmbeddedObject();
        }
        return count;
    }

    /**
     * First hand return the cached embedded node object, if set.
     * Secondly if the embedded image is set then attempt to (recursively) decode that image to a node object.
     *
     * Deriving nodes need to override the decodeEmbedded function to decode the node types they natively support.
     * Any other node embeddings must be decoded by the outside and put on the object as cached using setEmbeddedObject().
     *
     * @returns the embedded License instance.
     *
     * @throws if not able to return any object nor decode any object.
     */
    public getEmbeddedObject(): LicenseInterface {
        if (this.cachedEmbeddedObject) {
            return this.cachedEmbeddedObject;
        }
        const image = this.getEmbedded();
        if (!image) {
            throw new Error("License expecting embedded image to decode");
        }
        this.cachedEmbeddedObject = this.decodeEmbedded(image);
        return this.cachedEmbeddedObject;
    }

    /**
     * Set the instantiated embedded node object.
     * This is useful to allow the outside to decode, instantiate and set the cached embedded node for this node in
     * the cases this node cannot decode the embedded node itself.
     * The embedded node has to use the same primary and secondary interface as this node expects.
     * @param node
     */
    public setEmbeddedObject(license: LicenseInterface | undefined) {
        if (license && !this.isEmbeddedTypeAccepted(license.getType())) {
            throw new Error("Embedded type set is not accepted as by this License node");
        }
        this.cachedEmbeddedObject = license;
    }

    /**
     * Suger function to help embed this license into another license.
     * The returned license need to be signed.
     * @param targetPublicKey the target of the new license.
     * @param creationTime the creationTime of the embedding node, default is Date.now().
     * @returns embedding license with this license set as its embedded image, or undefined if not allowed to embed.
     * @throws on embedding error (such as field overflow).
     */
    public embed(targetPublicKey: Buffer, creationTime?: number): License | undefined {
        if (!this.allowEmbed()) {
            return undefined;
        }
        creationTime = Math.max(creationTime ?? Date.now(), this.getCreationTime() ?? 0);
        const expireTime = this.getExpireTime();
        if (expireTime !== undefined) {
            if (expireTime <= creationTime) {
                return undefined;
            }
        }
        const newNode = new License();
        newNode.setEmbedded(this.export());
        newNode.setEmbeddedObject(this);
        newNode.setOwner(this.getTargetPublicKey());  // The new owner is likely the old target
        newNode.setTargetPublicKey(targetPublicKey);
        newNode.setNodeId1(this.getNodeId1());
        newNode.setParentId(this.getParentId());
        newNode.setConfig(this.getConfig() ?? 0);
        newNode.setLicenseConfig(this.getLicenseConfig());
        newNode.setCreationTime(creationTime);
        newNode.setExpireTime(expireTime);
        newNode.setTerms(this.getTerms());
        const extensions = this.getExtensions();
        if (extensions === undefined || extensions <= 0) {
            return undefined;
        }
        newNode.setExtensions(extensions - 1);

        // Do not automatically inherit these configs.
        newNode.setAllowTargetSendPrivately(false);
        newNode.setJumpPeerPublicKey(undefined);
        newNode.setHasRightsByAssociation(false);

        return newNode;
    }

    /**
     * Attempt to decode the given datamodel image as a License node.
     *
     * @param image raw datamodel image data.
     * @returns decoded and instantiated node.
     * @throws an error when failing to decode the embedded node image.
     */
    protected decodeEmbedded(image: Buffer): LicenseInterface {
        if (License.GetType().equals(image.slice(0, 6))) {
            const node = new License();
            node.load(image);
            return node;
        }
        throw new Error("License node can only natively decode another embedded License node. For any other node type use external decoder and set object as the cached object");
    }

    /**
     * Return combination of hashes for which this license licenses for.
     * If a node.getLicensingHashes() intersects with this output then this license does license that node.
     *
     * @returns list of hashes to match with a node to be licensed.
     */
    public getLicenseeHashes(): Buffer[] {
        if (this.cachedLicenseeHashes) {
            return this.cachedLicenseeHashes;
        }

        const hashes: Buffer[] = [];
        const issuer = this.getIssuer();
        const nodeId1 = this.getNodeId1();
        const targetPublicKey = this.getTargetPublicKey();
        const ownerPublicKey = this.getOwner();
        const interfacesType = this.getType().slice(0, 4);  // This is the primary+secondary interface ids

        // This hash says there is a license for a specific node.
        hashes.push(Hash([interfacesType, this.getParentId(), issuer, nodeId1, undefined, undefined]));

        // This hash says there is a license targeted at a specific targetPublicKey for any ownerPublicKey.
        hashes.push(Hash([interfacesType, this.getParentId(), issuer, nodeId1, undefined, targetPublicKey]));

        // This hash says there is a license created by ownerPublicKey targeted at anybody.
        hashes.push(Hash([interfacesType, this.getParentId(), issuer, nodeId1, ownerPublicKey, undefined]));

        // This hash says there is a license created by ownerPublicKey targeted at targetPublicKey.
        hashes.push(Hash([interfacesType, this.getParentId(), issuer, nodeId1, ownerPublicKey, targetPublicKey]));

        const jumpPeerPublicKey = this.getJumpPeerPublicKey();
        if (jumpPeerPublicKey) {
            // This hash says there is a license targeted at a specific jumpPeerPublicKey for any ownerPublicKey.
            hashes.push(Hash([interfacesType, this.getParentId(), issuer, nodeId1, undefined, jumpPeerPublicKey]));

            // This hash says there is a license created by ownerPublicKey targeted at jumpPeerPublicKey.
            hashes.push(Hash([interfacesType, this.getParentId(), issuer, nodeId1, ownerPublicKey, jumpPeerPublicKey]));
        }

        this.cachedLicenseeHashes = hashes;

        return hashes;
    }

    /**
     * If this license embeds another license find the innermost license and return the owner public key of that license,
     * this is the issuer of the license stack.
     * @returns owner public key of the innermost license.
     * @throws if embedded node cannot be decoded.
     */
    public getIssuer(): Buffer | undefined {
        let license: LicenseInterface = this as LicenseInterface;
        while (license.getEmbedded()) {
            license = license.getEmbeddedObject();
        }
        return license.getOwner();
    }

    /**
     * See if this License node licenses the passed in node.
     * Note that the function validateEmbedding makes sure that the chain of embedded licenses are valid, which is invoked in the validation/verification process.
     *
     * @param otherParentId if checking licenses for this node if it is embedded below a different parent.
     * @returns true if this license does license the given node under the given client and targetpublicKeys.
     */
    public isLicenseTo(nodeToLicense: NodeInterface, otherParentId?: Buffer): boolean {
        const targetHashes = this.getLicenseeHashes();
        const licensingHashes = nodeToLicense.getLicensingHashes(this.getOwner(),
            this.getTargetPublicKey(), otherParentId);

        for (let i=0; i<targetHashes.length; i++) {
            for (let i2=0; i2<licensingHashes.length; i2++) {
                if (targetHashes[i].equals(licensingHashes[i2])) {
                    return true;
                }
            }
        }

        // No match
        return false;
    }

    /**
     * Adds checks for this License node against any embedded node to see that they align.
     * @see Node.validateEmbedding()
     */
    protected validateEmbedding(deepValidate: number = 1, timeMS?: number): [boolean, string] {
        const valid = super.validateEmbedding(deepValidate, timeMS);
        if (!valid[0]) {
            return valid;
        }

        if (!this.getEmbedded()) {
            return [true, ""];
        }
        const embedded = this.getEmbeddedObject();

        const interfaceType = LICENSE_NODE_TYPE.slice(0, 4);  // Primary and secondary interfaces
        if (!embedded.getType(4).equals(interfaceType)) {
            return [false, "License can only embed another License of the same interface"];
        }

        const owner = this.getOwner();
        if (!owner) {
            return [false, "Missing owner"];
        }
        const embeddedTargetPublicKey = embedded.getTargetPublicKey();
        if (!embeddedTargetPublicKey) {
            return [false, "Missing targetPublicKey in embedded license"];
        }

        // When embedding a license the owner of the embedding license
        // must be the target user of the embedded license.
        if (!owner.equals(embeddedTargetPublicKey)) {
            return [false, "Owner of embedding license must be target of the embedded license"];
        }

        // A target cannot extend a license towards themselves
        if (this.getTargetPublicKey()?.equals(embeddedTargetPublicKey)) {
            return [false, "Target public key of embedded license cannot be same as target public key of embedding license"];
        }

        // Terms can only be set on the first license in a stack.
        if (this.getTerms()) {
            return [false, "Terms can only be set on first license in a stack"];
        }

        // Check that this license and the embedded license both reference the same node.
        // nodeId1 is the id1 of the node this license licenses.
        const nodeId1 = this.getNodeId1();
        if (!nodeId1) {
            return [false, "Missing nodeId1"];
        }
        const nodeId1b = embedded.getNodeId1();
        if (!nodeId1b) {
            return [false, "Missing nodeId1 in embedded license"];
        }
        if (!nodeId1.equals(nodeId1b)) {
            return [false, "Mismatch of nodeId1 in License and embedded license node"];
        }

        const extensions = embedded.getExtensions();
        if (extensions === undefined || extensions <= 0) {
            return [false, "Embedded license does not allow (any more) extensions"];
        }
        const extensions2 = this.getExtensions();
        if (extensions2 === undefined || extensions2 >= extensions || extensions2 < 0) {
            return [false, "Embedding license must decrease nr of extensions compared to the embedded license"];
        }

        const friendLevel = embedded.getFriendLevel();
        if (friendLevel !== undefined) {
            // Embedding cert must have friend certs set
            if (this.hasFriendACert() === undefined || this.hasFriendBCert() === undefined) {
                return [false, "A license embedding another license with friendLevel set must have both friend certs set"];
            }
        }

        if ((this.getCreationTime() || 0) < (embedded.getCreationTime() || 0)) {
            return [false, "Embedding license cannot have an earlier creationTime than the embedded license."];
        }

        const expireTime = this.getExpireTime();
        const expireTime2 = embedded.getExpireTime();
        if (expireTime !== undefined && expireTime2 !== undefined) {
            if (expireTime > expireTime2) {
                return [false, "expireTime of embedding license cannot be greater then expireTime of embedded license"];
            }
        }
        else if (expireTime === undefined && expireTime2 !== undefined) {
            return [false, "expireTime of embedding license must also be set when expireTime of embedded license is set"];
        }

        if (embedded.disallowRetroLicensing() && !this.disallowRetroLicensing()) {
            return [false, "disallowRetroLicensing when set on the embedded license must be passed forward to the next license when embedding"];
        }

        if (this.isRestrictiveModeWriter() !== embedded.isRestrictiveModeWriter()) {
            return [false, "isRestrictiveModeWriter must be set same on node and embedded node."];
        }

        if (this.isRestrictiveModeManager() !== embedded.isRestrictiveModeManager()) {
            return [false, "isRestrictiveModeManager must be set same on node and embedded node."];
        }

        if (this.isBeginRestrictiveWriteMode() || this.isEndRestrictiveWriteMode()) {
            return [false, "A license node cannot have beginRestrictiveWriterMode or endRestrictiveWriterMode set"];
        }

        return [true, ""];
    }

    /**
     * Override to add friend cert signatures.
     * @see Node.extractSignatures().
     */
    public extractSignatures(): Signature[] {
        const signatures = super.extractSignatures();

        if (this.getFriendACert()) {
            const certA = this.getFriendACertObject();
            signatures.push(...certA.extractSignatures());
        }

        if (this.getFriendBCert()) {
            const certB = this.getFriendBCertObject();
            signatures.push(...certB.extractSignatures());
        }

        return signatures;
    }

    /**
     * Override to add friend cert destruction hashes and specific hashes to destroy licenses.
     *
     * Note that these hashes are created for every license in the stack of embedded licenses,
     * meaning that the issuer and every other user extending a license can destroy the stack
     * by destroying the license they created.
     *
     * @see Node.getAchillesHashes().
     */
    public getAchillesHashes(): Buffer[] {
        const hashes = super.getAchillesHashes();

        if (!this.isIndestructible()) {
            const targetPublicKey   = this.getTargetPublicKey();
            const nodeId1           = this.getNodeId1();

            if (targetPublicKey) {
                // This hash lets the owner destroy all its licenses targeted at a specific user.
                //
                const innerHash = Hash([SPECIAL_NODES.DESTROY_LICENSES_FOR_TARGET_PUBLICKEY,
                    this.getOwner(), targetPublicKey]);

                hashes.push(Hash([SPECIAL_NODES.DESTROY_LICENSES_FOR_TARGET_PUBLICKEY,
                    this.getOwner(), innerHash]));

                if (nodeId1) {
                    // This hash lets the owner destroy all its licenses targeted at a specific user
                    // for a specific node.
                    //
                    const innerHash = Hash([
                        SPECIAL_NODES.DESTROY_LICENSES_FOR_TARGET_PUBLICKEY_AND_NODE,
                        this.getOwner(), targetPublicKey, nodeId1]);

                    hashes.push(Hash([SPECIAL_NODES.DESTROY_LICENSES_FOR_TARGET_PUBLICKEY_AND_NODE,
                        this.getOwner(), innerHash]));
                }
            }

            if (nodeId1) {
                // This hash lets an owner of a license destroy all licenses for a specific node.
                // This is how indestructible licensed nodes are deleted, by destroying all their licenses.
                //
                const innerHash = Hash([SPECIAL_NODES.DESTROY_LICENSES_FOR_NODE,
                    this.getOwner(), nodeId1]);

                hashes.push(Hash([SPECIAL_NODES.DESTROY_LICENSES_FOR_NODE,
                    this.getOwner(), innerHash]));
            }
        }

        if (this.getFriendACert()) {
            const certA = this.getFriendACertObject();
            hashes.push(...certA.getAchillesHashes());
        }

        if (this.getFriendBCert()) {
            const certB = this.getFriendBCertObject();
            hashes.push(...certB.getAchillesHashes());
        }

        return hashes;
    }

    /**
     * Calculate the shared hash for this license for which it might share with similar nodes to be able to enforce the uniqueness of nodes.
     * Hash all fields except creationTime which is the only field allowed to vary but still sharing the same hash.
     * @returns hash
     */
    public hashShared(): Buffer {
        return this.model.hash(["creationTime"]);
    }

    /**
     * Enforces so that licenses only can be sent embedded to targetPublicKey if the
     * sourcePublicKey (sender) is the current license target.
     *
     * @param sourcePublicKey the public key embedding, signing and sending the node.
     * @param targetPublicKey the target public key the embedding is towards.
     *
     * @returns true if this node can be sent as embedded.
     */
    public canSendEmbedded(sourcePublicKey: Buffer, targetPublicKey: Buffer): boolean {
        if (!this.allowEmbed()) {
            return false;
        }

        const extensions = this.getExtensions();

        if (extensions === undefined || extensions <= 0) {
            return false;
        }

        if (!this.allowEmbed()) {
            return false;
        }

        if (sourcePublicKey.equals(targetPublicKey)) {
            return false;
        }

        if (this.getTargetPublicKey()?.equals(sourcePublicKey)) {
            return true;
        }

        return false;
    }

    public canReceivePrivately(sourcePublicKey: Buffer, targetPublicKey: Buffer): boolean {
        if (this.getOwner()?.equals(targetPublicKey)) {
            // If the receiver created the license then they can hold it.
            return true;
        }

        if (this.getTargetPublicKey()?.equals(targetPublicKey)) {
            // If the receiver is the target of the license then they can hold it.
            return true;
        }

        if (this.getJumpPeerPublicKey()?.equals(targetPublicKey)) {
            // If the possessor is designated intermediary holder of the
            // license then they can hold it.
            // Note that this doesn't grant the possessor rights to the licensed
            // data only that they can help funnel the license to where it shold be.
            return true;
        }

        if (this.allowTargetSendPrivately()) {
            // If the source is the target then we accept to store this license.
            if (this.getTargetPublicKey()?.equals(sourcePublicKey)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Check if this node can be sent privately to targetPublicKey from sourcePublicKey.
     *
     * A private node is a node which is not public and it not licensed.
     *
     * All license nodes are private.
     *
     * Allow to send if:
     * targetPublicKey is the owner of the license.
     * targetPublicKey is the target of the license.
     * targetPublicKey is the jumpPeerPublicKey of the license.
     * sourcePublicKey is the target of the license and allowTargetSendPrivately is true.
     *
     * @param sourcePublicKey the public key of the peer holding the node.
     * @param targetPublicKey the public key the node is to be sent to.
     *
     * @returns whether or not this node can send privately
     */
    public canSendPrivately(sourcePublicKey: Buffer, targetPublicKey: Buffer): boolean {
        if (this.getOwner()?.equals(targetPublicKey)) {
            return true;
        }

        if (this.getTargetPublicKey()?.equals(targetPublicKey)) {
            return true;
        }

        if (this.getJumpPeerPublicKey()?.equals(targetPublicKey)) {
            // If the target is designated intermediary holder of the
            // license then they can hold it.
            // Note that this doesn't grant the possessor rights to the licensed
            // data only that they can help funnel the license to where it shold be.
            return true;
        }

        // If allowTargetSendPrivately() is set then the client can always share
        // the license if the client is the target of the license.
        if (this.allowTargetSendPrivately()) {
            if (this.getTargetPublicKey()?.equals(sourcePublicKey)) {
                return true;
            }
        }

        return false;
    }

    /**
     * If set then a client who is the target of a license is allowed to send this license to any other peer.
     * This is useful when proving to a third party that we have rights some data but that party can't themselves issue a license to us for the data.
     * This flag makes it possible for the target of the license to send the license to a third party (without any modifications) so that the
     * third party can understand that the target has rights to same data and that data is to be sent to the target (who already has the license for the data).
     * @param allowSend
     */
    public setAllowTargetSendPrivately(allowSend: boolean = true) {
        this.setLicenseConfigBit(LicenseConfig.ALLOW_TARGET_SEND_PRIVATELY, allowSend);
    }

    /**
     * @returns true if is set
     */
    public allowTargetSendPrivately(): boolean {
        return this.isLicenseConfigBitSet(LicenseConfig.ALLOW_TARGET_SEND_PRIVATELY);
    }

    /**
     * If set then this license cannot license nodes created prior to when the license was created.
     * This restriction is only enforced when a node is leveraging anohter node's license.
     * @param disallow
     */
    public setDisallowRetroLicensing(disallow: boolean = true) {
        this.setLicenseConfigBit(LicenseConfig.DISALLOW_RETRO_LICENSING, disallow);
    }

    /**
     * @returns true if set
     */
    public disallowRetroLicensing(): boolean {
        return this.isLicenseConfigBitSet(LicenseConfig.DISALLOW_RETRO_LICENSING);
    }

    /**
     * This setting is independant of restrictiveModeManager.
     *
     * @param isWriter true if the target of this license has write permissions below a restrictive node.
     */
    public setRestrictiveModeWriter(isWriter: boolean = true) {
        this.setLicenseConfigBit(LicenseConfig.RESTRICTIVEMODE_WRITER, isWriter);
    }

    /**
     * @returns true if the target of this license has write permissions below a restrictive node.
     */
    public isRestrictiveModeWriter(): boolean {
        return this.isLicenseConfigBitSet(LicenseConfig.RESTRICTIVEMODE_WRITER);
    }

    /**
     * If set then the target of the license has manager permissions below a write restrictive node.
     * Manager permissions means that the target user can "end" writers modes for all modes for which is has manager permissions.
     *
     * This setting is independent of restrictiveModeWriter. Both can be set, but manager permissions does not automatically bring writer permissions.
     *
     * @param isManager true if the target of this license has manager permissions below a restrictive node.
     */
    public setRestrictiveModeManager(isManager: boolean = true) {
        this.setLicenseConfigBit(LicenseConfig.RESTRICTIVEMODE_MANAGER, isManager);
    }

    /**
     * @returns true if the target of this license has manager permissions below a restrictive node.
     */
    public isRestrictiveModeManager(): boolean {
        return this.isLicenseConfigBitSet(LicenseConfig.RESTRICTIVEMODE_MANAGER);
    }

    /**
     * @param isDynamic true if this license uses dynamic friend certs.
     */
    public setHasDynamicFriendCert(isDynamic: boolean = true) {
        this.setLicenseConfigBit(LicenseConfig.HAS_DYNAMIC_FRIENDCERT, isDynamic);
    }

    /**
     * @returns true if this license uses dynamic friend certs.
     */
    public hasDynamicFriendCert(): boolean {
        return this.isLicenseConfigBitSet(LicenseConfig.HAS_DYNAMIC_FRIENDCERT);
    }

    /**
     * @param index the bit index in the integer.
     * @param isSet state to set the bit to.
     */
    protected setLicenseConfigBit(index: LicenseConfig, isSet: boolean) {
        const mask = 1 << index;
        const config = this.model.getNumber("licenseConfig") || 0;
        if (isSet) {
            this.model.setNumber("licenseConfig", config | mask);
        }
        else {
            this.model.setNumber("licenseConfig", config & ~mask);
        }
    }

    /**
     * @param index the bit index to read in the user config integer.
     * @returns the state of the configuration bit.
     */
    protected isLicenseConfigBitSet(index: LicenseConfig): boolean {
        const config = this.model.getNumber("licenseConfig") || 0;
        return Boolean(config & (2**index));
    }

    /**
     * Sets the license config integer.
     *
     * @param config integer.
     */
    public setLicenseConfig(config: number | undefined) {
        this.model.setNumber("licenseConfig", config);
    }

    /**
     * @returns the license config integer.
     */
    public getLicenseConfig(): number | undefined {
        return this.model.getNumber("licenseConfig");
    }

    /**
     * Override to mute, since this field is not applicable to License.
     */
    public setId2(id2: Buffer | undefined) {  //eslint-disable-line @typescript-eslint/no-unused-vars
        // NOOP.
    }

    /**
     * Override to mute, since this field is not applicable to License.
     */
    public setNetwork(network: Buffer | undefined) {  //eslint-disable-line @typescript-eslint/no-unused-vars
        // NOOP.
    }

    /**
     * Override to mute, since this field is not applicable to License.
     */
    public setLicenseMinDistance(minDistance: number | undefined) {  //eslint-disable-line @typescript-eslint/no-unused-vars
        // NOOP.
    }

    /**
     * Override to mute, since this field is not applicable to License.
     */
    public setLicenseMaxDistance(minDistance: number | undefined) {  //eslint-disable-line @typescript-eslint/no-unused-vars
        // NOOP.
    }

    /**
    * Set properties of node.
    * @params params node params to set.
    */
    public setParams(params: LicenseParams) {
        super.setParams(params);
        if (params.licenseConfig !== undefined) {
            this.setLicenseConfig(params.licenseConfig);
        }
        if (params.targetPublicKey !== undefined) {
            this.setTargetPublicKey(params.targetPublicKey);
        }
        if (params.terms !== undefined) {
            this.setTerms(params.terms);
        }
        if (params.extensions !== undefined) {
            this.setExtensions(params.extensions);
        }
        if (params.friendLevel !== undefined) {
            this.setFriendLevel(params.friendLevel);
        }
        if (params.friendCertA !== undefined) {
            this.setFriendACert(params.friendCertA);
        }
        if (params.friendCertB !== undefined) {
            this.setFriendBCert(params.friendCertB);
        }
        if (params.licenseTransientConfig !== undefined) {
            this.setLicenseTransientConfig(params.licenseTransientConfig);
        }
        if (params.allowTargetSendPrivately !== undefined) {
            this.setAllowTargetSendPrivately(params.allowTargetSendPrivately);
        }
        if (params.disallowRetroLicensing !== undefined) {
            this.setDisallowRetroLicensing(params.disallowRetroLicensing);
        }
        if (params.isRestrictiveModeWriter !== undefined) {
            this.setRestrictiveModeWriter(params.isRestrictiveModeWriter);
        }
        if (params.isRestrictiveModeManager !== undefined) {
            this.setRestrictiveModeManager(params.isRestrictiveModeManager);
        }
        if (params.hasDynamicFriendCert !== undefined) {
            this.setHasDynamicFriendCert(params.hasDynamicFriendCert);
        }
        if (params.isDynamicFriendCertsActive !== undefined) {
            this.setDynamicFriendCertsActive(params.isDynamicFriendCertsActive);
        }
        if (params.nodeId1 !== undefined) {
            this.setNodeId1(params.nodeId1);
        }
        if (params.jumpPeerPublicKey !== undefined) {
            this.setJumpPeerPublicKey(params.jumpPeerPublicKey);
        }
        if (params.parentPathHash !== undefined) {
            this.setParentPathHash(params.parentPathHash);
        }
        if (params.maxDistance !== undefined) {
            this.setMaxDistance(params.maxDistance);
        }
    }

    /**
     * @returns properties of node.
     */
    public getParams(): LicenseParams {
        const licenseConfig = this.getLicenseConfig();
        const targetPublicKey = this.getTargetPublicKey();
        const terms = this.getTerms();
        const extensions = this.getExtensions();
        const friendLevel = this.getFriendLevel();
        const friendCertA = this.getFriendACert();
        const friendCertB = this.getFriendBCert();
        const licenseTransientConfig = this.getLicenseTransientConfig();
        const allowTargetSendPrivately = this.allowTargetSendPrivately();
        const disallowRetroLicensing = this.disallowRetroLicensing();
        const isRestrictiveModeWriter = this.isRestrictiveModeWriter();
        const isRestrictiveModeManager = this.isRestrictiveModeManager();
        const hasDynamicFriendCert = this.hasDynamicFriendCert();
        const isDynamicFriendCertsActive = this.isDynamicFriendCertsActive();
        const nodeId1 = this.getNodeId1();
        const jumpPeerPublicKey = this.getJumpPeerPublicKey();
        const parentPathHash = this.getParentPathHash();
        const maxDistance = this.getMaxDistance();

        const nodeParams = super.getParams();
        // Remove properties from general node which are not used in License.
        delete nodeParams.id2;
        delete nodeParams.network;
        delete nodeParams.licenseMinDistance;
        delete nodeParams.licenseMaxDistance;

        return {
            ...nodeParams,
            licenseConfig,
            targetPublicKey,
            terms,
            extensions,
            friendLevel,
            friendCertA,
            friendCertB,
            licenseTransientConfig,
            allowTargetSendPrivately,
            disallowRetroLicensing,
            isRestrictiveModeWriter,
            isRestrictiveModeManager,
            hasDynamicFriendCert,
            isDynamicFriendCertsActive,
            nodeId1,
            jumpPeerPublicKey,
            parentPathHash,
            maxDistance
        };
    }

    public toString(short: boolean = false): string {
        const shortFields = ["id1", "parentId", "owner", "refId", "expireTime"];

        const longFields = ["id1", "parentId", "config", "owner", "refId", "creationTime",
            "expireTime", "difficulty", "blobHash", "blobLength",
            "region", "jurisdiction", "licenseConfig", "targetPublicKey", "terms",
            "extensions", "friendLevel", "jumpPeerPublicKey", "parentPathHash", "maxDistance",
            "transientConfig"];

        const fields = short ? shortFields : longFields;

        const o: any = {
            name: "License",
            type: this.getType(),
        };
        fields.forEach( fieldName => {
            o[fieldName] = this.model.getAny(fieldName);
        });

        return JSON.stringify(StripObject(o), null, 4);
    }
}
