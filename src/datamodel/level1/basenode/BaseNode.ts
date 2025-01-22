/**
 * At this level (1), the BaseModel is specialied into a BaseNode.
 * A BaseNode cannot be packed, but it can be used to unpack.
 */

import {
    Fields,
    FieldType,
    FieldIterator,
    UnpackValue,
} from "../../PackSchema";

import {
    ParseRawOrSchema,
    ParseSchemaType,
} from "../../../util/SchemaUtil";

import {
    BaseModel,
    BaseModelSchema,
    ParseBaseModelSchema,
    HashList,
    IS_BIT_SET,
    SET_BIT,
} from "../../BaseModel";

import {
    MODELTYPE_INDEX,
    SIGNCERT_INDEX,
} from "../../types";

import {
    BaseNodeInterface,
    BaseNodeProps,
    BaseNodeFlags,
    PARENTID_INDEX,
    BASENODECONFIG_INDEX,
    BASENODETRANSIENTCONFIG_INDEX,
    REGION_INDEX,
    JURISDICTION_INDEX,
    TRANSIENTSTORAGETIME_INDEX,
    REFID_INDEX,
    BaseNodeConfig,
    BaseNodeTransientConfig,
    MAX_LICENSE_DISTANCE,
    DIFFICULTY_INDEX,
    DIFFICULTY_NONCE_INDEX,
} from "./types";

import {
    SignCert,
    SignCertSchema,
    ParseSignCertSchema,
} from "../../level3/signcert/SignCert";

import {
    SignCertProps,
    SignCertInterface,
} from "../../level3/signcert/types";

function assert<T>(value: T, error: string): asserts value is NonNullable<T> {
    if (!value) {
        throw new Error(`Assertion error: ${error}`);
    }
}

export const BaseNodeType = [1] as const;

export const BaseNodeSchema: Fields = {
    ...BaseModelSchema,
    modelType: {
        index: MODELTYPE_INDEX,
        type: FieldType.BYTE3,
        static: Buffer.from(BaseNodeType),
        staticPrefix: true,
    },
    signCert: {
        index: SIGNCERT_INDEX,
        type: FieldType.SCHEMA,
        maxSize: 2048,
        schema: SignCertSchema,
    },
    parentId: {
        index: PARENTID_INDEX,
        type: FieldType.BYTE32,
        required: true,
    },
    baseNodeConfig: {
        index: BASENODECONFIG_INDEX,
        type: FieldType.UINT16BE,
    },
    baseNodeTransientConfig: {
        index: BASENODETRANSIENTCONFIG_INDEX,
        type: FieldType.UINT8,
    },
    refId: {
        index: REFID_INDEX,
        type: FieldType.BYTES,
        maxSize: 32,
    },
    region: {
        index: REGION_INDEX,
        type: FieldType.STRING,
        maxSize: 2,
    },
    jurisdiction: {
        index: JURISDICTION_INDEX,
        type: FieldType.STRING,
        maxSize: 2,
    },
    transientStorageTime: {
        index: TRANSIENTSTORAGETIME_INDEX,
        type: FieldType.UINT48BE,
    },
} as const;

// Used to parse from JSON.
export const ParseBaseNodeSchema: ParseSchemaType = {
    ...ParseBaseModelSchema,
    "signCert??": ParseRawOrSchema(ParseSignCertSchema),
    "parentId??": new Uint8Array(0),
    "baseNodeConfig??": 0,
    "baseNodeTransientConfig??": 0,
    "refId??": new Uint8Array(0),
    "region??": "",
    "jurisdiction??": "",
    "transientStorageTime??": 0,
    "isLeaf??": false,
    "isPublic??": false,
    "isLicensed??": false,
    "allowEmbed??": false,
    "allowEmbedMove??": false,
    "isUnique??": false,
    "isBeginRestrictiveWriteMode??": false,
    "isEndRestrictiveWriteMode??": false,
    "isIndestructible??": false,
    "hasRightsByAssociation??": false,
    "disallowParentLicensing??": false,
    "onlyOwnChildren??": false,
    "disallowPublicChildren??": false,
    "bubbleTrigger??": false,
    "isInactive??": false,
} as const;

export class BaseNode extends BaseModel implements BaseNodeInterface {
    protected readonly fields = BaseNodeSchema;
    protected props?: BaseNodeProps;

    public getProps(): BaseNodeProps {
        return super.getProps();
    }

    public setProps(props: BaseNodeProps) {
        super.setProps(props);
    }

