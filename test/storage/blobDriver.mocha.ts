import {
    assert,
} from "chai";

import {
    expectAsyncException,
    OpenSQLite,
    OpenSQLiteJS,
    OpenPG,
} from "../util";

import {
    Driver,
    BLOB_FRAGMENT_SIZE,
    PromiseCallback,
    Hash,
    DBClient,
    TABLES,
} from "../../src";

/**
 * A subclass wrapper to make protected functions accessible publicly.
 *
 */
class BlobDriverTestWrapper extends Driver {
    public async calcBlobStartFragment(dataId: Buffer, pos: number, data: Buffer): Promise<{fragment: Buffer, startFragmentIndex: number, index: number}> {
        return super.calcBlobStartFragment(dataId, pos, data);
    }

    public async calcBlobEndFragment(dataId: Buffer, pos: number, index: number, data: Buffer): Promise<{fragment: Buffer, endFragmentIndex: number}> {
        return super.calcBlobEndFragment(dataId, pos, index, data);
    }

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
 * The BlobDriver should run in journalling mode since it is faster.
 */
describe("BlobDriver: SQLite journalling mode", function() {
    let driver: BlobDriverTestWrapper | undefined;
    let db: any;
    const config: any = {};

    beforeEach("Open database and create tables", async function() {
        db = await OpenSQLite();
        driver = new BlobDriverTestWrapper(new DBClient(db), new DBClient(db));

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

    setupBlobTests(config);
});

/**
 * Test that the BlobDriver is OK running under WAL-mode.
 */
describe("BlobDriver: SQLite WAL-mode", function() {
    let driver: BlobDriverTestWrapper | undefined;
    let db: any;
    const config: any = {};

    beforeEach("Open database and create tables", async function() {
        db = await OpenSQLite();
        db.exec("PRAGMA journal_mode=WAL;");
        driver = new BlobDriverTestWrapper(new DBClient(db), new DBClient(db));

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

    setupBlobTests(config);
});

/**
 * The BlobDriver should run in journalling mode since it is faster.
 */
describe("BlobDriver: SQLiteJS journalling mode", function() {
    let driver: BlobDriverTestWrapper | undefined;
    let db: any;
    const config: any = {};

    beforeEach("Open database and create tables", async function() {
        db = await OpenSQLiteJS();
        driver = new BlobDriverTestWrapper(new DBClient(db), new DBClient(db));

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

    setupBlobTests(config);
});

/**
 * Test that the BlobDriver is OK running under WAL-mode.
 */
describe("BlobDriver: SQLiteJS WAL-mode", function() {
    let driver: BlobDriverTestWrapper | undefined;
    let db: any;
    const config: any = {};

    beforeEach("Open database and create tables", async function() {
        db = await OpenSQLiteJS();
        db.exec("PRAGMA journal_mode=WAL;");
        driver = new BlobDriverTestWrapper(new DBClient(db), new DBClient(db));

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

    setupBlobTests(config);
});

describe("BlobDriver: PostgreSQL READ COMMITTED mode", function() {
    before(function() {
        if (process.env.PGHOST && process.env.PGPORT && process.env.PGUSER) {
            // Pass
        }
        else {
            this.skip();
            return;
        }
    });

    let driver: BlobDriverTestWrapper | undefined;
    let db: any;
    const config: any = {};

    beforeEach("Open database and create tables", async function() {
        db = new DBClient(await OpenPG(false));
        driver = new BlobDriverTestWrapper(db, db);

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

    setupBlobTests(config);
});

describe("BlobDriver: PostgreSQL REPEATABLE READ mode", function() {
    before(function() {
        if (process.env.PGHOST && process.env.PGPORT && process.env.PGUSER) {
            // Pass
        }
        else {
            this.skip();
            return;
        }
    });

    let driver: BlobDriverTestWrapper | undefined;
    let db: any;
    const config: any = {};

    beforeEach("Open database and create tables", async function() {
        db = new DBClient(await OpenPG());
        driver = new BlobDriverTestWrapper(db, db);

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

    setupBlobTests(config);
});

function setupBlobTests(config: any) {
    it("#getBlobDataId non-existing blob should properly be detected as non-existing", async function() {
        const driver = config.driver;

        assert(driver);

        const nodeId1 = Buffer.alloc(32).fill(1);
        const result = await driver.getBlobDataId(nodeId1);

        assert(!result);
    });

    it("#calcBlobStartFragment", async function() {
        const driver = config.driver;

        assert(driver);

        const dataId = Buffer.alloc(32).fill(101);

        let data = Buffer.from("Hello World!");

        let {fragment, startFragmentIndex, index} = await driver.calcBlobStartFragment(dataId, 0, data);

        assert(startFragmentIndex === 0);
        assert(index === data.length);
        assert(fragment.length === data.length);
        assert(fragment.equals(data));


        ({fragment, startFragmentIndex, index} = await driver.calcBlobStartFragment(dataId, 1, data));

        assert(startFragmentIndex === 0);
        assert(index === data.length);
        assert(fragment.length === data.length + 1);
        assert(fragment.equals(Buffer.concat([Buffer.from([0]), data])));


        ({fragment, startFragmentIndex, index} = await driver.calcBlobStartFragment(dataId, BLOB_FRAGMENT_SIZE, data));

        assert(startFragmentIndex === 1);
        assert(index === data.length);
        assert(fragment.length === data.length);
        assert(fragment.equals(data));


        ({fragment, startFragmentIndex, index} = await driver.calcBlobStartFragment(dataId, BLOB_FRAGMENT_SIZE * 2 + 1, data));

        assert(startFragmentIndex === 2);
        assert(index === data.length);
        assert(fragment.length === data.length + 1);
        assert(fragment.equals(Buffer.concat([Buffer.from([0]), data])));


        //////
        data = Buffer.alloc(BLOB_FRAGMENT_SIZE);
        for (let i=0; i<data.length; i++) {
            data[i] = i%256;
        }

        ({fragment, startFragmentIndex, index} = await driver.calcBlobStartFragment(dataId, 0, data));

        assert(startFragmentIndex === 0);
        assert(index === BLOB_FRAGMENT_SIZE);
        assert(fragment.length === BLOB_FRAGMENT_SIZE);


        ({fragment, startFragmentIndex, index} = await driver.calcBlobStartFragment(dataId, 1, data));

        assert(startFragmentIndex === 0);
        assert(index === BLOB_FRAGMENT_SIZE-1);
        assert(fragment.length === BLOB_FRAGMENT_SIZE);


        ({fragment, startFragmentIndex, index} = await driver.calcBlobStartFragment(dataId, BLOB_FRAGMENT_SIZE, data));

        assert(startFragmentIndex === 1);
        assert(index === BLOB_FRAGMENT_SIZE);
        assert(fragment.length === BLOB_FRAGMENT_SIZE);
        assert(fragment.equals(data.slice(0, BLOB_FRAGMENT_SIZE)));


        ({fragment, startFragmentIndex, index} = await driver.calcBlobStartFragment(dataId, BLOB_FRAGMENT_SIZE * 2 + 1, data));

        assert(startFragmentIndex === 2);
        assert(index === BLOB_FRAGMENT_SIZE-1);
        assert(fragment.length === BLOB_FRAGMENT_SIZE);
        assert(fragment.equals(Buffer.concat([Buffer.from([0]), data.slice(0, BLOB_FRAGMENT_SIZE-1)])));



        //////
        data = Buffer.alloc(BLOB_FRAGMENT_SIZE * 10);
        for (let i=0; i<data.length; i++) {
            data[i] = i%256;
        }

        ({fragment, startFragmentIndex, index} = await driver.calcBlobStartFragment(dataId, 0, data));

        assert(startFragmentIndex === 0);
        assert(index === BLOB_FRAGMENT_SIZE);
        assert(fragment.length === BLOB_FRAGMENT_SIZE);


        ({fragment, startFragmentIndex, index} = await driver.calcBlobStartFragment(dataId, 1, data));

        assert(startFragmentIndex === 0);
        assert(index === BLOB_FRAGMENT_SIZE-1);
        assert(fragment.length === BLOB_FRAGMENT_SIZE);


        ({fragment, startFragmentIndex, index} = await driver.calcBlobStartFragment(dataId, BLOB_FRAGMENT_SIZE, data));

        assert(startFragmentIndex === 1);
        assert(index === BLOB_FRAGMENT_SIZE);
        assert(fragment.length === BLOB_FRAGMENT_SIZE);
        assert(fragment.equals(data.slice(0, BLOB_FRAGMENT_SIZE)));


        ({fragment, startFragmentIndex, index} = await driver.calcBlobStartFragment(dataId, BLOB_FRAGMENT_SIZE * 6 + 100, data));

        assert(startFragmentIndex === 6);
        assert(index === BLOB_FRAGMENT_SIZE-100);
        assert(fragment.length === BLOB_FRAGMENT_SIZE);
        assert(fragment.equals(Buffer.concat([Buffer.alloc(100), data.slice(0, BLOB_FRAGMENT_SIZE-100)])));
    });

    it("#calcBlobEndFragment", async function() {
        const driver = config.driver;

        assert(driver);

        const dataId = Buffer.alloc(32).fill(101);

        await expectAsyncException(
            driver.calcBlobEndFragment(dataId, 0, 0, Buffer.alloc(0)),
            "End of data reached");

        await expectAsyncException(
            driver.calcBlobEndFragment(dataId, 0, 0, Buffer.from("Hello World!")),
            "This is not the end fragment, looks like the start fragment");

        await expectAsyncException(
            driver.calcBlobEndFragment(dataId, 0, 0,
            Buffer.alloc(BLOB_FRAGMENT_SIZE)),
            "This is not the end fragment, looks like the start fragment");

        await expectAsyncException(
            driver.calcBlobEndFragment(dataId, 0, 0,
            Buffer.alloc(BLOB_FRAGMENT_SIZE+1)),
            "This is not the end fragment, looks like the start fragment");

        await expectAsyncException(
            driver.calcBlobEndFragment(dataId, 10, BLOB_FRAGMENT_SIZE-11,
            Buffer.alloc(BLOB_FRAGMENT_SIZE+1)),
            "This is not the end fragment, looks like the start fragment");

        await expectAsyncException(
            driver.calcBlobEndFragment(dataId, BLOB_FRAGMENT_SIZE, 0,
            Buffer.alloc(BLOB_FRAGMENT_SIZE+1)),
            "This is not the end fragment, looks like a middle fragment");

        await expectAsyncException(
            driver.calcBlobEndFragment(dataId, BLOB_FRAGMENT_SIZE*2, 1000,
            Buffer.alloc(BLOB_FRAGMENT_SIZE*2)),
            "This is not the end fragment, looks like a middle fragment");

        await expectAsyncException(
            driver.calcBlobEndFragment(dataId, BLOB_FRAGMENT_SIZE-10, 11,
            Buffer.alloc(100)),
            "The end fragment must begin on the exact fragment boundary");


        //////
        let startPos = BLOB_FRAGMENT_SIZE;
        let index = 0;
        let data = Buffer.alloc(10);

        for (let i=0; i<data.length; i++) {
            data[i] = i%256;
        }

        let {fragment, endFragmentIndex} = await driver.calcBlobEndFragment(dataId, startPos, index, data);

        assert(endFragmentIndex === 1);
        assert(fragment.length === 10);
        assert(fragment.equals(data));


        //////
        data = Buffer.alloc(BLOB_FRAGMENT_SIZE*2);

        for (let i=0; i<data.length; i++) {
            data[i] = i%256;
        }

        index = BLOB_FRAGMENT_SIZE;

        ({fragment, endFragmentIndex} = await driver.calcBlobEndFragment(dataId, startPos, index, data));

        assert(endFragmentIndex === 2);
        assert(fragment.length === BLOB_FRAGMENT_SIZE);
        assert(fragment.equals(data.slice(index, index + BLOB_FRAGMENT_SIZE)));


        //////
        data = Buffer.alloc(BLOB_FRAGMENT_SIZE);

        index = BLOB_FRAGMENT_SIZE;
        startPos = BLOB_FRAGMENT_SIZE;

        await expectAsyncException(
            driver.calcBlobEndFragment(dataId, startPos, index, data),
            "End of data reached");
    });

    it("#writeblobFragment, #readBlobFragment, #readBlobIntermediaryLength, #getBlobDataId, #finalizeWriteBlob, #readBlob", async function() {
        const driver = config.driver;

        assert(driver);

        const dataId = Buffer.alloc(32).fill(101);

        let fragment = Buffer.alloc(BLOB_FRAGMENT_SIZE + 1);
        let fragmentIndex = 0;

        await expectAsyncException(
            driver.writeBlobFragment(dataId, fragment, fragmentIndex),
            "Blob fragment too large");

        fragment = Buffer.alloc(BLOB_FRAGMENT_SIZE);

        for (let i=0; i<fragment.length; i++) {
            fragment[i] = i%256;
        }

        let fragment2 = Buffer.alloc(1024);

        for (let i=0; i<fragment2.length; i++) {
            fragment2[i] = (i+1)%256;
        }

        // #readBlobFragment
        // #writeBlobFragment
        //
        let readFragment = await driver.readBlobFragment(dataId, fragmentIndex);

        assert(!readFragment);


        await driver.writeBlobFragment(dataId, fragment, fragmentIndex);

        readFragment = await driver.readBlobFragment(dataId, fragmentIndex, true);
        assert(!readFragment);

        readFragment = await driver.readBlobFragment(dataId, fragmentIndex);

        assert(readFragment);
        assert(readFragment.equals(fragment));


        await driver.writeBlobFragment(dataId, fragment2, fragmentIndex);
        readFragment = await driver.readBlobFragment(dataId, fragmentIndex);

        assert(readFragment);
        assert(!readFragment.equals(fragment));
        assert(readFragment.equals(fragment2));

        // #readBlobIntermediaryLength
        //
        let length = await driver.readBlobIntermediaryLength(dataId);
        assert(length === fragment2.length);

        await driver.writeBlobFragment(dataId, fragment, fragmentIndex+1);
        readFragment = await driver.readBlobFragment(dataId, fragmentIndex+1);

        assert(readFragment);
        assert(readFragment.equals(fragment));

        length = await driver.readBlobIntermediaryLength(dataId);
        assert(length === fragment2.length + fragment.length);

        const nodeId1 = Buffer.alloc(32).fill(2);

        // #getBlobDataId
        //
        let exists = await driver.getBlobDataId(nodeId1);
        assert(!exists);

        // #finalizeWriteBlob
        //
        let blobLength = fragment2.length + fragment.length;
        let blobHash = Hash(Buffer.concat([fragment2, fragment]));

        await expectAsyncException(
            driver.finalizeWriteBlob(nodeId1, dataId, blobLength-1, blobHash),
            "blob length not correct");

        await expectAsyncException(
            driver.finalizeWriteBlob(nodeId1, dataId, blobLength, Buffer.alloc(32)),
            "blob hash not correct");

        await driver.finalizeWriteBlob(nodeId1, dataId, blobLength, blobHash);

        // #getBlobDataId
        //
        const dataId2 = await driver.getBlobDataId(nodeId1);
        assert(dataId2);
        assert(dataId2.equals(dataId));

        // Try rewriting finalized blob fragments (without success).
        //
        let fragment3 = Buffer.alloc(1024);
        await driver.writeBlobFragment(dataId, fragment3, fragmentIndex+1);
        readFragment = await driver.readBlobFragment(dataId, fragmentIndex+1, true);

        assert(readFragment);
        assert(readFragment.equals(fragment));

        // #readBlob
        // Try to read more data than finalized to get all data.
        //
        let readData = await driver.readBlob(nodeId1, 0, 1024*1024);
        assert(readData.length === BLOB_FRAGMENT_SIZE + 1024);
    });

    it("#writeBlob, #readBlob", async function() {
        const driver = config.driver;

        assert(driver);

        type BlobWrite = {
            nodeId1: Buffer,
            clientPublicKey: Buffer,
            write: { pos: number, data: Buffer, }[],
            finalData: Buffer,
        };

        const fragment1 = Buffer.alloc(BLOB_FRAGMENT_SIZE);
        for (let i=0; i<fragment1.length; i++) {
            fragment1[i] = i%256;
        }

        const fragment2 = Buffer.alloc(BLOB_FRAGMENT_SIZE);
        for (let i=0; i<fragment2.length; i++) {
            fragment2[i] = (i+1)%256;
        }

        const nodeIda = Buffer.alloc(32).fill(1);
        const nodeIdb = Buffer.alloc(32).fill(2);
        const nodeIdc = Buffer.alloc(32).fill(3);
        const nodeIdd = Buffer.alloc(32).fill(4);

        const clientPublicKeya = Buffer.alloc(32).fill(101);

        const blobs: BlobWrite[] = [
            {
                nodeId1: nodeIda,
                clientPublicKey: clientPublicKeya,
                write: [
                    {
                        pos: 0,
                        data: fragment1,
                    },
                ],
                finalData: fragment1,
            },
            {
                nodeId1: nodeIdb,
                clientPublicKey: clientPublicKeya,
                write: [
                    {
                        pos: 1,
                        data: fragment1,
                    },
                ],
                finalData: Buffer.concat([Buffer.alloc(1), fragment1]),
            },
            {
                nodeId1: nodeIdc,
                clientPublicKey: clientPublicKeya,
                write: [
                    {
                        pos: BLOB_FRAGMENT_SIZE-1,
                        data: fragment1,
                    },
                ],
                finalData: Buffer.concat([Buffer.alloc(BLOB_FRAGMENT_SIZE-1), fragment1]),
            },
            {
                nodeId1: nodeIdd,
                clientPublicKey: clientPublicKeya,
                write: [
                    {
                        pos: BLOB_FRAGMENT_SIZE,
                        data: fragment1,
                    },
                    {
                        pos: BLOB_FRAGMENT_SIZE-1,
                        data: Buffer.alloc(1),
                    },
                ],
                finalData: Buffer.concat([Buffer.alloc(BLOB_FRAGMENT_SIZE), fragment1]),
            }
        ];

        let index = 0;
        try {
            for (let blobWrite of blobs) {
                const nodeId1 = blobWrite.nodeId1;
                const clientPublicKey = blobWrite.clientPublicKey;

                const dataId = Hash([nodeId1, clientPublicKey]);

                await expectAsyncException(
                    driver.readBlob(nodeId1, 0, 10),
                    "node blob data does not exist in finalized state");

                for(let fragment of blobWrite.write) {
                    await driver.writeBlob(dataId, fragment.pos, fragment.data);

                    await expectAsyncException(
                        driver.readBlob(nodeId1, 0, 10),
                        "node blob data does not exist in finalized state");
                }

                let blobLength = blobWrite.finalData.length;
                let blobHash = Hash(blobWrite.finalData);

                await driver.finalizeWriteBlob(nodeId1, dataId, blobLength, blobHash);

                let readData = await driver.readBlob(nodeId1, 0, blobLength);

                assert(readData);
                assert(readData.equals(blobWrite.finalData));

                index++;
            }
        }
        catch(e) {
            throw new Error(`Error in writing/reading blobWrite index ${index}: ${e}`);
        }
    });

    // TODO: #deleteBlobs
};
