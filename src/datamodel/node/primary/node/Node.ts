import nacl from "tweetnacl";

import * as work from "./work";

import {
    Model,
    Fields,
    FieldType,
    Filter,
    ModelType,
} from "../../../model";

import {
    KeyPair,
    NodeConfig,
    Signature,
    TransientConfig,
    Version,
    NodeParams,
} from "./types";

import {
    PRIMARY_INTERFACE_ID,
    CLASS_MAJOR_VERSION,
    CLASS_MINOR_VERSION,
    CLASS_PATCH_VERSION,
} from "./versionTypes";

import {
    Hash,
} from "../../../hash";

import {
    NodeInterface,
    PRIMARY_INTERFACE_NODE_ID,
} from "../interface/NodeInterface";

import {
    PrimaryNodeCertInterface,
} from "../../../cert/primary/interface/PrimaryNodeCertInterface";

import {
    DataModelInterface,
} from "../../../interface/DataModelInterface";

import {
    CertUtil,
} from "../../../../util/CertUtil";

import {
    RegionUtil,
} from "../../../../util/RegionUtil";

import {
    CopyBuffer,
} from "../../../../util/common";

import {
    MAX_LICENSE_DISTANCE,
} from "../../../../types";

const SIGNATURE_LENGTH  = 64;
const CRYPTO            = "ed25519";

const FIELDS: Fields = {
    id1: {  // The cryptographic ID of this node.
        name: "id1",
        type: FieldType.BYTE32,
        index: 0,
        hash: false,
    },
    id2: { // The dynamic ID attached to this node. If set then id2 needs to be mapped by the outer environment to "id1".
        name: "id2",
        type: FieldType.BYTE32,
        index: 1,
        hash: false,
    },
    parentId: { // the getId() of the parent node (id2 || id1)
        name: "parentId",
        type: FieldType.BYTE32,
        index: 2,
    },
    config: {
        name: "config",
        type: FieldType.UINT16BE,
        index: 3,
    },
    network: {
        name: "network",
        type: FieldType.BYTES,
        maxSize: 32,
        index: 4,
    },
    owner: {
        name: "owner",
        type: FieldType.BYTE32,
        index: 5,
    },
    signature: {
        name: "signature",
        type: FieldType.BYTES,
        maxSize: 3 * (SIGNATURE_LENGTH + 1),
        index: 6,
        hash: false,
    },
    creationTime: {
        name: "creationTime",
        type: FieldType.UINT48BE,
        index: 7,
    },
    expireTime: {
        name: "expireTime",
        type: FieldType.UINT48BE,
        index: 8,
    },
    difficulty: {
        name: "difficulty",
        type: FieldType.UINT8,
        index: 9,
    },
    nonce: {
        name: "nonce",
        type: FieldType.BYTE8,
        index: 10,
        hash: false,
    },
    refId: {
        name: "refId",
        type: FieldType.BYTE32,
        index: 11,
    },
    cert: {
        name: "cert",
        type: FieldType.BYTES,
        index: 12,
        maxSize: 896,
    },
    embedded: {
        name: "embedded",
        type: FieldType.BYTES,
        index: 13,
        maxSize: 4208,
    },
    blobHash: {
        name: "blobHash",
        type: FieldType.BYTE32,
        index: 14,
    },
    blobLength: {
        name: "blobLength",
        type: FieldType.UINT64BE,
        index: 15,
    },
    licenseMinDistance: {
        name: "licenseMinDistance",
        type: FieldType.UINT8,
        index: 16,
    },
    licenseMaxDistance: {
        name: "licenseMaxDistance",
        type: FieldType.UINT8,
        index: 17,
    },
    childMinDifficulty: {
        name: "childMinDifficulty",
        type: FieldType.UINT8,
        index: 18,
    },
    transientConfig: {
        name: "transientConfig",
        type: FieldType.UINT8,
        index: 19,
        transient: true,
    },
    copiedSignature: {
        name: "copiedSignature",
        type: FieldType.BYTES,
        maxSize: 3 * SIGNATURE_LENGTH,
        index: 20,
    },
    copiedParentId: {
        name: "copiedParentId",
        type: FieldType.BYTE32,
        index: 21,
    },
    copiedId1: {
        name: "copiedId1",
        type: FieldType.BYTE32,
        index: 22,
    },
    region: {
        name: "region",
        type: FieldType.STRING,
        maxSize: 2,
        index: 23,
    },
    jurisdiction: {
        name: "jurisdiction",
        type: FieldType.STRING,
        maxSize: 2,
        index: 24,
    },
};

/**
 * The Node is the abstract base class for all nodes to come.
 * See ./types.ts for a description on how node versioning works.
 * Nodes can also harbour embedded nodes.
 *
 * Some notes on "transient" values on nodes:
 * In general all data stored in a node is part of the hashing and id creation of the node and it is persisted as being part of the node (no surprise here).
 * Then we can also have "transient" values on nodes. These values are not part of hashing and are meant to be set on the node by the environment depending on circumstances.
 * So, transient values are important to be properly set for the graph it self to be correct. It is the Database which is responsible for applying and keeping the transient values up to date.
 * Some transient values can be set by the Database on a best effort basis, depending for example if the Database supports a particular transform function on fetch requests.
 * Transient values can in some circumstances be serialized and passed between peers, also sometimes get stores to disk.
 *
 * Some notes on "dynamic" values on nodes:
 * A node can have dnamic properties, which are set as active or inactive using transient values.
 *
 * General rules for embedding nodes:
 *  A node must have allowEmbed set to be able to be embedded.
 *  A node must have allowEmbedMove set if the embedder has a different parent ID.
 *  A private node can only be embedded by another private node.
 *      Internally permissions are validated recursively so that the stack of nodes validates.
 *      For example License allows owners to differ on embedded nodes while Data nodes require
 *      that there is only one owner.
 *      The Database checks permissions only on the outermost node.
 *  A public node can be embedded by both private and public nodes.
 *  A licensed node can be embedded by private, public and licensed nodes.
 *      Licenses are check recursively for each licensed node inside a stack of nodes.
 */
export abstract class Node implements NodeInterface {
    protected model: Model;
    protected cachedEmbeddedObject: DataModelInterface | undefined;
    protected cachedCertObject: PrimaryNodeCertInterface | undefined;
    protected cachedLicensingHashes: {[key: string]: Buffer[]} = {};

    /**
     * The deriving Node needs to call super.
     *
     * @param nodeType determines the model node type.
     * @param nodeFields specifies model fields property.
     */
    constructor(nodeType: ModelType, nodeFields: Fields) {
        if (nodeType[0] !== 0 || nodeType[1] !== PRIMARY_INTERFACE_ID) {  // Note: first byte is reserved to zero
            throw new Error("Mismatch of base standards");
        }
        const fields = {...FIELDS, ...nodeFields};
        this.model = new Model(nodeType, fields);

        this.setDynamicSelfActive(false);
        this.setDynamicCertActive(false);
        this.setDynamicEmbeddingActive(false);
        // Set default value for config as convenience.
        this.setConfig(0);
    }

    /**
     * Load model image Buffer.
     *
     * @param image the image data to load.
     * @param preserveTransient if true then also load any transient values into the model.
     *
     * @throws a string containing a message error when image load fails to decode or access the decoded input Buffer.
     */
    public load(image: Buffer, preserveTransient: boolean = false) {
        this.model.load(image, preserveTransient);
    }

    /**
     * Transient value set by Storage layer on object but is not stored.
     *
     * @param isActive state to be set
     */
    public setDynamicSelfActive(isActive: boolean = true) {
        this.setTransientBit(TransientConfig.DYNAMIC_SELF_ACTIVE, isActive);
    }

    /**
     * If true on dynamic nodes with id2 then this node is the current bearer of the ID.
     * This is a transient value set by an outside actor.
     *
     * @returns whether or not the node is the current bearer of id2.
     */
    public isDynamicSelfActive(): boolean {
        return this.isTransientBitSet(TransientConfig.DYNAMIC_SELF_ACTIVE);
    }

    /**
     * Transient value updated by updateDynamicStatus().
     *
     * @param isActive state to be set
     */
    protected setDynamicCertActive(isActive: boolean = true) {
        this.setTransientBit(TransientConfig.DYNAMIC_CERT_ACTIVE, isActive);
    }

    /**
     * If this node uses a dynamic cert and that cert is active then this function returns true 
     * Transient value updated by updateDynamicStatus().
     *
     * @returns whether or not the node has valid dynamic certs.
     */
    public isDynamicCertActive(): boolean {
        return this.isTransientBitSet(TransientConfig.DYNAMIC_CERT_ACTIVE);
    }

    /**
     * Transient value set by Storage layer on object.
     *
     * @param isActive state to be set.
     */
    public setDynamicEmbeddingActive(isActive: boolean = true) {
        this.setTransientBit(TransientConfig.DYNAMIC_EMBEDDING_ACTIVE, isActive);
    }

    /**
     * If this node uses dynamic cert and that cert is active then this function returns true.
     * This is a transient value set by the environment.
     *
     * @returns whether or not the node has valid dynamic embedded node.
     */
    public isDynamicEmbeddingActive(): boolean {
        return this.isTransientBitSet(TransientConfig.DYNAMIC_EMBEDDING_ACTIVE);
    }

    /**
     * Transient value set by Storage layer on object.
     *
     * @param isDestroyed state to be set.
     */
    public setDynamicDestroyed(isDestroyed: boolean = true) {
        this.setTransientBit(TransientConfig.DYNAMIC_DESTROYED, isDestroyed);
    }

    /**
     * If this node uses dynamic cert or embedded node and any object is destroyed then this function returns true 
     * This is a transient value set by the environment.
     *
     * @returns true if this node is destroyed, either directly or indirectly.
     */
    public isDynamicDestroyed(): boolean {
        return this.isTransientBitSet(TransientConfig.DYNAMIC_DESTROYED);
    }

