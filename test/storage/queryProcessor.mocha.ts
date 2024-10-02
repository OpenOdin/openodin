import {
    assert,
} from "chai";

import {
    DatabaseUtil,
    Driver,
    NodeInterface,
    NodeUtil,
    DBClient,
    TABLES,
    StorageUtil,
    FetchRequest,
    FetchReplyData,
    Data,
    License,
    QueryProcessor,
    MatchState,
    Match,
    CMP,
    Hash,
    LicenseNodeEntry,
    SelectLicenseeHash,
    ReverseFetch,
    Decoder,
    LicenseInterface,
    FriendCertInterface,
    SelectFriendCertPair,
    SPECIAL_NODES,
} from "../../src";

// These are exported friend certificates taken from
// ./src/sdk/tools/cert/examples/cert/friend/cert{a,b,certself}.
// If the need arises to regenerate these use the script provided examples/cert/friend/test.sh.
// Then copy the hexadecimal values from the json files into these variables.
//
// Friend cert A (certa/friendCert.json:cert hex string).
const friendCertImageA = Buffer.from("00020002000015000020b5d0a63764ba36056a43c0415af79557c34c5ace56b9325923890ec5e0843868150100212041a5274e4b16118c68b114debd831013429f50e7a2d014934477e17fa666544802020008030000000c04633372600c05a0af6fe01f07481be2f981c937299ce3b6d8bab835778fedebfaf52c79d52626b7fcd21d0a8d020901150a004100f135788c20d0100afc81296e458f70a57797441e58581c90eead941b144802be5d98230fe8013e1aedbc589ecaab58961b856837ab3a82cb6ab75a818c406909151e0002abba", "hex");

const friendCertAIssuer = Buffer.from("b5d0a63764ba36056a43c0415af79557c34c5ace56b9325923890ec5e0843868", "hex");

// Friend cert B (certb/friendCert.json:cert hex string).
const friendCertImageB = Buffer.from("000200020000150000207b16e7f0d66ab67893e5927a7e51a3096a99b495b555ef0fe5f0d8dc0c55fcbb150100212041a5274e4b16118c68b114debd831013429f50e7a2d014934477e17fa666544802020008030000000c04633372600c05a0af6fe01f07481be2f981c937299ce3b6d8bab835778fedebfaf52c79d52626b7fcd21d0a8d020901150a004100bdd232ac398fb2f828d873a6cd3c8bd5f0167ff0d8483bbc3741ce50d0b3ed40759c5d78303949fb1e57295165a7776803ec9c72e83bf051b384e3a8aee0d101151e0002beef", "hex");

const friendCertBIssuer = Buffer.from("7b16e7f0d66ab67893e5927a7e51a3096a99b495b555ef0fe5f0d8dc0c55fcbb", "hex");

// Self cert
// Friend certself (certself/friendCert.json:cert hex string).
const friendCertImageASelf = Buffer.from("00020002000015000020b5d0a63764ba36056a43c0415af79557c34c5ace56b9325923890ec5e0843868150100212041a5274e4b16118c68b114debd831013429f50e7a2d014934477e17fa666544802020008030000000c04633372600c05a0af6fe01f0789a1fe894f2f481064804e609b08ca72e20c53a16942009c1077ac260db34f31020901150a0041008b8fd3c628e9099f4c9b2ffdef054f8a9dd08294b5fbb03b509830438b4ee12232166a3b2fa098f4e4852cb47d2cb194d5fe8dc9244aaaba8c7dd6ff212d4d0d151e0005b0bbafe444", "hex");

const friendCertIIssuer = Buffer.from("41a5274e4b16118c68b114debd831013429f50e7a2d014934477e17fa6665448", "hex");

class DriverTestWrapper extends Driver {
    public async insertNodes(nodes: NodeInterface[], now: number, preserveTransient: boolean = false): Promise<Buffer[]> {
        return super.insertNodes(nodes, now, preserveTransient);
    }

