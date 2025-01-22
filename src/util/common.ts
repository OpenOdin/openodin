import blake2b from "blake2b"

/**
 * Compares A and B on creationTime and if equal then compare also on ID.
 *
 * @return true if A is greater than B.
 */
export function IsGreater(creationTimeA: number, creationTimeB: number, idA: Buffer, idB: Buffer): boolean {
    let diff = creationTimeA - creationTimeB;

    if (diff === 0) {
        diff = idA.compare(idB);
    }

    return diff > 0;
}

/**
 * Run a deep equals on two objects.
 * Type supported are string, number, boolean, bigint, array, undefined, null, Buffer and native objects.
 * If two objects are identical their types are not checked, but for unknown types an exception is thrown.
 * @returns true if deep equal.
 * @throws on unknown types unless objects are strictly equal then no type checking is perfomed.
 */
export function DeepEquals(o1: any, o2: any): boolean {
    if (o1 === o2) {
        // This covers all scalar types and all objects which are strictly equal on reference.
        return true;
    }
    const type1 = GetType(o1);
    if (type1 === undefined) {
        throw new Error(`Type of object 1 in deep equal is not recognized: ${o1}`);
    }
    const type2 = GetType(o2);
    if (type1 === undefined) {
        throw new Error(`Type of object 2 in deep equal is not recognized: ${o2}`);
    }
    if (type1 !== type2) {
        return false;
    }

    // Check complex types.
    if (type1 === "array") {
        if (o1.length !== o2.length) {
            return false;
        }
        for (let i=0; i<o1.length; i++) {
            if (!DeepEquals(o1[i], o2[i])) {
                return false;
            }
        }
        return true;
    }
    else if (type1 === "buffer") {
        return o1.equals(o2);
    }
    else if (type1 === "object") {
        const keys1 = Object.keys(o1);
        keys1.sort();
        const keys2 = Object.keys(o2);
        keys2.sort();
        if (!DeepEquals(keys1, keys2)) {
            return false;
        }
        for (let i=0; i<keys1.length; i++) {
            if (!DeepEquals(o1[keys1[i]], o2[keys2[i]])) {
                return false;
            }
        }
        return true;
    }

    return false;
}

/**
 * Return deep copy of an object.
 *
 * Function cannot be copied.
 * Class instances have their properties copied and they are returned as objects.
 *
 * @param o object to copy.
 * @param keepBuffer if set then do not copy buffers byte-per-byte but use the same object
 * Uin8Arrays are returned wrapped in Buffer.
 * @returns copied object.
 * @throws on unknown or uncopyable data types such as functios.
 */
export function DeepCopy(o: any, keepBuffer: boolean = false): any {
    const type = GetType(o);

    // Scalar types are directly returned.
    if (type && ["undefined", "null", "string", "number", "boolean", "bigint"].includes(type)) {
        return o;
    }
    else if (type === "array") {
        return o.map( (value: any) => DeepCopy(value, keepBuffer) );
    }
    else if (type === "object" || type === "classInstance") {
        const o2: any = {};
        const keys = Object.keys(o);
        keys.forEach( (key: string) => o2[key] = DeepCopy(o[key], keepBuffer) );
        return o2;
    }
    else if (type === "buffer" || type === "arraybuffer") {
        if (keepBuffer) {
            // This reuses the underlying data, and in the case of arraybuffer
            // wraps it in a Buffer object.
            return Buffer.from(o);
        }

        const l = o.length;

        const o2 = Buffer.alloc(l);

        for (let i=0; i<l; i++) {
            o2[i] = o[i];
        }

        return o2;
    }

    throw new Error(`Type not recognized for ${o}`);
}

/**
 * Shallow copy first level object, array or pick properties from class instance.
 */
export function ShallowCopy(o: any): any {
    const type = GetType(o);

    if (type === "array") {
        return o.map( (value: any) => value );
    }
    else if (type === "object" || type === "classInstance") {
        const o2: any = {};

        const keys = Object.keys(o);

        keys.forEach( (key: string) => o2[key] = o[key] );

        return o2;
    }

    return o;
}

/**
 * Determine typical types of object.
 * @param o a scalar or object to determine type for.
 * @returns type as string or undefined if type could not be recognized.
 */
