import blake2b from "blake2b";

function assert<T>(value: T, error: string = ""): asserts value is NonNullable<T> {
    if (!value) {
        throw new Error(`Assertion error: ${error}`);
    }
}

/** The supported field data types. */
export enum FieldType {
    INT8        = 1,    // 1 byte
    UINT8       = 2,    // 1 byte
    INT16LE     = 3,    // 2 bytes
    UINT16LE    = 4,    // 2 bytes
    INT16BE     = 5,    // 2 bytes
    UINT16BE    = 6,    // 2 bytes
    UINT24LE    = 7,    // 3 bytes
    UINT24BE    = 8,    // 3 bytes
    INT32LE     = 9,    // 4 bytes
    UINT32LE    = 10,   // 4 bytes
    INT32BE     = 11,   // 4 bytes
    UINT32BE    = 12,   // 4 bytes
    UINT48LE    = 13,   // 6 bytes
    UINT48BE    = 14,   // 6 bytes
    UINT64LE    = 15,   // 8 bytes
    UINT64BE    = 16,   // 8 bytes
    STRING      = 20,   // Dynamic length, UTF8.
    BYTES       = 21,   // Dynamic length.
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
    SCHEMA      = 33,   // sub schema
}

export const FIELD_LENGTH: {[FieldType: string]: number} = {
    [FieldType.INT8]: 1,
    [FieldType.UINT8]: 1,
    [FieldType.INT16LE]: 2,
    [FieldType.UINT16LE]: 2,
    [FieldType.INT16BE]: 2,
    [FieldType.UINT16BE]: 2,
    [FieldType.UINT24LE]: 3,
    [FieldType.UINT24BE]: 3,
    [FieldType.INT32LE]: 4,
    [FieldType.UINT32LE]: 4,
    [FieldType.INT32BE]: 4,
    [FieldType.UINT32BE]: 4,
    [FieldType.UINT48LE]: 6,
    [FieldType.UINT48BE]: 6,
    [FieldType.UINT64LE]: 8,
    [FieldType.UINT64BE]: 8,
    [FieldType.STRING]: -1,
    [FieldType.BYTES]: -1,
    [FieldType.BYTE1]: 1,
    [FieldType.BYTE2]: 2,
    [FieldType.BYTE3]: 3,
    [FieldType.BYTE4]: 4,
    [FieldType.BYTE5]: 5,
    [FieldType.BYTE6]: 6,
    [FieldType.BYTE7]: 7,
    [FieldType.BYTE8]: 8,
    [FieldType.BYTE16]: 16,
    [FieldType.BYTE32]: 32,
    [FieldType.BYTE64]: 64,
    [FieldType.SCHEMA]: -1,
} as const;

/** All string types supported. */
export const FIELD_STRINGS = [
    FieldType.STRING,
] as const;

/** All integer types supported. */
export const FIELD_INTEGERS = [
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
] as const;

/** All integer types who support bitwise operations. */
export const FIELD_BITWISE_INTEGERS = [
    FieldType.UINT8,
    FieldType.UINT16LE,
    FieldType.UINT16BE,
    FieldType.UINT24LE,
    FieldType.UINT24BE,
    FieldType.UINT32LE,
    FieldType.UINT32BE,
] as const;

/** All big int types supported. */
export const FIELD_BIGINTS = [
    FieldType.UINT64LE,
    FieldType.UINT64BE,
] as const;

/** All buffer types supported. */
export const FIELD_BUFFERS = [
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
] as const;

export type PackedSchemaField = {
    index: number,

    type: FieldType,

    required?: boolean,

    /**
     * Maximum size of bytes for the content of a field,
     * not counting index nr, field type and possible length bytes.
     * For array PackedSchemas maxSize is the maximum length
     * of the array allowed.
     */
    maxSize?: number,

    /**
     * If type is FieldType.SCHEMA, then optionally schema can be set
     * to be used for packing or unpacking of the sub schema.
     *
     * If not set then use current schema.
     *
     * undefined in array means use same schema.
     */
    schema?: Fields,

    /**
     * If set then must match what is the packed value when both packing
     * and unpacking.
     */
    static?: Buffer,

    /**
     * If set then allow the static value (if set) to be a prefix to the
     * data field unpacked.
     * This allows read-only schemas to have broader view to accept
     * different static values with the same prefix.
     *
     * If this is set then schema can only be used for unpack.
     */
    staticPrefix?: boolean,
};

