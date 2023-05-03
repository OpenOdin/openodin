/**
 * Test the abstract streamers in details,
 * as well as the file streamers.
 */
import { assert } from "chai";
import fs from "fs";
import path from "path";

import {
    FileStreamReader,
    FileStreamWriter,
    WriteStats,
} from "../../src";

const content = Buffer.from(`Hello World!

It is a nice day.
`, "utf-8");

describe("FileStreamReader (AbstractStreamReader)", function() {
    const filepath1 = "/tmp/stream-test-1";

    beforeEach("prepare files", function() {
        try {
            fs.rmSync(filepath1);
        }
        catch(e) {}

        fs.writeFileSync(filepath1, content);
    });

    afterEach("delete files", function() {
        try {
            fs.rmSync(filepath1);
        }
        catch(e) {}
    });

    it("should open file and read it fully", async function() {
        const fileStreamer = new FileStreamReader(filepath1);

        const readData = await fileStreamer.next();

        assert(readData);
        assert(readData.pos === 0n);
        assert(readData.size === BigInt(content.length));
        assert(readData.data.equals(content));

        fileStreamer.close();
    });

    it("should open file and read it from given position using varied chunksize", async function() {
        let fileStreamer = new FileStreamReader(filepath1, 1n);

        let readData = await fileStreamer.next();

        assert(readData);
        assert(readData.pos === 1n);
        assert(readData.size === BigInt(content.length));
        assert(readData.data.equals(content.slice(1)));

        fileStreamer.close();


        fileStreamer = new FileStreamReader(filepath1, 4n, 10);

        readData = await fileStreamer.next();

        assert(readData);
        assert(readData.pos === 4n);
        assert(readData.size === BigInt(content.length));
        assert(readData.data.equals(content.slice(4, 14)));


        readData = await fileStreamer.next();

        assert(readData);
        assert(readData.pos === 14n);
        assert(readData.size === BigInt(content.length));
        assert(readData.data.equals(content.slice(14, 24)));

        readData = await fileStreamer.next();

        assert(readData);
        assert(readData.pos === 24n);
        assert(readData.size === BigInt(content.length));
        assert(readData.data.equals(content.slice(24)));

        fileStreamer.seek(0n);
        readData = await fileStreamer.next();

        assert(readData);
        assert(readData.pos === 0n);
        assert(readData.size === BigInt(content.length));
        assert(readData.data.equals(content.slice(0, 10)));

        fileStreamer.close();
    });
});

