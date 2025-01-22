import { strict as assert } from "assert";

import sqlite3 from "sqlite3";

import {
    Database as SQLJSDatabase,
} from "sql.js";

import {
    Connection,
    QueryResult,
} from "postgrejs";

import {
    PromiseCallback,
} from "../util/common";

export type SQLType = "sqlite" | "sqliteJS" | "pg";

/**
 * Common abstraction over SQLite (node-sqlite3) and PostgreSQL (node-postgres) using the SQLite API.
 *
 * This utility has just enough functionality for our needs.
 */
export class DBClient {
    protected _sqlType: SQLType | undefined;
    protected isClosed: boolean = false;

    /** Special case onClose event handlers used for sql.js. */
    protected _closeEventHandlers: (() => void)[] = [];

    constructor(protected db: sqlite3.Database | Connection | SQLJSDatabase) {
        if (sqlite3.Database && db instanceof sqlite3.Database) {
            this._sqlType = "sqlite";
        }
        else if (Connection && db instanceof Connection) {
            this._sqlType = "pg";
        }
        else {
            this._sqlType = "sqliteJS";
        }
    }

    public getType(): SQLType {
        assert(this._sqlType, "sqlType not set in DBClient");
        return this._sqlType;
    }

    public generatePlaceholders(columns: number, rows: number = 1, index: number = 1): string {
        const isSqlite = this.getType() === "sqlite" ||  this.getType() === "sqliteJS";

        const placeholders: string[] = [];

        for (let row=0; row<rows; row++) {
            const group = Array(columns).fill(0).map( () => {
                if (isSqlite) {
                    return "?";
                }
                else {
                    return `$${index++}`;
                }
            });

            placeholders.push("(" + group.join(",") + ")");
        }

        return placeholders.join(",");
    }

    /**
     * List all tables in the database.
     */
    public async listTables(): Promise<string[]> {
        const sqlType = this.getType();

        if (sqlType === "sqlite" || sqlType === "sqliteJS") {
            const tables = await this.all(`SELECT name FROM sqlite_master WHERE type='table';`);

            return tables.map( row => row.name );
        }
        else if(sqlType === "pg") {
            const tables = await this.all(`SELECT table_name FROM information_schema.tables WHERE table_schema='public';`);

            return tables.map( row => row.table_name );
        }

        return [];
    }

    /**
     * Perform query yielding one row at a time until finished then it returns.
     * @param callback is called once for each row, if no rows then it is never called.
     * @param fetchCount only relevant for postgres, set to 1 if expecting large rows.
     * @returns number of retrieved rows
     * @throws on error.
     */
    public async each(sql: string, params: any[], callback: (row: any) => boolean | undefined, fetchCount: number = 1000): Promise<number> {
        const sqlType = this.getType();

        if (sqlType === "sqlite") {
            const db = this.db as sqlite3.Database;

            const p = PromiseCallback<number>();
            const p2 = PromiseCallback();

            // If this gets set then drain the cursor and do not issue any more callbacks.
            let cancelled: boolean | undefined = false;

            let rowCount = 0;

            db.each(sql, params, (err: Error | null, row: any) => {
                if (err) {
                    p.cb(err);
                    return;
                }

                if (cancelled) {
                    return;
                }

                rowCount++;

                cancelled = callback(row);

            }, p2.cb);

            p2.promise.then( () => {p.cb(undefined, rowCount);}).
                catch( (err) => {p.cb(err);} );

            return p.promise;
        }
        else if (sqlType === "sqliteJS") {
            const db = this.db as SQLJSDatabase;

            const p = PromiseCallback<number>();
            const p2 = PromiseCallback();

            // If this gets set then drain the cursor and do not issue any more callbacks.
            let cancelled: boolean | undefined = false;

            let rowCount = 0;

            db.each(sql, params, (row: any) => {
                if (cancelled) {
                    return;
                }

                rowCount++;

                const colNames = Object.keys(row);

                const colNamesLength = colNames.length;
                for (let index=0; index<colNamesLength; index++) {
                    const colName = colNames[index];
                    const value = row[colName];
                    if (value instanceof Uint8Array) {
                        row[colName] = Buffer.from(value);
                    }
                }

                cancelled = callback(row);

            }, p2.cb);

            p2.promise.then( () => {p.cb(undefined, rowCount);}).
                catch( (err) => {p.cb(err);} );

            return p.promise;
        }
        else if(sqlType === "pg") {
            const db = this.db as Connection;

            let qr: QueryResult;

            let statement;

            if (params.length > 0) {
                statement = await db.prepare(sql);
                qr = await statement.execute({params, cursor: true, fetchCount, rollbackOnError: false, objectRows: true});
            }
            else {
                qr = await db.query(sql, {cursor: true, fetchCount, rollbackOnError: false, objectRows: true});
            }

            assert(qr?.cursor, "cursor not set in DBClient.each");

            // If this gets set then abort the cursor and do not issue any more callbacks.
            let cancelled: boolean | undefined = false;

            let rowCount = 0;
            let row;

            while (row = await qr.cursor.next()) {
                rowCount++;

                cancelled = callback(row);

                if (cancelled) {
                    break;
                }
            }

            await qr.cursor.close();
            await statement?.close();

            return rowCount;
        }

        return 0;
    }