/**
 * If fields has the key "[]" then the packing is treated as packing an array.
 * An array can have maximum 256 entries in total.
 */
export type Fields = {
    [name: string]: PackedSchemaField,
};

//Sixten

/** Unpacked Field returned by Iterator. */
export type UnpackedField = {
    /** The index in the packed binary. */
    index: number,

    /** The type read from the packed binary. */
    type: FieldType,

    /** The value read from the packed binary. */
    value: Buffer,

    /** The full packed field binary: index, type, (length), value. */
    packedField: Buffer,
};

type Iterator = {
    hasNext: () => boolean,

    /**
     * Get next field.
     * @throws if no field available
     */
    next: () => UnpackedField,

    /** Reset the iterator. */
    reset: () => void,

    /**
     * Get UnpackedField at given index without disturbing the iterator.
     * @returns field or undefined if field not found
     * @throws on decoding error
     */
    get: (searchIndex: number) => UnpackedField | undefined,
};

/**
 * @param maxIndex optionally limit or expand the range of fields packed.
 * When packing recursively default maxIndex is used.
 */
export function PackSchema(fields: Fields,
    props: Array<any> | Record<string, any>, maxIndex: number = 127): Buffer  //eslint-disable-line @typescript-eslint/no-explicit-any
{
    const packedFields: Buffer[] = [];

    const schemaKeys = Object.keys(fields);

    const arraySchemaField = fields["[]"];

    if (arraySchemaField) {
        // This means the schema is of array instead of object.
        //
        if (schemaKeys.length !== 1) {
            throw new Error("Array schema can only have a single element with key: \"[]\"");
        }

        assert(Array.isArray(props), "Expecting array as input for array schema");

        assert(arraySchemaField.index === 0,
            "Expecting index always set to 0 for array schema (index has no actual effect)");

        let index = 0;

        assert(props.length <= maxIndex + 1,
            `Array schema can have maximum ${maxIndex + 1} entries`);

        assert(props.length <= 256, "Array schema can have maximum 256 entries");

        for (const value of (props as Array<any>)) {  //eslint-disable-line @typescript-eslint/no-explicit-any
            const schema = {
                ...arraySchemaField,
                index,
            };

            index++;

            const packed = PackValue(schema, value, fields);

            if (packed?.length) {
                packedFields.push(packed);
            }
        }
    }
    else {
        // Object schema
        //

        assert(!Array.isArray(props), "Expecting object as input for object schema");

        const schemaByIndex: {[index: string]: [PackedSchemaField, string]} = {};

        const indexes: number[] = [];

        for(const key of schemaKeys) {
            const schema = fields[key];

            schemaByIndex[String(schema.index)] = [schema, key];

            indexes.push(schema.index);
        }

        indexes.sort( (a, b) => {
            return a - b;
        });

        let lastIndex = -1;

        for (const index of indexes) {
            assert(index !== lastIndex, `index must only be used once: ${index}`);

            lastIndex = index;

            if (index > maxIndex) {
                continue;
            }

            const [schema, key] = schemaByIndex[index] ?? [];

            if (!schema || !key) {
                continue;
            }

            //eslint-disable-next-line @typescript-eslint/no-explicit-any
            const packed = PackValue(schema, (props as Record<string, any>)[key], fields);

            if (packed?.length) {
                packedFields.push(packed);
            }
        }
    }

    const packed = Buffer.concat(packedFields);

    return packed;
}

/**
 * @param packed
 * @param fields
 * @param deepUnpack if true then unpack all sub schemas recursively.
 * Else sub schema fields are set as their packed buffer value
 * @param maxIndex optionally expand or limit the range of fields unpacked.
 * When unpacking recursively default maxIndex is used.
 * @returns unpacked object or array
 */
