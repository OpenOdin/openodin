/**
 * Test node online features in Storage.
 *
 */

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
    StorageWrapper,
} from "./storage.mocha";

import {
    SignatureOffloader,
    Driver,
    DBClient,
    P2PClient,
    DatabaseUtil,
    PeerData,
    PeerDataUtil,
    NodeUtil,
    Crypto,
    StoreRequest,
    Status,
    StorageUtil,
    Data,
    FetchRequest,
    NodeInterface,
    Decoder,
    sleep,
    Version,
} from "../../src";

type StorageInstance = {
    signatureOffloader?: SignatureOffloader,
    driver?: Driver,
    db?: DBClient,
    storage?: StorageWrapper,
    p2pClient?: P2PClient,
    socket1?: Client,
    socket2?: Client,
    messaging1?: Messaging,
};

describe("Storage: disallow storing persistent values", function() {
    let storageInstance: StorageInstance | undefined;

    before("Create Storage instance", async function() {
        storageInstance = await initStorageInstance();
    });

    after("Close Storage instance", function() {
        if (storageInstance) {
            closeStorageInstance(storageInstance);
        }
    });

    it("Should not be able to persist transient values if Storage disallows it", async function() {
        assert(storageInstance);

        const {
            storage,
            p2pClient,
        } = storageInstance;

        assert(storage);
        assert(p2pClient);

        const fromMsgId = Buffer.from([1,2,3,4,5]);
        const keyPair1 = Crypto.GenKeyPair();
        const parentId = Buffer.alloc(32).fill(0x00);
        const sourcePublicKey = keyPair1.publicKey;
        const targetPublicKey = keyPair1.publicKey;

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        const node1 = await nodeUtil.createDataNode({
            parentId,
            expireTime: now + 10000,
            creationTime: now,
        }, keyPair1.publicKey, keyPair1.secretKey);

        let storeRequest: StoreRequest = {
            sourcePublicKey,
            targetPublicKey,
            preserveTransient: true,
            nodes: [node1.export()],
            muteMsgIds: [],
            batchId: 0,
            hasMore: false,
        };

        let response: any;

        const sendResponse: any = (obj: any) => {
            response = obj;
        };

        await storage.handleStoreWrapped(storeRequest, p2pClient, fromMsgId, ExpectingReply.NONE,
            sendResponse);

        assert(response);
        assert(response.status === Status.MALFORMED);
        assert(response.error === "StoreRequest not allowed to use preserveTransient for this connection.");

        storeRequest.preserveTransient = false;

        await storage.handleStoreWrapped(storeRequest, p2pClient, fromMsgId, ExpectingReply.NONE,
            sendResponse);

        assert(response);
        assert(response.status === Status.RESULT);
        assert(response.storedId1s.length === 1);
    });
});

