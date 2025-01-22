import {
    assert,
} from "chai";

import {
    DatabaseUtil,
    Driver,
    BaseNodeInterface,
    NodeUtil,
    DBClient,
    TABLES,
    FetchRequest,
    FetchReplyData,
    DataNodeType,
    LicenseNodeType,
    UnpackCert,
    QueryProcessor,
    MatchState,
    Match,
    CMP,
    Hash,
    LicenseNodeEntry,
    SelectLicensingHash,
    ReverseFetch,
    LicenseNodeInterface,
    FriendCertInterface,
    SelectFriendCertPair,
    ParseSchema,
    FetchRequestSchema,
    KeyPair,
    Krypto,
    DataNodeInterface,
    FriendCert,
} from "../../src";

class DriverTestWrapper extends Driver {
    public async insertNodes(nodes: BaseNodeInterface[], now: number, preserveTransient: boolean = false): Promise<void> {
        return super.insertNodes(nodes, now, preserveTransient);
    }

    protected async storeNodes(nodes: BaseNodeInterface[], now: number, preserveTransient: boolean = false) {
        return super.storeNodes(nodes, now, preserveTransient);
    }
}

class QueryProcessorWrapper extends QueryProcessor {
    public prepareSQL(currentIds: Buffer[], offset: number): [string, number, any[]] {
        return super.prepareSQL(currentIds, offset);
    }

    public initNextLevel() {
        return super.initNextLevel();
    }

    public matchFirst(node: BaseNodeInterface, currentLevelMatches: [Match, MatchState][]): boolean {
        return super.matchFirst(node, currentLevelMatches);
    }

    public matchSecond(nodes: BaseNodeInterface[], currentLevelMatches: [Match, MatchState][]): BaseNodeInterface[] {
        return super.matchSecond(nodes, currentLevelMatches);
    }

    public async filterPrivateNodes(allNodes: BaseNodeInterface[], allowRightsByAssociation: boolean): Promise<[BaseNodeInterface[], BaseNodeInterface[]]> {
        return super.filterPrivateNodes(allNodes, allowRightsByAssociation);
    }

    public async filterLicensedNodes(nodes: BaseNodeInterface[], targetPublicKey: Buffer, includeLicenses: boolean = false):
        Promise<[nodes: BaseNodeInterface[], licenses: {[nodeId1: string]: {[licenseId1: string]: Buffer}}]> {
        return super.filterLicensedNodes(nodes, targetPublicKey, includeLicenses);
    }

    public async embedNodes(nodes: BaseNodeInterface[]): Promise<{originalNode: BaseNodeInterface, embeddedNode: BaseNodeInterface}[]> {
        return super.embedNodes(nodes);
    }

    public getLicenseNodeTree(node: BaseNodeInterface, sourcePublicKey: Buffer | undefined, targetPublicKey: Buffer): LicenseNodeEntry[] {
        return super.getLicenseNodeTree(node, sourcePublicKey, targetPublicKey);
    }

    public async fetchLicenses(licensesToCheck: Buffer[]): Promise<{[hash: string]: SelectLicensingHash[]}> {
        return super.fetchLicenses(licensesToCheck);
    }

    public async checkSourceNodesPermissions(nodeId1s: Buffer[]): Promise<{[id1: string]: boolean}> {
        return super.checkSourceNodesPermissions(nodeId1s);
    }

    public async applyFriendCerts(embeddingLicense: LicenseNodeInterface, aCert: FriendCertInterface, bCert: FriendCertInterface): Promise<boolean> {
        return super.applyFriendCerts(embeddingLicense, aCert, bCert);
    }

    public async getFriendCerts(licenseOwners: Buffer[]): Promise<{[hash: string]: SelectFriendCertPair[]}> {
        return super.getFriendCerts(licenseOwners);
    }
}

describe("QueryProcessor: SQLite WAL-mode", function() {
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

    setupTests(config);
});

describe("QueryProcessor: SQLiteJS WAL-mode", function() {
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

    setupTests(config);
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

    setupTests(config);
});