describe("FileStreamWriter (AbstractStreamWriter)", function() {
    const filepath1 = "/tmp/stream-test-1";
    const filepath2 = "/tmp/stream-test-2";

    beforeEach("prepare files", function() {
        try {
            fs.rmSync(filepath1);
            fs.rmSync(filepath2);
        }
        catch(e) {}

        fs.writeFileSync(filepath1, content);
    });

    afterEach("delete files", function() {
        try {
            fs.rmSync(filepath1);
            fs.rmSync(filepath2);
        }
        catch(e) {}
    });

    it("Writer should detect errors (also coming from reader)", async function() {
        let readFileStreamer = new FileStreamReader(filepath1);

        readFileStreamer.close();

        let writeFileStreamer = new FileStreamWriter(filepath2, readFileStreamer);

        let error: any;

        try {
            await writeFileStreamer.run();
        }
        catch(e) {
            error = e;
        }

        assert(error);
        assert(error.errorOnRead);
        assert(error.message === "Error: StreamReader is closed");

        writeFileStreamer.close();

        ///

        error = undefined;

        try {
            await writeFileStreamer.run();
        }
        catch(e) {
            error = e;
        }

        assert(error);
        assert(error.errorOnRead === false);
        assert(error.message === "Writer is closed");

        readFileStreamer.close();

        ///

        readFileStreamer = new FileStreamReader(filepath1);
        writeFileStreamer = new FileStreamWriter(filepath2, readFileStreamer);

        writeFileStreamer.onStats( (stat: WriteStats) => {
            // Small hack to close the writer prematurely.
            writeFileStreamer.close();
        });

        error = undefined;

        try {
            await writeFileStreamer.run();
        }
        catch(e) {
            error = e;
        }

        assert(error);
        assert(error.errorOnRead === false);
        assert(error.message === "Closed while streaming");

        readFileStreamer.close();

        ///

        readFileStreamer = new FileStreamReader(filepath1);
        writeFileStreamer = new FileStreamWriter("/", readFileStreamer);

        error = undefined;

        try {
            await writeFileStreamer.run();
        }
        catch(e) {
            error = e;
        }

        assert(error);
        assert(error.errorOnRead === false);

        readFileStreamer.close();

        ///

        readFileStreamer = new FileStreamReader(path.sep);
        writeFileStreamer = new FileStreamWriter(filepath2, readFileStreamer);

        error = undefined;

        try {
            await writeFileStreamer.run();
        }
        catch(e) {
            error = e;
        }

        assert(error);
        assert(error.errorOnRead === true);
        assert(error.message.startsWith("Error: Could not read from file:"));

        writeFileStreamer.close();

        ///

        readFileStreamer = new FileStreamReader("/woefj/oijfew/oijfe/");
        writeFileStreamer = new FileStreamWriter(filepath2, readFileStreamer);

        error = undefined;

        try {
            await writeFileStreamer.run();
        }
        catch(e) {
            error = e;
        }

        assert(error.errorOnRead === true);
        assert(error.message.startsWith("Error: The file could not be opened for reading:"));

        writeFileStreamer.close();
    });

    it("Should stream copy a file from/to disk", async function() {
        const reader = new FileStreamReader(filepath1);
        const writer = new FileStreamWriter(filepath2, reader);

        await writer.run();

        const content1 = fs.readFileSync(filepath1);
        const content2 = fs.readFileSync(filepath2);

        assert(content1.equals(content2));
    });

    it("Should stream copy a file from/to disk", async function() {
        // Note that seeking the reader forward like this will make the written file
        // be prefixed with zero bytes matched to the seek length.
        const pos = 1;
        const reader = new FileStreamReader(filepath1, BigInt(pos));
        const writer = new FileStreamWriter(filepath2, reader);

        await writer.run();

        const content1 = fs.readFileSync(filepath1);
        const content2 = fs.readFileSync(filepath2);

        assert(content1.length === content2.length);
        assert(!content1.equals(content2));
        assert(content1.slice(pos).equals(content2.slice(pos)));
    });

    it("Writer should be able to be paused and resumed", async function() {
        const readFileStreamer = new FileStreamReader(filepath1, 10n, 1);
        const writeFileStreamer = new FileStreamWriter(filepath2, readFileStreamer);

        writeFileStreamer.onStats( (stat: WriteStats) => {
            // Small trick to get a chance to pause the write.
            if (stat.isPaused === false) {
                writeFileStreamer.pause();
                setTimeout( () => {writeFileStreamer.run();}, 50);
            }
        });

        let error: any;

        try {
            await writeFileStreamer.run();
        }
        catch(e) {
            error = e;
        }

        assert(!error);

        writeFileStreamer.close();
        readFileStreamer.close();

        const content1 = fs.readFileSync(filepath1);
        const content2 = fs.readFileSync(filepath2);

        assert(content2.slice(10).equals(content1.slice(10)));
    });

    it("Writer should be able to resume existing file writing", async function() {
        fs.writeFileSync(filepath2, content.slice(0, 15));

        const readFileStreamer = new FileStreamReader(filepath1);
        const writeFileStreamer = new FileStreamWriter(filepath2, readFileStreamer);

        let bytesWritten: bigint = 0n;
        writeFileStreamer.onStats( (stat: WriteStats) => {
            bytesWritten = stat.written;
        });

        await writeFileStreamer.run();

        assert(bytesWritten === BigInt(content.length - 15));

        const content1 = fs.readFileSync(filepath1);
        const content2 = fs.readFileSync(filepath2);

        assert(content2.equals(content1));
    });
});
