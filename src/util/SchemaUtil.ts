export type JSONObject = Record<string, any>;

/**
 * The SchemaUtil parses JSON into native objects according to a given schema object.
 * {
 *  // Required field and must be of type string.
 *  //
 *  "name": "",
 *
 *  // Optional field, must be of type number if set and default value is 99.
 *  //
 *  "age?": 99,
 *
 *  // Optional array, if set then all elements must match first element defined here.
 *  // If not set then default value is empty array.
 *  //
 *  "pets?": [{type: "", name: "", "furry?": "no"}]
 *
 *  // Optional object must have all optional fields it self so we can use the defaults.
 *  //
 *  "driverLicense?": {
 *      "issued?": false,
 *  }
 *
 *  // Value is allowed to be string or number (or BigInt) and is converted into BigInt
 *  //
 *  "large": 0n,
 *
 *  // Value is allowed to be string or number and is converted into number
 *  //
 *  "medium": 0,
 *
 *  // Value is allowed to be boolean or number and is converted into boolean
 *  //
 *  "confirmed": false,
 *
 *  // If type is string or buffer and the passed in value is object then the value
 *  // is JSON.stringified to a string (and further to a Buffer if type is Buffer/Uint8Array).
 *  //
 *  "conf?": "",
 *
 *  // If the schema value is (empty) Uint8Array or Buffer,
 *  // then the given value is parsed from string as (encoding as prefix):
 *  // hex:ABBAABBA
 *  // ascii:Hello World
 *  // utf8:Hello Icons
 *  // ABBAABBA (for hex you can actually leave out the prefix hex:)
 *  //
 *  // If the given value is not string but Buffer or Uint8Array then it is used as is wrapped
 *  // in Buffer.
 *  // Array of numbers are also allowed and will be converted into Buffer.
 *  //
 *  "data": new Uint8Array(0),  //Buffer.alloc(0) also works.
 *
 *  // schema value of type function will run with given obj value as argument and the return
 *  // value is set to the object.
 *  // function fields cannot be optional.
 *  //
 *  "nodeType": function(args) {...},
 * }
 *
 * JSON parse schemas:
 *
 * Key names with "?" suffix are optional to have been set.
 * If they are not set then they are set using the value as default value,
 * with the exception of array values, because for arrays an empty array is set as default value,
 * regardless of the object defined inside the array in the schema. The object in the array in
 * the schema is used to validate given objects in the case the array was set with objects.
 * The first element of the array in the schema is used to validate all elements in the user provided
 * array of elements.
 *
 * If the key is not set and the default value in the schema is an object then set an empty
 * object as default value and parse the object against the schema to have it set the default
 * values in the new object according to the schema. Note however that this will only work
 * if the object schema as all optional properties since the default value set is an empty object.
 *
 * Key names which are not optional require that a value is set and that it matches the type
 * of the value provided in the schema (the value it self is ignored, only the type of the value
 * is used).
 */

import {
    DeepCopy,
} from "./common";

/**
 * @param schema the schema
 * @param obj the object to apply the schema to
 * @returns new adapted object
 * @throws if schema cannot be applied to obj
 */
