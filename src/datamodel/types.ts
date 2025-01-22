/**
 * Indexes and ranges:
 *
 * 0-127 makes up the signed data
 *  8-15 sub schemas, certs or nodes which can be automatically verified.
 *  8 is the active sign cert of a model which the model is verified against,
 *  if set.
 *  unused indexes in this range are free to use for deriving schemas.
 *
 * 128-191 transient indexes, not part of signing and usually not part of packing
 *  128-159 part of hashable transient values
 *  160-191 transient values not hashed
 *
 * 192-255 reserved for future use
 */

export const MODELTYPE_INDEX                =   0;
export const OWNER_INDEX                    =   1;
export const CREATIONTIME_INDEX             =   2;
export const EXPIRETIME_INDEX               =   3;

// Only applicable in signcerts
export const SIGNCERT_THRESHOLD_INDEX       =   6;

// Only applicable in signcerts
export const SIGNCERT_TARGET_PUBLICKEYS_INDEX = 7;

export const SIGNCERT_INDEX                 =   8;  // Within sub schema range
export const SIGNATURE_INDEX1               = 124;
export const SIGNATURE_INDEX2               = 125;
export const SIGNATURE_INDEX3               = 126;
// index 127 reserved for work nonce (or checksum).

export const SUBSCHEMA_LOW_INDEX            =   8;
export const SUBSCHEMA_HIGH_INDEX           =  15;

export const TRANSIENT_LOW_INDEX            = 128;
export const TRANSIENT_HIGH_INDEX           = 191;
export const TRANSIENT_HASH_LOW_INDEX       = TRANSIENT_LOW_INDEX;
export const TRANSIENT_HASH_HIGH_INDEX      = 159;

export type KeyPair = {
    publicKey: Buffer,
    secretKey: Buffer,
};

export type Ed25519Schema   = 0;
export type EthereumSchema  = 1;

export type KryptoSchemaType = Ed25519Schema | EthereumSchema;

export type KryptoSchema = {
    /**
     * 0 = Ed25519
     * 1 = Ethereum (ECDSA)
     */
    TYPE: Ed25519Schema | EthereumSchema,

    /**
     * Length of public key in bytes.
     */
    PUBLICKEY_LENGTH: number,

    /**
     * Length of signature in bytes.
     */
    SIGNATURE_LENGTH: number,
};

export type SignatureObject = {
    /**
     * index of the public key this signature is for.
     * For model without certificates this is 0,
     * for models with certificates index points
     * to the public key in the certs targetPublicKeys array.
     */
    index:      number,

    /**
     * Indicates which cryptographic or hmac schema is used to prove authenticity.
     */
    type:       number,

    signature:  Buffer,
};

export type BaseModelProps = {
    /** 4-byte ID of the datamodel */
    modelType?:     Buffer,

    /** id1 is calculated from the packed model */
    id1?:           Buffer,

    /** Unique identity of the owner of the datamodel */
    owner?:         Buffer,

    /**
     * Creation time (in ms). Must be lesser than expireTime.
     */
    creationTime?:  number,

    /**
     * Optional expire time (in ms) of the model.
     * Must be greater then creationTime and greater than 0, if set.
     * When now() >= expireTime the model has expired.
     */
    expireTime?:    number,

    /**
     * If not using a certificate this will be the only signature.
     */
    signature1?:    SignatureObject | Buffer,

    /**
     * Can be set for multisig.
     */
    signature2?:    SignatureObject | Buffer,

    /**
     * Can be set for multisig.
     */
    signature3?:    SignatureObject | Buffer,
};

/**
 * Flags are mapped values from config bits.
 */
export type BaseModelFlags = object;

/**
 * Type used to pass around signatures to be verified.
 */
export type SignatureVerification = {
    publicKey:  Buffer,
    type:       number,
    signature:  Buffer,
    message:    Buffer,
};

