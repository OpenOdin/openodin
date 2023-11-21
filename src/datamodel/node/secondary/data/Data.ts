import {
    AuthCert,
} from "../../../cert/secondary/authcert/AuthCert";

import {
    FriendCert,
} from "../../../cert/secondary/friendcert/FriendCert";

import {
    DataCert,
    DATACERT_TYPE,
} from "../../../cert/secondary/datacert";

import {
    DataCertInterface,
} from "../../../cert/secondary/interface";

import {
    DataModelInterface,
} from "../../../interface/DataModelInterface";

import {
    Node,
    Version,
} from "../../primary/node";

import {
    Fields,
    FieldType,
    ModelType,
} from "../../../model";

import {
    StripObject,
} from "../../../../util/common";

import {
    DATA_NODE_TYPE,
    DataConfig,
    DataParams,
    SPECIAL_NODES,
} from "./types";

import {
    CLASS_MAJOR_VERSION,
    CLASS_MINOR_VERSION,
    CLASS_PATCH_VERSION,
} from "./versionTypes";

import {
    LICENSE_NODE_TYPE,
} from "../license/types";

import {
    NodeInterface,
} from "../../primary/interface/NodeInterface";

import {
    DataInterface,
} from "../interface/DataInterface";

/** The extra fields added on top of Node. */
const FIELDS: Fields = {
    dataConfig: {
        name: "dataConfig",
        type: FieldType.UINT8,
        index: 30,
    },
    // Optional user settable bits. Their meanings are undefined at this level.
    userConfig: {
        name: "userConfig",
        type: FieldType.UINT16LE,
        index: 31,
    },
    contentType: {
        name: "contentType",
        type: FieldType.STRING,
        index: 32,
        maxSize: 20,
    },
    data: {
        name: "data",
        type: FieldType.BYTES,
        index: 33,
        maxSize: 1024,
    },
};

/**
 * The Data node is a common node which could be used for many types of data.
 * Applications differ on data nodes on their content type.
 * The Database can handle special data nodes who have the special config bit set in special ways.
 * The data node can be licensed by the License node.
 */
export class Data extends Node implements DataInterface {
    protected cachedCertObject: DataCertInterface | undefined;

    /**
     * Instantiates a new Data node.
     *
     * @param nodeType set this from a deriving node, otherwise leave as default.
     * @param nodeFields set this from a derviing node, otherwise leave as default.
     */
    constructor(nodeType: ModelType = DATA_NODE_TYPE, nodeFields: Fields = {}) {
        const fields = {...FIELDS, ...nodeFields};
        super(nodeType, fields);
    }

    /**
     * @param length optional number of bytes if the node type to return.
     * @returns the Data node's model type.
     */
    public static GetType(length?: number): Buffer {
        length = length ?? DATA_NODE_TYPE.length;
        return DATA_NODE_TYPE.slice(0, length);
    }

    /**
     * @param length optional number of bytes if the node type to return.
     * @returns the Data node's model type.
     */
    public getType(length?: number): Buffer {
        length = length ?? DATA_NODE_TYPE.length;
        return DATA_NODE_TYPE.slice(0, length);
    }

    /**
     * @param certType the model type of the cert potentially signing for this node. First four bytes of the cert model type expected.
     * @returns true if cert type is of primary+secondary bytes of DATACERT_TYPE.
     */
    public isCertTypeAccepted(certType: Buffer): boolean {
        // Compare primary + secondary interfaces.
        return certType.slice(0, 4).equals(DATACERT_TYPE.slice(0, 4));
    }

    /**
     * Return this node's version.
     * @returns semver version of this node.
     */
    public getVersion(): Version {
        return [CLASS_MAJOR_VERSION, CLASS_MINOR_VERSION, CLASS_PATCH_VERSION];
    }

    /**
     * The deriving node must return its version.
     * @returns semver version of this node.
     */
    public static GetVersion(): Version {
        return [CLASS_MAJOR_VERSION, CLASS_MINOR_VERSION, CLASS_PATCH_VERSION];
    }


