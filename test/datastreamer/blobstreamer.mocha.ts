/**
 * Test the blob streamers in detail.
 */

import { assert } from "chai";
import fs from "fs";
import path from "path";

import {
    Client,
    CreatePair,
} from "pocket-sockets";

import {
    Messaging,
} from "pocket-messaging";

import {
    FileStreamReader,
    FileStreamWriter,
    WriteStats,
    BlobStreamReader,
    BlobStreamWriter,
    Storage,
    P2PClient,
    PERMISSIVE_PERMISSIONS,
    Driver,
    BlobDriver,
    DBClient,
    SignatureOffloader,
    ConnectionType,
    PeerProps,
    DatabaseUtil,
    Hash,
    Node,
    NodeUtil,
    StoreRequest,
    sleep,
    TABLES,
    BLOB_TABLES,
    Status,
} from "../../src";


const content = Buffer.from(`Hello World!

It is a nice day.
`, "utf-8");

describe("BlobStreamWriter, BlobStreamReader", function() {
    const filepath1 = "/tmp/stream-blob-test-3";
    const filepath2 = "/tmp/stream-blob-test-4";
    let signatureOffloader: SignatureOffloader | undefined;
    let driver: Driver | undefined;
    let blobDriver: BlobDriver | undefined;
    let db: DBClient | undefined;
    let blobDb: DBClient | undefined;
    let storage: Storage | undefined;
    let serverP2pClient: P2PClient | undefined;
    let clientP2pClient: P2PClient | undefined;
    let socket1: Client | undefined;
    let socket2: Client | undefined;
    let messaging1: Messaging | undefined;
    let messaging2: Messaging | undefined;

    const keyPair1 = Node.GenKeyPair();
    const keyPairServer = Node.GenKeyPair();
    const parentId = Buffer.alloc(32).fill(0x00);

    const nodeUtil = new NodeUtil();
    const now = Date.now();

    const blobLength = BigInt(content.length);
    const blobHash = Hash(content);

    beforeEach("Create Storage instance", async function() {
        try {
            fs.rmSync(filepath1);
            fs.rmSync(filepath2);
        }
        catch(e) {}

        fs.writeFileSync(filepath1, content);

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
        messaging2 = new Messaging(socket2, 0);

        const clientProps = makePeerProps(ConnectionType.STORAGE_CLIENT, keyPair1.publicKey);

        const serverProps = makePeerProps(ConnectionType.STORAGE_SERVER, keyPairServer.publicKey);

        serverP2pClient = new P2PClient(messaging1, serverProps, clientProps, PERMISSIVE_PERMISSIONS);

        storage = new Storage(serverP2pClient, signatureOffloader, driver, blobDriver);

        storage.init();

        clientP2pClient = new P2PClient(messaging2, clientProps, serverProps);

        messaging1.open();
        messaging2.open();
    });

    afterEach("Close Storage instance", function() {
        signatureOffloader?.close();
        driver?.close();
        db?.close();
        blobDb?.close();
        storage?.close();
        serverP2pClient?.close();
        clientP2pClient?.close();
        socket1?.close();
        socket2?.close();
        messaging1?.close();
        messaging2?.close();

        try {
            fs.rmSync(filepath1);
            fs.rmSync(filepath2);
        }
        catch(e) {}
    });

    it("BlobStreamReader, BlobStreamWriter should work with FileStreamers", async function() {
        assert(clientP2pClient);

        const nodeId1 = Buffer.alloc(32).fill(0x01);

        let fileReadStreamer = new FileStreamReader(filepath1);
        let blobWriteStreamer = new BlobStreamWriter(nodeId1, fileReadStreamer, clientP2pClient);

        let error: any;

        try {
            await blobWriteStreamer.run();
        }
        catch(e) {
            error = e;
        }

        assert(error);
        assert(error.message === "Error: Storage peer returned error in response: write blob failed: Error: node not found or not allowed");

        fileReadStreamer.close();

        // Store node
        //
        const node1 = await nodeUtil.createDataNode({
            parentId,
            expireTime: now + 10000,
            creationTime: now,
            isLicensed: true,
            blobHash,
            blobLength,
        }, keyPair1.publicKey, keyPair1.secretKey);

        let storeRequest: StoreRequest = {
            clientPublicKey: keyPair1.publicKey,
            sourcePublicKey: keyPair1.publicKey,
            targetPublicKey: keyPair1.publicKey,
            preserveTransient: false,
            nodes: [node1.export()],
            muteMsgIds: [],
        };

        let {getResponse} = clientP2pClient.store(storeRequest);

        assert(getResponse);

        let reply = await getResponse.onceAny();
        assert(reply.type === "reply");
        assert(reply.response?.status === Status.RESULT);

        // Try writing blob again
        //
        error = undefined;
        fileReadStreamer = new FileStreamReader(filepath1);
        blobWriteStreamer = new BlobStreamWriter(node1.getId1() as Buffer, fileReadStreamer, clientP2pClient);

        try {
            await blobWriteStreamer.run();
        }
        catch(e) {
            error = e;
        }

        assert(!error);

        fileReadStreamer.close();

        // Now, try downloading blob into a file, but lacking permissions.
        //
        let readBlobStreamer = new BlobStreamReader(node1.getId1() as Buffer, [clientP2pClient]);
        let writeFileStreamer = new FileStreamWriter(filepath2, readBlobStreamer);

        error = undefined;
        try {
            await writeFileStreamer.run();
        }
        catch(e) {
            error = e;
        }

        writeFileStreamer.close();

        assert(error);
        assert(error.message === "Error: read blob failed: Error: node not found or not allowed");


        // Store license
        //
        const license1 = await nodeUtil.createLicenseNode({
            parentId,
            refId: node1.getId1(),
            targetPublicKey: keyPair1.publicKey,
            expireTime: now + 10000,
            creationTime: now,
        }, keyPair1.publicKey, keyPair1.secretKey);

        storeRequest = {
            clientPublicKey: keyPair1.publicKey,
            sourcePublicKey: keyPair1.publicKey,
            targetPublicKey: keyPair1.publicKey,
            preserveTransient: false,
            nodes: [license1.export()],
            muteMsgIds: [],
        };

        getResponse = clientP2pClient.store(storeRequest).getResponse;

        assert(getResponse);

        reply = await getResponse.onceAny();
        assert(reply.type === "reply");
        assert(reply.response?.status === Status.RESULT);



        // Now, download blob into a file with success.
        //
        readBlobStreamer = new BlobStreamReader(node1.getId1() as Buffer, [clientP2pClient]);
        writeFileStreamer = new FileStreamWriter(filepath2, readBlobStreamer);

        error = undefined;
        try {
            await writeFileStreamer.run();
        }
        catch(e) {
            error = e;
        }

        writeFileStreamer.close();

        assert(!error);
        const content1 = fs.readFileSync(filepath1);
        const content2 = fs.readFileSync(filepath2);

        assert(content2.equals(content1));
    });

    it.skip("BlobStreamReader and BlobStreamWriter should work together", async function() {
        // TODO
    });

    it.skip("Resume with BlobStreamReader", async function() {
        // TODO
    });

    it.skip("Resume with BlobStreamWriter", async function() {
        // TODO
    });

    it.skip("Redundancy with multiple BlobStreamReaders", async function() {
        // TODO
    });

    it.skip("BlobStreamWriter should be pausable", async function() {
        // TODO
    });
});

function makePeerProps(connectionType: number, publicKey: Buffer): PeerProps {
    return {
        connectionType,
        version: P2PClient.Version,
        serializeFormat: P2PClient.Formats[0],
        handshakedPublicKey: publicKey,
        authCert: undefined,
        authCertPublicKey: undefined,
        clock: Date.now(),
        region: undefined,
        jurisdiction: undefined,
        appVersion: undefined,
    };
}
