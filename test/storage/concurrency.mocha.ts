/**
 * Test that concurrency in the underlaying database behave as expected.
 */

import {
    assert,
} from "chai";

import {
    expectAsyncException,
} from "../util";

import {
    Driver,
    BlobDriver,
    NodeInterface,
    NodeUtil,
    sleep,
    BLOB_FRAGMENT_SIZE,
    DBClient,
    TABLES,
    DatabaseUtil,
} from "../../src";

import fs from "fs";

/**
 * A subclass wrapper to make protected functions publicly accessible.
 *
 */
class DriverTestWrapper extends Driver {
    public async insertNodes(nodes: NodeInterface[], now: number): Promise<void> {
        return super.insertNodes(nodes, now);
    }
}

class BlobDriverTestWrapper extends BlobDriver {
    public async writeBlobFragment(dataId: Buffer, fragment: Buffer, fragmentIndex: number) {
        return super.writeBlobFragment(dataId, fragment, fragmentIndex);
    }

    public async readBlobFragment(dataId: Buffer, fragmentIndex: number, onlyFinalized: boolean = false): Promise<Buffer | undefined> {
        return super.readBlobFragment(dataId, fragmentIndex, onlyFinalized);
    }

    public async readBlobIntermediaryLength(dataId: Buffer): Promise<number | undefined> {
        return super.readBlobIntermediaryLength(dataId);
    }
}
/**
 * What these tests shows us is that when we run SQLite in WAL-mode we can safely
 * run multiple concurrent and simultaneous read transaction which are isolated
 * from any ongoing and committed write transaction (also writes without tx),
 * which makes for no skewed data on reads.
 *
 * We also see that concurrent write transactions are not possible but will result
 * in SQLITE_BUSY exception ("canceling statement due to lock timeout" for Postgres).
 * We will serialize write transaction from Storage but still parallel write transaction
 * from other processes can appear so we need to be ready for busy exceptions still.
 * My feeling is that if we detect the busy exception on the first write in a transaction
 * and then retry until it passes through that should do it, or else fail on max retries issued.
 *
 * Queries can sometimes also yeild SQLITE_BUSY exceptions, these are avoided if we on each
 * creation of a connection make a simple read and detect this exception and retry until it passes
 * (https://www.sqlite.org/wal.html).
 *
 * WAL-mode is for the Driver which handles nodes, the BlobDriver does not require WAL-mode (but it is OK with it).
 */
describe("Concurrency: SQLite WAL-mode for concurrent Driver access", function() {
    const config: any = {};
    const dbName = "/tmp/sqlite-driver";
    let driver1: DriverTestWrapper | undefined;
    let driver2: DriverTestWrapper | undefined;
    let driver3: DriverTestWrapper | undefined;
    let db1: DBClient | undefined;
    let db2: DBClient | undefined;
    let db3: DBClient | undefined;
    let node0: NodeInterface | undefined;
    let node1: NodeInterface | undefined;
    let node2: NodeInterface | undefined;

    beforeEach("Open database and create tables", async function() {
        try {
            fs.unlinkSync(dbName);
            fs.unlinkSync(dbName + "-wal");
            fs.unlinkSync(dbName + "-shm");
        }
        catch(e) {}

        db1 = new DBClient(await DatabaseUtil.OpenSQLite(dbName));
        db2 = new DBClient(await DatabaseUtil.OpenSQLite(dbName));
        db3 = new DBClient(await DatabaseUtil.OpenSQLite(dbName));

        driver1 = new DriverTestWrapper(db1);
        driver2 = new DriverTestWrapper(db2);
        driver3 = new DriverTestWrapper(db3);

        await driver1.createTables();

        const nodeUtil = new NodeUtil();

        const now = Date.now();

        node0 = await nodeUtil.createLicenseNode({
            owner: Buffer.alloc(32).fill(16),
            id1: Buffer.alloc(32).fill(1),
            parentId: Buffer.alloc(32).fill(11),
            targetPublicKey: Buffer.alloc(32).fill(101),
            nodeId1: Buffer.alloc(32).fill(201),
            expireTime: now + 10000,
            creationTime: now,
        });

        // Same sharedHash as node0
        node1 = await nodeUtil.createLicenseNode({
            owner: Buffer.alloc(32).fill(16),
            id1: Buffer.alloc(32).fill(2),
            parentId: Buffer.alloc(32).fill(11),
            targetPublicKey: Buffer.alloc(32).fill(101),
            nodeId1: Buffer.alloc(32).fill(201),
            expireTime: now + 10000,
            creationTime: now + 1,
        });

        node2 = await nodeUtil.createLicenseNode({
            owner: Buffer.alloc(32).fill(16),
            id1: Buffer.alloc(32).fill(2),
            parentId: Buffer.alloc(32).fill(11),
            targetPublicKey: Buffer.alloc(32).fill(101),
            nodeId1: Buffer.alloc(32).fill(202),
            expireTime: now + 10000,
            creationTime: now + 1,
        });

        assert(node0.hashShared().equals(node1.hashShared()));
        assert(!node1.hashShared().equals(node2.hashShared()));

        config.db1 = db1;
        config.db2 = db2;
        config.db3 = db3;
        config.driver1 = driver1;
        config.driver2 = driver2;
        config.driver3 = driver3;
        config.node0 = node0;
        config.node1 = node1;
        config.node2 = node2;
    });

    afterEach("Close database", function() {
        db1?.close();
        db2?.close();
        db3?.close();
        db1 = undefined;
        db2 = undefined;
        db3 = undefined;
        driver1 = undefined;
        driver2 = undefined;
        driver3 = undefined;
        try {
            fs.unlinkSync(dbName);
            fs.unlinkSync(dbName + "-wal");
            fs.unlinkSync(dbName + "-shm");
        }
        catch(e) {}
    });

    setupDriverTests(config);
});

