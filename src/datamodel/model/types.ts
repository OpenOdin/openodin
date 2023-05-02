/**
 * The ModelType is a six byte array which is encoded into the header of the export
 * so that the code can check that the a correct image is loaded for a given Model.
 * A Model can only load a data image which is of the exact same ModelType.
 */
export type ModelType = Buffer;

/** The supported field data types. */
export enum FieldType {
    NONE        = 0,    // 0 bytes, never exported or hashed. Always undefined.
    INT8        = 1,    // 1 byte
    UINT8       = 2,    // 1 byte
    INT16LE     = 3,    // 2 bytes
    UINT16LE    = 4,    // 2 bytes
    INT16BE     = 5,    // 2 bytes
    UINT16BE    = 6,    // 2 bytes
    UINT24LE    = 7,    // 3 bytes
    UINT24BE    = 8,    // 3 bytes
    INT32LE     = 9,    // 4 bytes
    UINT32LE    = 10,    // 4 bytes
    INT32BE     = 11,    // 4 bytes
    UINT32BE    = 12,    // 4 bytes
    UINT48LE    = 13,   // 6 bytes
    UINT48BE    = 14,   // 6 bytes
    UINT64LE    = 15,   // 8 bytes
    UINT64BE    = 16,   // 8 bytes
    STRING      = 20,   // Dynamic length, UTF8. Adds 2 byte prefix to encoded length.
    BYTES       = 21,   // Dynamic length. Adds two byte prefix to encoded length.
    BYTE1       = 22,   // 1 byte
    BYTE2       = 23,   // 2 bytes
    BYTE3       = 24,   // 3 bytes
    BYTE4       = 25,   // 4 bytes
    BYTE5       = 26,   // 5 bytes
    BYTE6       = 27,   // 6 bytes
    BYTE7       = 28,   // 7 bytes
    BYTE8       = 29,   // 8 bytes
    BYTE16      = 30,   // 16 bytes
    BYTE32      = 31,   // 32 bytes
    BYTE64      = 32,   // 64 bytes
}

/** All string types supported. */
export const STRINGTYPES = [
    FieldType.STRING,
];

/** All integer types supported. */
export const INTEGERTYPES = [
    FieldType.INT8,
    FieldType.UINT8,
    FieldType.INT16LE,
    FieldType.UINT16LE,
    FieldType.INT16BE,
    FieldType.UINT16BE,
    FieldType.UINT24LE,
    FieldType.UINT24BE,
    FieldType.INT32LE,
    FieldType.UINT32LE,
    FieldType.INT32BE,
    FieldType.UINT32BE,
    FieldType.UINT48LE,
    FieldType.UINT48BE,
];

/** All integer types who support bitwise operations. */
export const INTEGERTYPES_BITWISE = [
    FieldType.UINT8,
    FieldType.UINT16LE,
    FieldType.UINT16BE,
    FieldType.UINT24LE,
    FieldType.UINT24BE,
    FieldType.UINT32LE,
    FieldType.UINT32BE,
];

/** All big int types supported. */
export const BIGINTTYPES = [
    FieldType.UINT64LE,
    FieldType.UINT64BE,
];

/** All buffer types supported. */
export const BUFFERTYPES = [
    FieldType.BYTES,
    FieldType.BYTE1,
    FieldType.BYTE2,
    FieldType.BYTE3,
    FieldType.BYTE4,
    FieldType.BYTE5,
    FieldType.BYTE6,
    FieldType.BYTE7,
    FieldType.BYTE8,
    FieldType.BYTE16,
    FieldType.BYTE32,
    FieldType.BYTE64,
];

/**
 * Image data header structure:
 * bytes:
 * 0-5 six bytes model type
 * x   UINT8 Field type
 * x+1 UINT8 Field index
 * x+2 UINT16BE field length for string and bytes fields.
 * x+4 field data
 */
export type Field = {
    name: string,       // Not encoded into image
    type: FieldType,    // Encoded into image.
    index: number,      // Must be unique within the node and must never change for the same. Encoded into image.
    maxSize?: number,   // Some field types have variable length, this limits the maximum byte length. Not encoded into image.
    hash?: boolean,     // If set to true (defualt) then it dictates if the field is part of the hashing. Set to false to not include field in hashing. If transient set to true then hashing is off for the field.
    transient?: boolean,// If set then the field is not exported for storing and is not part of the hashing.
};

export type Fields = {[key: string]: Field};

/** Used in Filter for comparison operations. */
export enum CMP {
    EQ = "eq",
    NE = "ne",
    LT = "lt",
    LE = "le",
    GT = "gt",
    GE = "ge",
}

/**
 * The value type must be the same type as the field.
 * Except when field is Buffer value is allowed to be string which is encoded as hexadecimal into a buffer before comparing.
 */
export type Filter = {
    /**
     * The name of the field which value to compare.
     *
     * Special cases:
     * - If "id" then gets id2, if no id2 then gets the id1 value.
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
     *         string are utf8 encoded into buffer before hashing.
     */
    operator?: string,

    /** The comparison operator to use. */
    cmp: CMP,

    /**
     * The value to compare the field value to. The types must match.
     * If the field is of bytes type then this value can be hexencoded string.
     */
    value: string | number | Buffer | undefined,
};