    public mergeProps(props: BaseNodeProps) {
        super.mergeProps(props);

        const props1 = this.getProps();

        for (const p in props) {
            // The keys of BaseNodeProps
            if (["id2", "id", "signCert", "parentId", "baseNodeConfig", "baseNodeTransientConfig", "refId", "transientStorageTime", "region", "jurisdiction", "licenseMinDistance", "licenseMaxDistance", "difficulty", "difficultyNonce", "childMinDifficulty"].includes(p)) {
                //@ts-expect-error
                if (props[p] !== undefined) {
                    //@ts-expect-error
                    props1[p] = props[p];
                }
            }
        }
    }

    public static Is(modelType: Buffer | undefined): boolean {
        if (!modelType) {
            return false;
        }

        return modelType.slice(0, BaseNodeType.length).equals(Buffer.from(BaseNodeType));
    }

    /**
     * Convenience function to return id or throw.
     *
     * @returns id
     * @throws if id not set
     */
    public getId(): Buffer {
        assert(this.props?.id, "Expected props.id1 to have been set");

        return this.props.id;
    }

    /**
     * Verify difficultyNonce if difficulty is set.
     *
     * This function works directly on the packed data so no need to unpack it.
     *
     * @returns true if work verifies or if no difficulty is set
     * @throws if missing nonce
     */
    public verifyWork(): boolean {
        assert(this.packed, "Expected packed to have been set");

        const fieldIterator = FieldIterator(this.packed);

        const diffPacked = fieldIterator.get(DIFFICULTY_INDEX)?.value;

        if (!diffPacked) {
            return true;
        }

        // unpack integer
        //
        const difficulty =
            UnpackValue(diffPacked, {type: FieldType.UINT8, index: 0});

        if (difficulty === 0) {
            return true;
        }

        const noncePacked = fieldIterator.get(DIFFICULTY_NONCE_INDEX)?.value;

        assert(noncePacked, "Expected difficultyNonce to be set");

        // unpack bytes
        //
        const difficultyNonce =
            UnpackValue(noncePacked, {type: FieldType.BYTE8, index: 0});

        const threshold = MakeWorkThreshold(difficulty);

        const message = this.hash(DIFFICULTY_NONCE_INDEX - 1);

        const hashHex = HashList([message, difficultyNonce]).toString("hex").toLowerCase();

        return hashHex >= threshold;

        return true;
    }

    /**
     * Calculate and store difficultyNonce if difficulty is set.
     *
     * Only solve work for a fully signed model as all fields
     * are part of the worked on data.
     *
     * This function packs the model when ready.
     */
    public solveWork() {
        assert(this.props, "Expected props to have been set");

        this.pack();

        delete this.props.difficultyNonce;

        if (this.props.difficulty) {
            const threshold = MakeWorkThreshold(this.props.difficulty);

            const message = this.hash(DIFFICULTY_NONCE_INDEX - 1);

            const nonce = Buffer.alloc(8).fill(0);

            while (true) {
                const hashHex = HashList([message, nonce]).toString("hex").toLowerCase();

                if (hashHex >= threshold) {
                    break;
                }

                // Increment nonce
                //
                for (let index = 0; index < nonce.length; index++) {
                    const byte = nonce.readUInt8(index);

                    if (byte < 255) {
                        nonce.writeUInt8(byte + 1, index);
                        break;
                    }
                    else {
                        if (index === nonce.length - 1) {
                            return undefined;
                        }

                        nonce.writeUInt8(0, index);
                    }
                }
            }

            this.props.difficultyNonce = nonce;

            this.pack();
        }
    }

    public getAchillesHashes(): Buffer[] {
        assert(this.props, "Expected props to have been set");

        const hashes: Buffer[] = [];

        const flags = this.loadFlags();

        if (!flags.isIndestructible) {
            const id1 = this.props.id1;

            assert(id1, "Expected id1 to have been set");

            const owner = this.props.owner;

            assert(owner, "Expected owner to have been set");

            // This hash allows node to be destroyed on its id1.
            //
            hashes.push(HashList([Buffer.from("destroy"), owner, id1]));
        }

        if (this.props.signCert) {
            const signCert = this.loadSignCert();

            hashes.push(...signCert.getAchillesHashes());
        }

        return hashes;
    }

