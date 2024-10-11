export type JSONObject = Record<string, any>;

/**
 * The SchemaUtil parses JSON objects into native objects according to a given schema object.
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
 *  // If type is string or buffer and the passed in value is object or array then the value
 *  // is JSON.stringified to a string (and further to a Buffer if type is Buffer/Uint8Array).
 *  //
 *  "conf?": "",
 *
 *  // If the schema value is (empty) Uint8Array or Buffer,
 *  // then the given value is parsed from string as (encoding as prefix):
 *  // hex:ABBAABBA
 *  // ascii:Hello World
 *  // utf8:Hello Icons
 *  // base64:SGVsbG8gT2Rpbgo=
 *  // ABBAABBA (for hex you can actually leave out the "hex:" prefix)
 *  //
 *  // If the given value is not string but Buffer or Uint8Array then it is used as is wrapped
 *  // in Buffer.
 *  // Array of numbers are also allowed and will be converted into Buffer.
 *  //
 *  data: new Uint8Array(0),  //Buffer.alloc(0) also works.
 *
 *  // schema value of type function will run with given obj value as argument and the return
 *  // value is set to the object.
 *  // function fields can be optional and then undefined is then passed as argument if
 *  // no value was provided in the parsed object.
 *  //
 *  "nodeType": ParseEnum(["alpha", "beta", "gamma"], "alpha");
 *
 *  // Double ?? means do not set default value, just check type if value was set.
 *  // This in contrast to single ? which does set the default value if none already set.
 *  "someOption??": false,
 *
 *  // Empty key name is a default for any key not defined in the schema.
 *  // ? and ?? can be set but have no effect for this property.
 *  // If this is not used then unknown keys will cause an error to be thrown.
 *  //
 *  "": "",
 *
 *  // If _postFn is set then the parsed obj is passed to the fn at the very end
 *  // and the result from the function is returned instead of obj.
*   // This can be used to validate values of fields or to restructure the final output.
*   //
 *  _postFn: function(obj: any) => any,
 * }
 *
 * // Any key starting with " ## " is treated as a comment and ignored.
 * //
 * " ## ": "This is a comment, which is ignored in parsing and not part of the result",
 *
 * // Tell the parser to allow this field in the object but still skip it and do not
 * // return it.
 * //
 * someOption: undefined,
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
 *
 * Field value validation:
 * The schema checker only checks for correct types and can in some cases translate to the correct type,
 * but it does not validate the actual values of the fields.
 * To do this provide a _postFn or set a function as schema field value to do the parsing and checking.
 */

import {
    DeepCopy,
} from "./common";

/**
 * @param schema the schema
 * @param obj the object to apply the schema to
 * @param pKey the nested key name to be used in error output
 * @returns new adapted object
 * @throws if schema cannot be applied to obj
 */
