/**
 * At this level (3) a BaseDataNode is specialized into a DataNode.
 * A DataNode can be signed and packed.
 */

import {
    Fields,
    UnpackSchema,
    PackSchema,
    FieldType,
    FieldIterator,
} from "../../PackSchema";

import {
    ParseRawOrSchema,
    ParseSchemaType,
} from "../../../util/SchemaUtil";

import {
    DataNodeInterface,
    DataNodeProps,
    DataNodeLockedConfig,
    COPIEDSIGNATURES_INDEX,
    COPIEDPARENTID_INDEX,
    COPIEDCREATIONTIME_INDEX,
    EMBEDDED_NODE_INDEX,
} from "./types";

import {
    ID2_INDEX,
    PARENTID_INDEX,
    REFID_INDEX,
    REGION_INDEX,
    JURISDICTION_INDEX,
    LICENSEMINDISTANCE_INDEX,
    LICENSEMAXDISTANCE_INDEX,
    DIFFICULTY_INDEX,
    DIFFICULTY_NONCE_INDEX,
    CHILDMINDIFFICULTY_INDEX,
    BASENODECONFIG_INDEX,
    BaseNodeConfig,
} from "../../level1/basenode/types";

import {
    BaseDataNode,
    BaseDataNodeSchema,
    ParseBaseDataNodeSchema,
    BaseDataNodeType,
    BaseDataNodeConfig,
    DATA_INDEX,
    BASEDATANODECONFIG_INDEX,
    BLOBLENGTH_INDEX,
    BLOBHASH_INDEX,
    DATA2_INDEX,
    CONTENTTYPE_INDEX,
} from "../../level2/basedatanode";

import {
    MODELTYPE_INDEX,
    SIGNATURE_INDEX3,
    SignatureVerification,
    ConstraintsFlagsMapping,
    ConstraintsFieldsMapping,
    SignatureObject,
} from "../../types";

import {
    SignatureSchema,
    GetSignaturesRecursive,
    HashList,
    HashConstraints,
    ParseSignatureObject,
    LoadSignature,
} from "../../BaseModel";


function assert<T>(value: T, error: string): asserts value is NonNullable<T> {
    if (!value) {
        throw new Error(`Assertion error: ${error}`);
    }
}

export const DataNodeType = [...BaseDataNodeType, 1] as const;

export const DataNodeTypeAlias = "DataNode";

const CopiedSignaturesSchema: Fields = {
    "[]": {
        index: 0,
        type: FieldType.SCHEMA,
        schema: SignatureSchema,
    },
} as const;

const ParseCopiedSignaturesSchema: ParseSchemaType = [ParseSignatureObject] as const;

export const DataNodeSchema: Fields = {
    ...BaseDataNodeSchema,
    modelType: {
        index: MODELTYPE_INDEX,
        type: FieldType.BYTE3,
        static: Buffer.from(DataNodeType),
    },
    id2: {
        index: ID2_INDEX,
        type: FieldType.BYTE32,
    },
    embedded: {
        index: EMBEDDED_NODE_INDEX,
        type: FieldType.SCHEMA,
        maxSize: 8192,
        schema: undefined,  // means same schema
    },
    difficulty: {
        index: DIFFICULTY_INDEX,
        type: FieldType.UINT8,
    },
    difficultyNonce: {
        index: DIFFICULTY_NONCE_INDEX,
        type: FieldType.BYTE8,
    },
    copiedSignatures: {
        index: COPIEDSIGNATURES_INDEX,
        type: FieldType.SCHEMA,
        schema: CopiedSignaturesSchema,
        maxSize: 3,
    },
    copiedParentId: {
        index: COPIEDPARENTID_INDEX,
        type: FieldType.BYTE32,
    },
    copiedCreationTime: {
        index: COPIEDCREATIONTIME_INDEX,
        type: FieldType.UINT48BE,
    },
} as const;

export const ParseDataNodeSchema: ParseSchemaType = {
    ...ParseBaseDataNodeSchema,
    "id2??": new Uint8Array(0),
    "embedded??": ParseRawOrSchema(),  // no arg means same schema
    "difficulty??": 0,
    "difficultyNonce??": new Uint8Array(0),
    "copiedSignatures??": ParseRawOrSchema(ParseCopiedSignaturesSchema),
    "copiedParentId??": new Uint8Array(0),
    "copiedCreationTime??": 0,
} as const;

