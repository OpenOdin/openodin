/**
 * The BaseModel is the smallest common interface for both nodes and certs.
 * It handles packing, signing and verification of models.
 */

import {
    Fields,
    FieldIterator,
    UnpackSchema,
    UnpackValue,
    FieldType,
    PackSchema,
    HashFields,
    HashSpecificFields,
} from "./PackSchema";

import {
    ParseRawOrSchema,
    ParseSchemaType,
    ParseTime,
} from "../util/SchemaUtil";

import {
    Krypto,
} from "./Krypto";

import blake2b from "blake2b";

import {
    BaseModelProps,
    BaseModelInterface,
    TRANSIENT_HIGH_INDEX,
    TRANSIENT_HASH_LOW_INDEX,
    TRANSIENT_HASH_HIGH_INDEX,
    SIGNCERT_TARGET_PUBLICKEYS_INDEX,
    SUBSCHEMA_LOW_INDEX,
    SUBSCHEMA_HIGH_INDEX,
    MODELTYPE_INDEX,
    OWNER_INDEX,
    CREATIONTIME_INDEX,
    EXPIRETIME_INDEX,
    SIGNATURE_INDEX1,
    SIGNATURE_INDEX2,
    SIGNATURE_INDEX3,
    SIGNCERT_THRESHOLD_INDEX,
    SIGNCERT_INDEX,
    SignatureVerification,
    SignatureObject,
    KeyPair,
    BaseModelFlags,
    ConstraintsFieldsMapping,
    ConstraintsFlagsMapping,
    ConstraintsConfigValues,
    Filter,
    CMP,
} from "./types";

function assert<T>(value: T, error: string): asserts value is NonNullable<T> {
    if (!value) {
        throw new Error(`Assertion error: ${error}`);
    }
}

export const BaseModelType = [] as const;

export const SignatureSchema: Fields = {
    index: {
        index: 0,
        type: FieldType.UINT8,
        required: true,
    },
    type: {
        index: 1,
        type: FieldType.UINT8,
        required: true,
    },
    signature: {
        index: 2,
        type: FieldType.BYTES,
        required: true,
        maxSize: Krypto.MAX_SIGNATURE_LENGTH,
    },
} as const;

/**
 * A required field means it is required when packing the data,
 * some mandatory fields are not required for packing as there
 * can be situations where you want to pack a model which is
 * still not ready, to pass it around (say for multistig).
 */
export const BaseModelSchema: Fields = {
    modelType: {
        index: MODELTYPE_INDEX,
        type: FieldType.BYTE3,
        static: Buffer.from(BaseModelType),
        staticPrefix: true,
    },
    owner: {
        index: OWNER_INDEX,
        type: FieldType.BYTES,
        maxSize: 32,
        required: true,
    },
    creationTime: {
        index: CREATIONTIME_INDEX,
        type: FieldType.UINT48BE,
        required: true,
    },
    expireTime: {
        index: EXPIRETIME_INDEX,
        type: FieldType.UINT48BE,
    },
    signature1: {
        index: SIGNATURE_INDEX1,
        type: FieldType.SCHEMA,
        schema: SignatureSchema,
    },
    signature2: {
        index: SIGNATURE_INDEX2,
        type: FieldType.SCHEMA,
        schema: SignatureSchema,
    },
    signature3: {
        index: SIGNATURE_INDEX3,
        type: FieldType.SCHEMA,
        schema: SignatureSchema,
    },
} as const;

export const ParseSignatureObject = {
    "index": 0,
    "type": 0,
    "signature": new Uint8Array(0),
} as const;

// Used to parse from JSON.
export const ParseBaseModelSchema: ParseSchemaType = {
    "modelType??": new Uint8Array(0),
    "owner??": new Uint8Array(0),
    "id1??": new Uint8Array(0),
    "creationTime??": ParseTime,
    "expireTime??": ParseTime,
    "signature1??": ParseRawOrSchema(ParseSignatureObject),
    "signature2??": ParseRawOrSchema(ParseSignatureObject),
    "signature3??": ParseRawOrSchema(ParseSignatureObject),
} as const;