    /**
     * Check for dynamic features and returns false if any of the fetures are not active.
     * @returns true if the node is active, false if inactive.
     */
    public isDynamicActive(): boolean {
        if (this.isDynamicDestroyed()) {
            return false;
        }
        if (this.hasDynamicSelf() && !this.isDynamicSelfActive()) {
            return false;
        }
        if (this.hasDynamicCert() && !this.isDynamicCertActive()) {
            return false;
        }
        if (this.hasDynamicEmbedding() && !this.isDynamicEmbeddingActive()) {
            return false;
        }
        return true;
    }

    /**
     * Look in this nodes all dynamic objects and update this nodes active status.
     */
    public updateDynamicStatus() {
        if (this.hasDynamicCert()) {
            const cert = this.getCertObject();
            cert.updateDynamicStatus();

            if (cert.isDynamicDestroyed()) {
                // Non reversible set
                this.setDynamicDestroyed();  // This is also destroyed.
                this.setDynamicCertActive(false);
            }
            else {
                const status = cert.isDynamicActive();
                this.setDynamicCertActive(status);
            }
        }
        if (this.hasDynamicEmbedding()) {
            const embedded = this.getEmbeddedObject();
            embedded.updateDynamicStatus();

            if (embedded.isDynamicDestroyed()) {
                this.setDynamicDestroyed();  // This is also destroyed.
                this.setDynamicEmbeddingActive(false);
            }
            else {
                const status = embedded.isDynamicActive();
                this.setDynamicEmbeddingActive(status);
            }
        }
    }

    /**
     * Extract all dynamic objects in this node, recursively.
     * This is used by the environment to assess if this node is active/inactive/destroyed.
     * @returns list of dynamic objects.
     */
    public extractDynamicObjects(): DataModelInterface[] {
        const objects: DataModelInterface[] = [];
        if (this.hasDynamicSelf()) {
            objects.push(this);
        }
        if (this.hasDynamicCert()) {
            const cert = this.getCertObject();
            objects.push(...cert.extractDynamicObjects());
        }
        if (this.hasDynamicEmbedding()) {
            const embedded = this.getEmbeddedObject();
            objects.push(...embedded.extractDynamicObjects());
        }
        return objects;
    }

    /**
     * @param length optional number of bytes if the node type to return.
     * @returns the nodes model type.
     */
    public abstract getType(length?: number): Buffer;

    /**
     * @param length optional number of bytes if the node type to return.
     * @returns the nodes model type.
     */
    public static GetType(length?: number): Buffer {
        throw new Error("Not implemented");
    }

    /**
     * Return the name of the crypto algo used.
     * @returns the crypto algo this node is using.
     */
    public getCrypto(): string {
        return CRYPTO;
    }

    /**
     * Return this abstract node's version.
     * @returns semver base version of this node.
     */
    public getBaseVersion(): Version {
        return [CLASS_MAJOR_VERSION, CLASS_MINOR_VERSION, CLASS_PATCH_VERSION];
    }

    /**
     * Return this abstract node's version.
     * @returns semver base version of this node.
     */
    public static GetBaseVersion(): Version {
        return [CLASS_MAJOR_VERSION, CLASS_MINOR_VERSION, CLASS_PATCH_VERSION];
    }

    /**
     * The deriving node must return its version.
     * @returns semver version of this node.
     */
    public abstract getVersion(): Version;

    /**
     * The deriving node must return its version.
     * @returns semver version of this node.
     */
    public static GetVersion(): Version {
        throw new Error("Not implemented");
    }

    /**
     * The deriving node has to define what certificates it accepts for signing the node.
     * This can be compared in primary+secondary interfaces or even more specific.
     * @param certType as 6 byte buffer.
     * @returns true if the provided cert type is accepted as a signing certificate.
     */
    public isCertTypeAccepted(certType: Buffer): boolean {
        return false;
    }

    /**
     * The deriving node has to define what other datamodels it accepts to have embedded.
     * This can be compared in primary+secondary interfaces or even more specific.
     * @param embeddedType as 6 byte buffer.
     * @returns true if the provided datamodel type is accepted as an embedded.
     */
    public isEmbeddedTypeAccepted(embeddedType: Buffer): boolean {
        return true;
    }

    /**
     * Get a field hashed and encoded as hexadecimal.
     * This is not useful for storing, it's just a unique string representation of the field data.
     *
     * @param field name to retrieve data from. "id" retrives node.getId() which is id2 or id1 if no id2 set.
     *
     * @returns field data in the form of hexadecimal string or undefined if the value was undefined.
     *
     * @throws a message error when unable to find the input field.
     */
    public getHashedValue(field: string): string | undefined {
        const value = field === "id" ? this.getId() : this.model.getAny(field);
        if (value === undefined) {
            return undefined;
        }
        return Hash([value]).toString("hex");
    }

    /**
     * Validate node.
     *
     * Check values in this node so that they are valid.
     * Then if there is an embedded node then check so that node is
     * valid in perspective of beeing embedded into this node, if deepValidate is true.
     *
     * @param deepValidate if 1 (default) then also recursively deep validate embedded nodes and certs.
     * If the node cannot unpack the stack it self then use the Decoder to unpack it prior to
     * running a deep validation.
     * If 2 then validate but skip anything which involves signatures (used if node is not fully signed yet).
     * if 0 do not deep validate.
     * @param timeMS if provided then the node is also checked to be valid at the time given by timeMS.
     * @returns a tuple specifying whether the Node is valid or not, accompanied by an error message string when applicable.
     * Possible cases for invalid Model are:
     * - Unable to export the existing data (model);
     * - Parent id has not been set;
     * - Owner has not been set;
     * - Configuration bits are missing;
     * - Creation time is unset or bigger than expiration time;
     * - Setting license when parent node license is unset;
     * - Allowing embed move when allow embed is unset;
     * - Work is invalid;
     * - Embedding validation fails verification;
     * - Incompatible permissions configuration or mismatch, such as private and public at the same time;
     * - Dynamic ID node has no id2 or network set;
     * - Dynamic Cert node has no cert set;
     */
    public validate(deepValidate: number = 1, timeMS?: number): [boolean, string] {
        // Export the data to have the model check for issues
        // This will also export cached cert objects and set their image data.
        try {
            this.export();
        }
        catch(e) {
            const message = (e as Error).message;
            return [false, `Model export failed with message: ${message}`];
        }

        if (this.getSignature()) {
            // This node is signed so we verify the id1
            const id1 = this.getId1();
            if (!id1) {
                return [false, "Missing id1 on signed node"];
            }
            if (!id1.equals(this.calcId1())) {
                return [false, "Calculated id1 on signed node mismatches set id1"];
            }
        }

        if (this.model.getBuffer("parentId") === undefined) {
            return [false, "Missing parentId"];
        }

        if (this.model.getBuffer("owner") === undefined) {
            return [false, "Missing owner"];
        }

        const config = this.model.getNumber("config");
        if (config === undefined) {
            return [false, "Missing config bits"];
        }

        const creationTime = this.model.getNumber("creationTime");
        if (creationTime === undefined) {
            return [false, "creationTime must be set"];
        }

        const expireTime = this.model.getNumber("expireTime");
        if (expireTime !== undefined) {
            if (creationTime >= expireTime) {
                return [false, "creationTime must be lesser than expireTime"];
            }
        }

        if (timeMS !== undefined && expireTime !== undefined && expireTime <= timeMS) {
            return [false, "Node has expired compared to given timestamp"];
        }

        if (timeMS !== undefined && creationTime > timeMS) {
            return [false, "Node is not yet valid in time compared to given timestamp"];
        }

        if (!this.isLicensed() && (this.model.getNumber("licenseMinDistance") !== undefined || this.model.getNumber("licenseMaxDistance") !== undefined)) {
            return [false, `License min and max distance cannot be set if node is not licensed`];
        }

        if (this.hasRightsByAssociation() && (this.isLicensed() || this.isPublic())) {
            return [false, `A rightsByAssociation node must be private.`];
        }

        if (this.hasRightsByAssociation() && this.getRefId() === undefined) {
            return [false, `A rightsByAssociation node must have its refId set to the id1 of the node it is associating with.`];
        }

        if (this.hasRightsByAssociation() && this.allowEmbed()) {
            return [false, `A rightsByAssociation node cannot have allowEmbed set.`];
        }

        if (this.getLicenseMinDistance() > this.getLicenseMaxDistance()) {
            return [false, `License min distance cannot be greater than max distance`];
        }

        if (this.getLicenseMaxDistance() > MAX_LICENSE_DISTANCE) {
            return [false, `License max distance cannot be greater than ${MAX_LICENSE_DISTANCE}`];
        }

        if (this.allowEmbedMove() && !this.allowEmbed()) {
            return [false, `Allow embed move cannot be set if not allow embed is set`];
        }

        if (this.allowEmbedMove() && this.getLicenseMinDistance() > 0) {
            return [false, `Allow embed move cannot be set if licenseMinDistance > 0`];
        }

        const blobHash = this.getBlobHash();
        const blobLengthSet = this.getBlobLength() === undefined ? false : true;
        if ((blobLengthSet || blobHash) && (!blobLengthSet || !blobHash)) {
            return [false, `blobHash and blobLength must both be set, if set.`];
        }

        if (this.isPublic() && this.isLicensed()) {
            return [false, `Node cannot be licences and public at the same time`];
        }

        if (!this.isPrivate() && this.isIndestructible()) {
            return [false, `Node cannot be indestructible if not also private`];
        }

        if (this.hasDynamicCert()) {
            if (!this.hasCert()) {
                return [false, `A dynamic Cert node must have cert set`];
            }
        }

        if (this.hasDynamicEmbedding()) {
            if (!this.hasEmbedded()) {
                return [false, `A dynamic embedding node must have embedded set`];
            }
        }

        if (this.getCopiedSignature()) {
            if (!this.getCopiedNode()) {
                return [false, "The node does not validate as a copy"];
            }
        }

        if (this.getId2()) {
            if (!this.isCopy() && !this.hasDynamicSelf()) {
                return [false, `A node having id2 set must be a copy or must be flagged as hasDynamicSelf`];
            }
        }

        // Check dynamic ID node
        if (this.hasDynamicSelf()) {
            if (!this.getId2()) {
                return [false, `A dynamic ID node must have id2 set`];
            }
            if (this.getNetwork() === undefined) {
                return [false, `A dynamic ID node must have network set`];
            }
        }

        if (this.isLeaf() && (this.isBeginRestrictiveWriteMode() || this.isEndRestrictiveWriteMode())) {
            return [false, `A leaf node cannot have beginRestrictiveWriterMode or endRestrictiveWriterMode set`];
        }


        if (this.isLeaf()) {
            if (this.onlyOwnChildren()) {
                return [false, `A leaf node cannot have the onlyOwnChildren flag set`];
            }

            if (this.disallowPublicChildren()) {
                return [false, `A leaf node cannot have the disallowPublicChildren flag set`];
            }

            if (this.getChildMinDifficulty() !== undefined) {
                return [false, `A leaf node cannot have childMinDifficulty set`];
            }
        }

        if (!this.verifyWork()) {
            return [false, "Work does not verify"];
        }


        if (deepValidate > 0) {
            const embedValidation = this.validateEmbedding(deepValidate, timeMS);
            if (!embedValidation[0]) {
                return [false, `Could not validate embedded node: ${embedValidation[1]}`];
            }

            if (!this.hasCert()) {
                if (deepValidate === 1) {
                    if (this.getSignatures().length !== 1) {
                        return [false, "When not using cert nr of signatures must be exactly one"];
                    }
                }
            }

            if (this.hasCert()) {
                let certObject;
                try {
                    certObject = this.getCertObject();
                }
                catch(e) {
                    const message = (e as Error).message;
                    return [false, `Could not unpack cert: ${message}`];
                }

                const certIssuerPublicKey = certObject.getIssuerPublicKey();
                if (!certIssuerPublicKey || !this.getOwner()?.equals(certIssuerPublicKey)) {
                    return [false, "Node owner must match root certificate issuer"];
                }

                const valCert = certObject.validate(deepValidate, timeMS);
                if (!valCert[0]) {
                    return [false, `Cert did not validate: ${valCert[1]}`];
                }

                const multiSigThreshold = certObject.getMultiSigThreshold();
                if (multiSigThreshold !== undefined) {
                    if (deepValidate === 1) {
                        if (this.getSignatures().length !== multiSigThreshold) {
                            return [false, "Wrong count of signatures compared to cert's multi sig threshold"];
                        }
                    }
                }

                // Check that this node accepts the interface (or exact type) of this certificate.
                if (!this.isCertTypeAccepted(certObject.getType())) {
                    return [false, "Cert type is not accepted by node"];
                }

                if (certObject.isDynamic() !== this.hasDynamicCert()) {
                    return [false, "Node dynamic cert flag must match cert's dynamic flag"];
                }

                if (timeMS !== undefined) {
                    // If timeMS given then also explicitly run validate on the embedded node here.
                    const val = certObject.validate(deepValidate, timeMS);
                    if (!val[0]) {
                        return [false, `The sign cert used for this node does not validate for time given: ${timeMS}, reason: ${val[1]}`];
                    }
                }

                // Let the certificate validate against this node.
                const val = certObject.validateAgainstTarget(this.getParams());
                if (!val[0]) {
                    return [false, `The sign cert used for this node does not validate against this node, reason: ${val[1]}`];
                }
            }
        }

        return [true, ""];
    }