/**
 * DataNode implementation.
 */
export class DataNode extends BaseDataNode implements DataNodeInterface {
    protected readonly fields = DataNodeSchema;
    protected props?: DataNodeProps;

    public static Is(modelType: Buffer | undefined): boolean {
        if (!modelType) {
            return false;
        }

        return modelType.equals(Buffer.from(DataNodeType));
    }

    public getProps(): DataNodeProps {
        return super.getProps();
    }

    public setProps(props: DataNodeProps) {
        super.setProps(props);
    }

    public mergeProps(props: DataNodeProps) {
        super.mergeProps(props);

        const props1 = this.getProps();

        for (const p in props) {
            // The keys of DataNodeProps
            if (["embedded", "copiedSignatures", "copiedParentId", "copiedCreationTime"].includes(p)) {
                //@ts-expect-error
                if (props[p] !== undefined) {
                    //@ts-expect-error
                    props1[p] = props[p];
                }
            }
        }
    }

    public getCopiedNode(): DataNodeProps | undefined {
        assert(this.props, "Expected props to be set");

        return GetCopiedNode(this.props);
    }

    /**
     * Suger function to copy a node.
     *
     * The point of copying nodes is to have the same node but with a different
     * parent id. This is so that owners can reuse their data in multiple parts
     * of the graph.
     *
     * All other parameters of the node (other than the parentId) must stay
     * the same.
     *
     * A copied (original) node will have its id1 set as id2 of the copy,
     * effectively giving the new node the id of the original node.
     *
     * A copied node who has an id2 set cannot be copied.
     *
     * The copy node (new node) will store some original properties which are
     * used to restore and verify the original node.
     * This is important as it is part of verifying that the copy node is a
     * allowed to be a copy of the original node.
     *
     * In general:
     * A new copy node has all properties exactly the same as the original,
     * except:
     * A new copy node will have its id2 set to the copied node's id1.
     * A new copy node can set its parentId to anything, except the same parentId.
     * A new copy node will get its own unique id1 and its own signatures.
     * A new copy node will have copiedSignatures set to original signatures.
     * A new copy node will have copiedParentId set to the original parentId.
     * A new copy node will have copiedCreationTime set to the original creationTime if changed.
     *
     * Using these saved properties the verificiation procedure can verify
     * that the copy is a copy of the original node with the id1 we are
     * referencing as our id2.
     *
     * @param parentId set this to the new parentId of the copy (which has to be different)
     * @param creationTime optionally set this to a new time in the future of original node's.
     *
     * @returns unsigned copy or undefined on error.
     * @throws is pack procedure does not work.
     */
    public copy(parentId: Buffer, creationTime?: number): DataNodeInterface {
        assert(this.props, "Expected props to be set");

        const props = Copy(this.props, parentId, creationTime);

        const dataNode = new DataNode();

        dataNode.setProps(props);

        dataNode.pack();

        return dataNode;
    }

    /**
     * Overrides to also add signatures for copied node.
     *
     */
    public getSignaturesRecursive(allowUnsigned: boolean = false): SignatureVerification[] {
        assert(this.packed, "Expected model to have been packed");

        const signatures: SignatureVerification[] = [];

        const fieldIterator = FieldIterator(this.packed);

        if (fieldIterator.get(COPIEDSIGNATURES_INDEX)?.value) {
            const props =
                UnpackSchema(this.packed, this.fields, false,
                    SIGNATURE_INDEX3) as DataNodeProps;

            const copiedNode = GetCopiedNode(props);

            if (copiedNode) {
                const packed2 =
                    PackSchema(this.fields, copiedNode, SIGNATURE_INDEX3);

                signatures.push(...GetSignaturesRecursive(packed2));
            }
        }

        signatures.push(...super.getSignaturesRecursive(allowUnsigned));

        return signatures;
    }