export function UnpackSchema(packed: Buffer, fields: Fields,
    deepUnpack: boolean = false, maxIndex: number = 127): Record<string, any> | any[]  //eslint-disable-line @typescript-eslint/no-explicit-any
{
    const fieldIterator = FieldIterator(packed);

    const schemaKeys = Object.keys(fields);

    const arraySchemaField = fields["[]"];

    if (arraySchemaField) {
        // This means the schema is of array instead of object.
        //
        if (schemaKeys.length !== 1) {
            throw new Error("Array schema can only have a single element with key: \"[]\"");
        }

        //eslint-disable-next-line @typescript-eslint/no-explicit-any
        const arr: any[] = [];

        while (fieldIterator.hasNext()) {
            const field = fieldIterator.next();

            if (field.index !== arr.length) {
                throw new Error("Array schema must have unbroken array indices");
            }

            if (field.type !== arraySchemaField.type) {
                throw new Error("Type mismatch in packed and schema");
            }

            arr.push(
                UnpackValue(field.value, arraySchemaField, fields, deepUnpack));
        }

        assert(arr.length < maxIndex,
            `Unpacked array length (${arr.length}) larger than allowed (${maxIndex+1})`);

        return arr;
    }
    else {
        // Object schema
        //

        //eslint-disable-next-line @typescript-eslint/no-explicit-any
        const obj: Record<string, any> = {};

        const schemaByIndex: {[index: string]: [PackedSchemaField, string]} = {};

        for(const key of schemaKeys) {
            const schema = fields[key];

            schemaByIndex[schema.index] = [schema, key];
        }

        while (fieldIterator.hasNext()) {
            const field = fieldIterator.next();

            const [schema, key] = schemaByIndex[field.index] ?? [];

            if (!schema) {
                // Tolerate no field defined for the indes to have different
                // model versions compatible.
                // Fields in the packed not defined in Fields will be ignored.
                //
                continue;
            }

            assert(field.type === schema.type,
                "Type mismatch in packed and schema");

            if (schema.index <= maxIndex) {
                obj[key] = UnpackValue(field.value, schema, fields, deepUnpack);
            }
        }

        return obj;
    }
}

export function FieldIterator(packed: Buffer): Iterator {
    let pointer = 0;
    let lastIndex = -1;

    const hasNext = function() {
        return packed.length > pointer;
    };

    const next = function() {
        if (packed.length < pointer + 3) {
            throw new Error("Error in packed, out of bytes");
        }

        const oldPointer = pointer;

        const index = packed[pointer];

        if (index <= lastIndex) {
            throw new Error("Error in packed, index must always increase");
        }

        lastIndex = index;

        pointer++;

        const type = packed[pointer];

        pointer++;

        let length = FIELD_LENGTH[type];

        if (length === undefined) {
            throw new Error("Unknown type in packed");
        }
        else if (length === -1) {
            // Variable length
            length = packed.readUInt16BE(pointer);

            pointer += 2;
        }

        if (packed.length < pointer + length) {
            throw new Error("Error in packed");
        }

        const value = packed.slice(pointer, pointer + length);

        const packedField = packed.slice(oldPointer, pointer + length);

        pointer += length;

        return {
            index,
            type,
            value,
            packedField,
        };
    };

    const reset = function() {
        pointer = 0;
    };

    const get = function(searchIndex: number) {
        const iterator = FieldIterator(packed);

        while (iterator.hasNext()) {
            const field = iterator.next();

            if (field.index === searchIndex) {
                return field;
            }
        }

        return undefined;
    };

    return {
        hasNext,
        next,
        reset,
        get,
    };
}

/**
 * Unpack the given buffer into given type in schema.
 *
 * @param value the extracted value from the packed field
 * @param schema of how to unpack value
 * @param fields must be provided if deepUnpack true
 * @param deepUnpack if true then call UnpackSchema on value,
 * else return the buffer as is
 * @returns value of data type given in schema
 * @throws if cannot be unpacked, wrong length, etc.
 */
