import {
    assert,
} from "chai";

import {
    PromiseCallback,
    DBClient,
    TABLES,
    sleep,
} from "../../src";

import {
    expectAsyncException,
    OpenSQLite,
    OpenSQLiteJS,
    OpenPG,
} from "../util";


describe("DBClient: should work with SQLite", function() {
    let dbClient: DBClient | undefined;
    let config: {dbClient?: DBClient} = {};

    beforeEach("Open database and create tables", async function() {
        dbClient = new DBClient(await OpenSQLite());
        config.dbClient = dbClient;
        await dbClient.all(`DROP TABLE IF EXISTS abc;`);
        await dbClient.all(`CREATE TABLE abc (a bytea NULL UNIQUE, b bigint NULL UNIQUE, c integer, d smallint)`);
    });

    afterEach("Close database", function() {
        dbClient?.close();
        dbClient = undefined;
        config.dbClient = undefined;
    });

    it("#getType", function() {
        assert(dbClient);
        assert(dbClient.getType() === "sqlite");
    });

    it("#generatePlaceholders", function() {
        assert(dbClient);

        let sql = dbClient.generatePlaceholders(10, 1);
        assert(sql === "(?,?,?,?,?,?,?,?,?,?)");

        sql = dbClient.generatePlaceholders(9, 2);
        assert(sql === "(?,?,?,?,?,?,?,?,?),(?,?,?,?,?,?,?,?,?)");

        sql = dbClient.generatePlaceholders(1, 3);
        assert(sql === "(?),(?),(?)");
    });

    commonTesting(config);
});

describe("DBClient: should work with SQLiteJS", function() {
    let dbClient: DBClient | undefined;
    let config: {dbClient?: DBClient} = {};

    beforeEach("Open database and create tables", async function() {
        dbClient = new DBClient(await OpenSQLiteJS());
        config.dbClient = dbClient;
        await dbClient.all(`DROP TABLE IF EXISTS abc;`);
        await dbClient.all(`CREATE TABLE abc (a bytea NULL UNIQUE, b bigint NULL UNIQUE, c integer, d smallint)`);
    });

    afterEach("Close database", function() {
        dbClient?.close();
        dbClient = undefined;
        config.dbClient = undefined;
    });

    it("#getType", function() {
        assert(dbClient);
        assert(dbClient.getType() === "sqliteJS");
    });

    it("#generatePlaceholders", function() {
        assert(dbClient);

        let sql = dbClient.generatePlaceholders(10, 1);
        assert(sql === "(?,?,?,?,?,?,?,?,?,?)");

        sql = dbClient.generatePlaceholders(9, 2);
        assert(sql === "(?,?,?,?,?,?,?,?,?),(?,?,?,?,?,?,?,?,?)");

        sql = dbClient.generatePlaceholders(1, 3);
        assert(sql === "(?),(?),(?)");
    });

    commonTesting(config);
});

/**
 * Lesson learned is that postgres rollback whole execs if only part of the exec fails,
 * also that a pg connection needs a "breather" in such case before continuing,
 * otherwise is will throw.
 */
describe("DBClient: should work with PostgreSQL", function() {
    before(function() {
        if (process.env.PGHOST && process.env.PGPORT && process.env.PGUSER) {
            // Pass
        }
        else {
            this.skip();
            return;
        }
    });

    let dbClient: DBClient | undefined;
    let config: {dbClient?: DBClient} = {};

    beforeEach("Open database and create tables", async function() {
        dbClient = new DBClient(await OpenPG());
        config.dbClient = dbClient;

        for (let table in TABLES) {
            await dbClient.run(`DROP TABLE IF EXISTS ${table};`);
            for (let idx in TABLES[table].indexes) {
                await dbClient.run(`DROP INDEX IF EXISTS ${idx};`);
            }
        }

        await dbClient.all(`DROP TABLE IF EXISTS abc;`);
        await dbClient.all(`CREATE TABLE abc (a bytea NULL UNIQUE, b bigint NULL UNIQUE, c integer, d smallint)`);
    });

    afterEach("Close database", function() {
        dbClient?.close();
        dbClient = undefined;
        config.dbClient = undefined;
    });

    it("#getType", function() {
        assert(dbClient);
        assert(dbClient.getType() === "pg");
    });

    it("#generatePlaceholders", function() {
        assert(dbClient);

        let sql = dbClient.generatePlaceholders(10, 1);
        assert(sql === "($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)");

        sql = dbClient.generatePlaceholders(9, 2);
        assert(sql === "($1,$2,$3,$4,$5,$6,$7,$8,$9),($10,$11,$12,$13,$14,$15,$16,$17,$18)");

        sql = dbClient.generatePlaceholders(1, 3);
        assert(sql === "($1),($2),($3)");
    });

    commonTesting(config);
});