describe("Storage: update transient values on nodes", function() {
    let storageInstance: StorageInstance | undefined;

    before("Create Storage instance", async function() {
        storageInstance = await initStorageInstance(true);
    });

    after("Close Storage instance", function() {
        if (storageInstance) {
            closeStorageInstance(storageInstance);
        }
    });

    it("Should be able to persist transient values and have online nodes behave as expected", async function() {
        assert(storageInstance);

        const {
            storage,
            p2pClient,
            driver,
        } = storageInstance;

        assert(storage);
        assert(p2pClient);
        assert(driver);

        const fromMsgId = Buffer.from([1,2,3,4,5]);
        const keyPair1 = Crypto.GenKeyPair();
        const parentId = Buffer.alloc(32).fill(0x00);
        const sourcePublicKey = keyPair1.publicKey;
        const targetPublicKey = keyPair1.publicKey;
        const id2 = Buffer.alloc(32).fill(0x10);
        const onlineIdNetwork = Buffer.from("some network");

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        const node1A = await nodeUtil.createDataNode({
            id2,
            isOnlineIdValidated: true,
            onlineIdNetwork,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const node1B = await nodeUtil.createDataNode({
            id2,
            isOnlineIdValidated: false,
            onlineIdNetwork,
            parentId,
            expireTime: now + 10000,
            creationTime: now + 1,
        }, keyPair1.publicKey, keyPair1.secretKey);

        assert(!node1A.getId1()!.equals(node1B.getId1()!));
        assert(node1A.getId2()!.equals(node1B.getId2()!));

        const node2 = await nodeUtil.createDataNode({
            parentId: node1A.getId(),
            expireTime: now + 10000,
            creationTime: now,
        }, keyPair1.publicKey, keyPair1.secretKey);

        assert(node1A.isOnlineIdValidated());
        assert(node2.getParentId()?.equals(node1A.getId2()!));

        let storeRequest: StoreRequest = {
            sourcePublicKey,
            targetPublicKey,
            preserveTransient: false,
            nodes: [node1A.export(true), node1B.export(), node2.export()],
            muteMsgIds: [],
            batchId: 0,
            hasMore: false,
        };

        let response: any;

        const sendResponse: any = (obj: any) => {
            response = obj;
        };

        await storage.handleStoreWrapped(storeRequest, p2pClient, fromMsgId, ExpectingReply.NONE,
            sendResponse);

        assert(response);
        assert(response.status === Status.RESULT);
        assert(response.storedId1s.length === 3);

        const node1Ab = await driver.getNodeById1(node1A.getId1()!, now);
        assert(node1Ab);
        assert(node1Ab.hasOnlineId());
        assert(!node1Ab.isOnlineIdValidated());

        const node1Bb = await driver.getNodeById1(node1B.getId1()!, now);
        assert(node1Bb);
        assert(node1Bb.hasOnlineId());
        assert(!node1Bb.isOnlineIdValidated());

        const node2b = await driver.getNodeById1(node2.getId1()!, now);

        assert(node2b);

        assert(!node2b.hasOnlineId());


        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey,
            targetPublicKey,
            ignoreInactive: false,
            match: [
                {
                    nodeType: Data.GetType(),
                    filters: []
                }
            ]
        }});

        let nodes = await runFetch(fetchRequest, storageInstance);

        assert(nodes.length === 2);
        assert(nodes[0].getId1()!.equals(node1A.getId1()!));
        assert(nodes[1].getId1()!.equals(node1B.getId1()!));

        fetchRequest.query.ignoreInactive = true;

        nodes = await runFetch(fetchRequest, storageInstance);
        assert(nodes.length === 0);


        // Update node1 with its transient value so it becomes active.

        storeRequest.preserveTransient = true;

        await storage.handleStoreWrapped(storeRequest, p2pClient, fromMsgId, ExpectingReply.NONE,
            sendResponse);

        assert(response);
        assert(response.status === Status.RESULT);
        assert(response.storedId1s.length === 2);

        const node1Ac = await driver.getNodeById1(node1A.getId1()!, now);

        assert(node1Ac);

        assert(node1Ac.hasOnlineId());
        assert(node1Ac.isOnlineIdValidated());

        nodes = await runFetch(fetchRequest, storageInstance);

        assert(nodes.length === 2);
        assert(nodes[0].getId1()!.equals(node1A.getId1()!));
        assert(nodes[1].getId1()!.equals(node2.getId1()!));

        // Now swap the the id2 active nodes
        //

        node1B.setOnlineIdValidated(true);

        storeRequest.nodes = [node1B.export(true)];

        await storage.handleStoreWrapped(storeRequest, p2pClient, fromMsgId, ExpectingReply.NONE,
            sendResponse);

        assert(response);
        assert(response.status === Status.RESULT);
        assert(response.storedId1s.length === 1);

        nodes = await runFetch(fetchRequest, storageInstance);

        assert(nodes.length === 2);
        assert(nodes[0].getId1()!.equals(node1B.getId1()!));
        assert(nodes[1].getId1()!.equals(node2.getId1()!));
    });
});