    /**
     * Sets the user config integer.
     *
     * @param config integer.
     */
    public setUserConfig(userConfig: number | undefined) {
        this.model.setNumber("userConfig", userConfig);
    }

    /**
     * @returns the user config integer.
     */
    public getUserConfig(): number | undefined {
        return this.model.getNumber("userConfig");
    }

    /**
     * @param index the bit index in the integer.
     * @param isSet state to set the bit to.
     */
    protected setUserConfigBit(index: number, isSet: boolean) {
        const mask = 1 << index;
        const config = this.model.getNumber("userConfig") || 0;
        if (isSet) {
            this.model.setNumber("userConfig", config | mask);
        }
        else {
            this.model.setNumber("userConfig", config & ~mask);
        }
    }

    /**
     * @param index the bit index to read in the user config integer.
     * @returns the state of the configuration bit.
     */
    protected isUserConfigBitSet(index: number): boolean {
        const config = this.model.getNumber("userConfig") || 0;
        return Boolean(config & (2**index));
    }

    /**
     * Sets the contentType field.
     *
     * @param contentType content type string to set.
     */
    public setContentType(contentType: string | undefined) {
        this.model.setString("contentType", contentType);
    }

    /**
     * @returns content type.
     */
    public getContentType(): string | undefined {
        return this.model.getString("contentType");
    }

    /**
     * Sets the data field.
     *
     * @param data data to be set.
     */
    public setData(data: Buffer | undefined) {
        this.model.setBuffer("data", data);
    }

    /**
     * @returns the value of the data field.
     */
    public getData(): Buffer | undefined {
        return this.model.getBuffer("data");
    }

    /**
     * Adds further checks to the validation of data nodes.
     * @see Node.validate().
     */
    public validate(deepValidate: number = 1, timeMS?: number): [boolean, string] {
        const validation = super.validate(deepValidate, timeMS);
        if (!validation[0]) {
            return validation;
        }

        if (this.isSpecial()) {
            const topic = this.getData()?.toString() ?? "";

            if (topic.startsWith(SPECIAL_NODES.DESTROY)) {
                if (!this.getRefId()) {
                    return [false, "Destroy node must have refId set"];
                }
            }
            else if (topic === SPECIAL_NODES.FRIENDCERT) {
                try {
                    const datamodel = this.getEmbeddedObject();
                    if (!datamodel.getType(4).equals(FriendCert.GetType(4))) {
                        return [false, "Special data node expecting embedded datamodel of FriendCertInterface"];
                    }
                }
                catch(e) {
                    return [false, "Special data node does not have friend cert properly embedded"];
                }
            }
            else {
                return [false, "Data node is marked as special but data topic is not recognized"];
            }
        }

        return [true, ""];
    }

    /**
     * Add to the check that the owner of this node and the embedded node are the same.
     * @see Node.validateEmbedding.
     */
    protected validateEmbedding(deepValidate: number = 1, timeMS?: number): [boolean, string] {
        const valid = super.validateEmbedding(deepValidate, timeMS);
        if (!valid[0]) {
            return valid;
        }
        if (!this.getEmbedded()) {
            return [true, ""];
        }

        let embedded;
        try {
            embedded = this.getEmbeddedObject();
        }
        catch(e) {
            return [false, "Could not unpack embedded node"];
        }

        const val = embedded.validate(deepValidate, timeMS);
        if (!val[0]) {
            return [false, `The embedded node does not validate: ${val[1]}`];
        }

        // Check if data model is of primary interface Node, in such case we need
        // to check some permissions.
        if (embedded.getType(2).equals(this.getType(2))) {
            const embeddedNode = embedded as NodeInterface;
            if (embeddedNode.isPrivate()) {
                // Embedded node is private, make sure that the nodes have the same owner.
                const owner = this.getOwner();
                if (!owner) {
                    return [false, "Missing owner"];
                }
                const owner2 = embeddedNode.getOwner();
                if (!owner2) {
                    return [false, "Missing owner in embedded node"];
                }
                if (!owner.equals(owner2)) {
                    return [false, "Owner of embedding data node must be same as the embedded node owner, since it is private"];
                }
            }
        }
        else if (embedded.getType(4).equals(FriendCert.GetType(4))) {
            // Is of FriendCertInterface
            // No constraints to validate.
            // Fall through.
        }
        else if (embedded.getType(4).equals(AuthCert.GetType(4))) {
            // Is of AuthCertInterface
            // No constraints to validate.
            // Fall through.
        }

        return [true, ""];
    }