export const CertTargetsSchema: Fields = {
    "[]": {
        index: 0,
        type: FieldType.BYTES,
        maxSize: Krypto.MAX_PUBLICKEY_LENGTH,
    },
} as const;

export class BaseModel implements BaseModelInterface {
    protected readonly fields = BaseModelSchema;
    protected props?: BaseModelProps;
    protected packed?: Buffer;

    /**
     * @param packed
     */
    constructor(packed?: Buffer) {
        this.packed = packed;
    }

    /**
     * @param props the props object to set, the object is not copied but kept
     * by reference
     */
    public setProps(props: BaseModelProps) {
        assert(!this.props, "Expected props not to be set");

        assert(!this.packed,
            "Expected model not to have been packed before setting props");

        // Automatically set modelType in props
        //
        if (!props.modelType) {
            props.modelType = CopyBuf(this.fields.modelType.static!);
        }

        this.props = props;
    }

    /**
     * Merge given props into existing props object by overwriting existing values.
     *
     * @param props only recognized props will be set
     */
    public mergeProps(props: BaseModelProps) {
        const props1 = this.getProps();

        for (const p in props) {
            // The keys of BaseModelProps
            if (["modelType", "id1", "owner", "creationTime", "expireTime", "signature1", "signature2", "signature3"].includes(p)) {
                //@ts-expect-error
                if (props[p] !== undefined) {
                    //@ts-expect-error
                    props1[p] = props[p];
                }
            }
        }
    }

    /**
     * If not yet unpacked then automatically do a shallow unpack.
     * If needing a deep unpack then first call unpack(true),
     * also if needing to preserve transient values call unpack(true, true) first.
     * @returns props object, not a copy but the actual object
     */
    public getProps(): BaseModelProps {
        if (!this.props) {
            if (this.packed) {
                this.unpack();

                assert(this.props, "Expected props to have been set");
            }
            else {
                this.props = this.defaultProps();
            }
        }

        return this.props;
    }

    protected defaultProps(): BaseModelProps {
        return {
            modelType: CopyBuf(this.fields.modelType.static!),
        }
    }

    /**
     * Convenience function to return id1 or throw.
     *
     * @returns id1
     * @throws if id1 not set
     */
    public getId1(): Buffer {
        assert(this.props?.id1, "Expected props.id1 to have been set");

        return this.props.id1;
    }

    /**
     * Pack props into packed fields.
     * Always do this after changing/setting props and calling function
     * who operate on the packed fields.
     *
     * @param preserveTransient if true then preserve transient values for the
     * first model object when packing. Embedded models are always packed
     * preserving transient values.
     * To strip transient values from embedded model pack it seperately and
     * set the packed buffer as the field value instead of the props object.
     * @returns packed data
     */
    public pack(preserveTransient: boolean = false): Buffer {
        assert(this.props, "Expected props to have been set");

        const maxIndex = preserveTransient ?
            TRANSIENT_HIGH_INDEX : 127;

        this.prePack();

        this.packed = PackSchema(this.fields, this.props, maxIndex);

        this.postPack();

        return this.packed;
    }

    /**
     * Get the current packed buffer without repacking it.
     *
     * @returns packed buffer as is
     * @throws if not packed
     */
    public getPacked(): Buffer {
        assert(this.packed, "Expected model to have been packed");

        return this.packed;
    }

    /**
     * @param preserveTransient if true then preserve any transient values
     * @param deepUnpack if true then perform a deep unpack
     * for the first model object when unpacking. Embedded models are always
     * unpacked preserving transient values.
     */
    public unpack(preserveTransient: boolean = false, deepUnpack: boolean = false) {
        assert(this.packed, "Expected model to have been constructed with data");

        assert(!this.props, "Expected props to not be set");

        // 127 is the highest index for regular fields.
        //
        const maxIndex = preserveTransient ?
            TRANSIENT_HIGH_INDEX : 127;

        this.props =
            UnpackSchema(this.packed, this.fields, deepUnpack,
                maxIndex) as BaseModelProps;

        this.postUnpack();
    }