    /**
     * Validate this node in relation to what it embeds to see that it is valid.
     * This functions does not verify cryptographic signatures, it checks the given values of
     * this node in relation to the given values of the embedded node to see that they align.
     * Sub classes should extend this function and add validations as needed, also calling super.
     *
     * @param deepValidate 1 or 2
     * @param timeMS if provided then the node is also checked to be valid at the time given by timeMS.
     * @returns a tuple specifying whether the Node is valid or not, accompanied by an error message string when applicable.
     * Possible cases for invalid return values are:
     * - Node does not allow embedding;
     * - Node does not allow embedding move (parent change);
     */
    protected validateEmbedding(deepValidate: number, timeMS?: number): [boolean, string] {
        if (!this.getEmbedded()) {
            return [true, ""];
        }

        let embedded;
        try {
            embedded = this.getEmbeddedObject();
        }
        catch(e) {
            return [false, "Could not unpack embedded datamodel"];
        }

        // Check that this node accepts the embedded datamodel type.
        if (!this.isEmbeddedTypeAccepted(embedded.getType())) {
            return [false, "Embedded type is not accepted by node to embed"];
        }

        const val = embedded.validate(deepValidate, timeMS);
        if (!val[0]) {
            return [false, `The embedded datamodel does not validate: ${val[1]}`];
        }

        // Check if data model is of primary interface Node, in such case we need
        // to check some permissions.
        if (embedded.getType(2).equals(Buffer.from([0, PRIMARY_INTERFACE_NODE_ID]))) {
            const embeddedNode = embedded as NodeInterface;
            if (!embeddedNode.allowEmbed()) {
                return [false, `Embedded node does not allow embedding`];
            }
            const parentId = this.getParentId() || Buffer.alloc(0);
            if (! embeddedNode.getParentId()?.equals(parentId)) {
                if (!embeddedNode.allowEmbedMove()) {
                    return [false, `Embedded node does not allow embedding move, which is needed since parent is not the same.`];
                }
            }
            if (embeddedNode.isPrivate()) {
                // Embedded node is private, make sure that the embedding node is also private
                if (this.isPublic()) {
                    return [false, `Embedding node cannot be public when embedded node is private`];
                }
                if (this.isLicensed()) {
                    return [false, `Embedding node cannot be licensed when embedded node is private`];
                }
                // Note that some node types will allow different owners of the nodes and some node types
                // will require that both embedder and embedded have the same owner.
                // This is handled in each derived class.
            }
        }

        if (this.hasDynamicEmbedding() !== embedded.isDynamic()) {
            return [false, "Node and embedded datamodel do not match on their dynamic flags. hasDynamicEmbedding of node must match isDynamic of embedded datamodel"];
        }

        return [true, ""];
    }

    /**
     * @param exportTransient if true then also export fields marked as transient.
     * @returns exported data Buffer
     *
     * @throws a string containing a message error when unable to export the data model or any ambedded data model.
     */
    public export(exportTransient: boolean = false): Buffer {
        if (this.cachedCertObject) {
            this.setCert(this.cachedCertObject.export());
        }
        if (this.cachedEmbeddedObject) {
            this.setEmbedded(this.cachedEmbeddedObject.export());
        }
        return this.model.export(exportTransient);
    }

    /**
     * Sign the node in place.
     *
     * The owner publicKey must match the publicKey of the keyPair, unless a cert is given then
     * the publicKey must match the issuerPublicKey of the cert.
     * Note that if a cert is given but deepValidate is false, then this function cannot enforce this constraint, however such a wrongly signed node will not verify.
     *
     * If have configured a difficulty level then the work must already be done and set before signing.
     *
     * @param keyPair key pair used signing.
     * @param deepValidate if true (default) then run a deep validation prior to signing.
     *
     * @throws if validation or signing fails.
     */
    public sign(keyPair: KeyPair, deepValidate: boolean = true) {
        const val = this.validate(deepValidate ? 2 : 0);

        if (!val[0]) {
            throw new Error(`Could not validate node prior to signing: ${val[1]}`);
        }

        if (this.calcSignaturesNeeded() <= 0) {
            throw new Error("No more signatures expected");
        }

        // Will throw if mismatch is detected.
        this.enforceSigningKey(keyPair.publicKey);

        // Throws on badly formatted input.
        let message: Buffer = this.hash();

        // hash with existing signatures and their public keys
        const signatures: Signature[] = this.getSignatures();

        if (signatures.length > 0) {
            const signature = signatures[signatures.length - 1];
            message = Hash([signature.message, signature.publicKey, signature.signature, signature.index]);
        }

        const signature = nacl.sign.detached(message, keyPair.secretKey);
        this.addSignature(Buffer.from(signature), keyPair.publicKey);
        this.setId1(this.calcId1());
    }

    /**
     * Validate that the signing key matches the cert.
     * Note that if using a cert then deepValidate must be set to true to actually validate this.
     *
     * @param publicKey The signing public key
     *
     * @returns the index of the targetPublicKey matching the signing publicKey
     * @throws if a mismatch is detected.
     */
    public enforceSigningKey(publicKey: Buffer): number {
        const index = this.getEligibleSigningPublicKeys().findIndex( targetPublicKey => targetPublicKey.equals(publicKey) );

        if (index === -1) {
            throw new Error("Signing key must match one of the eligible signing keys.");
        }

        return index;
    }

    /**
     * This hashed is used when calculating the nonce.
     * @returns hash of the model excluding nonce, id1 and id2.
     **/
    public hash0(): Buffer {
        // Make cached objects are set properly.
        //
        if (this.cachedCertObject && !this.getCert()) {
            this.setCert(this.cachedCertObject.export());
        }

        if (this.cachedEmbeddedObject && !this.getEmbedded()) {
            this.setEmbedded(this.cachedEmbeddedObject.export());
        }

        return Hash(this.model.getHashable());
    }

    /**
     * This hash is used when calculating id2 and the final hash.
     * @returns hash of hash0 and the nonce.
     **/
    public hash1(): Buffer {
        return Hash([this.hash0(), this.getNonce()]);
    }

    /**
     * @returns hash of hash1 and id2.
     **/
    public hash(): Buffer {
        return Hash([this.hash1(), this.getId2()]);
    }

    /**
     * Calculate the shared hash for this node for which it might share with similar nodes.
     * @returns hash
     */
    public hashShared(): Buffer {
        // By default we hash id1 as shared hash which means this hash is not shard with any other node.
        // Override this in derived implementation which want to leverage IS_UNIQUE to
        // hash the fields which make up the shared values.
        return Hash([this.getId1()]);
    }

    /**
     * @returns hash of the hash and the signature to produce a unique ID.
     * @throws an error message when unable to retrieve signature.
     **/
    public calcId1(): Buffer {
        const signature = this.getSignature();
        if (!signature) {
            throw new Error("Missing signature when calculating id1");
        }
        return Hash([this.hash(), signature]);
    }