    /**
     * Enforces so that private nodes can only be sent to targetPublicKey if it is the owner.
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

        if (this.isPrivate()) {
            // Private node can only be embedded to the same owner.
            if (!this.getOwner()?.equals(targetPublicKey)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Suger function to help embed this data node into another data node.
     * @param targetPublicKey towards who is this embedding being created.
     * @param creationTime the creationTime of the embedding node, default is Date.now().
     * @returns embedding node with this node set as its embedded image, or undefined if not allowed to embed.
     * @throws on embedding error (such as field overflow).
     */
    public embed(targetPublicKey: Buffer, creationTime?: number): DataInterface | undefined {
        if (!this.allowEmbed()) {
            return undefined;
        }
        const newNode = new Data();
        newNode.setCreationTime(creationTime ?? Date.now());
        newNode.setEmbedded(this.export());
        newNode.setEmbeddedObject(this);
        return newNode;
    }

    /**
     * Attempt to decode the given datamodel image as a datamodel we know.
     *
     * @param image raw datamodel image data.
     * @returns decoded and instantiated datamodel.
     * @throws an error when failing to decode the embedded datamodel image.
     */
    protected decodeEmbedded(image: Buffer): DataModelInterface {
        if (Data.GetType().equals(image.slice(0, 6))) {
            const node = new Data();
            node.load(image);
            return node;
        }
        else if (FriendCert.GetType().equals(image.slice(0, 6))) {
            const cert = new FriendCert();
            cert.load(image);
            return cert;
        }
        else if (AuthCert.GetType().equals(image.slice(0, 6))) {
            const cert = new AuthCert();
            cert.load(image);
            return cert;
        }
        throw new Error("Data node cannot natively decode given embedded datamodel image. Use the external decoder and set the decoded object as the cached object.");
    }

    /**
     * @see Node.copy()
     */
    public copy(parentId?: Buffer): DataInterface {
        const newNode = new Data();
        newNode.load(this.export());
        newNode.setCopiedSignature(this.getSignature());
        newNode.setSignature(undefined);

        if (parentId) {
            newNode.setCopiedParentId(this.getParentId());
            newNode.setParentId(parentId);
        }

        if (this.getId2()) {
            newNode.setCopiedId1(this.getId1()!);
        }

        newNode.setId2(this.getId());

        // Copy over any objects
        if (this.cachedEmbeddedObject) {
            newNode.setEmbeddedObject(this.cachedEmbeddedObject);
        }

        if (this.cachedCertObject) {
            newNode.setCertObject(this.cachedCertObject);
        }

        return newNode;
    }

    public getCopiedNode(): DataInterface | undefined {
        const originalNode = super.getCopiedNode();

        if (originalNode) {
            return originalNode as DataInterface;
        }

        return undefined;
    }

    /**
     * Return the license types which this node type recognizes as licenses.
     * Note return primary+secondary interface types (first four bytes) , not the full node type.
     * @returns an array of license types of primary + secondary interfaces (first four bytes).
     */
    public getLicenseTypes(): Buffer[] {
        return [LICENSE_NODE_TYPE.slice(0, 4)];
    }

    /**
     * Set the cert object uses for signing as the cached cert.
     * When exporting this node this cached cert will get exported and set as the certImage.
     * @param cert the certificate object.
     */
    public setCertObject(cert: DataCertInterface | undefined) {
        if (cert && !this.isCertTypeAccepted(cert.getType())) {
            throw new Error("Cert type of cert object set is not accepted as cert in this Data node");
        }
        this.cachedCertObject = cert;
    }