describe("Concensus: test streaming updates", async function() {
    let storageInstance: StorageInstance | undefined;

    before("Create Storage instance", async function() {
        storageInstance = await initStorageInstance(true);
    });

    after("Close Storage instance", function() {
        if (storageInstance) {
            closeStorageInstance(storageInstance);
        }
    });

    it("Should stream transient updated nodes", async function() {
        assert(storageInstance);

        const {
            storage,
            p2pClient,
            driver,
        } = storageInstance;

        assert(storage);
        assert(p2pClient);
        assert(driver);

        const fromMsgId = Buffer.from([1,2,3,4,5]);
        const keyPair1 = Crypto.GenKeyPair();
        const parentId = Buffer.alloc(32).fill(0x00);
        const sourcePublicKey = keyPair1.publicKey;
        const targetPublicKey = keyPair1.publicKey;
        const id2 = Buffer.alloc(32).fill(0x10);
        const id2B = Buffer.alloc(32).fill(0x11);
        const onlineIdNetwork = Buffer.from("some network");

        const nodeUtil = new NodeUtil();
        const now = Date.now();

        const node1A = await nodeUtil.createDataNode({
            id2,
            isOnlineIdValidated: false,
            onlineIdNetwork,
            parentId,
            expireTime: now + 10000,
            creationTime: now,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const node1B = await nodeUtil.createDataNode({
            id2,
            isOnlineIdValidated: false,
            onlineIdNetwork,
            parentId,
            expireTime: now + 10000,
            creationTime: now + 1,
        }, keyPair1.publicKey, keyPair1.secretKey);

        const node1C = await nodeUtil.createDataNode({
            id2: id2B,
            isOnlineIdValidated: false,
            onlineIdNetwork,
            parentId,
            expireTime: now + 10000,
            creationTime: now + 2,
        }, keyPair1.publicKey, keyPair1.secretKey);

        assert(!node1A.getId1()!.equals(node1B.getId1()!));
        assert(node1A.getId2()!.equals(node1B.getId2()!));

        assert(!node1A.getId1()!.equals(node1C.getId1()!));
        assert(!node1A.getId2()!.equals(node1C.getId2()!));

        const node2A = await nodeUtil.createDataNode({
            parentId: node1A.getId(),
            expireTime: now + 10000,
            creationTime: now,
        }, keyPair1.publicKey, keyPair1.secretKey);

        assert(node2A.getParentId()?.equals(node1A.getId2()!));

        const node2C = await nodeUtil.createDataNode({
            parentId: node1C.getId(),
            expireTime: now + 10000,
            creationTime: now,
        }, keyPair1.publicKey, keyPair1.secretKey);

        assert(node2C.getParentId()?.equals(node1C.getId2()!));

        let storeRequest: StoreRequest = {
            sourcePublicKey,
            targetPublicKey,
            preserveTransient: true,
            nodes: [node1A.export(true), node1B.export(true), node1C.export(true),
                node2A.export(true), node2C.export(true)],
            muteMsgIds: [],
            batchId: 0,
            hasMore: false,
        };

        let response: any;

        const sendResponse: any = (obj: any) => {
            response = obj;
        };

        await storage.handleStoreWrapped(storeRequest, p2pClient, fromMsgId, ExpectingReply.NONE,
            sendResponse);

        assert(response);
        assert(response.status === Status.RESULT);
        assert(response.storedId1s.length === 5);

        let fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            sourcePublicKey,
            targetPublicKey,
            triggerNodeId: parentId,
            preserveTransient: true,
            match: [
                {
                    nodeType: Data.GetType(),
                    filters: []
                }
            ]
        }});

        const fetchedNodes: NodeInterface[] = [];

        const sendResponse2: any = (obj: any) => {
            fetchedNodes.push(...(obj.result?.nodes ?? []).
                map( (image: Buffer) => Decoder.DecodeNode(image, true) ));
        };

        await storage.handleFetchWrapped(fetchRequest, p2pClient, fromMsgId, ExpectingReply.NONE,
            sendResponse2);

        assert(fetchedNodes.length === 3);
        assert(fetchedNodes[0].getId1()!.equals(node1A.getId1()!));
        assert(fetchedNodes[1].getId1()!.equals(node1B.getId1()!));
        assert(fetchedNodes[2].getId1()!.equals(node1C.getId1()!));

        // Update and expect streaming
        fetchedNodes.length = 0;

        node1A.setOnlineIdValidated(true);

        assert(node1A.isOnlineIdValidated());

        storeRequest.nodes = [node1A.export(true)];

        await storage.handleStoreWrapped(storeRequest, p2pClient, fromMsgId, ExpectingReply.NONE,
            sendResponse);

        assert(response);
        assert(response.status === Status.RESULT);
        assert(response.storedId1s.length === 1);

        await sleep(100);

        let node1Aa = await driver.getNodeById1(node1A.getId1()!, now);

        assert(node1Aa);

        assert(node1Aa.hasOnlineId());
        assert(node1Aa.isOnlineIdValidated());

        assert(fetchedNodes.length === 2);
        assert(fetchedNodes[0].isOnlineIdValidated());
        assert(fetchedNodes[0].getId1()!.equals(node1A.getId1()!));
        assert(fetchedNodes[1].getId1()!.equals(node2A.getId1()!));



        fetchedNodes.length = 0;

        node1B.setOnlineIdValidated(true);

        assert(node1B.isOnlineIdValidated());

        storeRequest.nodes = [node1B.export(true)];

        await storage.handleStoreWrapped(storeRequest, p2pClient, fromMsgId, ExpectingReply.NONE,
            sendResponse);

        assert(response);
        assert(response.status === Status.RESULT);
        assert(response.storedId1s.length === 1);

        await sleep(100);

        let node1Ba = await driver.getNodeById1(node1B.getId1()!, now);

        assert(node1Ba);

        assert(node1Ba.hasOnlineId());
        assert(node1Ba.isOnlineIdValidated());

        node1Aa = await driver.getNodeById1(node1A.getId1()!, now);

        assert(node1Aa);

        assert(node1Aa.hasOnlineId());
        assert(!node1Aa.isOnlineIdValidated());

        assert(fetchedNodes.length === 2);
        assert(fetchedNodes[0].isOnlineIdValidated());
        assert(fetchedNodes[0].getId1()!.equals(node1B.getId1()!));
        assert(fetchedNodes[1].getId1()!.equals(node2A.getId1()!));
    });
});

