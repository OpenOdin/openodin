import {
    assert,
} from "chai";

import {
    Client,
    CreatePair,
} from "pocket-sockets";

import {
    Messaging,
    ExpectingReply,
} from "pocket-messaging";

import {
    DatabaseUtil,
    DBClient,
    TABLES,
    BLOB_TABLES,
    Storage,
    P2PClient,
    PeerProps,
    ConnectionType,
    SignatureOffloader,
    Driver,
    BlobDriver,
    SendResponseFn,
    FetchRequest,
    FetchResponse,
    Transformer,
    Trigger,
    StorageUtil,
    Data,
    Status,
    sleep,
    FetchReplyData,
    NodeInterface,
    NodeUtil,
    MESSAGE_SPLIT_BYTES,
    StoreRequest,
    HandlerFn,
    StoreResponse,
    Node,
    Decoder,
    UnsubscribeRequest,
    UnsubscribeResponse,
    WriteBlobRequest,
    WriteBlobResponse,
    ReadBlobRequest,
    ReadBlobResponse,
    Hash,
} from "../../src";

class StorageWrapper extends Storage {
    public allowAnotherTransformer(): boolean {
        return super.allowAnotherTransformer();
    }

    public addTrigger(fetchRequest: FetchRequest, msgId: Buffer, sendResponse: SendResponseFn<FetchResponse>, transformer?: Transformer): Trigger {
        return super.addTrigger(fetchRequest, msgId, sendResponse, transformer);
    }

    public async runTrigger(trigger: Trigger): Promise<number> {
        return super.runTrigger(trigger);
    }

    public async uncorkTrigger(trigger: Trigger): Promise<number | undefined> {
        return super.uncorkTrigger(trigger);
    }

    public emitInsertEvent(triggerNodeIds: Buffer[], muteMsgIds: Buffer[]): Promise<number>[] {
        return super.emitInsertEvent(triggerNodeIds, muteMsgIds);
    }

    public getTransformer(fetchRequest: FetchRequest, sendResponse: SendResponseFn<FetchResponse>): Transformer | undefined {
        return super.getTransformer(fetchRequest, sendResponse);
    }

    public getReadyTransformer(fetchRequest: FetchRequest): Transformer | undefined {
        return super.getReadyTransformer(fetchRequest);
    }

    public chunkFetchResponse(fetchReplyData: FetchReplyData, seq: number): FetchResponse[] {
        return super.chunkFetchResponse(fetchReplyData, seq, false);
    }

    public async handleStoreWrapped(peer: P2PClient, storeRequest: StoreRequest, fromMsgId: Buffer, expectingReply: ExpectingReply, sendResponse?: SendResponseFn<StoreResponse>) {
        return this.handleStore(peer, storeRequest, fromMsgId, expectingReply, sendResponse);
    }

    public async handleFetchWrapped(peer: P2PClient, fetchRequest: FetchRequest, fromMsgId: Buffer, expectingReply: ExpectingReply, sendResponse?: SendResponseFn<FetchResponse>) {
        return this.handleFetch(peer, fetchRequest, fromMsgId, expectingReply, sendResponse);
    }

    public handleUnsubscribeWrapped(peer: P2PClient, unsubscribeRequest: UnsubscribeRequest, fromMsgId: Buffer, expectingReply: ExpectingReply, sendResponse?: SendResponseFn<UnsubscribeResponse>) {
        return this.handleUnsubscribe(peer, unsubscribeRequest, fromMsgId, expectingReply, sendResponse);
    }

    public handleWriteBlobWrapped(peer: P2PClient, writeBlobRequest: WriteBlobRequest, fromMsgId: Buffer, expectingReply: ExpectingReply, sendResponse?: SendResponseFn<WriteBlobResponse>) {
        return this.handleWriteBlob(peer, writeBlobRequest, fromMsgId, expectingReply, sendResponse);
    }

    public handleReadBlobWrapped(peer: P2PClient, readBlobRequest: ReadBlobRequest, fromMsgId: Buffer, expectingReply: ExpectingReply, sendResponse?: SendResponseFn<ReadBlobResponse>) {
        return this.handleReadBlob(peer, readBlobRequest, fromMsgId, expectingReply, sendResponse);
    }
}

