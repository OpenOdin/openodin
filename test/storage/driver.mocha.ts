import {
    assert,
} from "chai";

import {
    expectAsyncException,
} from "../util";

import {
    FriendCert,
    Driver,
    BaseNodeInterface,
    InsertAchillesHash,
    InsertLicensingHash,
    InsertDestroyHash,
    InsertFriendCert,
    NodeUtil,
    DBClient,
    TABLES,
    sleep,
    FetchQuery,
    FetchReplyData,
    DataNodeTypeAlias,
    QueryProcessor,
    FetchRequest,
    DatabaseUtil,
    Hash,
    NOW_TOLERANCE,
    ParseSchema,
    FetchRequestSchema,
    Krypto,
} from "../../src";

/**
 * A subclass wrapper to make protected functions accessible publicly.
 *
 */
class DriverTestWrapper extends Driver {
    public async freshenParentTrail(parentIds: Buffer[], now: number) {
        return super.freshenParentTrail(parentIds, now);
    }

    public async filterDestroyed(nodes: BaseNodeInterface[]): Promise<BaseNodeInterface[]> {
        return super.filterDestroyed(nodes);
    }

    public async filterExisting(nodes: BaseNodeInterface[], preserveTransient: boolean = false):
        Promise<BaseNodeInterface[]> {
        return super.filterExisting(nodes, preserveTransient);
    }

    public async filterUnique(nodes: BaseNodeInterface[]): Promise<BaseNodeInterface[]> {
        return super.filterUnique(nodes);
    }

    public async insertAchillesHashes(achillesHashes: InsertAchillesHash[]): Promise<void> {
        return super.insertAchillesHashes(achillesHashes);
    }

    public async insertLicensingHashes(licensingHashes: InsertLicensingHash[]): Promise<void> {
        return super.insertLicensingHashes(licensingHashes);
    }

    public async insertDestroyHashes(destroyHashes: InsertDestroyHash[]): Promise<void> {
        return super.insertDestroyHashes(destroyHashes);
    }

    public async insertFriendCerts(friendCerts: InsertFriendCert[]): Promise<void> {
        return super.insertFriendCerts(friendCerts);
    }

    public async insertNodes(nodes: BaseNodeInterface[], now: number, preserveTransient: boolean = false): Promise<void> {
        return super.insertNodes(nodes, now, preserveTransient);
    }

    protected async storeNodes(nodes: BaseNodeInterface[], now: number, preserveTransient: boolean = false) {
        return super.storeNodes(nodes, now, preserveTransient);
    }

    public async getNodeById1(id1: Buffer, now: number): Promise<BaseNodeInterface | undefined> {
        return super.getNodeById1(id1, now);
    }

    public async getNodesById1(nodesId1: Buffer[], now: number): Promise<BaseNodeInterface[]> {
        return super.getNodesById1(nodesId1, now);
    }

