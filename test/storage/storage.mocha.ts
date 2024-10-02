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
    PeerData,
    PeerDataUtil,
    DatabaseUtil,
    DBClient,
    TABLES,
    BLOB_TABLES,
    Storage,
    P2PClient,
    SignatureOffloader,
    Driver,
    BlobDriver,
    SendResponseFn,
    FetchRequest,
    FetchResponse,
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
    Crypto,
    UnsubscribeRequest,
    UnsubscribeResponse,
    WriteBlobRequest,
    WriteBlobResponse,
    ReadBlobRequest,
    ReadBlobResponse,
    Hash,
    DeepCopy,
    ThreadTemplate,
    Thread,
    PERMISSIVE_PERMISSIONS,
    PromiseCallback,
    SPECIAL_NODES,
    CRDTMessagesAnnotations,
    Version,
} from "../../src";

export class StorageWrapper extends Storage {
    public addTrigger(fetchRequest: FetchRequest, msgId: Buffer, sendResponse?: SendResponseFn<FetchResponse>): Trigger {
        const trigger = super.addTrigger(fetchRequest, msgId);

        if (sendResponse) {
            const handleFetchReplyData =
                this.handleFetchReplyDataFactory(sendResponse, trigger,
                    fetchRequest.query.preserveTransient);

            trigger.handleFetchReplyData = handleFetchReplyData;
        }

        return trigger;
    }

    public async runTrigger(trigger: Trigger): Promise<number> {
        return super.runTrigger(trigger);
    }

    public async uncorkTrigger(trigger: Trigger): Promise<number | undefined> {
        return super.uncorkTrigger(trigger);
    }

    public triggerInsertEvent(triggerNodeIds: Buffer[], muteMsgIds: Buffer[]): Promise<number>[] {
        return super.triggerInsertEvent(triggerNodeIds, muteMsgIds);
    }

    public async handleStoreWrapped(storeRequest: StoreRequest, peer: P2PClient, fromMsgId: Buffer, expectingReply: ExpectingReply, sendResponse?: SendResponseFn<StoreResponse>) {
        return this.handleStore(storeRequest, peer, fromMsgId, expectingReply, sendResponse);
    }

    public async handleFetchWrapped(fetchRequest: FetchRequest, peer: P2PClient, fromMsgId: Buffer, expectingReply: ExpectingReply, sendResponse?: SendResponseFn<FetchResponse>) {
        return this.handleFetch(fetchRequest, peer, fromMsgId, expectingReply, sendResponse);
    }

    public handleUnsubscribeWrapped(unsubscribeRequest: UnsubscribeRequest, peer: P2PClient, fromMsgId: Buffer, expectingReply: ExpectingReply, sendResponse?: SendResponseFn<UnsubscribeResponse>) {
        return this.handleUnsubscribe(unsubscribeRequest, peer, fromMsgId, expectingReply, sendResponse);
    }

    public handleWriteBlobWrapped(writeBlobRequest: WriteBlobRequest, peer: P2PClient, fromMsgId: Buffer, expectingReply: ExpectingReply, sendResponse?: SendResponseFn<WriteBlobResponse>) {
        return this.handleWriteBlob(writeBlobRequest, peer, fromMsgId, expectingReply, sendResponse);
    }

    public handleReadBlobWrapped(readBlobRequest: ReadBlobRequest, peer: P2PClient, fromMsgId: Buffer, expectingReply: ExpectingReply, sendResponse?: SendResponseFn<ReadBlobResponse>) {
        return this.handleReadBlob(readBlobRequest, peer, fromMsgId, expectingReply, sendResponse);
    }