describe("Storage: triggers", function() {
    let signatureOffloader: SignatureOffloader | undefined;
    let driver: Driver | undefined;
    let db: DBClient | undefined;
    let storage: StorageWrapper | undefined;
    let p2pClient: P2PClient | undefined;
    let socket1: Client | undefined;
    let socket2: Client | undefined;
    let messaging1: Messaging | undefined;

    beforeEach("Create Storage instance", async function() {
        signatureOffloader = new SignatureOffloader();
        signatureOffloader.init();

        db = new DBClient(await DatabaseUtil.OpenSQLite());
        driver = new Driver(db);

        // Create virtual paired sockets.
        [socket1, socket2] = CreatePair();
        messaging1 = new Messaging(socket1, 0);

        const clientProps = makePeerProps(ConnectionType.STORAGE_CLIENT);

        const serverProps = makePeerProps(ConnectionType.STORAGE_SERVER);

        p2pClient = new P2PClient(messaging1, serverProps, clientProps);

        storage = new StorageWrapper(p2pClient, signatureOffloader, driver);

        storage.init();
    });

    afterEach("Close Storage instance", function() {
        signatureOffloader?.close();
        driver?.close();
        db?.close();
        storage?.close();
        p2pClient?.close();
        socket1?.close();
        socket2?.close();
        messaging1?.close();
    });

    it("#allowAnotherTransformer", function() {
        assert(storage);

        let result = storage.allowAnotherTransformer();
        assert(result);
    });

    it("#addTrigger, #uncorkTrigger, #dropTrigger", async function() {
        assert(storage);

        let clientPublicKey = Buffer.alloc(32).fill(0x01);
        let targetPublicKey = Buffer.alloc(32).fill(0x02);
        let triggerNodeId = Buffer.alloc(32).fill(0x10);
        let msgId = Buffer.from([1,2,3,4,5]);

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId: Buffer.alloc(32),
            clientPublicKey,
            targetPublicKey,
            triggerNodeId,
            match: [
                {
                    nodeType: Data.GetType(),
                    filters: []
                }
            ]
        }});

        let response: any;
        const sendResponse: any = (obj: any) => {
            response = obj;
        };

        const trigger = storage.addTrigger(fetchRequest, msgId, sendResponse);

        assert(trigger);

        const triggerNodeIdStr = triggerNodeId.toString("hex");

        //@ts-ignore
        assert(storage.triggers[triggerNodeIdStr][0] === trigger);

        assert(trigger.isCorked);
        assert(trigger.isPending === false);

        let i: number | undefined;

        i = await storage.runTrigger(trigger);
        assert(i === 2);
        assert(trigger.isPending);

        // Not that no database tables have been created so this shall fail.
        i = await storage.uncorkTrigger(trigger);

        //@ts-ignore
        assert(trigger.isCorked === false);
        assert(trigger.isPending === false);
        assert(i === 3);
        assert(response?.status === Status.ERROR);

        //@ts-ignore
        assert(storage.triggers[triggerNodeIdStr] === undefined);
    });

    it("#addTrigger, #uncorkTrigger, #emitInsertEvent, #dropTrigger", async function() {
        assert(storage);
        assert(db);
        assert(driver);

        // Create the database tables so that we do not get an error on fetch.
        for (let table in TABLES) {
            await db.run(`DROP TABLE IF EXISTS ${table};`);
            for (let idx in TABLES[table].indexes) {
                await db.run(`DROP INDEX IF EXISTS ${idx};`);
            }
        }

        await driver.createTables();

        let clientPublicKey = Buffer.alloc(32).fill(0x01);
        let targetPublicKey = Buffer.alloc(32).fill(0x02);
        let triggerNodeId = Buffer.alloc(32).fill(0x10);
        let msgId = Buffer.from([1,2,3,4,5]);

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId: Buffer.alloc(32),
            clientPublicKey,
            targetPublicKey,
            triggerNodeId,
            match: [
                {
                    nodeType: Data.GetType(),
                    filters: []
                }
            ]
        }});

        let response: any;
        const sendResponse: any = (obj: any) => {
            response = obj;
        };

        const trigger = storage.addTrigger(fetchRequest, msgId, sendResponse);

        assert(trigger);

        const triggerNodeIdStr = triggerNodeId.toString("hex");

        //@ts-ignore
        assert(storage.triggers[triggerNodeIdStr][0] === trigger);

        assert(trigger.isCorked);
        assert(trigger.isPending === false);

        let i: number | undefined;

        i = await storage.runTrigger(trigger);
        assert(i === 2);
        assert(trigger.isPending);

        i = await storage.uncorkTrigger(trigger);

        //@ts-ignore
        assert(trigger.isCorked === false);
        assert(trigger.isPending === false);
        assert(trigger.isRunning === false);
        assert(i === 0);
        assert(response?.status === Status.RESULT);

        //@ts-ignore
        assert(storage.triggers[triggerNodeIdStr][0] === trigger);

        response = undefined;
        let promises = storage.emitInsertEvent([Buffer.alloc(32)], []);
        await Promise.all(promises);
        assert(response === undefined);

        promises = storage.emitInsertEvent([triggerNodeId], [msgId]);
        await Promise.all(promises);
        assert(response === undefined);

        promises = storage.emitInsertEvent([triggerNodeId], []);
        await Promise.all(promises);
        assert(response);
    });

    it("#addTrigger with interval", async function() {
        assert(storage);

        let clientPublicKey = Buffer.alloc(32).fill(0x01);
        let targetPublicKey = Buffer.alloc(32).fill(0x02);
        let msgId = Buffer.from([1,2,3,4,5]);

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId: Buffer.alloc(32),
            clientPublicKey,
            targetPublicKey,
            triggerInterval: 60,
            match: [
                {
                    nodeType: Data.GetType(),
                    filters: []
                }
            ]
        }});

        let response: any;
        const sendResponse: any = (obj: any) => {
            response = obj;
        };

        const trigger = storage.addTrigger(fetchRequest, msgId, sendResponse);

        assert(trigger);

        trigger.isCorked = false;

        //@ts-ignore
        clearTimeout(storage.triggerTimeout);
        //@ts-ignore
        storage.triggersTimeout();

        await sleep(1000);
        assert(!response);

        //@ts-ignore
        trigger.fetchRequest.query.triggerInterval = 1;

        //@ts-ignore
        clearTimeout(storage.triggerTimeout);
        //@ts-ignore
        storage.triggersTimeout();

        await sleep(1000);
        assert(response);
        assert(response.status === Status.ERROR);
    });

    it("#getTransformer", async function() {
        assert(storage);

        let clientPublicKey = Buffer.alloc(32).fill(0x01);
        let targetPublicKey = Buffer.alloc(32).fill(0x02);
        let msgId = Buffer.from([1,2,3,4,5]);

        let fetchRequest = StorageUtil.CreateFetchRequest({
            query: {
                parentId: Buffer.alloc(32),
                clientPublicKey,
                targetPublicKey,
                triggerInterval: 60,
                match: [
                    {
                        nodeType: Data.GetType(),
                        filters: []
                    }
                ]
            },
            transform: {
                algos: [1],
            },
        });

        let response: any;
        const sendResponse: any = (obj: any) => {
            response = obj;
        };

        let transformer = storage.getTransformer(fetchRequest, sendResponse);
        assert(transformer);
        assert(transformer.getAlgoFunctions().length === 1);
        assert(!response);

        let transformer2 = storage.getTransformer(fetchRequest, sendResponse);
        assert(transformer2);
        assert(transformer2.getAlgoFunctions().length === 1);
        assert(!response);

        assert(transformer !== transformer2);

        assert(!storage.getReadyTransformer(fetchRequest));

        let trigger = storage.addTrigger(fetchRequest, msgId, sendResponse, transformer);

        assert(!storage.getReadyTransformer(fetchRequest));

        trigger.hasFetched = true;

        assert(storage.getReadyTransformer(fetchRequest));

        assert(!response);
        let transformer3 = storage.getTransformer(fetchRequest, sendResponse);
        assert(response);
        assert(!transformer3);
    });

    // TODO: test handleFetchReplyDataFactory for trigger.closed
    //

    it("#chunkFetchResponse", async function() {
        assert(storage);

        let fetchReplyData: FetchReplyData = {
            status: Status.ERROR,
            isLast: true,
            extra: "hello",
            indexes: [1,2,3],
            error: "some error",
        };

        let fetchResponses = storage.chunkFetchResponse(fetchReplyData, 10);

        assert(fetchResponses.length === 1);
        assert(fetchResponses[0].seq === 0);
        assert(fetchResponses[0].status === Status.ERROR);
        assert(fetchResponses[0].error === "some error");
        assert(fetchResponses[0].transformResult.indexes.length === 0);
        assert(fetchResponses[0].transformResult.extra === "");

        fetchReplyData = {
            status: Status.RESULT,
            isLast: true,
            extra: "hello",
            indexes: [1,2,3],
            error: "bla",
        };

        fetchResponses = storage.chunkFetchResponse(fetchReplyData, 10);

        assert(fetchResponses.length === 1);
        assert(fetchResponses[0].seq === 10);
        assert(fetchResponses[0].endSeq === 10);
        assert(fetchResponses[0].status === Status.RESULT);
        assert(fetchResponses[0].error === "");
        assert(fetchResponses[0].transformResult.indexes.length === 3);
        assert(fetchResponses[0].transformResult.extra === "hello");

        let nodes: NodeInterface[] = [];
        let embed: NodeInterface[] = [];

        let parentId = Buffer.alloc(32).fill(0x00);
        let clientPublicKey = Buffer.alloc(32).fill(0x01);
        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let i = 256;
        let l = 0;
        while (l < MESSAGE_SPLIT_BYTES * 1.5) {
            const id1 = Buffer.alloc(32);
            id1.writeUInt32BE(i++, 0);
            const node = await nodeUtil.createDataNode({
                id1,
                owner: clientPublicKey,
                parentId,
                expireTime: now + 10000,
                creationTime: now,
            });

            nodes.push(node);
            l += node.export().length + 4;
        }

        l = 0;
        while (l < MESSAGE_SPLIT_BYTES * 1.5) {
            const id1 = Buffer.alloc(32);
            id1.writeUInt32BE(i++, 0);
            const node = await nodeUtil.createDataNode({
                id1,
                owner: clientPublicKey,
                parentId,
                expireTime: now + 10000,
                creationTime: now,
            });

            embed.push(node);
            l += node.export().length + 4;
        }

        fetchReplyData = {
            status: Status.RESULT,
            isLast: true,
            extra: "hello",
            indexes: [1,2,3],
            deletedNodesId1: [Buffer.alloc(32).fill(0x99)],
            nodes: nodes.slice(),
            embed: embed.slice(),
        };

        fetchResponses = storage.chunkFetchResponse(fetchReplyData, 10);

        assert(fetchResponses.length === 3);
        assert(fetchResponses[0].seq === 10);
        assert(fetchResponses[0].endSeq === 12);
        assert(fetchResponses[1].seq === 11);
        assert(fetchResponses[1].endSeq === 12);
        assert(fetchResponses[2].seq === 12);
        assert(fetchResponses[2].endSeq === 12);

        assert(fetchResponses[0].transformResult.extra === "hello");
        assert(fetchResponses[1].transformResult.extra === "");
        assert(fetchResponses[2].transformResult.extra === "");

        assert(fetchResponses[0].transformResult.indexes.length === 0);
        assert(fetchResponses[1].transformResult.indexes.length === 0);
        assert(fetchResponses[2].transformResult.indexes.length === 3);
        assert(fetchResponses[2].transformResult.deletedNodesId1.length === 1);

        assert(fetchResponses[0].result.nodes.length + fetchResponses[1].result.nodes.length === nodes.length);
        assert(fetchResponses[1].result.embed.length + fetchResponses[2].result.embed.length === embed.length);
    });
});