    /**
     * Calculate a unique ID2 stemming from this node.
     * @returns hash of the model, the nonce, owner and the network
     * @throws an error message when unable to retrieve the current node owner and network settings
     **/
    public calcId2(): Buffer {
        const owner = this.getOwner();
        const network = this.getNetwork();
        if (owner === undefined || network === undefined) {
            throw new Error("Owner and network must be set when calculating id2");
        }
        return Hash([this.hash1(), owner, network]);
    }

    /**
     * Verify the integrity of this node and any embedded nodes and certs.
     * After a successful signature verification it also runs a deep validation.
     *
     * @returns true if node cryptographically deep verifies and deep validates.
     * @throws on malformed input.
     */
    public verify(): boolean {
        try {
            if (this.hasEmbedded()) {
                const embedded = this.getEmbeddedObject();
                if (!embedded.verify()) {
                    return false;
                }
            }

            if (this.isCopy()) {
                const originalNode = this.getCopiedNode();
                if (!originalNode) {
                    return false;
                }

                if (!originalNode.verify()) {
                    return false;
                }
            }

            if (this.hasCert()) {
                const cert = this.getCertObject();

                if (!cert.verify()) {
                    return false;
                }
            }
        }
        catch(e) {
            return false;
        }

        const signatures: Signature[] = this.getSignatures();
        for (let i=0; i<signatures.length; i++) {
            const signature = signatures[i];

            // Throws on badly formatted input.
            if (!nacl.sign.detached.verify(signature.message, signature.signature, signature.publicKey)) {
                return false;
            }
        }

        const val = this.validate();
        if (val[0]) {
            return true;
        }

        return false;
    }

    /**
     * Verify that the calculated nonce matches.
     * @returns whether or not verification succeeded.
     *
     * @throws error message when unable to retrieve difficulty settings when nonce is set.
     * @throws error message when unable to retrieve current nonce when difficulty is set.
     */
    public verifyWork(): boolean {
        const difficulty = this.getDifficulty();
        const nonce = this.getNonce();
        if (difficulty === undefined) {
            if (nonce === undefined) {
                return true;
            }
            throw new Error("Cannot verify work. Difficulty must be set since nonce is set");
        }
        if (nonce === undefined) {
            throw new Error("Cannot verify work. Difficulty is set so nonce must also be set");
        }
        const message: Buffer = this.hash0();
        return work.verify(message, nonce, difficulty);
    }

    /**
     * Calculate the nonce according to the difficulty set and set it in the model.
     * Nonce is calculated on hash0.
     * Set nonce to undefined when difficulty is undefined.
     */
    public solveWork() {
        const difficulty = this.getDifficulty();
        if (difficulty === undefined) {
            this.setNonce(undefined);
            return;
        }
        const message: Buffer = this.hash0();
        const nonce = work.solve(message, difficulty);
        this.setNonce(nonce);
    }

    /**
     * Return the node id.
     *
     * @returns id2 when available, otherwise returns id1.
     */
    public getId(): Buffer | undefined {
        return this.model.getBuffer("id2") || this.model.getBuffer("id1");
    }

    /**
     * @returns the cryptographic id of the node.
     */
    public getId1(): Buffer | undefined {
        return this.model.getBuffer("id1");
    }

    /**
     * @param id1 the cryptographic id of the node.
     */
    public setId1(id1: Buffer) {
        this.model.setBuffer("id1", id1);
    }

    /**
     * @returns the allowed region for this node, if set.
     */
    public getRegion(): string | undefined {
        return this.model.getString("region");
    }

    /**
     * @param region set the required region for this node. ISO 3166-1.
     */
    public setRegion(region: string | undefined) {
        this.model.setString("region", region);
    }

    /**
     * @returns the allowed jurisdiction for this node, if set.
     */
    public getJurisdiction(): string | undefined {
        return this.model.getString("jurisdiction");
    }

    /**
     * @param jurisdiction set the required jurisdiction for this node. ISO 3166-1.
     */
    public setJurisdiction(jurisdiction: string | undefined) {
        this.model.setString("jurisdiction", jurisdiction);
    }

    /**
     * @returns the cryptographic id of the original node.
     */
    public getCopiedId1(): Buffer | undefined {
        return this.model.getBuffer("copiedId1");
    }

    /**
     * @param id1 the cryptographic id of the original node.
     */
    public setCopiedId1(id1: Buffer) {
        this.model.setBuffer("copiedId1", id1);
    }

    /**
     * @returns the dynamic node identifier id2.
     */
    public getId2(): Buffer | undefined {
        return this.model.getBuffer("id2");
    }

    /**
     * Set the id2 of the node.
     * The node has to be activated from the outside.
     *
     * @param id2 the dynamic node ID, if set to empty buffer then
     * it will set the calcId2 value of the node, so the node is the original id2 node.
     */
    public setId2(id2: Buffer | undefined) {
        if (id2 && id2.length === 0) {
            id2 = this.calcId2();
        }
        this.model.setBuffer("id2", id2);
    }

    /**
     * @param parentId the parent ID of this node.
     */
    public setParentId(parentId: Buffer | undefined) {
        this.model.setBuffer("parentId", parentId);
    }

    /**
     * @returns parent ID.
     */
    public getParentId(): Buffer | undefined {
        return this.model.getBuffer("parentId");
    }

    /**
     * @param parentId the parent ID of the original node.
     */
    public setCopiedParentId(parentId: Buffer | undefined) {
        this.model.setBuffer("copiedParentId", parentId);
    }

    /**
     * @returns parent ID of the original node.
     */
    public getCopiedParentId(): Buffer | undefined {
        return this.model.getBuffer("copiedParentId");
    }

    /**
     * @param config integer.
     */
    public setConfig(config: number) {
        this.model.setNumber("config", config);
    }

    /**
     * @returns config integer.
     */
    public getConfig(): number | undefined {
        return this.model.getNumber("config");
    }

    /**
     * Set this node to be a leaf node.
     * A leaf node cannot have any child nodes.
     * This is enforced by the Storage layer.
     *
     * @param isLeaf true to set as leaf node.
     */
    public setLeaf(isLeaf: boolean = true) {
        this.setConfigBit(NodeConfig.IS_LEAF, isLeaf);
    }

    /**
     * @returns the leaf config state.
     */
    public isLeaf(): boolean {
        return this.isConfigBitSet(NodeConfig.IS_LEAF);
    }

    /**
     * Mark this node has having a dynamic certificate.
     * @param isDynamic
     */
    public setHasDynamicCert(isDynamic: boolean = true) {
        this.setConfigBit(NodeConfig.HAS_DYNAMIC_CERT, isDynamic);
    }

    /**
     * Check if this node is marked as having dynamic cert.
     * @returns true if node uses dynamic cert.
     */
    public hasDynamicCert(): boolean {
        return this.isConfigBitSet(NodeConfig.HAS_DYNAMIC_CERT);
    }

    /**
     * If set then this node cannot be destroyed by offline destruction nodes.
     * Only private nodes are applicable for this setting.
     * Note that if this node does embed other nodes or uses cert then those might
     * be destructable and tear this node down with them even if this bit is set.
     * @param isIndestructible
     */
    public setIndestructible(isIndestructible: boolean = true) {
        this.setConfigBit(NodeConfig.IS_INDESTRUCTIBLE, isIndestructible);
    }

    /**
     * Check if this node is marked as being indestructible by offline destruction nodes.
     * Note that this is separate from the dynamic (online) node destroy property.
     * @returns true if node is indestructible.
     */
    public isIndestructible(): boolean {
        return this.isConfigBitSet(NodeConfig.IS_INDESTRUCTIBLE);
    }


    /**
     * Mark this node as having a dynamic node embedded.
     * @param isDynamic
    */
    public setHasDynamicEmbedding(isDynamic: boolean = true) {
        this.setConfigBit(NodeConfig.HAS_DYNAMIC_EMBEDDING, isDynamic);
    }

    public hasDynamicEmbedding(): boolean {
        return this.isConfigBitSet(NodeConfig.HAS_DYNAMIC_EMBEDDING);
    }

    /**
     * A node which has an id2 must be marked as dynamic self.
     *
     * @param isDynamic
     */
    public setHasDynamicSelf(isDynamic: boolean = true) {
        this.setConfigBit(NodeConfig.HAS_DYNAMIC_SELF, isDynamic);
    }

    /**
     * Return true if this nodes leverages dynamic ID id2.
     *
     * @returns the dynamic node identifier state
     */
    public hasDynamicSelf(): boolean {
        return this.isConfigBitSet(NodeConfig.HAS_DYNAMIC_SELF);
    }

    /**
     * @returns true if node leverages either dynamic IDs, dynamic certs or dynamic embeddings.
     */
    public isDynamic(): boolean {
        if (this.hasDynamicSelf() || this.hasDynamicCert() || this.hasDynamicEmbedding()) {
            return true;
        }
        return false;
    }

    /**
     * Check if this dynamic ID node is the original node creating the id2.
     * @returns true if original node
     */
    public isId2Original(): boolean {
        return this.hasDynamicSelf() && Boolean(this.getId2()?.equals(this.calcId2()));
    }

    /**
     * @param isPublic the public status flag
     */
    public setPublic(isPublic: boolean = true) {
        this.setConfigBit(NodeConfig.IS_PUBLIC, isPublic);
    }

    /**
     * @returns the public status flag
     */
    public isPublic(): boolean {
        return this.isConfigBitSet(NodeConfig.IS_PUBLIC);
    }

    /**
     * For licenses to be considered on a node it must have the isLicensed flag set.
     * @param isLicensed the status flag
     */
    public setLicensed(isLicensed: boolean = true) {
        this.setConfigBit(NodeConfig.IS_LICENSED, isLicensed);
    }

    /**
     * @returns the licensed status flag
     */
    public isLicensed(): boolean {
        return this.isConfigBitSet(NodeConfig.IS_LICENSED);
    }