function setupTests(config: any) {
    it("#prepareSQL", function() {
        const db = config.db;

        assert(db);

        let rootNode = undefined;

        let now = 123;

        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
        };

        let sourcePublicKey = Buffer.alloc(32).fill(110);
        let targetPublicKey = Buffer.alloc(32).fill(110);

        let fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId: Buffer.alloc(32),
            sourcePublicKey,
            targetPublicKey,
            ignoreOwn: true,
            descending: false,
            ignoreInactive: true,
            region: "EU",
            jurisdiction: "FI",
            match: [
                {
                    nodeType: Buffer.from(DataNodeType),
                    filters: []
                }
            ]
        }});

        let qp = new QueryProcessorWrapper(db, fetchRequest.query, rootNode, now, handleFetchReplyData);

        let currentIds: Buffer[] = [Buffer.alloc(32).fill(1)];
        let offset = 10;

        const [sql, limit, params] = qp.prepareSQL(currentIds, offset);

        assert(sql);
        assert(params.length === 5);
    });

    it("#matchFirst", async function() {
        const driver = config.driver;
        const db = config.db;
        const keyPair1 = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            // Do nothing
        };

        let sourcePublicKey = keyPair1.publicKey;
        let targetPublicKey = Buffer.alloc(32).fill(110);
        let parentId = Buffer.alloc(32).fill(0);

        let rootNode = undefined;

        const nodeA = await nodeUtil.createDataNode({
            owner: sourcePublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdA = nodeA.getId1();

        const nodeB = await nodeUtil.createDataNode({
            owner: sourcePublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now + 1,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdB = nodeB.getId1();

        const nodeC = await nodeUtil.createDataNode({
            owner: sourcePublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now + 2,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdC = nodeC.getId1();

        const nodeAA = await nodeUtil.createDataNode({
            owner: sourcePublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now + 3,
            contentType: "app/one",
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdAA = nodeAA.getId1();

        const nodeBA = await nodeUtil.createDataNode({
            owner: sourcePublicKey,
            parentId: nodeIdB,
            expireTime: now + 10000,
            creationTime: now + 4,
            contentType: "app/hello",
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdBA = nodeBA.getId1();

        const nodeBB = await nodeUtil.createDataNode({
            owner: sourcePublicKey,
            parentId: nodeIdB,
            expireTime: now + 10000,
            creationTime: now + 5,
            contentType: "app/one",
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdBB = nodeBB.getId1();

        const nodeCA = await nodeUtil.createDataNode({
            owner: sourcePublicKey,
            parentId: nodeIdC,
            expireTime: now + 10000,
            creationTime: now + 6,
            contentType: "app/one",
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdCA = nodeCA.getId1();

        let fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey,
            targetPublicKey,
            match: [],
        }});

        let qp = new QueryProcessorWrapper(db, fetchRequest.query, rootNode, now, handleFetchReplyData);

        let match1 = {
            nodeType: Buffer.from(LicenseNodeType),
            filters: [],
        } as any as Match;

        let state1: MatchState = {
            counter: 0,
            cursorPassed: false,
            group: {},
            done: false,
        };

        let matches: [Match, MatchState][] = [ [match1, state1] ];
        qp.matchFirst(nodeA, matches);
        assert(getProcessState(nodeA, qp).matchIndexes.length === 0);
        assert(state1.counter === 0);


        let match2 = {
            nodeType: Buffer.from(DataNodeType),
            cursorId1: Buffer.alloc(0),
            filters: [
                {
                    field: "contentType",
                    operator: "",
                    cmp: CMP.EQ,
                    value: "app/hello",
                }
            ]
        } as any as Match;

        let state2: MatchState = {
            counter: 0,
            cursorPassed: false,
            group: {},
            done: false,
        };

        // Create cache
        getProcessState(nodeBA, qp);

        matches = [ [match2, state2] ];
        qp.matchFirst(nodeBA, matches);
        assert(getProcessState(nodeBA, qp).matchIndexes.length === 1);
        assert(state2.counter === 0);  // No state change.



        let match3 = {
            nodeType: Buffer.from(DataNodeType),
            cursorId1: Buffer.alloc(0),
            limitField: {
                name: "contentType",
                limit: 1,
            },
            filters: []
        } as any as Match;

        let state3: MatchState = {
            counter: 0,
            cursorPassed: false,
            group: {},
            done: false,
        };

        // Create cache
        getProcessState(nodeBB, qp);

        matches = [ [match3, state3] ];
        qp.matchFirst(nodeBB, matches);
        assert(getProcessState(nodeBB, qp).matchIndexes.length === 1);
        assert(state3.counter === 0);  // No state change.

        let hashed = nodeCA.hashField("contentType") as string;
        state3.group["contentType"] = {[hashed]: 1};

        // Create cache
        getProcessState(nodeCA, qp);

        qp.matchFirst(nodeCA, matches);

        assert(getProcessState(nodeCA, qp).matchIndexes.length === 0);
        assert(state3.counter === 0);  // No state change.

        let match4 = {
            nodeType: Buffer.from(DataNodeType),
            cursorId1: nodeIdBA,
            filters: []
        } as any as Match;

        let state4: MatchState = {
            counter: 0,
            cursorPassed: false,
            group: {},
            done: false,
        };


        matches = [ [match4, state4] ];
        qp.matchFirst(nodeB, matches);
        assert(state4.cursorPassed === false);
        assert(getProcessState(nodeB, qp).matchIndexes.length === 0);

        getProcessState(nodeBA, qp).matchIndexes.length = 0;
        matches = [ [match4, state4] ];
        qp.matchFirst(nodeBA, matches);
        //@ts-ignore
        assert(state4.cursorPassed === true);
        assert(getProcessState(nodeBA, qp).matchIndexes.length === 0);

        getProcessState(nodeCA, qp).matchIndexes.length = 0;
        qp.matchFirst(nodeCA, matches);
        assert(getProcessState(nodeCA, qp).matchIndexes.length === 1);
    });

    it("#matchSecond", async function() {
        const driver = config.driver;
        const db = config.db;
        const keyPair1 = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            // Do nothing
        };

        let sourcePublicKey = keyPair1.publicKey;
        let targetPublicKey = Buffer.alloc(32).fill(110);
        let parentId = Buffer.alloc(32).fill(0);

        let rootNode = undefined;

        const nodeA = await nodeUtil.createDataNode({
            owner: sourcePublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdA = nodeA.getId1();

        const nodeB = await nodeUtil.createDataNode({
            owner: sourcePublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now + 1,
            contentType: "app/hello",
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdB = nodeB.getId1();

        const nodeC = await nodeUtil.createDataNode({
            owner: sourcePublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now + 2,
            contentType: "app/hello",
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdC = nodeC.getId1();

        let fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey,
            targetPublicKey,
            match: [],
        }});

        let qp = new QueryProcessorWrapper(db, fetchRequest.query, rootNode, now, handleFetchReplyData);

        let match1 = {
            nodeType: Buffer.from(DataNodeType),
            filters: [],
            bottom: true,
            discard: true,
            limit: 1,
        } as any as Match;

        let state1: MatchState = {
            counter: 0,
            cursorPassed: false,
            group: {},
            done: false,
        };

        let match2 = {
            nodeType: Buffer.from(DataNodeType),
            filters: [],
            bottom: true,
            limitField: {
                name: "contentType",
                limit: 1,
            },
        } as any as Match;

        let state2: MatchState = {
            counter: 0,
            cursorPassed: false,
            group: {},
            done: false,
        };

        // Create cache
        getProcessState(nodeA, qp);

        getProcessState(nodeB, qp).matchIndexes.push(0, 1);
        getProcessState(nodeC, qp).matchIndexes.push(0, 1);
        let nodes = [nodeA, nodeB, nodeC];
        let matches: [Match, MatchState][] = [ [match1, state1], [match2, state2] ];
        let nodes2 = qp.matchSecond(nodes, matches);
        assert(nodes2.length === 1);
        assert(nodes2[0] === nodeB);
        assert(getProcessState(nodeB, qp).discard === false);
        assert(getProcessState(nodeB, qp).bottom === true);
    });

    it("#isInactive", async function() {
        const driver = config.driver;
        const db = config.db;
        const keyPair1 = Krypto.GenKeyPair();
        const keyPair2 = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let clientPublicKey = keyPair1.publicKey;
        let targetPublicKey = keyPair1.publicKey;
        let parentId = Buffer.alloc(32).fill(1);

        const nodeA = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdA = nodeA.getId1();

        const nodeB = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
        }, keyPair1.publicKey, keyPair1.secretKey);

        await driver.storeNodes([nodeA, nodeB], now);

        const fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            ignoreInactive: false,
            match: [
                {
                    nodeType: Buffer.from(DataNodeType),
                    filters: []
                }
            ]
        }});

        let nodes = await fetch(db, fetchRequest, now);
        assert(nodes.length == 2);

        nodeA.storeFlags({isInactive: true});

        await driver.storeNodes([nodeA], now + 1, true);

        nodes = await fetch(db, fetchRequest, now);
        assert(nodes.length == 1);

        fetchRequest.query.ignoreInactive = true;

        nodes = await fetch(db, fetchRequest, now);
        assert(nodes.length == 0);
    });

    it("#filterPrivateNodes", async function() {
        const driver = config.driver;
        const db = config.db;
        const keyPair1 = Krypto.GenKeyPair();
        const keyPair2 = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let sourcePublicKey = keyPair1.publicKey;
        let clientPublicKey2 = keyPair2.publicKey;
        let targetPublicKey = sourcePublicKey;
        let clientPublicKey3 = Buffer.alloc(32).fill(112);
        let parentId = Buffer.alloc(32).fill(0);

        let rootNode = undefined;

        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            // Do nothing
        };

        let fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey,
            targetPublicKey,
            match: [],
        }});

        let qp = new QueryProcessorWrapper(db, fetchRequest.query, rootNode, now, handleFetchReplyData);

        // Private
        const nodeA = await nodeUtil.createDataNode({
            owner: sourcePublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdA = nodeA.getId1();

        // Private to clientPublicKey2
        const nodeB = await nodeUtil.createDataNode({
            owner: clientPublicKey2,
            parentId,
            expireTime: now + 10000,
            creationTime: now + 1,
        }, keyPair2.publicKey, keyPair2.secretKey);

        const nodeIdB = nodeB.getId1();

        // Licensed
        const nodeC = await nodeUtil.createDataNode({
            owner: sourcePublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now + 2,
            isLicensed: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdC = nodeC.getId1();

        // Public
        const nodeD = await nodeUtil.createDataNode({
            owner: clientPublicKey2,
            parentId,
            expireTime: now + 10000,
            creationTime: now + 3,
            isPublic: true,
        }, keyPair2.publicKey, keyPair2.secretKey);

        const nodeIdD = nodeD.getId1();

        // hasRightsByAssociation
        const nodeE = await nodeUtil.createDataNode({
            owner: clientPublicKey2,
            parentId,
            expireTime: now + 10000,
            creationTime: now + 4,
            hasRightsByAssociation: true,
            refId: nodeIdA,
        }, keyPair2.publicKey, keyPair2.secretKey);

        const nodeIdE = nodeE.getId1();

        // Create embeddable node
        const nodeF = await nodeUtil.createLicenseNode({
            owner: clientPublicKey2,
            targetPublicKey: sourcePublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now + 5,
            extensions: 1,
        }, keyPair2.publicKey, keyPair2.secretKey);

        const nodeIdF = nodeF.getId1();

        // hasRightsByAssociation but different parentIds, so won't bring permissions.
        const nodeG = await nodeUtil.createDataNode({
            owner: clientPublicKey2,
            parentId: Buffer.alloc(32).fill(200),
            expireTime: now + 10000,
            creationTime: now + 6,
            hasRightsByAssociation: true,
            refId: nodeIdA,
        }, keyPair2.publicKey, keyPair2.secretKey);

        const nodeIdG = nodeG.getId1();

        let nodes = [nodeA, nodeB, nodeC, nodeD, nodeE, nodeF, nodeG];

        await driver.insertNodes(nodes, now);

        let [allowedNodes, nodesToEmbed] = await qp.filterPrivateNodes(nodes, false);

        assert(allowedNodes.length === 4);
        assert(allowedNodes[0] === nodeA);
        assert(allowedNodes[1] === nodeC);
        assert(allowedNodes[2] === nodeD);
        assert(allowedNodes[3] === nodeF);
        assert(nodesToEmbed.length === 0);

        [allowedNodes, nodesToEmbed] = await qp.filterPrivateNodes(nodes, true);
        assert(allowedNodes.length === 5);
        assert(allowedNodes[0] === nodeA);
        assert(allowedNodes[1] === nodeC);
        assert(allowedNodes[2] === nodeD);
        assert(allowedNodes[3] === nodeE);
        assert(allowedNodes[4] === nodeF);
        assert(nodesToEmbed.length === 0);



        fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey: sourcePublicKey,
            targetPublicKey: clientPublicKey3,
            match: [],
            embed: [
                {
                    nodeType: Buffer.from(LicenseNodeType),
                    filters: [],
                }
            ]
        }});

        qp = new QueryProcessorWrapper(db, fetchRequest.query, rootNode, now, handleFetchReplyData);

        [allowedNodes, nodesToEmbed] = await qp.filterPrivateNodes(nodes, false);
        assert(allowedNodes.length === 2);
        assert(nodesToEmbed.length === 1);
    });

    it("#getLicenseNodeTree", async function() {
        const driver = config.driver;
        const db = config.db;
        const keyPair1 = Krypto.GenKeyPair();
        const keyPair2 = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let clientPublicKey = keyPair1.publicKey;
        let clientPublicKey2 = keyPair2.publicKey;
        let rootNodeId = Buffer.alloc(32).fill(1);

        const node4A = await nodeUtil.createDataNode({
            parentId: rootNodeId,
            owner: clientPublicKey,
            creationTime: now,
            expireTime: now + 10000,
            isPublic: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        // License for node4A (which is not licensed).

        const nodeId4A = node4A.getId1();

        // Licensed
        const node3A = await nodeUtil.createDataNode({
            parentId: nodeId4A,
            owner: clientPublicKey,
            creationTime: now + 1,
            expireTime: now + 10000,
            isLicensed: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeId3A = node3A.getId1();

        // Licensed
        const node2A = await nodeUtil.createDataNode({
            parentId: nodeId3A,
            owner: clientPublicKey,
            creationTime: now + 1,
            expireTime: now + 10000,
            isLicensed: true,
            licenseMinDistance: 1,
            licenseMaxDistance: 1,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeId2A = node2A.getId1();

        // Licensed
        const node1A = await nodeUtil.createDataNode({
            parentId: nodeId2A,
            owner: clientPublicKey,
            creationTime: now,
            expireTime: now + 10000,
            isLicensed: true,
            licenseMinDistance: 2,
            licenseMaxDistance: 3,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeId1A = node1A.getId1();

        // Licensed
        const node2B = await nodeUtil.createDataNode({
            parentId: nodeId3A,  // note: not 3B
            owner: clientPublicKey,
            creationTime: now + 2,
            expireTime: now + 10001,
            isLicensed: true,
            licenseMinDistance: 1,
            licenseMaxDistance: 1,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeId2B = node2B.getId1();

        // Licensed
        const node1B = await nodeUtil.createDataNode({
            parentId: nodeId2B,
            owner: clientPublicKey,
            creationTime: now + 1,
            expireTime: now + 10001,
            isLicensed: true,
            licenseMinDistance: 1,
            licenseMaxDistance: 2,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeId1B = node1B.getId1();

        // Public
        const node3B = await nodeUtil.createDataNode({
            parentId: nodeId4A,
            owner: clientPublicKey,
            creationTime: now + 2,
            expireTime: now + 10001,
            isPublic: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        // Public

        const nodeId3B = node3B.getId1();

        const license4A = await nodeUtil.createLicenseNode({
            parentId: rootNodeId,
            refId: nodeId4A,
            owner: clientPublicKey,
            targetPublicKey: clientPublicKey,
            expireTime: now + 10000,
            creationTime: now,
        }, keyPair1.publicKey, keyPair1.secretKey);


        const licenseId4A = license4A.getId1();
        // License for node3A
        const license3A = await nodeUtil.createLicenseNode({
            parentId: nodeId4A,
            refId: nodeId3A,
            owner: clientPublicKey,
            targetPublicKey: clientPublicKey,
            expireTime: now + 10000,
            creationTime: now,
            parentPathHash: Hash(nodeId3A),
        }, keyPair1.publicKey, keyPair1.secretKey);

        const licenseId3A = license3A.getId1();

        // Second license for node3A
        const license3A2 = await nodeUtil.createLicenseNode({
            parentId: nodeId4A,
            refId: nodeId3A,
            owner: clientPublicKey,
            targetPublicKey: clientPublicKey2,
            expireTime: now + 10000,
            creationTime: now+2,
            disallowRetroLicensing: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const licenseId3A2 = license3A2.getId1();

        // Third license for node3A
        const license3A3 = await nodeUtil.createLicenseNode({
            parentId: nodeId4A,
            refId: nodeId3A,
            owner: clientPublicKey,
            targetPublicKey: clientPublicKey2,
            expireTime: now + 10001,
            creationTime: now-1,
            disallowRetroLicensing: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const licenseId3A3 = license3A3.getId1();

        let rootNode = undefined;

        let fetchedNodes: BaseNodeInterface[] = [];
        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            fetchedNodes.push(...fetchReplyData.nodes ?? []);
        };

        await driver.storeNodes([node1A, node1B, node2A, node2B, node3A, node3B, node4A, license4A], now, true);

        let fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId: rootNodeId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey: clientPublicKey,
            match: [
                {
                    nodeType: Buffer.from(DataNodeType),
                    filters: [],
                }
            ],
        }});

        let qp = new QueryProcessorWrapper(db, fetchRequest.query, rootNode, now, handleFetchReplyData);

        let entries = qp.getLicenseNodeTree(node1A, undefined, clientPublicKey);
        assert(entries.length === 1);

        await qp.run();

        assert(fetchedNodes.length === 2);
        assert((fetchedNodes[0].getId1() as Buffer).equals(nodeId4A));
        assert((fetchedNodes[1].getId1() as Buffer).equals(nodeId3B));

        entries = qp.getLicenseNodeTree(node1A, undefined, clientPublicKey);
        assert(entries.length === 1);

        await driver.storeNodes([license3A], now, true);
        fetchedNodes.length = 0;

        qp.setProcessedCache({});  // reset so we can run again.

        await qp.run();

        assert(fetchedNodes.length === 7);
        assert((fetchedNodes[0].getId1() as Buffer).equals(nodeId4A));
        assert((fetchedNodes[1].getId1() as Buffer).equals(nodeId3A));
        assert((fetchedNodes[2].getId1() as Buffer).equals(nodeId3B));
        assert((fetchedNodes[3].getId1() as Buffer).equals(nodeId2A));
        assert((fetchedNodes[4].getId1() as Buffer).equals(nodeId2B));
        assert((fetchedNodes[5].getId1() as Buffer).equals(nodeId1A));
        assert((fetchedNodes[6].getId1() as Buffer).equals(nodeId1B));

        entries = qp.getLicenseNodeTree(node1A, undefined, clientPublicKey);
        assert(entries.length === 3);

        // Test for different targetPublicKey
        fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId: rootNodeId,
            sourcePublicKey: clientPublicKey2,
            targetPublicKey: clientPublicKey2,
            match: [
                {
                    nodeType: Buffer.from(DataNodeType),
                    filters: [],
                }
            ],
        }});

        qp = new QueryProcessorWrapper(db, fetchRequest.query, rootNode, now, handleFetchReplyData);

        fetchedNodes.length = 0;
        await qp.run();

        assert(fetchedNodes.length === 2);
        assert((fetchedNodes[0].getId1() as Buffer).equals(nodeId4A));
        assert((fetchedNodes[1].getId1() as Buffer).equals(nodeId3B));

        await driver.storeNodes([license3A2], now, true);
        fetchedNodes.length = 0;

        qp.setProcessedCache({});  // reset so we can run again.

        await qp.run();

        assert(fetchedNodes.length === 2);

        await driver.storeNodes([license3A3], now, true);
        fetchedNodes.length = 0;

        qp.setProcessedCache({});  // reset so we can run again.

        await qp.run();

        assert(fetchedNodes.length === 7);
        assert((fetchedNodes[0].getId1() as Buffer).equals(nodeId4A));
        assert((fetchedNodes[1].getId1() as Buffer).equals(nodeId3A));
        assert((fetchedNodes[2].getId1() as Buffer).equals(nodeId3B));
        assert((fetchedNodes[3].getId1() as Buffer).equals(nodeId2A));
        assert((fetchedNodes[4].getId1() as Buffer).equals(nodeId2B));
        assert((fetchedNodes[5].getId1() as Buffer).equals(nodeId1A));
        assert((fetchedNodes[6].getId1() as Buffer).equals(nodeId1B));

        // TODO test more of pathHash, disallowParentLicensing, hasOnline, isOnline, hasOnlineValidation.
        // TODO test even more complex trees.
        // TODO test for licensed embedded (and moved) nodes.
    });

    it("#filterLicensedNodes basic test", async function() {
        const driver = config.driver;
        const db = config.db;
        const keyPair2 = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let targetPublicKey = Buffer.alloc(32).fill(110);
        let clientPublicKey2 = keyPair2.publicKey;
        let parentId = Buffer.alloc(32).fill(0);

        // Licensed
        const nodeA1 = await nodeUtil.createDataNode({
            owner: clientPublicKey2,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
        }, keyPair2.publicKey, keyPair2.secretKey);

        const nodeIdA1 = nodeA1.getId1();

        // License
        const nodeL1 = await nodeUtil.createLicenseNode({
            owner: clientPublicKey2,
            targetPublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            extensions: 1,
            refId: nodeIdA1,
        }, keyPair2.publicKey, keyPair2.secretKey);

        const nodeIdL1 = nodeL1.getId1();

        let rootNode = undefined;

        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            // Do nothing
        };

        await driver.storeNodes([nodeA1, nodeL1], now);

        let fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey: targetPublicKey,
            targetPublicKey,
            match: [],
        }});

        let qp = new QueryProcessorWrapper(db, fetchRequest.query, rootNode, now, handleFetchReplyData);

        let [licensedNodes] = await qp.filterLicensedNodes([nodeA1], fetchRequest.query.targetPublicKey);
        assert(licensedNodes.length === 1);
        assert(licensedNodes[0] === nodeA1);
    });

    it("#embedNodes", async function() {
        const driver = config.driver;
        const db = config.db;
        const keyPair1 = Krypto.GenKeyPair();
        const keyPair2 = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let clientPublicKey = keyPair1.publicKey;
        let clientPublicKey2 = keyPair2.publicKey;
        let targetPublicKey = Buffer.alloc(32).fill(112);
        let parentId = Buffer.alloc(32).fill(0);

        let rootNode = undefined;

        // Create embeddable node
        const nodeF = await nodeUtil.createLicenseNode({
            owner: clientPublicKey2,
            targetPublicKey: clientPublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            extensions: 1,
            refId: Buffer.alloc(32),
        }, keyPair2.publicKey, keyPair2.secretKey);

        const nodeIdF = nodeF.getId1();

        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            // Do nothing
        };

        let fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            match: [],
        }});

        let qp = new QueryProcessorWrapper(db, fetchRequest.query, rootNode, now, handleFetchReplyData);

        let embed = await qp.embedNodes([nodeF]);
        assert(embed.length === 1);

        const nodeF2 = embed[0].embeddedNode;
        nodeF2.sign(keyPair1);
        nodeF2.pack();
        const nodeIdF2 = nodeF2.getId1();

        await driver.storeNodes([nodeF2], now);

        embed = await qp.embedNodes([nodeF]);
        assert(embed.length === 0);
    });

    it("#run", async function() {
        const driver = config.driver;
        const db = config.db;
        const keyPair1 = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let rootNode = undefined;

        let clientPublicKey = keyPair1.publicKey;
        let targetPublicKey = keyPair1.publicKey;
        let parentId = Buffer.alloc(32).fill(0);

        const nodeA = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdA = nodeA.getId1();

        const nodeB = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now + 1,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdB = nodeB.getId1();

        const nodeC = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now + 2,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdC = nodeC.getId1();

        const nodeAA = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now + 3,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdAA = nodeAA.getId1();

        const nodeBA = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdB,
            expireTime: now + 10000,
            creationTime: now + 4,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdBA = nodeBA.getId1();


        const nodeBB = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdB,
            expireTime: now + 10000,
            creationTime: now + 5,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdBB = nodeBB.getId1();

        const nodeCA = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdC,
            expireTime: now + 10000,
            creationTime: now + 6,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdCA = nodeCA.getId1();


        assert(nodeA.canSendPrivately(clientPublicKey, targetPublicKey));
        assert(nodeAA.canSendPrivately(clientPublicKey, targetPublicKey));

        await driver.insertNodes([nodeA, nodeB, nodeC, nodeAA, nodeBA, nodeBB, nodeCA], now);

        let gottenNodes: BaseNodeInterface[] = [];
        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            gottenNodes.push(...fetchReplyData.nodes ?? []);
        };

        let fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            match: [
                {
                    nodeType: Buffer.from(DataNodeType),
                    filters: []
                }
            ]
        }});

        let qp = new QueryProcessorWrapper(db, fetchRequest.query, rootNode, now, handleFetchReplyData);
        await qp.run();

        assert(gottenNodes.length === 7);
        assert((gottenNodes[0].getId1() as Buffer).equals(nodeIdA));
        assert((gottenNodes[1].getId1() as Buffer).equals(nodeIdB));
        assert((gottenNodes[2].getId1() as Buffer).equals(nodeIdC));
        assert((gottenNodes[3].getId1() as Buffer).equals(nodeIdAA));
        assert((gottenNodes[4].getId1() as Buffer).equals(nodeIdBA));
        assert((gottenNodes[5].getId1() as Buffer).equals(nodeIdBB));
        assert((gottenNodes[6].getId1() as Buffer).equals(nodeIdCA));
    });

    it("#run basic queries", async function() {
        const driver = config.driver;
        const db = config.db;
        const keyPair1 = Krypto.GenKeyPair();
        const keyPair2 = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const now = Date.now();

        let rootNode = undefined;

        let clientPublicKey = keyPair1.publicKey;
        let targetPublicKey = keyPair1.publicKey;
        let clientPublicKey2 = keyPair2.publicKey;
        let parentId = Buffer.alloc(32).fill(1);

        const lvl1 = await createNodes(keyPair2, 10, {parentId, owner: clientPublicKey2, isPublic: true}, now, "lvl1");

        const parentId1a = lvl1[0].getId1();
        const lvl2a = await createNodes(keyPair1, 10, {parentId: parentId1a, owner: clientPublicKey}, now, "lvl2a");

        const parentId1b = lvl1[1].getId1();
        const lvl2b = await createNodes(keyPair1, 10, {parentId: parentId1b, owner: clientPublicKey}, now+1000, "lvl2b");

        const parentId2a = lvl2a[0].getId1();
        const lvl3a = await createNodes(keyPair1, 10, {parentId: parentId2a, owner: clientPublicKey, region: "SE"}, now+2000, "lvl3a");

        const parentId3a = lvl3a[9].getId1();
        const lvl4a = await createNodes(keyPair1, 10, {parentId: parentId3a, owner: clientPublicKey, jurisdiction: "FI"}, now+3000, "lvl4a");

        let nodes1 = [...lvl1, ...lvl2a, ...lvl2b];

        await driver.storeNodes([...nodes1, ...lvl3a, ...lvl4a], now);

        let fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            region: "EU",
            jurisdiction: "FI",
            match: [
                {
                    nodeType: Buffer.from(DataNodeType),
                    filters: []
                }
            ]
        }});

        let nodes2 = await fetch(db, fetchRequest, now, rootNode);
        let same = diffNodes(nodes1, nodes2);
        assert(same);

        // Fetch in reverse order and fail
        //
        fetchRequest.query.descending = true;
        nodes2 = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes(nodes1, nodes2);
        assert(!same);

        // Fetch in reverse order and succeed
        //
        fetchRequest.query.descending = true;
        nodes1 = [...lvl1.slice().reverse(), ...lvl2b.slice().reverse(), ...lvl2a.slice().reverse()];
        nodes2 = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes(nodes1, nodes2);
        assert(same);



        fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            region: "SE",
            match: [
                {
                    nodeType: Buffer.from(DataNodeType),
                    filters: []
                }
            ]
        }});

        nodes2 = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([...lvl1, ...lvl2a, ...lvl2b, ...lvl3a, ...lvl4a], nodes2);
        assert(same);


        fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            jurisdiction: "FI",
            match: [
                {
                    nodeType: Buffer.from(DataNodeType),
                    filters: []
                }
            ]
        }});

        nodes2 = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([...lvl1, ...lvl2a, ...lvl2b, ...lvl3a, ...lvl4a], nodes2);
        assert(same);

        fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            region: "FI",
            jurisdiction: "FI",
            match: [
                {
                    nodeType: Buffer.from(DataNodeType),
                    filters: []
                }
            ]
        }});

        nodes2 = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([...lvl1, ...lvl2a, ...lvl2b], nodes2);
        assert(same);

        fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            region: "FI",
            jurisdiction: "FI",
            ignoreOwn: true,
            ignoreInactive: true,
            match: [
                {
                    nodeType: Buffer.from(DataNodeType),
                    filters: []
                }
            ]
        }});

        nodes2 = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([...lvl1], nodes2);
        assert(same);


        const node0 = lvl1[0];
        await driver.insertNodes([node0], now);

        fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            region: "FI",
            jurisdiction: "FI",
            ignoreOwn: true,
            ignoreInactive: true,
            match: [
                {
                    nodeType: Buffer.from(DataNodeType),
                    filters: []
                }
            ]
        }});

        nodes2 = await fetch(db, fetchRequest, now, rootNode);
        assert(nodes2.length == lvl1.length);
    });

    it("#run basic query sorted on negative creationTime (sliding window)", async function() {
        const driver = config.driver;
        const db = config.db;
        const keyPair1 = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let rootNode = undefined;

        let owner = keyPair1.publicKey;
        let parentId = Buffer.alloc(32).fill(0x01);

        const lvl1 = await createNodes(keyPair1, 3, {parentId, owner, isPublic: true}, now, "lvl1");

        const parentId1a = lvl1[2].getId1();

        const lvl2 = await createNodes(keyPair1, 3, {parentId: parentId1a, owner}, now, "lvl2a");

        await driver.storeNodes([...lvl1], now);

        await driver.storeNodes([lvl2[0]], now);
        await driver.storeNodes([lvl2[1]], now);
        await driver.storeNodes([lvl2[2]], now);

        let fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey: owner,
            targetPublicKey: owner,
            match: [
                {
                    nodeType: Buffer.from(DataNodeType),
                    filters: [
                        {
                            field: "creationTime",
                            operator: "",
                            value: "-10",
                            cmp: CMP.GT,
                        }
                    ]
                }
            ]
        }});

        let nodes2 = await fetch(db, fetchRequest, now + 11, rootNode);

        let same = diffNodes([lvl1[2], lvl2[2]], nodes2);
        assert(same);
    });

    it("#run basic query sorted on storageTime", async function() {
        const driver = config.driver;
        const db = config.db;
        const keyPair1 = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const now = Date.now();

        let rootNode = undefined;

        let owner = keyPair1.publicKey;
        let parentId = Buffer.alloc(32).fill(0x01);

        const lvl1 = await createNodes(keyPair1, 3, {parentId, owner, isPublic: true}, now, "lvl1");

        const parentId1a = lvl1[2].getId1();

        const lvl2 = await createNodes(keyPair1, 3, {parentId: parentId1a, owner}, now, "lvl2a");

        await driver.storeNodes([...lvl1], now);

        await driver.storeNodes([lvl2[0]], now + 1);
        await driver.storeNodes([lvl2[1]], now + 3);
        await driver.storeNodes([lvl2[2]], now + 2);

        const fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey: owner,
            targetPublicKey: owner,
            orderByStorageTime: true,
            match: [
                {
                    nodeType: Buffer.from(DataNodeType),
                    filters: []
                }
            ]
        }});

        let nodes2 = await fetch(db, fetchRequest, now, rootNode);

        let same = diffNodes([...lvl1, lvl2[0], lvl2[2], lvl2[1]], nodes2);
        assert(same);

        fetchRequest.query.descending = true;

        nodes2 = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([...lvl1.slice().reverse(), lvl2[1], lvl2[2], lvl2[0]], nodes2);
        assert(same);
    });

    it("#run depth, disallowPublicChildren, childMinDifficulty, onlyOwnChildren, rootNode, discardRoot", async function() {
        const driver = config.driver;
        const db = config.db;
        const keyPair1 = Krypto.GenKeyPair();
        const keyPair2 = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const now = Date.now();

        let rootNode = undefined;

        let clientPublicKey = keyPair1.publicKey;
        let targetPublicKey = keyPair1.publicKey;
        let clientPublicKey2 = keyPair2.publicKey;
        let parentId = Buffer.alloc(32).fill(1);

        const lvl1 = await createNodes(keyPair1, 10, {parentId, owner: clientPublicKey, isPublic: true, disallowPublicChildren: true}, now, "lvl1");

        const parentId1a = lvl1[0].getId1();
        const lvl2a = await createNodes(keyPair1, 10, {parentId: parentId1a, owner: clientPublicKey, isPublic: false, onlyOwnChildren: true}, now, "lvl2a");

        const lvl2b = await createNodes(keyPair1, 10, {parentId: parentId1a, owner: clientPublicKey, isPublic: true}, now, "lvl2b");

        const parentId2a = lvl2a[0].getId1();
        const lvl3a = await createNodes(keyPair2, 10, {parentId: parentId2a, owner: clientPublicKey2, isPublic: true}, now, "lvl3a");

        const lvl3b = await createNodes(keyPair1, 10, {parentId: parentId2a, owner: clientPublicKey, isPublic: true, childMinDifficulty: 3}, now, "lvl3b");

        const parentId3a = lvl3b[0].getId1();
        const lvl4a = await createNodes(keyPair1, 10, {parentId: parentId3a, owner: clientPublicKey, isPublic: true, difficulty: 3}, now, "lvl4a");

        const lvl4b = await createNodes(keyPair1, 10, {parentId: parentId3a, owner: clientPublicKey, isPublic: true}, now, "lvl4b");


        await driver.storeNodes([...lvl1, ...lvl2a, ...lvl2b, ...lvl3a, ...lvl3b, ...lvl4a, ...lvl4b], now);

        let fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            depth: 3,
            match: [
                {
                    nodeType: Buffer.from(DataNodeType),
                    filters: []
                }
            ]
        }});

        let nodes2 = await fetch(db, fetchRequest, now, rootNode);
        let same = diffNodes([...lvl1, ...lvl2a, ...lvl3b], nodes2);
        assert(same);

        fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            depth: 4,
            match: [
                {
                    nodeType: Buffer.from(DataNodeType),
                    filters: []
                }
            ]
        }});

        nodes2 = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([...lvl1, ...lvl2a, ...lvl3b, ...lvl4a], nodes2);
        assert(same);


        rootNode = lvl1[0];
        fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            depth: 1,
            discardRoot: false,
            limit: 2,
            match: [
                {
                    nodeType: Buffer.from(DataNodeType),
                    filters: []
                }
            ]
        }});

        nodes2 = await fetch(db, fetchRequest, now, rootNode);
        assert(nodes2.length === 2);
        assert((nodes2[0].getId1() as Buffer).equals(rootNode.getId1() as Buffer));
        assert((nodes2[1].getId1() as Buffer).equals(lvl2a[0].getId1() as Buffer));


        fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            depth: 1,
            discardRoot: true,
            limit: 2,
            cutoffTime: BigInt(now),
            match: [
                {
                    nodeType: Buffer.from(DataNodeType),
                    filters: []
                }
            ]
        }});
        nodes2 = await fetch(db, fetchRequest, now, rootNode);
        assert(nodes2.length === 2);
        assert((nodes2[0].getId1() as Buffer).equals(lvl2a[0].getId1() as Buffer));
        assert((nodes2[1].getId1() as Buffer).equals(lvl2a[1].getId1() as Buffer));


        fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            depth: 1,
            discardRoot: true,
            limit: 2,
            cutoffTime: BigInt(now+1),
            match: [
                {
                    nodeType: Buffer.from(DataNodeType),
                    filters: []
                }
            ]
        }});
        nodes2 = await fetch(db, fetchRequest, now, rootNode);
        assert(nodes2.length === 0);
    });

    it("#run match path", async function() {
        const driver = config.driver;
        const db = config.db;
        const keyPair1 = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const now = Date.now();

        let rootNode = undefined;

        let clientPublicKey = keyPair1.publicKey;
        let targetPublicKey = keyPair1.publicKey;
        let clientPublicKey2 = Buffer.alloc(32).fill(112);
        let parentId = Buffer.alloc(32).fill(1);


        const lvl1 = await createNodes(keyPair1, 10, {parentId, owner: clientPublicKey, isPublic: true}, now, "lvl1");

        const parentId1a = lvl1[0].getId();
        const lvl2a = await createNodes(keyPair1, 10, {parentId: parentId1a, owner: clientPublicKey, isPublic: true}, now, "lvl2a");

        const lvl2b = await createNodes(keyPair1, 10, {parentId: parentId1a, owner: clientPublicKey, isPublic: true}, now+1000, "lvl2b");

        const parentId2a = lvl2a[0].getId();
        const lvl3a = await createNodes(keyPair1, 10, {parentId: parentId2a, owner: clientPublicKey, isPublic: true}, now, "lvl3a");

        const parentId2b = lvl2b[0].getId();
        const lvl3b = await createNodes(keyPair1, 10, {parentId: parentId2b, owner: clientPublicKey, isPublic: true}, now+1000, "lvl3b");

        await driver.storeNodes([...lvl1, ...lvl2a, ...lvl2b, ...lvl3a, ...lvl3b], now);

        let fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            match: [
                {
                    level: [1],
                    nodeType: Buffer.from(DataNodeType),
                    filters: []
                },
                {
                    id: 100,
                    level: [2],
                    nodeType: Buffer.from(DataNodeType),
                    filters: [
                        {
                            field: "data",
                            operator: ":0,5",
                            cmp: CMP.EQ,
                            value: Buffer.from("lvl2a").toString("hex"),
                        }
                    ]
                },
                {
                    id: 101,
                    level: [2],
                    nodeType: Buffer.from(DataNodeType),
                    filters: [
                        {
                            field: "data",
                            operator: ":0,5",
                            cmp: CMP.EQ,
                            value: Buffer.from("lvl2b").toString("hex"),
                        }
                    ]
                },
                {
                    requireId: 100,
                    level: [3],
                    nodeType: Buffer.from(DataNodeType),
                    filters: []
                },
                {
                    requireId: 101,
                    limit: 5,
                    level: [3],
                    nodeType: Buffer.from(DataNodeType),
                    filters: []
                }
            ]
        }});

        let nodes2 = await fetch(db, fetchRequest, now, rootNode);
        let same = diffNodes([...lvl1, ...lvl2a, ...lvl2b, ...lvl3a, ...lvl3b.slice(0,5)], nodes2);
        assert(same);
    });

    it("#run updatetime/trailupdatetime", async function() {
        const driver = config.driver;
        const db = config.db;
        const keyPair1 = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let rootNode = undefined;

        let clientPublicKey = keyPair1.publicKey;
        let targetPublicKey = keyPair1.publicKey;
        let clientPublicKey2 = Buffer.alloc(32).fill(112);
        let parentId = Buffer.alloc(32).fill(1);


        const lvl1 = await createNodes(keyPair1, 10, {hasOnlineValidation: true, isOnlineValidated: true, parentId,
            owner: clientPublicKey, isPublic: true}, now, "lvl1");

        const parentId1a = lvl1[0].getId();
        const lvl2a = await createNodes(keyPair1, 10, {parentId: parentId1a, owner: clientPublicKey, isPublic: true}, now, "lvl2a");

        const lvl2b = await createNodes(keyPair1, 10, {parentId: parentId1a, owner: clientPublicKey, isPublic: true}, now+1000, "lvl2b");

        const parentId2a = lvl2a[0].getId();
        const lvl3a = await createNodes(keyPair1, 10, {hasOnlineValidation: true, isOnlineValidated: true,
            parentId: parentId2a, owner: clientPublicKey, isPublic: true}, now, "lvl3a");

        const parentId2b = lvl2b[0].getId();
        const lvl3b = await createNodes(keyPair1, 10, {parentId: parentId2b, owner: clientPublicKey, isPublic: true}, now+1000, "lvl3b");

        await driver.storeNodes([...lvl1, ...lvl2a, ...lvl2b, ...lvl3a, ...lvl3b], now, false);

        let fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            cutoffTime: 0n,
            match: [
                {
                    level: [],
                    nodeType: Buffer.from(DataNodeType),
                    filters: []
                },
            ]
        }});

        let nodes2 = await fetch(db, fetchRequest, now, rootNode);
        let same = diffNodes([...lvl1, ...lvl2a, ...lvl2b, ...lvl3a, ...lvl3b], nodes2);
        assert(same);

        fetchRequest.query.cutoffTime = BigInt(now);
        nodes2 = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([...lvl1, ...lvl2a, ...lvl2b, ...lvl3a, ...lvl3b], nodes2);
        assert(same);

        let now2 = now + 1;
        fetchRequest.query.cutoffTime = BigInt(now2);
        nodes2 = await fetch(db, fetchRequest, now, rootNode);
        assert(nodes2.length === 0);


        let node = lvl1[5];
        await driver.storeNodes([node], now2);
        nodes2 = await fetch(db, fetchRequest, now, rootNode);
        assert(nodes2.length === 0);

        // Update the transient hash, restore it.
        // the now2 will now be set as the storageTime of the node.
        //
        node.storeFlags({isInactive: false});
        node.pack(true);
        await driver.storeNodes([node], now2, false);
        nodes2 = await fetch(db, fetchRequest, now, rootNode);
        assert(nodes2.length === 0);

        await driver.storeNodes([node], now2, true);
        nodes2 = await fetch(db, fetchRequest, now, rootNode);
        assert(nodes2.length === 1);
        assert((nodes2[0].getId1() as Buffer).equals(node.getId1() as Buffer));

        let now3 = now2 + 1;
        fetchRequest.query.cutoffTime = BigInt(now3);
        nodes2 = await fetch(db, fetchRequest, now, rootNode);
        assert(nodes2.length === 0);

        // Update a node on third level.
        //
        node = lvl3a[5];
        node.storeFlags({isInactive: false});
        node.pack(true);
        await driver.storeNodes([node], now3, false);
        nodes2 = await fetch(db, fetchRequest, now, rootNode);
        assert(nodes2.length === 0);

        // Update transient hash so storageTime does get updated.
        //
        let [id1s, parentIds] = await driver.store([node], now3, true);
        assert(id1s.length === 1);
        assert(parentIds.length === 1);
        nodes2 = await fetch(db, fetchRequest, now, rootNode);
        assert(nodes2.length === 1);
    });

    it("#detectLoop", async function() {
        const driver = config.driver;
        const db = config.db;
        const keyPair1 = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let rootNode = undefined;

        let clientPublicKey = keyPair1.publicKey;
        let targetPublicKey = keyPair1.publicKey;
        let parentId = Buffer.alloc(32).fill(1);

        const lvl1 = await createNodes(keyPair1, 10, {parentId, owner: clientPublicKey, isPublic: true}, now, "lvl1");

        const parentId1a = lvl1[0].getId1();
        const lvl2a = await createNodes(keyPair1, 10, {parentId: parentId1a, owner: clientPublicKey}, now, "lvl2a");

        const parentId1b = lvl1[1].getId1();
        const lvl2b = await createNodes(keyPair1, 10, {parentId: parentId1b, owner: clientPublicKey}, now+1000, "lvl2b");

        const parentId2a = lvl2a[0].getId1();
        const lvl3a = await createNodes(keyPair1, 10, {parentId: parentId2a, owner: clientPublicKey}, now+2000, "lvl3a");

        const parentId3a = lvl3a[9].getId1();
        const lvl4a = await createNodes(keyPair1, 10, {parentId: parentId3a, owner: clientPublicKey}, now+3000, "lvl4a");

        const cyclicNode = (lvl1[0] as DataNodeInterface).copy(parentId3a);
        cyclicNode.sign(keyPair1);

        let nodes1 = [...lvl1, ...lvl2a, ...lvl2b, ...lvl3a, ...lvl4a, cyclicNode];

        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            // Do nothing
        };

        await driver.storeNodes(nodes1, now);

        let fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey: clientPublicKey,
            match: [
                {
                    nodeType: Buffer.alloc(0),
                    filters: [],
                }],
        }});

        let qp = new QueryProcessorWrapper(db, fetchRequest.query, rootNode, now, handleFetchReplyData);

        // Undetected loops will cause infinite looping.
        await qp.run();
    });

    it("restrictiveWriterNodes #1 - begin single write mode", async function() {
        const driver = config.driver;
        const db = config.db;
        const keyPair1 = Krypto.GenKeyPair();
        const keyPair2 = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            // Do nothing
        };

        let clientPublicKey = keyPair1.publicKey;
        let clientPublicKey2 = keyPair2.publicKey;
        let targetPublicKey = clientPublicKey;
        let parentId = Buffer.alloc(32).fill(0);

        let rootNode = undefined;

        const nodeA = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdA = nodeA.getId1();

        const nodeB = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            isBeginRestrictiveWriteMode: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdB = nodeB.getId1();

        const nodeC = await nodeUtil.createDataNode({
            owner: clientPublicKey2,
            parentId: nodeIdB,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        }, keyPair2.publicKey, keyPair2.secretKey);

        const nodeIdC = nodeC.getId1();

        await driver.storeNodes([nodeA, nodeB, nodeC], now);

        let fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            match: [
                {
                    nodeType: Buffer.from(DataNodeType),
                    filters: []
                },
            ]
        }});

        let nodes = await fetch(db, fetchRequest, now, rootNode);
        let same = diffNodes([nodeA, nodeB], nodes);
        assert(same);

        const nodeL1 = await nodeUtil.createLicenseNode({
            owner: clientPublicKey,
            targetPublicKey: clientPublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            refId: nodeIdB,
            restrictiveModeWriter: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdL1 = nodeL1.getId1();

        await driver.storeNodes([nodeL1], now);

        nodes = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([nodeA, nodeB], nodes);
        assert(same);


        const nodeL1b = await nodeUtil.createLicenseNode({
            owner: clientPublicKey,
            targetPublicKey: clientPublicKey2,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            refId: nodeIdB,
            restrictiveModeWriter: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdL1b = nodeL1b.getId1();

        await driver.storeNodes([nodeL1b], now);

        nodes = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([nodeA, nodeB, nodeC], nodes);
        assert(same);
    });

    it("restrictiveWriterNodes #2 - begin two consecutive write modes of different authors", async function() {
        const driver = config.driver;
        const db = config.db;
        const keyPair1 = Krypto.GenKeyPair();
        const keyPair2 = Krypto.GenKeyPair();
        const keyPair3 = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            // Do nothing
        };

        let clientPublicKey = keyPair1.publicKey;
        let clientPublicKey2 = keyPair2.publicKey;
        let clientPublicKey3 = keyPair3.publicKey;
        let parentId = Buffer.alloc(32).fill(0);

        let rootNode = undefined;

        const nodeA = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
            isBeginRestrictiveWriteMode: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdA = nodeA.getId1();

        const nodeB = await nodeUtil.createDataNode({
            owner: clientPublicKey2,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
            isBeginRestrictiveWriteMode: true,
        }, keyPair2.publicKey, keyPair2.secretKey);

        const nodeIdB = nodeB.getId1();

        const nodeC = await nodeUtil.createDataNode({
            owner: clientPublicKey3,
            parentId: nodeIdB,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        }, keyPair3.publicKey, keyPair3.secretKey);

        const nodeIdC = nodeC.getId1();

        await driver.storeNodes([nodeA, nodeB, nodeC], now);

        let fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey: clientPublicKey,
            match: [
                {
                    nodeType: Buffer.from(DataNodeType),
                    filters: []
                },
            ]
        }});

        let nodes = await fetch(db, fetchRequest, now, rootNode);
        let same = diffNodes([nodeA], nodes);
        assert(same);

        const nodeL1 = await nodeUtil.createLicenseNode({
            owner: clientPublicKey,
            targetPublicKey: clientPublicKey2,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            refId: nodeIdA,
            restrictiveModeWriter: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdL1 = nodeL1.getId1();

        const nodeL1a = await nodeUtil.createLicenseNode({
            owner: clientPublicKey,
            targetPublicKey: clientPublicKey3,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            refId: nodeIdA,
            restrictiveModeWriter: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdL1a = nodeL1a.getId1();

        await driver.storeNodes([nodeL1, nodeL1a], now);

        nodes = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([nodeA, nodeB], nodes);
        assert(same);


        const nodeL1b = await nodeUtil.createLicenseNode({
            owner: clientPublicKey2,
            targetPublicKey: clientPublicKey3,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            refId: nodeIdB,
            restrictiveModeWriter: true,
        }, keyPair2.publicKey, keyPair2.secretKey);

        const nodeIdL1b = nodeL1b.getId1();

        await driver.storeNodes([nodeL1b], now);

        nodes = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([nodeA, nodeB, nodeC], nodes);
        assert(same);
    });

    it("restrictiveWriterNodes #3 - inheritence and manager permissions to end write modes", async function() {
        const driver = config.driver;
        const db = config.db;
        const keyPair1 = Krypto.GenKeyPair();
        const keyPair2 = Krypto.GenKeyPair();
        const keyPair3 = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            // Do nothing
        };

        let clientPublicKey = keyPair1.publicKey;
        let clientPublicKey2 = keyPair2.publicKey;
        let clientPublicKey3 = keyPair3.publicKey;
        let parentId = Buffer.alloc(32).fill(0);

        let rootNode = undefined;

        const nodeA = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
            isBeginRestrictiveWriteMode: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdA = nodeA.getId1();

            const licenseA1 = await nodeUtil.createLicenseNode({
                refId: nodeIdA,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId,
                expireTime: now + 10000,
                creationTime: now,
                restrictiveModeWriter: true,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdA1 = licenseA1.getId1();

            const licenseA2 = await nodeUtil.createLicenseNode({
                refId: nodeIdA,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey2,
                parentId,
                expireTime: now + 10000,
                creationTime: now,
                restrictiveModeWriter: true,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdA2 = licenseA2.getId1();

            const licenseA3 = await nodeUtil.createLicenseNode({
                refId: nodeIdA,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey3,
                parentId,
                expireTime: now + 10000,
                creationTime: now,
                restrictiveModeWriter: true,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdA3 = licenseA3.getId1();


        const nodeAb = await nodeUtil.createDataNode({
            owner: clientPublicKey2,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        }, keyPair2.publicKey, keyPair2.secretKey);

        const nodeIdAb = nodeAb.getId1();


        const nodeB = await nodeUtil.createDataNode({
            owner: clientPublicKey2,
            parentId: nodeIdAb,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
            isBeginRestrictiveWriteMode: true,
        }, keyPair2.publicKey, keyPair2.secretKey);

        const nodeIdB = nodeB.getId1();

            const licenseB1 = await nodeUtil.createLicenseNode({
                refId: nodeIdB,
                owner: clientPublicKey2,
                targetPublicKey: clientPublicKey,
                parentId: nodeIdAb,
                expireTime: now + 10000,
                creationTime: now,
                restrictiveModeWriter: true,
            }, keyPair2.publicKey, keyPair2.secretKey);

            const licenseIdB1 = licenseB1.getId1();

            const licenseB2 = await nodeUtil.createLicenseNode({
                refId: nodeIdB,
                owner: clientPublicKey2,
                targetPublicKey: clientPublicKey2,
                parentId: nodeIdAb,
                expireTime: now + 10000,
                creationTime: now,
                restrictiveModeWriter: true,
            }, keyPair2.publicKey, keyPair2.secretKey);

            const licenseIdB2 = licenseB2.getId1();

            const licenseB3 = await nodeUtil.createLicenseNode({
                refId: nodeIdB,
                owner: clientPublicKey2,
                targetPublicKey: clientPublicKey3,
                parentId: nodeIdAb,
                expireTime: now + 10000,
                creationTime: now,
                restrictiveModeWriter: true,
            }, keyPair2.publicKey, keyPair2.secretKey);

            const licenseIdB3 = licenseB3.getId1();

            const licenseB4 = await nodeUtil.createLicenseNode({
                refId: nodeIdB,
                owner: clientPublicKey2,
                targetPublicKey: clientPublicKey,
                parentId: nodeIdAb,
                expireTime: now + 10000,
                creationTime: now,
                restrictiveModeManager: true,
            }, keyPair2.publicKey, keyPair2.secretKey);

            const licenseIdB4 = licenseB4.getId1();

        const nodeC = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdB,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
            isBeginRestrictiveWriteMode: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdC = nodeC.getId1();

            const licenseC1 = await nodeUtil.createLicenseNode({
                refId: nodeIdC,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId: nodeIdB,
                expireTime: now + 10000,
                creationTime: now,
                restrictiveModeWriter: true,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdC1 = licenseC1.getId1();

            const licenseC2 = await nodeUtil.createLicenseNode({
                refId: nodeIdC,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey2,
                parentId: nodeIdB,
                expireTime: now + 10000,
                creationTime: now,
                restrictiveModeWriter: true,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdC2 = licenseC2.getId1();

            const licenseC3 = await nodeUtil.createLicenseNode({
                refId: nodeIdC,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey3,
                parentId: nodeIdB,
                expireTime: now + 10000,
                creationTime: now,
                restrictiveModeWriter: true,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdC3 = licenseC3.getId1();

            const licenseC4 = await nodeUtil.createLicenseNode({
                refId: nodeIdC,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey2,
                parentId: nodeIdB,
                expireTime: now + 10000,
                creationTime: now,
                restrictiveModeManager: true,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdC4 = licenseC4.getId1();


        const nodeD1 = await nodeUtil.createDataNode({
            owner: clientPublicKey2,
            parentId: nodeIdC,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
            isEndRestrictiveWriteMode: true,
        }, keyPair2.publicKey, keyPair2.secretKey);

        const nodeIdD1 = nodeD1.getId1();

        const nodeD2 = await nodeUtil.createDataNode({
            owner: clientPublicKey2,
            parentId: nodeIdC,
            expireTime: now + 10000,
            creationTime: now + 1,
            isPublic: true,
            isBeginRestrictiveWriteMode: true,
        }, keyPair2.publicKey, keyPair2.secretKey);

        const nodeIdD2 = nodeD2.getId1();

            const licenseD2 = await nodeUtil.createLicenseNode({
                refId: nodeIdD2,
                owner: clientPublicKey2,
                targetPublicKey: clientPublicKey3,
                parentId: nodeIdC,
                expireTime: now + 10000,
                creationTime: now,
                restrictiveModeWriter: true,
            }, keyPair2.publicKey, keyPair2.secretKey);

            const licenseIdD2 = licenseD2.getId1();


        const nodeD3 = await nodeUtil.createDataNode({
            owner: clientPublicKey2,
            parentId: nodeIdC,
            expireTime: now + 10000,
            creationTime: now + 2,
            isPublic: true,
            isEndRestrictiveWriteMode: true,
            isBeginRestrictiveWriteMode: true,
        }, keyPair2.publicKey, keyPair2.secretKey);

        const nodeIdD3 = nodeD3.getId1();

            const licenseD3 = await nodeUtil.createLicenseNode({
                refId: nodeIdD3,
                owner: clientPublicKey2,
                targetPublicKey: clientPublicKey3,
                parentId: nodeIdC,
                expireTime: now + 10000,
                creationTime: now,
                restrictiveModeWriter: true,
            }, keyPair2.publicKey, keyPair2.secretKey);

            const licenseIdD3 = licenseD3.getId1();


        const nodeE1 = await nodeUtil.createDataNode({
            owner: clientPublicKey3,
            parentId: nodeIdD1,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        }, keyPair3.publicKey, keyPair3.secretKey);

        const nodeIdE1 = nodeE1.getId1();

        const nodeE2 = await nodeUtil.createDataNode({
            owner: clientPublicKey3,
            parentId: nodeIdD2,
            expireTime: now + 10000,
            creationTime: now + 1,
            isPublic: true,
        }, keyPair3.publicKey, keyPair3.secretKey);

        const nodeIdE2 = nodeE2.getId1();

        const nodeE3 = await nodeUtil.createDataNode({
            owner: clientPublicKey3,
            parentId: nodeIdD3,
            expireTime: now + 10000,
            creationTime: now + 2,
            isPublic: true,
        }, keyPair3.publicKey, keyPair3.secretKey);

        const nodeIdE3 = nodeE3.getId1();

        await driver.storeNodes([nodeA, nodeAb, nodeB, nodeC, nodeD1, nodeD2, nodeD3, nodeE1, nodeE2, nodeE3], now);

        let fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey: clientPublicKey,
            match: [
                {
                    nodeType: Buffer.from(DataNodeType),
                    filters: []
                },
            ]
        }});

        let nodes = await fetch(db, fetchRequest, now, rootNode);
        let same = diffNodes([nodeA], nodes);
        assert(same);

        await driver.storeNodes([licenseA2], now);
        nodes = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([nodeA, nodeAb, nodeB], nodes);
        assert(same);


        await driver.storeNodes([licenseA1, licenseB1], now);
        nodes = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([nodeA, nodeAb, nodeB, nodeC], nodes);
        assert(same);

        await driver.storeNodes([licenseB2, licenseC2], now);
        nodes = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([nodeA, nodeAb, nodeB, nodeC, nodeD1, nodeD2, nodeD3], nodes);
        assert(same);

        await driver.storeNodes([licenseA3], now);
        nodes = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([nodeA, nodeAb, nodeB, nodeC, nodeD1, nodeD2, nodeD3], nodes);
        assert(same);

        await driver.storeNodes([licenseB3], now);
        nodes = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([nodeA, nodeAb, nodeB, nodeC, nodeD1, nodeD2, nodeD3], nodes);
        assert(same);

        await driver.storeNodes([licenseC4], now);
        nodes = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([nodeA, nodeAb, nodeB, nodeC, nodeD1, nodeD2, nodeD3, nodeE1], nodes);
        assert(same);

        await driver.storeNodes([licenseD3], now);
        nodes = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([nodeA, nodeAb, nodeB, nodeC, nodeD1, nodeD2, nodeD3, nodeE1, nodeE3], nodes);
        assert(same);

        await driver.storeNodes([licenseC3, licenseD2], now);
        nodes = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([nodeA, nodeAb, nodeB, nodeC, nodeD1, nodeD2, nodeD3, nodeE1, nodeE2, nodeE3], nodes);
        assert(same);
    });

    it("restrictiveWriterNodes #4 - inherit write modes from multiple parents & leverage parent licensing", async function() {
        const driver = config.driver;
        const db = config.db;
        const keyPair1 = Krypto.GenKeyPair();
        const keyPair2 = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            // Do nothing
        };

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
            isBeginRestrictiveWriteMode: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdA = nodeA.getId1();

            const licenseA = await nodeUtil.createLicenseNode({
                refId: nodeIdA,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId,
                expireTime: now + 10000,
                creationTime: now,
            }, keyPair1.publicKey, keyPair1.secretKey);

        const licenseIdA = licenseA.getId1();

            const licenseAw = await nodeUtil.createLicenseNode({
                refId: nodeIdA,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId,
                expireTime: now + 10000,
                creationTime: now,
                restrictiveModeWriter: true,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdAw = licenseAw.getId1();

            const licenseAw2 = await nodeUtil.createLicenseNode({
                refId: nodeIdA,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey2,
                parentId,
                expireTime: now + 10000,
                creationTime: now,
                restrictiveModeWriter: true,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdAw2 = licenseAw2.getId1();

        const nodeB1 = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 1,
            licenseMaxDistance: 1,
            isBeginRestrictiveWriteMode: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdB1 = nodeB1.getId1();

            const licenseB1w = await nodeUtil.createLicenseNode({
                refId: nodeIdB1,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId: nodeIdA,
                expireTime: now + 10000,
                creationTime: now,
                restrictiveModeWriter: true,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdB1w = licenseB1w.getId1();

            const licenseB1w2 = await nodeUtil.createLicenseNode({
                refId: nodeIdB1,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey2,
                parentId: nodeIdA,
                expireTime: now + 10000,
                creationTime: now,
                restrictiveModeWriter: true,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdB1w2 = licenseB1w2.getId1();

        const nodeB2 = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now + 1,
            isLicensed: true,
            isBeginRestrictiveWriteMode: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

            const nodeIdB2 = nodeB2.getId1();

            const licenseB2 = await nodeUtil.createLicenseNode({
                refId: nodeIdB2,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId: nodeIdA,
                expireTime: now + 10000,
                creationTime: now,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdB2 = licenseB2.getId1();

            const licenseB2w = await nodeUtil.createLicenseNode({
                refId: nodeIdB2,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId: nodeIdA,
                expireTime: now + 10000,
                creationTime: now,
                restrictiveModeWriter: true,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdB2w = licenseB2w.getId1();

            const licenseB2w2 = await nodeUtil.createLicenseNode({
                refId: nodeIdB2,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey2,
                parentId: nodeIdA,
                expireTime: now + 10000,
                creationTime: now,
                restrictiveModeWriter: true,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdB2w2 = licenseB2w2.getId1();


        const nodeC1 = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdB1,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 1,
            licenseMaxDistance: 2,
            isBeginRestrictiveWriteMode: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdC1 = nodeC1.getId1();

            const licenseC1w = await nodeUtil.createLicenseNode({
                refId: nodeIdC1,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId: nodeIdB1,
                expireTime: now + 10000,
                creationTime: now,
                restrictiveModeWriter: true,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdC1w = licenseC1w.getId1();

            const licenseC1w2 = await nodeUtil.createLicenseNode({
                refId: nodeIdC1,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey2,
                parentId: nodeIdB1,
                expireTime: now + 10000,
                creationTime: now,
                restrictiveModeWriter: true,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdC1w2 = licenseC1w2.getId1();

        const nodeC2 = nodeC1.copy(nodeIdB2, now + 1);
        nodeC2.sign(keyPair1);
        const nodeIdC2 = nodeC2.getId1();

            const licenseC2w = await nodeUtil.createLicenseNode({
                refId: nodeIdC2,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId: nodeIdB2,
                expireTime: now + 10000,
                creationTime: now,
                restrictiveModeWriter: true,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdC2w = licenseC2w.getId1();

            const licenseC2w2 = await nodeUtil.createLicenseNode({
                refId: nodeIdC2,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey2,
                parentId: nodeIdB2,
                expireTime: now + 10000,
                creationTime: now,
                restrictiveModeWriter: true,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdC2w2 = licenseC2w2.getId1();

        const nodeD = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdC1,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 3,
            licenseMaxDistance: 3,
            isBeginRestrictiveWriteMode: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdD = nodeD.getId1();

            const licenseDw = await nodeUtil.createLicenseNode({
                refId: nodeIdD,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey2,
                parentId: nodeIdC1,
                expireTime: now + 10000,
                creationTime: now,
                restrictiveModeWriter: true,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdDw = licenseDw.getId1();

        const nodeE1 = await nodeUtil.createDataNode({
            owner: clientPublicKey2,
            parentId: nodeIdD,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 4,
            licenseMaxDistance: 4,
        }, keyPair2.publicKey, keyPair2.secretKey);

        const nodeIdE1 = nodeE1.getId1();

        const nodeE2 = await nodeUtil.createDataNode({
            owner: clientPublicKey2,
            parentId: nodeIdD,
            expireTime: now + 10000,
            creationTime: now + 1,
            isLicensed: true,
            licenseMinDistance: 3,
            licenseMaxDistance: 3,
        }, keyPair2.publicKey, keyPair2.secretKey);

        const nodeIdE2 = nodeE2.getId1();

        let fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey: clientPublicKey,
            match: [
                {
                    nodeType: Buffer.from(DataNodeType),
                    filters: []
                },
            ]
        }});

        let nodes: BaseNodeInterface[] = [];
        let same = false;

        await driver.storeNodes([nodeA, nodeB1, nodeB2, nodeC1, nodeC2, nodeD, nodeE1, nodeE2], now);

        nodes = await fetch(db, fetchRequest, now, rootNode);
        assert(nodes.length === 0);

        await driver.storeNodes([licenseAw, licenseAw2, licenseB1w, licenseB1w2, licenseB2w, licenseB2w2, licenseC1w, licenseC1w2, licenseC2w, licenseC2w2, licenseDw], now);

        nodes = await fetch(db, fetchRequest, now, rootNode);
        assert(nodes.length === 0);

        await driver.storeNodes([licenseA], now);

        nodes = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([nodeA, nodeB1, nodeC1, nodeD, nodeE1], nodes);
        assert(same);

        await driver.storeNodes([licenseB2], now);

        nodes = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([nodeA, nodeB1, nodeB2, nodeC1, nodeC2, nodeD, nodeE1, nodeE2], nodes);
        assert(same);
    });

    it("includeLicenses should include all relevant licenses when fetching", async function() {
        const driver = config.driver;
        const db = config.db;
        const keyPair1 = Krypto.GenKeyPair();
        const keyPair2 = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            // Do nothing
        };

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
            isBeginRestrictiveWriteMode: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdA = nodeA.getId1();

            const licenseA = await nodeUtil.createLicenseNode({
                refId: nodeIdA,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId,
                expireTime: now + 10000,
                creationTime: now + 1,
                extensions: 1,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdA = licenseA.getId1();

            const licenseAw = await nodeUtil.createLicenseNode({
                refId: nodeIdA,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId,
                expireTime: now + 10001,
                creationTime: now + 2,
                restrictiveModeWriter: true,
                extensions: 1,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdAw = licenseAw.getId1();

            const licenseAw2 = await nodeUtil.createLicenseNode({
                refId: nodeIdA,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey2,
                parentId,
                expireTime: now + 10000,
                creationTime: now + 3,
                restrictiveModeWriter: true,
                extensions: 1,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdAw2 = licenseAw2.getId1();

        const nodeB1 = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 1,
            licenseMaxDistance: 1,
            isBeginRestrictiveWriteMode: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdB1 = nodeB1.getId1();

            const licenseB1w = await nodeUtil.createLicenseNode({
                refId: nodeIdB1,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId: nodeIdA,
                expireTime: now + 10000,
                creationTime: now + 1,
                restrictiveModeWriter: true,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdB1w = licenseB1w.getId1();

            const licenseB1w2 = await nodeUtil.createLicenseNode({
                refId: nodeIdB1,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey2,
                parentId: nodeIdA,
                expireTime: now + 10000,
                creationTime: now + 2,
                restrictiveModeWriter: true,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdB1w2 = licenseB1w2.getId1();

        const nodeB2 = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now + 3,
            isLicensed: true,
            isBeginRestrictiveWriteMode: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdB2 = nodeB2.getId1();

            const licenseB2 = await nodeUtil.createLicenseNode({
                refId: nodeIdB2,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId: nodeIdA,
                expireTime: now + 10000,
                creationTime: now + 4,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdB2 = licenseB2.getId1();

            const licenseB2w = await nodeUtil.createLicenseNode({
                refId: nodeIdB2,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId: nodeIdA,
                expireTime: now + 10000,
                creationTime: now + 5,
                restrictiveModeWriter: true,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdB2w = licenseB2w.getId1();

            const licenseB2w2 = await nodeUtil.createLicenseNode({
                refId: nodeIdB2,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey2,
                parentId: nodeIdA,
                expireTime: now + 10000,
                creationTime: now + 6,
                restrictiveModeWriter: true,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdB2w2 = licenseB2w2.getId1();


        const nodeC1 = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdB1,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 1,
            licenseMaxDistance: 2,
            isBeginRestrictiveWriteMode: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdC1 = nodeC1.getId1();

            const licenseC1w = await nodeUtil.createLicenseNode({
                refId: nodeIdC1,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId: nodeIdB1,
                expireTime: now + 10000,
                creationTime: now + 1,
                restrictiveModeWriter: true,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdC1w = licenseC1w.getId1();

            const licenseC1w2 = await nodeUtil.createLicenseNode({
                refId: nodeIdC1,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey2,
                parentId: nodeIdB1,
                expireTime: now + 10000,
                creationTime: now + 2,
                restrictiveModeWriter: true,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdC1w2 = licenseC1w2.getId1();

        const nodeC2 = nodeC1.copy(nodeIdB2, now + 1);
        nodeC2.sign(keyPair1);
        const nodeIdC2 = nodeC2.getId1();

            const licenseC2w = await nodeUtil.createLicenseNode({
                refId: nodeIdC2,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId: nodeIdB2,
                expireTime: now + 10000,
                creationTime: now,
                restrictiveModeWriter: true,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdC2w = licenseC2w.getId1();

            const licenseC2w2 = await nodeUtil.createLicenseNode({
                refId: nodeIdC2,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey2,
                parentId: nodeIdB2,
                expireTime: now + 10000,
                creationTime: now + 1,
                restrictiveModeWriter: true,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdC2w2 = licenseC2w2.getId1();

        const nodeD = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdC1,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 3,
            licenseMaxDistance: 3,
            isBeginRestrictiveWriteMode: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

            const nodeIdD = nodeD.getId1();

            const licenseDw = await nodeUtil.createLicenseNode({
                refId: nodeIdD,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey2,
                parentId: nodeIdC1,
                expireTime: now + 10000,
                creationTime: now + 1,
                restrictiveModeWriter: true,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdDw = licenseDw.getId1();

        const nodeE1 = await nodeUtil.createDataNode({
            owner: clientPublicKey2,
            parentId: nodeIdD,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 4,
            licenseMaxDistance: 4,
        }, keyPair2.publicKey, keyPair2.secretKey);

        const nodeIdE1 = nodeE1.getId1();

        const nodeE2 = await nodeUtil.createDataNode({
            owner: clientPublicKey2,
            parentId: nodeIdD,
            expireTime: now + 10000,
            creationTime: now + 1,
            isLicensed: true,
            licenseMinDistance: 3,
            licenseMaxDistance: 3,
        }, keyPair2.publicKey, keyPair2.secretKey);

        const nodeIdE2 = nodeE2.getId1();

        let fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey: clientPublicKey,
            match: [
                {
                    nodeType: Buffer.from(DataNodeType),
                    filters: []
                },
            ],
            includeLicenses: "Include",
        }});

        let nodes: BaseNodeInterface[] = [];
        let same = false;

        await driver.storeNodes([nodeA, nodeB1, nodeB2, nodeC1, nodeC2, nodeD, nodeE1, nodeE2], now);

        nodes = await fetch(db, fetchRequest, now, rootNode);
        assert(nodes.length === 0);

        await driver.storeNodes([licenseA, licenseB2, licenseAw, licenseAw2, licenseB1w, licenseB1w2, licenseB2w, licenseB2w2, licenseC1w, licenseC1w2, licenseC2w, licenseC2w2, licenseDw], now);

        fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey: clientPublicKey,
            match: [
                {
                    nodeType: Buffer.from(DataNodeType),
                    filters: []
                },
            ],
            includeLicenses: "",
            depth: 1,
        }});

        let ret = await fetch2(db, fetchRequest, now, rootNode);

        assert(ret.embed.length === 0);

        same = diffNodes([nodeA], ret.nodes);
        assert(same);



        fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey: clientPublicKey,
            match: [
                {
                    nodeType: Buffer.from(DataNodeType),
                    filters: []
                },
            ],
            includeLicenses: "IncludeExtend",
            depth: 1,
        }});

        ret = await fetch2(db, fetchRequest, now, rootNode);

        assert(ret.embed.length === 0);

        same = diffNodes([nodeA, licenseA], ret.nodes);
        assert(same);



        fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey: clientPublicKey2,
            match: [
                {
                    nodeType: Buffer.from(DataNodeType),
                    filters: []
                },
            ],
            includeLicenses: "Extend",
            depth: 1,
        }});

        ret = await fetch2(db, fetchRequest, now, rootNode);

        assert(ret.embed.length === 1);

        same = diffNodes([], ret.nodes);
        assert(same);


        fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey: clientPublicKey,
            match: [
                {
                    nodeType: Buffer.from(DataNodeType),
                    filters: []
                },
            ],
            includeLicenses: "IncludeExtend",
            depth: 10,
        }});

        ret = await fetch2(db, fetchRequest, now, rootNode);

        assert(ret.embed.length === 0);

        same = diffNodes([nodeA, licenseA,
            nodeB1, nodeB2, licenseB2,
            nodeC1, nodeC2, nodeD, nodeE1, nodeE2], ret.nodes);

        assert(same);
    });

    it("#run with ReverseFetch", async function() {
        const driver = config.driver;
        const db = config.db;
        const keyPair1 = Krypto.GenKeyPair();
        const keyPair2 = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            // Do nothing
        };

        let clientPublicKey = keyPair1.publicKey;
        let clientPublicKey2 = keyPair2.publicKey;
        let parentId = Buffer.alloc(32).fill(254);

        const node0 = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeId0 = node0.getId1();

        const nodeA = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeId0,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdA = nodeA.getId1();

            const licenseA = await nodeUtil.createLicenseNode({
                refId: nodeIdA,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId,
                expireTime: now + 10000,
                creationTime: now,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdA = licenseA.getId1();

        const nodeB1 = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 1,
            licenseMaxDistance: 1,
            isBeginRestrictiveWriteMode: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdB1 = nodeB1.getId1();

        const nodeB2 = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            isBeginRestrictiveWriteMode: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdB2 = nodeB2.getId1();

            const licenseB2 = await nodeUtil.createLicenseNode({
                refId: nodeIdB2,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId: nodeIdA,
                expireTime: now + 10000,
                creationTime: now,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdB2 = licenseB2.getId1();

        const nodeC1 = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdB1,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 1,
            licenseMaxDistance: 2,
            isBeginRestrictiveWriteMode: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdC1 = nodeC1.getId1();

        const nodeC2 = nodeC1.copy(nodeIdB2);
        nodeC2.sign(keyPair1);
        const nodeIdC2 = nodeC2.getId1();

        assert((nodeC2.getId() as Buffer).equals(nodeIdC1));
        assert((nodeC2.getId1() as Buffer).equals(nodeIdC2));

        const nodeD = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdC1,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 3,
            licenseMaxDistance: 3,
            isBeginRestrictiveWriteMode: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdD = nodeD.getId1();

        const nodeE1 = await nodeUtil.createDataNode({
            owner: clientPublicKey2,
            parentId: nodeIdD,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 4,
            licenseMaxDistance: 4,
        }, keyPair2.publicKey, keyPair2.secretKey);

        const nodeIdE1 = nodeE1.getId1();

        const nodeE2 = await nodeUtil.createDataNode({
            owner: clientPublicKey2,
            parentId: nodeIdD,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 3,
            licenseMaxDistance: 3,
        }, keyPair2.publicKey, keyPair2.secretKey);

        const nodeIdE2 = nodeE2.getId1();

        await driver.storeNodes([node0, nodeA, nodeB1, nodeB2, nodeC1, nodeC2, nodeD, nodeE1, nodeE2], now);

        let fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId: nodeIdE1,
            sourcePublicKey: clientPublicKey,
            targetPublicKey: clientPublicKey,
            depth: 0,
            discardRoot: false,
            match: [
                {
                    nodeType: Buffer.alloc(0),
                    filters: []
                }
            ]
        }});

        let queryProcessor = new QueryProcessor(db, fetchRequest.query, undefined, now,
            handleFetchReplyData, ReverseFetch.ONLY_LICENSED);

        await queryProcessor.run();

        //@ts-ignore
        assert(Object.keys(queryProcessor.alreadyProcessedNodes).length === 0);



        fetchRequest.query.depth = 1;

        queryProcessor = new QueryProcessor(db, fetchRequest.query, undefined, now,
            handleFetchReplyData, ReverseFetch.ONLY_LICENSED);

        await queryProcessor.run();

        //@ts-ignore
        assert(Object.keys(queryProcessor.alreadyProcessedNodes).length === 1);

        assert(getProcessState(nodeE1, queryProcessor, false).parentId === nodeIdD.toString("hex"));



        queryProcessor = new QueryProcessor(db, fetchRequest.query, nodeE1, now,
            handleFetchReplyData, ReverseFetch.ONLY_LICENSED);

        await queryProcessor.run();

        //@ts-ignore
        assert(Object.keys(queryProcessor.alreadyProcessedNodes).length === 2);


        fetchRequest.query.depth = 6;

        queryProcessor = new QueryProcessor(db, fetchRequest.query, undefined, now,
            handleFetchReplyData, ReverseFetch.ONLY_LICENSED);

        await queryProcessor.run();

        //@ts-ignore
        assert(Object.keys(queryProcessor.alreadyProcessedNodes).length === 6);
        //@ts-ignore
        assert(queryProcessor.alreadyProcessedNodes[nodeIdA.toString("hex")]);
        //@ts-ignore
        assert(queryProcessor.alreadyProcessedNodes[nodeIdB1.toString("hex")]);
        //@ts-ignore
        assert(queryProcessor.alreadyProcessedNodes[nodeIdB2.toString("hex")]);
        //@ts-ignore
        assert(queryProcessor.alreadyProcessedNodes[nodeIdC1.toString("hex")]);
        //@ts-ignore
        assert(queryProcessor.alreadyProcessedNodes[nodeIdC1.toString("hex")].id1s[nodeIdC2.toString("hex")]);
        //@ts-ignore
        assert(queryProcessor.alreadyProcessedNodes[nodeIdD.toString("hex")]);
        //@ts-ignore
        assert(queryProcessor.alreadyProcessedNodes[nodeIdE1.toString("hex")]);


        queryProcessor = new QueryProcessor(db, fetchRequest.query, undefined, now,
            handleFetchReplyData, ReverseFetch.ALL_PARENTS);

        await queryProcessor.run();

        //@ts-ignore
        assert(Object.keys(queryProcessor.alreadyProcessedNodes).length === 7);
        //@ts-ignore
        assert(queryProcessor.alreadyProcessedNodes[nodeId0.toString("hex")]);
        //@ts-ignore
        assert(queryProcessor.alreadyProcessedNodes[nodeIdA.toString("hex")]);
        //@ts-ignore
        assert(queryProcessor.alreadyProcessedNodes[nodeIdB1.toString("hex")]);
        //@ts-ignore
        assert(queryProcessor.alreadyProcessedNodes[nodeIdB2.toString("hex")]);
        //@ts-ignore
        assert(queryProcessor.alreadyProcessedNodes[nodeIdC1.toString("hex")]);
        //@ts-ignore
        assert(queryProcessor.alreadyProcessedNodes[nodeIdC1.toString("hex")].id1s[nodeIdC2.toString("hex")]);
        //@ts-ignore
        assert(queryProcessor.alreadyProcessedNodes[nodeIdD.toString("hex")]);
        //@ts-ignore
        assert(queryProcessor.alreadyProcessedNodes[nodeIdE1.toString("hex")]);
    });

    it("#checkSourceNodesPermissions", async function() {
        const driver = config.driver;
        const db = config.db;
        const keyPair1 = Krypto.GenKeyPair();
        const keyPair2 = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            // Do nothing
        };

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

        const nodeIdA = nodeA.getId1();

            const licenseA = await nodeUtil.createLicenseNode({
                refId: nodeIdA,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId,
                expireTime: now + 10000,
                creationTime: now + 1,
            }, keyPair1.publicKey, keyPair1.secretKey);

            const licenseIdA = licenseA.getId1();

        const nodeB1 = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 1,
            licenseMaxDistance: 1,
            isBeginRestrictiveWriteMode: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdB1 = nodeB1.getId1();

        const nodeB2 = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now + 1,
            isLicensed: true,
            isBeginRestrictiveWriteMode: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdB2 = nodeB2.getId1();

            const licenseB2 = await nodeUtil.createLicenseNode({
                refId: nodeIdB2,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId: nodeIdA,
                expireTime: now + 10000,
                creationTime: now + 2,
            }, keyPair1.publicKey, keyPair1.secretKey);

        const licenseIdB2 = licenseB2.getId1();

        const nodeC1 = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdB1,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 1,
            licenseMaxDistance: 2,
            isBeginRestrictiveWriteMode: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdC1 = nodeC1.getId1();

        const nodeC2 = nodeC1.copy(nodeIdB2);
        nodeC2.sign(keyPair1);
        const nodeIdC2 = nodeC2.getId1();

        const nodeD = await nodeUtil.createDataNode({
            owner: clientPublicKey,
            parentId: nodeIdC1,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 3,
            licenseMaxDistance: 3,
            isBeginRestrictiveWriteMode: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const nodeIdD = nodeD.getId1();

        const nodeE1 = await nodeUtil.createDataNode({
            owner: clientPublicKey2,
            parentId: nodeIdD,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 4,
            licenseMaxDistance: 4,
        }, keyPair2.publicKey, keyPair2.secretKey);

        const nodeIdE1 = nodeE1.getId1();

        const nodeE2 = await nodeUtil.createDataNode({
            owner: clientPublicKey2,
            parentId: nodeIdD,
            expireTime: now + 10000,
            creationTime: now + 1,
            isLicensed: true,
            licenseMinDistance: 3,
            licenseMaxDistance: 3,
        }, keyPair2.publicKey, keyPair2.secretKey);

        const nodeIdE2 = nodeE2.getId1();

        await driver.storeNodes([nodeA, nodeB1, nodeB2, nodeC1, nodeC2, nodeD, nodeE1, nodeE2], now);

        let fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey: clientPublicKey,
            match: [
                {
                    nodeType: Buffer.alloc(0),
                    filters: []
                }
            ]
        }});

        let qp = new QueryProcessorWrapper(db, fetchRequest.query, undefined, now, handleFetchReplyData);
        let nodesWithPermissions = await qp.checkSourceNodesPermissions([nodeIdA, nodeIdB1]);

        assert(Object.keys(nodesWithPermissions).length === 0);

        await driver.storeNodes([licenseA], now);

        nodesWithPermissions = await qp.checkSourceNodesPermissions([nodeIdA, nodeIdB1, nodeIdB2]);


        assert(Object.keys(nodesWithPermissions).length === 2);
        assert(nodesWithPermissions[nodeIdA.toString("hex")] === true);

        await driver.storeNodes([licenseB2], now);

        nodesWithPermissions = await qp.checkSourceNodesPermissions([nodeIdA, nodeIdB1, nodeIdB2]);
        assert(Object.keys(nodesWithPermissions).length === 3);

        nodesWithPermissions = await qp.checkSourceNodesPermissions([nodeIdA, nodeIdB1, nodeIdB2, nodeIdC1, nodeIdC2, nodeIdD]);
        assert(Object.keys(nodesWithPermissions).length === 6);
    });

    it("#applyFriendCerts", async function() {
        const driver = config.driver;
        const keyPairA = Krypto.GenKeyPair();
        const keyPairB = Krypto.GenKeyPair();
        const keyPairInt = Krypto.GenKeyPair();

        const db = config.db;

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let parentId = Buffer.alloc(32).fill(0);

        const license1 = await nodeUtil.createLicenseNode({
            owner: keyPairA.publicKey,
            targetPublicKey: keyPairInt.publicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            extensions: 1,
            friendLevel: 1,
            refId: Buffer.alloc(32),
        }, keyPairA.publicKey, keyPairA.secretKey);

        const licenseId1 = license1.getId1();

        const embeddingLicense = license1.embed(keyPairB.publicKey);

        assert(embeddingLicense);

        const aCert = new FriendCert();

        aCert.mergeProps({
            owner: keyPairA.publicKey,
            creationTime: now,
            expireTime: now + 10000,
            friendLevel: 1,
            salt: Buffer.alloc(8).fill(0x01),
            licenseMaxExpireTime: now + 10000,
        });

        const bCert = new FriendCert();

        bCert.mergeProps({
            owner: keyPairB.publicKey,
            creationTime: now,
            expireTime: now + 10000,
            friendLevel: 1,
            salt: Buffer.alloc(8).fill(0x02),
            licenseMaxExpireTime: now + 10000,
        });

        const constraints = aCert.hashFriendConstraints(bCert.getProps());
        assert(bCert.hashFriendConstraints(aCert.getProps()).equals(constraints));

        aCert.getProps().constraints = constraints;

        bCert.getProps().constraints = constraints;

        aCert.sign(keyPairA);

        bCert.sign(keyPairB);


        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            // Do nothing
        };

        let fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey: keyPairA.publicKey,
            targetPublicKey: keyPairA.publicKey,
            match: [],
        }});

        let qp = new QueryProcessorWrapper(db, fetchRequest.query, undefined, now, handleFetchReplyData);

        let success = await qp.applyFriendCerts(embeddingLicense, aCert, bCert);

        assert(success);
    });

    it("#getFriendCerts", async function() {
        // TODO this test could use some more corner case testing.
        //
        const driver = config.driver;
        const db = config.db;
        const keyPairA = Krypto.GenKeyPair();
        const keyPairB = Krypto.GenKeyPair();
        const keyPairInt = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            // Do nothing
        };

        let parentId = Buffer.alloc(32).fill(0);

        const aCert = new FriendCert();

        aCert.mergeProps({
            owner: keyPairA.publicKey,
            creationTime: now,
            expireTime: now + 10000,
            friendLevel: 1,
            salt: Buffer.alloc(8).fill(0x01),
            licenseMaxExpireTime: now + 10000,
        });

        const bCert = new FriendCert();

        bCert.mergeProps({
            owner: keyPairB.publicKey,
            creationTime: now,
            expireTime: now + 10000,
            friendLevel: 1,
            salt: Buffer.alloc(8).fill(0x02),
            licenseMaxExpireTime: now + 10000,
        });

        const constraints = aCert.hashFriendConstraints(bCert.getProps());
        assert(bCert.hashFriendConstraints(aCert.getProps()).equals(constraints));

        aCert.getProps().constraints = constraints;

        bCert.getProps().constraints = constraints;

        aCert.sign(keyPairA);

        bCert.sign(keyPairB);

        const nodeA = await nodeUtil.createCarrierNode({
            owner: keyPairA.publicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            friendCert: aCert.pack(),
            isPublic: true,
        }, keyPairA.publicKey, keyPairA.secretKey);

        const nodeIdA = nodeA.getId1();


        const nodeB = await nodeUtil.createCarrierNode({
            owner: keyPairB.publicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            friendCert: bCert.pack(),
            isLicensed: true,
        }, keyPairB.publicKey, keyPairB.secretKey);

        const nodeIdB = nodeB.getId1();

        const licenseB = await nodeUtil.createLicenseNode({
            parentId,
            refId: nodeIdB,
            owner: keyPairB.publicKey,
            targetPublicKey: keyPairInt.publicKey,
            expireTime: now + 10000,
            creationTime: now,
        }, keyPairB.publicKey, keyPairB.secretKey);

        const licenseIdB = licenseB.getId1();

        let fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey: keyPairInt.publicKey,
            targetPublicKey: keyPairB.publicKey,
            match: [
                {
                    nodeType: Buffer.alloc(0),
                    filters: []
                }
            ]
        }});

        let qp = new QueryProcessorWrapper(db, fetchRequest.query, undefined, now, handleFetchReplyData);

        let publicKeys: Buffer[] = [];

        let friendCerts = await qp.getFriendCerts(publicKeys);

        assert(Object.keys(friendCerts).length === 0);

        publicKeys = [keyPairA.publicKey];

        friendCerts = await qp.getFriendCerts(publicKeys);

        assert(Object.keys(friendCerts).length === 0);


        let [a,b] = await driver.store([nodeA, nodeB, licenseB], now);
        assert(a.length === 3);

        publicKeys = [keyPairA.publicKey];

        friendCerts = await qp.getFriendCerts(publicKeys);

        assert(Object.keys(friendCerts).length === 1);
    });

    it("#embedNodes using friend certs", async function() {
        const driver = config.driver;
        const db = config.db;
        const keyPairA = Krypto.GenKeyPair();
        const keyPairB = Krypto.GenKeyPair();
        const keyPairInt = Krypto.GenKeyPair();

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        const embed: BaseNodeInterface[] = [];
        const nodes: BaseNodeInterface[] = [];

        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            nodes.push(...fetchReplyData.nodes ?? []);
            embed.push(...fetchReplyData.embed ?? []);
        };

        let parentId = Buffer.alloc(32).fill(0);

        const aCert = new FriendCert();

        aCert.mergeProps({
            owner: keyPairA.publicKey,
            creationTime: now,
            expireTime: now + 10000,
            friendLevel: 1,
            salt: Buffer.alloc(8).fill(0x01),
            licenseMaxExpireTime: now + 10000,
        });

        const bCert = new FriendCert();

        bCert.mergeProps({
            owner: keyPairB.publicKey,
            creationTime: now,
            expireTime: now + 10000,
            friendLevel: 1,
            salt: Buffer.alloc(8).fill(0x02),
            licenseMaxExpireTime: now + 10000,
        });

        const constraints = aCert.hashFriendConstraints(bCert.getProps());
        assert(bCert.hashFriendConstraints(aCert.getProps()).equals(constraints));

        aCert.getProps().constraints = constraints;

        bCert.getProps().constraints = constraints;

        aCert.sign(keyPairA);

        bCert.sign(keyPairB);


        const nodeA = await nodeUtil.createCarrierNode({
            owner: keyPairA.publicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
        }, keyPairA.publicKey, keyPairA.secretKey);

        const nodeIdA = nodeA.getId1();

            const licenseA = await nodeUtil.createLicenseNode({
                parentId,
                refId: nodeIdA,
                owner: keyPairA.publicKey,
                targetPublicKey: keyPairInt.publicKey,
                expireTime: now + 10000,
                creationTime: now,
                friendLevel: 1,
                extensions: 1,
            }, keyPairA.publicKey, keyPairA.secretKey);

            const licenseIdA = licenseA.getId1();

        const nodeB = await nodeUtil.createCarrierNode({
            owner: keyPairB.publicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
        }, keyPairB.publicKey, keyPairB.secretKey);

        const nodeIdB = nodeB.getId1();

            const licenseB = await nodeUtil.createLicenseNode({
                parentId,
                refId: nodeIdB,
                owner: keyPairB.publicKey,
                targetPublicKey: keyPairInt.publicKey,
                expireTime: now + 10000,
                creationTime: now,
                friendLevel: 1,
                extensions: 1,
            }, keyPairB.publicKey, keyPairB.secretKey);

            const licenseIdB = licenseB.getId1();


        const nodeFriendA = await nodeUtil.createCarrierNode({
            owner: keyPairA.publicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            friendCert: aCert.pack(),
            isPublic: true,
        }, keyPairA.publicKey, keyPairA.secretKey);

        const nodeFriendIdA = nodeFriendA.getId1();

        const nodeFriendB = await nodeUtil.createCarrierNode({
            owner: keyPairB.publicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            friendCert: bCert.pack(),
            isPublic: true,
        }, keyPairB.publicKey, keyPairB.secretKey);

        const nodeFriendIdB = nodeFriendB.getId1();

        let [a, b] = await driver.store([nodeA, licenseA, nodeB, licenseB, nodeFriendA, nodeFriendB], now);
        assert(a.length === 6);

        // Connect as Intermediary
        let fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            sourcePublicKey: keyPairInt.publicKey,
            targetPublicKey: keyPairA.publicKey,
            match: [
                {
                    nodeType: Buffer.alloc(0),
                    filters: []
                }
            ],
            embed: [
                {
                    nodeType: Buffer.from(LicenseNodeType),
                    filters: [],
                }
            ]
        }});

        let qp = new QueryProcessorWrapper(db, fetchRequest.query, undefined, now, handleFetchReplyData);

        await qp.run();

        assert(nodes.length === 3);
        assert(embed.length === 1);

        let nodeIds = nodes.map( node => (node.getId1() as Buffer).toString("hex") );
        assert(nodeIds.includes(licenseIdA.toString("hex")));
        assert(nodeIds.includes(nodeFriendIdA.toString("hex")));
        assert(nodeIds.includes(nodeFriendIdB.toString("hex")));

        nodeIds = embed.map( node => (node.getProps().refId as Buffer).toString("hex") );
        assert(nodeIds.includes(nodeIdB.toString("hex")));

        // Store embedded node and query again.
        //
        embed[0].sign(keyPairInt);
        [a, b] = await driver.store(embed, now);
        assert(a.length === 1);

        nodes.length = 0;
        embed.length = 0;

        qp = new QueryProcessorWrapper(db, fetchRequest.query, undefined, now, handleFetchReplyData);
        await qp.run();

        assert(nodes.length === 5);
        assert(embed.length === 0);
        nodeIds = nodes.map( node => (node.getId1() as Buffer).toString("hex") );
        assert(nodeIds.includes(licenseIdA.toString("hex")));
        assert(nodeIds.includes(nodeFriendIdA.toString("hex")));
        assert(nodeIds.includes(nodeFriendIdB.toString("hex")));
        assert(nodeIds.includes(nodeIdB.toString("hex")));

        fetchRequest.query.targetPublicKey = keyPairB.publicKey;

        nodes.length = 0;
        embed.length = 0;

        qp = new QueryProcessorWrapper(db, fetchRequest.query, undefined, now, handleFetchReplyData);
        await qp.run();

        assert(nodes.length === 3);
        assert(embed.length === 1);

        nodeIds = nodes.map( node => (node.getId1() as Buffer).toString("hex") );
        assert(nodeIds.includes(licenseIdB.toString("hex")));
        assert(nodeIds.includes(nodeFriendIdA.toString("hex")));
        assert(nodeIds.includes(nodeFriendIdB.toString("hex")));

        nodeIds = embed.map( node => (node.getProps().refId as Buffer).toString("hex") );
        assert(nodeIds.includes(nodeIdA.toString("hex")));
    });
}

async function fetch(db: DBClient, fetchRequest: FetchRequest, now: number, rootNode?: BaseNodeInterface): Promise<BaseNodeInterface[]> {

    const nodes: BaseNodeInterface[] = [];
    let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
        nodes.push(...fetchReplyData.nodes ?? []);
    };

    let qp = new QueryProcessorWrapper(db, fetchRequest.query, rootNode, now, handleFetchReplyData);
    await qp.run();

    return nodes;
}

async function fetch2(db: DBClient, fetchRequest: FetchRequest, now: number, rootNode?: BaseNodeInterface): Promise<{nodes: BaseNodeInterface[], embed: BaseNodeInterface[]}> {

    const nodes: BaseNodeInterface[] = [];
    const embed: BaseNodeInterface[] = [];

    let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
        nodes.push(...fetchReplyData.nodes ?? []);
        embed.push(...fetchReplyData.embed ?? []);
    };

    let qp = new QueryProcessorWrapper(db, fetchRequest.query, rootNode, now, handleFetchReplyData);
    await qp.run();

    return {nodes, embed};
}

async function createNodes(keyPair: KeyPair, count: number, params: any, now: number, prefix?: string): Promise<BaseNodeInterface[]> {

    prefix = prefix ?? "";
    const nodeUtil = new NodeUtil();

    const nodes: BaseNodeInterface[] = [];

    for (let i=0; i<count; i++) {
        //const id1 = Hash([params.parentId, prefix, i, ""+now]);
        const node = await nodeUtil.createDataNode({
            ...params,
            creationTime: now + i,
            expireTime: now + i + 10000,
            //id1,
            data: Buffer.from(`${prefix}_${i}/${count-1}`),
        }, keyPair.publicKey, keyPair.secretKey);

        nodes.push(node);
    }

    return nodes;
}

function diffNodes(nodes1: BaseNodeInterface[], nodes2: BaseNodeInterface[]): boolean {

    if (nodes1.length !== nodes2.length) {
        return false;
    }

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

function getProcessState(node: BaseNodeInterface, qp: QueryProcessor, createCache: boolean = true): any {
    const idStr = node.getId().toString("hex");
    const id1Str = node.getId1().toString("hex");

    //@ts-ignore
    let obj1 = qp.alreadyProcessedNodes[idStr]?.id1s[id1Str];

    if (!obj1) {
        if (!createCache) {
            return undefined;
        }

        obj1 = {
            parentId: node.getProps().parentId!.toString("hex"),
            owner: node.getProps().owner!,
            childMinDifficulty: node.getProps().childMinDifficulty ?? 0,
            disallowPublicChildren: Boolean(node.loadFlags().disallowPublicChildren),
            onlyOwnChildren: Boolean(node.loadFlags().onlyOwnChildren),
            endRestrictiveWriterMode: false,
            beginRestrictiveWriterMode: false,
            flushed: false,
            passed: false,
            restrictiveNodes: [],
            restrictiveManager: {},
            trailUpdateTime: 0,
            storageTime: 0,
            updateTime: 0,
            discard: false,
            bottom: false,
            matchIndexes: [],
            node: undefined!,
        };

        //@ts-ignore
        const obj = qp.alreadyProcessedNodes[idStr] ?? {matched: [], id1s: {}} as any;

        obj.id1s[id1Str] = obj1;

        //@ts-ignore
        qp.alreadyProcessedNodes[idStr] = obj;
    }

    return obj1;
}