describe("Storage: SQLite WAL-mode", function() {
    let signatureOffloader: SignatureOffloader | undefined;
    let driver: Driver | undefined;
    let blobDriver: BlobDriver | undefined;
    let db: DBClient | undefined;
    let blobDb: DBClient | undefined;
    let storage: StorageWrapper | undefined;
    let p2pClient: P2PClient | undefined;
    let socket1: Client | undefined;
    let socket2: Client | undefined;
    let messaging1: Messaging | undefined;
    const config: any = {};

    beforeEach("Open database and create tables", async function() {
        signatureOffloader = new SignatureOffloader();
        signatureOffloader.init();

        db = new DBClient(await DatabaseUtil.OpenSQLite());
        driver = new Driver(db);

        for (let table in TABLES) {
            await db.run(`DROP TABLE IF EXISTS ${table};`);
            for (let idx in TABLES[table].indexes) {
                await db.run(`DROP INDEX IF EXISTS ${idx};`);
            }
        }

        await driver.createTables();

        blobDb = new DBClient(await DatabaseUtil.OpenSQLite());
        blobDriver = new BlobDriver(blobDb);

        for (let table in BLOB_TABLES) {
            await blobDb.run(`DROP TABLE IF EXISTS ${table};`);
            for (let idx in BLOB_TABLES[table].indexes) {
                await blobDb.run(`DROP INDEX IF EXISTS ${idx};`);
            }
        }

        await blobDriver.createTables();

        // Create virtual paired sockets.
        [socket1, socket2] = CreatePair();
        messaging1 = new Messaging(socket1, 0);

        const clientProps = makePeerProps(ConnectionType.STORAGE_CLIENT);

        const serverProps = makePeerProps(ConnectionType.STORAGE_SERVER);

        p2pClient = new P2PClient(messaging1, serverProps, clientProps);

        storage = new StorageWrapper(p2pClient, signatureOffloader, driver, blobDriver);

        storage.init();

        config.db = db;
        config.blobDb = blobDb;
        config.driver = driver;
        config.blobDriver = blobDriver;
        config.storage = storage;
        config.p2pClient = p2pClient;
    });

    afterEach("Close database", function() {
        driver?.close();
        db?.close();
        blobDriver?.close();
        blobDb?.close();
        socket1?.close();
        socket2?.close();
        signatureOffloader?.close();
    });

    setupTests(config);
});