function commonTesting(config: {dbClient?: DBClient}) {
    it("#listTables", async function() {
        const dbClient = config.dbClient;

        assert(dbClient);

        const tables = await dbClient.listTables();

        assert(tables.length === 1);
        assert(tables[0] === "abc");
    });


    it("#each, #all, #get, #exec, #run", async function() {
        const dbClient = config.dbClient;

        assert(dbClient);

        let rows: any;

        // all()
        //
        rows = await dbClient.all("SELECT * FROM abc", []);
        assert(rows.length === 0);

        let ph = dbClient.generatePlaceholders(4, 2);


        // run()
        //
        await dbClient.run(`INSERT INTO abc (a,b,c,d) VALUES ${ph}`, [B("A1"), 1, 2, 3, B("A2"), 11, 22, 33]);

        // all()
        //
        rows = await dbClient.all("SELECT * FROM abc", []);
        assert(rows.length === 2);


        // get()
        //
        let row = await dbClient.get("SELECT * FROM abc", []);
        assert(row.a.equals(B("A1")));


        // each()
        //
        ph = dbClient.generatePlaceholders(2);
        let ph2 = dbClient.generatePlaceholders(1, 1, 3);

        let rowCount2 = 0;
        let rowCount = await dbClient.each(`SELECT * FROM abc WHERE a IN ${ph} OR b IN ${ph2};`,
            [B("A1"), B("A3"), 11], (row: any): any => {
            rowCount2++;
            assert(row.a.equals(B("A1")) || row.b === 11);
        });


        assert(rowCount === 2);
        assert(rowCount2 === 2);


        // each() with aborted cursor
        //
        ph = dbClient.generatePlaceholders(2);
        ph2 = dbClient.generatePlaceholders(1, 1, 3);

        rowCount2 = 0;
        rowCount = await dbClient.each(`SELECT * FROM abc WHERE a IN ${ph} OR b IN ${ph2};`,
            [B("A1"), B("A3"), 11], (row: any): boolean => {
            rowCount2++;
            assert(row.a.equals(B("A1")) || row.b === 11);
            return true;
        });


        assert(rowCount === 1);
        assert(rowCount2 === 1);

        // exec()
        //
        // NOTE: This is different between SQLite and Postgres.
        // In SQLite first row is inserted, second is not.
        // For PG none is inserted.
        await expectAsyncException(
            dbClient.exec("INSERT INTO abc (b) VALUES(12); INSERT INTO abc (b) VALUES(12);"),
            ["SQLITE_CONSTRAINT: UNIQUE constraint failed: abc.b", `duplicate key value violates unique constraint "abc_b_key"`,
                `UNIQUE constraint failed: abc.b`]);

        // This sleep is necessary or else a pg client will often fail on the next call,
        // due to the failed call above.
        await sleep(50);

        try {
            rows = await dbClient.all("SELECT * FROM abc", []);
            if (dbClient.getType() === "pg") {
                assert(rows.length === 2);
            }
            else {
                assert(rows.length === 3);
            }
        }
        catch(e) {
            //console.error("The following error can happen when a pg client is used directly after a fail", e);
            throw new Error(`This can happen when a pg client is used directly after a fail: ${e}`);
        }
    });
}

function B(s: string): Buffer {
    return Buffer.from(s);
}