export interface BaseModelInterface {
    /**
     * Pack or repack the props to binary form.
     * Will update the internal pack buffer.
     * @returns the packed buffer.
     */
    pack(preserveTransient?: boolean): Buffer;
    getPacked(): Buffer;
    unpack(deepUnpack?: boolean, preserveTransient?: boolean): void;

    setProps(props: BaseModelProps): void;
    getProps(): BaseModelProps;
    mergeProps(props: BaseModelProps): void;
    getId1(): Buffer;
    loadFlags(): BaseModelFlags;
    storeFlags(baseModelFlags: BaseModelFlags): void;

    hash(toIndex: number): Buffer;
    hashToSign(): Buffer;
    hashTransient(): Buffer;
    hashField(name: string): string | undefined;
    verify(options?: {allowUnsigned?: boolean}): boolean;
    getSignaturesRecursive(allowUnsigned?: boolean): SignatureVerification[];
    getSignatures(allowUnsigned?: boolean): SignatureVerification[];
    getEligableSigningKeys(): Buffer[];
    canKeySign(publicKey: Buffer): number;
    missingSignatures(): number;
    //getTargetPublicKeys(packedCert: Buffer): Buffer[];
    sign(keyPair: KeyPair): void;
    addSignature(signature: Buffer, publicKey: Buffer, type: number): void;

    /**
     * Validate model properties.
     *
     * @param deepValidate if set to true validate all nested models
     * @param time set to time in ms to force expiration of model who's
     * expireTime is lesser or equal time.
     * @return [success, error]
     * if success == false then error is set to reason
     */
    validate(deepValidate?: boolean, time?: number): [boolean, string];

    filter(filter: Filter): boolean;
}

export type ConstraintsFieldsMapping = {
    [bitIndex: string]: number,
};

export type ConstraintsFlagsMapping = {
    [bitIndex: string]: [configType: string, bitIndex: number],
};

export type ConstraintsConfigValues = {
    [configName: string]: number,
};

export type Filter = {
    /**
     * The name of the field which value to compare.
     *
     */
    field: string,

    /**
     * An optional operator which can be applied to some data field types.
     * On unsigned integer fields UINT8, UINT16, UINT24, UINT32 the following
     * bitwise operations can be applied:
     *  & x     AND a bitmask with an integer field,
     *  | x     OR a bitmask with an integer field,
     *  ^ x     XOR a bitmask with an integer field,
     *  >> x    right shift an integer field by x,
     *  << x    left shift an integer field by x.
     *
     *  On string or bytes fields the slice operator can be applied, as:
     *  :1,3   cut a string or bytes field by index:length where ",length" is optional,
     *  :-1    cut a string or bytes field by index:length where start index counts from end.
     *
     *  On string or bytes fields the hash operator can be applied, as:
     *  hash   perform a blake2b 32 byte hashing on the field data before comparison.
     *         strings are utf8 encoded into buffer before hashing.
     *         value is required to be given as hexadecimal string when comparing with hashing.
     *
     * Only one type of operator can be given: bitwise, slicing or hashing.
     *
     * An operator given for a non applicable field is ignored, for example bitwise operations on string or buffers.
     *
     * Bitwise operations can only be performed on unsigned integer types up to 32 bit.
     *
     *  Examples, operator=
     *  "&1", "& 3", "| 255", "^ 7", ">> 1", "<<2",
     *  ":1,3", ":-1",
     *  "hash",
     */
    operator: string,

    /** The comparison operator to use. */
    cmp: CMP,

    /**
     * The value to compare the field value to.
     *
     * The given value is always string, and the resulting type is determined
     * by the type of the field comparing to.
     *
     * For number and bigint the value is parsed from string to number/bigint.
     *
     * If field is of Buffer type then value should be given as hexadecimal string
     * which is then encoded into Buffer before compared.
     */
    value: string,
};

/** Used in Filter for comparison operations. */
export enum CMP {
    EQ = "eq",
    NE = "ne",
    LT = "lt",
    LE = "le",
    GT = "gt",
    GE = "ge",

    // If value prop is undefined then only comparing to IS_NULL yeilds true.
    IS_NULL = "is_null",
}