    public setHasRightsByAssociation(hasRightsByAssociation: boolean = true) {
        this.setConfigBit(NodeConfig.HAS_RIGHTS_BY_ASSOCIATION, hasRightsByAssociation);
    }

    public hasRightsByAssociation(): boolean {
        return this.isConfigBitSet(NodeConfig.HAS_RIGHTS_BY_ASSOCIATION);
    }

    public isCopy(): boolean {
        return this.getCopiedSignature() !== undefined;
    }

    public getCopiedNode(): NodeInterface | undefined {
        const originalNode = this.copy();

        if (!originalNode) {
            return undefined;
        }

        originalNode.setSignature(this.getCopiedSignature());
        originalNode.setCopiedSignature(undefined);

        const copiedId1 = this.getCopiedId1();
        const id2 = this.getId2();
        if (copiedId1) {
            originalNode.setId1(copiedId1);
        }
        else if (id2) {
            originalNode.setId1(id2);
            originalNode.setId2(undefined);
        }

        originalNode.setCopiedId1(undefined);

        if (this.getCopiedParentId()) {
            originalNode.setParentId(this.getCopiedParentId());
            originalNode.setCopiedParentId(undefined);
        }

        // At this point the original node is restored.
        // Make sure the expected id1 can be recalculated.
        if (!originalNode.getId1()?.equals(originalNode.calcId1())) {
            return undefined;
        }

        // The originalNode also need to be verified.
        return originalNode;
    }

    public setDisallowParentLicensing(disallow: boolean = true) {
        this.setConfigBit(NodeConfig.DISALLOW_PARENT_LICENSING, disallow);
    }

    public disallowParentLicensing(): boolean {
        return this.isConfigBitSet(NodeConfig.DISALLOW_PARENT_LICENSING);
    }

    public setOnlyOwnChildren(onlyOwn: boolean = true) {
        this.setConfigBit(NodeConfig.ONLY_OWN_CHILDREN, onlyOwn);
    }

    public onlyOwnChildren(): boolean {
        return this.isConfigBitSet(NodeConfig.ONLY_OWN_CHILDREN);
    }

    public setDisallowPublicChildren(noPublicChildren: boolean = true) {
        this.setConfigBit(NodeConfig.DISALLOW_PUBLIC_CHILDREN, noPublicChildren);
    }

    public disallowPublicChildren(): boolean {
        return this.isConfigBitSet(NodeConfig.DISALLOW_PUBLIC_CHILDREN);
    }

    /**
     * A node which is not public nor licensed is considered "private".
     * What private means is node type dependant.
     * @returns the private flag which derives from isPublic and isLicensed.
     */
    public isPrivate(): boolean {
        return !this.isPublic() && !this.isLicensed();
    }

    /**
     * @param allowEmbed true to allow this node to be embedded (permissions apply).
     */
    public setAllowEmbed(allowEmbed: boolean = true) {
        this.setConfigBit(NodeConfig.ALLOW_EMBED, allowEmbed);
    }

    /**
     * @returns the embedding allowance status flag
     */
    public allowEmbed(): boolean {
        return this.isConfigBitSet(NodeConfig.ALLOW_EMBED);
    }

    /**
     * @param allowEmbedMove true allows embedded node to be embedded below other parent ID.
     */
    public setAllowEmbedMove(allowEmbedMove: boolean = true) {
        this.setConfigBit(NodeConfig.ALLOW_EMBED_MOVE, allowEmbedMove);
    }

    /**
     * @returns the embedding move status flag
     */
    public allowEmbedMove(): boolean {
        return this.isConfigBitSet(NodeConfig.ALLOW_EMBED_MOVE);
    }

    /**
     * This forces a group of sibling nodes below the same parent to only allow one node marked as unique which shares unique hashes.
     * Node not marked as unique are not affected by other nodes having unique constraints.
     *
     * @param isUnique
     */
    public setUnique(isUnique: boolean = true) {
        this.setConfigBit(NodeConfig.IS_UNIQUE, isUnique);
    }

    /**
     * @returns true if node marked as unique
     */
    public isUnique(): boolean {
        return this.isConfigBitSet(NodeConfig.IS_UNIQUE);
    }

    /**
     * Mark this node as being the parent of a restrictive sub tree.
     * This means that the database will only recognize sub nodes created by those who
     * have special licenses on this node.
     * @param restrictiveWriterMode
     */
    public setBeginRestrictiveWriteMode(restrictiveWriterMode: boolean = true) {
        this.setConfigBit(NodeConfig.IS_BEGIN_RESTRICTIVEWRITE_MODE, restrictiveWriterMode);
    }

    /**
     * The restrictive writer node it self must have the licensed flag set.
     * @returns true if this node is marked as being a restrictive parent node.
     */
    public isBeginRestrictiveWriteMode(): boolean {
        return this.isConfigBitSet(NodeConfig.IS_BEGIN_RESTRICTIVEWRITE_MODE);
    }

    /**
     * Mark this node as ending the restrictive mode.
     * This means that the need of special licenses does no more apply below this node.
     * @param endRestrictiveWriterMode
     */
    public setEndRestrictiveWriteMode(endRestrictiveWriterMode: boolean = true) {
        this.setConfigBit(NodeConfig.IS_END_RESTRICTIVEWRITE_MODE, endRestrictiveWriterMode);
    }

    /**
     * @returns true if this node is marked to end restrictive mode.
     */
    public isEndRestrictiveWriteMode(): boolean {
        return this.isConfigBitSet(NodeConfig.IS_END_RESTRICTIVEWRITE_MODE);
    }

    /**
     * @param owner public key of node owner.
     */
    public setOwner(owner: Buffer | undefined) {
        this.model.setBuffer("owner", owner);
    }

    /**
     * @returns owner public key.
     */
    public getOwner(): Buffer | undefined {
        return this.model.getBuffer("owner");
    }

    /**
     * A node having id2 needs a network for mapping id2 to id1.
     * @param network
     */
    public setNetwork(network: Buffer | undefined) {
        this.model.setBuffer("network", network);
    }

    /**
     * @returns network
     */
    public getNetwork(): Buffer | undefined {
        return this.model.getBuffer("network");
    }

    /**
     * Returns true if this node is licensed and maxDistance > 0,
     * Then this node can be licensed by licenses above this node.
     * @returns true if this node uses parent licenses.
     */
    public usesParentLicense(): boolean {
        return this.isLicensed() && this.getLicenseMaxDistance() > 0;
    }

    /**
     * Set the min distance to travel upwards before accepting a parent license.
     * @param distance if 0 it will default to undefined to save storage space.
     * 0 (or undefined) means accept sibling licenses.
     * 1 means accept from first parent and upwards.
     *
     * Note that the parent nodes own settings of min/maxLicenseDistance is not
     * taking into consideration when using parent licensing.
     */
    public setLicenseMinDistance(distance: number | undefined) {
        if (distance === 0) {
            distance = undefined;
        }
        this.model.setNumber("licenseMinDistance", distance);
    }

    /**
     * Return the min distance to travel upwrads before accepting a parent license.
     * 0 means accept sibling licenses.
     * 1 means accept from first parent and upwards.
     * @returns number
     */
    public getLicenseMinDistance(): number {
        return this.model.getNumber("licenseMinDistance") ?? 0;
    }

    /**
     * Set the max distance to travel upwards when accepting a parent license.
     * @param distance if 0 it will default to undefined to save storage space.
     * 0 (or undefined) means accept sibling licenses.
     * 1 means accept from first parent and upwards.
     */
    public setLicenseMaxDistance(distance: number | undefined) {
        if (distance === 0) {
            distance = undefined;
        }
        this.model.setNumber("licenseMaxDistance", distance);
    }

    /**
     * Return the max distance to travel upwards when accepting a parent license.
     * 0 means accept sibling licenses.
     * 1 means accept from first parent and upwards.
     * @returns number
     */
    public getLicenseMaxDistance(): number {
        return this.model.getNumber("licenseMaxDistance") ?? 0;
    }

    /**
     * Return a list of hashes for which this node is licensed against.
     * These hashes are matched against license hashes.
     * Note that hashes are returned also for public and private nodes even though
     * they are not licensed on fetching they can still have *write* licenses targeted at them.
     * @param clientPublicKey set this to match that the license is issued by this key.
     * @param targetPublicKey set this to match that the license is targeted at the specific key.
     * @param otherParentId if checking licenses for this node if it is embedded below a different parent node set this to override the actual parent node Id.
     * @returns list of hashes
     */
    public getLicensingHashes(clientPublicKey?: Buffer, targetPublicKey?: Buffer, otherParentId?: Buffer): Buffer[] {
        const parentId = otherParentId ?? this.getParentId();
        const keyStr = `${parentId?.toString("hex")}_${clientPublicKey?.toString("hex")}_${targetPublicKey?.toString("hex")}`;
        const cache = this.cachedLicensingHashes[keyStr] || [];
        if (cache.length > 0) {
            return cache;
        }
        const hashes: Buffer[] = [];

        this.getLicenseTypes().forEach( type => {
            hashes.push(Hash([type, parentId, this.getOwner(), this.getId1(), clientPublicKey, targetPublicKey]));
        });

        this.cachedLicensingHashes[keyStr] = hashes;
        return hashes;
    }

    /**
     * Return a list of hashes for which this node is destructed by.
     * @returns list of hashes
     */
    public getAchillesHashes(): Buffer[] {
        const hashes: Buffer[] = [];
        let node: NodeInterface = this as NodeInterface;

        if (node.isPrivate() && !node.isIndestructible()) {
            hashes.push(Hash([node.getOwner(), node.getOwner()]));
            hashes.push(Hash([node.getId1(), node.getOwner()]));
        }

        if (node.hasCert()) {
            hashes.push(...node.getCertObject().getAchillesHashes());
        }

        if (node.hasEmbedded()) {
            const embedded = node.getEmbeddedObject();
            if (CertUtil.IsCert(embedded.getType())) {
                hashes.push(...embedded.getAchillesHashes());
            }
            else {
                node = embedded as NodeInterface;
                hashes.push(...node.getAchillesHashes());
            }
        }

        return hashes;
    }