    public validate(deepValidate: boolean = false,
        time?: number): [boolean, string]
    {
        assert(this.props, "Expected props to have been set");

        const validated = super.validate(deepValidate, time);

        if (!validated[0]) {
            return validated;
        }

        const flags = this.loadFlags();

        if (this.props.copiedSignatures?.length) {
            const props2 = GetCopiedNode(this.props);

            if (!props2) {
                return [false, "The node does not validate as a copy"];
            }

            if (this.props.parentId &&
                props2.parentId?.equals(this.props.parentId))
            {
                return [false, "Copied node cannot have same parentId"];
            }

            const richDataNode2 = new DataNode();

            richDataNode2.setProps(props2);

            const validated = richDataNode2.validate(deepValidate, time);

            if (!validated[0]) {
                return validated;
            }
        }

        if (this.props.copiedSignatures?.length && !this.props.id2) {
            return [false, "A copy node must have id2 set"];
        }

        if (deepValidate) {
            if (this.props.embedded) {
                const instance = this.loadEmbedded();

                const validated = instance.validate(deepValidate, time);

                if (!validated[0]) {
                    return [false,
                        `Could not validate embedded: ${validated[1]}`];
                }

                const flagsEmbedded = instance.loadFlags();

                const embeddedProps = instance.getProps();

                if (!flagsEmbedded.allowEmbed) {
                    return [false, "Embedded node does not allow embedding"];
                }

                if (!flagsEmbedded.isPublic && !flagsEmbedded.isLicensed) {
                    if (flags.isPublic || flags.isLicensed) {
                        return [false,
                            "Embedding node must also be private when embedded node is private"];
                    }

                    if (embeddedProps.owner && this.props.owner &&
                        !embeddedProps.owner.equals(this.props.owner))
                    {
                        return [false,
                            "Owner of embedding node must be same as the embedded node, since it is private"];
                    }
                }

                if (!flagsEmbedded.allowEmbedMove) {
                    if (this.props.parentId && embeddedProps.parentId &&
                        !this.props.parentId.equals(embeddedProps.parentId))
                    {
                        return [false,
                            "Embedded node does not have allowEmbedMove set, which is needed since parentIds are not the same"];
                    }
                }
            }
        }

        return [true, ""];
    }

    public loadCopiedSignatures(): SignatureObject[] {
        assert(this.props, "Expected props to have been set");

        if (!this.props.copiedSignatures?.length) {
            throw new Error("Expected copiedSignatures to have been set");
        }

        this.props.copiedSignatures = LoadCopiedSignatures(this.props.copiedSignatures);

        return this.props.copiedSignatures;
    }

    /**
     * Return embedded object as class instance.
     *
     * @returns embedded class instance
     * @throws if no embedded prop is set or on failure decoding embedded data
     */
    public loadEmbedded(): DataNodeInterface {
        assert(this.props, "Expected props to have been set");

        if (!this.props.embedded) {
            throw new Error("Expected embedded to have been set");
        }

        if (Buffer.isBuffer(this.props.embedded)) {
            const instance = new DataNode(this.props.embedded);

            instance.unpack();

            this.props.embedded = instance.getProps();

            return instance;
        }
        else {
            const instance = new DataNode();

            instance.setProps(this.props.embedded)

            instance.pack();

            return instance;
        }
    }

    public getAchillesHashes(): Buffer[] {
        assert(this.props, "Expected props to have been set");

        const owner = this.props.owner;

        assert(owner, "Expected owner to have been set");

        const flags = this.loadFlags();

        const hashes = super.getAchillesHashes();

        if (!flags.isIndestructible) {
            if (this.props.copiedSignatures?.length) {
                // This hash allows a copy node to be destroyed on its copied id1 (which is its id2)
                //
                const id2 = this.props.id2;

                assert(id2, "Expected id2 to be set");

                hashes.push(HashList([Buffer.from("destroy"), owner, id2]));
            }
        }

        if (this.props.embedded) {
            const instance = this.loadEmbedded();

            hashes.push(...instance.getAchillesHashes());
        }


        return hashes;
    }

    public canSendPrivately(sourcePublicKey: Buffer, targetPublicKey: Buffer): boolean {
        assert(this.props, "Expected props to have been set");

        if (!super.canSendPrivately(sourcePublicKey, targetPublicKey)) {
            return false;
        }

        // Check embeddings
        //

        if (this.props.embedded) {
            const instance = this.loadEmbedded();

            return instance.canSendPrivately(sourcePublicKey, targetPublicKey);
        }

        return true;
    }

