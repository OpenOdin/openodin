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

export async function OpenSQLite(storage: string = ":memory:"): Promise<sqlite3.Database> {
    const p = PromiseCallback();

    const db = new sqlite3.Database(storage, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE | sqlite3.OPEN_FULLMUTEX | sqlite3.OPEN_URI, p.cb);

    try {
        const error = await p.promise;
        if (error) {
            throw new Error(`Could not open SQLite database: ${error}`);
        }
    }
    catch(e) {
        throw new Error(`Could not open SQLite database: ${e}`);
    }

    return db;
}

export async function OpenSQLiteJS(): Promise<SQLJSDatabase> {
    try {
        const SQL = await initSqlJs();

        const db = new SQL.Database();

        return db;
    }
    catch(e) {
        throw new Error(`Could not open SQLiteJs database: ${e}`);
    }
}

export async function OpenPG(repeatableRead: boolean = true): Promise<Connection> {
    const password = "THIS-WILL-DESTROY-ALL-YOUR-DATA";

    const config: ConnectionConfiguration = {
        password,
    };

    const client = new Connection(config);

    await client.connect();

    if (repeatableRead) {
        await client.execute(`SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL REPEATABLE READ; SET SESSION lock_timeout = '1s'; SET SESSION idle_in_transaction_session_timeout = '2s';`);
    }
    else {
        await client.execute(`SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL READ COMMITTED; SET SESSION lock_timeout = '1s'; SET SESSION idle_in_transaction_session_timeout = '2s';`);
    }

    return client;
}