    protected async storeNodes(nodes: NodeInterface[], now: number, preserveTransient: boolean = false) {
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

    public matchFirst(node: NodeInterface, currentLevelMatches: [Match, MatchState][]): boolean {
        return super.matchFirst(node, currentLevelMatches);
    }

    public matchSecond(nodes: NodeInterface[], currentLevelMatches: [Match, MatchState][]): NodeInterface[] {
        return super.matchSecond(nodes, currentLevelMatches);
    }

    public async filterPrivateNodes(allNodes: NodeInterface[], allowRightsByAssociation: boolean): Promise<[NodeInterface[], NodeInterface[]]> {
        return super.filterPrivateNodes(allNodes, allowRightsByAssociation);
    }

    public async filterLicensedNodes(nodes: NodeInterface[], targetPublicKey: Buffer, includeLicenses: boolean = false):
        Promise<[nodes: NodeInterface[], licenses: {[nodeId1: string]: {[licenseId1: string]: Buffer}}]> {
        return super.filterLicensedNodes(nodes, targetPublicKey, includeLicenses);
    }

    public async embedNodes(nodes: NodeInterface[]): Promise<{originalNode: NodeInterface, embeddedNode: NodeInterface}[]> {
        return super.embedNodes(nodes);
    }

    public getLicenseNodeTree(node: NodeInterface, sourcePublicKey: Buffer | undefined, targetPublicKey: Buffer): LicenseNodeEntry[] {
        return super.getLicenseNodeTree(node, sourcePublicKey, targetPublicKey);
    }

    public async fetchLicenses(licensesToCheck: Buffer[], selectOnlyWriteLicenses: boolean): Promise<{[hash: string]: SelectLicenseeHash[]}> {
        return super.fetchLicenses(licensesToCheck, selectOnlyWriteLicenses);
    }

    public async checkSourceNodesPermissions(nodeId1s: Buffer[]): Promise<{[id1: string]: boolean}> {
        return super.checkSourceNodesPermissions(nodeId1s);
    }

    public async applyFriendCerts(embeddingLicense: LicenseInterface, aCert: FriendCertInterface, bCert: FriendCertInterface): Promise<boolean> {
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

    afterEach("Close database", function() {
        db?.close();
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

    afterEach("Close database", function() {
        db?.close();
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

    afterEach("Close database", function() {
        db?.close();
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

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
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
                    nodeType: Data.GetType(),
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

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            // Do nothing
        };

        let sourcePublicKey = Buffer.alloc(32).fill(110);
        let targetPublicKey = Buffer.alloc(32).fill(110);
        let parentId = Buffer.alloc(32).fill(0);
        let nodeIdA = Buffer.alloc(32).fill(1);
        let nodeIdB = Buffer.alloc(32).fill(2);
        let nodeIdC = Buffer.alloc(32).fill(3);
        let nodeIdAA = Buffer.alloc(32).fill(10);
        let nodeIdBA = Buffer.alloc(32).fill(11);
        let nodeIdBB = Buffer.alloc(32).fill(12);
        let nodeIdCA = Buffer.alloc(32).fill(13);

        let rootNode = undefined;

        const nodeA = await nodeUtil.createDataNode({
            id1: nodeIdA,
            owner: sourcePublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
        });

        const nodeB = await nodeUtil.createDataNode({
            id1: nodeIdB,
            owner: sourcePublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
        });

        const nodeC = await nodeUtil.createDataNode({
            id1: nodeIdC,
            owner: sourcePublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
        });

        const nodeAA = await nodeUtil.createDataNode({
            id1: nodeIdAA,
            owner: sourcePublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            contentType: "app/one",
        });

        const nodeBA = await nodeUtil.createDataNode({
            id1: nodeIdBA,
            owner: sourcePublicKey,
            parentId: nodeIdB,
            expireTime: now + 10000,
            creationTime: now,
            contentType: "app/hello",
        });

        const nodeBB = await nodeUtil.createDataNode({
            id1: nodeIdBB,
            owner: sourcePublicKey,
            parentId: nodeIdB,
            expireTime: now + 10000,
            creationTime: now,
            contentType: "app/one",
        });

        const nodeCA = await nodeUtil.createDataNode({
            id1: nodeIdCA,
            owner: sourcePublicKey,
            parentId: nodeIdC,
            expireTime: now + 10000,
            creationTime: now,
            contentType: "app/one",
        });

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey,
            targetPublicKey,
            match: [],
        }});

        let qp = new QueryProcessorWrapper(db, fetchRequest.query, rootNode, now, handleFetchReplyData);

        let match1 = {
            nodeType: License.GetType(),
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
            nodeType: Data.GetType(),
            cursorId1: Buffer.alloc(0),
            filters: [
                {
                    field: "contentType",
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
            nodeType: Data.GetType(),
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

        let hashed = nodeCA.getHashedValue("contentType") as string;
        state3.group["contentType"] = {[hashed]: 1};

        // Create cache
        getProcessState(nodeCA, qp);

        qp.matchFirst(nodeCA, matches);
        assert(getProcessState(nodeCA, qp).matchIndexes.length === 0);
        assert(state3.counter === 0);  // No state change.

        let match4 = {
            nodeType: Data.GetType(),
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

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            // Do nothing
        };

        let sourcePublicKey = Buffer.alloc(32).fill(110);
        let targetPublicKey = Buffer.alloc(32).fill(110);
        let parentId = Buffer.alloc(32).fill(0);
        let nodeIdA = Buffer.alloc(32).fill(1);
        let nodeIdB = Buffer.alloc(32).fill(2);
        let nodeIdC = Buffer.alloc(32).fill(3);

        let rootNode = undefined;

        const nodeA = await nodeUtil.createDataNode({
            id1: nodeIdA,
            owner: sourcePublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
        });

        const nodeB = await nodeUtil.createDataNode({
            id1: nodeIdB,
            owner: sourcePublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            contentType: "app/hello",
        });

        const nodeC = await nodeUtil.createDataNode({
            id1: nodeIdC,
            owner: sourcePublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            contentType: "app/hello",
        });

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey,
            targetPublicKey,
            match: [],
        }});

        let qp = new QueryProcessorWrapper(db, fetchRequest.query, rootNode, now, handleFetchReplyData);

        let match1 = {
            nodeType: Data.GetType(),
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
            nodeType: Data.GetType(),
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

    it("#filterPrivateNodes", async function() {
        const driver = config.driver;
        const db = config.db;

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let sourcePublicKey = Buffer.alloc(32).fill(110);
        let targetPublicKey = Buffer.alloc(32).fill(110);
        let clientPublicKey2 = Buffer.alloc(32).fill(111);
        let clientPublicKey3 = Buffer.alloc(32).fill(112);
        let parentId = Buffer.alloc(32).fill(0);
        let nodeIdA = Buffer.alloc(32).fill(1);
        let nodeIdB = Buffer.alloc(32).fill(2);
        let nodeIdC = Buffer.alloc(32).fill(3);
        let nodeIdD = Buffer.alloc(32).fill(4);
        let nodeIdE = Buffer.alloc(32).fill(5);
        let nodeIdF = Buffer.alloc(32).fill(6);

        let rootNode = undefined;

        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            // Do nothing
        };

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey,
            targetPublicKey,
            match: [],
        }});

        let qp = new QueryProcessorWrapper(db, fetchRequest.query, rootNode, now, handleFetchReplyData);

        // Private
        const nodeA = await nodeUtil.createDataNode({
            id1: nodeIdA,
            owner: sourcePublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
        });

        // Private to clientPublicKey2
        const nodeB = await nodeUtil.createDataNode({
            id1: nodeIdB,
            owner: clientPublicKey2,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
        });

        // Licensed
        const nodeC = await nodeUtil.createDataNode({
            id1: nodeIdC,
            owner: sourcePublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
        });

        // Public
        const nodeD = await nodeUtil.createDataNode({
            id1: nodeIdD,
            owner: clientPublicKey2,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        });

        // hasRightsByAssociation
        const nodeE = await nodeUtil.createDataNode({
            id1: nodeIdE,
            owner: clientPublicKey2,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            hasRightsByAssociation: true,
            refId: nodeIdA,
        });

        // Create embeddable node
        const nodeF = await nodeUtil.createLicenseNode({
            id1: nodeIdF,
            owner: clientPublicKey2,
            targetPublicKey: sourcePublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            extensions: 1,
        });

        // hasRightsByAssociation but different parentIds, so won't bring permissions.
        const nodeG = await nodeUtil.createDataNode({
            id1: nodeIdE,
            owner: clientPublicKey2,
            parentId: Buffer.alloc(32).fill(200),
            expireTime: now + 10000,
            creationTime: now,
            hasRightsByAssociation: true,
            refId: nodeIdA,
        });

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



        fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey: sourcePublicKey,
            targetPublicKey: clientPublicKey3,
            match: [],
            embed: [
                {
                    nodeType: License.GetType(),
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

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let clientPublicKey = Buffer.alloc(32).fill(110);
        let clientPublicKey2 = Buffer.alloc(32).fill(111);

        let rootNodeId = Buffer.alloc(32).fill(1);

        let nodeId1A = Buffer.alloc(32).fill(10);
        let nodeId1B = Buffer.alloc(32).fill(11);

        let nodeId2A = Buffer.alloc(32).fill(20);
        let nodeId2B = Buffer.alloc(32).fill(21);

        let nodeId3A = Buffer.alloc(32).fill(30);
        let nodeId3B = Buffer.alloc(32).fill(31);

        let nodeId4A = Buffer.alloc(32).fill(40);

        let licenseId3A = Buffer.alloc(32).fill(36);
        let licenseId3A2 = Buffer.alloc(32).fill(37);
        let licenseId3A3 = Buffer.alloc(32).fill(38);

        let licenseId4A = Buffer.alloc(32).fill(46);

        // Licensed
        const node1A = await nodeUtil.createDataNode({
            id1: nodeId1A,
            parentId: nodeId2A,
            owner: clientPublicKey,
            creationTime: now,
            expireTime: now + 10000,
            isLicensed: true,
            licenseMinDistance: 2,
            licenseMaxDistance: 3,
        });

        // Licensed
        const node1B = await nodeUtil.createDataNode({
            id1: nodeId1B,
            parentId: nodeId2B,
            owner: clientPublicKey,
            creationTime: now,
            expireTime: now + 10001,
            isLicensed: true,
            licenseMinDistance: 1,
            licenseMaxDistance: 2,
        });

        // Licensed
        const node2A = await nodeUtil.createDataNode({
            id1: nodeId2A,
            parentId: nodeId3A,
            owner: clientPublicKey,
            creationTime: now,
            expireTime: now + 10000,
            isLicensed: true,
            licenseMinDistance: 1,
            licenseMaxDistance: 1,
        });

        // Licensed
        const node2B = await nodeUtil.createDataNode({
            id1: nodeId2B,
            parentId: nodeId3A,  // note: not 3B
            owner: clientPublicKey,
            creationTime: now,
            expireTime: now + 10001,
            isLicensed: true,
            licenseMinDistance: 1,
            licenseMaxDistance: 1,
        });

        // Licensed
        const node3A = await nodeUtil.createDataNode({
            id1: nodeId3A,
            parentId: nodeId4A,
            owner: clientPublicKey,
            creationTime: now,
            expireTime: now + 10000,
            isLicensed: true,
            hasOnlineValidation: true,
            isOnlineValidated: true,
            hasOnlineCert: true,
            isOnlineCertOnline: true,
        });

        // Public
        const node3B = await nodeUtil.createDataNode({
            id1: nodeId3B,
            parentId: nodeId4A,
            owner: clientPublicKey,
            creationTime: now,
            expireTime: now + 10001,
            isPublic: true,
        });

        // Public
        const node4A = await nodeUtil.createDataNode({
            id1: nodeId4A,
            parentId: rootNodeId,
            owner: clientPublicKey,
            creationTime: now,
            expireTime: now + 10000,
            isPublic: true,
        });

        // License for node4A (which is not licensed).
        const license4A = await nodeUtil.createLicenseNode({
            id1: licenseId4A,
            parentId: rootNodeId,
            refId: nodeId4A,
            owner: clientPublicKey,
            targetPublicKey: clientPublicKey,
            expireTime: now + 10000,
            creationTime: now,
        });

        // License for node3A
        const license3A = await nodeUtil.createLicenseNode({
            id1: licenseId3A,
            parentId: nodeId4A,
            refId: nodeId3A,
            owner: clientPublicKey,
            targetPublicKey: clientPublicKey,
            expireTime: now + 10000,
            creationTime: now,
            parentPathHash: Hash(nodeId3A),
        });

        // Second license for node3A
        const license3A2 = await nodeUtil.createLicenseNode({
            id1: licenseId3A2,
            parentId: nodeId4A,
            refId: nodeId3A,
            owner: clientPublicKey,
            targetPublicKey: clientPublicKey2,
            expireTime: now + 10000,
            creationTime: now+1,
            disallowRetroLicensing: true,
        });

        // Third license for node3A
        const license3A3 = await nodeUtil.createLicenseNode({
            id1: licenseId3A3,
            parentId: nodeId4A,
            refId: nodeId3A,
            owner: clientPublicKey,
            targetPublicKey: clientPublicKey2,
            expireTime: now + 10001,
            creationTime: now-1,
            disallowRetroLicensing: true,
        });

        let rootNode = undefined;

        let fetchedNodes: NodeInterface[] = [];
        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            fetchedNodes.push(...fetchReplyData.nodes ?? []);
        };

        await driver.storeNodes([node1A, node1B, node2A, node2B, node3A, node3B, node4A, license4A], now, true);

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId: rootNodeId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey: clientPublicKey,
            match: [
                {
                    nodeType: Data.GetType(),
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
        fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId: rootNodeId,
            sourcePublicKey: clientPublicKey2,
            targetPublicKey: clientPublicKey2,
            match: [
                {
                    nodeType: Data.GetType(),
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

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let targetPublicKey = Buffer.alloc(32).fill(110);
        let clientPublicKey2 = Buffer.alloc(32).fill(111);
        let parentId = Buffer.alloc(32).fill(0);
        let nodeIdA1 = Buffer.alloc(32).fill(1);
        let nodeIdL1 = Buffer.alloc(32).fill(10);

        // Licensed
        const nodeA1 = await nodeUtil.createDataNode({
            id1: nodeIdA1,
            owner: clientPublicKey2,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
        });

        // License
        const nodeL1 = await nodeUtil.createLicenseNode({
            id1: nodeIdL1,
            owner: clientPublicKey2,
            targetPublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            extensions: 1,
            refId: nodeIdA1,
        });

        let rootNode = undefined;

        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            // Do nothing
        };

        await driver.storeNodes([nodeA1, nodeL1], now);

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
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

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let clientPublicKey = Buffer.alloc(32).fill(110);
        let clientPublicKey2 = Buffer.alloc(32).fill(111);
        let targetPublicKey = Buffer.alloc(32).fill(112);
        let parentId = Buffer.alloc(32).fill(0);
        let nodeIdF = Buffer.alloc(32).fill(6);
        let nodeIdF2 = Buffer.alloc(32).fill(7);

        let rootNode = undefined;

        // Create embeddable node
        const nodeF = await nodeUtil.createLicenseNode({
            id1: nodeIdF,
            owner: clientPublicKey2,
            targetPublicKey: clientPublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            extensions: 1,
        });

        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            // Do nothing
        };

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            match: [],
        }});

        let qp = new QueryProcessorWrapper(db, fetchRequest.query, rootNode, now, handleFetchReplyData);

        let embed = await qp.embedNodes([nodeF]);
        assert(embed.length === 1);

        const nodeF2 = embed[0].embeddedNode;
        nodeF2.setId1(nodeIdF2);

        await driver.storeNodes([nodeF2], now);

        embed = await qp.embedNodes([nodeF]);
        assert(embed.length === 0);
    });

    it("#run", async function() {
        const driver = config.driver;
        const db = config.db;

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let rootNode = undefined;

        let clientPublicKey = Buffer.alloc(32).fill(110);
        let targetPublicKey = Buffer.alloc(32).fill(110);
        let parentId = Buffer.alloc(32).fill(0);
        let nodeIdA = Buffer.alloc(32).fill(1);
        let nodeIdB = Buffer.alloc(32).fill(2);
        let nodeIdC = Buffer.alloc(32).fill(3);
        let nodeIdAA = Buffer.alloc(32).fill(10);
        let nodeIdBA = Buffer.alloc(32).fill(11);
        let nodeIdBB = Buffer.alloc(32).fill(12);
        let nodeIdCA = Buffer.alloc(32).fill(13);


        const nodeA = await nodeUtil.createDataNode({
            id1: nodeIdA,
            owner: clientPublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
        });

        const nodeB = await nodeUtil.createDataNode({
            id1: nodeIdB,
            owner: clientPublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
        });

        const nodeC = await nodeUtil.createDataNode({
            id1: nodeIdC,
            owner: clientPublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
        });

        const nodeAA = await nodeUtil.createDataNode({
            id1: nodeIdAA,
            owner: clientPublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
        });

        const nodeBA = await nodeUtil.createDataNode({
            id1: nodeIdBA,
            owner: clientPublicKey,
            parentId: nodeIdB,
            expireTime: now + 10000,
            creationTime: now,
        });


        const nodeBB = await nodeUtil.createDataNode({
            id1: nodeIdBB,
            owner: clientPublicKey,
            parentId: nodeIdB,
            expireTime: now + 10000,
            creationTime: now,
        });

        const nodeCA = await nodeUtil.createDataNode({
            id1: nodeIdCA,
            owner: clientPublicKey,
            parentId: nodeIdC,
            expireTime: now + 10000,
            creationTime: now,
        });


        assert(nodeA.canSendPrivately(clientPublicKey, targetPublicKey));
        assert(nodeAA.canSendPrivately(clientPublicKey, targetPublicKey));

        await driver.insertNodes([nodeA, nodeB, nodeC, nodeAA, nodeBA, nodeBB, nodeCA], now);

        let gottenNodes: NodeInterface[] = [];
        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            gottenNodes.push(...fetchReplyData.nodes ?? []);
        };

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            match: [
                {
                    nodeType: Data.GetType(),
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

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let rootNode = undefined;

        let clientPublicKey = Buffer.alloc(32).fill(110);
        let targetPublicKey = Buffer.alloc(32).fill(110);
        let clientPublicKey2 = Buffer.alloc(32).fill(112);
        let parentId = Buffer.alloc(32).fill(1);

        const lvl1 = await createNodes(10, {parentId, owner: clientPublicKey2, isPublic: true}, now, "lvl1");

        const parentId1a = lvl1[0].getId1();
        const lvl2a = await createNodes(10, {parentId: parentId1a, owner: clientPublicKey}, now, "lvl2a");

        const parentId1b = lvl1[1].getId1();
        const lvl2b = await createNodes(10, {parentId: parentId1b, owner: clientPublicKey}, now+1000, "lvl2b");

        const parentId2a = lvl2a[0].getId1();
        const lvl3a = await createNodes(10, {parentId: parentId2a, owner: clientPublicKey, region: "SE"}, now+2000, "lvl3a");

        const parentId3a = lvl3a[9].getId1();
        const lvl4a = await createNodes(10, {parentId: parentId3a, owner: clientPublicKey, jurisdiction: "FI"}, now+3000, "lvl4a");

        let nodes1 = [...lvl1, ...lvl2a, ...lvl2b];

        await driver.storeNodes([...nodes1, ...lvl3a, ...lvl4a], now);

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            region: "EU",
            jurisdiction: "FI",
            match: [
                {
                    nodeType: Data.GetType(),
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



        fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            region: "SE",
            match: [
                {
                    nodeType: Data.GetType(),
                    filters: []
                }
            ]
        }});

        nodes2 = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([...lvl1, ...lvl2a, ...lvl2b, ...lvl3a, ...lvl4a], nodes2);
        assert(same);


        fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            jurisdiction: "FI",
            match: [
                {
                    nodeType: Data.GetType(),
                    filters: []
                }
            ]
        }});