    /**
     * Perform query with optional parameters and return full resultset.
     */
    public async all(sql: string, params?: any[]): Promise<any[]> {
        const sqlType = this.getType();
        params = params ?? [];

        const p = PromiseCallback<any[]>();

        if (sqlType === "sqlite") {
            const db = this.db as sqlite3.Database;

            db.all(sql, params, p.cb);
        }
        else if (sqlType === "sqliteJS") {
            const db = this.db as SQLJSDatabase;

            // Synchronous call.
            const execResult = db.exec(sql, params);

            if (execResult.length === 0) {
                return [];
            }

            const rows = [];

            const colNames = execResult[0].columns;
            const rawRows = execResult[0].values;

            const rowsLength = rawRows.length;
            for (let index=0; index<rowsLength; index++) {
                const rawRow = rawRows[index];

                let col = 0;
                const row: any = {};

                const l = rawRow.length;
                for (let index=0; index<l; index++) {
                    const value = rawRow[index];
                    row[colNames[col]] = value instanceof Uint8Array ? Buffer.from(value) : value;
                    col = col + 1;
                    col = col % colNames.length;
                }

                rows.push(row);
            }

            return rows;
        }
        else if(sqlType === "pg") {
            const db = this.db as Connection;

            if (params.length > 0) {
                const statement = await db.prepare(sql);

                statement.execute({params, rollbackOnError: false, objectRows: true}).
                    then( (res) => {p.cb(undefined, res.rows ?? [])}).
                    catch( (err) => {p.cb(err);} ).
                    finally( () => {statement.close();} );
            }
            else {
                db.query(sql, {rollbackOnError: false, objectRows: true}).
                    then( (res) => {p.cb(undefined, res.rows ?? [])}).
                    catch( (err) => {p.cb(err)} );
            }
        }

        return p.promise;
    }

    /**
     * Wrapper of all() and returns the first row, or undefined if no rows.
     * Remember to limit this query using LIMIT 1, since it is wrapping all().
     * @return row or undefined.
     */
    public async get(sql: string, params?: any[]): Promise<any> {
        const rows = await this.all(sql, params);

        if (rows) {
            return rows[0];
        }

        return undefined;
    }

    /**
     * Execute one or many SQL statements, do not return anything.
     *
     * Note that for SQLite if any statement fails the prior statements are still persisted,
     * but for Postgres none of the statements are persisted.
     *
     * It is recommended to run multiple statements within a transaction and rollback on any failure.
     *
     * @throws on failure
     */
    public async exec(sql: string): Promise<void> {
        const sqlType = this.getType();

        const p = PromiseCallback<void>();

        if (sqlType === "sqlite") {
            const db = this.db as sqlite3.Database;

            db.exec(sql, p.cb);
        }
        else if (sqlType === "sqliteJS") {
            const db = this.db as SQLJSDatabase;

            // Synchronous call.
            db.run(sql);

            p.cb();
        }
        else if(sqlType === "pg") {
            const db = this.db as Connection;

            db.execute(sql).
                then(() => {p.cb()}).catch((err) => {p.cb(err)});
        }

        return p.promise;
    }

    /**
     * Run single query with optional parameters,
     * do not return any result.
     */
    public async run(sql: string, params?: any[]): Promise<void> {
        const sqlType = this.getType();
        params = params ?? [];

        const p = PromiseCallback<void>();

        if (sqlType === "sqlite") {
            const db = this.db as sqlite3.Database;

            db.run(sql, params, p.cb);
        }
        else if (sqlType === "sqliteJS") {
            const db = this.db as SQLJSDatabase;

            // Synchronous call.
            db.run(sql, params);

            p.cb();
        }
        else if(sqlType === "pg") {
            const db = this.db as Connection;

            if (params.length > 0) {
                const statement = await db.prepare(sql);

                statement.execute({params}).
                    then( () => {p.cb();} ).
                    catch( (err) => {p.cb(err);} ).
                    finally( () => {statement.close();} );
            }
            else {
                db.query(sql, {rollbackOnError: false, objectRows: true}).
                    then( () => {p.cb()}).catch( (err) => {p.cb(err)} );
            }
        }

        return p.promise;
    }

    public on(event: string, fn: (...args: any[]) => void) {
        const sqlType = this.getType();

        if (sqlType === "sqlite") {
            const db = this.db as sqlite3.Database;
            db.on(event, fn);
        }
        else if (sqlType === "sqliteJS") {
            //const db = this.db as SQLJSDatabase;

            // TODO: not sure how to handle onClose and onError in sql.js
            //
            if (event === "close") {
                this._closeEventHandlers.push(fn);
            }
        }
        else if(sqlType === "pg") {
            const db = this.db as Connection;

            if (event === "close") {
                db.on("close", fn);
            }
            else if (event === "error") {
                db.on("error", fn);
            }
        }
    }

    public off(event: string, fn: (...args: any[]) => void) {
        if ((this.db as any).off) {
            (this.db as any).off(event, fn);
        }
        else {
            if (event === "close") {
                this._closeEventHandlers = this._closeEventHandlers.filter( fn2 => fn2 !== fn );
            }

            // NOTE: sql.js does not have onError.
        }
    }

    public close() {
        if (this.isClosed) {
            return;
        }

        this.isClosed = true;

        const sqlType = this.getType();

        if (sqlType === "sqlite") {
            const db = this.db as sqlite3.Database;

            db.close();
        }
        else if (sqlType === "sqliteJS") {
            const db = this.db as SQLJSDatabase;

            db.close();

            this._closeEventHandlers.forEach( fn => fn() );
        }
        else if(sqlType === "pg") {
            const db = this.db as Connection;

            db.close();
        }
    }
}