export function ParseSchema(schema: any, obj: any, pKey: string = ""): any {
    if (obj === undefined || obj === null) {
        throw new Error(`undefined or null provided as value in conflict with schema for key ${pKey}`);
    }

    // Validate value
    //
    if (typeof schema === "string") {
        if (typeof obj === "object" && obj.constructor === Object) {
            return JSON.stringify(obj);
        }

        return String(obj);
    }
    else if (typeof schema === "number") {
        return Number(obj);
    }
    else if (typeof schema === "bigint") {
        return BigInt(obj);
    }
    else if (typeof schema === "boolean") {
        return Boolean(obj);
    }
    else if (typeof schema === "function") {
        return schema(obj);
    }
    else if (Buffer.isBuffer(schema) || schema instanceof Uint8Array) {
        if (typeof obj === "string") {
            if (obj.startsWith("ascii:")) {
                return Buffer.from(obj.slice(6), "ascii");
            }
            else if (obj.startsWith("utf8:")) {
                return Buffer.from(obj.slice(5), "utf8");
            }
            else if (obj.startsWith("hex:")) {
                return Buffer.from(obj.slice(4), "hex");
            }
            else {
                return Buffer.from(obj, "hex");
            }
        }
        else if (typeof obj === "object" && obj.constructor === Object) {
            return Buffer.from(JSON.stringify(obj), "utf8");
        }
        else {
            return Buffer.from(obj);
        }
    }
    else if (typeof schema === "object" && schema.constructor === Object) {
        if (typeof obj === "object" && obj.constructor === Object) {
            const obj2: {[key: string]: any} = {};

            const schemaKeys: Array<[string, boolean, string]> = Object.keys(schema).map( key => {
                const a = key.split("?");

                const name = a[0];

                const required = a.length === 1;

                return [name, required, key];
            });

            const objKeys = Object.keys(obj);

            objKeys.forEach( key => {
                if (schemaKeys.findIndex( tuple => tuple[0] === key ) === -1) {
                    throw new Error(`Unknown key ${pKey}.${key} provided in object but not in schema`);
                }
            });

            schemaKeys.forEach( tuple => {
                const [key, required, fullKey] = tuple;

                const subSchema = schema[fullKey];

                if (typeof subSchema === "function" && !required) {
                    throw new Error(`Error in schema: value type function must be a required field, for key ${pKey}.${key}`);
                }

                let v = obj[key];

                if (v === undefined || v === null) {
                    if (required) {
                        throw new Error(`Key ${pKey}.${key} required by schema but no value provided`);
                    }

                    // Apply default
                    //

                    if (typeof subSchema === "object" && subSchema.constructor === Object) {
                        v = {};
                    }
                    else if(Array.isArray(subSchema)) {
                        v = [];
                    }
                    else {
                        // Use default value
                        //
                        v = DeepCopy(subSchema);
                    }
                }

                obj2[key] = ParseSchema(subSchema, v, `${pKey}.${key}`);
            });

            return obj2;
        }
        else {
            throw new Error(`Expected value to be of object type for key ${pKey}`);
        }
    }
    else if(Array.isArray(schema)) {
        if (schema.length !== 1) {
            throw new Error(`Expected schema value to be of array with exactly a single element for key ${pKey}`);
        }

        if (!Array.isArray(obj)) {
            throw new Error(`Expected value to be of array type for key ${pKey}`);
        }

        const subSchema = schema[0];

        return obj.map( (elm, index) => ParseSchema(subSchema, elm, `${pKey}[${index}]`));
    }
    else {
        throw new Error(`Unknown schema type for key ${pKey}`);
    }
}

/**
 * Transform given object to JSON friendly format suitable
 * to be parsed back using ParseSchema and an appropiate schema definition.
 *
 * BigInts are converted into strings.
 * Buffer/Uint8Array are converted into hexadecimal strings
 * undefined are converted to null
 *
 * @param obj object to transform
 * @returns transformed object
 */
export function ToJSONObject(obj: any): any {
    if (obj === undefined || obj === null) {
        return null;
    }
    else if (Buffer.isBuffer(obj)) {
        return obj.toString("hex");
    }
    else if (obj instanceof Uint8Array) {
        return Buffer.from(obj).toString("hex");
    }
    else if (typeof(obj) === "bigint") {
        return obj.toString();
    }
    else if (Array.isArray(obj)) {
        return obj.map( (elm: any) => {
            return ToJSONObject(elm);
        });
    }
    else if (obj && typeof obj === "object") {
        // Both Objects and class instances.
        //

        const obj2: any = {};

        Object.keys(obj).forEach( (key: string) => {
            obj2[key] = ToJSONObject(obj[key]);
        });

        return obj2;
    }
    else if (typeof obj === "function") {
        return null;
    }

    return obj;
}
