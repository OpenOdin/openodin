import {
    assert,
} from "chai";

import {
    expectAsyncException,
} from "../util";

import {
    Driver,
    NodeInterface,
    InsertAchillesHash,
    InsertLicenseeHash,
    InsertDestroyHash,
    InsertFriendCert,
    NodeUtil,
    CertUtil,
    DBClient,
    TABLES,
    sleep,
    SPECIAL_NODES,
    StorageUtil,
    FetchQuery,
    FetchReplyData,
    Data,
    QueryProcessor,
    FetchRequest,
    DatabaseUtil,
} from "../../src";

/**
 * A subclass wrapper to make protected functions accessible publicly.
 *
 */
class DriverTestWrapper extends Driver {
    public async freshenParentTrail(parentIds: Buffer[], now: number) {
        return super.freshenParentTrail(parentIds, now);
    }

    public async filterDestroyed(nodes: NodeInterface[]): Promise<NodeInterface[]> {
        return super.filterDestroyed(nodes);
    }

    public async filterExisting(nodes: NodeInterface[], preserveTransient: boolean = false):
        Promise<NodeInterface[]> {
        return super.filterExisting(nodes, preserveTransient);
    }

    public async filterUnique(nodes: NodeInterface[]): Promise<NodeInterface[]> {
        return super.filterUnique(nodes);
    }

    public async insertAchillesHashes(achillesHashes: InsertAchillesHash[]): Promise<void> {
        return super.insertAchillesHashes(achillesHashes);
    }

    public async insertLicenseeHashes(licenseeHashes: InsertLicenseeHash[]): Promise<void> {
        return super.insertLicenseeHashes(licenseeHashes);
    }

    public async insertDestroyHashes(destroyHashes: InsertDestroyHash[]): Promise<void> {
        return super.insertDestroyHashes(destroyHashes);
    }

    public async insertFriendCerts(friendCerts: InsertFriendCert[]): Promise<void> {
        return super.insertFriendCerts(friendCerts);
    }

    public async insertNodes(nodes: NodeInterface[], now: number, preserveTransient: boolean = false): Promise<void> {
        return super.insertNodes(nodes, now, preserveTransient);
    }

    protected async storeNodes(nodes: NodeInterface[], now: number, preserveTransient: boolean = false) {
        return super.storeNodes(nodes, now, preserveTransient);
    }

    public async getNodeById1(id1: Buffer, now: number): Promise<NodeInterface | undefined> {
        return super.getNodeById1(id1, now);
    }

    public async getRootNode(fetchQuery: FetchQuery, now: number): Promise<[NodeInterface | undefined, FetchReplyData | undefined]> {
        return super.getRootNode(fetchQuery, now);
    }
}

/**
 * Unit test each function in the Driver.
 */
describe("Driver: SQLite WAL-mode", function() {
    let driver: DriverTestWrapper | undefined;
    let db: DBClient | undefined;
    const config: any = {};

    beforeEach("Open database and create tables", async function() {
        db = new DBClient(await DatabaseUtil.OpenSQLite());
        driver = new DriverTestWrapper(db);

        config.db = db;
        config.driver = driver;

        for (let table in TABLES) {
            await db.run(`DROP TABLE IF EXISTS ${table};`);
            for (let idx in TABLES[table].indexes) {
                await db.run(`DROP INDEX IF EXISTS ${idx};`);
            }
        }

        await driver.createTables();
    });

    afterEach("Close database", function() {
        db?.close();
        db = undefined;
        driver = undefined;
        config.db = undefined;
        config.driver = undefined;
    });

    setupDriverTests(config);
});

describe("Driver: SQLiteJS WAL-mode", function() {
    let driver: DriverTestWrapper | undefined;
    let db: DBClient | undefined;
    const config: any = {};

    beforeEach("Open database and create tables", async function() {
        db = new DBClient(await DatabaseUtil.OpenSQLiteJS());
        driver = new DriverTestWrapper(db);

        config.db = db;
        config.driver = driver;

        for (let table in TABLES) {
            await db.run(`DROP TABLE IF EXISTS ${table};`);
            for (let idx in TABLES[table].indexes) {
                await db.run(`DROP INDEX IF EXISTS ${idx};`);
            }
        }

        await driver.createTables();
    });

    afterEach("Close database", function() {
        db?.close();
        db = undefined;
        driver = undefined;
        config.db = undefined;
        config.driver = undefined;
    });

    setupDriverTests(config);
});

describe("Driver: PostgreSQL REPEATABLE READ mode", function() {
    before(function() {
        if (process.env.PGHOST && process.env.PGPORT && process.env.PGUSER) {
            // Pass
        }
        else {
            this.skip();
            return;
        }
    });

    let driver: DriverTestWrapper | undefined;
    let db: DBClient | undefined;
    const config: any = {};

    beforeEach("Open database and create tables", async function() {
        db = new DBClient(await DatabaseUtil.OpenPG());
        driver = new DriverTestWrapper(db);

        config.db = db;
        config.driver = driver;

        for (let table in TABLES) {
            await db.run(`DROP TABLE IF EXISTS ${table};`);
            for (let idx in TABLES[table].indexes) {
                await db.run(`DROP INDEX IF EXISTS ${idx};`);
            }
        }

        await driver.createTables();
    });

    afterEach("Close database", function() {
        db?.close();
        db = undefined;
        driver = undefined;
        config.db = undefined;
        config.driver = undefined;
    });

    setupDriverTests(config);
});

