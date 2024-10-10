import {
    DeepCopy,
} from "./common";

/**
 * Substitute variables in template object for given values in variables map.
 * Any string value anywhere in the template object is substituted by provided value
 * in variables mapping. If variable not provided in variables mapping then use
 * given default value in template, if default value not defined then remove element.
 * If element is inside array the array will become shorter as the element is removed.
 *
 * template =
 * {
 *  name: "${nameOfPerson:string:John Doe}",
 *  age: "${:number:99}",  // Note that leaving out varName will default to key name (age).
 *  hair: "${hairStyle}",
 *  pets: ["${pet}"],  // Note that array elements cannot do: ${:string:xyz} because there is not key.
 * }
 *
 * variables =
 * {
 *  nameOfPerson: "Jane Doe",
 *  hairStyle: "Curly",
 *  pet: "Turtle",
 * }
 *
 * Output =
 * {
 *  name: "Jane Doe",
 *  age: 99,
 *  hair: "Curly",
 *  pets: ["Turtle"],
 * }
 *
 * In case "hairStyle" is left out in "variables" that element will not be present in output as it has no default value.
 * In case "pet" is left out in "variables" then pets array will be an empty array.
 *
 * @param template object (typically coming from JSON.parse)
 * @param variables map of {varName: value}
 */
export function TemplateSubstitute(obj: any, variables: Record<string, any>, keyName?: string): any {
    if (typeof obj === "string") {
        // Check if to substitute
        //
        let varName: string | undefined;
        let varType: string | undefined;
        let varDefault: string | undefined;

        let match = obj.match(/^\${([a-zA-Z0-9]*):([^:]+):(.*)}$/);

        if (match) {
            varName = match[1] || keyName;
            varType = match[2];
            varDefault = match[3];
        }

        if (!match) {
            match = obj.match(/^\${([a-zA-Z0-9]+)}$/);

            if (match) {
                varName = match[1];
            }
        }

        if (varName || varDefault) {
            const v = varName ? variables[varName] : undefined;

            if (v === null) {
                // null from JSON parsing indicates to not use default value,
                // but to remove it completely.
                //
                return undefined;
            }

            if (v !== undefined) {
                if (varType === "bigint") {
                    return BigInt(v);
                }

                return DeepCopy(v);
            }

            // Check if to use default
            //
            if (varDefault !== undefined) {
                if (varType === "string") {
                    return varDefault;
                }
                else if (varType === "number") {
                    return Number(varDefault);
                }
                else if (varType === "bigint") {
                    return BigInt(varDefault);
                }
                else if (varType === "boolean") {
                    return varDefault === "true";
                }
            }

            return undefined;
        }

        return obj;
    }
    else if (Array.isArray(obj)) {
        const outArray: any[] = [];

        const l = obj.length;

        for (let i=0; i<l; i++) {
            const innerObj = obj[i];

            const innerObj2 = TemplateSubstitute(innerObj, variables);

            if (innerObj2 === undefined && innerObj !== innerObj2) {
                // Skip this element
                //
                continue;
            }

            outArray.push(innerObj2);
        }

        return outArray;
    }
    else if (obj && typeof obj === "object" && obj.constructor === Object) {
        const outObj: any = {};

        const keys = Object.keys(obj);

        const l = keys.length;

        for (let i=0; i<l; i++) {
            const key = keys[i];

            const innerObj = obj[key];

            const innerObj2 = TemplateSubstitute(innerObj, variables, key);

            if (innerObj2 === undefined && innerObj !== innerObj2) {
                // Skip this element
                //
                continue;
            }

            outObj[key] = innerObj2;
        }

        return outObj;
    }

    return DeepCopy(obj);
}