    /**
     * @returns either the ceched cert object or the decoded cert object.
     * @throws if no cert available to be returned or if cert cannot be decoded.
     */
    public getCertObject(): DataCertInterface {
        if (this.cachedCertObject) {
            return this.cachedCertObject;
        }
        const image = this.getCert();
        if (!image) {
            throw new Error("Expecting data cert image");
        }
        const cert = this.decodeCert(image);
        this.cachedCertObject = cert;
        return cert;
    }

    /**
     * Decode a image into a DataCert object.
     * @param image the cert image data.
     */
    protected decodeCert(image: Buffer): DataCertInterface {
        const cert = new DataCert();
        cert.load(image);
        return cert;
    }

    /**
     * Set a bit in the data config integer.
     * @param index the bit index in the integer.
     * @param isSet state to set the bit to.
     */
    protected setDataConfigBit(index: DataConfig, isSet: boolean) {
        const mask = 1 << index;
        const config = this.model.getNumber("dataConfig") || 0;
        if (isSet) {
            this.model.setNumber("dataConfig", config | mask);
        }
        else {
            this.model.setNumber("dataConfig", config & ~mask);
        }
    }

    /**
     * @param index the bit index to read in the configuration integer.
     * @returns the state of the configuration bit.
     */
    protected isDataConfigBitSet(index: DataConfig): boolean {
        const config = this.model.getNumber("dataConfig") || 0;
        return Boolean(config & (2**index));
    }

    /**
     * @param config integer.
     */
    public setDataConfig(dataConfig: number) {
        this.model.setNumber("dataConfig", dataConfig);
    }

    /**
     * @returns config integer.
     */
    public getDataConfig(): number | undefined {
        return this.model.getNumber("dataConfig");
    }

    /**
     * This bit set indicates to the Database that this node packs something which should be attended to.
     * The contentType of the node states exactly how this node is special.
     * An embedded special node is not treated in any special way by the Database.
     * @param isSpecial if true (default) then this data node is treated as "special" by the database.
     */
    public setSpecial(special: boolean = true) {
        this.setDataConfigBit(DataConfig.SPECIAL, special);
    }

    /**
     * @returns isSpecial if true then this data node is treated as "special" by the database.
     */
    public isSpecial(): boolean {
        return this.isDataConfigBitSet(DataConfig.SPECIAL);
    }

    /**
    * Set properties of node.
    * @params params node params to set.
    */
    public setParams(params: DataParams) {
        super.setParams(params);
        if (params.dataConfig !== undefined) {
            this.setDataConfig(params.dataConfig);
        }
        if (params.userConfig !== undefined) {
            this.setUserConfig(params.userConfig);
        }
        if (params.contentType !== undefined) {
            this.setContentType(params.contentType);
        }
        if (params.data !== undefined) {
            this.setData(params.data);
        }
        if (params.isSpecial !== undefined) {
            this.setSpecial(params.isSpecial);
        }
    }

    /**
     * @returns properties of node.
     */
    public getParams(): DataParams {
        const dataConfig = this.getDataConfig();
        const userConfig = this.getUserConfig();
        const contentType = this.getContentType();
        const data = this.getData();
        const isSpecial = this.isSpecial();

        return {
            ...super.getParams(),
            dataConfig,
            userConfig,
            contentType,
            data,
            isSpecial,
        };
    }

    public toString(short: boolean = false): string {
        const shortFields = ["id1", "id2", "parentId", "owner", "refId", "expireTime"];

        const longFields = ["id1", "id2", "parentId", "config", "network", "owner", "refId", "creationTime",
            "expireTime", "difficulty", "blobHash", "blobLength", "licenseMinDistance", "licenseMaxDistance",
            "childMinDifficulty", "region", "jurisdiction", "dataConfig", "userConfig", "contentType", "data",
            "transientConfig"];

        const fields = short ? shortFields : longFields;

        const o: any = {
            name: "Data",
            type: this.getType(),
        };
        fields.forEach( fieldName => {
            o[fieldName] = this.model.getAny(fieldName);
        });

        return JSON.stringify(StripObject(o), null, 4);
    }
}