    public loadSignCert(): SignCertInterface {
        assert(this.props?.signCert, "Expected signCert to have been set");

        if (Buffer.isBuffer(this.props.signCert)) {
            const signCert = new SignCert(this.props.signCert);

            signCert.unpack();

            this.props.signCert = signCert.getProps();

            return signCert;
        }
        else {
            const signCert = new SignCert();

            signCert.setProps(this.props.signCert);

            return signCert;
        }
    }

    public validate(deepValidate: boolean = false,
        time?: number): [boolean, string]
    {
        assert(this.props, "Expected props to have been set");

        const validated = super.validate(deepValidate, time);

        if (!validated[0]) {
            return validated;
        }

        if (!this.props.parentId?.length) {
            return [false, "Missing parentId"];
        }

        const flags = this.loadFlags();

        if (this.props.difficultyNonce?.length && !this.props.difficulty) {
            return [false, "Node cannot have difficultyNonce without difficulty set"];
        }

        if (flags.isPublic && flags.isLicensed) {
            return [false, "Node cannot be licensed and public at the same time"];
        }

        if (!flags.isLicensed) {
            if (this.props.licenseMinDistance !== undefined ||
                this.props.licenseMinDistance !== undefined) {
                return [false,
                    "License min and max distance cannot be set if node is not licensed"];
            }
        }

        if (flags.hasRightsByAssociation) {
            if (flags.isLicensed || flags.isPublic) {
                return [false,
                    "A rightsByAssociation node must be private"];
            }

            if (!this.props.refId?.length) {
                return [false,
                    "A rightsByAssociation node must have its refId set to the id1 of the node it is associating with"];
            }

            if (flags.allowEmbed) {
                return [false,
                    "A rightsByAssociation node cannot have allowEmbed set"];
            }
        }

        if (this.props.licenseMinDistance !== undefined ||
            this.props.licenseMaxDistance !== undefined)
        {
            if (this.props.licenseMinDistance === undefined ||
                this.props.licenseMaxDistance === undefined)
            {
                return [false,
                    "licenseMinDistance and licenseMaxDistance must both be set if set"];
            }

            if (this.props.licenseMinDistance > this.props.licenseMaxDistance) {
                return [false,
                    "License min distance cannot be greater than max distance"];
            }

            if (this.props.licenseMaxDistance > MAX_LICENSE_DISTANCE) {
                return [false,
                    `License max distance cannot be greater than ${MAX_LICENSE_DISTANCE}`];
            }
        }

        if (flags.allowEmbedMove && !flags.allowEmbed) {
            return [false,
                "Allow embed move cannot be set if not allow embed is set"];
        }

        if (flags.allowEmbedMove && (this.props.licenseMinDistance ?? 0) > 0) {
            // Note that licenseMinDistance will be ignored for embedded
            // licenses moved nodes, they only accept sibling licenses.
            //
            return [false,
                "Allow embed move cannot be set if licenseMinDistance > 0"];
        }

        if (flags.isLeaf) {
            if (flags.isBeginRestrictiveWriteMode ||
                flags.isEndRestrictiveWriteMode) {

                return [false,
                    "A leaf node cannot have beginRestrictiveWriterMode or endRestrictiveWriterMode set"];
            }

            if (flags.onlyOwnChildren) {
                return [false,
                    "A leaf node cannot have the onlyOwnChildren flag set"];
            }

            if (flags.disallowPublicChildren) {
                return [false,
                    "A leaf node cannot have the disallowPublicChildren flag set"];
            }

            if (this.props.childMinDifficulty !== undefined) {
                return [false, "A leaf node cannot have childMinDifficulty set"];
            }
        }

        if (deepValidate) {
            if (this.props.signCert) {
                const signCert = this.loadSignCert();

                const validated = signCert.validate(deepValidate, time);

                if (!validated[0]) {
                    return [false,
                        `Could not validate signCert: ${validated[1]}`];
                }

                const validated2 = this.matchSignCert(signCert.getProps());

                if (!validated2[0]) {
                    return [false,
                        `Could not match signCert: ${validated2[1]}`];
                }
            }
        }

        return [true, ""];
    }

    public usesParentLicense(): boolean {
        assert(this.props, "Expected props to have been set");

        return Boolean(this.loadFlags().isLicensed) && (this.getProps().licenseMaxDistance ?? 0) > 0;
    }

