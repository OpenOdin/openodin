import sqlite3 from "sqlite3";

import initSqlJs = require("sql.js");

import {
    Database as SQLJSDatabase,
} from "sql.js";


import {
    Connection,
    ConnectionConfiguration,
} from "postgresql-client";

import {
    PromiseCallback,
    DBClient,
} from "../src";

/**
 * @param promise to await
 * @param expectedMessage if set then the thrown error message must exactly mach this / one of these if array.
 * @returns the Error object thrown
 * @throws if promise does not throw or expectedMessage (if set) does not match thrown error message.
 */
export async function expectAsyncException(promise: Promise<any>, expectedMessage?: string | string[]): Promise<Error> {
    try {
        await promise;
    }
    catch(e) {
        const error = e as Error;

        if (expectedMessage !== undefined && typeof expectedMessage === "string" && expectedMessage !== error.message) {
            throw new Error(`Async function did not throw the expected message but threw: ${error.message}`);
        }

        if (expectedMessage !== undefined && Array.isArray(expectedMessage) && !expectedMessage.includes(error.message)) {
            throw new Error(`Async function did not throw the expected message but threw: ${error.message}`);
        }

        return error;
    }

    throw new Error("Async function expected to throw but did not");
}

export async function expectAsyncNoException(promise: Promise<any>): Promise<any> {
    try {
        return await promise;
    }
    catch(e) {
        const error = e as Error;

        throw new Error(`Async function not expected to throw, but threw: ${error.message}`);
    }
}