    public async getRootNode(fetchQuery: FetchQuery, now: number): Promise<[BaseNodeInterface | undefined, FetchReplyData | undefined]> {
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

    afterEach("Close database", async function() {
        await db?.close();
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

    afterEach("Close database", async function() {
        await db?.close();
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

    afterEach("Close database", async function() {
        await db?.close();
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

        let rows = await db.all(`SELECT * FROM openodin_achilles_hashes ORDER BY id1;`);

        assert(rows.length === 2);
        assert(rows[0].id1.equals(nodeId1A));
        assert(rows[0].hash.equals(hashA));

        assert(rows[1].id1.equals(nodeId1B));
        assert(rows[1].hash.equals(hashB));
    });

    it("#insertLicensingHashes", async function() {
        const driver = config.driver;
        const db = config.db;

        assert(driver);
        assert(db);

        let licensingHashes: InsertLicensingHash[] = [];

        const nodeId1A = Buffer.alloc(32).fill(1);
        const hashA = Buffer.alloc(32).fill(201);

        const nodeId1B = Buffer.alloc(32).fill(2);
        const hashB = Buffer.alloc(32).fill(202);

        licensingHashes.push({
            id1: nodeId1A,
            hash: hashA,
            disallowretrolicensing: 0,
            parentpathhash: undefined,
            restrictivemodewriter: 0,
            restrictivemodemanager: 0,
        });

        licensingHashes.push({
            id1: nodeId1B,
            hash: hashB,
            disallowretrolicensing: 0,
            parentpathhash: undefined,
            restrictivemodewriter: 0,
            restrictivemodemanager: 0,
        });

        await driver.insertLicensingHashes(licensingHashes);

        let rows = await db.all(`SELECT * FROM openodin_licensing_hashes ORDER BY id1;`);

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

        let rows = await db.all(`SELECT * FROM openodin_destroy_hashes ORDER BY id1;`);

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
            owner: issuerA,
            constraints: constraintsA,
            image: imageA,
        });

        friendCerts.push({
            id1: nodeId1B,
            owner: issuerB,
            constraints: constraintsB,
            image: imageB,
        });

        await driver.insertFriendCerts(friendCerts);

        let rows = await db.all(`SELECT * FROM openodin_friend_certs ORDER BY id1;`);

        assert(rows.length === 2);
        assert(rows[0].id1.equals(nodeId1A));
        assert(rows[0].owner.equals(issuerA));
        assert(rows[0].constraints.equals(constraintsA));
        assert(rows[0].image.equals(imageA));

        assert(rows[1].id1.equals(nodeId1B));
        assert(rows[1].owner.equals(issuerB));
        assert(rows[1].constraints.equals(constraintsB));
        assert(rows[1].image.equals(imageB));
    });

    it("#insertNodes, #filterExisting", async function() {
        const driver = config.driver;
        const db = config.db;
        const keyPair1 = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();

        const now = Date.now();

        const node0 = await nodeUtil.createDataNode({
            owner: keyPair1.publicKey,
            id2: undefined,
            parentId: Buffer.alloc(32).fill(11),
            expireTime: now + 10000,
            creationTime: now,
        }, keyPair1.publicKey, keyPair1.secretKey);

        node0.getProps();
        node0.pack(true);

        const node1 = await nodeUtil.createDataNode({
            isInactive: true,
            owner: keyPair1.publicKey,
            id2: Buffer.alloc(32).fill(22),
            parentId: Buffer.alloc(32).fill(12),
            expireTime: now + 10001,
            creationTime: now+1,
        }, keyPair1.publicKey, keyPair1.secretKey);

        node1.getProps();
        node1.pack(true);

        const node2 = await nodeUtil.createDataNode({
            owner: keyPair1.publicKey,
            id2: Buffer.alloc(32).fill(23),
            parentId: Buffer.alloc(32).fill(13),
            expireTime: now + 10002,
            creationTime: now+2,
        }, keyPair1.publicKey, keyPair1.secretKey);

        node2.getProps();
        node2.pack(true);

        const nodes: BaseNodeInterface[] = [
            node0,
            node1,
        ];

        await driver.insertNodes(nodes, now, true);

        let rows = await db.all(`SELECT id1, id2, id, parentid, creationtime, expiretime,
            transienthash, uniquehash, image
            FROM openodin_nodes ORDER BY creationtime;`);

        assert(rows.length === 2);

        assert(rows[0].id1.equals(nodes[0].getProps().id1 as Buffer));
        assert(rows[0].id2 === null);
        assert(rows[0].id.equals(nodes[0].getProps().id as Buffer));
        assert(rows[0].parentid.equals(nodes[0].getProps().parentId as Buffer));
        assert(parseInt(rows[0].expiretime) === now + 10000);
        assert(parseInt(rows[0].creationtime) === now);
        assert(rows[0].uniquehash.equals(rows[0].id1));
        assert((rows[0].transienthash == null ) || rows[0].transienthash.equals(nodes[0].hashTransient()));
        assert(rows[0].image.equals(nodes[0].pack(true)));

        assert(rows[1].id1.equals(nodes[1].getProps().id1 as Buffer));
        assert(rows[1].id2.equals(nodes[1].getProps().id2 as Buffer));
        assert(rows[1].id.equals(nodes[1].getProps().id as Buffer));
        assert(rows[1].parentid.equals(nodes[1].getProps().parentId as Buffer));
        assert(parseInt(rows[1].expiretime) === now + 10001);
        assert(parseInt(rows[1].creationtime) === now + 1);
        assert(rows[1].uniquehash.equals(rows[1].id1));
        assert(rows[1].transienthash == null || rows[1].transienthash.equals(nodes[1].hashTransient()));
        assert(rows[1].image.equals(nodes[1].pack(true)));


        // #filterExisting
        //

        // Change the transient hash.
        node1.storeFlags({isInactive: false});

        node1.pack(true);

        let nodes3 = await driver.filterExisting([node0, node1, node2]);

        assert(nodes3.length === 1);
        assert((nodes3[0].getProps().id1 as Buffer).equals(node2.getProps().id1 as Buffer));

        // Now also detect transient hash changes as non-existing.
        nodes3 = await driver.filterExisting([node0, node1, node2], true);

        assert(nodes3.length === 2);
        assert((nodes3[0].getProps().id1 as Buffer).equals(node1.getProps().id1 as Buffer));
        assert((nodes3[1].getProps().id1 as Buffer).equals(node2.getProps().id1 as Buffer));
    });

    it("#filterDestroyed", async function() {
        const driver = config.driver;
        const db = config.db;
        const keyPair1 = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();

        const now = Date.now();

        const node0 = await nodeUtil.createDataNode({
            owner: keyPair1.publicKey,
            parentId: Buffer.alloc(32).fill(11),
            expireTime: now + 10000,
            creationTime: now,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const node1 = await nodeUtil.createDataNode({
            owner: keyPair1.publicKey,
            parentId: Buffer.alloc(32).fill(12),
            expireTime: now + 10001,
            creationTime: now+1,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const node2 = await nodeUtil.createDataNode({
            owner: keyPair1.publicKey,
            parentId: Buffer.alloc(32).fill(13),
            expireTime: now + 10002,
            creationTime: now+2,
            isIndestructible: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        let achillesHashes = node0.getAchillesHashes();
        assert(achillesHashes.length === 1);

        achillesHashes = node1.getAchillesHashes();
        assert(achillesHashes.length === 1);

        achillesHashes = node2.getAchillesHashes();
        assert(achillesHashes.length === 0);

        await driver.insertNodes([node0, node1, node2], now);

        let nodes = await driver.filterDestroyed([node0, node1, node2]);
        assert(nodes.length === 3);

        let destroyHashes: InsertDestroyHash[] = [];

        achillesHashes = node0.getAchillesHashes();

        achillesHashes.forEach( hash => {
            destroyHashes.push({
                id1: node0.getProps().id1 as Buffer,
                hash: hash,
            });
        });

        await driver.insertDestroyHashes(destroyHashes);

        nodes = await driver.filterDestroyed([node0, node1, node2]);
        assert(nodes.length === 2);


        destroyHashes = [];

        achillesHashes = node1.getAchillesHashes();

        destroyHashes.push({
            id1: node1.getProps().id1 as Buffer,
            hash: achillesHashes[0],
        });

        await driver.insertDestroyHashes(destroyHashes);

        nodes = await driver.filterDestroyed([node0, node1, node2]);
        assert(nodes.length === 1);


        let allHashes: Buffer[] = [];
        allHashes.push(...node0.getAchillesHashes());
        allHashes.push(...node1.getAchillesHashes());
        assert(allHashes.length === 2);

        const ph = db.generatePlaceholders(allHashes.length);

        const sql = `SELECT COUNT(dh.hash) as count, nodes.id1 AS id1
            FROM openodin_destroy_hashes AS dh, openodin_nodes as nodes
            WHERE dh.hash IN ${ph} AND dh.id1 = nodes.id1 GROUP BY nodes.id1;`;

        const rows = await db.all(sql, allHashes);

        assert(rows.length === 2);
        assert(rows[0].count === 1);
        assert(rows[1].count === 1);
    });

    it("#filterUnique", async function() {
        const driver = config.driver;
        const db = config.db;
        const keyPair1 = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();

        const now = Date.now();

        // License nodes are by default flagged as unique.
        //
        const node0 = await nodeUtil.createLicenseNode({
            owner: keyPair1.publicKey,
            parentId: Buffer.alloc(32).fill(11),
            targetPublicKey: Buffer.alloc(32).fill(101),
            refId: Buffer.alloc(32).fill(201),
            expireTime: now + 10000,
            creationTime: now,
        }, keyPair1.publicKey, keyPair1.secretKey);

        // Same sharedHash as node0
        const node1 = await nodeUtil.createLicenseNode({
            owner: keyPair1.publicKey,
            parentId: Buffer.alloc(32).fill(11),
            targetPublicKey: Buffer.alloc(32).fill(101),
            refId: Buffer.alloc(32).fill(201),
            expireTime: now + 10000,
            creationTime: now + 1,
        }, keyPair1.publicKey, keyPair1.secretKey);

        // Different sharedHash
        const node2 = await nodeUtil.createLicenseNode({
            owner: keyPair1.publicKey,
            parentId: Buffer.alloc(32).fill(11),
            targetPublicKey: Buffer.alloc(32).fill(101),
            refId: Buffer.alloc(32).fill(202),
            expireTime: now + 10000,
            creationTime: now,
        }, keyPair1.publicKey, keyPair1.secretKey);

        assert(node0.uniqueHash().equals(node1.uniqueHash()));
        assert(!node0.uniqueHash().equals(node2.uniqueHash()));

        await driver.insertNodes([node0], now);

        let rows = await db.all(`SELECT id1 FROM openodin_nodes ORDER BY id1;`);

        assert(rows.length === 1);
        assert(rows[0].id1.equals(node0.getProps().id1 as Buffer));

        await expectAsyncException(
            driver.insertNodes([node1], now),
            ["SQLITE_CONSTRAINT: UNIQUE constraint failed: openodin_nodes.uniquehash",
                `duplicate key value violates unique constraint "openodin_nodes_uniquehash_key"`,
                `UNIQUE constraint failed: openodin_nodes.uniquehash`]);

        // postgres-client sometimes need a little breather after insert rejections.
        await sleep(50);


        // node0 is already inserted but will still be returned
        // since it is the stored node with the shared hash.
        let nodes = await driver.filterUnique([node0, node1, node2]);

        assert(nodes.length === 2);
        assert(nodes[0].getProps().id1.equals(node0.getProps().id1));
        assert(nodes[1].getProps().id1.equals(node2.getProps().id1));
    });

    it("#storeNodes, #delete", async function() {
        const driver = config.driver;
        const db = config.db;
        const keyPair1 = Krypto.GenKeyPair();
        const keyPair2 = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();

        const now = Date.now();

        const node0 = await nodeUtil.createDataNode({
            owner: keyPair1.publicKey,
            parentId: Buffer.alloc(32).fill(11),
            expireTime: now + 10000,
            creationTime: now,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const friendCert = new FriendCert();

        friendCert.mergeProps({
            owner: keyPair1.publicKey,
            constraints: Buffer.alloc(32).fill(201),
            creationTime: now,
            expireTime: now + 10000,
            salt: Buffer.alloc(8),
            friendLevel: 1,
        });

        friendCert.sign(keyPair1);

        const node1 = await nodeUtil.createCarrierNode({
            owner: keyPair1.publicKey,
            //id2: Buffer.alloc(32).fill(22),
            parentId: Buffer.alloc(32).fill(12),
            expireTime: now + 10001,
            creationTime: now+1,
            friendCert: friendCert.pack(),
            info: "FriendCert",
        }, keyPair1.publicKey, keyPair1.secretKey);

        const node2 = await nodeUtil.createDataNode({
            owner: keyPair1.publicKey,
            //id2: Buffer.alloc(32).fill(23),
            parentId: Buffer.alloc(32).fill(13),
            expireTime: now + 10002,
            creationTime: now+2,
            isIndestructible: true,
            isDestroy: true,
            refId: Buffer.alloc(32),
        }, keyPair1.publicKey, keyPair1.secretKey);

        assert(node2.loadFlags().isDestroy);

        const license0 = await nodeUtil.createLicenseNode({
            owner: keyPair2.publicKey,
            parentId: Buffer.alloc(32).fill(11),
            targetPublicKey: keyPair2.publicKey,
            refId: Buffer.alloc(32).fill(202),
            expireTime: now + 10000,
            creationTime: now,
        }, keyPair2.publicKey, keyPair2.secretKey);


        await driver.storeNodes([node0, node1, node2, license0], now);

        const sqlDestroy = `SELECT COUNT(dh.hash) as count, nodes.id1 AS id1
            FROM openodin_destroy_hashes AS dh, openodin_nodes as nodes
            WHERE dh.id1 = nodes.id1 GROUP BY nodes.id1;`;

        let rows = await db.all(sqlDestroy);

        assert(rows.length === 1);
        assert(rows[0].count === 1);
        assert(rows[0].id1.equals(node2.getProps().id1));


        rows = await db.all(`SELECT * FROM openodin_achilles_hashes ORDER BY id1;`);

        assert(rows.length === 4);

        rows = await db.all(`SELECT * FROM openodin_licensing_hashes ORDER BY id1;`);

        assert(rows.length === 4);

        rows = await db.all(`SELECT * FROM openodin_friend_certs ORDER BY id1;`);

        assert(rows.length === 1);

        // #delete
        //

        let ph = db.generatePlaceholders(1);
        rows = await db.all(`SELECT * FROM openodin_nodes WHERE id1=${ph}`, [node0.getProps().id1]);
        assert(rows.length === 1);

        rows = await db.all(`SELECT * FROM openodin_achilles_hashes WHERE id1=${ph}`, [node0.getProps().id1]);
        assert(rows.length === 1);

        await driver.deleteNodes([node0.getProps().id1]);

        rows = await db.all(`SELECT * FROM openodin_nodes WHERE id1=${ph}`, [node0.getProps().id1]);
        assert(rows.length === 0);

        rows = await db.all(`SELECT * FROM openodin_achilles_hashes WHERE id1=${ph}`, [node0.getProps().id1]);
        assert(rows.length === 0);



        rows = await db.all(`SELECT * FROM openodin_licensing_hashes WHERE id1=${ph}`, [license0.getProps().id1]);
        assert(rows.length === 4);

        await driver.deleteNodes([license0.getProps().id1]);

        rows = await db.all(`SELECT * FROM openodin_licensing_hashes WHERE id1=${ph}`, [license0.getProps().id1]);
        assert(rows.length === 0);



        rows = await db.all(sqlDestroy);
        assert(rows.length === 1);

        await driver.deleteNodes([node2.getProps().id1]);

        rows = await db.all(sqlDestroy);
        assert(rows.length === 0);

        await driver.deleteNodes([node1.getProps().id1]);

        rows = await db.all(`SELECT * FROM openodin_friend_certs WHERE id1=${ph}`, [node1.getProps().id1]);
        assert(rows.length === 0);
    });

    it("#getNodeById1 also with transient values", async function() {
        const driver = config.driver;
        const db = config.db;
        const keyPair1 = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();

        const now = Date.now();

        const node0 = await nodeUtil.createDataNode({
            isInactive: false,
            owner: keyPair1.publicKey,
            parentId: Buffer.alloc(32).fill(11),
            expireTime: now + 10000,
            creationTime: now,
        }, keyPair1.publicKey, keyPair1.secretKey);

        node0.pack(true);

        let oldTransientHash = node0.hashTransient();

        let node = await driver.getNodeById1(node0.getProps().id1, 1);
        assert(!node);

        // Store
        //
        let result = await driver.store([node0], now, true);
        assert(result[0].length === 1);
        assert(result[1].length === 1);
        assert(result[0][0].equals(node0.getProps().id1));
        assert(result[1][0].equals(node0.getProps().parentId));

        let ph = db.generatePlaceholders(1);
        let rows = await db.all(`SELECT * FROM openodin_nodes WHERE id1=${ph}`, [node0.getProps().id1]);
        assert(rows.length === 1);
        assert(rows[0].image.equals(node0.pack(true)));
        assert(rows[0].transienthash.equals(oldTransientHash));
        assert(rows[0].storagetime === now);

        // getNodeById1
        //

        node = await driver.getNodeById1(node0.getProps().id1, now);
        assert(node);
        assert(node !== node0);
        assert(node.getProps().id1.equals(node0.getProps().id1));
        assert(node.hashTransient().equals(node0.hashTransient()));
        assert(!node.loadFlags().isInactive);

        const old0Packed = node0.getPacked();

        // update transient values, store again, expect no changes.
        //
        node0.storeFlags({isInactive: true});
        node0.pack(true);

        assert(!node.hashTransient().equals(node0.hashTransient()));

        result = await driver.store([node0], now + 1);
        assert(result[0].length === 0);

        ph = db.generatePlaceholders(1);
        rows = await db.all(`SELECT * FROM openodin_nodes WHERE id1=${ph}`, [node0.getProps().id1]);
        assert(rows.length === 1);
        assert(rows[0].image.equals(old0Packed));
        assert(rows[0].transienthash.equals(oldTransientHash));
        assert(!rows[0].transienthash.equals(node0.hashTransient()));


        node = await driver.getNodeById1(node0.getProps().id1, now);
        assert(node);
        assert(node !== node0);
        assert(node.getProps().id1.equals(node0.getProps().id1));
        assert(!node.hashTransient().equals(node0.hashTransient()));
        assert(node.hashTransient().equals(oldTransientHash));
        assert(node.getProps().transientStorageTime === now);
        assert(!node.loadFlags().isInactive);

        // Store and update transient hash
        //
        result = await driver.store([node0], now + 1, true);
        assert(result[0].length === 1);
        assert(result[1].length === 1);
        assert(result[0][0].equals(node0.getProps().id1));
        assert(result[1][0].equals(node0.getProps().parentId));


        ph = db.generatePlaceholders(1);
        rows = await db.all(`SELECT * FROM openodin_nodes WHERE id1=${ph}`, [node0.getProps().id1]);
        assert(rows.length === 1);
        assert(!rows[0].transienthash.equals(oldTransientHash));
        assert(rows[0].image.equals(node0.pack(true)));
        assert(rows[0].transienthash.equals(node0.hashTransient()));

        node = await driver.getNodeById1(node0.getProps().id1, now);
        assert(node);
        assert(node !== node0);
        assert(node.getProps().id1.equals(node0.getProps().id1));
        assert(node.hashTransient().equals(node0.hashTransient()));
        assert(!node.hashTransient().equals(oldTransientHash));
        assert(node.getProps().transientStorageTime === now);
        assert(node.loadFlags().isInactive);
    });

    it.skip("#getNodesById1 also with transient values", async function() {
        // TODO
    });

    it("#getRootNode", async function() {
        const driver = config.driver;
        const db = config.db;
        const keyPair1 = Krypto.GenKeyPair();
        const keyPair2 = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();

        const now = Date.now();

        let clientPublicKey = keyPair2.publicKey;
        let targetPublicKey = keyPair2.publicKey;

        // This node not getting stored
        const nodeNo = await nodeUtil.createDataNode({
            owner: keyPair1.publicKey,
            parentId: Buffer.alloc(32).fill(11),
            expireTime: now + 10000,
            creationTime: now,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const node0 = await nodeUtil.createDataNode({
            owner: keyPair1.publicKey,
            parentId: Buffer.alloc(32).fill(11),
            expireTime: now + 10000,
            creationTime: now+1,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const node1 = await nodeUtil.createDataNode({
            owner: keyPair1.publicKey,
            parentId: Buffer.alloc(32).fill(11),
            expireTime: now + 10000,
            creationTime: now+2,
            isLicensed: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        assert(node1.loadFlags().isLicensed);

        const node2 = await nodeUtil.createDataNode({
            owner: keyPair1.publicKey,
            parentId: Buffer.alloc(32).fill(11),
            expireTime: now + 10000,
            creationTime: now+3,
            isBeginRestrictiveWriteMode: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        assert(node2.loadFlags().isBeginRestrictiveWriteMode);

        const node3 = await nodeUtil.createDataNode({
            owner: keyPair1.publicKey,
            parentId: Buffer.alloc(32).fill(11),
            expireTime: now + 10000,
            creationTime: now+4,
            hasRightsByAssociation: true,
            refId: Buffer.alloc(32),
        }, keyPair1.publicKey, keyPair1.secretKey);

        assert(node3.loadFlags().hasRightsByAssociation);

        const node4 = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: Buffer.alloc(32).fill(11),
            expireTime: now + 10000,
            creationTime: now+5,
        }, keyPair2.publicKey, keyPair2.secretKey);

        const node5 = await nodeUtil.createDataNode({
            owner: keyPair1.publicKey,
            parentId: Buffer.alloc(32).fill(11),
            expireTime: now + 10000,
            creationTime: now+6,
            isPublic: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        assert(node5.loadFlags().isPublic);

        let fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            rootNodeId1: Buffer.alloc(0),
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            match: [
                {
                    nodeType: DataNodeTypeAlias,
                    filters: []
                }
            ]
        }});

        await driver.insertNodes([node0, node1, node2, node3, node4, node5], now);

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

            const [node, error] = tuple as [BaseNodeInterface, string];

            fetchRequest.query.rootNodeId1 = node.getProps().id1 as Buffer;

            let [eNode, fetchReplyData] = await driver.getRootNode(fetchRequest.query, now);

            if (error) {
                assert(!eNode);
                assert(fetchReplyData);
                assert(fetchReplyData.error === error, `Expecting error "${error}" in iteration ${index}, got error "${fetchReplyData.error}"`);
            }
            else {
                assert(eNode);
                assert(eNode.getProps().id1.equals(node.getProps().id1));
            }

            index++;
        }
    });

    it("#fetchSingleNode", async function() {
        const driver = config.driver;
        const db = config.db;
        const keyPair1 = Krypto.GenKeyPair();
        const keyPair2 = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();

        const now = Date.now();

        let rootNode = undefined;
        let clientPublicKey = keyPair1.publicKey;
        let clientPublicKey2 = keyPair2.publicKey;
        let parentId = Buffer.alloc(32).fill(0);

        const nodeA = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdA = nodeA.getProps().id1 as Buffer;

            const licenseA = await nodeUtil.createLicenseNode({
                refId: nodeIdA,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId,
                expireTime: now + 10000,
                creationTime: now,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdA = licenseA.getProps().id1 as Buffer;

        const nodeB1 = await nodeUtil.createDataNode({
            owner: clientPublicKey2,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
        }, keyPair2.publicKey, keyPair2.secretKey);

        const nodeIdB1 = nodeB1.getProps().id1 as Buffer;

        const nodeB2 = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            licenseMinDistance: 1,
            licenseMaxDistance: 1,
            isLicensed: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdB2 = nodeB2.getProps().id1 as Buffer;

        const nodeB3 = await nodeUtil.createDataNode({
            owner: clientPublicKey2,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            hasRightsByAssociation: true,
            refId: nodeIdB2,
        }, keyPair2.publicKey, keyPair2.secretKey);

        const nodeIdB3 = nodeB3.getProps().id1 as Buffer;

        const nodeC1 = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdB1,
            expireTime: now + 10000,
            creationTime: now,
            licenseMinDistance: 2,
            licenseMaxDistance: 2,
            isLicensed: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdC1 = nodeC1.getProps().id1 as Buffer;

        const nodeC2 = nodeC1.copy(nodeIdB2);
        nodeC2.sign(keyPair1);
        const nodeIdC2 = nodeC2.getProps().id1 as Buffer;

        const nodeD = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdC1,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 3,
            licenseMaxDistance: 3,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdD = nodeD.getProps().id1 as Buffer;

        const nodeE1 = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdD,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 4,
            licenseMaxDistance: 4,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdE1 = nodeE1.getProps().id1 as Buffer;

        const nodeE2 = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdD,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdE2 = nodeE2.getProps().id1 as Buffer;

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

        node = await driver.fetchSingleNode(nodeIdA, now-NOW_TOLERANCE, clientPublicKey, clientPublicKey);
        assert(node);

        node = await driver.fetchSingleNode(nodeIdA, now-NOW_TOLERANCE-1, clientPublicKey, clientPublicKey);
        assert(!node);

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
        const keyPair1 = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();

        const now = Date.now();

        let rootNode = undefined;
        let clientPublicKey = keyPair1.publicKey;
        let parentId = Buffer.alloc(32).fill(0);

        const nodeA = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now + 1,
            isPublic: true,
            data: Buffer.from("A"),
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdA = nodeA.getProps().id1 as Buffer;

        const nodeB1 = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeA.getProps().id,
            expireTime: now + 10000,
            creationTime: now + 2,
            isPublic: true,
            data: Buffer.from("B1"),
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdB1 = nodeB1.getProps().id1 as Buffer;

        const nodeB2 = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeA.getProps().id,
            expireTime: now + 10000,
            creationTime: now + 3,
            isPublic: true,
            data: Buffer.from("B2"),
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdB2 = nodeB2.getProps().id1 as Buffer;

        const nodeC1 = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdB1,
            expireTime: now + 10000,
            creationTime: now + 4,
            isPublic: true,
            data: Buffer.from("C1"),
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdC1 = nodeC1.getProps().id1 as Buffer;

        const nodeC2 = nodeC1.copy(nodeIdB2, nodeC1.getProps().creationTime! + 1);
        nodeC2.sign(keyPair1);
        const nodeIdC2 = nodeC2.getProps().id1 as Buffer;

        const nodeD = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeC1.getProps().id,
            expireTime: now + 10000,
            creationTime: now + 5,
            isPublic: true,
            data: Buffer.from("D"),
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdD = nodeD.getProps().id1 as Buffer;

        const nodeE1 = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdD,
            expireTime: now + 10000,
            creationTime: now + 6,
            isPublic: true,
            data: Buffer.from("E1"),
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdE1 = nodeE1.getProps().id1 as Buffer;

        const nodeE2 = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdD,
            expireTime: now + 10000,
            creationTime: now + 7,
            isPublic: true,
            data: Buffer.from("E2"),
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdE2 = nodeE2.getProps().id1 as Buffer;

        let [id1s, parentIds] = await driver.store([nodeA, nodeB1, nodeB2, nodeC1, nodeC2, nodeD, nodeE1, nodeE2], now, true);
        assert(id1s.length === 8);


        let fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey: clientPublicKey,
            cutoffTime: BigInt(now),
            match: [
                {
                    nodeType: DataNodeTypeAlias,
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


        // Change transient state so we can re-store node.
        nodeA.storeFlags({isInactive: true});
        nodeA.pack(true);
        [id1s, parentIds] = await driver.store([nodeA], now + 1, true);
        assert(id1s.length === 1);
        nodes = await fetch(db, fetchRequest, now, rootNode);
        assert(nodes.length === 1)

        nodeA.storeFlags({isInactive: false});
        nodeA.pack(true);
        [id1s, parentIds] = await driver.store([nodeA], now + 1, true);
        assert(id1s.length === 1);

        nodes = await fetch(db, fetchRequest, now, rootNode);
        let same = diffNodes([nodeA, nodeB1, nodeB2, nodeC1, nodeC2, nodeD, nodeE1, nodeE2], nodes);
        assert(same)

        fetchRequest.query.cutoffTime = BigInt(now + 2);
        nodes = await fetch(db, fetchRequest, now, rootNode);
        assert(nodes.length === 0);

        //nodeC1.setOnlineValidated(false);
        [id1s, parentIds] = await driver.store([nodeC1], now + 3, true);
        assert(id1s.length === 1);

        nodeC1.storeFlags({isInactive: true});
        nodeC1.pack(true);
        [id1s, parentIds] = await driver.store([nodeC1], now + 3, true);
        assert(id1s.length === 1);

        nodes = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([nodeC1], nodes);
        assert(same);

        nodeC1.storeFlags({isInactive: false});
        nodeC1.pack(true);
        [id1s, parentIds] = await driver.store([nodeC1], now + 3, true);
        assert(id1s.length === 1);

        nodes = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([nodeC1, nodeD, nodeE1, nodeE2], nodes);
        assert(same);

        fetchRequest.query.cutoffTime = BigInt(now + 4);
        nodes = await fetch(db, fetchRequest, now, rootNode);
        assert(nodes.length === 0);

        [id1s, parentIds] = await driver.store([nodeC2, nodeE1], now + 5, true);
        assert(id1s.length === 2);

        nodeC2.storeFlags({isInactive: true});
        nodeC2.pack(true);
        nodeE1.storeFlags({isInactive: true});
        nodeE1.pack(true);
        [id1s, parentIds] = await driver.store([nodeC2, nodeE1], now + 5, true);
        assert(id1s.length === 2);

        nodes = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([nodeC2, nodeD, nodeE1, nodeE2], nodes);
        assert(same);
    });

    it("#bumpNodes", async function() {
        const driver = config.driver;
        const db = config.db;
        const keyPair1 = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();

        const now = Date.now();

        let rootNode = undefined;
        let clientPublicKey = keyPair1.publicKey;
        let parentId = Buffer.alloc(32).fill(0);


        const nodeA = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            hasRightsByAssociation: true,
            refId: Buffer.alloc(32).fill(100),
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdA = nodeA.getId1();

        const nodeB1 = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now + 1,
            hasRightsByAssociation: true,
            refId: Buffer.alloc(32).fill(100),
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdB1 = nodeB1.getId1();

        const nodeB2 = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now + 2,
            hasRightsByAssociation: true,
            refId: Buffer.alloc(32).fill(100),
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdB2 = nodeB2.getId1();

        let [id1s, parentIds] = await driver.store([nodeA, nodeB1, nodeB2], now);
        assert(id1s.length === 3);

        let ph = db.generatePlaceholders(2);
        let rows = await db.all(`SELECT * FROM openodin_nodes WHERE id1 IN ${ph}`, [nodeIdB1, nodeIdB2]);
        assert(rows.length === 2);
        assert(rows[0].bumphash.equals(rows[1].bumphash));

        const bumphash1 = rows[0].bumphash;
        let bumpedParentIds = await driver.bumpNodes([bumphash1], now + 10);

        assert(bumpedParentIds.length === 2);
        assert(bumpedParentIds[0].equals(nodeIdA));
        assert(bumpedParentIds[1].equals(nodeIdA));

        rows = await db.all(`SELECT * FROM openodin_nodes WHERE id1 IN ${ph}`, [nodeIdB1, nodeIdB2]);
        assert(rows.length === 2);
        assert(rows[0].updatetime === now + 10);
        assert(rows[1].updatetime === now + 10);
        assert(rows[0].trailupdatetime === now + 10);
        assert(rows[1].trailupdatetime === now + 10);


        ph = db.generatePlaceholders(1);
        rows = await db.all(`SELECT * FROM openodin_nodes WHERE id1 IN ${ph}`, [nodeIdA]);
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
        rows = await db.all(`SELECT * FROM openodin_nodes WHERE id1 IN ${ph}`, [nodeIdA, nodeIdB1, nodeIdB2]);
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
        const keyPair1 = Krypto.GenKeyPair();
        const keyPair2 = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();

        const now = Date.now();

        let rootNode = undefined;
        let clientPublicKey = keyPair1.publicKey;
        let clientPublicKey2 = keyPair2.publicKey;

        let parentId = Buffer.alloc(32).fill(0);

        const nodeA = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdA = nodeA.getId1();

        const nodeB1 = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now + 1,
            isLicensed: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdB1 = nodeB1.getId1();

            const licenseB1 = await nodeUtil.createLicenseNode({
                refId: nodeIdB1,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId: nodeIdA,
                expireTime: now + 10000,
                creationTime: now + 2,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdB1 = licenseB1.getId1();

        const nodeB2 = await nodeUtil.createDataNode({
            owner: clientPublicKey2,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now + 3,
            hasRightsByAssociation: true,
            refId: nodeIdB1,
        }, keyPair2.publicKey, keyPair2.secretKey);

        const nodeIdB2 = nodeB2.getId1();

        const nodeC1 = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdB1,
            expireTime: now + 10000,
            creationTime: now + 4,
            isPublic: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdC1 = nodeC1.getId1();

        const nodeC2 = nodeC1.copy(nodeIdB2, now + 5);
        nodeC2.sign(keyPair1);
        const nodeIdC2 = nodeC2.getId1();

        const nodeD = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdC1,
            expireTime: now + 10000,
            creationTime: now + 5,
            isPublic: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdD = nodeD.getId1();

        const nodeE1 = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdD,
            expireTime: now + 10000,
            creationTime: now + 6,
            isPublic: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdE1 = nodeE1.getId1();

        const nodeE2 = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdD,
            expireTime: now + 10000,
            creationTime: now + 7,
            isPublic: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdE2 = nodeE2.getId1();

        let [id1s, parentIds] = await driver.store([nodeA, nodeB1, nodeB2, nodeC1, nodeC2, nodeD, nodeE1, nodeE2], now);
        assert(id1s.length === 8);

        let fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey: clientPublicKey,
            cutoffTime: BigInt(now),
            match: [
                {
                    nodeType: DataNodeTypeAlias,
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

async function fetch(db: DBClient, fetchRequest: FetchRequest, now: number, rootNode?: BaseNodeInterface): Promise<BaseNodeInterface[]> {

    const nodes: BaseNodeInterface[] = [];
    let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
        nodes.push(...fetchReplyData.nodes ?? []);
    };

    let qp = new QueryProcessor(db, fetchRequest.query, rootNode, now, handleFetchReplyData);
    await qp.run();

    return nodes;
}

function diffNodes(nodes1: BaseNodeInterface[], nodes2: BaseNodeInterface[]): boolean {

    if (nodes1.length !== nodes2.length) {
        return false;
    }

    const diff: [BaseNodeInterface, BaseNodeInterface | undefined][] = [];

    const nodes1Length = nodes1.length;
    for (let i=0; i<nodes1Length; i++) {
        const node1 = nodes1[i];
        const node2 = nodes2[i];
        if (!(node1.getProps().id1 as Buffer).equals(node2.getProps().id1 as Buffer)) {
            console.error("nope1", node1.getProps().id1);
            console.error("nope1", node2.getProps().id1);
            return false;
        }
    }

    return true;
}