function setupDriverTests(config: any) {

    it("#insertAchillesHashes", async function() {
        const driver = config.driver;
        const db = config.db;

        assert(driver);
        assert(db);

        let achillesHashes: InsertAchillesHash[] = [];

        const nodeId1A = Buffer.alloc(32).fill(1);
        const hashA = Buffer.alloc(32).fill(201);

        const nodeId1B = Buffer.alloc(32).fill(2);
        const hashB = Buffer.alloc(32).fill(202);

        achillesHashes.push({
            id1: nodeId1A,
            hash: hashA
        });

        achillesHashes.push({
            id1: nodeId1B,
            hash: hashB
        });

        await driver.insertAchillesHashes(achillesHashes);

        let rows = await db.all(`SELECT * FROM universe_achilles_hashes ORDER BY id1;`);

        assert(rows.length === 2);
        assert(rows[0].id1.equals(nodeId1A));
        assert(rows[0].hash.equals(hashA));

        assert(rows[1].id1.equals(nodeId1B));
        assert(rows[1].hash.equals(hashB));
    });

    it("#insertLicenseeHashes", async function() {
        const driver = config.driver;
        const db = config.db;

        assert(driver);
        assert(db);

        let licenseeHashes: InsertLicenseeHash[] = [];

        const nodeId1A = Buffer.alloc(32).fill(1);
        const hashA = Buffer.alloc(32).fill(201);

        const nodeId1B = Buffer.alloc(32).fill(2);
        const hashB = Buffer.alloc(32).fill(202);

        licenseeHashes.push({
            id1: nodeId1A,
            hash: hashA,
            disallowretrolicensing: 0,
            parentpathhash: undefined,
            restrictivemodewriter: 0,
            restrictivemodemanager: 0,
        });

        licenseeHashes.push({
            id1: nodeId1B,
            hash: hashB,
            disallowretrolicensing: 0,
            parentpathhash: undefined,
            restrictivemodewriter: 0,
            restrictivemodemanager: 0,
        });

        await driver.insertLicenseeHashes(licenseeHashes);

        let rows = await db.all(`SELECT * FROM universe_licensee_hashes ORDER BY id1;`);

        assert(rows.length === 2);
        assert(rows[0].id1.equals(nodeId1A));
        assert(rows[0].hash.equals(hashA));

        assert(rows[1].id1.equals(nodeId1B));
        assert(rows[1].hash.equals(hashB));
    });

    it("#insertDestroyHashes", async function() {
        const driver = config.driver;
        const db = config.db;

        assert(driver);
        assert(db);

        let destroyHashes: InsertDestroyHash[] = [];

        const nodeId1A = Buffer.alloc(32).fill(1);
        const hashA = Buffer.alloc(32).fill(201);

        const nodeId1B = Buffer.alloc(32).fill(2);
        const hashB = Buffer.alloc(32).fill(202);

        destroyHashes.push({
            id1: nodeId1A,
            hash: hashA
        });

        destroyHashes.push({
            id1: nodeId1B,
            hash: hashB
        });

        await driver.insertDestroyHashes(destroyHashes);

        let rows = await db.all(`SELECT * FROM universe_destroy_hashes ORDER BY id1;`);

        assert(rows.length === 2);
        assert(rows[0].id1.equals(nodeId1A));
        assert(rows[0].hash.equals(hashA));

        assert(rows[1].id1.equals(nodeId1B));
        assert(rows[1].hash.equals(hashB));
    });

    it("#insertFriendCerts", async function() {
        const driver = config.driver;
        const db = config.db;

        assert(driver);
        assert(db);

        let friendCerts: InsertFriendCert[] = [];

        const nodeId1A = Buffer.alloc(32).fill(1);
        const issuerA = Buffer.alloc(32).fill(101);
        const constraintsA = Buffer.alloc(32).fill(201);
        const imageA = Buffer.alloc(32).fill(251);

        const nodeId1B = Buffer.alloc(32).fill(2);
        const issuerB = Buffer.alloc(32).fill(102);
        const constraintsB = Buffer.alloc(32).fill(202);
        const imageB = Buffer.alloc(32).fill(252);


        friendCerts.push({
            id1: nodeId1A,
            issuer: issuerA,
            constraints: constraintsA,
            image: imageA,
        });

        friendCerts.push({
            id1: nodeId1B,
            issuer: issuerB,
            constraints: constraintsB,
            image: imageB,
        });

        await driver.insertFriendCerts(friendCerts);

        let rows = await db.all(`SELECT * FROM universe_friend_certs ORDER BY id1;`);

        assert(rows.length === 2);
        assert(rows[0].id1.equals(nodeId1A));
        assert(rows[0].issuer.equals(issuerA));
        assert(rows[0].constraints.equals(constraintsA));
        assert(rows[0].image.equals(imageA));

        assert(rows[1].id1.equals(nodeId1B));
        assert(rows[1].issuer.equals(issuerB));
        assert(rows[1].constraints.equals(constraintsB));
        assert(rows[1].image.equals(imageB));
    });

    it("#insertNodes, #filterExisting", async function() {
        const driver = config.driver;
        const db = config.db;

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();

        const now = Date.now();

        const node0 = await nodeUtil.createDataNode({
            owner: Buffer.alloc(32).fill(16),
            id1: Buffer.alloc(32).fill(1),
            id2: undefined,
            parentId: Buffer.alloc(32).fill(11),
            expireTime: now + 10000,
            creationTime: now,
        });

        const node1 = await nodeUtil.createDataNode({
            owner: Buffer.alloc(32).fill(16),
            id1: Buffer.alloc(32).fill(2),
            id2: Buffer.alloc(32).fill(22),
            parentId: Buffer.alloc(32).fill(12),
            expireTime: now + 10001,
            creationTime: now+1,
        });

        const node2 = await nodeUtil.createDataNode({
            owner: Buffer.alloc(32).fill(16),
            id1: Buffer.alloc(32).fill(3),
            id2: Buffer.alloc(32).fill(23),
            parentId: Buffer.alloc(32).fill(13),
            expireTime: now + 10002,
            creationTime: now+2,
        });

        const nodes: NodeInterface[] = [
            node0,
            node1,
        ];

        await driver.insertNodes(nodes, now);

        let rows = await db.all(`SELECT id1, id2, id, parentid, creationtime, expiretime,
            transienthash, sharedhash, image
            FROM universe_nodes ORDER BY id1;`);

        assert(rows.length === 2);

        assert(rows[0].id1.equals(nodes[0].getId1() as Buffer));
        assert(rows[0].id2 === null);
        assert(rows[0].id.equals(nodes[0].getId() as Buffer));
        assert(rows[0].parentid.equals(nodes[0].getParentId() as Buffer));
        assert(parseInt(rows[0].expiretime) === now + 10000);
        assert(parseInt(rows[0].creationtime) === now);
        assert(rows[0].sharedhash.equals(nodes[0].hashShared()));
        assert(rows[0].transienthash.equals(nodes[0].hashTransient()));
        assert(rows[0].image.equals(nodes[0].export()));

        assert(rows[1].id1.equals(nodes[1].getId1() as Buffer));
        assert(rows[1].id2.equals(nodes[1].getId2() as Buffer));
        assert(rows[1].id.equals(nodes[1].getId() as Buffer));
        assert(rows[1].parentid.equals(nodes[1].getParentId() as Buffer));
        assert(parseInt(rows[1].expiretime) === now + 10001);
        assert(parseInt(rows[1].creationtime) === now + 1);
        assert(rows[1].sharedhash.equals(nodes[1].hashShared()));
        assert(rows[1].transienthash.equals(nodes[1].hashTransient()));
        assert(rows[1].image.equals(nodes[1].export()));


        // #filterExisting
        //

        // Change the transient hash.
        node1.setDynamicSelfActive();

        let nodes3 = await driver.filterExisting([node0, node1, node2]);

        assert(nodes3.length === 1);
        assert((nodes3[0].getId1() as Buffer).equals(node2.getId1() as Buffer));

        // Now also detect transient hash changes as non-existing.
        nodes3 = await driver.filterExisting([node0, node1, node2], true);

        assert(nodes3.length === 2);
        assert((nodes3[0].getId1() as Buffer).equals(node1.getId1() as Buffer));
        assert((nodes3[1].getId1() as Buffer).equals(node2.getId1() as Buffer));
    });

    it("#filterDestroyed", async function() {
        const driver = config.driver;
        const db = config.db;

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();

        const now = Date.now();

        const node0 = await nodeUtil.createDataNode({
            owner: Buffer.alloc(32).fill(16),
            id1: Buffer.alloc(32).fill(1),
            id2: undefined,
            parentId: Buffer.alloc(32).fill(11),
            expireTime: now + 10000,
            creationTime: now,
        });

        const node1 = await nodeUtil.createDataNode({
            owner: Buffer.alloc(32).fill(16),
            id1: Buffer.alloc(32).fill(2),
            id2: Buffer.alloc(32).fill(22),
            parentId: Buffer.alloc(32).fill(12),
            expireTime: now + 10001,
            creationTime: now+1,
        });

        const node2 = await nodeUtil.createDataNode({
            owner: Buffer.alloc(32).fill(16),
            id1: Buffer.alloc(32).fill(3),
            id2: Buffer.alloc(32).fill(23),
            parentId: Buffer.alloc(32).fill(13),
            expireTime: now + 10002,
            creationTime: now+2,
            isIndestructible: true,
        });

        let achillesHashes = node0.getAchillesHashes();
        assert(achillesHashes.length === 2);

        achillesHashes = node1.getAchillesHashes();
        assert(achillesHashes.length === 2);

        achillesHashes = node2.getAchillesHashes();
        assert(achillesHashes.length === 0);

        await driver.insertNodes([node0, node1, node2], now);

        let nodes = await driver.filterDestroyed([node0, node1, node2]);
        assert(nodes.length === 3);

        let destroyHashes: InsertDestroyHash[] = [];

        achillesHashes = node0.getAchillesHashes();

        achillesHashes.forEach( hash => {
            destroyHashes.push({
                id1: node0.getId1() as Buffer,
                hash: hash,
            });
        });

        await driver.insertDestroyHashes(destroyHashes);

        nodes = await driver.filterDestroyed([node0, node1, node2]);
        assert(nodes.length === 2);


        destroyHashes = [];

        achillesHashes = node1.getAchillesHashes();

        destroyHashes.push({
            id1: node1.getId1() as Buffer,
            hash: achillesHashes[0],
        });

        await driver.insertDestroyHashes(destroyHashes);

        nodes = await driver.filterDestroyed([node0, node1, node2]);
        assert(nodes.length === 1);


        let allHashes: Buffer[] = [];
        allHashes.push(...node0.getAchillesHashes());
        allHashes.push(...node1.getAchillesHashes());
        assert(allHashes.length === 4);

        const ph = db.generatePlaceholders(allHashes.length);

        const sql = `SELECT COUNT(dh.hash) as count, nodes.id1 AS id1
            FROM universe_destroy_hashes AS dh, universe_nodes as nodes
            WHERE dh.hash IN ${ph} AND dh.id1 = nodes.id1 GROUP BY nodes.id1;`;

        const rows = await db.all(sql, allHashes);

        assert(rows.length === 2);
        assert(rows[0].count === 2);
        assert(rows[1].count === 1);
    });

    it("#filterUnique", async function() {
        const driver = config.driver;
        const db = config.db;

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();

        const now = Date.now();

        // License nodes are by default flagged as unique.
        //
        const node0 = await nodeUtil.createLicenseNode({
            owner: Buffer.alloc(32).fill(16),
            id1: Buffer.alloc(32).fill(1),
            parentId: Buffer.alloc(32).fill(11),
            targetPublicKey: Buffer.alloc(32).fill(101),
            nodeId1: Buffer.alloc(32).fill(201),
            expireTime: now + 10000,
            creationTime: now,
        });

        // Same sharedHash as node0
        const node1 = await nodeUtil.createLicenseNode({
            owner: Buffer.alloc(32).fill(16),
            id1: Buffer.alloc(32).fill(2),
            parentId: Buffer.alloc(32).fill(11),
            targetPublicKey: Buffer.alloc(32).fill(101),
            nodeId1: Buffer.alloc(32).fill(201),
            expireTime: now + 10000,
            creationTime: now + 1,
        });

        // Different sharedHash
        const node2 = await nodeUtil.createLicenseNode({
            owner: Buffer.alloc(32).fill(16),
            id1: Buffer.alloc(32).fill(2),
            parentId: Buffer.alloc(32).fill(11),
            targetPublicKey: Buffer.alloc(32).fill(101),
            nodeId1: Buffer.alloc(32).fill(202),
            expireTime: now + 10000,
            creationTime: now,
        });

        assert(node0.hashShared().equals(node1.hashShared()));
        assert(!node0.hashShared().equals(node2.hashShared()));

        await driver.insertNodes([node0], now);

        let rows = await db.all(`SELECT id1 FROM universe_nodes ORDER BY id1;`);

        assert(rows.length === 1);
        assert(rows[0].id1.equals(node0.getId1() as Buffer));

        await expectAsyncException(
            driver.insertNodes([node1], now),
            ["SQLITE_CONSTRAINT: UNIQUE constraint failed: universe_nodes.sharedhash",
                `duplicate key value violates unique constraint "universe_nodes_sharedhash_key"`,
                `UNIQUE constraint failed: universe_nodes.sharedhash`]);

        // postgres-client sometimes need a little breather after insert rejections.
        await sleep(50);


        // node0 is already inserted but will still be returned
        // since it is the stored node with the shared hash.
        let nodes = await driver.filterUnique([node0, node1, node2]);

        assert(nodes.length === 2);
        assert(nodes[0].getId1().equals(node0.getId1()));
        assert(nodes[1].getId1().equals(node2.getId1()));
    });

    it("#storeNodes, #delete", async function() {
        const driver = config.driver;
        const db = config.db;

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const certUtil = new CertUtil();

        const now = Date.now();

        const node0 = await nodeUtil.createDataNode({
            owner: Buffer.alloc(32).fill(100),
            id1: Buffer.alloc(32).fill(1),
            id2: undefined,
            parentId: Buffer.alloc(32).fill(11),
            expireTime: now + 10000,
            creationTime: now,
        });

        const friendCert = await certUtil.createFriendCert({
            owner: Buffer.alloc(32).fill(121),
            constraints: Buffer.alloc(32).fill(201),
            signature: Buffer.alloc(64),
        });

        const node1 = await nodeUtil.createDataNode({
            owner: Buffer.alloc(32).fill(100),
            id1: Buffer.alloc(32).fill(2),
            id2: Buffer.alloc(32).fill(22),
            parentId: Buffer.alloc(32).fill(12),
            expireTime: now + 10001,
            creationTime: now+1,
            isSpecial: true,
            embedded: friendCert.export(),
            contentType: SPECIAL_NODES.FRIENDCERT,
        });

        const node2 = await nodeUtil.createDataNode({
            owner: Buffer.alloc(32).fill(100),
            id1: Buffer.alloc(32).fill(3),
            id2: Buffer.alloc(32).fill(23),
            parentId: Buffer.alloc(32).fill(13),
            expireTime: now + 10002,
            creationTime: now+2,
            isIndestructible: true,
            isSpecial: true,
            contentType: SPECIAL_NODES.DESTROYNODE,
            refId: node1.getId1(),
        });

        assert(node2.isSpecial());

        const license0 = await nodeUtil.createLicenseNode({
            owner: Buffer.alloc(32).fill(101),
            id1: Buffer.alloc(32).fill(10),
            parentId: Buffer.alloc(32).fill(11),
            targetPublicKey: Buffer.alloc(32).fill(101),
            nodeId1: Buffer.alloc(32).fill(202),
            expireTime: now + 10000,
            creationTime: now,
        });


        await driver.storeNodes([node0, node1, node2, license0], now);

        const sqlDestroy = `SELECT COUNT(dh.hash) as count, nodes.id1 AS id1
            FROM universe_destroy_hashes AS dh, universe_nodes as nodes
            WHERE dh.id1 = nodes.id1 GROUP BY nodes.id1;`;

        let rows = await db.all(sqlDestroy);

        assert(rows.length === 1);
        assert(rows[0].count === 1);
        assert(rows[0].id1.equals(node2.getId1()));


        rows = await db.all(`SELECT * FROM universe_achilles_hashes ORDER BY id1;`);

        assert(rows.length === 9);

        rows = await db.all(`SELECT * FROM universe_licensee_hashes ORDER BY id1;`);

        assert(rows.length === 4);

        rows = await db.all(`SELECT * FROM universe_friend_certs ORDER BY id1;`);

        assert(rows.length === 1);

        // #delete
        //

        let ph = db.generatePlaceholders(1);
        rows = await db.all(`SELECT * FROM universe_nodes WHERE id1=${ph}`, [node0.getId1()]);
        assert(rows.length === 1);

        rows = await db.all(`SELECT * FROM universe_achilles_hashes WHERE id1=${ph}`, [node0.getId1()]);
        assert(rows.length === 2);

        await driver.deleteNodes([node0.getId1()]);

        rows = await db.all(`SELECT * FROM universe_nodes WHERE id1=${ph}`, [node0.getId1()]);
        assert(rows.length === 0);

        rows = await db.all(`SELECT * FROM universe_achilles_hashes WHERE id1=${ph}`, [node0.getId1()]);
        assert(rows.length === 0);



        rows = await db.all(`SELECT * FROM universe_licensee_hashes WHERE id1=${ph}`, [license0.getId1()]);
        assert(rows.length === 4);

        await driver.deleteNodes([license0.getId1()]);

        rows = await db.all(`SELECT * FROM universe_licensee_hashes WHERE id1=${ph}`, [license0.getId1()]);
        assert(rows.length === 0);



        rows = await db.all(sqlDestroy);
        assert(rows.length === 1);

        await driver.deleteNodes([node2.getId1()]);

        rows = await db.all(sqlDestroy);
        assert(rows.length === 0);

        await driver.deleteNodes([node1.getId1()]);

        rows = await db.all(`SELECT * FROM universe_friend_certs WHERE id1=${ph}`, [node1.getId1()]);
        assert(rows.length === 0);
    });

    it("#getNodeById1 also with transient values", async function() {
        const driver = config.driver;
        const db = config.db;

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const certUtil = new CertUtil();

        const now = Date.now();

        const node0 = await nodeUtil.createDataNode({
            owner: Buffer.alloc(32).fill(100),
            id1: Buffer.alloc(32).fill(1),
            id2: undefined,
            parentId: Buffer.alloc(32).fill(11),
            expireTime: now + 10000,
            creationTime: now,
        });

        let oldTransientHash = node0.hashTransient();

        let node = await driver.getNodeById1(node0.getId1(), 1);
        assert(!node);

        // Store
        //
        let result = await driver.store([node0], now);
        assert(result[0].length === 1);
        assert(result[1].length === 1);
        assert(result[0][0].equals(node0.getId1()));
        assert(result[1][0].equals(node0.getParentId()));

        let ph = db.generatePlaceholders(1);
        let rows = await db.all(`SELECT * FROM universe_nodes WHERE id1=${ph}`, [node0.getId1()]);
        assert(rows.length === 1);
        assert(rows[0].image.equals(node0.export()));
        assert(rows[0].transienthash.equals(oldTransientHash));
        assert(rows[0].storagetime === now);

        // getNodeById1
        //

        node = await driver.getNodeById1(node0.getId1(), 1);
        assert(node);
        assert(node !== node0);
        assert(node.getId1().equals(node0.getId1()));
        assert(node.hashTransient().equals(node0.hashTransient()));
        assert(!node.isDynamicSelfActive());


        // update transient values, store again, expect no changes.
        //
        node0.setDynamicSelfActive();
        assert(!node.hashTransient().equals(node0.hashTransient()));

        result = await driver.store([node0], now + 1);
        assert(result[0].length === 0);

        ph = db.generatePlaceholders(1);
        rows = await db.all(`SELECT * FROM universe_nodes WHERE id1=${ph}`, [node0.getId1()]);
        assert(rows.length === 1);
        assert(rows[0].image.equals(node0.export()));
        assert(rows[0].transienthash.equals(oldTransientHash));
        assert(!rows[0].transienthash.equals(node0.hashTransient()));


        node = await driver.getNodeById1(node0.getId1(), 1);
        assert(node);
        assert(node !== node0);
        assert(node.getId1().equals(node0.getId1()));
        assert(!node.hashTransient().equals(node0.hashTransient()));
        assert(node.hashTransient().equals(oldTransientHash));
        assert(node.getTransientStorageTime() === now);
        assert(!node.isDynamicSelfActive());

        // Store and update transient hash
        //
        result = await driver.store([node0], now + 1, true);
        assert(result[0].length === 1);
        assert(result[1].length === 1);
        assert(result[0][0].equals(node0.getId1()));
        assert(result[1][0].equals(node0.getParentId()));


        ph = db.generatePlaceholders(1);
        rows = await db.all(`SELECT * FROM universe_nodes WHERE id1=${ph}`, [node0.getId1()]);
        assert(rows.length === 1);
        assert(!rows[0].transienthash.equals(oldTransientHash));
        assert(rows[0].image.equals(node0.export(true)));
        assert(rows[0].transienthash.equals(node0.hashTransient()));

        node = await driver.getNodeById1(node0.getId1(), 1);
        assert(node);
        assert(node !== node0);
        assert(node.getId1().equals(node0.getId1()));
        assert(node.hashTransient().equals(node0.hashTransient()));
        assert(!node.hashTransient().equals(oldTransientHash));
        assert(node.getTransientStorageTime() === now);
        assert(node.isDynamicSelfActive());
    });

    it("#getRootNode", async function() {
        const driver = config.driver;
        const db = config.db;

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const certUtil = new CertUtil();

        const now = Date.now();

        let clientPublicKey = Buffer.alloc(32).fill(110);
        let targetPublicKey = Buffer.alloc(32).fill(110);

        const nodeNo = await nodeUtil.createDataNode({
            owner: Buffer.alloc(32).fill(100),
            id1: Buffer.alloc(32).fill(0),
            id2: undefined,
            parentId: Buffer.alloc(32).fill(11),
            expireTime: now + 10000,
            creationTime: now,
        });

        const node0 = await nodeUtil.createDataNode({
            owner: Buffer.alloc(32).fill(100),
            id1: Buffer.alloc(32).fill(1),
            id2: undefined,
            parentId: Buffer.alloc(32).fill(11),
            expireTime: now + 10000,
            creationTime: now,
        });

        const node1 = await nodeUtil.createDataNode({
            owner: Buffer.alloc(32).fill(100),
            id1: Buffer.alloc(32).fill(2),
            id2: undefined,
            parentId: Buffer.alloc(32).fill(11),
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
        });

        assert(node1.isLicensed());

        const node2 = await nodeUtil.createDataNode({
            owner: Buffer.alloc(32).fill(100),
            id1: Buffer.alloc(32).fill(3),
            id2: undefined,
            parentId: Buffer.alloc(32).fill(11),
            expireTime: now + 10000,
            creationTime: now,
            isBeginRestrictiveWriteMode: true,
        });

        assert(node2.isBeginRestrictiveWriteMode());

        const node3 = await nodeUtil.createDataNode({
            owner: Buffer.alloc(32).fill(100),
            id1: Buffer.alloc(32).fill(4),
            id2: undefined,
            parentId: Buffer.alloc(32).fill(11),
            expireTime: now + 10000,
            creationTime: now,
            hasRightsByAssociation: true,
        });

        assert(node3.hasRightsByAssociation());

        const node4 = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            id1: Buffer.alloc(32).fill(5),
            id2: undefined,
            parentId: Buffer.alloc(32).fill(11),
            expireTime: now + 10000,
            creationTime: now,
        });

        const node5 = await nodeUtil.createDataNode({
            owner: Buffer.alloc(32).fill(100),
            id1: Buffer.alloc(32).fill(5),
            id2: undefined,
            parentId: Buffer.alloc(32).fill(11),
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        });

        assert(node5.isPublic());

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            rootNodeId1: Buffer.alloc(0),
            clientPublicKey,
            targetPublicKey,
            match: [
                {
                    nodeType: Data.GetType(),
                    filters: []
                }
            ]
        }});

        await driver.insertNodes([node0, node1, node2, node3, node4], now);

        let index = 0;
        for (let tuple of [
            [nodeNo, "The root node is not found but expected to exist."],
            [node0, "Access to requested root node is not allowed."],
            [node1, "Licensed node cannot be used as root node."],
            [node2, "Begin restrictive writer mode node cannot be used as root node."],
            [node3, "Root node cannot use hasRightsByAssociation."],
            [node4, ""],
            [node5, ""],
        ]) {

            const [node, error] = tuple as [NodeInterface, string];

            fetchRequest.query.rootNodeId1 = node.getId1() as Buffer;

            let [eNode, fetchReplyData] = await driver.getRootNode(fetchRequest.query, 1);
            if (error) {
                assert(!eNode);
                assert(fetchReplyData);
                assert(fetchReplyData.error === error, `Expecting error "${error}" in iteration ${index}, got error "${fetchReplyData.error}"`);
            }
            else {
                assert(eNode);
                assert(eNode.getId1().equals(node.getId1()));
            }

            index++;
        }
    });

    it("#fetchSingleNode", async function() {
        const driver = config.driver;
        const db = config.db;

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();

        const now = Date.now();

        let rootNode = undefined;
        let clientPublicKey = Buffer.alloc(32).fill(210);
        let clientPublicKey2 = Buffer.alloc(32).fill(211);
        let parentId = Buffer.alloc(32).fill(0);
        let nodeIdA  = Buffer.alloc(32).fill(1);
        let nodeIdB1 = Buffer.alloc(32).fill(2);
        let nodeIdB2 = Buffer.alloc(32).fill(3);
        let nodeIdB3 = Buffer.alloc(32).fill(4);
        let nodeIdC1 = Buffer.alloc(32).fill(5);
        let nodeIdC2 = Buffer.alloc(32).fill(6);
        let nodeIdD  = Buffer.alloc(32).fill(7);
        let nodeIdE1 = Buffer.alloc(32).fill(8);
        let nodeIdE2 = Buffer.alloc(32).fill(9);

        let licenseIdA = Buffer.alloc(32).fill(100);

        const nodeA = await nodeUtil.createDataNode({
            id1: nodeIdA,
            owner: clientPublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
        });

            const licenseA = await nodeUtil.createLicenseNode({
                id1: licenseIdA,
                refId: nodeIdA,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId,
                expireTime: now + 10000,
                creationTime: now,
            });

        const nodeB1 = await nodeUtil.createDataNode({
            id1: nodeIdB1,
            owner: clientPublicKey2,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
        });

        const nodeB2 = await nodeUtil.createDataNode({
            id1: nodeIdB2,
            owner: clientPublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            licenseMinDistance: 1,
            licenseMaxDistance: 1,
            isLicensed: true,
        });

        const nodeB3 = await nodeUtil.createDataNode({
            id1: nodeIdB3,
            owner: clientPublicKey2,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            hasRightsByAssociation: true,
            refId: nodeIdB2,
        });

        const nodeC1 = await nodeUtil.createDataNode({
            id1: nodeIdC1,
            owner: clientPublicKey,
            parentId: nodeIdB1,
            expireTime: now + 10000,
            creationTime: now,
            licenseMinDistance: 2,
            licenseMaxDistance: 2,
            isLicensed: true,
        });

        const nodeC2 = nodeC1.copy(nodeIdB2);
        nodeC2.setId1(nodeIdC2);

        const nodeD = await nodeUtil.createDataNode({
            id1: nodeIdD,
            owner: clientPublicKey,
            parentId: nodeIdC1,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 3,
            licenseMaxDistance: 3,
        });

        const nodeE1 = await nodeUtil.createDataNode({
            id1: nodeIdE1,
            owner: clientPublicKey,
            parentId: nodeIdD,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 4,
            licenseMaxDistance: 4,
        });

        const nodeE2 = await nodeUtil.createDataNode({
            id1: nodeIdE2,
            owner: clientPublicKey,
            parentId: nodeIdD,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        });

        let [id1s, parentIds] = await driver.store([nodeA, nodeB1, nodeB2, nodeB3, nodeC1, nodeC2, nodeD, nodeE1, nodeE2], now);
        assert(id1s.length === 9);

        let node = await driver.fetchSingleNode(nodeIdA, now, clientPublicKey, clientPublicKey);
        assert(!node);

        node = await driver.fetchSingleNode(nodeIdB1, now, clientPublicKey, clientPublicKey);
        assert(!node);

        node = await driver.fetchSingleNode(nodeIdB2, now, clientPublicKey, clientPublicKey);
        assert(!node);

        node = await driver.fetchSingleNode(nodeIdB3, now, clientPublicKey, clientPublicKey);
        assert(!node);

        node = await driver.fetchSingleNode(nodeIdC1, now, clientPublicKey, clientPublicKey);
        assert(!node);

        node = await driver.fetchSingleNode(nodeIdC2, now, clientPublicKey, clientPublicKey);
        assert(!node);

        node = await driver.fetchSingleNode(nodeIdD, now, clientPublicKey, clientPublicKey);
        assert(!node);

        node = await driver.fetchSingleNode(nodeIdE1, now, clientPublicKey, clientPublicKey);
        assert(!node);

        node = await driver.fetchSingleNode(nodeIdE2, now, clientPublicKey, clientPublicKey);
        assert(node);

        [id1s, parentIds] = await driver.store([licenseA], now);
        assert(id1s.length === 1);

        node = await driver.fetchSingleNode(nodeIdA, now, clientPublicKey, clientPublicKey);
        assert(node);

        node = await driver.fetchSingleNode(nodeIdB1, now, clientPublicKey, clientPublicKey);
        assert(!node);

        node = await driver.fetchSingleNode(nodeIdB1, now, clientPublicKey2, clientPublicKey2);
        assert(node);

        node = await driver.fetchSingleNode(nodeIdB2, now, clientPublicKey, clientPublicKey);
        assert(node);

        node = await driver.fetchSingleNode(nodeIdB3, now, clientPublicKey, clientPublicKey);
        assert(node);

        node = await driver.fetchSingleNode(nodeIdC1, now, clientPublicKey, clientPublicKey);
        assert(!node);

        node = await driver.fetchSingleNode(nodeIdC2, now, clientPublicKey, clientPublicKey);
        assert(node);

        node = await driver.fetchSingleNode(nodeIdD, now, clientPublicKey, clientPublicKey);
        assert(node);

        node = await driver.fetchSingleNode(nodeIdE1, now, clientPublicKey, clientPublicKey);
        assert(node);

        node = await driver.fetchSingleNode(nodeIdE2, now, clientPublicKey, clientPublicKey);
        assert(node);
    });

    it("#freshenParentTrail", async function() {
        const driver = config.driver;
        const db = config.db;

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();

        const now = Date.now();

        let rootNode = undefined;
        let clientPublicKey = Buffer.alloc(32).fill(210);
        let parentId = Buffer.alloc(32).fill(0);
        let nodeIdA = Buffer.alloc(32).fill(1);
        let nodeIdB1 = Buffer.alloc(32).fill(2);
        let nodeIdB2 = Buffer.alloc(32).fill(3);
        let nodeIdC1 = Buffer.alloc(32).fill(4);
        let nodeIdC2 = Buffer.alloc(32).fill(5);
        let nodeIdD = Buffer.alloc(32).fill(6);
        let nodeIdE1 = Buffer.alloc(32).fill(7);
        let nodeIdE2 = Buffer.alloc(32).fill(8);

        const nodeA = await nodeUtil.createDataNode({
            id1: nodeIdA,
            owner: clientPublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        });

        const nodeB1 = await nodeUtil.createDataNode({
            id1: nodeIdB1,
            owner: clientPublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        });

        const nodeB2 = await nodeUtil.createDataNode({
            id1: nodeIdB2,
            owner: clientPublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        });

        const nodeC1 = await nodeUtil.createDataNode({
            id1: nodeIdC1,
            owner: clientPublicKey,
            parentId: nodeIdB1,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        });

        const nodeC2 = nodeC1.copy(nodeIdB2);
        nodeC2.setId1(nodeIdC2);

        const nodeD = await nodeUtil.createDataNode({
            id1: nodeIdD,
            owner: clientPublicKey,
            parentId: nodeIdC1,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        });

        const nodeE1 = await nodeUtil.createDataNode({
            id1: nodeIdE1,
            owner: clientPublicKey,
            parentId: nodeIdD,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        });

        const nodeE2 = await nodeUtil.createDataNode({
            id1: nodeIdE2,
            owner: clientPublicKey,
            parentId: nodeIdD,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        });

        let [id1s, parentIds] = await driver.store([nodeA, nodeB1, nodeB2, nodeC1, nodeC2, nodeD, nodeE1, nodeE2], now);
        assert(id1s.length === 8);


        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            clientPublicKey,
            targetPublicKey: clientPublicKey,
            cutoffTime: BigInt(now),
            match: [
                {
                    nodeType: Data.GetType(),
                    filters: []
                }
            ]
        }});

        let nodes = await fetch(db, fetchRequest, now, rootNode);
        assert(nodes.length === 8);

        nodes = await fetch(db, fetchRequest, now, rootNode);
        assert(nodes.length === 8);

        fetchRequest.query.cutoffTime = BigInt(now + 1);
        nodes = await fetch(db, fetchRequest, now, rootNode);
        assert(nodes.length === 0);


        nodeA.setDynamicSelfActive();  // Change transient state so we can restore node.
        [id1s, parentIds] = await driver.store([nodeA], now + 1, true);
        assert(id1s.length === 1);

        nodes = await fetch(db, fetchRequest, now, rootNode);
        assert(nodes.length === 1);

        fetchRequest.query.cutoffTime = BigInt(now + 2);
        nodes = await fetch(db, fetchRequest, now, rootNode);
        assert(nodes.length === 0);

        nodeC1.setDynamicSelfActive();
        [id1s, parentIds] = await driver.store([nodeC1], now + 3, true);
        assert(id1s.length === 1);

        nodes = await fetch(db, fetchRequest, now, rootNode);
        let same = diffNodes([nodeC1], nodes);
        assert(same);

        fetchRequest.query.cutoffTime = BigInt(now + 4);
        nodes = await fetch(db, fetchRequest, now, rootNode);
        assert(nodes.length === 0);

        nodeC2.setDynamicSelfActive();
        nodeE1.setDynamicSelfActive();
        [id1s, parentIds] = await driver.store([nodeC2, nodeE1], now + 5, true);
        assert(id1s.length === 2);

        nodes = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([nodeC2, nodeE1], nodes);
        assert(same);
    });

    it("#bumpNodes", async function() {
        const driver = config.driver;
        const db = config.db;

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();

        const now = Date.now();

        let rootNode = undefined;
        let clientPublicKey = Buffer.alloc(32).fill(210);
        let parentId = Buffer.alloc(32).fill(0);
        let nodeIdA = Buffer.alloc(32).fill(1);
        let nodeIdB1 = Buffer.alloc(32).fill(2);
        let nodeIdB2 = Buffer.alloc(32).fill(3);

        const nodeA = await nodeUtil.createDataNode({
            id1: nodeIdA,
            owner: clientPublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            hasRightsByAssociation: true,
            refId: Buffer.alloc(32).fill(100),
        });

        const nodeB1 = await nodeUtil.createDataNode({
            id1: nodeIdB1,
            owner: clientPublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            hasRightsByAssociation: true,
            refId: Buffer.alloc(32).fill(100),
        });

        const nodeB2 = await nodeUtil.createDataNode({
            id1: nodeIdB2,
            owner: clientPublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            hasRightsByAssociation: true,
            refId: Buffer.alloc(32).fill(100),
        });

        let [id1s, parentIds] = await driver.store([nodeA, nodeB1, nodeB2], now);
        assert(id1s.length === 3);

        let ph = db.generatePlaceholders(2);
        let rows = await db.all(`SELECT * FROM universe_nodes WHERE id1 IN ${ph}`, [nodeIdB1, nodeIdB2]);
        assert(rows.length === 2);
        assert(rows[0].bumphash.equals(rows[1].bumphash));

        const bumphash1 = rows[0].bumphash;
        let bumpedParentIds = await driver.bumpNodes([bumphash1], now + 10);

        assert(bumpedParentIds.length === 2);
        assert(bumpedParentIds[0].equals(nodeIdA));
        assert(bumpedParentIds[1].equals(nodeIdA));

        rows = await db.all(`SELECT * FROM universe_nodes WHERE id1 IN ${ph}`, [nodeIdB1, nodeIdB2]);
        assert(rows.length === 2);
        assert(rows[0].updatetime === now + 10);
        assert(rows[1].updatetime === now + 10);
        assert(rows[0].trailupdatetime === now + 10);
        assert(rows[1].trailupdatetime === now + 10);


        ph = db.generatePlaceholders(1);
        rows = await db.all(`SELECT * FROM universe_nodes WHERE id1 IN ${ph}`, [nodeIdA]);
        assert(rows.length === 1);
        assert(rows[0].updatetime === now);
        assert(rows[0].trailupdatetime === now);

        const bumphash2 = rows[0].bumphash;
        assert(!bumphash1.equals(bumphash2));

        bumpedParentIds = await driver.bumpNodes([bumphash1, bumphash2], now + 11);
        assert(bumpedParentIds.length === 3);
        assert(bumpedParentIds[0].equals(parentId));
        assert(bumpedParentIds[1].equals(nodeIdA));
        assert(bumpedParentIds[2].equals(nodeIdA));


        ph = db.generatePlaceholders(3);
        rows = await db.all(`SELECT * FROM universe_nodes WHERE id1 IN ${ph}`, [nodeIdA, nodeIdB1, nodeIdB2]);
        assert(rows[0].updatetime === now + 11);
        assert(rows[0].trailupdatetime === now + 11);
        assert(rows[1].updatetime === now + 11);
        assert(rows[1].trailupdatetime === now + 11);
        assert(rows[2].updatetime === now + 11);
        assert(rows[2].trailupdatetime === now + 11);
    });

    /**
     * Here we want to see that a licensed node gets bumped by a fresh license
     * and also that any rightsByAssociation nodes also get bumped.
     *
     */
    it("#getRelatedBumpHashes", async function() {
        const driver = config.driver;
        const db = config.db;

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();

        const now = Date.now();

        let rootNode = undefined;
        let clientPublicKey = Buffer.alloc(32).fill(210);
        let clientPublicKey2 = Buffer.alloc(32).fill(211);
        let parentId = Buffer.alloc(32).fill(0);
        let nodeIdA = Buffer.alloc(32).fill(1);
        let nodeIdB1 = Buffer.alloc(32).fill(2);
        let nodeIdB2 = Buffer.alloc(32).fill(3);
        let nodeIdC1 = Buffer.alloc(32).fill(4);
        let nodeIdC2 = Buffer.alloc(32).fill(5);
        let nodeIdD = Buffer.alloc(32).fill(6);
        let nodeIdE1 = Buffer.alloc(32).fill(7);
        let nodeIdE2 = Buffer.alloc(32).fill(8);

        let licenseIdB1 = Buffer.alloc(32).fill(100);

        const nodeA = await nodeUtil.createDataNode({
            id1: nodeIdA,
            owner: clientPublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        });

        const nodeB1 = await nodeUtil.createDataNode({
            id1: nodeIdB1,
            owner: clientPublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
        });

            const licenseB1 = await nodeUtil.createLicenseNode({
                id1: licenseIdB1,
                refId: nodeIdB1,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId: nodeIdA,
                expireTime: now + 10000,
                creationTime: now,
            });

        const nodeB2 = await nodeUtil.createDataNode({
            id1: nodeIdB2,
            owner: clientPublicKey2,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            hasRightsByAssociation: true,
            refId: nodeIdB1,
        });

        const nodeC1 = await nodeUtil.createDataNode({
            id1: nodeIdC1,
            owner: clientPublicKey,
            parentId: nodeIdB1,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        });

        const nodeC2 = nodeC1.copy(nodeIdB2);
        nodeC2.setId1(nodeIdC2);

        const nodeD = await nodeUtil.createDataNode({
            id1: nodeIdD,
            owner: clientPublicKey,
            parentId: nodeIdC1,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        });

        const nodeE1 = await nodeUtil.createDataNode({
            id1: nodeIdE1,
            owner: clientPublicKey,
            parentId: nodeIdD,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        });

        const nodeE2 = await nodeUtil.createDataNode({
            id1: nodeIdE2,
            owner: clientPublicKey,
            parentId: nodeIdD,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        });

        let [id1s, parentIds] = await driver.store([nodeA, nodeB1, nodeB2, nodeC1, nodeC2, nodeD, nodeE1, nodeE2], now);
        assert(id1s.length === 8);

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            clientPublicKey,
            targetPublicKey: clientPublicKey,
            cutoffTime: BigInt(now),
            match: [
                {
                    nodeType: Data.GetType(),
                    filters: []
                }
            ]
        }});

        let nodes = await fetch(db, fetchRequest, now, rootNode);
        let same = diffNodes([nodeA], nodes);
        assert(same);

        await driver.store([licenseB1], now + 1);

        nodes = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([nodeA, nodeB1, nodeB2, nodeC1, nodeC2, nodeD, nodeE1, nodeE2], nodes);
        assert(same);
    });
}

async function fetch(db: DBClient, fetchRequest: FetchRequest, now: number, rootNode?: NodeInterface): Promise<NodeInterface[]> {

    const nodes: NodeInterface[] = [];
    let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
        nodes.push(...fetchReplyData.nodes ?? []);
    };

    let qp = new QueryProcessor(db, fetchRequest.query, rootNode, now, handleFetchReplyData);
    await qp.run();

    return nodes;
}

function diffNodes(nodes1: NodeInterface[], nodes2: NodeInterface[]): boolean {

    if (nodes1.length !== nodes2.length) {
        return false;
    }

    const diff: [NodeInterface, NodeInterface | undefined][] = [];

    const nodes1Length = nodes1.length;
    for (let i=0; i<nodes1Length; i++) {
        const node1 = nodes1[i];
        const node2 = nodes2[i];
        if (!(node1.getId1() as Buffer).equals(node2.getId1() as Buffer)) {
            return false;
        }
    }

    return true;
}