        nodes2 = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([...lvl1, ...lvl2a, ...lvl2b, ...lvl3a, ...lvl4a], nodes2);
        assert(same);

        fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            region: "FI",
            jurisdiction: "FI",
            match: [
                {
                    nodeType: Data.GetType(),
                    filters: []
                }
            ]
        }});

        nodes2 = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([...lvl1, ...lvl2a, ...lvl2b], nodes2);
        assert(same);

        fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            region: "FI",
            jurisdiction: "FI",
            ignoreOwn: true,
            ignoreInactive: true,
            match: [
                {
                    nodeType: Data.GetType(),
                    filters: []
                }
            ]
        }});

        nodes2 = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([...lvl1], nodes2);
        assert(same);


        const node0 = lvl1[0];
        node0.setHasOnlineValidation();
        node0.setHasOnlineValidation();
        node0.setOnlineValidated(false);
        await driver.insertNodes([node0], now);

        fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            region: "FI",
            jurisdiction: "FI",
            ignoreOwn: true,
            ignoreInactive: true,
            match: [
                {
                    nodeType: Data.GetType(),
                    filters: []
                }
            ]
        }});

        nodes2 = await fetch(db, fetchRequest, now, rootNode);
        assert(nodes2.length = lvl1.length - 1);
    });

    it("#run basic query sorted on negative creationTime (sliding window)", async function() {
        const driver = config.driver;
        const db = config.db;

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let rootNode = undefined;

        let owner = Buffer.alloc(32).fill(0x10);
        let parentId = Buffer.alloc(32).fill(0x01);

        const lvl1 = await createNodes(3, {parentId, owner, isPublic: true}, now, "lvl1");

        const parentId1a = lvl1[2].getId1();

        const lvl2 = await createNodes(3, {parentId: parentId1a, owner}, now, "lvl2a");

        await driver.storeNodes([...lvl1], now);

        await driver.storeNodes([lvl2[0]], now);
        await driver.storeNodes([lvl2[1]], now);
        await driver.storeNodes([lvl2[2]], now);

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey: owner,
            targetPublicKey: owner,
            match: [
                {
                    nodeType: Data.GetType(),
                    filters: [
                        {
                            field: "creationTime",
                            value: -10,
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

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let rootNode = undefined;

        let owner = Buffer.alloc(32).fill(0x10);
        let parentId = Buffer.alloc(32).fill(0x01);

        const lvl1 = await createNodes(3, {parentId, owner, isPublic: true}, now, "lvl1");

        const parentId1a = lvl1[2].getId1();

        const lvl2 = await createNodes(3, {parentId: parentId1a, owner}, now, "lvl2a");

        await driver.storeNodes([...lvl1], now);

        await driver.storeNodes([lvl2[0]], now + 1);
        await driver.storeNodes([lvl2[1]], now + 3);
        await driver.storeNodes([lvl2[2]], now + 2);

        const fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey: owner,
            targetPublicKey: owner,
            orderByStorageTime: true,
            match: [
                {
                    nodeType: Data.GetType(),
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

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let rootNode = undefined;

        let clientPublicKey = Buffer.alloc(32).fill(110);
        let targetPublicKey = Buffer.alloc(32).fill(110);
        let clientPublicKey2 = Buffer.alloc(32).fill(112);
        let parentId = Buffer.alloc(32).fill(1);

        const lvl1 = await createNodes(10, {parentId, owner: clientPublicKey, isPublic: true, disallowPublicChildren: true}, now, "lvl1");

        const parentId1a = lvl1[0].getId1();
        const lvl2a = await createNodes(10, {parentId: parentId1a, owner: clientPublicKey, isPublic: false, onlyOwnChildren: true}, now, "lvl2a");

        const lvl2b = await createNodes(10, {parentId: parentId1a, owner: clientPublicKey, isPublic: true}, now, "lvl2b");

        const parentId2a = lvl2a[0].getId1();
        const lvl3a = await createNodes(10, {parentId: parentId2a, owner: clientPublicKey2, isPublic: true}, now, "lvl3a");

        const lvl3b = await createNodes(10, {parentId: parentId2a, owner: clientPublicKey, isPublic: true, childMinDifficulty: 3}, now, "lvl3b");

        const parentId3a = lvl3b[0].getId1();
        const lvl4a = await createNodes(10, {parentId: parentId3a, owner: clientPublicKey, isPublic: true, difficulty: 3}, now, "lvl4a");

        const lvl4b = await createNodes(10, {parentId: parentId3a, owner: clientPublicKey, isPublic: true}, now, "lvl4b");


        await driver.storeNodes([...lvl1, ...lvl2a, ...lvl2b, ...lvl3a, ...lvl3b, ...lvl4a, ...lvl4b], now);

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            depth: 3,
            match: [
                {
                    nodeType: Data.GetType(),
                    filters: []
                }
            ]
        }});

        let nodes2 = await fetch(db, fetchRequest, now, rootNode);
        let same = diffNodes([...lvl1, ...lvl2a, ...lvl3b], nodes2);
        assert(same);

        fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            depth: 4,
            match: [
                {
                    nodeType: Data.GetType(),
                    filters: []
                }
            ]
        }});

        nodes2 = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([...lvl1, ...lvl2a, ...lvl3b, ...lvl4a], nodes2);
        assert(same);


        rootNode = lvl1[0];
        fetchRequest = StorageUtil.CreateFetchRequest({query: {
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            depth: 1,
            discardRoot: false,
            limit: 2,
            match: [
                {
                    nodeType: Data.GetType(),
                    filters: []
                }
            ]
        }});

        nodes2 = await fetch(db, fetchRequest, now, rootNode);
        assert(nodes2.length === 2);
        assert((nodes2[0].getId1() as Buffer).equals(rootNode.getId1() as Buffer));
        assert((nodes2[1].getId1() as Buffer).equals(lvl2a[0].getId1() as Buffer));


        fetchRequest = StorageUtil.CreateFetchRequest({query: {
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            depth: 1,
            discardRoot: true,
            limit: 2,
            cutoffTime: BigInt(now),
            match: [
                {
                    nodeType: Data.GetType(),
                    filters: []
                }
            ]
        }});
        nodes2 = await fetch(db, fetchRequest, now, rootNode);
        assert(nodes2.length === 2);
        assert((nodes2[0].getId1() as Buffer).equals(lvl2a[0].getId1() as Buffer));
        assert((nodes2[1].getId1() as Buffer).equals(lvl2a[1].getId1() as Buffer));


        fetchRequest = StorageUtil.CreateFetchRequest({query: {
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            depth: 1,
            discardRoot: true,
            limit: 2,
            cutoffTime: BigInt(now+1),
            match: [
                {
                    nodeType: Data.GetType(),
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

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let rootNode = undefined;

        let clientPublicKey = Buffer.alloc(32).fill(110);
        let targetPublicKey = Buffer.alloc(32).fill(110);
        let clientPublicKey2 = Buffer.alloc(32).fill(112);
        let parentId = Buffer.alloc(32).fill(1);


        const lvl1 = await createNodes(10, {parentId, owner: clientPublicKey, isPublic: true}, now, "lvl1");

        const parentId1a = lvl1[0].getId();
        const lvl2a = await createNodes(10, {parentId: parentId1a, owner: clientPublicKey, isPublic: true}, now, "lvl2a");

        const lvl2b = await createNodes(10, {parentId: parentId1a, owner: clientPublicKey, isPublic: true}, now+1000, "lvl2b");

        const parentId2a = lvl2a[0].getId();
        const lvl3a = await createNodes(10, {parentId: parentId2a, owner: clientPublicKey, isPublic: true}, now, "lvl3a");

        const parentId2b = lvl2b[0].getId();
        const lvl3b = await createNodes(10, {parentId: parentId2b, owner: clientPublicKey, isPublic: true}, now+1000, "lvl3b");

        await driver.storeNodes([...lvl1, ...lvl2a, ...lvl2b, ...lvl3a, ...lvl3b], now);

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            match: [
                {
                    level: [1],
                    nodeType: Data.GetType(),
                    filters: []
                },
                {
                    id: 100,
                    level: [2],
                    nodeType: Data.GetType(),
                    filters: [
                        {
                            field: "data",
                            operator: ":0,5",
                            cmp: CMP.EQ,
                            value: Buffer.from("lvl2a"),
                        }
                    ]
                },
                {
                    id: 101,
                    level: [2],
                    nodeType: Data.GetType(),
                    filters: [
                        {
                            field: "data",
                            operator: ":0,5",
                            cmp: CMP.EQ,
                            value: Buffer.from("lvl2b"),
                        }
                    ]
                },
                {
                    requireId: 100,
                    level: [3],
                    nodeType: Data.GetType(),
                    filters: []
                },
                {
                    requireId: 101,
                    limit: 5,
                    level: [3],
                    nodeType: Data.GetType(),
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

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let rootNode = undefined;

        let clientPublicKey = Buffer.alloc(32).fill(110);
        let targetPublicKey = Buffer.alloc(32).fill(110);
        let clientPublicKey2 = Buffer.alloc(32).fill(112);
        let parentId = Buffer.alloc(32).fill(1);


        const lvl1 = await createNodes(10, {hasOnlineValidation: true, isOnlineValidated: true, parentId,
            owner: clientPublicKey, isPublic: true}, now, "lvl1");

        const parentId1a = lvl1[0].getId();
        const lvl2a = await createNodes(10, {parentId: parentId1a, owner: clientPublicKey, isPublic: true}, now, "lvl2a");

        const lvl2b = await createNodes(10, {parentId: parentId1a, owner: clientPublicKey, isPublic: true}, now+1000, "lvl2b");

        const parentId2a = lvl2a[0].getId();
        const lvl3a = await createNodes(10, {hasOnlineValidation: true, isOnlineValidated: true,
            parentId: parentId2a, owner: clientPublicKey, isPublic: true}, now, "lvl3a");

        const parentId2b = lvl2b[0].getId();
        const lvl3b = await createNodes(10, {parentId: parentId2b, owner: clientPublicKey, isPublic: true}, now+1000, "lvl3b");

        await driver.storeNodes([...lvl1, ...lvl2a, ...lvl2b, ...lvl3a, ...lvl3b], now, true);

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            cutoffTime: 0n,
            match: [
                {
                    level: [],
                    nodeType: Data.GetType(),
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
        node.setOnlineValidated();
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
        node.setOnlineValidated(false);
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

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let rootNode = undefined;

        let clientPublicKey = Buffer.alloc(32).fill(110);
        let targetPublicKey = Buffer.alloc(32).fill(110);
        let clientPublicKey2 = Buffer.alloc(32).fill(112);
        let parentId = Buffer.alloc(32).fill(1);
        let cyclicNodeId1 = Buffer.alloc(32).fill(255);


        const lvl1 = await createNodes(10, {parentId, owner: clientPublicKey, isPublic: true}, now, "lvl1");

        const parentId1a = lvl1[0].getId1();
        const lvl2a = await createNodes(10, {parentId: parentId1a, owner: clientPublicKey}, now, "lvl2a");

        const parentId1b = lvl1[1].getId1();
        const lvl2b = await createNodes(10, {parentId: parentId1b, owner: clientPublicKey}, now+1000, "lvl2b");

        const parentId2a = lvl2a[0].getId1();
        const lvl3a = await createNodes(10, {parentId: parentId2a, owner: clientPublicKey}, now+2000, "lvl3a");

        const parentId3a = lvl3a[9].getId1();
        const lvl4a = await createNodes(10, {parentId: parentId3a, owner: clientPublicKey}, now+3000, "lvl4a");

        const cyclicNode = lvl1[0].copy(parentId3a);
        cyclicNode.setId1(cyclicNodeId1);

        let nodes1 = [...lvl1, ...lvl2a, ...lvl2b, ...lvl3a, ...lvl4a, cyclicNode];

        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            // Do nothing
        };

        await driver.storeNodes(nodes1, now);

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
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

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            // Do nothing
        };

        let clientPublicKey = Buffer.alloc(32).fill(110);
        let clientPublicKey2 = Buffer.alloc(32).fill(112);
        let targetPublicKey = Buffer.alloc(32).fill(110);
        let parentId = Buffer.alloc(32).fill(0);
        let nodeIdA = Buffer.alloc(32).fill(1);
        let nodeIdB = Buffer.alloc(32).fill(2);
        let nodeIdC = Buffer.alloc(32).fill(3);
        let nodeIdL1 = Buffer.alloc(32).fill(10);
        let nodeIdL1b = Buffer.alloc(32).fill(11);

        let rootNode = undefined;

        const nodeA = await nodeUtil.createDataNode({
            id1: nodeIdA,
            owner: clientPublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
        });

        const nodeB = await nodeUtil.createDataNode({
            id1: nodeIdB,
            owner: clientPublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            isBeginRestrictiveWriteMode: true,
        });

        const nodeC = await nodeUtil.createDataNode({
            id1: nodeIdC,
            owner: clientPublicKey2,
            parentId: nodeIdB,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        });

        await driver.storeNodes([nodeA, nodeB, nodeC], now);

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey,
            match: [
                {
                    nodeType: Data.GetType(),
                    filters: []
                },
            ]
        }});

        let nodes = await fetch(db, fetchRequest, now, rootNode);
        let same = diffNodes([nodeA, nodeB], nodes);
        assert(same);

        const nodeL1 = await nodeUtil.createLicenseNode({
            id1: nodeIdL1,
            owner: clientPublicKey,
            targetPublicKey: clientPublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            refId: nodeIdB,
            isRestrictiveModeWriter: true,
        });

        await driver.storeNodes([nodeL1], now);

        nodes = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([nodeA, nodeB], nodes);
        assert(same);


        const nodeL1b = await nodeUtil.createLicenseNode({
            id1: nodeIdL1b,
            owner: clientPublicKey,
            targetPublicKey: clientPublicKey2,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            refId: nodeIdB,
            isRestrictiveModeWriter: true,
        });

        await driver.storeNodes([nodeL1b], now);

        nodes = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([nodeA, nodeB, nodeC], nodes);
        assert(same);
    });

    it("restrictiveWriterNodes #2 - begin two consecutive write modes of different authors", async function() {
        const driver = config.driver;
        const db = config.db;

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            // Do nothing
        };

        let clientPublicKey = Buffer.alloc(32).fill(110);
        let clientPublicKey2 = Buffer.alloc(32).fill(111);
        let clientPublicKey3 = Buffer.alloc(32).fill(112);
        let parentId = Buffer.alloc(32).fill(0);
        let nodeIdA = Buffer.alloc(32).fill(1);
        let nodeIdB = Buffer.alloc(32).fill(2);
        let nodeIdC = Buffer.alloc(32).fill(3);
        let nodeIdL1 = Buffer.alloc(32).fill(10);
        let nodeIdL1a = Buffer.alloc(32).fill(11);
        let nodeIdL1b = Buffer.alloc(32).fill(12);

        let rootNode = undefined;

        const nodeA = await nodeUtil.createDataNode({
            id1: nodeIdA,
            owner: clientPublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
            isBeginRestrictiveWriteMode: true,
        });

        const nodeB = await nodeUtil.createDataNode({
            id1: nodeIdB,
            owner: clientPublicKey2,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
            isBeginRestrictiveWriteMode: true,
        });

        const nodeC = await nodeUtil.createDataNode({
            id1: nodeIdC,
            owner: clientPublicKey3,
            parentId: nodeIdB,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        });

        await driver.storeNodes([nodeA, nodeB, nodeC], now);

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey: clientPublicKey,
            match: [
                {
                    nodeType: Data.GetType(),
                    filters: []
                },
            ]
        }});

        let nodes = await fetch(db, fetchRequest, now, rootNode);
        let same = diffNodes([nodeA], nodes);
        assert(same);

        const nodeL1 = await nodeUtil.createLicenseNode({
            id1: nodeIdL1,
            owner: clientPublicKey,
            targetPublicKey: clientPublicKey2,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            refId: nodeIdA,
            isRestrictiveModeWriter: true,
        });

        const nodeL1a = await nodeUtil.createLicenseNode({
            id1: nodeIdL1a,
            owner: clientPublicKey,
            targetPublicKey: clientPublicKey3,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            refId: nodeIdA,
            isRestrictiveModeWriter: true,
        });

        await driver.storeNodes([nodeL1, nodeL1a], now);

        nodes = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([nodeA, nodeB], nodes);
        assert(same);


        const nodeL1b = await nodeUtil.createLicenseNode({
            id1: nodeIdL1b,
            owner: clientPublicKey2,
            targetPublicKey: clientPublicKey3,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            refId: nodeIdB,
            isRestrictiveModeWriter: true,
        });


        await driver.storeNodes([nodeL1b], now);

        nodes = await fetch(db, fetchRequest, now, rootNode);
        same = diffNodes([nodeA, nodeB, nodeC], nodes);
        assert(same);
    });

    it("restrictiveWriterNodes #3 - inheritence and manager permissions to end write modes", async function() {
        const driver = config.driver;
        const db = config.db;

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            // Do nothing
        };

        let clientPublicKey = Buffer.alloc(32).fill(210);
        let clientPublicKey2 = Buffer.alloc(32).fill(211);
        let clientPublicKey3 = Buffer.alloc(32).fill(212);
        let parentId = Buffer.alloc(32).fill(0);
        let nodeIdA = Buffer.alloc(32).fill(1);
        let nodeIdAb = Buffer.alloc(32).fill(2);
        let nodeIdB = Buffer.alloc(32).fill(3);
        let nodeIdC = Buffer.alloc(32).fill(4);
        let nodeIdD1 = Buffer.alloc(32).fill(10);
        let nodeIdD2 = Buffer.alloc(32).fill(11);
        let nodeIdD3 = Buffer.alloc(32).fill(12);
        let nodeIdE1 = Buffer.alloc(32).fill(20);
        let nodeIdE2 = Buffer.alloc(32).fill(21);
        let nodeIdE3 = Buffer.alloc(32).fill(22);


        let licenseIdA1 = Buffer.alloc(32).fill(100);
        let licenseIdA2 = Buffer.alloc(32).fill(101);
        let licenseIdA3 = Buffer.alloc(32).fill(102);
        let licenseIdB1 = Buffer.alloc(32).fill(103);
        let licenseIdB2 = Buffer.alloc(32).fill(104);
        let licenseIdB3 = Buffer.alloc(32).fill(105);
        let licenseIdB4 = Buffer.alloc(32).fill(106);
        let licenseIdC1 = Buffer.alloc(32).fill(107);
        let licenseIdC2 = Buffer.alloc(32).fill(108);
        let licenseIdC3 = Buffer.alloc(32).fill(109);
        let licenseIdC4 = Buffer.alloc(32).fill(110);
        let licenseIdD2 = Buffer.alloc(32).fill(111);
        let licenseIdD3 = Buffer.alloc(32).fill(112);

        let rootNode = undefined;

        const nodeA = await nodeUtil.createDataNode({
            id1: nodeIdA,
            owner: clientPublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
            isBeginRestrictiveWriteMode: true,
        });

            const licenseA1 = await nodeUtil.createLicenseNode({
                id1: licenseIdA1,
                refId: nodeIdA,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeWriter: true,
            });

            const licenseA2 = await nodeUtil.createLicenseNode({
                id1: licenseIdA2,
                refId: nodeIdA,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey2,
                parentId,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeWriter: true,
            });

            const licenseA3 = await nodeUtil.createLicenseNode({
                id1: licenseIdA3,
                refId: nodeIdA,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey3,
                parentId,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeWriter: true,
            });


        const nodeAb = await nodeUtil.createDataNode({
            id1: nodeIdAb,
            owner: clientPublicKey2,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        });


        const nodeB = await nodeUtil.createDataNode({
            id1: nodeIdB,
            owner: clientPublicKey2,
            parentId: nodeIdAb,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
            isBeginRestrictiveWriteMode: true,
        });

            const licenseB1 = await nodeUtil.createLicenseNode({
                id1: licenseIdB1,
                refId: nodeIdB,
                owner: clientPublicKey2,
                targetPublicKey: clientPublicKey,
                parentId: nodeIdAb,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeWriter: true,
            });

            const licenseB2 = await nodeUtil.createLicenseNode({
                id1: licenseIdB2,
                refId: nodeIdB,
                owner: clientPublicKey2,
                targetPublicKey: clientPublicKey2,
                parentId: nodeIdAb,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeWriter: true,
            });

            const licenseB3 = await nodeUtil.createLicenseNode({
                id1: licenseIdB3,
                refId: nodeIdB,
                owner: clientPublicKey2,
                targetPublicKey: clientPublicKey3,
                parentId: nodeIdAb,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeWriter: true,
            });

            const licenseB4 = await nodeUtil.createLicenseNode({
                id1: licenseIdB4,
                refId: nodeIdB,
                owner: clientPublicKey2,
                targetPublicKey: clientPublicKey,
                parentId: nodeIdAb,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeManager: true,
            });

        const nodeC = await nodeUtil.createDataNode({
            id1: nodeIdC,
            owner: clientPublicKey,
            parentId: nodeIdB,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
            isBeginRestrictiveWriteMode: true,
        });

            const licenseC1 = await nodeUtil.createLicenseNode({
                id1: licenseIdC1,
                refId: nodeIdC,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId: nodeIdB,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeWriter: true,
            });

            const licenseC2 = await nodeUtil.createLicenseNode({
                id1: licenseIdC2,
                refId: nodeIdC,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey2,
                parentId: nodeIdB,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeWriter: true,
            });

            const licenseC3 = await nodeUtil.createLicenseNode({
                id1: licenseIdC3,
                refId: nodeIdC,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey3,
                parentId: nodeIdB,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeWriter: true,
            });

            const licenseC4 = await nodeUtil.createLicenseNode({
                id1: licenseIdC4,
                refId: nodeIdC,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey2,
                parentId: nodeIdB,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeManager: true,
            });


        const nodeD1 = await nodeUtil.createDataNode({
            id1: nodeIdD1,
            owner: clientPublicKey2,
            parentId: nodeIdC,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
            isEndRestrictiveWriteMode: true,
        });

        const nodeD2 = await nodeUtil.createDataNode({
            id1: nodeIdD2,
            owner: clientPublicKey2,
            parentId: nodeIdC,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
            isBeginRestrictiveWriteMode: true,
        });

            const licenseD2 = await nodeUtil.createLicenseNode({
                id1: licenseIdD2,
                refId: nodeIdD2,
                owner: clientPublicKey2,
                targetPublicKey: clientPublicKey3,
                parentId: nodeIdC,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeWriter: true,
            });


        const nodeD3 = await nodeUtil.createDataNode({
            id1: nodeIdD3,
            owner: clientPublicKey2,
            parentId: nodeIdC,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
            isEndRestrictiveWriteMode: true,
            isBeginRestrictiveWriteMode: true,
        });

            const licenseD3 = await nodeUtil.createLicenseNode({
                id1: licenseIdD3,
                refId: nodeIdD3,
                owner: clientPublicKey2,
                targetPublicKey: clientPublicKey3,
                parentId: nodeIdC,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeWriter: true,
            });


        const nodeE1 = await nodeUtil.createDataNode({
            id1: nodeIdE1,
            owner: clientPublicKey3,
            parentId: nodeIdD1,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        });

        const nodeE2 = await nodeUtil.createDataNode({
            id1: nodeIdE2,
            owner: clientPublicKey3,
            parentId: nodeIdD2,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        });

        const nodeE3 = await nodeUtil.createDataNode({
            id1: nodeIdE3,
            owner: clientPublicKey3,
            parentId: nodeIdD3,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        });

        await driver.storeNodes([nodeA, nodeAb, nodeB, nodeC, nodeD1, nodeD2, nodeD3, nodeE1, nodeE2, nodeE3], now);

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey: clientPublicKey,
            match: [
                {
                    nodeType: Data.GetType(),
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

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            // Do nothing
        };

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

        let licenseIdA = Buffer.alloc(32).fill(100);
        let licenseIdAw = Buffer.alloc(32).fill(101);
        let licenseIdAw2 = Buffer.alloc(32).fill(102);
        let licenseIdB1w = Buffer.alloc(32).fill(103);
        let licenseIdB1w2 = Buffer.alloc(32).fill(104);
        let licenseIdB2w = Buffer.alloc(32).fill(105);
        let licenseIdB2w2 = Buffer.alloc(32).fill(106);
        let licenseIdB2 = Buffer.alloc(32).fill(107);
        let licenseIdC1w = Buffer.alloc(32).fill(108);
        let licenseIdC1w2 = Buffer.alloc(32).fill(109);
        let licenseIdC2w = Buffer.alloc(32).fill(110);
        let licenseIdC2w2 = Buffer.alloc(32).fill(111);
        let licenseIdDw = Buffer.alloc(32).fill(112);

        const nodeA = await nodeUtil.createDataNode({
            id1: nodeIdA,
            owner: clientPublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            isBeginRestrictiveWriteMode: true,
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

            const licenseAw = await nodeUtil.createLicenseNode({
                id1: licenseIdAw,
                refId: nodeIdA,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeWriter: true,
            });

            const licenseAw2 = await nodeUtil.createLicenseNode({
                id1: licenseIdAw2,
                refId: nodeIdA,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey2,
                parentId,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeWriter: true,
            });

        const nodeB1 = await nodeUtil.createDataNode({
            id1: nodeIdB1,
            owner: clientPublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 1,
            licenseMaxDistance: 1,
            isBeginRestrictiveWriteMode: true,
        });

            const licenseB1w = await nodeUtil.createLicenseNode({
                id1: licenseIdB1w,
                refId: nodeIdB1,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId: nodeIdA,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeWriter: true,
            });

            const licenseB1w2 = await nodeUtil.createLicenseNode({
                id1: licenseIdB1w2,
                refId: nodeIdB1,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey2,
                parentId: nodeIdA,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeWriter: true,
            });

        const nodeB2 = await nodeUtil.createDataNode({
            id1: nodeIdB2,
            owner: clientPublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            isBeginRestrictiveWriteMode: true,
        });

            const licenseB2 = await nodeUtil.createLicenseNode({
                id1: licenseIdB2,
                refId: nodeIdB2,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId: nodeIdA,
                expireTime: now + 10000,
                creationTime: now,
            });

            const licenseB2w = await nodeUtil.createLicenseNode({
                id1: licenseIdB2w,
                refId: nodeIdB2,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId: nodeIdA,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeWriter: true,
            });

            const licenseB2w2 = await nodeUtil.createLicenseNode({
                id1: licenseIdB2w2,
                refId: nodeIdB2,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey2,
                parentId: nodeIdA,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeWriter: true,
            });


        const nodeC1 = await nodeUtil.createDataNode({
            id1: nodeIdC1,
            owner: clientPublicKey,
            parentId: nodeIdB1,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 1,
            licenseMaxDistance: 2,
            isBeginRestrictiveWriteMode: true,
        });

            const licenseC1w = await nodeUtil.createLicenseNode({
                id1: licenseIdC1w,
                refId: nodeIdC1,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId: nodeIdB1,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeWriter: true,
            });

            const licenseC1w2 = await nodeUtil.createLicenseNode({
                id1: licenseIdC1w2,
                refId: nodeIdC1,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey2,
                parentId: nodeIdB1,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeWriter: true,
            });

        const nodeC2 = nodeC1.copy(nodeIdB2);
        nodeC2.setId1(nodeIdC2);

            const licenseC2w = await nodeUtil.createLicenseNode({
                id1: licenseIdC2w,
                refId: nodeIdC2,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId: nodeIdB2,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeWriter: true,
            });

            const licenseC2w2 = await nodeUtil.createLicenseNode({
                id1: licenseIdC2w2,
                refId: nodeIdC2,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey2,
                parentId: nodeIdB2,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeWriter: true,
            });

        const nodeD = await nodeUtil.createDataNode({
            id1: nodeIdD,
            owner: clientPublicKey,
            parentId: nodeIdC1,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 3,
            licenseMaxDistance: 3,
            isBeginRestrictiveWriteMode: true,
        });

            const licenseDw = await nodeUtil.createLicenseNode({
                id1: licenseIdDw,
                refId: nodeIdD,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey2,
                parentId: nodeIdC1,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeWriter: true,
            });

        const nodeE1 = await nodeUtil.createDataNode({
            id1: nodeIdE1,
            owner: clientPublicKey2,
            parentId: nodeIdD,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 4,
            licenseMaxDistance: 4,
        });

        const nodeE2 = await nodeUtil.createDataNode({
            id1: nodeIdE2,
            owner: clientPublicKey2,
            parentId: nodeIdD,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 3,
            licenseMaxDistance: 3,
        });

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey: clientPublicKey,
            match: [
                {
                    nodeType: Data.GetType(),
                    filters: []
                },
            ]
        }});

        let nodes: NodeInterface[] = [];
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

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            // Do nothing
        };

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

        let licenseIdA = Buffer.alloc(32).fill(0xa0);
        let licenseIdAw = Buffer.alloc(32).fill(0xa1);
        let licenseIdAw2 = Buffer.alloc(32).fill(0xa2);
        let licenseIdB1w = Buffer.alloc(32).fill(0xb0);
        let licenseIdB1w2 = Buffer.alloc(32).fill(0xb1);
        let licenseIdB2w = Buffer.alloc(32).fill(0xb2);
        let licenseIdB2w2 = Buffer.alloc(32).fill(0xb3);
        let licenseIdB2 = Buffer.alloc(32).fill(0xb4);
        let licenseIdC1w = Buffer.alloc(32).fill(0xc0);
        let licenseIdC1w2 = Buffer.alloc(32).fill(0xc1);
        let licenseIdC2w = Buffer.alloc(32).fill(0xc2);
        let licenseIdC2w2 = Buffer.alloc(32).fill(0xc3);
        let licenseIdDw = Buffer.alloc(32).fill(0xd0);

        const nodeA = await nodeUtil.createDataNode({
            id1: nodeIdA,
            owner: clientPublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            isBeginRestrictiveWriteMode: true,
        });

            const licenseA = await nodeUtil.createLicenseNode({
                id1: licenseIdA,
                refId: nodeIdA,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId,
                expireTime: now + 10000,
                creationTime: now,
                extensions: 1,
            });

            const licenseAw = await nodeUtil.createLicenseNode({
                id1: licenseIdAw,
                refId: nodeIdA,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeWriter: true,
                extensions: 1,
            });

            const licenseAw2 = await nodeUtil.createLicenseNode({
                id1: licenseIdAw2,
                refId: nodeIdA,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey2,
                parentId,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeWriter: true,
                extensions: 1,
            });

        const nodeB1 = await nodeUtil.createDataNode({
            id1: nodeIdB1,
            owner: clientPublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 1,
            licenseMaxDistance: 1,
            isBeginRestrictiveWriteMode: true,
        });

            const licenseB1w = await nodeUtil.createLicenseNode({
                id1: licenseIdB1w,
                refId: nodeIdB1,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId: nodeIdA,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeWriter: true,
            });

            const licenseB1w2 = await nodeUtil.createLicenseNode({
                id1: licenseIdB1w2,
                refId: nodeIdB1,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey2,
                parentId: nodeIdA,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeWriter: true,
            });

        const nodeB2 = await nodeUtil.createDataNode({
            id1: nodeIdB2,
            owner: clientPublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            isBeginRestrictiveWriteMode: true,
        });

            const licenseB2 = await nodeUtil.createLicenseNode({
                id1: licenseIdB2,
                refId: nodeIdB2,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId: nodeIdA,
                expireTime: now + 10000,
                creationTime: now,
            });

            const licenseB2w = await nodeUtil.createLicenseNode({
                id1: licenseIdB2w,
                refId: nodeIdB2,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId: nodeIdA,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeWriter: true,
            });

            const licenseB2w2 = await nodeUtil.createLicenseNode({
                id1: licenseIdB2w2,
                refId: nodeIdB2,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey2,
                parentId: nodeIdA,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeWriter: true,
            });


        const nodeC1 = await nodeUtil.createDataNode({
            id1: nodeIdC1,
            owner: clientPublicKey,
            parentId: nodeIdB1,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 1,
            licenseMaxDistance: 2,
            isBeginRestrictiveWriteMode: true,
        });

            const licenseC1w = await nodeUtil.createLicenseNode({
                id1: licenseIdC1w,
                refId: nodeIdC1,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId: nodeIdB1,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeWriter: true,
            });

            const licenseC1w2 = await nodeUtil.createLicenseNode({
                id1: licenseIdC1w2,
                refId: nodeIdC1,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey2,
                parentId: nodeIdB1,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeWriter: true,
            });

        const nodeC2 = nodeC1.copy(nodeIdB2);
        nodeC2.setId1(nodeIdC2);

            const licenseC2w = await nodeUtil.createLicenseNode({
                id1: licenseIdC2w,
                refId: nodeIdC2,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId: nodeIdB2,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeWriter: true,
            });

            const licenseC2w2 = await nodeUtil.createLicenseNode({
                id1: licenseIdC2w2,
                refId: nodeIdC2,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey2,
                parentId: nodeIdB2,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeWriter: true,
            });

        const nodeD = await nodeUtil.createDataNode({
            id1: nodeIdD,
            owner: clientPublicKey,
            parentId: nodeIdC1,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 3,
            licenseMaxDistance: 3,
            isBeginRestrictiveWriteMode: true,
        });

            const licenseDw = await nodeUtil.createLicenseNode({
                id1: licenseIdDw,
                refId: nodeIdD,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey2,
                parentId: nodeIdC1,
                expireTime: now + 10000,
                creationTime: now,
                isRestrictiveModeWriter: true,
            });

        const nodeE1 = await nodeUtil.createDataNode({
            id1: nodeIdE1,
            owner: clientPublicKey2,
            parentId: nodeIdD,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 4,
            licenseMaxDistance: 4,
        });

        const nodeE2 = await nodeUtil.createDataNode({
            id1: nodeIdE2,
            owner: clientPublicKey2,
            parentId: nodeIdD,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 3,
            licenseMaxDistance: 3,
        });

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey: clientPublicKey,
            match: [
                {
                    nodeType: Data.GetType(),
                    filters: []
                },
            ],
            includeLicenses: 1,
        }});

        let nodes: NodeInterface[] = [];
        let same = false;

        await driver.storeNodes([nodeA, nodeB1, nodeB2, nodeC1, nodeC2, nodeD, nodeE1, nodeE2], now);

        nodes = await fetch(db, fetchRequest, now, rootNode);
        assert(nodes.length === 0);

        await driver.storeNodes([licenseA, licenseB2, licenseAw, licenseAw2, licenseB1w, licenseB1w2, licenseB2w, licenseB2w2, licenseC1w, licenseC1w2, licenseC2w, licenseC2w2, licenseDw], now);

        fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey: clientPublicKey,
            match: [
                {
                    nodeType: Data.GetType(),
                    filters: []
                },
            ],
            includeLicenses: 0,
            depth: 1,
        }});

        let ret = await fetch2(db, fetchRequest, now, rootNode);

        assert(ret.embed.length === 0);

        same = diffNodes([nodeA], ret.nodes);
        assert(same);



        fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey: clientPublicKey,
            match: [
                {
                    nodeType: Data.GetType(),
                    filters: []
                },
            ],
            includeLicenses: 3,
            depth: 1,
        }});

        ret = await fetch2(db, fetchRequest, now, rootNode);

        assert(ret.embed.length === 0);

        same = diffNodes([nodeA, licenseA, licenseAw], ret.nodes);
        assert(same);



        fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey: clientPublicKey2,
            match: [
                {
                    nodeType: Data.GetType(),
                    filters: []
                },
            ],
            includeLicenses: 2,
            depth: 1,
        }});

        ret = await fetch2(db, fetchRequest, now, rootNode);

        assert(ret.embed.length === 2);

        same = diffNodes([], ret.nodes);
        assert(same);


        fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey: clientPublicKey,
            targetPublicKey: clientPublicKey,
            match: [
                {
                    nodeType: Data.GetType(),
                    filters: []
                },
            ],
            includeLicenses: 3,
            depth: 10,
        }});

        ret = await fetch2(db, fetchRequest, now, rootNode);

        assert(ret.embed.length === 0);

        same = diffNodes([nodeA, licenseA, licenseAw,
            nodeB1, nodeB2, licenseB2, licenseB2w,
            nodeC1, nodeC2, licenseB1w, nodeD, nodeE1, nodeE2], ret.nodes);

        assert(same);
    });

    it("#run with ReverseFetch", async function() {
        const driver = config.driver;
        const db = config.db;

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            // Do nothing
        };

        let clientPublicKey = Buffer.alloc(32).fill(210);
        let clientPublicKey2 = Buffer.alloc(32).fill(211);
        let parentId = Buffer.alloc(32).fill(254);
        let nodeId0 = Buffer.alloc(32).fill(0);
        let nodeIdA = Buffer.alloc(32).fill(0x10);
        let nodeIdB1 = Buffer.alloc(32).fill(0x20);
        let nodeIdB2 = Buffer.alloc(32).fill(0x21);
        let nodeIdC1 = Buffer.alloc(32).fill(0x30);
        let nodeIdC2 = Buffer.alloc(32).fill(0x31);
        let nodeIdD = Buffer.alloc(32).fill(0x40);
        let nodeIdE1 = Buffer.alloc(32).fill(0x50);
        let nodeIdE2 = Buffer.alloc(32).fill(0x51);

        let licenseIdA = Buffer.alloc(32).fill(100);
        let licenseIdB2 = Buffer.alloc(32).fill(107);

        const node0 = await nodeUtil.createDataNode({
            id1: nodeId0,
            owner: clientPublicKey,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        });

        const nodeA = await nodeUtil.createDataNode({
            id1: nodeIdA,
            owner: clientPublicKey,
            parentId: nodeId0,
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
            owner: clientPublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 1,
            licenseMaxDistance: 1,
            isBeginRestrictiveWriteMode: true,
        });

        const nodeB2 = await nodeUtil.createDataNode({
            id1: nodeIdB2,
            owner: clientPublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            isBeginRestrictiveWriteMode: true,
        });

            const licenseB2 = await nodeUtil.createLicenseNode({
                id1: licenseIdB2,
                refId: nodeIdB2,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId: nodeIdA,
                expireTime: now + 10000,
                creationTime: now,
            });

        const nodeC1 = await nodeUtil.createDataNode({
            id1: nodeIdC1,
            owner: clientPublicKey,
            parentId: nodeIdB1,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 1,
            licenseMaxDistance: 2,
            isBeginRestrictiveWriteMode: true,
        });

        const nodeC2 = nodeC1.copy(nodeIdB2);
        nodeC2.setId1(nodeIdC2);

        assert((nodeC2.getId() as Buffer).equals(nodeIdC1));
        assert((nodeC2.getId1() as Buffer).equals(nodeIdC2));

        const nodeD = await nodeUtil.createDataNode({
            id1: nodeIdD,
            owner: clientPublicKey,
            parentId: nodeIdC1,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 3,
            licenseMaxDistance: 3,
            isBeginRestrictiveWriteMode: true,
        });

        const nodeE1 = await nodeUtil.createDataNode({
            id1: nodeIdE1,
            owner: clientPublicKey2,
            parentId: nodeIdD,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 4,
            licenseMaxDistance: 4,
        });

        const nodeE2 = await nodeUtil.createDataNode({
            id1: nodeIdE2,
            owner: clientPublicKey2,
            parentId: nodeIdD,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 3,
            licenseMaxDistance: 3,
        });

        await driver.storeNodes([node0, nodeA, nodeB1, nodeB2, nodeC1, nodeC2, nodeD, nodeE1, nodeE2], now);

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
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

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            // Do nothing
        };

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

        let licenseIdA = Buffer.alloc(32).fill(100);
        let licenseIdB2 = Buffer.alloc(32).fill(107);

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
            owner: clientPublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 1,
            licenseMaxDistance: 1,
            isBeginRestrictiveWriteMode: true,
        });

        const nodeB2 = await nodeUtil.createDataNode({
            id1: nodeIdB2,
            owner: clientPublicKey,
            parentId: nodeIdA,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            isBeginRestrictiveWriteMode: true,
        });

            const licenseB2 = await nodeUtil.createLicenseNode({
                id1: licenseIdB2,
                refId: nodeIdB2,
                owner: clientPublicKey,
                targetPublicKey: clientPublicKey,
                parentId: nodeIdA,
                expireTime: now + 10000,
                creationTime: now,
            });

        const nodeC1 = await nodeUtil.createDataNode({
            id1: nodeIdC1,
            owner: clientPublicKey,
            parentId: nodeIdB1,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 1,
            licenseMaxDistance: 2,
            isBeginRestrictiveWriteMode: true,
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
            isBeginRestrictiveWriteMode: true,
        });

        const nodeE1 = await nodeUtil.createDataNode({
            id1: nodeIdE1,
            owner: clientPublicKey2,
            parentId: nodeIdD,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 4,
            licenseMaxDistance: 4,
        });

        const nodeE2 = await nodeUtil.createDataNode({
            id1: nodeIdE2,
            owner: clientPublicKey2,
            parentId: nodeIdD,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            licenseMinDistance: 3,
            licenseMaxDistance: 3,
        });

        await driver.storeNodes([nodeA, nodeB1, nodeB2, nodeC1, nodeC2, nodeD, nodeE1, nodeE2], now);

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
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
        const db = config.db;

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let parentId = Buffer.alloc(32).fill(0);
        let licenseId1 = Buffer.alloc(32).fill(1);
        let licenseId2 = Buffer.alloc(32).fill(2);
        let nodeIdA = Buffer.alloc(32).fill(0x30);

        const license1 = await nodeUtil.createLicenseNode({
            id1: licenseId1,
            owner: friendCertAIssuer,
            targetPublicKey: friendCertIIssuer,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            extensions: 1,
            friendLevel: 1,
            refId: nodeIdA,
        });

        const embeddingLicense = license1.embed(friendCertBIssuer);

        assert(embeddingLicense);

        const aCert = Decoder.DecodeFriendCert(friendCertImageA);
        const bCert = Decoder.DecodeFriendCert(friendCertImageB);

        let status = aCert.verify();
        assert(status);

        status = bCert.verify();
        assert(status);

        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            // Do nothing
        };

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey: friendCertAIssuer,
            targetPublicKey: friendCertAIssuer,
            match: [],
        }});

        let qp = new QueryProcessorWrapper(db, fetchRequest.query, undefined, now, handleFetchReplyData);

        let success = await qp.applyFriendCerts(embeddingLicense, aCert, bCert);
        assert(success);
    });

    it("#getFriendCerts", async function() {
        // TODO this test could use some more.
        const driver = config.driver;
        const db = config.db;

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            // Do nothing
        };

        let parentId = Buffer.alloc(32).fill(0);
        let licenseIdA = Buffer.alloc(32).fill(0x10);
        let licenseIdB = Buffer.alloc(32).fill(0x12);
        let nodeIdA = Buffer.alloc(32).fill(0x30);
        let nodeIdB = Buffer.alloc(32).fill(0x31);

        const nodeA = await nodeUtil.createDataNode({
            id1: nodeIdA,
            owner: friendCertAIssuer,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            isSpecial: true,
            data: Buffer.from(SPECIAL_NODES.FRIENDCERT),
            embedded: friendCertImageA,
            isPublic: true,
        });


        const nodeB = await nodeUtil.createDataNode({
            id1: nodeIdB,
            owner: friendCertBIssuer,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            isSpecial: true,
            data: Buffer.from(SPECIAL_NODES.FRIENDCERT),
            embedded: friendCertImageB,
            isLicensed: true,
        });

        const licenseB = await nodeUtil.createLicenseNode({
            id1: licenseIdB,
            parentId,
            refId: nodeIdB,
            owner: friendCertBIssuer,
            targetPublicKey: friendCertIIssuer,
            expireTime: now + 10000,
            creationTime: now,
        });

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey: friendCertIIssuer,
            targetPublicKey: friendCertBIssuer,
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

        let [a,b] = await driver.store([nodeA, nodeB, licenseB], now);
        assert(a.length === 3);

        publicKeys = [friendCertAIssuer];

        friendCerts = await qp.getFriendCerts(publicKeys);

        assert(Object.keys(friendCerts).length === 1);
    });

    it("#embedNodes using friend certs", async function() {
        const driver = config.driver;
        const db = config.db;

        assert(driver);
        assert(db);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        const embed: NodeInterface[] = [];
        const nodes: NodeInterface[] = [];

        let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            nodes.push(...fetchReplyData.nodes ?? []);
            embed.push(...fetchReplyData.embed ?? []);
        };

        let parentId = Buffer.alloc(32).fill(0);
        let nodeIdA = Buffer.alloc(32).fill(0x30);
        let nodeIdB = Buffer.alloc(32).fill(0x31);      //embed
        let licenseIdA = Buffer.alloc(32).fill(0x40);  //nodes
        let licenseIdA2 = Buffer.alloc(32).fill(0x11);
        let licenseIdAA2 = Buffer.alloc(32).fill(0x12);
        let licenseIdB = Buffer.alloc(32).fill(0x41);
        let licenseIdB2 = Buffer.alloc(32).fill(0x13);
        let nodeFriendIdA = Buffer.alloc(32).fill(0x50);  //nodes
        let nodeFriendIdAA = Buffer.alloc(32).fill(0x52);  //nodes
        let nodeFriendIdB = Buffer.alloc(32).fill(0x51);  //nodes

        const nodeA = await nodeUtil.createDataNode({
            id1: nodeIdA,
            owner: friendCertAIssuer,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
        });

            const licenseA = await nodeUtil.createLicenseNode({
                id1: licenseIdA,
                parentId,
                refId: nodeIdA,
                owner: friendCertAIssuer,
                targetPublicKey: friendCertIIssuer,
                expireTime: now + 10000,
                creationTime: now,
                friendLevel: 1,
                extensions: 1,
            });

        const nodeB = await nodeUtil.createDataNode({
            id1: nodeIdB,
            owner: friendCertBIssuer,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
        });

            const licenseB = await nodeUtil.createLicenseNode({
                id1: licenseIdB,
                parentId,
                refId: nodeIdB,
                owner: friendCertBIssuer,
                targetPublicKey: friendCertIIssuer,
                expireTime: now + 10000,
                creationTime: now,
                friendLevel: 1,
                extensions: 1,
            });


        const nodeFriendA = await nodeUtil.createDataNode({
            id1: nodeFriendIdA,
            owner: friendCertAIssuer,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            isSpecial: true,
            data: Buffer.from(SPECIAL_NODES.FRIENDCERT),
            embedded: friendCertImageA,
            isPublic: true,
        });

        const nodeFriendAA = await nodeUtil.createDataNode({
            id1: nodeFriendIdAA,
            owner: friendCertAIssuer,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            isSpecial: true,
            data: Buffer.from(SPECIAL_NODES.FRIENDCERT),
            embedded: friendCertImageASelf,
            isPublic: true,
        });

        const nodeFriendB = await nodeUtil.createDataNode({
            id1: nodeFriendIdB,
            owner: friendCertBIssuer,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            isSpecial: true,
            data: Buffer.from(SPECIAL_NODES.FRIENDCERT),
            embedded: friendCertImageB,
            isPublic: true,
        });

        let [a, b] = await driver.store([nodeA, licenseA, nodeB, licenseB, nodeFriendA, nodeFriendAA, nodeFriendB], now);
        assert(a.length === 7);

        // Connect as Intermediary
        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey: friendCertIIssuer,
            targetPublicKey: friendCertAIssuer,
            match: [
                {
                    nodeType: Buffer.alloc(0),
                    filters: []
                }
            ],
            embed: [
                {
                    nodeType: License.GetType(),
                    filters: [],
                }
            ]
        }});

        let qp = new QueryProcessorWrapper(db, fetchRequest.query, undefined, now, handleFetchReplyData);

        await qp.run();

        assert(nodes.length === 4);
        assert(embed.length === 2);

        let nodeIds = nodes.map( node => (node.getId1() as Buffer).toString("hex") );
        assert(nodeIds.includes(licenseIdA.toString("hex")));
        assert(nodeIds.includes(nodeFriendIdA.toString("hex")));
        assert(nodeIds.includes(nodeFriendIdB.toString("hex")));
        assert(nodeIds.includes(nodeFriendIdAA.toString("hex")));

        nodeIds = embed.map( node => (node.getRefId() as Buffer).toString("hex") );
        assert(nodeIds.includes(nodeIdA.toString("hex")));
        assert(nodeIds.includes(nodeIdB.toString("hex")));

        // Store embedded node and query again.
        //
        //embeddedNode1.setId1(licenseIdB2);
        embed[0].setId1(licenseIdB2);
        embed[1].setId1(licenseIdAA2);
        [a, b] = await driver.store(embed, now);
        assert(a.length === 2);

        nodes.length = 0;
        embed.length = 0;

        qp = new QueryProcessorWrapper(db, fetchRequest.query, undefined, now, handleFetchReplyData);
        await qp.run();

        assert(nodes.length === 8);
        assert(embed.length === 0);
        nodeIds = nodes.map( node => (node.getId1() as Buffer).toString("hex") );
        assert(nodeIds.includes(licenseIdA.toString("hex")));
        assert(nodeIds.includes(nodeFriendIdA.toString("hex")));
        assert(nodeIds.includes(nodeFriendIdB.toString("hex")));
        assert(nodeIds.includes(nodeFriendIdAA.toString("hex")));
        assert(nodeIds.includes(nodeIdA.toString("hex")));
        assert(nodeIds.includes(licenseIdAA2.toString("hex")));
        assert(nodeIds.includes(nodeIdB.toString("hex")));
        assert(nodeIds.includes(licenseIdB2.toString("hex")));

        fetchRequest.query.targetPublicKey = friendCertBIssuer;

        nodes.length = 0;
        embed.length = 0;

        qp = new QueryProcessorWrapper(db, fetchRequest.query, undefined, now, handleFetchReplyData);
        await qp.run();

        assert(nodes.length === 4);
        assert(embed.length === 1);

        nodeIds = nodes.map( node => (node.getId1() as Buffer).toString("hex") );
        assert(nodeIds.includes(licenseIdB.toString("hex")));
        assert(nodeIds.includes(nodeFriendIdA.toString("hex")));
        assert(nodeIds.includes(nodeFriendIdB.toString("hex")));
        assert(nodeIds.includes(nodeFriendIdAA.toString("hex")));

        nodeIds = embed.map( node => (node.getRefId() as Buffer).toString("hex") );
        assert(nodeIds.includes(nodeIdA.toString("hex")));
    });
}