export function ParseSchema(schema: any, obj: any, pKey: string = ""): any {
    // Validate value
    //
    if (typeof schema === "function") {
        try {
            return schema(obj);
        }
        catch(e) {
            throw new Error(`Error parsing with function for key ${pKey}: ${e}`);
        }
    }

    if (obj === undefined || obj === null) {
        throw new Error(`undefined or null provided as value in conflict with schema for key ${pKey}`);
    }

    if (typeof schema === "string") {
        if ((typeof obj === "object" && obj.constructor === Object) || Array.isArray(obj)) {
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
    else if (Buffer.isBuffer(schema) || schema instanceof Uint8Array) {
        if (typeof obj === "string") {
            if (obj.startsWith("ascii:")) {
                return Buffer.from(obj.slice(6), "ascii");
            }
            else if (obj.startsWith("utf8:")) {
                return Buffer.from(obj.slice(5), "utf8");
            }
            else if (obj.startsWith("base64:")) {
                return Buffer.from(obj.slice(7), "base64");
            }
            else if (obj.startsWith("hex:")) {
                return Buffer.from(obj.slice(4), "hex");
            }
            else {
                return Buffer.from(obj, "hex");
            }
        }
        else if ((typeof obj === "object" && obj.constructor === Object) || Array.isArray(obj)) {
            return Buffer.from(JSON.stringify(obj), "utf8");
        }
        else {
            return Buffer.from(obj);
        }
    }
    else if (typeof schema === "object" && schema.constructor === Object) {
        if (typeof obj === "object" && obj.constructor === Object) {
            const obj2: {[key: string]: any} = {};

            const schemaKeys: Array<[string, boolean, string, boolean]> = [];

            // Sort keys so we always have the default key "" at the top.
            //
            Object.keys(schema).sort().forEach( key => {
                const a = key.split("?");

                const name = a[0];

                if (name === "_postFn") {
                    return;
                }

                const required = a.length === 1;  // ?

                const noDefault = a.length === 3;  // ??

                schemaKeys.push([name, required, key, noDefault]);
            });

            if (schemaKeys.length === 0) {
                // Allow any object as value.
                //
                if (schema._postFn) {
                    return schema._postFn(DeepCopy(obj));
                }

                return DeepCopy(obj);
            }

            const objKeys = Object.keys(obj);

            objKeys.forEach( objKey => {
                const v = obj[objKey];

                if (v === undefined || v === null || objKey.startsWith(" ## ")) {
                    return;
                }

                if (schemaKeys.findIndex( tuple => tuple[0] === objKey ) === -1) {

                    if (schemaKeys[0][0] === "") {
                        const key = schemaKeys[0][2]

                        const subSchema = schema[key];

                        obj2[objKey] = ParseSchema(subSchema, v, `${pKey}.${objKey}`);

                        return;
                    }

                    throw new Error(`Unknown key ${pKey}.${objKey} provided in object but not in schema`);
                }
            });

            schemaKeys.forEach( tuple => {
                const [name, required, key, noDefault] = tuple;

                if (name === "") {
                    // Skip the default key.
                    //
                    return;
                }

                const subSchema = schema[key];

                if (subSchema === undefined) {
                    // Ignore this field.
                    // The point of this is to tolerate keys in the parsed object to exists even if we
                    // do not parse them.
                    //
                    return;
                }

                let v = obj[name];

                if (v === undefined || v === null) {
                    if (required) {
                        throw new Error(`Key ${pKey}.${name} required by schema but no value provided`);
                    }

                    if (noDefault) {
                        // Do not set a default and skip this field.
                        //
                        return;
                    }

                    // Apply default
                    //

                    if (typeof subSchema === "object" && subSchema.constructor === Object) {
                        v = {};
                    }
                    else if(Array.isArray(subSchema)) {
                        v = [];
                    }
                    else if (typeof subSchema !== "function") {
                        // Use default value
                        //
                        v = DeepCopy(subSchema);
                    }
                    else {
                        // Do not set any default value for function and let undefined/null
                        // be passed into function.
                        //
                    }
                }

                obj2[name] = ParseSchema(subSchema, v, `${pKey}.${name}`);
            });

            if (schema._postFn) {
                return schema._postFn(obj2);
            }

            return obj2;
        }
        else {
            throw new Error(`Expected value to be of object type for key ${pKey}`);
        }
    }
    else if(Array.isArray(schema)) {
        if (!Array.isArray(obj)) {
            throw new Error(`Expected value to be of array type for key ${pKey}`);
        }

        if (schema.length === 0) {
            // Allow any array without type checking elements.
            //
            return obj;
        }

        if (schema.length !== 1) {
            throw new Error(`Expected schema value to be of array with exactly a single element for key ${pKey}`);
        }

        const subSchema = schema[0];

        return obj.map( (elm, index) => ParseSchema(subSchema, elm, `${pKey}[${index}]`));
    }
    else {
        throw new Error(`Unknown schema type for key ${pKey}`);
    }
}

/**
 * @param list array of accepted values for when value given
 * @param defaultValue if no value given then use default (default is not required to be in list of accepted values).
 */
export function ParseEnum(list: Array<string | number | bigint | boolean>,
    defaultValue?: string | number | bigint | boolean):
    (value: string | number | bigint | boolean | undefined | null) => string | number | bigint | boolean
{
    return function(value: string | number | bigint | boolean | undefined | null) {
        if (value === undefined || value === null || value === "") {
            if (defaultValue !== undefined) {
                return defaultValue;
            }

            throw new Error(`Enum not matched and no default value provided. Expecting one of: ${list.join(", ")}`);
        }
        else {
            if (!list.includes(value)) {
                throw new Error(`Enum not matched. Expecting one of: ${list.join(", ")}`);
            }

            return value;
        }
    };
}

export function ParseArrayWithDefault(schema: [any], defaultValue: any[]):
    (value: any[] | undefined | null) => any[]
{
    return function(value: any[] | undefined | null) {
        if (!Array.isArray(value)) {
            value = defaultValue;
        }

        return ParseSchema(schema, value);
    };
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
 * @param useBase64 set to true to convert buffers to base64 instead of hex
 * @returns transformed object
 */
export function ToJSONObject(obj: any, useBase64: boolean = false): any {
    if (obj === undefined || obj === null) {
        return null;
    }
    else if (Buffer.isBuffer(obj)) {
        if (useBase64) {
            return "base64:" + obj.toString("base64");
        }

        return obj.toString("hex");
    }
    else if (obj instanceof Uint8Array) {
        if (useBase64) {
            return "base64:" + Buffer.from(obj).toString("base64");
        }

        return Buffer.from(obj).toString("hex");
    }
    else if (typeof(obj) === "bigint") {
        return obj.toString();
    }
    else if (Array.isArray(obj)) {
        return obj.map( (elm: any) => {
            return ToJSONObject(elm, useBase64);
        });
    }
    else if (obj && typeof obj === "object") {
        // Both Objects and class instances.
        //

        const obj2: any = {};

        Object.keys(obj).forEach( (key: string) => {
            const v = obj[key];

            if (v === undefined) {
                return;
            }

            obj2[key] = ToJSONObject(v, useBase64);
        });

        return obj2;
    }
    else if (typeof obj === "function") {
        return null;
    }

    return obj;
}
