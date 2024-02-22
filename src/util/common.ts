import blake2b from "blake2b"

import {
    PRIMARY_INTERFACE_CHAINCERT_ID,
} from "../datamodel/cert/primary/interface/PrimaryChainCertInterface";

import {
    PRIMARY_INTERFACE_DEFAULTCERT_ID,
} from "../datamodel/cert/primary/interface/PrimaryDefaultCertInterface";

import {
    PRIMARY_INTERFACE_NODECERT_ID,
} from "../datamodel/cert/primary/interface/PrimaryNodeCertInterface";

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
 * Class instances  must have a clone() function, which is called and the result is saved.
 *
 * @param o object to copy.
 * @returns copied object.
 * @throws on unknown or uncopyable data types.
 */
export function DeepCopy(o: any): any {
    const type = GetType(o);

    // Scalar types are directly returned.
    if (type && ["undefined", "null", "string", "number", "boolean", "bigint"].includes(type)) {
        return o;
    }
    else if (type === "array") {
        return o.map( (value: any) => DeepCopy(value) );
    }
    else if (type === "object") {
        const o2: any = {};
        const keys = Object.keys(o);
        keys.forEach( (key: string) => o2[key] = DeepCopy(o[key]) );
        return o2;
    }
    else if (type === "buffer" || type === "arraybuffer") {
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
 * Determine typical types of object.
 * @param o a scalar or object to determine type for.
 * @returns type as string or undefined if type could not be recognized.
 */
export function GetType(o: any): "undefined" | "null" | "string" | "number" | "boolean" | "bigint" |
    "array" | "object" | "buffer" | "arraybuffer" | "class" | "function" | undefined
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
    else if (ArrayBuffer.isView(o)) {
        return "arraybuffer";
    }
    else if (type === "object" && o.constructor === Object) {
        return type;
    }
    else if (type === "object") {
        return "class";
    }

    return undefined;
}

export async function sleep(ms: number): Promise<void> {
    return new Promise( resolve => {
        setTimeout(resolve, ms);
    });
}

export function CopyBuffer(...buffers: (Buffer | Uint8Array)[]): Buffer {
    let length = 0;
    const argsLength = buffers.length;
    for (let i=0; i<argsLength; i++) {
        const buffer = buffers[i];
        length += buffer.byteLength;
    }

    let pos = 0;
    const out = Buffer.alloc(length);
    for (let i=0; i<argsLength; i++) {
        const buffer = buffers[i];

        for (let i2=0; i2<buffer.byteLength; i2++) {
            out[pos++] = buffer[i2];
        }
    }

    return out;
}

export function DeepHash(o: any): Buffer {
    let b: Buffer | undefined;
    if (Array.isArray(o)) {
        const h = blake2b(32);
        o.forEach( (o2, index) => {
            const indexBuf = Buffer.alloc(4);
            indexBuf.writeUInt32BE(index);
            h.update(indexBuf);
            h.update(DeepHash(o2));
            h.update(indexBuf);
        });
        return Buffer.from(h.digest());
    }
    else if (typeof o === "object" && o.constructor === Object) {
        const keys = Object.keys(o);
        keys.sort();
        const values = keys.map( (key, index) => [index, key, o[key], index] );
        return DeepHash(values);
    }
    else if (o === undefined || o === null) {
        b = Buffer.alloc(0);
    }
    else if (typeof o === "string") {
        b = Buffer.from(o, "utf8");
    }
    else if (typeof o === "number") {
        if (isNaN(o)) {
            throw new Error("NaN is not supported");
        }
        b = Buffer.alloc(4);
        b.writeInt32BE(o);
    }
    else if (typeof o === "boolean") {
        b = Buffer.alloc(4);
        b.writeInt32BE(Number(o));
    }
    else if (typeof o === "bigint") {
        b = Buffer.from(o.toString(), "utf8");
    }
    else if (Buffer.isBuffer(o)) {
        b = o;
    }
    else {
        throw new Error(`Cannot hash type of ${o}`);
    }

    const h = blake2b(32);
    h.update(b);
    return Buffer.from(h.digest());
}

/**
 * Clean and prepare object for output.
 * Transform buffers to hex strings in object,
 * remove instances and functions.
 */
export function StripObject(obj: any): any {
    if (Buffer.isBuffer(obj)) {
        return obj.toString("hex");
    }
    else if (typeof(obj) === "bigint") {
        return Number(obj);
    }
    else if (Array.isArray(obj)) {
        return obj.map( (elm: any) => {
            return StripObject(elm);
        });
    }
    else if (obj && typeof obj === "object" && obj.constructor === Object) {
        const keys = Object.keys(obj);
        const obj2: any = {};
        keys.forEach( (key: string) => {
            obj2[key] = StripObject(obj[key]);
        });
        return obj2;
    }
    else if (obj && typeof obj === "object" && obj.constructor !== Object) {
        return undefined;
    }
    else if (obj && typeof obj === "function") {
        return undefined;
    }
    return obj;
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

/**
* Check in the image header data if it looks like a cert.
* @param image the cert image
* @returns true if the image header is recognized as being of primary interface cert.
*/
export function IsCert(image: Buffer): boolean {
    const chainCertPrimaryInterface = Buffer.from([0, PRIMARY_INTERFACE_CHAINCERT_ID]);
    if (image.slice(0, 2).equals(chainCertPrimaryInterface)) {
        return true;
    }

    const defaultCertPrimaryInterface = Buffer.from([0, PRIMARY_INTERFACE_DEFAULTCERT_ID]);
    if (image.slice(0, 2).equals(defaultCertPrimaryInterface)) {
        return true;
    }

    const nodeCertPrimaryInterface = Buffer.from([0, PRIMARY_INTERFACE_NODECERT_ID]);
    if (image.slice(0, 2).equals(nodeCertPrimaryInterface)) {
        return true;
    }

    return false;
}