    /**
     * @param signCertProps SignCertProps to check that it matches this node
     * @param signerPublicKey is set then check that the key is in targetPublicKeys
     * of the cert and that there is no multisig requried
     */
    public matchSignCert(signCertProps: SignCertProps, signerPublicKey?: Buffer): [boolean, string] {
        assert(this.props, "Expected props to have been set");

        const owner = signCertProps.owner;

        if (owner === undefined) {
            return [false, "Expected cert owner to be set"];
        }

        if (this.props.owner === undefined) {
            return [false, "Expected node owner to be set"];
        }

        if (!this.props.owner.equals(owner)) {
            return [false,
                "cert owner public key must match node owner public key"];
        }

        const targetType = signCertProps.targetType;

        if (targetType) {
            if (this.props.modelType === undefined) {
                return [false, "Expected modelType to be set"];
            }

            if (!targetType.equals(this.props.modelType)) {
                return [false,
                    "cert targetType must match the nodes modelType"];
            }
        }

        const certCreationTime = signCertProps.creationTime;

        const certExpireTime = signCertProps.expireTime;

        if (certCreationTime === undefined ||
            certExpireTime === undefined)
        {
            return [false, "Missing time values in cert"];
        }

        const nodeCreationTime = this.props.creationTime;

        if (nodeCreationTime === undefined) {
            return [false, "Missing node creation time"];
        }

        // Check so that the node is not created before the
        // cert's fromTime.
        if (nodeCreationTime < certCreationTime) {
            return [false,
                "Node cannot be created before the certificates creation time"];
        }

        if (nodeCreationTime > certExpireTime) {
            return [false,
                "Node cannot be created after the certificates expire time"];
        }

        // Check the maximum allowed expire time.
        //
        if (signCertProps.targetMaxExpireTime !== undefined) {
            if (this.props.expireTime === undefined) {
                return [false,
                    "expireTime must be set when signCert targetMaxExpireTime is set"];
            }

            if (this.props.expireTime > signCertProps.targetMaxExpireTime) {
                return [false,
                    "cert cannot expire after signCerts targetMaxExpireTime"];
            }
        }

        // When signing the node we require any chain of cert to have been fully made up.
        //
        if ((signCertProps.countdown ?? 0) !== 0) {
            return [false, "signCerts countdown value if set must be 0 when signing node"];
        }

        const constraints = signCertProps.constraints;

        if (constraints) {
            const lockedConfig = signCertProps.lockedConfig ?? 0;

            const nodeConstraints =
                this.hashConstraints(lockedConfig);

            if (!constraints.equals(nodeConstraints)) {
                return [false,
                    "signCert constraints do not match hashed node constraints"];
            }
        }

        if (signerPublicKey) {
            const targetPublicKeys = signCertProps.targetPublicKeys ?? [];

            if (!targetPublicKeys.some( pubKey => pubKey.equals(signerPublicKey) )) {
                return [false, "Missing singerPublicKey in targetPublicKeys"];
            }

            if ((signCertProps.multisigThreshold ?? 1) !== 1) {
                return [false, "Expected signCert not to be multisig"];
            }
        }

        return [true, ""];
    }

    /**
     * @param isWrite set to false for fetch permission licenses and to true for write permission licenses
     */
    public getLicenseHashes(isWrite: boolean, lastIssuer: Buffer, targetPublicKey: Buffer,
        otherParentId?: Buffer): Buffer[]
    {
        assert(this.props, "Expected props to have been set");

        const parentId = otherParentId ?? this.props.parentId;
        assert(parentId, "Expected props.parentId to have been set");

        assert(this.props?.id1, "Expected props.id1 to have been set");

        // owner of the node is the same as the first issuer of the license (stack).
        //
        const firstIssuer = this.props.owner;
        assert(firstIssuer, "Expected props.owner to have been set");

        const flags = this.loadFlags();

        const hashes: Buffer[] = [];

        const prefix = isWrite ? Buffer.from("write") : Buffer.from("read");

        // Issue license hashes for all licensed nodes but also for all beginRestrictiveWriterMode
        // node as those have write-licenses.
        //
        if (flags.isLicensed || flags.isBeginRestrictiveWriteMode) {
            hashes.push(HashList([prefix, this.props.id1, parentId, firstIssuer,
                    lastIssuer, targetPublicKey]));
        }

        return hashes;
    }

    //eslint-disable-next-line @typescript-eslint/no-unused-vars
    public hashConstraints(lockedConfig: number): Buffer {
        // this needs to be overridden in level 3.
        throw new Error("Not implemented");
    }

    //eslint-disable-next-line @typescript-eslint/no-unused-vars
    public canSendEmbedded(sourcePublicKey: Buffer, targetPublicKey: Buffer): boolean {
        // this needs to be overridden.
        throw new Error("Not implemented");
    }