export function GetType(o: any): "undefined" | "null" | "string" | "number" | "boolean" | "bigint" |
    "array" | "object" | "buffer" | "arraybuffer" | "classInstance" | "function" | undefined
{
    if (o === undefined) {
        return "undefined";
    }
    else if (o === null) {
        return "null";
    }

    const type = typeof o as string;

    if (type === "string") {
        return type;
    }
    else if (type === "number") {
        return type;
    }
    else if (type === "boolean") {
        return type;
    }
    else if (type === "bigint") {
        return type;
    }
    else if (type === "function") {
        return type;
    }
    else if (Array.isArray(o)) {
        return "array";
    }
    else if (Buffer.isBuffer(o)) {
        return "buffer";
    }
    else if (type === "object" && o.constructor === Object) {
        return type;
    }
    else if (o instanceof Uint8Array) {
        return "arraybuffer";
    }
    else if (type === "object") {
        return "classInstance";
    }

    return undefined;
}

export async function sleep(ms: number): Promise<void> {
    return new Promise( resolve => {
        setTimeout(resolve, ms);
    });
}

export function CopyBuffer(b: Buffer | Uint8Array): Buffer {
    const l = b.length;

    const b2 = Buffer.alloc(l);

    for (let i=0; i<l; i++) {
        b2[i] = b[i];
    }

    return b2;
}

export function DeepHash(o: any): Buffer {
    const type = GetType(o);

    let b: Buffer | undefined;
    if (type === "array") {
        const h = blake2b(32);
        o.forEach( (o2: any, index: number) => {
            const indexBuf = Buffer.alloc(4);
            indexBuf.writeUInt32BE(index);
            h.update(indexBuf);
            h.update(DeepHash(o2));
            h.update(indexBuf);
        });

        // Prepend 0x06 to not mix this up
        return Buffer.concat([Buffer.from([6]), Buffer.from(h.digest())]);
    }
    else if (type === "object" || type === "classInstance") {
        const keys = Object.keys(o);
        keys.sort();
        const values = keys.map( (key, index) => [keys.length, index, key, o[key], index] );

        // Prepend 0x05 to not mix this up
        return Buffer.concat([Buffer.from([5]), DeepHash(values)]);
    }
    else if (o === undefined || o === null) {
        b = Buffer.alloc(0);
    }
    else if (type === "string") {
        // Prepend 0x00 to not mix this up
        b = Buffer.concat([Buffer.from([0]), Buffer.from(o, "utf8")]);
    }
    else if (type === "number") {
        if (isNaN(o)) {
            throw new Error("NaN is not supported");
        }
        // Prepend 0x01 to not mix this up
        b = Buffer.concat([Buffer.from([1]), Buffer.from(o.toString(), "ascii")]);
        b = Buffer.alloc(4);
        b.writeInt32BE(o);
    }
    else if (type === "boolean") {
        // Prepend 0x02 to not mix this up
        b = Buffer.concat([Buffer.from([2]), Buffer.from(o.toString())]);
    }
    else if (type === "bigint") {
        // Prepend 0x03 to not mix this up
        b = Buffer.concat([Buffer.from([3]), Buffer.from(o.toString(), "ascii")]);
    }
    else if (Buffer.isBuffer(o)) {
        // Prepend 0x04 to not mix this up
        b = Buffer.concat([Buffer.from([4]), o]);
    }
    else {
        throw new Error(`Cannot hash type of ${o}`);
    }

    const h = blake2b(32);
    h.update(b);
    return Buffer.from(h.digest());
}

type fn<ReturnType> = (res: ReturnType | undefined) => void;

export function PromiseCallback<ReturnType>(): {promise: Promise<ReturnType>, cb: (err?: Error | null, result?: ReturnType) => void} {
    let _resolve: fn<ReturnType> | undefined;
    let _reject: (err: Error) => void | undefined;

    const promise = new Promise<ReturnType>( (resolve: any, reject: any) => {
        _resolve = resolve;
        _reject = reject;
    });

    const cb = (err?: Error | null, result?: ReturnType) => {
        if (err) {
            if (_reject) {
                _reject(err);
            }
            return;
        }

        if (_resolve) {
            _resolve(result);
        }
    };

    return {
        promise,
        cb,
    };
}