describe("Storage: SQLiteJS WAL-mode", function() {
    let signatureOffloader: SignatureOffloader | undefined;
    let driver: Driver | undefined;
    let blobDriver: BlobDriver | undefined;
    let db: DBClient | undefined;
    let blobDb: DBClient | undefined;
    let storage: StorageWrapper | undefined;
    let p2pClient: P2PClient | undefined;
    let socket1: Client | undefined;
    let socket2: Client | undefined;
    let messaging1: Messaging | undefined;
    const config: any = {};

    beforeEach("Open database and create tables", async function() {
        signatureOffloader = new SignatureOffloader();
        signatureOffloader.init();

        db = new DBClient(await DatabaseUtil.OpenSQLiteJS());
        driver = new Driver(db);

        for (let table in TABLES) {
            await db.run(`DROP TABLE IF EXISTS ${table};`);
            for (let idx in TABLES[table].indexes) {
                await db.run(`DROP INDEX IF EXISTS ${idx};`);
            }
        }

        await driver.createTables();

        blobDb = new DBClient(await DatabaseUtil.OpenSQLite());
        blobDriver = new BlobDriver(blobDb);

        for (let table in BLOB_TABLES) {
            await blobDb.run(`DROP TABLE IF EXISTS ${table};`);
            for (let idx in BLOB_TABLES[table].indexes) {
                await blobDb.run(`DROP INDEX IF EXISTS ${idx};`);
            }
        }

        await blobDriver.createTables();

        // Create virtual paired sockets.
        [socket1, socket2] = CreatePair();
        messaging1 = new Messaging(socket1, 0);

        const clientProps = makePeerProps(ConnectionType.STORAGE_CLIENT);

        const serverProps = makePeerProps(ConnectionType.STORAGE_SERVER);

        p2pClient = new P2PClient(messaging1, serverProps, clientProps);

        storage = new StorageWrapper(p2pClient, signatureOffloader, driver, blobDriver);

        storage.init();

        config.db = db;
        config.blobDb = blobDb;
        config.driver = driver;
        config.blobDriver = blobDriver;
        config.storage = storage;
        config.p2pClient = p2pClient;
    });

    afterEach("Close database", function() {
        driver?.close();
        db?.close();
        socket1?.close();
        socket2?.close();
        signatureOffloader?.close();
    });

    setupTests(config);
});

