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
} from "./common";

export class DatabaseUtil {
    /**
     * Open SQLite database.
     *
     * @throws
     */
    public static async OpenSQLite(uri: string): Promise<sqlite3.Database> {
        const p = PromiseCallback();

        const db = new sqlite3.Database(uri, sqlite3.OPEN_READWRITE |
            sqlite3.OPEN_CREATE | sqlite3.OPEN_FULLMUTEX | sqlite3.OPEN_URI,
            p.cb);

        try {
            const error = await p.promise;
            if (error) {
                throw new Error(`Could not open sqlite database: ${error}`);
            }
        }
        catch(e) {
            throw new Error(`Could not open sqlite database: ${e}`);
        }

        return db;
    }

    public static async OpenPG(uri: string, repeatableRead: boolean = true): Promise<Connection> {
        const client = new Connection(uri);

        await client.connect();

        if (repeatableRead) {
            await client.execute(`SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL REPEATABLE READ; SET SESSION lock_timeout = '1s'; SET SESSION idle_in_transaction_session_timeout = '2s';`);
        }
        else {
            await client.execute(`SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL READ COMMITTED; SET SESSION lock_timeout = '1s'; SET SESSION idle_in_transaction_session_timeout = '2s';`);
        }

        return client;
    }

    public static async OpenSQLiteJS(): Promise<SQLJSDatabase> {
        try {
            const SQL = await initSqlJs();

            const db = new SQL.Database();

            return db;
        }
        catch(e) {
            throw new Error(`Could not open SQLiteJs database: ${e}`);
        }
    }

}