async function fetch(db: DBClient, fetchRequest: FetchRequest, now: number, rootNode?: NodeInterface): Promise<NodeInterface[]> {

    const nodes: NodeInterface[] = [];
    let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
        nodes.push(...fetchReplyData.nodes ?? []);
    };

    let qp = new QueryProcessorWrapper(db, fetchRequest.query, rootNode, now, handleFetchReplyData);
    await qp.run();

    return nodes;
}

async function fetch2(db: DBClient, fetchRequest: FetchRequest, now: number, rootNode?: NodeInterface): Promise<{nodes: NodeInterface[], embed: NodeInterface[]}> {

    const nodes: NodeInterface[] = [];
    const embed: NodeInterface[] = [];

    let handleFetchReplyData = (fetchReplyData: FetchReplyData) => {
        nodes.push(...fetchReplyData.nodes ?? []);
        embed.push(...fetchReplyData.embed ?? []);
    };

    let qp = new QueryProcessorWrapper(db, fetchRequest.query, rootNode, now, handleFetchReplyData);
    await qp.run();

    return {nodes, embed};
}

async function createNodes(count: number, params: any, now: number, prefix?: string): Promise<NodeInterface[]> {

    prefix = prefix ?? "";
    const nodeUtil = new NodeUtil();

    const nodes: NodeInterface[] = [];

    for (let i=0; i<count; i++) {
        const id1 = Hash([params.parentId, prefix, i, ""+now]);
        const node = await nodeUtil.createDataNode({
            ...params,
            creationTime: now + i,
            expireTime: now + i + 10000,
            id1,
            data: Buffer.from(`${prefix}_${i}/${count-1}`),
        });

        nodes.push(node);
    }

    return nodes;
}

function diffNodes(nodes1: NodeInterface[], nodes2: NodeInterface[]): boolean {

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

function getProcessState(node: NodeInterface, qp: QueryProcessor, createCache: boolean = true): any {
    const idStr = (node.getId() as Buffer).toString("hex");
    const id1Str = (node.getId1() as Buffer).toString("hex");

    //@ts-ignore
    let obj1 = qp.alreadyProcessedNodes[idStr]?.id1s[id1Str];

    if (!obj1) {
        if (!createCache) {
            return undefined;
        }

        obj1 = {
            parentId: node.getParentId()!.toString("hex"),
            owner: node.getOwner()!,
            childMinDifficulty: node.getChildMinDifficulty() ?? 0,
            disallowPublicChildren: node.disallowPublicChildren(),
            onlyOwnChildren: node.onlyOwnChildren(),
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