export function UnpackValue(value: Buffer, schema: PackedSchemaField,
    fields?: Fields, deepUnpack: boolean = false): any  //eslint-disable-line @typescript-eslint/no-explicit-any
{
    let unpacked: any = undefined;  //eslint-disable-line @typescript-eslint/no-explicit-any

    assert(value.length <= 65535,
        "buffer to unpack too long, max 65535 bytes");

    if (schema.static !== undefined) {
        if (schema.staticPrefix) {
            assert(value.slice(0, schema.static.length).
                equals(schema.static), "static value must be prefix to packed value");
        }
        else {
            assert(value.equals(schema.static),
                "static value must exactly match packed value");
        }
    }

    if (schema.type === FieldType.INT8) {
        assert(value.length === 1);

        unpacked = value.readInt8(0);
    }
    else if (schema.type === FieldType.UINT8) {
        assert(value.length === 1);

        unpacked = value.readUInt8(0);
    }
    else if (schema.type === FieldType.INT16LE) {
        assert(value.length === 2);

        unpacked = value.readInt16LE(0);
    }
    else if (schema.type === FieldType.UINT16LE) {
        assert(value.length === 2);

        unpacked = value.readUInt16LE(0);
    }
    else if (schema.type === FieldType.INT16BE) {
        assert(value.length === 2);

        unpacked = value.readInt16BE(0);
    }
    else if (schema.type === FieldType.UINT16BE) {
        assert(value.length === 2);

        unpacked = value.readUInt16BE(0);
    }
    else if (schema.type === FieldType.UINT24LE) {
        assert(value.length === 3);

        const data = Buffer.concat([value.slice(0, 3), Buffer.alloc(1).fill(0)]);

        unpacked = data.readUInt32LE(0);
    }
    else if (schema.type === FieldType.UINT24BE) {
        assert(value.length === 3);

        const data = Buffer.concat([Buffer.alloc(1).fill(0), value.slice(0, 3)]);

        unpacked = data.readUInt32BE(0);
    }
    else if (schema.type === FieldType.INT32LE) {
        assert(value.length === 4);

        unpacked = value.readInt32LE(0);
    }
    else if (schema.type === FieldType.UINT32LE) {
        assert(value.length === 4);

        unpacked = value.readUInt32LE(0);
    }
    else if (schema.type === FieldType.INT32BE) {
        assert(value.length === 4);

        unpacked = value.readInt32BE(0);
    }
    else if (schema.type === FieldType.UINT32BE) {
        assert(value.length === 4);

        unpacked = value.readUInt32BE(0);
    }
    else if (schema.type === FieldType.UINT48LE) {
        assert(value.length === 6);

        const high32b = value.readUInt32LE(0);

        const low16b  = value.readUInt16LE(4);

        const binary  = low16b.toString(2).padStart(16, "0") + high32b.toString(2).padStart(32, "0");

        unpacked = parseInt(binary, 2);
    }
    else if (schema.type === FieldType.UINT48BE) {
        assert(value.length === 6);

        const high32b = value.readUInt32BE(0);

        const low16b  = value.readUInt16BE(4);

        const binary  = low16b.toString(2).padStart(16, "0") + high32b.toString(2).padStart(32, "0");

        unpacked = parseInt(binary, 2);
    }
    else if (schema.type === FieldType.UINT64LE) {
        assert(value.length === 8);

        const high32b = value.readUInt32LE(0);

        const low32b  = value.readUInt32LE(4);

        const binary  = low32b.toString(2).padStart(32, "0") + high32b.toString(2).padStart(32, "0");

        unpacked = BigInt("0b" + binary);
    }
    else if (schema.type === FieldType.UINT64BE) {
        assert(value.length === 8);

        const high32b = value.readUInt32BE(0);

        const low32b  = value.readUInt32BE(4);

        const binary  = high32b.toString(2).padStart(32, "0") + low32b.toString(2).padStart(32, "0");

        unpacked = BigInt("0b" + binary);
    }
    else if (schema.type === FieldType.STRING) {
        if (schema.maxSize !== undefined) {
            assert(value.length <= schema.maxSize, `Buffer length exceeds max length of ${schema.maxSize}`);
        }

        unpacked = value.toString("utf8");
    }
    else if (schema.type === FieldType.BYTES) {
        if (schema.maxSize !== undefined) {
            assert(value.length <= schema.maxSize, `Buffer length exceeds max length of ${schema.maxSize}`);
        }

        unpacked = value;
    }
    else if (schema.type === FieldType.BYTE1) {
        assert(value.length === 1);

        unpacked = value;
    }
    else if (schema.type === FieldType.BYTE2) {
        assert(value.length === 2);

        unpacked = value;
    }
    else if (schema.type === FieldType.BYTE3) {
        assert(value.length === 3);

        unpacked = value;
    }
    else if (schema.type === FieldType.BYTE4) {
        assert(value.length === 4);

        unpacked = value;
    }
    else if (schema.type === FieldType.BYTE5) {
        assert(value.length === 5);

        unpacked = value;
    }
    else if (schema.type === FieldType.BYTE6) {
        assert(value.length === 6);

        unpacked = value;
    }
    else if (schema.type === FieldType.BYTE7) {
        assert(value.length === 7);

        unpacked = value;
    }
    else if (schema.type === FieldType.BYTE8) {
        assert(value.length === 8);

        unpacked = value;
    }
    else if (schema.type === FieldType.BYTE16) {
        assert(value.length === 16);

        unpacked = value;
    }
    else if (schema.type === FieldType.BYTE32) {
        assert(value.length === 32);

        unpacked = value;
    }
    else if (schema.type === FieldType.BYTE64) {
        assert(value.length === 64);

        unpacked = value;
    }
    else if (schema.type === FieldType.SCHEMA) {
        if (deepUnpack) {
            assert(fields, "fields must be provided if deepUnpack is set");

            const subFields: Fields = schema.schema ?? fields;

            const maxSize = schema.maxSize;

            let maxIndex: number | undefined = undefined;

            // If subFields is of array type we see if we can
            // apply maxIndex.
            //
            if (subFields["[]"] && maxSize !== undefined) {
                maxIndex = maxSize - 1;
            }

            unpacked =
                UnpackSchema(value, subFields, deepUnpack, maxIndex);

            // Only check maxSize in bytes for non-array schemas.
            //
            if (!subFields["[]"] && maxSize !== undefined) {
                assert(value.length <= maxSize,
                    `buffer too long, max ${maxSize} bytes`);
            }

            assert(unpacked, "Could not unpack value with schema");
        }
        else {
            // Note we cannot check maxSize here as we do not know what
            // schema to unpack with.
            //
            unpacked = value;
        }
    }
    else {
        throw new Error("Unsupported schema type");
    }

    return unpacked;
}