    public static ChunkFetchResponse(fetchReplyData: FetchReplyData, seq: number,
        preserveTransient: boolean): FetchResponse[]
    {
        return Storage.ChunkFetchResponse(fetchReplyData, seq, preserveTransient);
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
        await signatureOffloader.init();

        db = new DBClient(await DatabaseUtil.OpenSQLite());
        driver = new Driver(db);

        // Create virtual paired sockets.
        [socket1, socket2] = CreatePair();
        messaging1 = new Messaging(socket1, 0);

        const clientProps = makePeerData();

        const serverProps = makePeerData();

        p2pClient = new P2PClient(messaging1, serverProps, clientProps);

        storage = new StorageWrapper(p2pClient, signatureOffloader, driver);

        await storage.init();
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

    it("#addTrigger, #uncorkTrigger, #dropTrigger", async function() {
        assert(storage);

        let sourcePublicKey = Buffer.alloc(32).fill(0x01);
        let targetPublicKey = Buffer.alloc(32).fill(0x02);
        let triggerNodeId = Buffer.alloc(32).fill(0x10);
        let msgId = Buffer.from([1,2,3,4,5]);

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId: Buffer.alloc(32),
            sourcePublicKey,
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
        assert(response?.status === Status.DroppedTrigger);

        //@ts-ignore
        assert(storage.triggers[triggerNodeIdStr] === undefined);
    });

    it("#addTrigger, #uncorkTrigger, #triggerInsertEvent, #dropTrigger", async function() {
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

        let sourcePublicKey = Buffer.alloc(32).fill(0x01);
        let targetPublicKey = Buffer.alloc(32).fill(0x02);
        let triggerNodeId = Buffer.alloc(32).fill(0x10);
        let msgId = Buffer.from([1,2,3,4,5]);

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId: Buffer.alloc(32),
            sourcePublicKey,
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
        assert(response?.status === Status.Result);

        //@ts-ignore
        assert(storage.triggers[triggerNodeIdStr][0] === trigger);

        response = undefined;
        let promises = storage.triggerInsertEvent([Buffer.alloc(32)], []);
        await Promise.all(promises);
        assert(response === undefined);

        promises = storage.triggerInsertEvent([triggerNodeId], [msgId]);
        await Promise.all(promises);
        assert(response === undefined);

        promises = storage.triggerInsertEvent([triggerNodeId], []);
        await Promise.all(promises);
        assert(response);
    });

    it("#addTrigger with interval", async function() {
        assert(storage);

        let sourcePublicKey = Buffer.alloc(32).fill(0x01);
        let targetPublicKey = Buffer.alloc(32).fill(0x02);
        let msgId = Buffer.from([1,2,3,4,5]);

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId: Buffer.alloc(32),
            sourcePublicKey,
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

        trigger.lastIntervalRun = Date.now() - 2000;
        trigger.isCorked = false;

        //@ts-ignore we need to clear this for the process to be able to end.
        clearTimeout(storage.triggerTimeout);

        //@ts-ignore
        storage.triggersTimeout();

        await sleep(1000);
        assert(!response);

        //@ts-ignore
        trigger.fetchRequest.query.triggerInterval = 1;

        //@ts-ignore we need to clear this for the process to be able to end.
        clearTimeout(storage.triggerTimeout);

        //@ts-ignore
        storage.triggersTimeout();

        await sleep(1000);
        assert(response);
        assert(response.status === Status.DroppedTrigger);
    });

    // TODO: test handleFetchReplyDataFactory for trigger.closed
    //

    it("#chunkFetchResponse", async function() {
        assert(storage);

        let fetchReplyData: FetchReplyData = {
            status: Status.Error,
            isLast: true,
            delta: Buffer.alloc(1024),
            error: "some error",
        };

        let fetchResponses = StorageWrapper.ChunkFetchResponse(fetchReplyData, 10, false);

        assert(fetchResponses.length === 1);
        assert(fetchResponses[0].seq === 0);
        assert(fetchResponses[0].status === Status.Error);
        assert(fetchResponses[0].error === "some error");
        assert(fetchResponses[0].crdtResult.delta.length === 0);

        fetchReplyData = {
            status: Status.Result,
            isLast: true,
            delta: Buffer.alloc(1024),
            error: "bla",
        };

        fetchResponses = StorageWrapper.ChunkFetchResponse(fetchReplyData, 10, false);

        assert(fetchResponses.length === 1);
        assert(fetchResponses[0].seq === 10);
        assert(fetchResponses[0].endSeq === 10);
        assert(fetchResponses[0].status === Status.Result);
        assert(fetchResponses[0].error === "");
        assert(fetchResponses[0].crdtResult.delta.length === 1024);

        let nodes: NodeInterface[] = [];
        let embed: NodeInterface[] = [];

        let parentId = Buffer.alloc(32).fill(0x00);
        let sourcePublicKey = Buffer.alloc(32).fill(0x01);
        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let i = 256;
        let l = 0;
        while (l < MESSAGE_SPLIT_BYTES * 1.5) {
            const id1 = Buffer.alloc(32);
            id1.writeUInt32BE(i++, 0);
            const node = await nodeUtil.createDataNode({
                id1,
                owner: sourcePublicKey,
                parentId,
                expireTime: now + 10000,
                creationTime: now,
            });

            nodes.push(node);
            l += node.export().length + 4;
        }

        l = 0;
        while (l < MESSAGE_SPLIT_BYTES * 1.4) {
            const id1 = Buffer.alloc(32);
            id1.writeUInt32BE(i++, 0);
            const node = await nodeUtil.createDataNode({
                id1,
                owner: sourcePublicKey,
                parentId,
                expireTime: now + 10000,
                creationTime: now,
            });

            embed.push(node);
            l += node.export().length + 4;
        }

        fetchReplyData = {
            status: Status.Result,
            isLast: true,
            delta: Buffer.alloc(124),
            nodes: nodes.slice(),
            embed: embed.slice(),
        };

        fetchResponses = StorageWrapper.ChunkFetchResponse(fetchReplyData, 10, false);

        assert(fetchResponses.length === 3);
        assert(fetchResponses[0].seq === 10);
        assert(fetchResponses[0].endSeq === 12);
        assert(fetchResponses[1].seq === 11);
        assert(fetchResponses[1].endSeq === 12);
        assert(fetchResponses[2].seq === 12);
        assert(fetchResponses[2].endSeq === 12);

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
    let p2pStorageClient: P2PClient | undefined;
    let socket1: Client | undefined;
    let socket2: Client | undefined;
    let messaging1: Messaging | undefined;
    let messaging2: Messaging | undefined;
    const config: any = {};

    beforeEach("Open database and create tables", async function() {
        signatureOffloader = new SignatureOffloader();
        await signatureOffloader.init();

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
        messaging2 = new Messaging(socket2, 0);

        messaging1.open();
        messaging2.open();

        const clientProps = makePeerData();

        const serverProps = makePeerData();

        p2pClient = new P2PClient(messaging1, serverProps, clientProps, PERMISSIVE_PERMISSIONS);
        p2pStorageClient = new P2PClient(messaging2, serverProps, clientProps);

        storage = new StorageWrapper(p2pClient, signatureOffloader, driver, blobDriver);

        await storage.init();

        config.db = db;
        config.blobDb = blobDb;
        config.driver = driver;
        config.blobDriver = blobDriver;
        config.storage = storage;
        config.p2pClient = p2pClient;
        config.p2pStorageClient = p2pStorageClient;
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

describe.skip("Storage: SQLiteJS WAL-mode", function() {
    let signatureOffloader: SignatureOffloader | undefined;
    let driver: Driver | undefined;
    let blobDriver: BlobDriver | undefined;
    let db: DBClient | undefined;
    let blobDb: DBClient | undefined;
    let storage: StorageWrapper | undefined;
    let p2pClient: P2PClient | undefined;
    let p2pStorageClient: P2PClient | undefined;
    let socket1: Client | undefined;
    let socket2: Client | undefined;
    let messaging1: Messaging | undefined;
    let messaging2: Messaging | undefined;
    const config: any = {};

    beforeEach("Open database and create tables", async function() {
        signatureOffloader = new SignatureOffloader();
        await signatureOffloader.init();

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
        messaging2 = new Messaging(socket2, 0);

        messaging1.open();
        messaging2.open();

        const clientProps = makePeerData();

        const serverProps = makePeerData();

        p2pClient = new P2PClient(messaging1, serverProps, clientProps, PERMISSIVE_PERMISSIONS);
        p2pStorageClient = new P2PClient(messaging2, serverProps, clientProps);

        storage = new StorageWrapper(p2pClient, signatureOffloader, driver, blobDriver);

        await storage.init();

        config.db = db;
        config.blobDb = blobDb;
        config.driver = driver;
        config.blobDriver = blobDriver;
        config.storage = storage;
        config.p2pClient = p2pClient;
        config.p2pStorageClient = p2pStorageClient;
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
    let p2pStorageClient: P2PClient | undefined;
    let socket1: Client | undefined;
    let socket2: Client | undefined;
    let messaging1: Messaging | undefined;
    let messaging2: Messaging | undefined;
    const config: any = {};

    beforeEach("Open database and create tables", async function() {
        signatureOffloader = new SignatureOffloader();
        await signatureOffloader.init();

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
        messaging2 = new Messaging(socket2, 0);

        messaging1.open();
        messaging2.open();

        const clientProps = makePeerData();

        const serverProps = makePeerData();

        p2pClient = new P2PClient(messaging1, serverProps, clientProps, PERMISSIVE_PERMISSIONS);
        p2pStorageClient = new P2PClient(messaging2, serverProps, clientProps);

        storage = new StorageWrapper(p2pClient, signatureOffloader, driver, blobDriver);

        await storage.init();

        config.db = db;
        config.blobDb = blobDb;
        config.driver = driver;
        config.blobDriver = blobDriver;
        config.storage = storage;
        config.p2pClient = p2pClient;
        config.p2pStorageClient = p2pStorageClient;
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

        let keyPair1 = Crypto.GenKeyPair();
        let keyPair2 = Crypto.GenKeyPair();
        let parentId = Buffer.alloc(32).fill(0x00);
        let sourcePublicKey = keyPair1.publicKey;
        let targetPublicKey = keyPair1.publicKey;
        //let sourcePublicKey = Buffer.alloc(32).fill(0x02);
        let preserveTransient = true;
        let muteMsgIds: Buffer[] = [];
        let nodes: Buffer[] = [];

        const node1 = await nodeUtil.createDataNode({
            parentId,
            expireTime: now + 10000,
            creationTime: now,
        }, keyPair1.publicKey, keyPair1.secretKey);

        assert(node1.getSignature());

        const node2 = await nodeUtil.createDataNode({
            parentId,
            expireTime: now + 10000,
            creationTime: now,
        }, keyPair2.publicKey, keyPair2.secretKey);

        const node2b = await nodeUtil.createDataNode({
            parentId,
            expireTime: now - 100,
            creationTime: now - 1000,
            isPublic: true,
        }, keyPair2.publicKey, keyPair2.secretKey);

        const node2c = await nodeUtil.createDataNode({
            parentId,
            expireTime: now + 10000,
            creationTime: now + 1,
            isPublic: true,
        }, keyPair2.publicKey, keyPair2.secretKey);

        nodes.push(node1.export(), node2.export(), node2b.export(), node2c.export());

        let storeRequest: StoreRequest = {
            sourcePublicKey,
            targetPublicKey,
            preserveTransient,
            nodes,
            muteMsgIds,
            batchId: 0,
            hasMore: false,
        };

        let response: any;
        const sendResponse: any = (obj: any) => {
            response = obj;
        };

        await storage.handleStoreWrapped(storeRequest, p2pClient, fromMsgId, expectingReply, sendResponse);

        assert(response);
        assert(response.status === Status.Malformed);
        assert(response.error === "StoreRequest not allowed to use preserveTransient for this connection.");

        response = undefined;;
        storeRequest.preserveTransient = false;

        await storage.handleStoreWrapped(storeRequest, p2pClient, fromMsgId, expectingReply, sendResponse);
        assert(response);
        assert(response.status === Status.Result);
        assert(response.storedId1List.length === 2);
        assert(response.storedId1List[0].equals(node1.getId1()));
        assert(response.storedId1List[1].equals(node2c.getId1()));

        // see that what is stored is readable back
        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey,
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

        await storage.handleFetchWrapped(fetchRequest, p2pClient, fromMsgId, expectingReply, sendResponse2);
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

        let keyPair1 = Crypto.GenKeyPair();
        let keyPair2 = Crypto.GenKeyPair();

        let parentId = Buffer.alloc(32).fill(0x00);
        let triggerNodeId = Buffer.alloc(32).fill(0xa0);
        let sourcePublicKey = keyPair1.publicKey;
        let targetPublicKey = keyPair1.publicKey;
        //let sourcePublicKey = Buffer.alloc(32).fill(0x02);

        let preserveTransient = false;
        let muteMsgIds: Buffer[] = [];
        let nodes: Buffer[] = [];

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey,
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

        await storage.handleFetchWrapped(fetchRequest, p2pClient, fromMsgId, expectingReply, sendResponse);

        const triggerNodeIdStr = triggerNodeId.toString("hex");

        //@ts-ignore
        assert(storage.triggers[triggerNodeIdStr][0] !== undefined);


        const node2 = await nodeUtil.createDataNode({
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        }, keyPair2.publicKey, keyPair2.secretKey);

        nodes.push(node2.export());

        let storeRequest: StoreRequest = {
            sourcePublicKey,
            targetPublicKey,
            preserveTransient,
            nodes,
            muteMsgIds,
            batchId: 0,
            hasMore: false,
        };

        await storage.handleStoreWrapped(storeRequest, p2pClient, fromMsgId, expectingReply, sendResponse);

        await sleep(100);

        assert(fetchedNodes.length === 0);

        const node2b = await nodeUtil.createDataNode({
            parentId: triggerNodeId,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        }, keyPair2.publicKey, keyPair2.secretKey);

        nodes.length = 0;
        nodes.push(node2b.export());

        storeRequest = {
            sourcePublicKey,
            targetPublicKey,
            preserveTransient,
            nodes,
            muteMsgIds,
            batchId: 0,
            hasMore: false,
        };

        fetchedNodes.length = 0;

        await storage.handleStoreWrapped(storeRequest, p2pClient, fromMsgId, expectingReply, sendResponse);

        await sleep(100);

        assert(fetchedNodes.length === 1);
        assert(fetchedNodes[0].equals(node2.export()));



        const node3 = await nodeUtil.createDataNode({
            parentId: node2.getId(),
            expireTime: now + 10002,
            creationTime: now,
            isPublic: true,
        }, keyPair2.publicKey, keyPair2.secretKey);

        nodes.push(node3.export());

        storeRequest = {
            sourcePublicKey,
            targetPublicKey,
            preserveTransient,
            nodes,
            muteMsgIds,
            batchId: 0,
            hasMore: false,
        };

        fetchedNodes.length = 0;

        await storage.handleStoreWrapped(storeRequest, p2pClient, fromMsgId, expectingReply, sendResponse);

        await sleep(100);

        assert(fetchedNodes.length === 0);


        const node2c = await nodeUtil.createDataNode({
            parentId: triggerNodeId,
            expireTime: now + 10001,
            creationTime: now + 1,
            isPublic: true,
        }, keyPair2.publicKey, keyPair2.secretKey);

        nodes.length = 0;
        nodes.push(node2c.export());

        storeRequest = {
            sourcePublicKey,
            targetPublicKey,
            preserveTransient,
            nodes,
            muteMsgIds: [],
            batchId: 0,
            hasMore: false,
        };

        fetchedNodes.length = 0;

        await storage.handleStoreWrapped(storeRequest, p2pClient, fromMsgId, expectingReply, sendResponse);

        await sleep(100);

        assert(fetchedNodes.length === 1);

        assert(fetchedNodes[0].equals(node3.export()));


        nodes.length = 0;

        const node2d = await nodeUtil.createDataNode({
            parentId: triggerNodeId,
            expireTime: now + 10003,
            creationTime: now,
            isPublic: true,
        }, keyPair2.publicKey, keyPair2.secretKey);

        nodes.push(node2d.export());

        storeRequest = {
            sourcePublicKey,
            targetPublicKey,
            preserveTransient,
            nodes,
            muteMsgIds: [fromMsgId],
            batchId: 0,
            hasMore: false,
        };

        counter = 0;
        fetchedNodes.length = 0;

        await storage.handleStoreWrapped(storeRequest, p2pClient, fromMsgId, expectingReply, sendResponse);

        await sleep(100);

        assert(counter === 1);


        let unsubscribeRequest: UnsubscribeRequest = {
            originalMsgId: fromMsgId,
            targetPublicKey,
        };

        await storage.handleUnsubscribeWrapped(unsubscribeRequest, p2pClient, fromMsgId, expectingReply, sendResponse);


        nodes.length = 0;

        const node2e = await nodeUtil.createDataNode({
            parentId: triggerNodeId,
            expireTime: now + 10004,
            creationTime: now,
            isPublic: true,
        }, keyPair2.publicKey, keyPair2.secretKey);

        nodes.push(node2e.export());

        storeRequest = {
            sourcePublicKey,
            targetPublicKey,
            preserveTransient,
            nodes,
            muteMsgIds: [],
            batchId: 0,
            hasMore: false,
        };

        counter = 0;
        fetchedNodes.length = 0;

        await storage.handleStoreWrapped(storeRequest, p2pClient, fromMsgId, expectingReply, sendResponse);

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

        let keyPair1 = Crypto.GenKeyPair();
        let keyPair2 = Crypto.GenKeyPair();
        let sourcePublicKey = keyPair1.publicKey;
        let targetPublicKey = sourcePublicKey;
        let parentId = Buffer.alloc(32).fill(0x00);
        let nodeId1 = Buffer.alloc(32).fill(0x01);

        let response: any;
        const sendResponse: any = (obj: any) => {
            response = obj;
        };

        let data = Buffer.from("Hello World");
        let pos = BigInt(Number.MAX_SAFE_INTEGER + 1);
        let blobLength = BigInt(data.length);
        let blobHash = Hash(data);

        let writeBlobRequest: WriteBlobRequest = {
            targetPublicKey: sourcePublicKey,
            sourcePublicKey,
            nodeId1,
            data,
            pos,
            muteMsgIds: [],
        };

        await storage.handleWriteBlobWrapped(writeBlobRequest, p2pClient, fromMsgId,
            expectingReply, sendResponse);

        assert(response);
        assert(response.status === Status.Error);
        assert(response.error === "write blob failed: Error: position too large to handle");

        ///

        pos = 0n;

        writeBlobRequest = {
            targetPublicKey: sourcePublicKey,
            sourcePublicKey,
            nodeId1,
            data,
            pos,
            muteMsgIds: [],
        };

        response = undefined;
        await storage.handleWriteBlobWrapped(writeBlobRequest, p2pClient, fromMsgId,
            expectingReply, sendResponse);

        assert(response);
        assert(response.status === Status.NotAllowed);
        assert(response.error === "write blob failed: Error: node not found or not allowed writing blob data");


        const node1 = await nodeUtil.createDataNode({
            parentId,
            expireTime: now + 10004,
            creationTime: now,
            isPublic: true,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const node2 = await nodeUtil.createDataNode({
            parentId,
            expireTime: now + 10004,
            creationTime: now,
            isPublic: true,
            blobHash,
            blobLength,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const node3 = await nodeUtil.createDataNode({
            parentId,
            expireTime: now + 10005,
            creationTime: now,
            isPublic: true,
            blobHash,
            blobLength,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const node4 = await nodeUtil.createDataNode({
            parentId,
            expireTime: now + 10005,
            creationTime: now,
            isPublic: true,
            blobHash: Buffer.alloc(32),
            blobLength,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const node5 = await nodeUtil.createDataNode({
            parentId,
            expireTime: now + 10005,
            creationTime: now,
            isPublic: true,
            blobHash,
            blobLength,
        }, keyPair2.publicKey, keyPair2.secretKey);

        let storeRequest = {
            sourcePublicKey,
            targetPublicKey,
            preserveTransient: false,
            nodes: [node1.export(), node2.export(), node3.export(), node4.export(), node5.export()],
            muteMsgIds: [],
            batchId: 0,
            hasMore: false,
        };

        await storage.handleStoreWrapped(storeRequest, p2pClient, fromMsgId, expectingReply, sendResponse);

        // We need to decouple the flow to not get triggered by the store event since
        // the emitting is done in setImmediate.
        await sleep(1);

        const fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId: node2.getParentId(),
            sourcePublicKey,
            targetPublicKey,
            triggerNodeId: node2.getParentId(),
            onlyTrigger: true,
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

        await storage.handleFetchWrapped(fetchRequest, p2pClient, fromMsgId, expectingReply, sendResponse2);

        writeBlobRequest = {
            targetPublicKey: sourcePublicKey,
            sourcePublicKey,
            nodeId1: node1.getId1() as Buffer,
            data,
            pos,
            muteMsgIds: [],
        };


        response = undefined;
        await storage.handleWriteBlobWrapped(writeBlobRequest, p2pClient, fromMsgId,
            expectingReply, sendResponse);

        assert(response);
        assert(response.status === Status.Malformed);
        assert(response.error === "write blob failed: Error: node not configured for blob");


        writeBlobRequest = {
            targetPublicKey: sourcePublicKey,
            sourcePublicKey,
            nodeId1: node2.getId1() as Buffer,
            data: data.slice(0,6),
            pos,
            muteMsgIds: [],
        };

        response = undefined;
        await storage.handleWriteBlobWrapped(writeBlobRequest, p2pClient, fromMsgId,
            expectingReply, sendResponse);

        assert(response);
        assert(response.status === Status.Result);
        assert(response.error === "");
        assert(response.currentLength === 6n);


        let readBlobRequest: ReadBlobRequest = {
            sourcePublicKey: targetPublicKey,
            targetPublicKey,
            nodeId1: node2.getId1() as Buffer,
            pos: 0n,
            length: 100,
        };

        response = undefined;
        await storage.handleReadBlobWrapped(readBlobRequest, p2pClient, fromMsgId,
            expectingReply, sendResponse);

        assert(response);
        assert(response.status === Status.FetchFailed);


        writeBlobRequest = {
            targetPublicKey: sourcePublicKey,
            sourcePublicKey,
            nodeId1: node2.getId1() as Buffer,
            data: data.slice(6),
            pos: 6n,
            muteMsgIds: [],
        };

        assert(fetchedNodes.length === 0);

        response = undefined;
        await storage.handleWriteBlobWrapped(writeBlobRequest, p2pClient, fromMsgId,
            expectingReply, sendResponse);

        assert(response);
        assert(response.status === Status.Exists);
        assert(response.error === "");
        assert(response.currentLength === blobLength);

        // Sleep so the trigger events can run.
        await sleep(100);

        //@ts-ignore
        assert(fetchedNodes.length === 5);

        fetchedNodes.length = 0;

        response = undefined;
        await storage.handleWriteBlobWrapped(writeBlobRequest, p2pClient, fromMsgId,
            expectingReply, sendResponse);

        assert(response);
        assert(response.status === Status.Exists);
        assert(response.error === "");
        assert(response.currentLength === blobLength);

        // Sleep so the trigger events can run.
        await sleep(1);

        assert(fetchedNodes.length === 0);

        // Write empty data to reuse blob data.
        //

        // Blob should not be reused since hashes do not match
        //
        writeBlobRequest = {
            targetPublicKey: sourcePublicKey,
            sourcePublicKey,
            nodeId1: node4.getId1() as Buffer,
            data: Buffer.alloc(0),
            pos: 0n,
            muteMsgIds: [],
        };

        fetchedNodes.length = 0;

        response = undefined;
        await storage.handleWriteBlobWrapped(writeBlobRequest, p2pClient, fromMsgId,
            expectingReply, sendResponse);

        assert(response);
        assert(response.status === Status.Result);
        assert(response.error === "");
        assert(response.currentLength === 0n);

        // Sleep so the trigger events can run.
        await sleep(100);

        assert(fetchedNodes.length === 0);


        // Blob should not be reused since source user is different
        //
        writeBlobRequest = {
            targetPublicKey: keyPair2.publicKey,
            sourcePublicKey: keyPair2.publicKey,
            nodeId1: node5.getId1() as Buffer,
            data: Buffer.alloc(0),
            pos: 0n,
            muteMsgIds: [],
        };

        fetchedNodes.length = 0;

        response = undefined;
        await storage.handleWriteBlobWrapped(writeBlobRequest, p2pClient, fromMsgId,
            expectingReply, sendResponse);

        assert(response);
        assert(response.status === Status.Result);
        assert(response.error === "");
        assert(response.currentLength === 0n);

        // Sleep so the trigger events can run.
        await sleep(100);

        assert(fetchedNodes.length === 0);


        // Reuse existing blob data and see that it also triggers.
        //
        writeBlobRequest = {
            targetPublicKey: sourcePublicKey,
            sourcePublicKey,
            nodeId1: node3.getId1() as Buffer,
            data: Buffer.alloc(0),
            pos: 0n,
            muteMsgIds: [],
        };

        fetchedNodes.length = 0;

        response = undefined;
        await storage.handleWriteBlobWrapped(writeBlobRequest, p2pClient, fromMsgId,
            expectingReply, sendResponse);

        assert(response);
        assert(response.status === Status.Exists);
        assert(response.error === "");
        assert(response.currentLength === blobLength);

        // Sleep so the trigger events can run.
        await sleep(100);

        assert(fetchedNodes.length === 1);
        assert(fetchedNodes[0].equals(node3.export()));
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

        let keyPair1 = Crypto.GenKeyPair();
        let keyPair2 = Crypto.GenKeyPair();
        let parentId = Buffer.alloc(32).fill(0x00);

        let response: any;
        const sendResponse: any = (obj: any) => {
            response = obj;
        };

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
        }, keyPair1.publicKey, keyPair1.secretKey);

        const license1 = await nodeUtil.createLicenseNode({
            parentId,
            refId: node1.getId1(),
            targetPublicKey: keyPair2.publicKey,
            expireTime: now + 10000,
            creationTime: now,
        }, keyPair1.publicKey, keyPair1.secretKey);


        const node2 = await nodeUtil.createDataNode({
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            blobHash,
            blobLength,
        }, keyPair2.publicKey, keyPair2.secretKey);

        const license2 = await nodeUtil.createLicenseNode({
            parentId,
            refId: node2.getId1(),
            targetPublicKey: keyPair1.publicKey,
            expireTime: now + 10000,
            creationTime: now,
        }, keyPair2.publicKey, keyPair2.secretKey);


        assert(license1.isLicenseTo(node1));


        let storeRequest = {
            sourcePublicKey: keyPair1.publicKey,
            targetPublicKey: keyPair1.publicKey,
            preserveTransient: false,
            nodes: [node1.export(), node2.export()],
            muteMsgIds: [],
            batchId: 0,
            hasMore: false,
        };

        await storage.handleStoreWrapped(storeRequest, p2pClient, fromMsgId, expectingReply, sendResponse);


        let writeBlobRequest: WriteBlobRequest = {
            targetPublicKey: keyPair2.publicKey,
            sourcePublicKey: keyPair2.publicKey,
            nodeId1: node1.getId1() as Buffer,
            data,
            pos,
            muteMsgIds: [],
        };

        await storage.handleWriteBlobWrapped(writeBlobRequest, p2pClient, fromMsgId,
            expectingReply, sendResponse);

        assert(response);
        assert(response.status === Status.NotAllowed);


        writeBlobRequest = {
            targetPublicKey: keyPair1.publicKey,
            sourcePublicKey: keyPair1.publicKey,
            nodeId1: node1.getId1() as Buffer,
            data,
            pos,
            muteMsgIds: [],
        };

        await storage.handleWriteBlobWrapped(writeBlobRequest, p2pClient, fromMsgId,
            expectingReply, sendResponse);

        assert(response);
        assert(response.status === Status.Exists);
        assert(response.error === "");



        writeBlobRequest = {
            targetPublicKey: keyPair1.publicKey,
            sourcePublicKey: keyPair1.publicKey,
            nodeId1: node2.getId1() as Buffer,
            data,
            pos,
            muteMsgIds: [],
        };

        await storage.handleWriteBlobWrapped(writeBlobRequest, p2pClient, fromMsgId,
            expectingReply, sendResponse);

        assert(response);
        assert(response.status === Status.NotAllowed);



        writeBlobRequest = {
            targetPublicKey: keyPair2.publicKey,
            sourcePublicKey: keyPair2.publicKey,
            nodeId1: node2.getId1() as Buffer,
            data,
            pos,
            muteMsgIds: [],
        };

        await storage.handleWriteBlobWrapped(writeBlobRequest, p2pClient, fromMsgId,
            expectingReply, sendResponse);

        assert(response);
        assert(response.status === Status.Exists);


        // Store license 1
        //
        storeRequest = {
            sourcePublicKey: keyPair1.publicKey,
            targetPublicKey: keyPair1.publicKey,
            preserveTransient: false,
            nodes: [license1.export()],
            muteMsgIds: [],
            batchId: 0,
            hasMore: false,
        };

        await storage.handleStoreWrapped(storeRequest, p2pClient, fromMsgId, expectingReply, sendResponse);


        // Now copy node thanks to license.
        //
        await storage.handleWriteBlobWrapped(writeBlobRequest, p2pClient, fromMsgId,
            expectingReply, sendResponse);

        assert(response);
        assert(response.status === Status.Exists);

        // Read node2's blob failing due to lacking license.
        //
        let readBlobRequest: ReadBlobRequest = {
            sourcePublicKey: keyPair1.publicKey,
            targetPublicKey: keyPair1.publicKey,
            nodeId1: node2.getId1() as Buffer,
            pos: 0n,
            length: 100,
        };

        response = undefined;
        await storage.handleReadBlobWrapped(readBlobRequest, p2pClient, fromMsgId,
            expectingReply, sendResponse);

        assert(response);
        assert(response.status === Status.NotAllowed);

        // Store license 2
        //
        storeRequest = {
            sourcePublicKey: keyPair2.publicKey,
            targetPublicKey: keyPair2.publicKey,
            preserveTransient: false,
            nodes: [license2.export()],
            muteMsgIds: [],
            batchId: 0,
            hasMore: false,
        };

        await storage.handleStoreWrapped(storeRequest, p2pClient, fromMsgId, expectingReply, sendResponse);

        // Read and succeed thanks to license 2
        //
        response = undefined;
        await storage.handleReadBlobWrapped(readBlobRequest, p2pClient, fromMsgId,
            expectingReply, sendResponse);

        assert(response);
        assert(response.status === Status.Result);
    });

    it("fetch with CRDT", async function() {
        const storage = config.storage as StorageWrapper;
        assert(storage);
        const p2pClient = config.p2pClient as P2PClient;
        assert(p2pClient);

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        let expectingReply = ExpectingReply.NONE;  // This is not used.
        let fromMsgId = Buffer.from([1,2,3,4,5]);

        let keyPair1 = Crypto.GenKeyPair();
        let keyPair2 = Crypto.GenKeyPair();

        let parentId = Buffer.alloc(32).fill(0x00);
        let triggerNodeId = Buffer.alloc(32).fill(0xa0);
        let sourcePublicKey = keyPair1.publicKey;
        let targetPublicKey = keyPair1.publicKey;
        //let sourcePublicKey = Buffer.alloc(32).fill(0x02);

        let preserveTransient = false;
        let muteMsgIds: Buffer[] = [];
        let nodes: Buffer[] = [];

        let fetchRequest = StorageUtil.CreateFetchRequest({
            query: {
                parentId,
                sourcePublicKey,
                targetPublicKey,
                triggerNodeId,
                triggerInterval: 10,
                match: [
                    {
                        nodeType: Data.GetType(),
                        filters: []
                    }
                ]
            },
            crdt: {
                algo: 1,
                head: -1,
            }
        });

        let counter = 0;
        const fetchedNodes: Buffer[] = [];
        const sendResponse: any = (obj: any) => {
            fetchedNodes.push(...(obj.result?.nodes ?? []));
            counter++;
        };

        await storage.handleFetchWrapped(fetchRequest, p2pClient, fromMsgId, expectingReply, sendResponse);

        const triggerNodeIdStr = triggerNodeId.toString("hex");

        //@ts-ignore
        assert(storage.triggers[triggerNodeIdStr][0] !== undefined);


        const node2 = await nodeUtil.createDataNode({
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        }, keyPair2.publicKey, keyPair2.secretKey);

        nodes.push(node2.export());

        let storeRequest: StoreRequest = {
            sourcePublicKey,
            targetPublicKey,
            preserveTransient,
            nodes,
            muteMsgIds,
            batchId: 0,
            hasMore: false,
        };

        await storage.handleStoreWrapped(storeRequest, p2pClient, fromMsgId, expectingReply, sendResponse);

        await sleep(100);

        assert(fetchedNodes.length === 0);

        const node2b = await nodeUtil.createDataNode({
            parentId: triggerNodeId,
            expireTime: now + 10000,
            creationTime: now,
            isPublic: true,
        }, keyPair2.publicKey, keyPair2.secretKey);

        nodes.length = 0;
        nodes.push(node2b.export());

        storeRequest = {
            sourcePublicKey,
            targetPublicKey,
            preserveTransient,
            nodes,
            muteMsgIds,
            batchId: 0,
            hasMore: false,
        };

        fetchedNodes.length = 0;

        await storage.handleStoreWrapped(storeRequest, p2pClient, fromMsgId, expectingReply, sendResponse);

        await sleep(100);

        assert(fetchedNodes.length === 1);
        assert(fetchedNodes[0].equals(node2.export()));



        const node3 = await nodeUtil.createDataNode({
            parentId: node2.getId(),
            expireTime: now + 10002,
            creationTime: now,
            isPublic: true,
        }, keyPair2.publicKey, keyPair2.secretKey);

        nodes.push(node3.export());

        storeRequest = {
            sourcePublicKey,
            targetPublicKey,
            preserveTransient,
            nodes,
            muteMsgIds,
            batchId: 0,
            hasMore: false,
        };

        fetchedNodes.length = 0;

        await storage.handleStoreWrapped(storeRequest, p2pClient, fromMsgId, expectingReply, sendResponse);

        await sleep(100);

        assert(fetchedNodes.length === 0);


        const node2c = await nodeUtil.createDataNode({
            parentId: triggerNodeId,
            expireTime: now + 10001,
            creationTime: now + 1,
            isPublic: true,
        }, keyPair2.publicKey, keyPair2.secretKey);

        nodes.length = 0;
        nodes.push(node2c.export());

        storeRequest = {
            sourcePublicKey,
            targetPublicKey,
            preserveTransient,
            nodes,
            muteMsgIds: [],
            batchId: 0,
            hasMore: false,
        };

        fetchedNodes.length = 0;

        await storage.handleStoreWrapped(storeRequest, p2pClient, fromMsgId, expectingReply, sendResponse);

        await sleep(100);

        assert(fetchedNodes.length === 1);

        assert(fetchedNodes[0].equals(node3.export()));


        nodes.length = 0;

        const node2d = await nodeUtil.createDataNode({
            parentId: triggerNodeId,
            expireTime: now + 10003,
            creationTime: now,
            isPublic: true,
        }, keyPair2.publicKey, keyPair2.secretKey);

        nodes.push(node2d.export());

        storeRequest = {
            sourcePublicKey,
            targetPublicKey,
            preserveTransient,
            nodes,
            muteMsgIds: [fromMsgId],
            batchId: 0,
            hasMore: false,
        };

        counter = 0;
        fetchedNodes.length = 0;

        await storage.handleStoreWrapped(storeRequest, p2pClient, fromMsgId, expectingReply, sendResponse);

        await sleep(100);

        assert(counter === 1);


        let unsubscribeRequest: UnsubscribeRequest = {
            originalMsgId: fromMsgId,
            targetPublicKey,
        };

        await storage.handleUnsubscribeWrapped(unsubscribeRequest, p2pClient, fromMsgId, expectingReply, sendResponse);


        nodes.length = 0;

        const node2e = await nodeUtil.createDataNode({
            parentId: triggerNodeId,
            expireTime: now + 10004,
            creationTime: now,
            isPublic: true,
        }, keyPair2.publicKey, keyPair2.secretKey);

        nodes.push(node2e.export());

        storeRequest = {
            sourcePublicKey,
            targetPublicKey,
            preserveTransient,
            nodes,
            muteMsgIds: [],
            batchId: 0,
            hasMore: false,
        };

        counter = 0;
        fetchedNodes.length = 0;

        await storage.handleStoreWrapped(storeRequest, p2pClient, fromMsgId, expectingReply, sendResponse);

        await sleep(100);

        assert(counter === 1);
    });

    it("Thread with CRDT", async function() {
        const storage = config.storage as StorageWrapper;
        assert(storage);

        const storageClient = config.p2pStorageClient as P2PClient;
        assert(storageClient);

        const p2pClient = config.p2pClient as P2PClient;
        assert(p2pClient);

        const nodeUtil = new NodeUtil();

        let keyPair1 = Crypto.GenKeyPair();

        let publicKey = keyPair1.publicKey;
        let secretKey = keyPair1.secretKey;

        //@ts-ignore
        p2pClient.remotePeerData.setHandshakePublicKey(publicKey);

        //@ts-ignore
        p2pClient.localPeerData.setHandshakePublicKey(publicKey);

        let parentId = Buffer.alloc(32);

        let fetchRequest = StorageUtil.CreateFetchRequest({
            query: {
                parentId,
                sourcePublicKey: publicKey,
                targetPublicKey: publicKey,
                match: [
                    {
                        nodeType: Data.GetType(),
                        filters: []
                    }
                ]
            },
            crdt: {
                algo: 1,
                head: -1,
            }
        });

        const threadTemplate: ThreadTemplate = {
            query: fetchRequest.query,

            crdt: fetchRequest.crdt,

            post: {
                hello: {
                    parentId,
                    data: Buffer.from("Hello World"),
                    isLicensed: true,
                }
            },
            postLicense: {
                hello: {}
            }
        };

        const thread = new Thread(threadTemplate, {}, storageClient, nodeUtil,
            publicKey, publicKey, secretKey);

        const {promise, cb} = PromiseCallback<any>();

        thread.onChange( ({added}) => {
            cb(undefined, added);
        });

        let node = await thread.post("hello");

        const licenses = await thread.postLicense("hello", node, [publicKey]);
        assert(licenses.length === 1);

        const items = await promise;

        assert(items.length === 1);
    });

    it("Thread with CRDT and annotations", async function() {
        const storage = config.storage as StorageWrapper;
        assert(storage);

        const storageClient = config.p2pStorageClient as P2PClient;
        assert(storageClient);

        const p2pClient = config.p2pClient as P2PClient;
        assert(p2pClient);

        const nodeUtil = new NodeUtil();

        let keyPair1 = Crypto.GenKeyPair();

        let publicKey = keyPair1.publicKey;
        let secretKey = keyPair1.secretKey;

        //@ts-ignore
        p2pClient.remotePeerData.setHandshakePublicKey(publicKey);

        //@ts-ignore
        p2pClient.localPeerData.setHandshakePublicKey(publicKey);

        let parentId = Buffer.alloc(32);

        let fetchRequest = StorageUtil.CreateFetchRequest({
            query: {
                parentId,
                sourcePublicKey: publicKey,
                targetPublicKey: publicKey,
                match: [
                    {
                        nodeType: Data.GetType(),
                        filters: []
                    }
                ],
                preserveTransient: true,  // important since annotations are transient.
                depth: 2,  // Important we have depth 2 since annotation nodes are child nodes.
            },
            crdt: {
                algo: 1,
                head: -1,
                conf: {
                    annotations: {
                        format: "messages",
                    },
                },
            }
        });

        const threadTemplate: ThreadTemplate = {
            query: fetchRequest.query,

            crdt: fetchRequest.crdt,

            post: {
                hello: {
                    parentId,
                    bubbleTrigger: true,  // This is needed for children of the node to trigger
                    data: "${data:string:" + Buffer.from("Hello World").toString("hex") + "}",
                    isLicensed: true,
                }
            },
            postLicense: {
                hello: {}
            }
        };

        const thread = new Thread(threadTemplate, {}, storageClient, nodeUtil,
            publicKey, publicKey, secretKey);

        let node = await thread.post("hello");

        let licenses = await thread.postLicense("hello", node, [publicKey]);
        assert(licenses.length === 1);

        const {promise, cb} = PromiseCallback<any>();

        thread.onChange( ({added}) => {
            cb(undefined, added);
        });

        let items = await promise;

        assert(items.length === 1);

        let node2 = items[0].node;

        assert(node2.getAnnotations() === undefined);


        const nodeToEdit = node;


        const r = PromiseCallback<any>();
        const [promise2, cb2] = [r.promise, r.cb];

        thread.onChange( ({updated}) => {
            cb2(undefined, updated);
        });

        // Store annotation nodes
        //
        let node3 = await thread.postEdit("hello", nodeToEdit, {data: Buffer.from("Hello OpenOdin")});

        assert(node3.isAnnotationEdit());

        let node4 = await thread.postReaction("hello", nodeToEdit,
            {data: Buffer.from("react/thumbsup")});

        assert(node4.isAnnotationReaction());

        licenses = await thread.postLicense("hello", [node3, node4], [publicKey]);
        assert(licenses.length === 2);

        items = await promise2;

        assert(items.length === 1);

        node = items[0].node;

        const annot = node.getAnnotations();
        assert(annot !== undefined);

        let annotations = new CRDTMessagesAnnotations();
        annotations.load(annot);

        const updatedData = annotations.getEditNode()?.getData()?.toString();

        assert(updatedData === "Hello OpenOdin");

        const reactions = annotations.getReactions();

        assert(reactions.reactions.thumbsup?.count === 1);

        assert(reactions.reactions.thumbsup?.publicKeys.length === 1);

        assert(reactions.reactions.thumbsup?.publicKeys[0] === publicKey.toString("hex"));
    });
}

function makePeerData(): PeerData {
    return PeerDataUtil.create({
        version: Version,
        serializeFormat: 0,
        authCert: undefined,
        authCertPublicKey: undefined,
        clockDiff: 0,
        region: undefined,
        jurisdiction: undefined,
        appVersion: undefined,
    });
}
