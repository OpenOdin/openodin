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
    StreamStatus,
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

        fileStreamer.setAutoClose(false);

        const readData = await fileStreamer.next();

        assert(readData);
        assert(readData.pos === 0n);
        assert(readData.size === BigInt(content.length));
        assert(readData.data.equals(content));

        assert(!fileStreamer.isClosed());

        fileStreamer.close();

        assert(fileStreamer.isClosed());
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

        fileStreamer.setAutoClose(false);

        readData = await fileStreamer.next();

        assert(readData.pos === 4n);
        assert(readData.size === BigInt(content.length));
        assert(readData.data.equals(content.slice(4, 14)));

        readData = await fileStreamer.next();

        assert(readData.pos === 14n);
        assert(readData.size === BigInt(content.length));
        assert(readData.data.equals(content.slice(14, 24)));

        readData = await fileStreamer.next();

        assert(readData.pos === 24n);
        assert(readData.size === BigInt(content.length));
        assert(readData.data.equals(content.slice(24)));

        readData = await fileStreamer.next();
        assert(readData.status === StreamStatus.EOF);
        assert(readData.pos === 32n);

        readData = await fileStreamer.next();
        assert(readData.status === StreamStatus.EOF);
        assert(readData.pos === 32n);

        fileStreamer.seek(0n);
        readData = await fileStreamer.next();

        assert(readData.status === StreamStatus.RESULT);
        assert(readData.pos === 0n);
        assert(readData.size === BigInt(content.length));
        assert(readData.data.equals(content.slice(0, 10)));

        fileStreamer.close();
        readData = await fileStreamer.next();

        assert(readData.status === StreamStatus.ERROR);
        assert(readData.error === "StreamReader is closed");
        assert(readData.pos === 0n);
        assert(readData.size === 0n);
        assert(readData.data.length === 0);
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

        assert(readFileStreamer.isClosed());

        let writeFileStreamer = new FileStreamWriter(filepath2, readFileStreamer);

        let writeData = await writeFileStreamer.run();

        assert(writeData.status === StreamStatus.ERROR);
        assert(writeData.readError);
        assert(writeData.error === "StreamReader is closed");

        assert(writeFileStreamer.isClosed());

        ///

        writeData = await writeFileStreamer.run();

        assert(writeData.status === StreamStatus.ERROR);
        assert(!writeData.readError);
        assert(writeData.error === "StreamWriter is closed");

        ///

        readFileStreamer = new FileStreamReader(filepath1, 0n, 1);
        writeFileStreamer = new FileStreamWriter(filepath2, readFileStreamer);

        writeFileStreamer.onStats( (stats: WriteStats) => {
            // Small hack to close the writer prematurely.
            writeFileStreamer.close();
        });

        writeData = await writeFileStreamer.run();

        assert(writeData.status === StreamStatus.ERROR);
        assert(!writeData.readError);
        assert(writeData.error === "StreamWriter closed unexpectedly");
        assert(writeData.stats?.written === 1n);
        assert(!writeData.stats?.error);  // No error flag set here since the closing was done from the outside.
        assert(writeFileStreamer.isClosed());
        assert(readFileStreamer.isClosed());

        /////

        readFileStreamer = new FileStreamReader(filepath1);
        writeFileStreamer = new FileStreamWriter(path.sep, readFileStreamer);

        writeData = await writeFileStreamer.run();

        assert(writeData.status === StreamStatus.UNRECOVERABLE);
        assert(writeData.error === `FileStreamWriter could not open the file: ${path.sep}`);
        assert(!writeData.readError);
        assert(writeFileStreamer.isClosed());
        assert(readFileStreamer.isClosed());

        /////

        readFileStreamer = new FileStreamReader(path.sep);
        writeFileStreamer = new FileStreamWriter(filepath2, readFileStreamer);

        writeData = await writeFileStreamer.run();

        assert(writeData.status === StreamStatus.UNRECOVERABLE);
        assert(writeData.error === `FileStreamReader could not open the file: ${path.sep}`);
        assert(writeData.readError);
        assert(writeFileStreamer.isClosed());
        assert(readFileStreamer.isClosed());

        /////

        const filepath3 = `${path.sep}woefj${path.sep}oijfew${path.sep}oijfe`;
        readFileStreamer = new FileStreamReader(filepath3);
        writeFileStreamer = new FileStreamWriter(filepath2, readFileStreamer);

        writeData = await writeFileStreamer.run();

        assert(writeData.status === StreamStatus.UNRECOVERABLE);
        assert(writeData.error === `FileStreamReader could not open the file: ${filepath3}`);
        assert(writeData.readError);
        assert(writeFileStreamer.isClosed());
        assert(readFileStreamer.isClosed());
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
        for (let pos = 0; pos < content.length; pos++) {
            const reader = new FileStreamReader(filepath1, BigInt(pos));
            const writer = new FileStreamWriter(filepath2, reader, false);

            await writer.run();

            const content1 = fs.readFileSync(filepath1);
            const content2 = fs.readFileSync(filepath2);

            assert(content1.length - pos === content2.length);
            assert(content1.slice(pos).equals(content2));
        }
    });

    it("Writer should be able to be paused and resumed", async function() {
        const readFileStreamer = new FileStreamReader(filepath1, 10n, 1);
        const writeFileStreamer = new FileStreamWriter(filepath2, readFileStreamer, false);

        let tick = false;
        writeFileStreamer.onStats( (stat: WriteStats) => {
            if (tick) {
                return;
            }

            tick = true;

            // Small trick to get a chance to pause the write.
            if (stat.isPaused === false) {
                writeFileStreamer.pause();
                setTimeout( () => {writeFileStreamer.unpause();}, 50);
            }
        });

        let writeData = await writeFileStreamer.run();

        assert(writeData.status === StreamStatus.RESULT);

        const content1 = fs.readFileSync(filepath1);
        const content2 = fs.readFileSync(filepath2);

        assert(content2.equals(content1.slice(10)));
    });

    it("Writer should be able to resume existing file writing", async function() {
        fs.writeFileSync(filepath2, content.slice(0, 15));

        const readFileStreamer = new FileStreamReader(filepath1);
        const writeFileStreamer = new FileStreamWriter(filepath2, readFileStreamer);

        let bytesWritten: bigint = 0n;
        writeFileStreamer.onStats( (stats: WriteStats) => {
            bytesWritten = stats.written;
        });

        let writeData = await writeFileStreamer.run();

        assert(bytesWritten === BigInt(content.length - 15));

        const content1 = fs.readFileSync(filepath1);
        const content2 = fs.readFileSync(filepath2);

        assert(content2.equals(content1));
    });
});