export function PackValue(schema: PackedSchemaField, value: any,  //eslint-disable-line @typescript-eslint/no-explicit-any
    fields: Fields): Buffer | undefined
{
    if (schema.static !== undefined) {
        assert(!schema.staticPrefix, "Cannot use schema with staticPrefix to pack");

        if (value === undefined) {
            value = schema.static;
        }

        assert(Buffer.isBuffer(value),
            "Expected value of field with static config to be buffer");

        assert(schema.static.equals(value),
            "Static schema field must either be undefined or be set exactly to the given static value");
    }

    if (value === undefined) {
        assert(!schema.required, `Field is required for index ${schema.index}`);

        return undefined;
    }

    let length = Buffer.alloc(0);

    let data2: Buffer | undefined;

    if (schema.type === FieldType.INT8) {
        assert(typeof(value) === "number", "expecting data type number");

        assert(value >= -128 && value <= 127, "8 bit integer out of bounds");

        data2 = Buffer.alloc(1);

        data2.writeInt8(value, 0);
    }
    else if (schema.type === FieldType.UINT8) {
        assert(typeof(value) === "number", "expecting data type number");

        assert(value >= 0 && value <= 0xff, "8 bit uint out of bounds");

        data2 = Buffer.alloc(1);

        data2.writeUInt8(value, 0);
    }
    else if (schema.type === FieldType.INT16LE) {
        assert(typeof(value) === "number", "expecting data type number");

        assert(value >= -32768 && value <= 32767, "16 bit integer out of bounds");

        data2 = Buffer.alloc(2);

        data2.writeInt16LE(value, 0);
    }
    else if (schema.type === FieldType.UINT16LE) {
        assert(typeof(value) === "number", "expecting data type number");

        assert(value >= 0 && value <= 0xffff, "16 bit uint out of bounds");

        data2 = Buffer.alloc(2);

        data2.writeUInt16LE(value, 0);
    }
    else if (schema.type === FieldType.INT16BE) {
        assert(typeof(value) === "number", "expecting data type number");

        assert(value >= -32768 && value <= 32767, "16 bit integer out of bounds");

        data2 = Buffer.alloc(2);

        data2.writeInt16BE(value, 0);
    }
    else if (schema.type === FieldType.UINT16BE) {
        assert(typeof(value) === "number", "expecting data type number");

        assert(value >= 0 && value <= 0xffff, "16 bit uint out of bounds");

        data2 = Buffer.alloc(2);

        data2.writeUInt16BE(value, 0);
    }
    else if (schema.type === FieldType.UINT24LE) {
        assert(typeof(value) === "number", "expecting data type number");

        assert(value >= 0 || value <= 0xffffff, "24 bit uint out of bounds");

        data2 = Buffer.alloc(4);  // We will truncate away the MSB byte so we are down to three bytes.

        data2.writeUInt32LE(value, 0);

        data2 = data2.slice(0, 3);
    }
    else if (schema.type === FieldType.UINT24BE) {
        assert(typeof(value) === "number", "expecting data type number");

        assert(value >= 0 && value <= 0xffffff, "24 bit uint out of bounds");

        data2 = Buffer.alloc(4);  // We will truncate away the MSB byte so we are down to three bytes.

        data2.writeUInt32BE(value, 0);

        data2 = data2.slice(1, 4);
    }
    else if (schema.type === FieldType.INT32LE) {
        assert(typeof(value) === "number", "expecting data type number");

        assert(value >= -2147483648 && value <= 2147483647, "32 bit integer out of bounds");

        data2 = Buffer.alloc(4);

        data2.writeInt32LE(value, 0);
    }
    else if (schema.type === FieldType.UINT32LE) {
        assert(typeof(value) === "number", "expecting data type number");

        assert(value >= 0 && value <= 0xffffffff, "32 bit uint out of bounds");

        data2 = Buffer.alloc(4);

        data2.writeUInt32LE(value, 0);
    }
    else if (schema.type === FieldType.INT32BE) {
        assert(typeof(value) === "number", "expecting data type number");

        assert(value >= -2147483648 && value <= 2147483647, "32 bit integer out of bounds");

        data2 = Buffer.alloc(4);

        data2.writeInt32BE(value, 0);
    }
    else if (schema.type === FieldType.UINT32BE) {
        assert(typeof(value) === "number", "expecting data type number");

        assert(value >= 0 && value <= 0xffffffff, "32 bit uint out of bounds");

        data2 = Buffer.alloc(4);

        data2.writeUInt32BE(value, 0);
    }
    else if (schema.type === FieldType.UINT48LE) {
        assert(typeof(value) === "number", "expecting data type number");

        assert(value >= 0 && value <= 0xffffffffffff, "48 bit uint out of bounds");

        data2 = Buffer.alloc(6);

        const binary = value.toString(2).padStart(48, "0");

        const msb16 = parseInt(binary.slice(0, 16), 2);

        const lsb32 = parseInt(binary.slice(16), 2);

        data2.writeUInt32LE(lsb32, 0);

        data2.writeUInt16LE(msb16, 4);
    }
    else if (schema.type === FieldType.UINT48BE) {
        assert(typeof(value) === "number", "expecting data type number");

        assert(value >= 0 && value <= 0xffffffffffff, "48 bit uint out of bounds");

        data2 = Buffer.alloc(6);

        const binary = value.toString(2).padStart(48, "0");

        const msb16 = parseInt(binary.slice(0, 16), 2);

        const lsb32 = parseInt(binary.slice(16), 2);

        data2.writeUInt32BE(lsb32, 0);

        data2.writeUInt16BE(msb16, 4);
    }
    else if (schema.type === FieldType.UINT64LE) {
        assert(typeof(value) === "bigint", "expecting data type bigint");

        assert(value >= BigInt(0) && value <= 0xffffffffffffffffn, "64 bit uint out of bounds");

        data2 = Buffer.alloc(8);

        const binary = value.toString(2).padStart(64, "0");

        const msb32 = parseInt(binary.slice(0, 32), 2);

        const lsb32 = parseInt(binary.slice(32), 2);

        data2.writeUInt32LE(lsb32, 0);

        data2.writeUInt32LE(msb32, 4);
    }
    else if (schema.type === FieldType.UINT64BE) {
        assert(typeof(value) === "bigint", "expecting data type bigint");

        assert(value >= BigInt(0) && value <= 0xffffffffffffffffn, "64 bit uint out of bounds");

        data2 = Buffer.alloc(8);

        const binary = value.toString(2).padStart(64, "0");

        const msb32 = parseInt(binary.slice(0, 32), 2);

        const lsb32 = parseInt(binary.slice(32), 2);

        data2.writeUInt32BE(msb32, 0);

        data2.writeUInt32BE(lsb32, 4);
    }
    else if (schema.type === FieldType.STRING) {
        assert(typeof(value) === "string", "string expected");

        data2 = Buffer.from(value, "utf8");

        if (schema.maxSize !== undefined) {
            assert(data2.length <= schema.maxSize, `string too long, max ${schema.maxSize} bytes as utf8 encoded`);
        }

        assert(data2.length <= 65535,
            "string too long, max 65535 bytes as utf8 encoded");

        length = Buffer.alloc(2);

        length.writeUInt16BE(data2.length, 0);
    }
    else if (schema.type === FieldType.BYTES) {
        if (!Buffer.isBuffer(value)) {
            throw new Error("Buffer expected");
        }

        data2 = value;

        if (schema.maxSize !== undefined) {
            assert(data2.length <= schema.maxSize, `buffer too long, max ${schema.maxSize} bytes`);
        }

        assert(data2.length <= 65535, "buffer too long, max 65535 bytes");

        length = Buffer.alloc(2);

        length.writeUInt16BE(data2.length, 0);
    }
    else if (schema.type === FieldType.BYTE1) {
        assert(Buffer.isBuffer(value), "Buffer expected");

        data2 = Buffer.from(value);

        assert(data2.length === 1, "buffer expected to be 1 bytes");
    }
    else if (schema.type === FieldType.BYTE2) {
        assert(Buffer.isBuffer(value), "Buffer expected");

        data2 = Buffer.from(value);

        assert(data2.length === 2, "buffer expected to be 2 bytes");
    }
    else if (schema.type === FieldType.BYTE3) {
        assert(Buffer.isBuffer(value), "Buffer expected");

        data2 = Buffer.from(value);

        assert(data2.length === 3, "buffer expected to be 3 bytes");
    }
    else if (schema.type === FieldType.BYTE4) {
        assert(Buffer.isBuffer(value), "Buffer expected");

        data2 = Buffer.from(value);

        assert(data2.length === 4, "buffer expected to be 4 bytes");
    }
    else if (schema.type === FieldType.BYTE5) {
        assert(Buffer.isBuffer(value), "Buffer expected");

        data2 = Buffer.from(value);

        assert(data2.length === 5, "buffer expected to be 5 bytes");
    }
    else if (schema.type === FieldType.BYTE6) {
        assert(Buffer.isBuffer(value), "Buffer expected");

        data2 = Buffer.from(value);

        assert(data2.length === 6, "buffer expected to be 6 bytes");
    }
    else if (schema.type === FieldType.BYTE7) {
        assert(Buffer.isBuffer(value), "Buffer expected");

        data2 = Buffer.from(value);

        assert(data2.length === 7, "buffer expected to be 7 bytes");
    }
    else if (schema.type === FieldType.BYTE8) {
        assert(Buffer.isBuffer(value), "Buffer expected");

        data2 = Buffer.from(value);

        assert(data2.length === 8, "buffer expected to be 8 bytes");
    }
    else if (schema.type === FieldType.BYTE16) {
        assert(Buffer.isBuffer(value), "Buffer expected");

        data2 = Buffer.from(value);

        assert(data2.length === 16, "buffer expected to be 16 bytes");
    }
    else if (schema.type === FieldType.BYTE32) {
        assert(Buffer.isBuffer(value), "Buffer expected");

        data2 = Buffer.from(value);

        assert(data2.length === 32, "buffer expected to be 32 bytes");
    }
    else if (schema.type === FieldType.BYTE64) {
        assert(Buffer.isBuffer(value), "Buffer expected");

        data2 = Buffer.from(value);

        assert(data2.length === 64, "buffer expected to be 64 bytes");
    }
    else if (schema.type === FieldType.SCHEMA) {
        if (Buffer.isBuffer(value)) {
            data2 = value;
            // Note that we do not check the maxSize constraint in this case,
            // since we cannot always know what schema it us using.
            // It will however be checked on deep unpack.
        }
        else {
            const subFields: Fields = schema.schema ?? fields;

            const maxSize = schema.maxSize;

            let maxIndex: number | undefined = undefined;

            // If subFields is of array type we see if we can
            // apply maxIndex.
            //
            if (subFields["[]"] && maxSize !== undefined) {
                maxIndex = maxSize - 1;
            }

            data2 = PackSchema(subFields, value, maxIndex);

            // Only check maxSize in bytes for non-array schemas.
            //
            if (!subFields["[]"] && maxSize !== undefined) {
                assert(data2.length <= maxSize,
                    `buffer too long, max ${maxSize} bytes`);
            }
        }

        assert(data2, "could not pack with given schema(s)");

        assert(data2.length <= 65535, "buffer too long, max 65535 bytes");

        length = Buffer.alloc(2);

        length.writeUInt16BE(data2.length, 0);
    }
    else {
        throw new Error("Unsupported data type");
    }

    const indexBuf = Buffer.alloc(1);
    indexBuf.writeUint8(schema.index, 0);

    const typeBuf = Buffer.alloc(1);
    typeBuf.writeUint8(schema.type, 0);

    assert(data2, "Could not unpack value");

    return Buffer.concat([indexBuf, typeBuf, length, data2]);
}