/**
 * Postgres is set to REPEATABLE READ to behave as SQLite's WAL-mode.
 * Verify that it behaves the same as SQLite in WAL-mode.
 */
describe("Concurrency: PostgreSQL REPEATABLE READ mode for concurrent Driver access", function() {
    before(function() {
        if (process.env.PGHOST && process.env.PGPORT && process.env.PGUSER) {
            // Pass
        }
        else {
            this.skip();
            return;
        }
    });

    const config: any = {};
    let driver1: DriverTestWrapper | undefined;
    let driver2: DriverTestWrapper | undefined;
    let driver3: DriverTestWrapper | undefined;
    let db1: DBClient | undefined;
    let db2: DBClient | undefined;
    let db3: DBClient | undefined;
    let node0: NodeInterface | undefined;
    let node1: NodeInterface | undefined;
    let node2: NodeInterface | undefined;

    beforeEach("Open database and create tables", async function() {
        db1 = new DBClient(await DatabaseUtil.OpenPG());
        db2 = new DBClient(await DatabaseUtil.OpenPG());
        db3 = new DBClient(await DatabaseUtil.OpenPG());

        driver1 = new DriverTestWrapper(db1);
        driver2 = new DriverTestWrapper(db2);
        driver3 = new DriverTestWrapper(db3);

        for (let table in TABLES) {
            await db1.run(`DROP TABLE IF EXISTS ${table};`);
            for (let idx in TABLES[table].indexes) {
                await db1.run(`DROP INDEX IF EXISTS ${idx};`);
            }
        }

        await driver1.createTables();

        const nodeUtil = new NodeUtil();

        const now = Date.now();

        node0 = await nodeUtil.createLicenseNode({
            owner: Buffer.alloc(32).fill(16),
            id1: Buffer.alloc(32).fill(1),
            parentId: Buffer.alloc(32).fill(11),
            targetPublicKey: Buffer.alloc(32).fill(101),
            nodeId1: Buffer.alloc(32).fill(201),
            expireTime: now + 10000,
            creationTime: now,
        });

        // Same sharedHash as node0
        node1 = await nodeUtil.createLicenseNode({
            owner: Buffer.alloc(32).fill(16),
            id1: Buffer.alloc(32).fill(2),
            parentId: Buffer.alloc(32).fill(11),
            targetPublicKey: Buffer.alloc(32).fill(101),
            nodeId1: Buffer.alloc(32).fill(201),
            expireTime: now + 10000,
            creationTime: now + 1,
        });

        node2 = await nodeUtil.createLicenseNode({
            owner: Buffer.alloc(32).fill(16),
            id1: Buffer.alloc(32).fill(2),
            parentId: Buffer.alloc(32).fill(11),
            targetPublicKey: Buffer.alloc(32).fill(101),
            nodeId1: Buffer.alloc(32).fill(202),
            expireTime: now + 10000,
            creationTime: now + 1,
        });

        assert(node0.hashShared().equals(node1.hashShared()));
        assert(!node1.hashShared().equals(node2.hashShared()));

        config.db1 = db1;
        config.db2 = db2;
        config.db3 = db3;
        config.driver1 = driver1;
        config.driver2 = driver2;
        config.driver3 = driver3;
        config.node0 = node0;
        config.node1 = node1;
        config.node2 = node2;
    });

    afterEach("Close database", function() {
        db1?.close();
        db2?.close();
        db3?.close();
        db1 = undefined;
        db2 = undefined;
        db3 = undefined;
        driver1 = undefined;
        driver2 = undefined;
        driver3 = undefined;
    });

    setupDriverTests(config);
});