    /**
     * Hash packed fields from 0 to toIndex (including).
     *
     * Always pack() model before hashing.
     *
     * @param toIndex hash fields up to and including this index
     * @returns hash
     */
    public hash(toIndex: number = 127): Buffer {
        assert(this.packed, "Expected model to have been packed");

        return HashFields(this.packed, 0, toIndex);
    }

    public hashToSign(): Buffer {
        assert(this.props, "Expected props to have been set");

        let nextSignatureIndex;

        if (!this.props.signature1) {
            nextSignatureIndex = SIGNATURE_INDEX1;
        }
        else if (!this.props.signature2) {
            nextSignatureIndex = SIGNATURE_INDEX2;
        }
        else if (!this.props.signature3) {
            nextSignatureIndex = SIGNATURE_INDEX3;
        }
        else {
            throw new Error("Model already fully signed");
        }

        const message = this.hash(nextSignatureIndex - 1);

        return message;
    }

    /**
     * Hash all packed fields within the transient index range.
     *
     * It is important that the model was packed with preserveTransient
     * for the transient hash to be correctly hashed.
     *
     * Always call pack(true) model before with preserve transient fields
     * option before calling hashTransient().
     *
     * @returns hash
     */
    public hashTransient(): Buffer {
        assert(this.packed, "Expected model to have been packed");

        return HashFields(this.packed, TRANSIENT_HASH_LOW_INDEX,
            TRANSIENT_HASH_HIGH_INDEX);
    }

    public hashField(name: string): string | undefined {
        assert(this.packed, "Expected model to have been packed");

        const field = this.fields[name];

        if (!field) {
            return undefined;
        }

        return HashFields(this.packed, field.index, field.index).
            toString("hex");
    }

    /**
     * Validate all properties in the model.
     *
     * Note that signatures are not validated as those are checked on
     * verify.
     *
     * @param deepValidate is set then validate nested models and unpack them
     * if necessary
     * @param time if set then validate so model has not expired.
     * creationTime is not checked against time, only expireTime.
     * @returns tuple [status: boolean, error: string]
     * status true if validated correctly, error provided if status is false
     */
    public validate(deepValidate: boolean = false, //eslint-disable-line @typescript-eslint/no-unused-vars
        time?: number): [boolean, string]
    {
        assert(this.props, "Expected props to have been set");

        if (!this.props.modelType || this.props.modelType.length !== 3) {
            return [false, "modelType expected to be set to 3 bytes"];
        }

        if (!this.props.owner || this.props.owner.length === 0) {
            return [false, "owner expected to be set"];
        }

        const expireTime   = this.props.expireTime;
        const creationTime = this.props.creationTime;

        if (creationTime === undefined) {
            return [false, "creationTime must be set"];
        }

        if (expireTime !== undefined) {
            if (creationTime >= expireTime) {
                return [false,
                    "creationTime (if set) must be lesser than expireTime (if set)"];
            }

            if (time !== undefined) {
                if (expireTime <= time) {
                    return [false, "model has expired"];
                }
            }
        }

        if (creationTime < 0) {
            return [false, "creationTime (if set) must be 0 or greater"];
        }

        return [true, ""];
    }

    /**
     * Sign model and add signature to props, then pack model.
     * An unpacked model will get unpacked to be able to validate it.
     *
     * @param keyPair the key pair to sign with
     * @param deepValidate set to false to only shallow validate
     * @throws if keypair not valid to sign with or if model already signed
     */
    public sign(keyPair: KeyPair, deepValidate: boolean = true) {
        if (this.props) {
            this.pack();
        }
        else {
            this.unpack();
        }

        const validated = this.validate(deepValidate);

        if (!validated[0]) {
            throw new Error(`Could not validate prior to signing: ${validated[1]}`);
        }

        const message = this.hashToSign();

        const signature = Krypto.Sign(message, keyPair);

        let type = -1;

        if (Krypto.IsEd25519(keyPair.publicKey)) {
            type = Krypto.ED25519.TYPE;
        }
        else if (Krypto.IsEthereum(keyPair.publicKey)) {
            type = Krypto.ETHEREUM.TYPE;
        }

        this.addSignature(signature, keyPair.publicKey, type);
    }