/**
 * Hash range of fields of packed.
 *
 * Only fields with values are hashed (compare to HashSpecificFields).
 *
 * Each field is hashed, then that digest is hashed together with the next field, etc.
 * First field is hashed with 32 bytes of 0.
 * If no fields hashed then return 32 bytes of 0.
 *
 * @param fromIndex optionally set start field index (default 0)
 * @param toIndex optionally set end field index (default 255)
 * @return hash
 * @throws on iterator failure
 */
export function HashFields(packed: Buffer, fromIndex: number = 0, toIndex: number = 127): Buffer {
    const iterator = FieldIterator(packed);

    let hash = Buffer.alloc(32).fill(0);

    while (iterator.hasNext()) {
        const field = iterator.next();

        if (field.index < fromIndex) {
            continue;
        }

        if (field.index > toIndex) {
            break;
        }

        const hfn = blake2b(32);

        hfn.update(hash).
            update(field.packedField);

        hash = Buffer.from(hfn.digest());
    }

    return Buffer.from(hash);
}

/**
 * Hash fields of packed given by argument.
 *
 * Non-existing but referenced fields have an impact on the hash output.
 *
 * Initial digest is set to 32 bytes of 0.
 * For each field iteration the current digest is hashed and the field value is hashed and digested.
 * If the field has no value then only the digest is hashed and then digested again.
 * If no fields given then return 32 bytes of 0.
 *
 * @param packed
 * @param fields array of index values to hash. The order is irrelevant as
 * fields always are hashed in increasing order.
 * @return hash
 * @throws on iterator failure
 */
export function HashSpecificFields(packed: Buffer, fields: number[]): Buffer {
    const iterator = FieldIterator(packed);

    let digest = Buffer.alloc(32).fill(0);

    fields.forEach( index => {
        const fieldValue = iterator.get(index)?.value;

        const hfn = blake2b(32);

        hfn.update(digest);

        if (fieldValue !== undefined) {
            hfn.update(fieldValue);
        }

        digest = Buffer.from(hfn.digest());
    });

    return Buffer.from(digest);
}