function setupDriverTests(config: any) {
    /**
     * This example shows us that two concurrent write transaction will result
     * in one getting an SQLITE_BUSY exception, and after the first commits it can then write.
     *
     * However when using Postgres the initially failed transaction is now voided and cannot
     * continue.
     *
     * Lesson learned: if using Postgres and "canceling statement due to lock timeout" happens
     * then the transaction must be rollbacked and retried.
     *
     * In SQLite it is OK to try again after a SQLITE_BUSY within the same transaction.
     */
    it("Insert conflict on two connections using COMMIT", async function() {
        const db1 = config.db1;
        const db2 = config.db2;
        const driver1 = config.driver1;
        const driver2 = config.driver2;
        const node0 = config.node0;
        const node1 = config.node1;

        assert(db1);
        assert(db2);
        assert(driver1);
        assert(driver2);
        assert(node0);
        assert(node1);

        const now = Date.now();

        // Start the transactions in reverse,
        // what matters is which transaction proceeds first.
        //
        await db2.exec("BEGIN;");
        await db1.exec("BEGIN");

        await driver1.insertNodes([node0], now);

        await expectAsyncException(
            driver2.insertNodes([node1], now),
            ["SQLITE_BUSY: database is locked", "canceling statement due to lock timeout"]);

        await db1.exec("COMMIT");

        await expectAsyncException(
            driver2.insertNodes([node1], now),
            ["SQLITE_CONSTRAINT: UNIQUE constraint failed: universe_nodes.sharedhash",
                "current transaction is aborted, commands ignored until end of transaction block",
                `duplicate key value violates unique constraint "universe_nodes_sharedhash_key"`]);

        await db2.exec("ROLLBACK");
    });

    /**
     * This example shows us that two concurrent write transaction will result
     * in one getting an SQLITE_BUSY exception, and after the first rollbaks it can then write.
     *
     * However using Postgres we need to immediately rollback the tx of the failed insert
     * to clear some lingering things which could otherwise cause insert conflicts
     * and block other transactions from proceeding.
     *
     * Lesson learned: if a Postgres insert fails we need to rollback immediately.
     */
    it("Insert conflict on two connections using ROLLBACK", async function() {
        const db1 = config.db1;
        const db2 = config.db2;
        const driver1 = config.driver1;
        const driver2 = config.driver2;
        const driver3 = config.driver3;
        const node0 = config.node0;
        const node1 = config.node1;
        const node2 = config.node2;

        assert(db1);
        assert(db2);
        assert(driver1);
        assert(driver2);
        assert(driver3);
        assert(node0);
        assert(node1);
        assert(node2);

        const now = Date.now();

        // Start the transactions in reverse,
        // what matters is which transaction proceeds first.
        //
        await db2.exec("BEGIN");
        await db1.exec("BEGIN");

        await driver1.insertNodes([node0], now);

        await expectAsyncException(
            driver2.insertNodes([node1], now),
            ["SQLITE_BUSY: database is locked",
                "canceling statement due to lock timeout"]);

        await db1.exec("ROLLBACK");

        // Postgres requires us to rollback already otherwise the failed insert lingers
        // and will block the insert of node1.
        await db2.exec("ROLLBACK");

        await driver3.insertNodes([node1], now);
    });

    /**
     * This test show us that reading without using transaction can easily give result in skewed data as write transactions commmit.
     */
    it("Reading without transaction while ongoing write transaction should not result in skewed data until commited", async function() {
        const db1 = config.db1;
        const db2 = config.db2;
        const driver1 = config.driver1;
        const node0 = config.node0;

        assert(db1);
        assert(db2);
        assert(driver1);
        assert(node0);

        const now = Date.now();


        await db1.exec("BEGIN");

        await driver1.insertNodes([node0], now);

        let rows = await db2.all(`SELECT * FROM universe_nodes ORDER BY id1;`);
        assert(rows.length === 0);

        await db1.exec("COMMIT");

        rows = await db2.all(`SELECT * FROM universe_nodes ORDER BY id1;`);
        assert(rows.length === 1);
    });

    /**
     * This test shows us that if we always read within a read transaction we can be safe from getting skewed data
     * when write-transaction are simultaneously happening and also are committed while we are still reading.
     * Also we see that writes without transactions will also result in SQLITE_BUSY exception when there
     * is currently a write transaction live.
     */
    it("Reading within transaction while ongoing writes and also after completed write transaction should not result in skewed read data", async function() {
        const db1 = config.db1;
        const db2 = config.db2;
        const db3 = config.db3;
        const driver1 = config.driver1;
        const driver3 = config.driver3;
        const node0 = config.node0;
        const node1 = config.node1;

        assert(db1);
        assert(db2);
        assert(db3);
        assert(driver1);
        assert(driver3);
        assert(node0);
        assert(node1);

        const now = Date.now();


        await db2.exec("BEGIN;");
        await db1.exec("BEGIN;");

        // Write within transaction
        await driver1.insertNodes([node0], now);

        // Reading within transaction
        let rows = await db2.all(`SELECT * FROM universe_nodes ORDER BY id1;`);
        assert(rows.length === 0);

        // Reading without transaction but write tx is not comitted yet.
        rows = await db3.all(`SELECT * FROM universe_nodes ORDER BY id1;`);
        assert(rows.length === 0);

        // Try writing without using transaction while write transaction is currently in play.
        await expectAsyncException(
            driver3.insertNodes([node1], now),
            ["SQLITE_BUSY: database is locked", "canceling statement due to lock timeout"]);

        await db1.exec("COMMIT");

        // Reading within transaction, again.
        rows = await db2.all(`SELECT * FROM universe_nodes ORDER BY id1;`);
        assert(rows.length === 0);

        // Reading without transaction and write tx is now comitted.
        rows = await db3.all(`SELECT * FROM universe_nodes ORDER BY id1;`);
        assert(rows.length === 1);

        // Double checking
        rows = await db2.all(`SELECT * FROM universe_nodes ORDER BY id1;`);
        assert(rows.length === 0);

        await db2.exec("COMMIT");

        rows = await db2.all(`SELECT * FROM universe_nodes ORDER BY id1;`);
        assert(rows.length === 1);
    });

    /**
     * This test shows us that we cannot use distributed transactions in SQLite WAL-mode.
     * Meaning that all our write transaction on WAL-mode must be serialized, and in
     * addition to that across processes we must also manage SQLITE_BUSY exceptions properly.
     */
    it("Parallel (non-conflicting) insert transactions not supported", async function() {
        const db1 = config.db1;
        const db2 = config.db2;
        const driver1 = config.driver1;
        const driver2 = config.driver2;
        const node0 = config.node0;
        const node2 = config.node2;

        assert(db1);
        assert(db2);
        assert(driver1);
        assert(driver2);
        assert(node0);
        assert(node2);

        const now = Date.now();

        await db1.exec("BEGIN");
        await db2.exec("BEGIN");

        await driver1.insertNodes([node2], now),

        await expectAsyncException(
            driver2.insertNodes([node2], now),
            ["SQLITE_BUSY: database is locked", "canceling statement due to lock timeout"]);

        await db1.exec("COMMIT");
        await db2.exec("COMMIT");
    });

    /**
     * This test shows us that we could allow for concurrent reads using transactions
     * and each read has its own snapshot.
     */
    it("Parallel reads are supported and properly snapshotted in WAL-mode", async function() {
        const db1 = config.db1;
        const db2 = config.db2;
        const db3 = config.db3;
        const driver1 = config.driver1;
        const node0 = config.node0;

        assert(db1);
        assert(db2);
        assert(db3);
        assert(driver1);
        assert(node0);

        const now = Date.now();

        await db2.exec("BEGIN");
        await db3.exec("BEGIN");

        // This snapshots db2 before the write.
        let rows = await db2.all(`SELECT * FROM universe_nodes ORDER BY id1;`);
        assert(rows.length === 0);

        await driver1.insertNodes([node0], now);

        rows = await db2.all(`SELECT * FROM universe_nodes ORDER BY id1;`);
        assert(rows.length === 0);

        rows = await db3.all(`SELECT * FROM universe_nodes ORDER BY id1;`);
        assert(rows.length === 1);

        await db2.exec("COMMIT");

        rows = await db2.all(`SELECT * FROM universe_nodes ORDER BY id1;`);
        assert(rows.length === 1);
    });
}