    /**
     * @param signature the cryptographic signature.
     */
    public setSignature(signature: Buffer | undefined) {
        this.model.setBuffer("signature", signature);
    }

    /**
     * @returns the signature
     */
    public getSignature(): Buffer | undefined {
        return this.model.getBuffer("signature");
    }

    public getSignatures(): Signature[] {
        const signature = this.getSignature();

        if (signature === undefined) {
            return [];
        }

        const targetPublicKeys = this.getEligibleSigningPublicKeys();

        // Throws on badly formatted input.
        let message: Buffer = this.hash();

        const signatures: Signature[] = [];

        let rest = CopyBuffer(signature);

        while (rest.length >= SIGNATURE_LENGTH + 1) {
            const index = rest.readUInt8(0);
            const signature = rest.slice(1, 1 + SIGNATURE_LENGTH);
            const publicKey = targetPublicKeys[index];

            if (publicKey === undefined) {
                throw new Error("Cannot match signature index to targetPublicKey");
            }

            const signatureObject: Signature = {
                crypto: this.getCrypto(),
                message,
                signature,
                publicKey,
                index,
            };

            signatures.push(signatureObject);

            message = Hash([signatureObject.message, signatureObject.publicKey, signatureObject.signature, signatureObject.index]);

            rest = CopyBuffer(rest.slice(SIGNATURE_LENGTH + 1));
        }

        if (rest.length > 0) {
            throw new Error("signatures does not contain exact mutliple of (SIGNATURE_LENGTH+1)");
        }

        return signatures;
    }

    public calcSignaturesNeeded(): number {
        let threshold = 1;

        if (this.hasCert()) {
            const certObject = this.getCertObject();
            threshold = certObject.getMultiSigThreshold() ?? 1;
        }

        return threshold - this.getSignatures().length;
    }

    /**
     * @returns all public keys eligible for signing.
     **/
    public getEligibleSigningPublicKeys(onlyNonUsed: boolean = false): Buffer[] {
        const targetPublicKeys: Buffer[] = [];

        if (!this.hasCert()) {
            const owner = this.getOwner();

            if (!owner) {
                throw new Error("Expecting owner to be set");
            }

            targetPublicKeys.push(owner);
        }
        else {
            const certObject = this.getCertObject();
            targetPublicKeys.push(...certObject.getTargetPublicKeys());
        }

        if (onlyNonUsed) {
            const signingPublicKeys = this.getSignatures().map( signature => signature.publicKey );
            return targetPublicKeys.filter( publicKey => {
                return signingPublicKeys.findIndex( publicKey2 => publicKey.equals(publicKey2) ) === -1;
            });
        }

        return targetPublicKeys;
    }

    public addSignature(signature: Buffer, publicKey: Buffer) {
        const index = this.getEligibleSigningPublicKeys().findIndex( targetPublicKey => targetPublicKey.equals(publicKey) );

        if (index === -1) {
            throw new Error("Public key not found in targetPublicKeys (or is already used to sign)");
        }

        if (this.getEligibleSigningPublicKeys(true).findIndex( targetPublicKey => targetPublicKey.equals(publicKey) ) === -1) {
            throw new Error("Public key already used to sign with");
        }

        const prefix = Buffer.alloc(1);
        prefix.writeUInt8(index, 0);
        const packed = Buffer.concat([prefix, signature]);
        this.setSignature(Buffer.concat([this.getSignature() ?? Buffer.alloc(0), packed]));
    }

    /**
     * @param signature the cryptographic signature of the original node.
     */
    public setCopiedSignature(signature: Buffer | undefined) {
        this.model.setBuffer("copiedSignature", signature);
    }

    /**
     * @returns the copied signature
     */
    public getCopiedSignature(): Buffer | undefined {
        return this.model.getBuffer("copiedSignature");
    }

    /**
     * @param creationTime unix time in milliseconds.
     */
    public setCreationTime(creationTime: number | undefined) {
        this.model.setNumber("creationTime", creationTime);
    }

    /**
     * @returns the node creation timestamp in unix time milliseconds.
     */
    public getCreationTime(): number | undefined {
        return this.model.getNumber("creationTime");
    }

    /**
     * @param expireTime UNIX time in milliseconds when this node expires and is no longer valid. Note that the node stops being valid on this time.
     */
    public setExpireTime(expireTime: number | undefined) {
        this.model.setNumber("expireTime", expireTime);
    }

    /**
     * @returns UNIX time in milliseconds when this node expires.
     */
    public getExpireTime(): number | undefined {
        return this.model.getNumber("expireTime");
    }

    /**
     * @param difficulty the number of bits which needs to be solved with work.
     */
    public setDifficulty(difficulty: number | undefined) {
        this.model.setNumber("difficulty", difficulty);
    }

    /**
     * @returns number of bits needed to calculate nonce.
     */
    public getDifficulty(): number | undefined {
        return this.model.getNumber("difficulty");
    }

    /**
     * @param nonce the solved work nonce.
     */
    public setNonce(nonce: Buffer | undefined) {
        this.model.setBuffer("nonce", nonce);
    }

    /**
     * @returns nonce the solved work nonce.
     */
    public getNonce(): Buffer | undefined {
        return this.model.getBuffer("nonce");
    }

    /**
     * @param difficulty the number of bits any child of
     * this node is required to have as difficulty.
     */
    public setChildMinDifficulty(difficulty: number | undefined) {
        this.model.setNumber("childMinDifficulty", difficulty);
    }

    /**
     * @returns number of bits required on child's difficulty.
     */
    public getChildMinDifficulty(): number | undefined {
        return this.model.getNumber("childMinDifficulty");
    }

    /**
     * @param refId reference to other node ID
     */
    public setRefId(refId: Buffer | undefined) {
        this.model.setBuffer("refId", refId);
    }

    /**
     * @returns refId
     */
    public getRefId(): Buffer | undefined {
        return this.model.getBuffer("refId");
    }

    /**
     * @param cert the exported cert image
     */
    public setCert(cert: Buffer | undefined) {
        this.model.setBuffer("cert", cert);
    }

    /**
     * @returns the exported cert image
     */
    public getCert(): Buffer | undefined {
        return this.model.getBuffer("cert");
    }

    /**
     * Helper function to detect if a cert is present either as raw image or as cached object.
     * @returns true if this node does use certificate for signing.
     */
    public hasCert(): boolean {
        if (this.getCert()) {
            return true;
        }
        if (this.cachedCertObject) {
            return true;
        }
        return false;
    }

    /**
     * For nodes having blobs the length of the blob needs to be set.
     * @param blobLength bytes of the blob.
     */
    public setBlobLength(blobLength: bigint | undefined) {
        this.model.setBigInt("blobLength", blobLength);
    }

    /**
     * @returns the length in bytes of the blob.
     */
    public getBlobLength(): bigint | undefined {
        return this.model.getBigInt("blobLength");
    }

    /**
     * The hash of the blob needs to be set.
     * @param blobHash the hash of the blob data.
     */
    public setBlobHash(blobHash: Buffer | undefined) {
        this.model.setBuffer("blobHash", blobHash);
    }

    /**
     * @returns the set blob hash.
     */
    public getBlobHash(): Buffer | undefined {
        return this.model.getBuffer("blobHash");
    }

    /**
     * @returns true if this node has a blob associated to it.
     */
    public hasBlob(): boolean {
        return this.getBlobHash() !== undefined;
    }

    /**
     * Set the cached cert object for this node.
     * This will be exported when exporting the node.
     */
    public setCertObject(cert: PrimaryNodeCertInterface | undefined) {
        if (cert && !this.isCertTypeAccepted(cert.getType())) {
            throw new Error("Cert type of cert object set is not accepted as cert in this node");
        }
        this.cachedCertObject = cert;
    }

    /**
     * Override to decode and instantiates a Cert object.
     * Only known cert types can be decoded, but other cert types which use the same interface
     * can be decoded by the outside and set as a cached object.
     *
     * @returns cert object, when available. Will attempt to decode the raw data if object not present.
     *
     * @throws an error message when unable to load the cert image data
     */
    public abstract getCertObject(): PrimaryNodeCertInterface;

    protected abstract decodeCert(image: Buffer): PrimaryNodeCertInterface;

    /**
     * @param embedded exported image of embedded node
     *
     * @throws when unable to find the embedded entry to set data to
     */
    public setEmbedded(embedded: Buffer | undefined) {
        this.model.setBuffer("embedded", embedded);
    }

    /**
     * Set the instantiated embedded node object.
     * This is useful to allow the outside to decode, instantiate and set the cached embedded node for this node in
     * the cases this node cannot decode the embedded node itself.
     * The embedded node has to use the same primary and secondary interface as this node expects.
     * @param node
     */
    public setEmbeddedObject(dataModel: DataModelInterface | undefined) {
        if (dataModel && !this.isEmbeddedTypeAccepted(dataModel.getType())) {
            throw new Error("Embedded type set is not accepted as by this node");
        }
        this.cachedEmbeddedObject = dataModel;
    }

    /**
     * Helper function to detect if an embedded node is present either as raw image or as cached object.
     * @returns true if this node does embed another node.
     */
    public hasEmbedded(): boolean {
        if (this.getEmbedded()) {
            return true;
        }
        if (this.cachedEmbeddedObject) {
            return true;
        }
        return false;
    }

    /**
     * Return the embedded node's image, if set.
     * Note that setting the cached embedded image with setEmbeddedObject will not automatically set
     * the embedded image, but it is set on export.
     * @returns the embedded data image set in the model.
     */
    public getEmbedded(): Buffer | undefined {
        return this.model.getBuffer("embedded");
    }

