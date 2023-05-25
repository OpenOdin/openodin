import {
    Field,
    Fields,
    FieldType,
    ModelType,
    Filter,
    BUFFERTYPES,
    INTEGERTYPES,
    INTEGERTYPES_BITWISE,
    BIGINTTYPES,
    STRINGTYPES,
    CMP,
} from "./types";

import {
    Hash,
} from "../hash";

interface Iterator {
    hasNext(): boolean;
    next(): [Field | undefined, any];
}

const HEADER_LENGTH = 6;

/**
 * The Model is the data holder for data structures.
 * It is responsible for unpacking/packing data.
 */
export class Model {
    protected modelType: ModelType;
    protected fields: Fields;
    protected data: {[key: string]: number | string | Buffer | bigint | undefined};

    /**
     * @param modelType sets the model type.
     * @param fields specifies model fields property.
     */
    constructor(modelType: ModelType, fields: Fields) {
        if (modelType.length !== HEADER_LENGTH) {
            throw new Error("Bad modelType provided.");
        }
        this.modelType = modelType;
        this.fields = fields;
        this.data = {};
    }

    /**
     * @returns the model type.
     */
    public getType(): ModelType {
        return this.modelType;
    }

    /**
     * @param image image buffer to load data from.
     * @param preserveTransient if set then allow for transient values to be loaded if present in the image.
     * @param ignoreUnknownField if set then allow for unknown fields in the image, they will be ignored.
     *
     * @throws an error message when unable to decode the header from the image input.
     * @throws an error message when the decoded header contains unexpected model type data.
     * @throws an error message when unable to create iterator pointing to the provided input image data.
     */
    public load(image: Buffer, preserveTransient: boolean = false, ignoreUnknownField: boolean = false) {
        const header = this.decodeHeader(image);
        if (!header) {
            throw new Error("Image has bad header");
        }
        if (!header.equals(this.modelType)) {
            throw new Error("Image mismatch in expected header model type");
        }

        const iterator = this.getIterator(image, HEADER_LENGTH);

        if (!iterator) {
            throw new Error("Error creating iterator over image");
        }

        while (iterator.hasNext()) {
            const tuple = iterator.next();
            const [field, value]: [Field | undefined, any] = tuple;
            if (!field) {
                if (ignoreUnknownField) {
                    continue;
                }
                throw new Error("Unknown field encountered in image");
            }
            if (field.transient && !preserveTransient) {
                continue;
            }
            this.setAny(field.name, value);
        }
    }

