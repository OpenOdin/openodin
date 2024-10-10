import fs from "fs";
import path from "path";
import os from "os";

import {
    PocketConsole,
} from "pocket-console";

const console = PocketConsole({module: "JSONUtil"});

const FORBIDDEN_PATHS = [
    /^\/home\/[^/]+\/\./,
    /^\/root\/\./,
];

export class JSONUtil {
    /**
     * @throws
     */
    public static LoadJSON(file: string, allowedExternalLoading: string[] = []): any {
        if (file.substr(0, 2) === "~/") {
            file = path.join(os.homedir(), file.substr(1));
        }

        file = file[0] === path.sep ? file : path.normalize(path.join(process.cwd(), file));

        FORBIDDEN_PATHS.forEach( forbiddenPath => {
            if (file.match(forbiddenPath)) {
                throw new Error(`The file ${file} is not allowed to be loaded since it matches the forbidden path ${forbiddenPath}.`);
            }
        });

        if (!fs.existsSync(file)) {
            throw new Error(`File "${file}" does not exist.`);
        }

        let content;
        try {
            content = fs.readFileSync(file, {encoding: "utf8"});
        }
        catch(e) {
            throw new Error(`"${file}" could not be read.`);
        }

        let obj;
        try {
            obj = JSON.parse(content);
        }
        catch(e) {
            throw new Error(`${file} could not be parsed as JSON: ${e}`);
        }

        return JSONUtil.ParseJSON(obj, "", allowedExternalLoading, file);
    }

    /**
     * String values mathcing /^!path.json:.keyname/ will be substituted with loaded value from path.json and ".keyname" value,
     * if allowedExternalLoading contains the ".varname" of the value we are substituting.
     */
    public static ParseJSON(obj: any, varName: string, allowedExternalLoading: string[], orgFile: string): any {
        if (Array.isArray(obj)) {
            return obj.map( (elm: any) => {
                return JSONUtil.ParseJSON(elm, `${varName}[]`, allowedExternalLoading, orgFile);
            });
        }
        else if (obj && typeof obj === "object" && obj.constructor === Object) {
            const keys = Object.keys(obj);
            const obj2: any = {};
            keys.forEach( (key: string) => {
                obj2[key] = JSONUtil.ParseJSON(obj[key], `${varName}.${key}`, allowedExternalLoading, orgFile);
            });
            return obj2;
        }

        if (typeof obj === "string") {
            const fileMatch = /^!([^:]+):(.*)/;
            const match = fileMatch.exec(obj);
            if (match) {
                const file = match[1];
                const key = match[2];

                const allowed = allowedExternalLoading.some( path => {
                    if (varName.startsWith(path)) {
                        const isBoundary = varName[path.length];
                        if (path === "." || isBoundary === undefined || isBoundary === "." || isBoundary === "[") {
                            return true;
                        }
                    }

                    return false;
                });

                if (allowed) {
                    let filePath = file;

                    if (filePath.substr(0, 2) === "~/") {
                        filePath = path.join(os.homedir(), filePath.substr(1));
                    }

                    filePath = filePath[0] === path.sep ? filePath : path.join(path.dirname(orgFile), filePath);
                    const obj2 = JSONUtil.LoadJSON(filePath);
                    const value = JSONUtil.FetchValue(obj2, key);
                    return value;
                }
                else {
                    console.debug(`External loading does not allow field name: ${varName}, for file: ${file}`);
                    return undefined;
                }
            }
        }

        return obj;
    }

    public static FetchValue(obj: any, path: string): any {
        const objMatch = /^\.(\w+)/;
        const arrMatch = /^\[([0-9]+)]/;
        while (path.length > 0 && path !== '.') {
            let match = objMatch.exec(path);
            if (!match) {
                match = arrMatch.exec(path);
            }
            if (match) {
                path = path.slice(match[0].length);
                obj = obj[match[1]];
                continue;
            }

            return undefined;
        }

        return obj;
    }
}