describe("Storage: PostgreSQL REPEATABLE READ mode", function() {
    before(function() {
        if (process.env.PGHOST && process.env.PGPORT && process.env.PGUSER) {
            // Pass
        }
        else {
            this.skip();
            return;
        }
    });

    let signatureOffloader: SignatureOffloader | undefined;
    let driver: Driver | undefined;
    let blobDriver: BlobDriver | undefined;
    let db: DBClient | undefined;
    let blobDb: DBClient | undefined;
    let storage: StorageWrapper | undefined;
    let p2pClient: P2PClient | undefined;
    let socket1: Client | undefined;
    let socket2: Client | undefined;
    let messaging1: Messaging | undefined;
    const config: any = {};

    beforeEach("Open database and create tables", async function() {
        signatureOffloader = new SignatureOffloader();
        signatureOffloader.init();

        db = new DBClient(await DatabaseUtil.OpenPG());
        driver = new Driver(db);

        for (let table in TABLES) {
            await db.run(`DROP TABLE IF EXISTS ${table};`);
            for (let idx in TABLES[table].indexes) {
                await db.run(`DROP INDEX IF EXISTS ${idx};`);
            }
        }

        await driver.createTables();

        blobDb = new DBClient(await DatabaseUtil.OpenPG());
        blobDriver = new BlobDriver(blobDb);

        for (let table in BLOB_TABLES) {
            await blobDb.run(`DROP TABLE IF EXISTS ${table};`);
            for (let idx in BLOB_TABLES[table].indexes) {
                await blobDb.run(`DROP INDEX IF EXISTS ${idx};`);
            }
        }

        await blobDriver.createTables();

        // Create virtual paired sockets.
        [socket1, socket2] = CreatePair();
        messaging1 = new Messaging(socket1, 0);

        const clientProps = makePeerProps(ConnectionType.STORAGE_CLIENT);

        const serverProps = makePeerProps(ConnectionType.STORAGE_SERVER);

        p2pClient = new P2PClient(messaging1, serverProps, clientProps);

        storage = new StorageWrapper(p2pClient, signatureOffloader, driver, blobDriver);

        storage.init();

        config.db = db;
        config.blobDb = blobDb;
        config.driver = driver;
        config.blobDriver = blobDriver;
        config.storage = storage;
        config.p2pClient = p2pClient;
    });

    afterEach("Close database", function() {
        driver?.close();
        db?.close();
        blobDb?.close();
        socket1?.close();
        socket2?.close();
        signatureOffloader?.close();
    });

    setupTests(config);
});