    /**
     * Calculate constraints on the node bound to specific fields dictated by
     * the lockedConfig bits.
     *
     * All fields are hashed iteratively as their packed representions,
     * then all flags are hashed together with the hash of the fields.
     *
     * @param lockedConfig bit representation of fields to hash
     * @returns hash
     */
    public hashConstraints(lockedConfig: number): Buffer {
        assert(this.packed,
            "Expected to been packed before calling hashConstraints");

        assert(this.props,
            "Expected props to be set before calling hashConstraints");

        return HashConstraints(lockedConfig,
            this.packed,
            this.props,
            DataNodeLockedConfigFieldsMapping,
            DataNodeLockedConfigFlagsMapping,
            {
                basenode: this.props.baseNodeConfig ?? 0,
                basedatanode: this.props.baseDataNodeConfig ?? 0,
            }
        );
    }

    /**
     * Suger function to help embed this data node into another data node.
     *
     * @param targetPublicKey towards who is this embedding being created.
     * @param creationTime the creationTime of the embedding node, default is Date.now().
     * @returns embedding node with this node set as its embedded,
     * or undefined if not allowed to embed.
     * @throws on embedding error (such as field overflow).
     */
    public embed(targetPublicKey: Buffer, creationTime?: number): DataNodeInterface | undefined {  //eslint-disable-line @typescript-eslint/no-unused-vars
        assert(this.props,
            "Expected props to be set before calling hashConstraints");

        const flags = this.loadFlags();

        if (!flags.allowEmbed) {
            return undefined;
        }

        const newProps: DataNodeProps = {
            creationTime: this.props.creationTime ?? Date.now(),
            embedded: this.props,
        };

        const dataNode = new DataNode();

        dataNode.setProps(newProps);

        return dataNode;
    }
}

function LoadCopiedSignatures(copiedSignatures: Buffer | SignatureObject[]): SignatureObject[] {
    if (Buffer.isBuffer(copiedSignatures)) {
        return UnpackSchema(copiedSignatures, CopiedSignaturesSchema) as SignatureObject[];
    }

    return copiedSignatures;
}

function GetCopiedNode(props: DataNodeProps): DataNodeProps | undefined {
    assert(props.copiedSignatures?.length, "Expected copiedSignatures");

    const props2 = {...props};

    const copiedSignatures = LoadCopiedSignatures(props.copiedSignatures);

    props2.signature1 = copiedSignatures[0];
    props2.signature2 = copiedSignatures[1];
    props2.signature3 = copiedSignatures[2];

    props2.id1 = props.id2;

    delete props2.id2;

    if (props.copiedCreationTime !== undefined) {
        props2.creationTime = props.copiedCreationTime;

        // Copy node's creationTime cannot be older then originals.
        //
        if (props.copiedCreationTime > (props.creationTime ?? 0)) {
            return undefined;
        }
    }
    else {
        props2.creationTime = props.creationTime;
    }

    props2.parentId = props.copiedParentId;

    // A copy cannot have same parentId as the copied.
    //
    if (props2.parentId && props.parentId?.equals(props2.parentId)) {
        return undefined;
    }

    delete props2.copiedSignatures;
    delete props2.copiedParentId;
    delete props2.copiedCreationTime;

    return props2;
}

function Copy(props: DataNodeProps, parentId: Buffer, creationTime?: number): DataNodeProps {
    assert(!props.copiedSignatures || props.copiedSignatures.length === 0,
        "Cannot copy a copied node");

    assert(!props.id2, "Cannot copy node with id2 set");

    assert(props.parentId, "Expected parentId to have been set");

    assert(!props.parentId.equals(parentId), "parentId of copy node cannot be same as original");

    const props2 = {...props};

    props2.copiedSignatures = [];

    if (props.signature1) {
        props2.copiedSignatures.push(LoadSignature(props.signature1));
    }

    if (props.signature2) {
        props2.copiedSignatures.push(LoadSignature(props.signature2));
    }

    if (props.signature3) {
        props2.copiedSignatures.push(LoadSignature(props.signature3));
    }

    delete props2.signature1;

    delete props2.signature2;

    delete props2.signature3;

    props2.copiedParentId = props.parentId;
    props2.parentId = parentId;

    if (creationTime !== undefined) {
        props2.copiedCreationTime = props.creationTime;
        props2.creationTime = creationTime ?? props.creationTime;
    }

    assert((props2.creationTime ?? -1) >= (props.creationTime ?? 0), "copy node's creationTime must be same or greater");

    props2.id2 = props.id1;

    return props2;
}