    /**
     * First hand return the cached embedded node object, if set.
     * Secondly if the embedded image is set then attempt to (recursively) decode that image to a node object.
     *
     * Deriving nodes need to override the decodeEmbedded function to decode the node types they natively support.
     * Any other node embeddings must be decoded by the outside and put on the object as cached using setEmbeddedObject().
     *
     * @returns the embedded Node instance.
     *
     * @throws if not able to return any object nor decode any object.
     */
    public getEmbeddedObject(): DataModelInterface {
        if (this.cachedEmbeddedObject) {
            return this.cachedEmbeddedObject;
        }
        const image = this.getEmbedded();
        if (!image) {
            throw new Error("Embedded node image expected");
        }
        this.cachedEmbeddedObject = this.decodeEmbedded(image);
        return this.cachedEmbeddedObject;
    }

    /**
     * Decode an image into a datamodel object.
     * Must be overridden in derived classes to properly handle all supported embedded datamodel types.
     * @throws if could not decode or if not a supported datamodel type.
     * Note that other datamodel types can be decoded by the outside and set to the object as the cachedEmbeddedObject object.
     */
    protected abstract decodeEmbedded(image: Buffer): DataModelInterface;

    /**
     * Suger function to create a new embedding node of the same type with
     * some fields preset and this node set as the embedded node.
     * The new node returned will at least need to be signed by the creator,
     * possibly also have some other fields set to make the emedding valid.
     * Deriving nodes need to override this.
     * @param targetPublicKey towards who is this embedding being created.
     * @param creationTime the creationTime of the embedding node, default is Date.now().
     * @returns embedding node or undefined if not allowed to embed.
     * @throws on embedding error (such as field overflow).
     */
    public embed(targetPublicKey: Buffer, creationTime?: number): NodeInterface | undefined {
        return undefined;
    }

    /**
     * Suger function to copy a node.
     *
     * The point of copying nodes is to have the same node but with a different
     * parent id. This is so that owners can reuse their data in multiple parts of the graph.
     *
     * All other parameters of the node (other than the parentId) must stay the same.
     *
     * A copied node with only an id1 (not an id2) will have its id1 set as id2 of the copy.
     * A copied node who has an id2 set (dynamic self) will have its id2 set as the id2 of the copy.
     *
     * The copy node will store some original properties which are used to restore
     * and verify the original node. This is important as it is part of verifying
     * that the copy node is a allowed copy of the original node.
     *
     * A duplicate node will have its id2 set to the copied nodes id.
     * A duplicate node can set its parentId to anything.
     * A duplicate node will get its own id1 and its own signature.
     *
     * A copy node has all properties exactly the same as the original, except:
     * - copiedSignature is set to original signature.
     * - copiedParentId is set to the original parentId if parentId changed in copy.
     * - copiedId is set to the original id1 IF the original has an id2 set.
     *
     * Using these saved properties the verificiation procedure can verify
     * that the copy is a copy of the original node with the id1 we are referencing.
     *
     * The original node is exported then loaded into a new object, finally its
     * properties are modified to become a copy.
     *
     * @param parentId optionally set this to set a new parentId for the copy.
     * If setting this later then set copiedParentId to the orignal parentId.
     *
     * @returns unsigned copy or undefined on error.
     * @throws is export/load procedure does not work.
     */
    public copy(parentId?: Buffer): NodeInterface {
        // This method must be overridden in subclass if it supports copy.
        throw new Error("copy not supported");
    }

    /**
     * Set a bit in the config integer.
     *
     * @param index the bit index in the integer.
     * @param isSet state to set the bit to.
     */
    protected setConfigBit(index: NodeConfig, isSet: boolean) {
        const mask = 1 << index;
        const config = this.model.getNumber("config") || 0;
        if (isSet) {
            this.model.setNumber("config", config | mask);
        }
        else {
            this.model.setNumber("config", config & ~mask);
        }
    }

    /**
     * @param index the bit index to read in the configuration integer.
     * @returns the state of the configuration bit.
     */
    protected isConfigBitSet(index: NodeConfig): boolean {
        const config = this.model.getNumber("config") || 0;
        return Boolean(config & (2**index));
    }

    /**
     * Set a bit in the transient state integer.
     *
     * @param index the bit index in the integer.
     * @param isSet state to set the bit to.
     */
    protected setTransientBit(index: TransientConfig, isSet: boolean) {
        const mask = 1 << index;
        const config = this.model.getNumber("transientConfig") || 0;
        if (isSet) {
            this.model.setNumber("transientConfig", config | mask);
        }
        else {
            this.model.setNumber("transientConfig", config & ~mask);
        }
    }

    /**
     * @param index the bit index to read in the transient integer.
     * @returns the state of the configuration bit.
     */
    protected isTransientBitSet(index: TransientConfig): boolean {
        const config = this.model.getNumber("transientConfig") || 0;
        return Boolean(config & (2**index));
    }

    /**
     * @returns transient the transient config integer.
     */
    public getTransientConfig(): number | undefined {
        return this.model.getNumber("transientConfig");
    }

    /**
     * @param transientConfig the transient config number.
     */
    public setTransientConfig(transientConfig: number | undefined) {
        this.model.setNumber("transientConfig", transientConfig);
    }

    /**
     * Hash the nodes transient values so they can be compared.
     * @returns hash
     */
    public hashTransient(): Buffer {
        return Hash([this.getTransientConfig()]);
    }