    //eslint-disable-next-line @typescript-eslint/no-unused-vars
    public canSendPrivately(sourcePublicKey: Buffer, targetPublicKey: Buffer): boolean {
        // this needs to be overridden.
        throw new Error("Not implemented");
    }

    //eslint-disable-next-line @typescript-eslint/no-unused-vars
    public canReceivePrivately(sourcePublicKey: Buffer, targetPublicKey: Buffer): boolean {
        // this needs to be overridden.
        throw new Error("Not implemented");
    }

    /**
     * Nodes flagged as isUnique can be deduplicated on their uniqueHash,
     * which is used to deduplicate nodes who have some equal properties.
     *
     * Default uniqueHash is the hash over all available packed fields.
     *
     * Deriving classes should override this behaviour.
     *
     * @returns the unique hash for this node
     */
    public uniqueHash(): Buffer {
        return this.hash();
    }

    protected postPack() {
        assert(this.props, "Expected props to have been set");
        assert(this.packed, "Expected packed to have been set");

        super.postPack();

        if (this.props.id1 || this.props.id2) {
            this.props.id = this.props.id2 ?? this.props.id1;
        }
        else {
            delete this.props.id;
        }
    }

    protected postUnpack() {
        assert(this.props, "Expected props to have been set");
        assert(this.packed, "Expected packed to have been set");

        super.postUnpack();

        if (this.props.id1 || this.props.id2) {
            this.props.id = this.props.id2 ?? this.props.id1;
        }
        else {
            delete this.props.id;
        }
    }

    /**
     * Load config flags from config numbers and return.
     */
    public loadFlags(): BaseNodeFlags {
        assert(this.props, "Expected props to have been set");

        const flags = super.loadFlags();

        LoadConfigFlags(this.props.baseNodeConfig ?? 0, flags);

        LoadTransientConfigFlags(this.props.baseNodeTransientConfig ?? 0, flags);

        return flags;
    }

    /**
     * Store back modified flags.
     */
    public storeFlags(baseNodeFlags: BaseNodeFlags) {
        assert(this.props, "Expected props to have been set");

        super.storeFlags(baseNodeFlags);

        this.props.baseNodeConfig = FlagsToConfig(baseNodeFlags, this.props.baseNodeConfig ?? 0);

        this.props.baseNodeTransientConfig = FlagsToTransientConfig(baseNodeFlags, this.props.baseNodeTransientConfig ?? 0);
    }
}

function LoadConfigFlags(baseNodeConfig: number, flags: BaseNodeFlags) {
    flags.isLeaf =
        IS_BIT_SET(baseNodeConfig, BaseNodeConfig.IsLeaf);

    flags.isPublic =
        IS_BIT_SET(baseNodeConfig, BaseNodeConfig.IsPublic);

    flags.isLicensed =
        IS_BIT_SET(baseNodeConfig, BaseNodeConfig.IsLicensed);

    flags.allowEmbed =
        IS_BIT_SET(baseNodeConfig, BaseNodeConfig.AllowEmbed);

    flags.allowEmbedMove =
        IS_BIT_SET(baseNodeConfig, BaseNodeConfig.AllowEmbedMove);

    flags.isUnique =
        IS_BIT_SET(baseNodeConfig, BaseNodeConfig.IsUnique);

    flags.isBeginRestrictiveWriteMode =
        IS_BIT_SET(baseNodeConfig, BaseNodeConfig.IsBeginRestrictiveWriterMode);

    flags.isEndRestrictiveWriteMode =
        IS_BIT_SET(baseNodeConfig, BaseNodeConfig.IsEndRestrictiveWriterMode);

    flags.isIndestructible =
        IS_BIT_SET(baseNodeConfig, BaseNodeConfig.IsIndestructible);

    flags.hasRightsByAssociation =
        IS_BIT_SET(baseNodeConfig, BaseNodeConfig.HasRightsByAssociation);

    flags.disallowParentLicensing =
        IS_BIT_SET(baseNodeConfig, BaseNodeConfig.DisallowParentLicensing);

    flags.onlyOwnChildren =
        IS_BIT_SET(baseNodeConfig, BaseNodeConfig.OnlyOwnChildren);

    flags.disallowPublicChildren =
        IS_BIT_SET(baseNodeConfig, BaseNodeConfig.DisallowPublicChildren);

    flags.bubbleTrigger =
        IS_BIT_SET(baseNodeConfig, BaseNodeConfig.BubbleTrigger);
}