/**
 * For the blob driver we are interested in as high throughput as possible
 * and since the writes are very simple and have few relationsships
 * the journalling mode is our choice to reach highest througput.
 *
 * 1. We want to see that concurrent reads are possible.
 * 2. We want to see that concurrent writes are possible (race conditions apply).
 * 3. However, we also want to be able to block writes using a write transaction,
 *    but reads should not be blocked.
 */
describe("Concurrency: SQLite journalling mode for concurrent BlobDriver access", function() {
    const dbName = "/tmp/sqlite-blob";
    let driver1: BlobDriverTestWrapper | undefined;
    let driver2: BlobDriverTestWrapper | undefined;
    let db1: DBClient | undefined;
    let db2: DBClient | undefined;
    let config: any = {};

    beforeEach("Open database and create tables", async function() {
        try {
            fs.unlinkSync(dbName);
            fs.unlinkSync(dbName + "-wal");
            fs.unlinkSync(dbName + "-shm");
        }
        catch(e) {}

        db1 = new DBClient(await DatabaseUtil.OpenSQLite(dbName, false));
        db2 = new DBClient(await DatabaseUtil.OpenSQLite(dbName, false));

        driver1 = new BlobDriverTestWrapper(db1);
        driver2 = new BlobDriverTestWrapper(db2);

        config.db1 = db1;
        config.db2 = db2;
        config.driver1 = driver1;
        config.driver2 = driver2;

        await driver1.createTables();
    });

    afterEach("Close database", function() {
        db1?.close();
        db2?.close();
        db1 = undefined;
        db2 = undefined;
        driver1 = undefined;
        driver2 = undefined;
        try {
            fs.unlinkSync(dbName);
        }
        catch(e) {}
    });

    setupBlobDriverTests(config);
});