async function initStorageInstance(allowPreserveTransient: boolean = false): Promise<StorageInstance> {
    const signatureOffloader = new SignatureOffloader();
    await signatureOffloader.init();

    const db = new DBClient(await DatabaseUtil.OpenSQLite());
    const driver = new Driver(db);

    await driver.createTables();

    // Create virtual paired sockets.
    const [socket1, socket2] = CreatePair();
    const messaging1 = new Messaging(socket1, 0);

    const clientProps = makePeerData();

    const serverProps = makePeerData();

    const p2pClient = new P2PClient(messaging1, serverProps, clientProps);

    const storage = new StorageWrapper(p2pClient, signatureOffloader, driver, undefined,
        allowPreserveTransient);

    await storage.init();

    return {
        signatureOffloader,
        driver,
        db,
        storage,
        p2pClient,
        socket1,
        socket2,
        messaging1,
    };
}

function closeStorageInstance(s: StorageInstance) {
    s.signatureOffloader?.close();
    s.driver?.close();
    s.db?.close();
    s.storage?.close();
    s.p2pClient?.close();
    s.socket1?.close();
    s.socket2?.close();
    s.messaging1?.close();
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

async function runFetch(fetchRequest: FetchRequest, storageInstance: StorageInstance):
    Promise<NodeInterface[]>
{
    const {
        storage,
        p2pClient,
        driver,
    } = storageInstance;

    assert(storage);
    assert(p2pClient);
    assert(driver);

    const fromMsgId = Buffer.from([1,2,3,4,5]);

    const fetchedNodes: NodeInterface[] = [];

    const sendResponse: any = (obj: any) => {
        fetchedNodes.push(...(obj.result?.nodes ?? []).
            map( (image: Buffer) => Decoder.DecodeNode(image, true) ));
    };

    await storage.handleFetchWrapped(fetchRequest, p2pClient, fromMsgId, ExpectingReply.NONE,
        sendResponse);

    return fetchedNodes;
}