function LoadTransientConfigFlags(baseNodeTransientConfig: number, flags: BaseNodeFlags) {
    flags.isInactive =
        IS_BIT_SET(baseNodeTransientConfig, BaseNodeTransientConfig.IsInactive);
}

function FlagsToConfig(flags: BaseNodeFlags, baseNodeConfig: number = 0): number {

    if (flags.isLeaf !== undefined) {
        baseNodeConfig =
            SET_BIT(baseNodeConfig, BaseNodeConfig.IsLeaf, flags.isLeaf);
    }

    if (flags.isPublic !== undefined) {
        baseNodeConfig =
            SET_BIT(baseNodeConfig, BaseNodeConfig.IsPublic, flags.isPublic);
    }

    if (flags.isLicensed !== undefined) {
        baseNodeConfig =
            SET_BIT(baseNodeConfig, BaseNodeConfig.IsLicensed, flags.isLicensed);
    }

    if (flags.allowEmbed !== undefined) {
        baseNodeConfig =
            SET_BIT(baseNodeConfig, BaseNodeConfig.AllowEmbed, flags.allowEmbed);
    }

    if (flags.allowEmbedMove !== undefined) {
        baseNodeConfig =
            SET_BIT(baseNodeConfig, BaseNodeConfig.AllowEmbedMove,
                flags.allowEmbedMove);
    }

    if (flags.isUnique !== undefined) {
        baseNodeConfig =
            SET_BIT(baseNodeConfig, BaseNodeConfig.IsUnique, flags.isUnique);
    }

    if (flags.isBeginRestrictiveWriteMode !== undefined) {
        baseNodeConfig =
            SET_BIT(baseNodeConfig, BaseNodeConfig.IsBeginRestrictiveWriterMode,
                flags.isBeginRestrictiveWriteMode);
    }

    if (flags.isEndRestrictiveWriteMode !== undefined) {
        baseNodeConfig =
            SET_BIT(baseNodeConfig, BaseNodeConfig.IsEndRestrictiveWriterMode,
                flags.isEndRestrictiveWriteMode);
    }

    if (flags.isIndestructible !== undefined) {
        baseNodeConfig =
            SET_BIT(baseNodeConfig, BaseNodeConfig.IsIndestructible,
                flags.isIndestructible);
    }

    if (flags.hasRightsByAssociation !== undefined) {
        baseNodeConfig =
            SET_BIT(baseNodeConfig, BaseNodeConfig.HasRightsByAssociation,
                flags.hasRightsByAssociation);
    }

    if (flags.disallowParentLicensing !== undefined) {
        baseNodeConfig =
            SET_BIT(baseNodeConfig, BaseNodeConfig.DisallowParentLicensing,
                flags.disallowParentLicensing);
    }

    if (flags.onlyOwnChildren !== undefined) {
        baseNodeConfig =
            SET_BIT(baseNodeConfig, BaseNodeConfig.OnlyOwnChildren,
                flags.onlyOwnChildren);
    }

    if (flags.disallowPublicChildren !== undefined) {
        baseNodeConfig =
            SET_BIT(baseNodeConfig, BaseNodeConfig.DisallowPublicChildren,
                flags.disallowPublicChildren);
    }

    if (flags.bubbleTrigger !== undefined) {
        baseNodeConfig =
            SET_BIT(baseNodeConfig, BaseNodeConfig.BubbleTrigger,
                flags.bubbleTrigger);
    }

    return baseNodeConfig;
}

function FlagsToTransientConfig(flags: BaseNodeFlags, baseNodeTransientConfig: number = 0): number {
    if (flags.isInactive !== undefined) {
        baseNodeTransientConfig =
            SET_BIT(baseNodeTransientConfig, BaseNodeTransientConfig.IsInactive,
                flags.isInactive);
    }

    return baseNodeTransientConfig;
}

/**
 * Create a hexadecimal string representing the threshold required.
 * @param bits how many bits will make up the threshold
 * @return string of nr of set bits in hexadecimal format,
 * 3 => "7", 4 => "f", 5 => "1f", etc.
 */
function MakeWorkThreshold(bits: number): string {
    const fullNibbles = Math.floor(bits / 4);

    const reminder = bits - fullNibbles * 4;

    const threshold = "f".repeat(fullNibbles) +
        parseInt("1".repeat(reminder).padStart(4, "0"), 2).toString(16).toLowerCase();

    return threshold;
}