    /**
     * Check a list of filters against this node's model.
     * @param filters list of filters to compare to, if empty list then this function returns true.
     * @returns false if any filter does not match this node, true if all filters match.
     * @throws on badly formatted filters.
     */
    public checkFilters(filters: Filter[]): boolean {
        for (let index=0; index<filters.length; index++) {
            const filter = filters[index];
            if (!this.model.cmp(filter)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Check if this node if embedded can be sent to targetPublicKey via clientPublicKey.
     * Some nodes are not allowed to be sent as-is but when embedded they are allowed to be sent, for example when extending Licenses.
     * Note that the embedded node is fully exposed inside the embedding node, so this is not a privacy feature.
     *
     * @param clientPublicKey the public key embedding, signing and sending the node.
     * @param targetPublicKey the target public key the embedding is towards.
     *
     * @returns whether or not this node is allowed to be sent if embedded.
     */
    public canSendEmbedded(clientPublicKey: Buffer, targetPublicKey: Buffer): boolean {
        return false;
    }

    /**
     * Check if this node can be sent privately to targetPublicKey via clientPublicKey.
     * A private node is a node which is not public and it not licensed,
     * and in such case it is up to each node type to determine what private means.
     *
     * Override this in deriving nodes to implement the node types ow logic.
     * The default behaviour is that private nodes can only be sent from their owner to their owner.
     *
     * @param clientPublicKey the public key sending the node.
     * @param targetPublicKey the public key the node is to be sent to.
     *
     * @returns whether or not this node can send privately
     */
    public canSendPrivately(clientPublicKey: Buffer, targetPublicKey: Buffer): boolean {
        if ((clientPublicKey.equals(targetPublicKey))) {
            // Client is fetching for themselves, now check if this is the owner.
            if (this.getOwner()?.equals(clientPublicKey)) {
                // This is the clients own node
                // Check embedded nodes recursively
                try {
                    if (this.hasEmbedded()) {
                        const embedded = this.getEmbeddedObject();
                        if (embedded.getType(2).equals(Buffer.from([0, PRIMARY_INTERFACE_NODE_ID]))) {  // Check if data model is of primary interface Node
                            const embeddedNode = embedded as NodeInterface;
                            return embeddedNode.canSendPrivately(clientPublicKey, targetPublicKey);
                        }
                        else if (CertUtil.IsCert(embedded.getType())) {
                            // Certs can always be sent privately.
                            return true;
                        }
                        else {
                            // Unknown object type.
                            return false;
                        }
                    }
                }
                catch(e) {
                    return false;
                }
                return true;
            }
        }

        return false;
    }

    /**
     * This checks if a private node can be held privately by a specific client public key.
     *
     * Default behaviour is that only owner can hold private nodes.
     * Override this in deriving classes to define their restrictions on holding nodes privately.
     *
     * @param clientPublicKey the party in possession of the node.
     * @returns true if this node can be held privately.
     */
    public canHoldPrivately(clientPublicKey: Buffer): boolean {
        if (this.getOwner()?.equals(clientPublicKey)) {
            // This is the clients own node
            return true;
        }

        return false;
    }

    /**
     * This is used to be able to refuse nodes from entering the storage.
     *
     * Default behaviour is that only owner can hold private nodes.
     * Override this in deriving classes to define their restrictions on holding nodes privately.
     *
     * @param sourcePublicKey the public key from where the node came.
     * @param clientPublicKey the public key of the party in possession of the data.
     * @param targetPublicKey the public key of the who this data is stored on behalf of.
     * @returns true if this node can be received privately.
     */
    public canReceivePrivately(sourcePublicKey: Buffer, clientPublicKey: Buffer): boolean {
        if (this.getOwner()?.equals(clientPublicKey)) {
            // This is the clients own node
            return true;
        }

        return false;
    }

    /**
     * Return the license types which this node type recognizes as licenses.
     * Note return primary+secondary interface types (first four bytes) , not the full node type.
     * @returns an array of license types of primary + secondary interfaces (first four bytes).
     */
    public getLicenseTypes(): Buffer[] {
        return [];
    }

    /**
     * Recursively extract all signatures from this node, certs and all embedded nodes and their certs.
     * @returns list of signatures to be verified.
     * @throws on error and if embedded nodes cannot be decoded
     */
    public extractSignatures(): Signature[] {
        const signatures: Signature[] = [];

        if (this.hasCert()) {
            const certObject = this.getCertObject();
            signatures.push(...certObject.extractSignatures());
        }

        signatures.push(...this.getSignatures());

        if (this.hasEmbedded()) {
            const embeddedNode = this.getEmbeddedObject();
            signatures.push(...embeddedNode.extractSignatures());
        }

        if (this.isCopy()) {
            const originalNode = this.getCopiedNode();

            if (!originalNode) {
                throw "Could not get copied original node.";
            }

            signatures.push(...originalNode.getSignatures());
        }

        return signatures;
    }

    /**
     * Static helper function to generate a new key pair used for signing.
     * @returns a newly created key-pair for signing.
     */
    public static GenKeyPair(): KeyPair {
        const keyPair = nacl.sign.keyPair();
        return {
            publicKey: Buffer.from(keyPair.publicKey),
            secretKey: Buffer.from(keyPair.secretKey)
        };
    }

    /**
     * If this node has a limiting region check so that the query has an allowed region set.
     * Regions are also checked for Unions.
     *
     * For example if the query has region "SE", and the node has the region "EU" then that is allowed,
     * because SE if a member of the EU.
     * However the opposite is not allowed, if the query has the region "EU" but the node is restricted to
     * the "SE" region. Even though SE if part of EU there can be data which is not allowed to leave the SE region.
     *
     * @param targetRegion
     * @returns true if region is allowed (or no region is set on the node).
     */
    public checkRegion(targetRegion: string): boolean {
        const sourceRegion = this.getRegion();

        if (sourceRegion && sourceRegion.length > 0) {
            return RegionUtil.IsRegionAllowed(targetRegion, sourceRegion);
        }

        return true;
    }

    /**
     * Nodes can be limited to jurisdictions, which is not the same as regions.
     * While a region is a physical barrier to prevent data from crossing national borders,
     * jurisdiction is a statement of where the data has its legal jurisdiction, and the
     * consumer also needs to adhere to that jurisdiction to be able to read the data.
     *
     * @param jurisdiction
     * @returns true if jurisdiction matches (or if jurisdiction is not set on the node).
     */
    public checkJurisdiction(targetJurisdiction: string): boolean {
        const sourceJurisdiction = this.getJurisdiction();

        if (sourceJurisdiction && sourceJurisdiction ?.length > 0) {
            return RegionUtil.IsJurisdictionAllowed(targetJurisdiction, sourceJurisdiction);
        }

        return true;
    }

    /**
    * Set properties of node.
    * @params params node params to set.
    * @throws if modelType does not match
    */
    public setParams(params: NodeParams) {
        if (params.modelType && !params.modelType.equals(this.getType(params.modelType.length))) {
            throw new Error("modelType in setParams does not match type of model.");
        }
        if (params.id1 !== undefined) {
            this.setId1(params.id1);
        }
        if (params.copiedId1 !== undefined) {
            this.setCopiedId1(params.copiedId1);
        }
        if (params.id2 !== undefined) {
            this.setId2(params.id2);
        }
        if (params.parentId !== undefined) {
            this.setParentId(params.parentId);
        }
        if (params.copiedParentId !== undefined) {
            this.setCopiedParentId(params.copiedParentId);
        }
        if (params.config !== undefined) {
            this.setConfig(params.config);
        }
        if (params.network !== undefined) {
            this.setNetwork(params.network);
        }
        if (params.owner !== undefined) {
            this.setOwner(params.owner);
        }
        if (params.signature !== undefined) {
            this.setSignature(params.signature);
        }
        if (params.copiedSignature !== undefined) {
            this.setCopiedSignature(params.copiedSignature);
        }
        if (params.creationTime !== undefined) {
            this.setCreationTime(params.creationTime);
        }
        if (params.expireTime !== undefined) {
            this.setExpireTime(params.expireTime);
        }
        if (params.difficulty !== undefined) {
            this.setDifficulty(params.difficulty);
        }
        if (params.childMinDifficulty !== undefined) {
            this.setChildMinDifficulty(params.childMinDifficulty);
        }
        if (params.nonce !== undefined) {
            this.setNonce(params.nonce);
        }
        if (params.refId !== undefined) {
            this.setRefId(params.refId);
        }
        if (params.cert !== undefined) {
            this.setCert(params.cert);
        }
        if (params.embedded !== undefined) {
            this.setEmbedded(params.embedded);
        }
        if (params.blobHash !== undefined) {
            this.setBlobHash(params.blobHash);
        }
        if (params.blobLength !== undefined) {
            this.setBlobLength(params.blobLength);
        }
        if (params.licenseMinDistance !== undefined) {
            this.setLicenseMinDistance(params.licenseMinDistance);
        }
        if (params.licenseMaxDistance !== undefined) {
            this.setLicenseMaxDistance(params.licenseMaxDistance);
        }
        if (params.transientConfig !== undefined) {
            this.setTransientConfig(params.transientConfig);
        }
        if (params.isLeaf !== undefined) {
            this.setLeaf(params.isLeaf);
        }
        if (params.hasDynamicSelf !== undefined) {
            this.setHasDynamicSelf(params.hasDynamicSelf);
        }
        if (params.hasDynamicCert !== undefined) {
            this.setHasDynamicCert(params.hasDynamicCert);
        }
        if (params.hasDynamicEmbedding !== undefined) {
            this.setHasDynamicEmbedding(params.hasDynamicEmbedding);
        }
        if (params.isPublic !== undefined) {
            this.setPublic(params.isPublic);
        }
        if (params.isLicensed !== undefined) {
            this.setLicensed(params.isLicensed);
        }
        if (params.hasRightsByAssociation !== undefined) {
            this.setHasRightsByAssociation(params.hasRightsByAssociation);
        }
        if (params.allowEmbed !== undefined) {
            this.setAllowEmbed(params.allowEmbed);
        }
        if (params.allowEmbedMove !== undefined) {
            this.setAllowEmbedMove(params.allowEmbedMove);
        }
        if (params.isUnique !== undefined) {
            this.setUnique(params.isUnique);
        }
        if (params.isBeginRestrictiveWriteMode !== undefined) {
            this.setBeginRestrictiveWriteMode(params.isBeginRestrictiveWriteMode);
        }
        if (params.isEndRestrictiveWriteMode !== undefined) {
            this.setEndRestrictiveWriteMode(params.isEndRestrictiveWriteMode);
        }
        if (params.isIndestructible !== undefined) {
            this.setIndestructible(params.isIndestructible);
        }
        if (params.region !== undefined) {
            this.setRegion(params.region);
        }
        if (params.jurisdiction !== undefined) {
            this.setJurisdiction(params.jurisdiction);
        }
        if (params.disallowParentLicensing !== undefined) {
            this.setDisallowParentLicensing(params.disallowParentLicensing);
        }
        if (params.onlyOwnChildren !== undefined) {
            this.setOnlyOwnChildren(params.onlyOwnChildren);
        }
        if (params.disallowPublicChildren !== undefined) {
            this.setDisallowPublicChildren(params.disallowPublicChildren);
        }
        if (params.isDynamicSelfActive !== undefined) {
            this.setDynamicSelfActive(params.isDynamicSelfActive);
        }
        if (params.isDynamicCertActive !== undefined) {
            this.setDynamicCertActive(params.isDynamicCertActive);
        }
        if (params.isDynamicEmbeddingActive !== undefined) {
            this.setDynamicEmbeddingActive(params.isDynamicEmbeddingActive);
        }
        if (params.isDynamicDestroyed !== undefined) {
            this.setDynamicDestroyed(params.isDynamicDestroyed);
        }
    }

    /**
     * @returns properties of node.
     */
    public getParams(): NodeParams {
        const modelType = this.getType();
        const id1 = this.getId1();
        const id2 = this.getId2();
        const parentId = this.getParentId();
        const config = this.getConfig();
        const network = this.getNetwork();
        const owner = this.getOwner();
        const signature = this.getSignature();
        const signingPublicKeys = this.getSignatures().map( signature => signature.publicKey );
        const creationTime = this.getCreationTime();
        const expireTime = this.getExpireTime();
        const difficulty = this.getDifficulty();
        const childMinDifficulty = this.getChildMinDifficulty();
        const nonce = this.getNonce();
        const refId = this.getRefId();
        const cert = this.getCert();
        const embedded = this.getEmbedded();
        const blobHash = this.getBlobHash();
        const blobLength = this.getBlobLength();
        const licenseMinDistance = this.getLicenseMinDistance();
        const licenseMaxDistance = this.getLicenseMaxDistance();
        const transientConfig = this.getTransientConfig();
        const isLeaf = this.isLeaf();
        const hasDynamicSelf = this.hasDynamicSelf();
        const hasDynamicCert = this.hasDynamicCert();
        const hasDynamicEmbedding = this.hasDynamicEmbedding();
        const isPublic = this.isPublic();
        const isLicensed = this.isLicensed();
        const hasRightsByAssociation = this.hasRightsByAssociation();
        const allowEmbed = this.allowEmbed();
        const allowEmbedMove = this.allowEmbedMove();
        const isUnique = this.isUnique();
        const isBeginRestrictiveWriteMode = this.isBeginRestrictiveWriteMode();
        const isEndRestrictiveWriteMode = this.isEndRestrictiveWriteMode();
        const isIndestructible = this.isIndestructible();
        const region = this.getRegion();
        const jurisdiction = this.getJurisdiction();
        const isDynamicSelfActive = this.isDynamicSelfActive();
        const isDynamicCertActive = this.isDynamicCertActive();
        const isDynamicEmbeddingActive = this.isDynamicEmbeddingActive();
        const isDynamicDestroyed = this.isDynamicDestroyed();
        const disallowParentLicensing = this.disallowParentLicensing();
        const onlyOwnChildren = this.onlyOwnChildren();
        const disallowPublicChildren = this.disallowPublicChildren();

        return {
            modelType,
            id1,
            id2,
            parentId,
            config,
            network,
            owner,
            signature,
            signingPublicKeys,
            creationTime,
            expireTime,
            difficulty,
            childMinDifficulty,
            nonce,
            refId,
            cert,
            embedded,
            blobHash,
            blobLength,
            licenseMinDistance,
            licenseMaxDistance,
            transientConfig,
            isLeaf,
            hasDynamicSelf,
            hasDynamicCert,
            hasDynamicEmbedding,
            isPublic,
            isLicensed,
            hasRightsByAssociation,
            allowEmbed,
            allowEmbedMove,
            isUnique,
            isBeginRestrictiveWriteMode,
            isEndRestrictiveWriteMode,
            isIndestructible,
            region,
            jurisdiction,
            disallowParentLicensing,
            onlyOwnChildren,
            disallowPublicChildren,
            isDynamicSelfActive,
            isDynamicCertActive,
            isDynamicEmbeddingActive,
            isDynamicDestroyed,
        };
    }
}