describe("Concurrency: PostgreSQL READ COMMITTED mode for concurrent BlobDriver access", function() {
    before(function() {
        if (process.env.PGHOST && process.env.PGPORT && process.env.PGUSER) {
            // Pass
        }
        else {
            this.skip();
            return;
        }
    });

    const config: any = {};
    let driver1: BlobDriverTestWrapper | undefined;
    let driver2: BlobDriverTestWrapper | undefined;
    let db1: DBClient | undefined;
    let db2: DBClient | undefined;
    let db3: DBClient | undefined;

    beforeEach("Open database and create tables", async function() {
        db1 = new DBClient(await DatabaseUtil.OpenPG(undefined, false));  // Open in READ COMMITTED mode
        db2 = new DBClient(await DatabaseUtil.OpenPG(undefined, false));  // Open in READ COMMITTED mode

        driver1 = new BlobDriverTestWrapper(db1);
        driver2 = new BlobDriverTestWrapper(db2);

        for (let table in TABLES) {
            await db1.run(`DROP TABLE IF EXISTS ${table};`);
            for (let idx in TABLES[table].indexes) {
                await db1.run(`DROP INDEX IF EXISTS ${idx};`);
            }
        }

        await driver1.createTables();

        config.db1 = db1;
        config.db2 = db2;
        config.driver1 = driver1;
        config.driver2 = driver2;
    });

    afterEach("Close database", function() {
        db1?.close();
        db2?.close();
        db1 = undefined;
        db2 = undefined;
        driver1 = undefined;
        driver2 = undefined;
    });

    setupBlobDriverTests(config);
});