/**
 * Map DataNodeLockedConfig bits to corresponding field indexes.
 * Note that locked flags are not mapped here.
 */
export const DataNodeLockedConfigFieldsMapping: ConstraintsFieldsMapping = {
    [DataNodeLockedConfig.ParentId]: PARENTID_INDEX,
    [DataNodeLockedConfig.Id2]: ID2_INDEX,
    [DataNodeLockedConfig.RefId]: REFID_INDEX,
    [DataNodeLockedConfig.Region]: REGION_INDEX,
    [DataNodeLockedConfig.Jurisdiction]: JURISDICTION_INDEX,
    [DataNodeLockedConfig.LicenseMinDistance]: LICENSEMINDISTANCE_INDEX,
    [DataNodeLockedConfig.LicenseMaxDistance]: LICENSEMAXDISTANCE_INDEX,
    [DataNodeLockedConfig.Difficulty]: DIFFICULTY_INDEX,
    [DataNodeLockedConfig.ContentType]: CONTENTTYPE_INDEX,
    [DataNodeLockedConfig.CopiedSignatures]: COPIEDSIGNATURES_INDEX,
    [DataNodeLockedConfig.CopiedParentId]: COPIEDPARENTID_INDEX,
    [DataNodeLockedConfig.CopiedCreationTime]: COPIEDCREATIONTIME_INDEX,
    [DataNodeLockedConfig.Embedded]: EMBEDDED_NODE_INDEX,
    [DataNodeLockedConfig.Data]: DATA_INDEX,
    [DataNodeLockedConfig.Data2]: DATA2_INDEX,
    [DataNodeLockedConfig.BlobHash]: BLOBHASH_INDEX,
    [DataNodeLockedConfig.BlobLength]: BLOBLENGTH_INDEX,
    [DataNodeLockedConfig.ChildMinDifficulty]: CHILDMINDIFFICULTY_INDEX,
    [DataNodeLockedConfig.BaseNodeConfig]: BASENODECONFIG_INDEX,
    [DataNodeLockedConfig.BaseDataNodeConfig]: BASEDATANODECONFIG_INDEX,
}

export const DataNodeLockedConfigFlagsMapping: ConstraintsFlagsMapping = {
    [DataNodeLockedConfig.IsLeaf]: ["basenode", BaseNodeConfig.IsLeaf],
    [DataNodeLockedConfig.IsPublic]: ["basenode", BaseNodeConfig.IsPublic],
    [DataNodeLockedConfig.IsLicensed]: ["basenode", BaseNodeConfig.IsLicensed],
    [DataNodeLockedConfig.AllowEmbed]: ["basenode", BaseNodeConfig.AllowEmbed],
    [DataNodeLockedConfig.AllowEmbedMove]: ["basenode", BaseNodeConfig.AllowEmbedMove],
    [DataNodeLockedConfig.IsUnique]: ["basenode", BaseNodeConfig.IsUnique],
    [DataNodeLockedConfig.IsBeginRestrictiveWriterMode]: ["basenode",
        BaseNodeConfig.IsBeginRestrictiveWriterMode],
    [DataNodeLockedConfig.IsEndRestrictiveWriterMode]: ["basenode",
        BaseNodeConfig.IsEndRestrictiveWriterMode],
    [DataNodeLockedConfig.IsIndestructible]: ["basenode", BaseNodeConfig.IsIndestructible],
    [DataNodeLockedConfig.HasRightsByAssociation]: ["basenode",
        BaseNodeConfig.HasRightsByAssociation],
    [DataNodeLockedConfig.DisallowParentLicensing]: ["basenode",
        BaseNodeConfig.DisallowParentLicensing],
    [DataNodeLockedConfig.OnlyOwnChildren]: ["basenode", BaseNodeConfig.OnlyOwnChildren],
    [DataNodeLockedConfig.DisallowPublicChildren]: ["basenode",
        BaseNodeConfig.DisallowPublicChildren],

    [DataNodeLockedConfig.IsDestroy]: ["basedatanode", BaseDataNodeConfig.IsDestroy],
    [DataNodeLockedConfig.IsAnnotationsEdit]: ["basedatanode", BaseDataNodeConfig.IsAnnotationsEdit],
    [DataNodeLockedConfig.IsAnnotationsReaction]: ["basedatanode",
        BaseDataNodeConfig.IsAnnotationsReaction],
}