    /**
     * @param filter target filter specification.
     *
     * @returns whether or not the input data matches any of the existing fields.
     *
     * @throws an error message when unable the filter target name is not present in the current model fields.
     */
    public cmp(filter: Filter): boolean {
        const field = this.fields[filter.field];
        if (!field) {
            throw new Error(`Unknown field: ${filter.field}`);
        }
        let value1 = filter.field === "id" ? this.getAny("id2") ?? this.getAny("id1") : this.getAny(filter.field);
        let value2 = filter.value;

        let doHash = false;
        let sliceIndex: number | undefined;
        let sliceLength: number | undefined;
        let bitop: string | undefined;
        let bitopvalue: bigint | undefined;
        if (filter.operator) {
            if (filter.operator.match(/^[ ]*hash[ ]*$/)) {
                doHash=true;
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

        if (value1 === undefined && (doHash || sliceIndex !== undefined || bitop)) {
            // Operations cannot be performed on undefined values,
            // only NE yeilds true.
            if (filter.cmp === CMP.NE) {
                return true;
            }
            return false;
        }

        // If both of left or right side are undefined then
        // only the EQ operator can be true.
        // Unlike in SQL we define that null == null.
        if (value1 === undefined && value2 === undefined) {
            if (filter.cmp === CMP.EQ) {
                return true;
            }
            return false;
        }
        else if (value1 === undefined || value2 === undefined) {
            // If any of the sides are undefined but not both only NE can yield true.
            if (filter.cmp === CMP.NE) {
                return true;
            }
            return false;
        }

        let diff = 0;

        if (BIGINTTYPES.includes(field.type)) {
            if (typeof(value1) !== "bigint") {
                return false;
            }
            if (typeof(value2) !== "bigint") {
                return false;
            }
            if (sliceIndex !== undefined) {
                throw new Error(`Slice operator not applicable to field: ${filter.field}`);
            }
            if (bitop) {
                throw new Error(`Bitwise operator not applicable to field: ${filter.field}`);
            }
            if (doHash) {
                throw new Error(`Hash operator not applicable to field: ${filter.field}`);
            }
            diff = 0;
            if (value1 > value2) {
                diff = 1;
            }
            else if (value1 < value2) {
                diff = -1;
            }
        }
        else if (INTEGERTYPES.includes(field.type)) {
            if (typeof(value1) !== "number") {
                return false;
            }
            if (typeof(value2) !== "number") {
                return false;
            }
            if (sliceIndex !== undefined) {
                throw new Error(`Slice operator not applicable to field: ${filter.field}`);
            }
            if (doHash) {
                throw new Error(`Hash operator not applicable to field: ${filter.field}`);
            }
            if (bitop && bitopvalue !== undefined) {
                if (!INTEGERTYPES_BITWISE.includes(field.type)) {
                    throw new Error(`Bitwise operator not applicable to field: ${filter.field}`);
                }
                let value1b = BigInt(value1);
                let bitmask = 0xffffffffn;  // 32 bit.
                if (field.type === FieldType.UINT8) {
                    bitmask = 0xffn;
                }
                else if (field.type === FieldType.UINT16LE || field.type === FieldType.UINT16BE) {
                    bitmask = 0xffffn;
                }
                else if (field.type === FieldType.UINT24LE || field.type === FieldType.UINT24BE) {
                    bitmask = 0xffffffn;
                }
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
        else if (BUFFERTYPES.includes(field.type)) {
            if (!Buffer.isBuffer(value1)) {
                return false;
            }
            if (typeof(value2) === "string") {
                value2 = Buffer.from(value2, "hex");
            }
            if (!Buffer.isBuffer(value2)) {
                return false;
            }
            if (bitop) {
                throw new Error(`Bitwise operator not applicable to field: ${filter.field}`);
            }
            if (sliceIndex !== undefined) {
                if (sliceIndex < 0) {
                    sliceIndex = value1.length + sliceIndex;
                }
                if (sliceLength === undefined) {
                    sliceLength = value1.length - sliceIndex;
                }
                const sliceEnd = sliceIndex + sliceLength;
                value1 = value1.slice(sliceIndex, sliceEnd);
            }
            if (doHash) {
                value1 = Hash(value1);
            }
            diff = value1.compare(value2);
        }
        else if (STRINGTYPES.includes(field.type)) {
            if (typeof(value1) !== "string") {
                return false;
            }
            if (typeof(value2) !== "string") {
                return false;
            }
            if (bitop) {
                throw new Error(`Bitwise operator not applicable to field: ${filter.field}`);
            }
            if (sliceIndex !== undefined) {
                if (sliceIndex < 0) {
                    sliceIndex = value1.length + sliceIndex;
                }
                if (sliceLength === undefined) {
                    sliceLength = value1.length - sliceIndex;
                }
                const sliceEnd = sliceIndex + sliceLength;
                value1 = value1.slice(sliceIndex, sliceEnd);
            }
            if (doHash) {
                value1 = Hash(value1);
            }
            diff = value1 < value2 ? -1 : value1 > value2 ? 1 : 0;
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

    /**
     * @param image header data buffer to be decoded
     *
     * @returns a sliced data buffer on success.
     */
    private decodeHeader(image: Buffer): ModelType | undefined {
        if (image.length < HEADER_LENGTH) {
            return undefined;
        }
        return image.slice(0, HEADER_LENGTH);
    }

    /**
     * @param image data buffer.
     * @param pointer data field position.
     *
     * @returns an Iterator object.
     */
    private getIterator(image: Buffer, pointer: number): Iterator {
        return {
            hasNext: () => {
                return image.length > pointer;
            },
            next: (): [Field | undefined, any] => {
                const [field, value, pointer2] = this.unpackField(image, pointer);
                pointer = pointer2;
                return [field, value];
            }
        };
    }

    /**
     * @returns encoded data buffer.
     */
    private encodeHeader(): Buffer {
        const header = Buffer.from(this.modelType);
        return header;
    }

    /**
     * @param fieldName field name to set data to.
     * @param value data to be set.
     *
     * @throws a message error when unable to find an existing field with the provided name.
     */
    private setAny(fieldName: string, value: any) {
        const field = this.fields[fieldName];
        if (!field) {
            throw new Error(`Unknown field: ${fieldName}`);
        }
        if (Buffer.isBuffer(value)) {
            return this.setBuffer(fieldName, value);
        }
        else if (typeof(value) === "string") {
            return this.setString(fieldName, value);
        }
        else if (typeof(value) === "number") {
            return this.setNumber(fieldName, value);
        }
        else if (typeof(value) === "bigint") {
            return this.setBigInt(fieldName, value);
        }
        else {
            throw new Error("Unsupported value type");
        }
    }

    /**
     * @param fieldName field name to retrieve data from.
     *
     * @returns the field value when present.
     *
     * @throws a message error when unable to find the provided field by name.
     */
    public getAny(fieldName: string): number | string | Buffer | bigint | undefined {
        if (!this.fields[fieldName]) {
            throw new Error(`Unknown field ${fieldName}`);
        }
        return this.data[fieldName];
    }

    /**
     * @param fieldName field name to set data to.
     * @param value data to be set.
     *
     * @throws a message error when unable to find an entry with the provided name.
     */
    public setNumber(fieldName: string, value: number | undefined) {
        const field = this.fields[fieldName];
        if (!field) {
            throw new Error("Unknown field");
        }
        if (!INTEGERTYPES.includes(field.type)) {
            throw new Error(`Field ${fieldName} is not of integer type`);
        }
        if (value === undefined) {
            delete this.data[fieldName];
            return;
        }
        this.data[fieldName] = value;
    }

    /**
     * @param fieldName field name to set data to.
     * @param value data to be set.
     *
     * @throws a message error when unable to find an entry with the provided name.
     */
    public setBigInt(fieldName: string, value: bigint | undefined) {
        const field = this.fields[fieldName];
        if (!field) {
            throw new Error("Unknown field");
        }
        if (!BIGINTTYPES.includes(field.type)) {
            throw new Error(`Field ${fieldName} is not of bigint type`);
        }
        if (value === undefined) {
            delete this.data[fieldName];
            return;
        }
        this.data[fieldName] = value;
    }

    /**
     * @param fieldName field name to set data to.
     * @param value data to be set.
     *
     * @throws a message error when unable to find any entry with the provided name.
     */
    public setString(fieldName: string, value: string | undefined) {
        const field = this.fields[fieldName];
        if (!field) {
            throw new Error("Unknown field");
        }
        if (!STRINGTYPES.includes(field.type)) {
            throw new Error(`Field ${fieldName} is not of string type`);
        }
        if (value === undefined) {
            delete this.data[fieldName];
            return;
        }
        this.data[fieldName] = value;
    }

    /**
     * Set a field to a buffer value.
     * Note that the buffer is not copied, so refrain from altering the buffer.
     * @param fieldName field name to set data to.
     * @param value data to be set.
     *
     * @throws a message error when unable to find any entry with the provided name.
     */
    public setBuffer(fieldName: string, value: Buffer | undefined) {
        const field = this.fields[fieldName];
        if (!field) {
            throw new Error("Unknown field");
        }
        if (!BUFFERTYPES.includes(field.type)) {
            throw new Error(`Field ${fieldName} is not of buffer type`);
        }
        if (value === undefined) {
            delete this.data[fieldName];
            return;
        }
        let minSize;
        let maxSize;
        if (field.type === FieldType.BYTE1) {
            minSize = 1;
            maxSize = 1;
        }
        else if (field.type === FieldType.BYTE2) {
            minSize = 2;
            maxSize = 2;
        }
        else if (field.type === FieldType.BYTE3) {
            minSize = 3;
            maxSize = 3;
        }
        else if (field.type === FieldType.BYTE4) {
            minSize = 4;
            maxSize = 4;
        }
        else if (field.type === FieldType.BYTE5) {
            minSize = 5;
            maxSize = 5;
        }
        else if (field.type === FieldType.BYTE6) {
            minSize = 6;
            maxSize = 6;
        }
        else if (field.type === FieldType.BYTE7) {
            minSize = 7;
            maxSize = 7;
        }
        else if (field.type === FieldType.BYTE8) {
            minSize = 8;
            maxSize = 8;
        }
        else if (field.type === FieldType.BYTE16) {
            minSize = 16;
            maxSize = 16;
        }
        else if (field.type === FieldType.BYTE32) {
            minSize = 32;
            maxSize = 32;
        }
        else if (field.type === FieldType.BYTE64) {
            minSize = 64;
            maxSize = 64;
        }
        else {
            minSize = 0;
            maxSize = field.maxSize;
        }
        if (maxSize === undefined) {
            throw new Error("maxSize must be set for bytes data type");
        }

        if (value.length < minSize) {
            throw new Error(`Field ${fieldName} is too short (${value.length} < ${minSize})`);
        }
        if (value.length > maxSize) {
            throw new Error(`Field ${fieldName} is too long (${value.length} > ${maxSize})`);
        }
        this.data[fieldName] = value;
    }

    /**
     * @param fieldName field name to retrieve data from.
     *
     * @returns the stored value.
     *
     * @throws a message error when the field value is set but it is not a Buffer.
     */
    public getBuffer(fieldName: string): Buffer | undefined {
        const value = this.getAny(fieldName);
        if (value === undefined) {
            return undefined;
        }
        else if (Buffer.isBuffer(value)) {
            return value;
        }
        else {
            throw new Error("Invalid data type");
        }
    }

    /**
     * @param fieldName field name to retrieve data from.
     *
     * @returns the stored value.
     *
     * @throws a message error when the field value is set but it is not a string.
     */
    public getString(fieldName: string): string | undefined {
        const value = this.getAny(fieldName);
        if (value === undefined) {
            return undefined;
        }
        else if (typeof(value) === "string") {
            return value;
        }
        else {
            throw new Error("Invalid data type");
        }
    }

    /**
     * @param fieldName field name to retrieve data from.
     *
     * @returns the stored value.
     *
     * @throws a message error when the field value is set but it is not a number.
     */
    public getNumber(fieldName: string): number | undefined {
        const value = this.getAny(fieldName);
        if (value === undefined) {
            return undefined;
        }
        else if (typeof(value) === "number") {
            return value;
        }
        else {
            throw new Error("Invalid data type");
        }
    }

    /**
     * @param fieldName field name to retrieve data from.
     *
     * @returns the stored value.
     *
     * @throws a message error when the field value is set but it is not a number.
     */
    public getBigInt(fieldName: string): bigint | undefined {
        const value = this.getAny(fieldName);
        if (value === undefined) {
            return undefined;
        }
        else if (typeof(value) === "bigint") {
            return value;
        }
        else {
            throw new Error("Invalid data type");
        }
    }

    /**
     * Fields with undefined values are not exported.
     * Transient fields are only export if requested.
     *
     * @param exportTransient if true then also export fields marked as transient (not including non hashable fields).
     * @param exportTransientNonHashable if true then also export transient non hashable fields (requires exportTransient is true).
     * @returns the exported data composed of header and all non-empty fields in packed format.
     *
     * @throws an error message when unable to pack any of the existing fields.
     */
    public export(exportTransient: boolean = false, exportTransientNonHashable: boolean = false): Buffer {
        const header = this.encodeHeader();
        const packedFields = [];
        const fields = this.getSortedFields();

        for (let index=0; index<fields.length; index++) {
            const field = fields[index];
            if (field.transient && !exportTransient) {
                continue;
            }

            if (field.transient && !(field.hash ?? true) && !exportTransientNonHashable) {
                continue;
            }

            if (this.data[field.name] === undefined) {
                continue;
            }

            try {
                const packedField = this.packField(field, this.data[field.name]);
                packedFields.push(packedField);
            }
            catch(e) {
                throw new Error(`Cannot pack field ${field.name}: ${e}`);
            }
        }

        return Buffer.concat([header, ...packedFields]);
    }

    /**
     * @returns array of fields sorted by index.
     */
    private getSortedFields(): Field[] {
        const fields: Field[] = [];
        for (const fieldName in this.fields) {
            fields.push(this.fields[fieldName]);
        }
        fields.sort( (a: Field, b: Field) => a.index - b.index );
        return fields;
    }

    /**
     * @returns an array containing the field, the value and the updated position (pointer).
     *
     * @throws an error message when there is no field matching the pointed index (pointer).
     * @throws an error message when the field string data is bigger than the expected maxSize.
     * @throws an error message when the field bytes data is bigger than the expected maxSize.
     * @throws an error message when the field data is of unknown type.
     */
    private unpackField(image: Buffer, pointer: number): [Field | undefined, any, number] {
        const fieldType = image.readUInt8(pointer);
        pointer++;
        const fieldIndex = image.readUInt8(pointer);
        pointer++;
        let value: any;
        let field: Field | undefined;

        for (const key in this.fields) {
            if (this.fields[key].index === fieldIndex) {
                field = this.fields[key];
                break;
            }
        }

        if (!field) {
            throw new Error("Unknown field index");
        }

        if (fieldType === FieldType.INT8) {
            value = image.readInt8(pointer);
            pointer++;
        }
        else if (fieldType === FieldType.UINT8) {
            value = image.readUInt8(pointer);
            pointer++;
        }
        else if (fieldType === FieldType.INT16LE) {
            value = image.readInt16LE(pointer);
            pointer = pointer + 2;
        }
        else if (fieldType === FieldType.UINT16LE) {
            value = image.readUInt16LE(pointer);
            pointer = pointer + 2;
        }
        else if (fieldType === FieldType.INT16BE) {
            value = image.readInt16BE(pointer);
            pointer = pointer + 2;
        }
        else if (fieldType === FieldType.UINT16BE) {
            value = image.readUInt16BE(pointer);
            pointer = pointer + 2;
        }
        else if (fieldType === FieldType.UINT24LE) {
            const data = Buffer.concat([image.slice(pointer, pointer + 3), Buffer.alloc(1).fill(0)]);
            value = data.readUInt32LE(0);
            pointer = pointer + 3;
        }
        else if (fieldType === FieldType.UINT24BE) {
            const data = Buffer.concat([Buffer.alloc(1).fill(0), image.slice(pointer, pointer + 3)]);
            value = data.readUInt32BE(0);
            pointer = pointer + 3;
        }
        else if (fieldType === FieldType.INT32LE) {
            value = image.readInt32LE(pointer);
            pointer = pointer + 4;
        }
        else if (fieldType === FieldType.UINT32LE) {
            value = image.readUInt32LE(pointer);
            pointer = pointer + 4;
        }
        else if (fieldType === FieldType.INT32BE) {
            value = image.readInt32BE(pointer);
            pointer = pointer + 4;
        }
        else if (fieldType === FieldType.UINT32BE) {
            value = image.readUInt32BE(pointer);
            pointer = pointer + 4;
        }
        else if (fieldType === FieldType.UINT48LE) {
            const high32b = image.readUInt32LE(pointer);
            const low16b  = image.readUInt16LE(pointer + 4);
            const binary  = low16b.toString(2).padStart(16, "0") + high32b.toString(2).padStart(32, "0");
            value = parseInt(binary, 2);
            pointer = pointer + 6;
        }
        else if (fieldType === FieldType.UINT48BE) {
            const high32b = image.readUInt32BE(pointer);
            const low16b  = image.readUInt16BE(pointer + 4);
            const binary  = low16b.toString(2).padStart(16, "0") + high32b.toString(2).padStart(32, "0");
            value = parseInt(binary, 2);
            pointer = pointer + 6;
        }
        else if (fieldType === FieldType.UINT64LE) {
            const high32b = image.readUInt32LE(pointer);
            const low32b  = image.readUInt32LE(pointer + 4);
            const binary  = low32b.toString(2).padStart(32, "0") + high32b.toString(2).padStart(32, "0");
            value = BigInt("0b" + binary);
            pointer = pointer + 8;
        }
        else if (fieldType === FieldType.UINT64BE) {
            const high32b = image.readUInt32BE(pointer);
            const low32b  = image.readUInt32BE(pointer + 4);
            const binary  = high32b.toString(2).padStart(32, "0") + low32b.toString(2).padStart(32, "0");
            value = BigInt("0b" + binary);
            pointer = pointer + 8;
        }
        else if (fieldType === FieldType.STRING) {
            const length = image.readUInt16BE(pointer);
            // Check so length is within bounds both for image and for maxSize defined in Field
            if (field) {
                if (length > (field.maxSize ?? length) || length > image.length - pointer) {
                    throw new Error("String field too long");
                }
            }
            pointer = pointer + 2;
            value = image.slice(pointer, pointer + length).toString("utf8");
            pointer = pointer + length;
        }
        else if (fieldType === FieldType.BYTES) {
            const length = image.readUInt16BE(pointer);
            // Check so length is within bounds both for image and for maxSize defined in Field
            if (field) {
                if (length > (field.maxSize ?? length) || length > image.length - pointer) {
                    throw new Error("Bytes field too long");
                }
            }
            pointer = pointer + 2;
            value = image.slice(pointer, pointer + length);
            pointer = pointer + length;
        }
        else if (fieldType === FieldType.BYTE1) {
            value = image.slice(pointer, pointer + 1);
            pointer = pointer + 1;
        }
        else if (fieldType === FieldType.BYTE2) {
            value = image.slice(pointer, pointer + 2);
            pointer = pointer + 2;
        }
        else if (fieldType === FieldType.BYTE3) {
            value = image.slice(pointer, pointer + 3);
            pointer = pointer + 3;
        }
        else if (fieldType === FieldType.BYTE4) {
            value = image.slice(pointer, pointer + 4);
            pointer = pointer + 4;
        }
        else if (fieldType === FieldType.BYTE5) {
            value = image.slice(pointer, pointer + 5);
            pointer = pointer + 5;
        }
        else if (fieldType === FieldType.BYTE6) {
            value = image.slice(pointer, pointer + 6);
            pointer = pointer + 6;
        }
        else if (fieldType === FieldType.BYTE7) {
            value = image.slice(pointer, pointer + 7);
            pointer = pointer + 7;
        }
        else if (fieldType === FieldType.BYTE8) {
            value = image.slice(pointer, pointer + 8);
            pointer = pointer + 8;
        }
        else if (fieldType === FieldType.BYTE16) {
            value = image.slice(pointer, pointer + 16);
            pointer = pointer + 16;
        }
        else if (fieldType === FieldType.BYTE32) {
            value = image.slice(pointer, pointer + 32);
            pointer = pointer + 32;
        }
        else if (fieldType === FieldType.BYTE64) {
            value = image.slice(pointer, pointer + 64);
            pointer = pointer + 64;
        }
        else {
            throw new Error("Unsupported field type");
        }

        return [field, value, pointer];
    }

    /**
     * @param fieldName field name to retrieve data from.
     * @param data value to be set.
     *
     * @returns the packed field Buffer.
     *
     * @throws an error message when any given data type does not match the expected field type.
     * @throws an error message when any given data is not within the expected type range (out of bounds).
     * @throws an error message when the field data is of unknown type.
     */
    private packField(field: Field, data: any): Buffer {
        const fieldType    = Buffer.alloc(1)
        fieldType.writeUInt8(field.type, 0);
        const fieldIndex    = Buffer.alloc(1)
        fieldIndex.writeUInt8(field.index, 0);
        let length  = Buffer.alloc(0);
        let data2: Buffer;

        if (field.type === FieldType.INT8) {
            if (typeof(data) !== "number") {
                throw new Error("expecting data type number");
            }
            if (data < -128 || data > 127) {
                throw new Error("8 bit integer out of bounds");
            }
            data2 = Buffer.alloc(1);
            data2.writeInt8(data, 0);
        }
        else if (field.type === FieldType.UINT8) {
            if (typeof(data) !== "number") {
                throw new Error("expecting data type number");
            }
            if (data < 0 || data > 0xff) {
                throw new Error("8 bit uint out of bounds");
            }
            data2 = Buffer.alloc(1);
            data2.writeUInt8(data, 0);
        }
        else if (field.type === FieldType.INT16LE) {
            if (typeof(data) !== "number") {
                throw new Error("expecting data type number");
            }
            if (data < -32768 || data > 32767) {
                throw new Error("16 bit integer out of bounds");
            }
            data2 = Buffer.alloc(2);
            data2.writeInt16LE(data, 0);
        }
        else if (field.type === FieldType.UINT16LE) {
            if (typeof(data) !== "number") {
                throw new Error("expecting data type number");
            }
            if (data < 0 || data > 0xffff) {
                throw new Error("16 bit uint out of bounds");
            }
            data2 = Buffer.alloc(2);
            data2.writeUInt16LE(data, 0);
        }
        else if (field.type === FieldType.INT16BE) {
            if (typeof(data) !== "number") {
                throw new Error("expecting data type number");
            }
            if (data < -32768 || data > 32767) {
                throw new Error("16 bit integer out of bounds");
            }
            data2 = Buffer.alloc(2);
            data2.writeInt16BE(data, 0);
        }
        else if (field.type === FieldType.UINT16BE) {
            if (typeof(data) !== "number") {
                throw new Error("expecting data type number");
            }
            if (data < 0 || data > 0xffff) {
                throw new Error("16 bit uint out of bounds");
            }
            data2 = Buffer.alloc(2);
            data2.writeUInt16BE(data, 0);
        }
        else if (field.type === FieldType.UINT24LE) {
            if (typeof(data) !== "number") {
                throw new Error("expecting data type number");
            }
            if (data < 0 || data > 0xffffff) {
                throw new Error("Integer out of bounds");
            }
            data2 = Buffer.alloc(4);  // We will truncate away the MSB byte so we are down to three bytes.
            data2.writeUInt32LE(data, 0);
            data2 = data2.slice(0, 3);
        }
        else if (field.type === FieldType.UINT24BE) {
            if (typeof(data) !== "number") {
                throw new Error("expecting data type number");
            }
            if (data < 0 || data > 0xffffff) {
                throw new Error("Integer out of bounds");
            }
            data2 = Buffer.alloc(4);  // We will truncate away the MSB byte so we are down to three bytes.
            data2.writeUInt32BE(data, 0);
            data2 = data2.slice(1, 4);
        }
        else if (field.type === FieldType.INT32LE) {
            if (typeof(data) !== "number") {
                throw new Error("expecting data type number");
            }
            if (data < -2147483648 || data > 2147483647) {
                throw new Error("32 bit integer out of bounds");
            }
            data2 = Buffer.alloc(4);
            data2.writeInt32LE(data, 0);
        }
        else if (field.type === FieldType.UINT32LE) {
            if (typeof(data) !== "number") {
                throw new Error("expecting data type number");
            }
            if (data < 0 || data > 0xffffffff) {
                throw new Error("32 bit uint out of bounds");
            }
            data2 = Buffer.alloc(4);
            data2.writeUInt32LE(data, 0);
        }
        else if (field.type === FieldType.INT32BE) {
            if (typeof(data) !== "number") {
                throw new Error("expecting data type number");
            }
            if (data < -2147483648 || data > 2147483647) {
                throw new Error("32 bit integer out of bounds");
            }
            data2 = Buffer.alloc(4);
            data2.writeInt32BE(data, 0);
        }
        else if (field.type === FieldType.UINT32BE) {
            if (typeof(data) !== "number") {
                throw new Error("expecting data type number");
            }
            if (data < 0 || data > 0xffffffff) {
                throw new Error("32 bit uint out of bounds");
            }
            data2 = Buffer.alloc(4);
            data2.writeUInt32BE(data, 0);
        }
        else if (field.type === FieldType.UINT48LE) {
            if (typeof(data) !== "number") {
                throw new Error("expecting data type number");
            }
            if (data < 0 || data > 0xffffffffffff) {
                throw new Error("48 bit integer out of bounds");
            }
            data2 = Buffer.alloc(6);
            const binary = data.toString(2).padStart(48, "0");
            const msb16 = parseInt(binary.slice(0, 16), 2);
            const lsb32 = parseInt(binary.slice(16), 2);
            data2.writeUInt32LE(lsb32, 0);
            data2.writeUInt16LE(msb16, 4);
        }
        else if (field.type === FieldType.UINT48BE) {
            if (typeof(data) !== "number") {
                throw new Error("expecting data type number");
            }
            if (data < 0 || data > 0xffffffffffff) {
                throw new Error("48 bit integer out of bounds");
            }
            data2 = Buffer.alloc(6);
            const binary = data.toString(2).padStart(48, "0");
            const msb16 = parseInt(binary.slice(0, 16), 2);
            const lsb32 = parseInt(binary.slice(16), 2);
            data2.writeUInt32BE(lsb32, 0);
            data2.writeUInt16BE(msb16, 4);
        }
        else if (field.type === FieldType.UINT64LE) {
            if (typeof(data) !== "bigint") {
                throw new Error("expecting data type bigint");
            }
            if (data < BigInt(0) || data > 0xffffffffffffffffn) {
                throw new Error("64 bit integer out of bounds");
            }

            data2 = Buffer.alloc(8);
            const binary = data.toString(2).padStart(64, "0");
            const msb32 = parseInt(binary.slice(0, 32), 2);
            const lsb32 = parseInt(binary.slice(32), 2);
            data2.writeUInt32LE(lsb32, 0);
            data2.writeUInt32LE(msb32, 4);
        }
        else if (field.type === FieldType.UINT64BE) {
            if (typeof(data) !== "bigint") {
                throw new Error("expecting data type bigint");
            }
            if (data < BigInt(0) || data > 0xffffffffffffffffn) {
                throw new Error("64 bit integer out of bounds");
            }

            data2 = Buffer.alloc(8);
            const binary = data.toString(2).padStart(64, "0");
            const msb32 = parseInt(binary.slice(0, 32), 2);
            const lsb32 = parseInt(binary.slice(32), 2);
            data2.writeUInt32BE(msb32, 0);
            data2.writeUInt32BE(lsb32, 4);
        }
        else if (field.type === FieldType.STRING) {
            if (typeof(data) !== "string") {
                throw new Error("string expected");
            }
            data2 = Buffer.from(data, "utf8");
            if (data2.length > 65535) {
                throw new Error("string too long, max 65535 bytes as utf8 encoded");
            }
            length = Buffer.alloc(2);
            length.writeUInt16BE(data2.length);
        }
        else if (field.type === FieldType.BYTES) {
            if (!Buffer.isBuffer(data)) {
                throw new Error("Buffer expected");
            }
            data2 = Buffer.from(data);
            if (data2.length > 65535) {
                throw new Error("buffer too long, max 65535 bytes");
            }
            length = Buffer.alloc(2);
            length.writeUInt16BE(data2.length);
        }
        else if (field.type === FieldType.BYTE1) {
            if (!Buffer.isBuffer(data)) {
                throw new Error("Buffer expected");
            }
            data2 = Buffer.from(data);
            if (data2.length !== 1) {
                throw new Error("buffer expected to be 1 bytes");
            }
        }
        else if (field.type === FieldType.BYTE2) {
            if (!Buffer.isBuffer(data)) {
                throw new Error("Buffer expected");
            }
            data2 = Buffer.from(data);
            if (data2.length !== 2) {
                throw new Error("buffer expected to be 2 bytes");
            }
        }
        else if (field.type === FieldType.BYTE3) {
            if (!Buffer.isBuffer(data)) {
                throw new Error("Buffer expected");
            }
            data2 = Buffer.from(data);
            if (data2.length !== 3) {
                throw new Error("buffer expected to be 3 bytes");
            }
        }
        else if (field.type === FieldType.BYTE4) {
            if (!Buffer.isBuffer(data)) {
                throw new Error("Buffer expected");
            }
            data2 = Buffer.from(data);
            if (data2.length !== 4) {
                throw new Error("buffer expected to be 4 bytes");
            }
        }
        else if (field.type === FieldType.BYTE5) {
            if (!Buffer.isBuffer(data)) {
                throw new Error("Buffer expected");
            }
            data2 = Buffer.from(data);
            if (data2.length !== 5) {
                throw new Error("buffer expected to be 5 bytes");
            }
        }
        else if (field.type === FieldType.BYTE6) {
            if (!Buffer.isBuffer(data)) {
                throw new Error("Buffer expected");
            }
            data2 = Buffer.from(data);
            if (data2.length !== 6) {
                throw new Error("buffer expected to be 6 bytes");
            }
        }
        else if (field.type === FieldType.BYTE7) {
            if (!Buffer.isBuffer(data)) {
                throw new Error("Buffer expected");
            }
            data2 = Buffer.from(data);
            if (data2.length !== 7) {
                throw new Error("buffer expected to be 7 bytes");
            }
        }
        else if (field.type === FieldType.BYTE8) {
            if (!Buffer.isBuffer(data)) {
                throw new Error("Buffer expected");
            }
            data2 = Buffer.from(data);
            if (data2.length !== 8) {
                throw new Error("buffer expected to be 8 bytes");
            }
        }
        else if (field.type === FieldType.BYTE16) {
            if (!Buffer.isBuffer(data)) {
                throw new Error("Buffer expected");
            }
            data2 = Buffer.from(data);
            if (data2.length !== 16) {
                throw new Error("buffer expected to be 16 bytes");
            }
        }
        else if (field.type === FieldType.BYTE32) {
            if (!Buffer.isBuffer(data)) {
                throw new Error("Buffer expected");
            }
            data2 = Buffer.from(data);
            if (data2.length !== 32) {
                throw new Error("buffer expected to be 32 bytes");
            }
        }
        else if (field.type === FieldType.BYTE64) {
            if (!Buffer.isBuffer(data)) {
                throw new Error("Buffer expected");
            }
            data2 = Buffer.from(data);
            if (data2.length !== 64) {
                throw new Error("buffer expected to be 64 bytes");
            }
        }
        else {
            throw new Error("Unsupported data type");
        }

        return Buffer.concat([fieldType, fieldIndex, length, data2]);
    }

    /**
     * Hash (non-transient) fields to get the complete hash of the node.
     * This hash is equal to hashing the exported node binary data unless also transient fields are exported
     * then its a bit more complicated to reproduce the hash.
     *
     * @param excludeFields: string[] array of (non transient) field names to exclude from hashing.
     * @return hash
     */
    public hash(excludeFields?: string[]): Buffer {
        const buffers: Buffer[] = [];

        buffers.push(this.encodeHeader());

        const fields = this.getSortedFields();

        const fieldsLength = fields.length;

        for (let i=0; i<fieldsLength; i++) {
            const field = fields[i];

            if ((field.hash ?? true) && !field.transient) {
                if (excludeFields && excludeFields.some( fieldName => fieldName === field.name )) {
                    // exclude this field from hashing
                    continue;
                }

                const value = this.data[field.name];

                if (value !== undefined) {
                    const data = this.packField(field, value);
                    buffers.push(data);
                }
            }
        }

        const binary = Buffer.concat(buffers);

        return Hash(binary);
    }

    public hashTransient(): Buffer {
        const buffers: Buffer[] = [];

        const fields = this.getSortedFields();

        const fieldsLength = fields.length;

        for (let i=0; i<fieldsLength; i++) {
            const field = fields[i];

            if ((field.hash ?? true) && field.transient) {
                const value = this.data[field.name];

                if (value !== undefined) {
                    const data = this.packField(field, value);
                    buffers.push(data);
                }
            }
        }

        const binary = Buffer.concat(buffers);

        return Hash(binary);
    }
}