function setupBlobDriverTests(config: any) {
    /**
     * In this test we see that concurrent writes are subject to race conditions.
     */
    it("Concurrent writes are OK but are subject to race conditions", async function() {
        const driver1 = config.driver1;
        const driver2 = config.driver2;
        const db1 = config.db1;
        const db2 = config.db2;

        assert(driver1);
        assert(driver2);
        assert(db1);
        assert(db2);

        const dataId = Buffer.alloc(32).fill(101);
        let fragment1 = Buffer.alloc(BLOB_FRAGMENT_SIZE).fill(1);
        let fragment2 = Buffer.alloc(BLOB_FRAGMENT_SIZE).fill(2);
        let fragmentIndex = 0;

        let p1: Promise<any> | undefined;
        let p2: Promise<any> | undefined;

        p1 = driver1.writeBlobFragment(dataId, fragment1, fragmentIndex);
        p2 = driver2.writeBlobFragment(dataId, fragment2, fragmentIndex);

        await p1;
        await p2;

        const ph = db1.generatePlaceholders(1);

        let rows = await db1.all(`SELECT fragment FROM universe_blob_data WHERE dataid=${ph};`, [dataId]);

        assert(rows.length === 1);
        // Most often it equals fragment2, but not always.
        assert(rows[0].fragment.equals(fragment2) || rows[0].fragment.equals(fragment1));

        p1 = driver1.writeBlobFragment(dataId, fragment1, fragmentIndex);
        p2 = db2.all(`SELECT fragment FROM universe_blob_data WHERE dataid=${ph};`, [dataId]);
        await sleep(1);
        const p3 = db2.all(`SELECT fragment FROM universe_blob_data WHERE dataid=${ph};`, [dataId]);

        rows = await p2;
        let rows2 = await p3;
        await p1;

        assert(rows.length === 1);
        // Both can happen.
        assert(rows[0].fragment.equals(fragment1) || rows[0].fragment.equals(fragment2));

        assert(rows2.length === 1);
        // Both can happen.
        assert(rows2[0].fragment.equals(fragment1) || rows2[0].fragment.equals(fragment2));
    });


    /**
     * In this test we show that a write transaction block other writes while allowing reads.
     */
    it("Write transaction should block other writes but not reads", async function() {
        const driver1 = config.driver1;
        const driver2 = config.driver2;
        const db1 = config.db1;
        const db2 = config.db2;

        assert(driver1);
        assert(driver2);
        assert(db1);
        assert(db2);

        const dataId = Buffer.alloc(32).fill(101);
        let fragment1 = Buffer.alloc(BLOB_FRAGMENT_SIZE).fill(1);
        let fragment2 = Buffer.alloc(BLOB_FRAGMENT_SIZE).fill(2);
        let fragmentIndex = 0;

        await db1.exec("BEGIN");

        // tx on db1 has not proceeded yet so it doesn't block.
        await driver2.writeBlobFragment(dataId, fragment1, fragmentIndex),

        await driver1.writeBlobFragment(dataId, fragment1, fragmentIndex);

        const ph = db1.generatePlaceholders(1);

        let rows = await db1.all(`SELECT fragment FROM universe_blob_data WHERE dataid=${ph};`, [dataId]);

        rows = await db2.all(`SELECT fragment FROM universe_blob_data WHERE dataid=${ph};`, [dataId]);

        await expectAsyncException(
            driver2.writeBlobFragment(dataId, fragment1, fragmentIndex),
            ["SQLITE_BUSY: database is locked", "canceling statement due to lock timeout"]);

        await db1.exec("COMMIT");

        await driver2.writeBlobFragment(dataId, fragment2, fragmentIndex);
    });
}