    /**
     * Add a signature to the model.
     * Use this when signing by other means and then call this to add the
     * signature.
     *
     * The model will automatically get packed when signature has been added.
     *
     * @param signature to add
     * @param publicKey public key belonging to signature
     * @param type the signature schema used as defined in Krypto.ts
     * @throws if not packed/mispacked or signature errors such as already
     * existing signature
     */
    public addSignature(signature: Buffer, publicKey: Buffer, type: number) {
        assert(this.props, "Expected props to have been set");

        const index = this.canKeySign(publicKey);

        assert(index >=0,
            `Signature already present or key (${publicKey.toString("hex")}) not valid to sign with.`);

        const signatureObj = {
            index,
            type,
            signature,
        };

        if (!this.props.signature1) {
            this.props.signature1 = signatureObj;
        }
        else if (!this.props.signature2) {
            this.props.signature2 = signatureObj;
        }
        else if (!this.props.signature3) {
            this.props.signature3 = signatureObj;
        }
        else {
            throw new Error("Signatures overflow");
        }

        this.pack();
    }

    /**
     * Verify all signatures, optionally including in sub schemas recursively.
     *
     * @param options if allowUnsigned if true then allow this node to lack signatures,
     * but verify those existing, which can be useful when passing around a
     * multisig to be signed by all parties
     * @returns true if signatures verify correctly
     * @throws on error unpacking or on malformed/missing signatures
     */
    public verify(options?: {allowUnsigned?: boolean}): boolean {
        if (!this.packed && this.props) {
            this.pack();
        }

        assert(this.packed, "Expected model to have been packed");

        const signaturesVerfification =
            this.getSignaturesRecursive(Boolean(options?.allowUnsigned));

        for (let i=0; i<signaturesVerfification.length; i++) {
            const signatureVerfification = signaturesVerfification[i];

            if (!Krypto.Verify(signatureVerfification)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Recursively extract all signatures to be verified.
     *
     * @param allowUnsigned if true then for first model allow for missing
     * signatures, but for any embedded models which are recursively
     * extracted this parameter has no effect
     */
    public getSignaturesRecursive(allowUnsigned: boolean = false): SignatureVerification[] {
        if (!this.packed && this.props) {
            this.pack();
        }

        assert(this.packed, "Expected model to have been packed");

        return GetSignaturesRecursive(this.packed, allowUnsigned);
    }

    /**
     * Get all signatures to be verified from the given packed model.
     *
     * Returns all signatures. If using multisig signCert there can be many
     * signatures.
     *
     * If any signatures are missing an exception is thrown,
     * unless allowUnsigned is set.
     *
     * @param allowUnsigned if true then allow for missing signatures
     * @returns all signatures to be verified
     * @throws if not all signatures can be extracted,
     * unless allowUnsigned is set then that is allowed.
     */
    public getSignatures(allowUnsigned: boolean = false): SignatureVerification[] {
        if (!this.packed && this.props) {
            this.pack();
        }

        assert(this.packed, "Expected model to have been packed");

        return GetSignatures(this.packed, allowUnsigned);
    }

    /**
     * Get list of public keys which are allowed to sign this model.
     * If not using signCert a list of a single public key (owner) is returned.
     * If using signCert the list of target public keys extracted from the signCert
     * is returned.
     *
     * @returns either owner or targetPublicKeys of signCert
     */
    public getEligableSigningKeys(): Buffer[] {
        if (!this.packed && this.props) {
            this.pack();
        }

        assert(this.packed, "Expected model to have been packed");

        return GetEligableSigningKeys(this.packed);
    }

    /**
     * Returns a positive number of how many signatures are missing.
     */
    public missingSignatures(): number {
        assert(this.packed, "Expected model to have been packed");

        return MissingSignatures(this.packed);
    }

    /**
     * @returns index of eligable not yet signed with public key
     * <0 if not eligable or if already signed.
     */
    public canKeySign(publicKey: Buffer): number {
        const index = this.getEligableSigningKeys().findIndex( publicKey2 =>
            publicKey2.equals(publicKey) );

        if (index < 0) {
            // Key is not represented as eligable.
            //
            return -1;
        }

        for (const signatureVerification of this.getSignatures(true)) {
            if (signatureVerification.publicKey.equals(publicKey)) {
                // Key already signed
                //
                return -1;
            }
        }

        // Key is eligable and has not been used to sign with yet.
        //
        return index;
    }

    /**
     * Extract the target public keys from the embedded certificate.
     *
     * @returns array of public keys
     * @throws on unpacking error
     */
    //public getTargetPublicKeys(): Buffer[] {
        //if (!this.packed && this.props) {
            //this.pack();
        //}

        //assert(this.packed, "Expected model to have been packed");

        //const fieldIterator = FieldIterator(this.packed);

        //const packedCert = fieldIterator.get(SIGNCERT_INDEX)?.value;

        //assert(packedCert, "Expected signCert to be present");

        //return GetTargetPublicKeys(packedCert);
    //}

    public loadFlags(): BaseModelFlags {
        return {};
    }

    //eslint-disable-next-line
    public storeFlags(baseModelFlags: BaseModelFlags) {}

    protected prePack() {}

    protected postPack() {
        assert(this.props, "Expected props to have been set");
        assert(this.packed, "Expected packed to have been set");

        try {
            // Triggers error if unsigned
            //
            GetSignatures(this.packed);

            this.props.id1 = HashFields(this.packed, 0, 127);
        }
        catch(e) {  //eslint-disable-line @typescript-eslint/no-unused-vars
            // Not fully/properly signed
            // do not set id1
            delete this.props.id1;
        }
    }

    protected postUnpack() {
        assert(this.props, "Expected props to have been set");
        assert(this.packed, "Expected packed to have been set");

        try {
            // Triggers error if unsigned
            //
            GetSignatures(this.packed);

            this.props.id1 = HashFields(this.packed, 0, 127);
        }
        catch(e) {  //eslint-disable-line @typescript-eslint/no-unused-vars
            // Not fully/properly signed
            // do not set id1
            delete this.props.id1;
        }
    }

    public filter(filter: Filter): boolean {
        assert(this.props, "Expected props to have been set");

        let value1: any = (this.props as any)[filter.field];

        // Just like in SQL we can't compare a value to null, but need a special check for it.
        //
        if (value1 === undefined) {
            return filter.cmp === CMP.IS_NULL;
        }
        else if (filter.cmp === CMP.IS_NULL) {
            return false;
        }

        let hashBeforeCmp = false;
        let sliceIndex: number | undefined;
        let sliceLength: number | undefined;
        let bitop: string | undefined;
        let bitopvalue: bigint | undefined;

        if (filter.operator) {
            if (filter.operator.match(/^[ ]*hash[ ]*$/)) {
                hashBeforeCmp=true;
            }
            else if (filter.operator.match(/^[ ]*:/)) {
                const regex = /^[ ]*:(-?\d+)(,(\d+))?[ ]*$/;
                const match = regex.exec(filter.operator);
                if (!match) {
                    throw new Error(`Could not parse field operator "${filter.operator}" for field: ${filter.field}`);
                }
                sliceIndex  = Number(match[1]);
                sliceLength = match[3] !== undefined ? Number(match[3]) : undefined;
            }
            else {
                const regex = /^[ ]*(&|\||\^|>>|<<)[ ]*(\d+)[ ]*$/;
                const match = regex.exec(filter.operator);
                if (!match) {
                    throw new Error(`Could not parse field operator "${filter.operator}" for field: ${filter.field}`);
                }
                bitop      = match[1];
                bitopvalue = BigInt(match[2] ?? 0);
            }
        }

        let diff: number;

        const type = typeof(value1);

        if (type === "bigint") {
            const value2 = BigInt(filter.value);

            if (value1 > value2) {
                diff = 1;
            }
            else if (value1 < value2) {
                diff = -1;
            }
            else {
                diff = 0;
            }
        }
        else if (type === "number") {
            const value2 = Number(filter.value);

            if (bitop && bitopvalue !== undefined) {
                assert(value1 >= 0, "Type error: bitwise operation can only be on uints");

                let value1b = BigInt(value1);

                assert(value1b <= BigInt(2**32-1), "Type error: bitwise operation can only be on uints up to 32 bit");

                const bitmask = 0xffffffffn;  // 32 bit.

                if (bitop === '&') {
                    value1b = value1b & bitopvalue;
                }
                else if (bitop === '|') {
                    value1b = value1b | bitopvalue;
                }
                else if (bitop === '^') {
                    value1b = value1b ^ bitopvalue;
                }
                else if (bitop === '<<') {
                    value1b = value1b << bitopvalue;
                }
                else if (bitop === '>>') {
                    value1b = value1b >> bitopvalue;
                }

                value1 = Number(value1b & bitmask);
            }

            diff = value1 - value2;
        }
        else if (type === "string") {
            let value1b = value1 as string;

            if (sliceIndex !== undefined) {
                if (sliceIndex < 0) {
                    sliceIndex = value1b.length + sliceIndex;
                }

                if (sliceLength === undefined) {
                    sliceLength = value1b.length - sliceIndex;
                }

                const sliceEnd = sliceIndex + sliceLength;

                value1b = value1b.slice(sliceIndex, sliceEnd);
            }

            if (hashBeforeCmp) {
                const value1c = Hash(Buffer.from(value1b, "utf8"));

                const value2 = Buffer.from(filter.value, "hex");

                diff = value1c < value2 ? -1 : value1c > value2 ? 1 : 0;
            }
            else {
                const value2 = filter.value;

                diff = value1b < value2 ? -1 : value1b > value2 ? 1 : 0;
            }
        }
        else if (Buffer.isBuffer(value1)) {
            let value1b = value1 as Buffer;

            const value2 = Buffer.from(filter.value, "hex");

            if (sliceIndex !== undefined) {
                if (sliceIndex < 0) {
                    sliceIndex = value1b.length + sliceIndex;
                }

                if (sliceLength === undefined) {
                    sliceLength = value1b.length - sliceIndex;
                }

                const sliceEnd = sliceIndex + sliceLength;

                value1b = value1b.slice(sliceIndex, sliceEnd);
            }

            if (hashBeforeCmp) {
                value1b = Hash(value1b);
            }

            diff = value1b < value2 ? -1 : value1b > value2 ? 1 : 0;
        }
        else {
            return false;
        }

        if (filter.cmp === CMP.EQ) {
            return diff === 0;
        }
        else if (filter.cmp === CMP.NE) {
            return diff !== 0;
        }
        else if (filter.cmp === CMP.LT) {
            return diff < 0;
        }
        else if (filter.cmp === CMP.GT) {
            return diff > 0;
        }
        else if (filter.cmp === CMP.GE) {
            return diff >= 0;
        }
        else if (filter.cmp === CMP.LE) {
            return diff <= 0;
        }

        return false;
    }
}

/**
 * Get all signatures to be verified from the given packed model.
 *
 * Returns all signatures. If using multisig signCert there
 * may be many signatures.
 *
 * If any signatures are missing an exception is thrown,
 * unless allowUnsigned is et.
 *
 * @param packed the packed model
 * @param allowUnsigned if true then allow for missing signatures
 * @returns all signatures to be verified
 * @throws if not all signatures can be extracted,
 * unless allowUnsigned is set then that is allowed.
 */
export function GetSignatures(packed: Buffer,
    allowUnsigned: boolean = false): SignatureVerification[]
{
    const eligableSigningPublicKeys = GetEligableSigningKeys(packed);

    const fieldIterator = FieldIterator(packed);

    const signatures: SignatureVerification[] = [];

    let expectNoMore = false;

    for (let signatureIndex = SIGNATURE_INDEX1;
        signatureIndex <= SIGNATURE_INDEX3; signatureIndex++ )
    {
        const signaturePacked = fieldIterator.get(signatureIndex)?.value;

        if (!signaturePacked) {
            // We set this to make sure no further signatures exist.
            //
            expectNoMore = true;
            continue;
        }

        assert(!expectNoMore, "Error in signature list");

        const message = HashFields(packed, 0, signatureIndex - 1);

        const signatureObj =
            UnpackSchema(signaturePacked, SignatureSchema) as SignatureObject;

        const publicKey: Buffer | undefined =
            eligableSigningPublicKeys[signatureObj.index];

        assert(publicKey, "Expected signature index to map to public key");

        signatures.push({
            signature:  signatureObj.signature,
            type:       signatureObj.type,
            publicKey,
            message,
        });
    }

    if (fieldIterator.get(SIGNCERT_INDEX)?.value) {
        const threshold = GetMultisigThreshold(packed);

        if (eligableSigningPublicKeys.length > 1) {
            assert(threshold,
                "Expected multisigThreshold to have been set as there are more than one targetPublicKeys");

            assert(threshold >=1 && threshold <= 3,  // max signatures supported are 3
                "Expecting threshold to be a viable value");

            if (!allowUnsigned) {
                assert(signatures.length >= threshold,
                    "Lacking signatures for multisig");
            }

            assert(signatures.length <= threshold,
                "Unexpected many signatures");
        }
        else {
            assert(threshold === 1, "Expected threshold to be 1")

            if (!allowUnsigned) {
                assert(signatures.length === 1, "Missing signature");
            }
        }
    }
    else {
        if (!allowUnsigned) {
            assert(signatures.length >= 1,
                "Lacking signature");
        }

        assert(signatures.length <= 1,
            "Unexpected many signatures");
    }

    return signatures;
}

export function GetTargetPublicKeys(packedCert: Buffer): Buffer[] {
    const it = FieldIterator(packedCert);

    const targetsField = it.get(SIGNCERT_TARGET_PUBLICKEYS_INDEX)?.value;

    assert(targetsField, "Expecting targets field to be set in signCert");

    const targetPublicKeys = UnpackSchema(targetsField,
        CertTargetsSchema) as Buffer[];

    return targetPublicKeys;
}

export function GetSignaturesRecursive(packed: Buffer,
    allowUnsigned: boolean = false): SignatureVerification[]
{
    const signatures: SignatureVerification[] = [];

    // Will throw on missing signatures unless allowUnsigned is true.
    //
    signatures.push(...
        GetSignatures(packed, allowUnsigned));

    // Recurse on all embedded nodes and certs to get their signatures.
    //
    const fieldIterator = FieldIterator(packed);

    for (let index=SUBSCHEMA_LOW_INDEX; index<=SUBSCHEMA_HIGH_INDEX; index++) {
        const field = fieldIterator.get(index);

        if (field?.value) {
            // do not pass along allowUnsigned argument
            //
            signatures.push(...GetSignaturesRecursive(field.value));
        }
    }

    return signatures;
}

export function GetEligableSigningKeys(packed: Buffer): Buffer[] {
    const fieldIterator = FieldIterator(packed);

    const packedCert = fieldIterator.get(SIGNCERT_INDEX)?.value;

    let publicKeys: Buffer[] = [];

    if (packedCert) {
        publicKeys = GetTargetPublicKeys(packedCert);
    }
    else {
        const owner = fieldIterator.get(OWNER_INDEX)?.value;

        assert(owner, "Expected owner to be set");

        publicKeys.push(owner);
    }

    return publicKeys;
}

export function MissingSignatures(packed: Buffer): number {
    const fieldIterator = FieldIterator(packed);

    const signatures = GetSignatures(packed, true);

    let threshold = 1;

    if (fieldIterator.get(SIGNCERT_INDEX)?.value) {
        threshold = GetMultisigThreshold(packed) ?? 1;
    }

    return threshold - signatures.length;
}

export function GetMultisigThreshold(packed: Buffer): number | undefined {
    const fieldIterator = FieldIterator(packed);

    const packedCert = fieldIterator.get(SIGNCERT_INDEX)?.value;

    assert(packedCert, "Expected signCert to have been set");

    const fieldIterator2 = FieldIterator(packedCert);

    const sigThreshold = fieldIterator2.get(SIGNCERT_THRESHOLD_INDEX)?.value;

    // unpack integer
    //
    const threshold = sigThreshold ?
        UnpackValue(sigThreshold, {type: FieldType.UINT8, index: 0}) : 1;

    return threshold;
}

//eslint-disable-next-line
export function GetModelType(propsOrPacked: Buffer | Record<string, any>): Buffer {
    let modelType: Buffer | undefined;

    if (Buffer.isBuffer(propsOrPacked)) {
        const fieldIterator = FieldIterator(propsOrPacked);

        modelType = fieldIterator.get(MODELTYPE_INDEX)?.value;

        assert(modelType,
            "Expected modelType to have been set as field in packed data");
    }
    else {
        modelType = propsOrPacked.modelType;

        assert(modelType,
            "Expected modelType to have been set as property");
    }

    return modelType;
}

/**
 * Supports up to 48 bit integers.
 */
export function IS_BIT_SET(config: number, index: number): boolean {
    const bin = config.toString(2).padStart(index + 1, "0").split("").reverse();

    return bin[index] === "1";
}

/**
 * Supports up to 48 bit integers.
 */
export function SET_BIT(config: number, index: number, isSet: boolean): number {
    const bin = config.toString(2).padStart(index + 1, "0").split("").reverse();

    bin[index] = isSet ? "1" : "0";

    return parseInt(bin.reverse().join(""), 2);
}

export function CopyBuf(b: Buffer): Buffer {
    const l = b.length;

    const b2 = Buffer.alloc(l);

    for (let i=0; i<l; i++) {
        b2[i] = b[i];
    }

    return b2;
}

export function Hash(b: Buffer): Buffer {
    const hfn = blake2b(32);

    hfn.update(b);

    return Buffer.from(hfn.digest());
}

export function HashList(b: (Buffer | undefined)[]): Buffer {
    let hfn = blake2b(32);

    const l = b.length;

    for (let i=0; i<l; i++) {
        const v = b[i];

        if (v === undefined) {

            const hash = hfn.digest();

            hfn = blake2b(32);

            hfn.update(hash);
        }
        else {
            hfn.update(v);
        }
    }

    return Buffer.from(hfn.digest());
}

export function HashConstraints(lockedConfig: number, packed: Buffer, props: object,
    fieldsMapping: ConstraintsFieldsMapping, flagsMapping: ConstraintsFlagsMapping,
    configs: ConstraintsConfigValues): Buffer
{
    const fieldIndexes: number[] = [];

    // First hash all fields as packed using the regular fields hashing
    //
    const fieldKeys = Object.keys(fieldsMapping);
    for (let i=0; i<fieldKeys.length; i++) {
        const key = fieldKeys[i];

        const bitIndex = Number(key);

        if (IS_BIT_SET(lockedConfig, bitIndex)) {
            fieldIndexes.push(fieldsMapping[key]);
        }
    }

    const hashed = HashSpecificFields(packed, fieldIndexes);

    // Now do the flags
    //
    const b = blake2b(32);

    b.update(hashed);

    const flagKeys = Object.keys(flagsMapping);

    for (let i=0; i<flagKeys.length; i++) {
        const key = flagKeys[i];

        const bit = Number(key);

        if ((lockedConfig & 2**bit) === 0) {
            continue;
        }

        const [configType, configIndex] = flagsMapping[key];

        const config = configs[configType] ?? 0;
        const isSet = IS_BIT_SET(config, configIndex);

        b.update(Buffer.from("flagHashing"));
        b.update(Buffer.from(key));
        b.update(Buffer.from(isSet ? [1] : [0]));
    }

    return Buffer.from(b.digest());
}

export function LoadSignature(signature: Buffer | SignatureObject): SignatureObject {
    if (Buffer.isBuffer(signature)) {
        return UnpackSchema(signature, SignatureSchema) as SignatureObject;
    }

    return signature;
}