function setupTests(config: any) {
    it("handleStore", async function() {
        const storage = config.storage as StorageWrapper;
        assert(storage);
        const p2pClient = config.p2pClient as P2PClient;
        assert(p2pClient);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let expectingReply = ExpectingReply.NONE;  // This is not used.
        let fromMsgId = Buffer.from([1,2,3,4,5]);

        let keyPair1 = Node.GenKeyPair();
        let keyPair2 = Node.GenKeyPair();
        let parentId = Buffer.alloc(32).fill(0x00);
        let clientPublicKey = keyPair1.publicKey;
        let targetPublicKey = keyPair1.publicKey;
        let sourcePublicKey = Buffer.alloc(32).fill(0x02);
        let preserveTransient = true;
        let muteMsgIds: Buffer[] = [];
        let nodes: Buffer[] = [];

        const node1 = await nodeUtil.createDataNode({
            parentId,
            expireTime: now + 10000,
            creationTime: now,
        }, keyPair1);

        assert(node1.getSignature());

        const node2 = await nodeUtil.createDataNode({
            parentId,
            expireTime: now + 10000,
            creationTime: now,
        }, keyPair2);

        const node2b = await nodeUtil.createDataNode({
            parentId,
            expireTime: now - 100,
            creationTime: now - 1000,
            isPublic: true,
        }, keyPair2);

        const node2c = await nodeUtil.createDataNode({
            parentId,
            expireTime: now + 10000,
            creationTime: now + 1,
            isPublic: true,
        }, keyPair2);

        nodes.push(node1.export(), node2.export(), node2b.export(), node2c.export());

        let storeRequest: StoreRequest = {
            clientPublicKey,
            sourcePublicKey,
            targetPublicKey,
            preserveTransient,
            nodes,
            muteMsgIds,
        };

        let response: any;
        const sendResponse: any = (obj: any) => {
            response = obj;
        };

        await storage.handleStoreWrapped(p2pClient, storeRequest, fromMsgId, expectingReply, sendResponse);

        assert(response);
        assert(response.status === Status.MALFORMED);
        assert(response.error === "StoreRequest not allowed to use preserveTransient for this connection.");

        response = undefined;;
        storeRequest.preserveTransient = false;

        await storage.handleStoreWrapped(p2pClient, storeRequest, fromMsgId, expectingReply, sendResponse);
        assert(response);
        assert(response.status === Status.RESULT);
        assert(response.storedId1.length === 2);
        assert(response.storedId1[0].equals(node1.getId1()));
        assert(response.storedId1[1].equals(node2c.getId1()));

        // see that what is stored is readable back
        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            clientPublicKey,
            targetPublicKey,
            match: [
                {
                    nodeType: Data.GetType(),
                    filters: []
                }
            ]
        }});

        const fetchedNodes: Buffer[] = [];
        const sendResponse2: any = (obj: any) => {
            fetchedNodes.push(...(obj.result?.nodes ?? []));
        };

        await storage.handleFetchWrapped(p2pClient, fetchRequest, fromMsgId, expectingReply, sendResponse2);
        assert(fetchedNodes.length === 2);
        assert(fetchedNodes[0].equals(node1.export()));
        assert(fetchedNodes[1].equals(node2c.export()));
    });

    it("handleFetch", async function() {
        const storage = config.storage as StorageWrapper;
        assert(storage);
        const p2pClient = config.p2pClient as P2PClient;
        assert(p2pClient);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let expectingReply = ExpectingReply.NONE;  // This is not used.
        let fromMsgId = Buffer.from([1,2,3,4,5]);

        let keyPair1 = Node.GenKeyPair();
        let keyPair2 = Node.GenKeyPair();

        let parentId = Buffer.alloc(32).fill(0x00);
        let triggerNodeId = Buffer.alloc(32).fill(0xa0);
        let clientPublicKey = keyPair1.publicKey;
        let targetPublicKey = keyPair1.publicKey;
        let sourcePublicKey = Buffer.alloc(32).fill(0x02);

        let preserveTransient = false;
        let muteMsgIds: Buffer[] = [];
        let nodes: Buffer[] = [];

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            clientPublicKey,
            targetPublicKey,
            triggerNodeId,
            match: [
                {
                    nodeType: Data.GetType(),
                    filters: []
                }
            ]
        }});

        let counter = 0;
        const fetchedNodes: Buffer[] = [];
        const sendResponse: any = (obj: any) => {
            fetchedNodes.push(...(obj.result?.nodes ?? []));
            counter++;
        };

        await storage.handleFetchWrapped(p2pClient, fetchRequest, fromMsgId, expectingReply, sendResponse);

        const triggerNodeIdStr = triggerNodeId.toString("hex");

        //@ts-ignore
        assert(storage.triggers[triggerNodeIdStr][0] !== undefined);


        const node2 = await nodeUtil.createDataNode({
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        }, keyPair2);

        nodes.push(node2.export());

        let storeRequest: StoreRequest = {
            clientPublicKey,
            sourcePublicKey,
            targetPublicKey,
            preserveTransient,
            nodes,
            muteMsgIds,
        };

        await storage.handleStoreWrapped(p2pClient, storeRequest, fromMsgId, expectingReply, sendResponse);

        await sleep(100);

        assert(fetchedNodes.length === 0);

        const node2b = await nodeUtil.createDataNode({
            parentId: triggerNodeId,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        }, keyPair2);

        nodes.length = 0;
        nodes.push(node2b.export());

        storeRequest = {
            clientPublicKey,
            sourcePublicKey,
            targetPublicKey,
            preserveTransient,
            nodes,
            muteMsgIds,
        };

        fetchedNodes.length = 0;

        await storage.handleStoreWrapped(p2pClient, storeRequest, fromMsgId, expectingReply, sendResponse);

        await sleep(100);

        assert(fetchedNodes.length === 1);
        assert(fetchedNodes[0].equals(node2.export()));



        const node3 = await nodeUtil.createDataNode({
            parentId: node2.getId(),
            expireTime: now + 10002,
            creationTime: now,
            isPublic: true,
        }, keyPair2);

        nodes.push(node3.export());

        storeRequest = {
            clientPublicKey,
            sourcePublicKey,
            targetPublicKey,
            preserveTransient,
            nodes,
            muteMsgIds,
        };

        fetchedNodes.length = 0;

        await storage.handleStoreWrapped(p2pClient, storeRequest, fromMsgId, expectingReply, sendResponse);

        await sleep(100);

        assert(fetchedNodes.length === 0);


        const node2c = await nodeUtil.createDataNode({
            parentId: triggerNodeId,
            expireTime: now + 10001,
            creationTime: now + 1,
            isPublic: true,
        }, keyPair2);

        nodes.length = 0;
        nodes.push(node2c.export());

        storeRequest = {
            clientPublicKey,
            sourcePublicKey,
            targetPublicKey,
            preserveTransient,
            nodes,
            muteMsgIds: [],
        };

        fetchedNodes.length = 0;

        await storage.handleStoreWrapped(p2pClient, storeRequest, fromMsgId, expectingReply, sendResponse);

        await sleep(100);

        assert(fetchedNodes.length === 1);

        assert(fetchedNodes[0].equals(node3.export()));


        nodes.length = 0;

        const node2d = await nodeUtil.createDataNode({
            parentId: triggerNodeId,
            expireTime: now + 10003,
            creationTime: now,
            isPublic: true,
        }, keyPair2);

        nodes.push(node2d.export());

        storeRequest = {
            clientPublicKey,
            sourcePublicKey,
            targetPublicKey,
            preserveTransient,
            nodes,
            muteMsgIds: [fromMsgId],
        };

        counter = 0;
        fetchedNodes.length = 0;

        await storage.handleStoreWrapped(p2pClient, storeRequest, fromMsgId, expectingReply, sendResponse);

        await sleep(100);

        assert(counter === 1);


        let unsubscribeRequest: UnsubscribeRequest = {
            originalMsgId: fromMsgId,
            clientPublicKey,
        };

        await storage.handleUnsubscribeWrapped(p2pClient, unsubscribeRequest, fromMsgId, expectingReply, sendResponse);


        nodes.length = 0;

        const node2e = await nodeUtil.createDataNode({
            parentId: triggerNodeId,
            expireTime: now + 10004,
            creationTime: now,
            isPublic: true,
        }, keyPair2);

        nodes.push(node2e.export());

        storeRequest = {
            clientPublicKey,
            sourcePublicKey,
            targetPublicKey,
            preserveTransient,
            nodes,
            muteMsgIds: [],
        };

        counter = 0;
        fetchedNodes.length = 0;

        await storage.handleStoreWrapped(p2pClient, storeRequest, fromMsgId, expectingReply, sendResponse);

        await sleep(100);

        assert(counter === 1);
    });

    it("#handleWriteBlob, #readBlobRequest", async function() {
        const storage = config.storage as StorageWrapper;
        assert(storage);
        const p2pClient = config.p2pClient as P2PClient;
        assert(p2pClient);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let expectingReply = ExpectingReply.NONE;  // This is not used.
        let fromMsgId = Buffer.from([1,2,3,4,5]);

        let keyPair1 = Node.GenKeyPair();
        let clientPublicKey = keyPair1.publicKey;
        let targetPublicKey = clientPublicKey;
        let sourcePublicKey = clientPublicKey;
        let parentId = Buffer.alloc(32).fill(0x00);
        let nodeId1 = Buffer.alloc(32).fill(0x01);

        let response: any;
        const sendResponse: any = (obj: any) => {
            response = obj;
        };

        let copyFromId1 = Buffer.alloc(0);
        let data = Buffer.from("Hello World");
        let pos = BigInt(Number.MAX_SAFE_INTEGER + 1);
        let blobLength = BigInt(data.length);
        let blobHash = Hash(data);

        let writeBlobRequest: WriteBlobRequest = {
            clientPublicKey,
            copyFromId1,
            nodeId1,
            data,
            pos,
        };

        await storage.handleWriteBlobWrapped(p2pClient, writeBlobRequest, fromMsgId,
            expectingReply, sendResponse);

        assert(response);
        assert(response.status === Status.ERROR);
        assert(response.error === "write blob failed: Error: position too large to handle");

        ///

        pos = 0n;

        writeBlobRequest = {
            clientPublicKey,
            copyFromId1,
            nodeId1,
            data,
            pos,
        };

        response = undefined;
        await storage.handleWriteBlobWrapped(p2pClient, writeBlobRequest, fromMsgId,
            expectingReply, sendResponse);

        assert(response);
        assert(response.status === Status.NOT_ALLOWED);
        assert(response.error === "write blob failed: Error: node not found or not allowed");


        const node1 = await nodeUtil.createDataNode({
            parentId,
            expireTime: now + 10004,
            creationTime: now,
            isPublic: true,
        }, keyPair1);

        const node2 = await nodeUtil.createDataNode({
            parentId,
            expireTime: now + 10004,
            creationTime: now,
            isPublic: true,
            blobHash,
            blobLength,
        }, keyPair1);

        let storeRequest = {
            clientPublicKey,
            sourcePublicKey,
            targetPublicKey,
            preserveTransient: false,
            nodes: [node1.export(), node2.export()],
            muteMsgIds: [],
        };

        await storage.handleStoreWrapped(p2pClient, storeRequest, fromMsgId, expectingReply, sendResponse);

        writeBlobRequest = {
            clientPublicKey,
            copyFromId1,
            nodeId1: node1.getId1() as Buffer,
            data,
            pos,
        };


        response = undefined;
        await storage.handleWriteBlobWrapped(p2pClient, writeBlobRequest, fromMsgId,
            expectingReply, sendResponse);

        assert(response);
        assert(response.status === Status.MALFORMED);
        assert(response.error === "write blob failed: Error: node not configured for blob");


        writeBlobRequest = {
            clientPublicKey,
            copyFromId1,
            nodeId1: node2.getId1() as Buffer,
            data: data.slice(0,6),
            pos,
        };

        response = undefined;
        await storage.handleWriteBlobWrapped(p2pClient, writeBlobRequest, fromMsgId,
            expectingReply, sendResponse);

        assert(response);
        assert(response.status === Status.RESULT);
        assert(response.error === "");
        assert(response.currentLength === 6n);


        let readBlobRequest: ReadBlobRequest = {
            clientPublicKey,
            targetPublicKey,
            nodeId1: node2.getId1() as Buffer,
            pos: 0n,
            length: 100,
        };

        response = undefined;
        await storage.handleReadBlobWrapped(p2pClient, readBlobRequest, fromMsgId,
            expectingReply, sendResponse);

        assert(response);
        assert(response.status === Status.ERROR);
        assert(response.error === "read blob failed: Error: node blob data does not exist in finalized state");


        writeBlobRequest = {
            clientPublicKey,
            copyFromId1,
            nodeId1: node2.getId1() as Buffer,
            data: data.slice(6),
            pos: 6n,
        };

        response = undefined;
        await storage.handleWriteBlobWrapped(p2pClient, writeBlobRequest, fromMsgId,
            expectingReply, sendResponse);

        assert(response);
        assert(response.status === Status.RESULT);
        assert(response.error === "");
        assert(response.currentLength === blobLength);

        response = undefined;
        await storage.handleWriteBlobWrapped(p2pClient, writeBlobRequest, fromMsgId,
            expectingReply, sendResponse);

        assert(response);
        assert(response.status === Status.EXISTS);
        assert(response.error === "");
        assert(response.currentLength === blobLength);
    });

    it("#handleWriteBlob, #readBlobRequest with permissions", async function() {
        const storage = config.storage as StorageWrapper;
        assert(storage);
        const p2pClient = config.p2pClient as P2PClient;
        assert(p2pClient);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let expectingReply = ExpectingReply.NONE;  // This is not used.
        let fromMsgId = Buffer.from([1,2,3,4,5]);

        let keyPair1 = Node.GenKeyPair();
        let keyPair2 = Node.GenKeyPair();
        let parentId = Buffer.alloc(32).fill(0x00);

        let response: any;
        const sendResponse: any = (obj: any) => {
            response = obj;
        };

        let copyFromId1 = Buffer.alloc(0);
        let data = Buffer.from("Hello World");
        let pos = 0n;
        let blobLength = BigInt(data.length);
        let blobHash = Hash(data);

        const node1 = await nodeUtil.createDataNode({
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            blobHash,
            blobLength,
        }, keyPair1);

        const license1 = await nodeUtil.createLicenseNode({
            parentId,
            refId: node1.getId1(),
            targetPublicKey: keyPair2.publicKey,
            expireTime: now + 10000,
            creationTime: now,
        }, keyPair1);


        const node2 = await nodeUtil.createDataNode({
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            blobHash,
            blobLength,
        }, keyPair2);

        const license2 = await nodeUtil.createLicenseNode({
            parentId,
            refId: node2.getId1(),
            targetPublicKey: keyPair1.publicKey,
            expireTime: now + 10000,
            creationTime: now,
        }, keyPair2);


        assert(license1.isLicenseTo(node1, keyPair1.publicKey, keyPair2.publicKey));


        let storeRequest = {
            clientPublicKey: keyPair1.publicKey,
            sourcePublicKey: keyPair1.publicKey,
            targetPublicKey: keyPair1.publicKey,
            preserveTransient: false,
            nodes: [node1.export(), node2.export()],
            muteMsgIds: [],
        };

        await storage.handleStoreWrapped(p2pClient, storeRequest, fromMsgId, expectingReply, sendResponse);


        let writeBlobRequest: WriteBlobRequest = {
            clientPublicKey: keyPair2.publicKey,
            copyFromId1,
            nodeId1: node1.getId1() as Buffer,
            data,
            pos,
        };

        await storage.handleWriteBlobWrapped(p2pClient, writeBlobRequest, fromMsgId,
            expectingReply, sendResponse);

        assert(response);
        assert(response.status === Status.NOT_ALLOWED);


        writeBlobRequest = {
            clientPublicKey: keyPair1.publicKey,
            copyFromId1,
            nodeId1: node1.getId1() as Buffer,
            data,
            pos,
        };

        await storage.handleWriteBlobWrapped(p2pClient, writeBlobRequest, fromMsgId,
            expectingReply, sendResponse);

        assert(response);
        assert(response.status === Status.RESULT);
        assert(response.error === "");



        writeBlobRequest = {
            clientPublicKey: keyPair1.publicKey,
            nodeId1: node2.getId1() as Buffer,
            copyFromId1: node1.getId1() as Buffer,
            data,
            pos,
        };

        await storage.handleWriteBlobWrapped(p2pClient, writeBlobRequest, fromMsgId,
            expectingReply, sendResponse);

        assert(response);
        assert(response.status === Status.NOT_ALLOWED);



        writeBlobRequest = {
            clientPublicKey: keyPair2.publicKey,
            nodeId1: node2.getId1() as Buffer,
            copyFromId1: node1.getId1() as Buffer,
            data,
            pos,
        };

        await storage.handleWriteBlobWrapped(p2pClient, writeBlobRequest, fromMsgId,
            expectingReply, sendResponse);

        assert(response);
        assert(response.status === Status.NOT_ALLOWED);


        // Store license 1
        //
        storeRequest = {
            clientPublicKey: keyPair1.publicKey,
            sourcePublicKey: keyPair1.publicKey,
            targetPublicKey: keyPair1.publicKey,
            preserveTransient: false,
            nodes: [license1.export()],
            muteMsgIds: [],
        };

        await storage.handleStoreWrapped(p2pClient, storeRequest, fromMsgId, expectingReply, sendResponse);


        // Now copy node thanks to license.
        //
        await storage.handleWriteBlobWrapped(p2pClient, writeBlobRequest, fromMsgId,
            expectingReply, sendResponse);

        assert(response);
        assert(response.status === Status.RESULT);

        // Read node2's blob failing due to lacking license.
        //
        let readBlobRequest: ReadBlobRequest = {
            clientPublicKey: keyPair1.publicKey,
            targetPublicKey: keyPair1.publicKey,
            nodeId1: node2.getId1() as Buffer,
            pos: 0n,
            length: 100,
        };

        response = undefined;
        await storage.handleReadBlobWrapped(p2pClient, readBlobRequest, fromMsgId,
            expectingReply, sendResponse);

        assert(response);
        assert(response.status === Status.NOT_ALLOWED);

        // Store license 2
        //
        storeRequest = {
            clientPublicKey: keyPair2.publicKey,
            sourcePublicKey: keyPair2.publicKey,
            targetPublicKey: keyPair2.publicKey,
            preserveTransient: false,
            nodes: [license2.export()],
            muteMsgIds: [],
        };

        await storage.handleStoreWrapped(p2pClient, storeRequest, fromMsgId, expectingReply, sendResponse);

        // Read and succeed thanks to license 2
        //
        response = undefined;
        await storage.handleReadBlobWrapped(p2pClient, readBlobRequest, fromMsgId,
            expectingReply, sendResponse);

        assert(response);
        assert(response.status === Status.RESULT);
    });

    // TODO
    // test with transformers
}

function makePeerProps(connectionType: number): PeerProps {
    return {
        connectionType,
        version: P2PClient.Version,
        serializeFormat: P2PClient.Formats[0],
        handshakedPublicKey: Buffer.alloc(0),
        authCert: undefined,
        authCertPublicKey: undefined,
        clock: Date.now(),
        region: undefined,
        jurisdiction: undefined,
        appVersion: undefined,
    };
}
