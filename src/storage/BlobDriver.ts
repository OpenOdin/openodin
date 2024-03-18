/**
 * A stateless driver over SQLite or PostgreSQL to efficiently drive data from the underlying database.
 *
 * This is the blob specific driver.
 *
 */

import blake2b from "blake2b"

import { strict as assert } from "assert";

import {
    BlobDriverInterface,
    BLOB_TABLES,
    BLOB_FRAGMENT_SIZE,
} from "./types";

import {
    DBClient,
} from "./DBClient";

//import {
    //PocketConsole,
//} from "pocket-console";

//const console = PocketConsole({module: "BlobDriver"});

/**
 * @see BlobDriverInterface for details on public functions.
 */
export class BlobDriver implements BlobDriverInterface {
    constructor(
        protected readonly blobDb: DBClient,
    ) {}


    public async init() {
    }

    public async createTables(): Promise<boolean> {
        const db =  this.blobDb;
        assert(db);

        try {
            const allTables = await db.listTables();

            let tableExistingCount = 0;
            for (const table in BLOB_TABLES) {
                if (allTables.includes(table)) {
                    tableExistingCount++;
                }
            }

            if (tableExistingCount > 0 && tableExistingCount < Object.keys(BLOB_TABLES).length) {
                return false;
            }

            if (tableExistingCount > 0 && tableExistingCount === Object.keys(BLOB_TABLES).length) {
                return true;
            }

            await db.exec("BEGIN;");

            for (const table in BLOB_TABLES) {
                const columns = BLOB_TABLES[table].columns.join(",");
                const sql = `CREATE TABLE ${table} (${columns});`;

                await db.exec(sql);

                // Create indexes
                for (const idx in BLOB_TABLES[table].indexes) {
                    const columns = BLOB_TABLES[table].indexes[idx].columns.join(",");
                    const unique = BLOB_TABLES[table].indexes[idx].unique ? "UNIQUE" : "";

                    const sql = `CREATE ${unique} INDEX ${idx} ON ${table}(${columns});`;

                    await db.exec(sql);
                }
            }

            await db.exec("COMMIT;");
        }
        catch(e) {
            db.exec("ROLLBACK;");
            throw(e);
        }

        return true;
    }

    /** Notify when the underlaying database connection closes. */
    public onClose(fn: () => void) {
        this.blobDb?.on("close", fn);
    }

    /** Deregister onClose callback. */
    public offClose(fn: () => void) {
        this.blobDb?.off("close", fn);
    }

    /** Notify when there is an error in the underlaying database connection. */
    public onError(fn: (err: Error) => void) {
        this.blobDb?.on("error", fn);
    }

    public offError(fn: (err: Error) => void) {
        this.blobDb?.off("error", fn);
    }

    public async deleteBlobs(nodeId1s: Buffer[]): Promise<number> {
        assert(this.blobDb, "Blob driver is not available");

        this.blobDb.exec("BEGIN;");

        try {
            const ph = this.blobDb.generatePlaceholders(nodeId1s.length);

            const dataIds = (await this.blobDb.all(`DELETE FROM openodin_blob AS t
                WHERE t.node_id1 IN ${ph}
                RETURNING dataid;`, nodeId1s)).map( (row: any) => row.dataid );

            const ph2 = this.blobDb.generatePlaceholders(dataIds.length);

            await this.blobDb.run(`DELETE FROM openodin_blob_data AS bd WHERE bd.dataid IN ${ph2}
                AND bd.dataid NOT IN (SELECT dataid from openodin_blob);`, dataIds);

            this.blobDb.exec("COMMIT;");

            return dataIds.length;
        }
        catch(e) {
            this.blobDb.exec("ROLLBACK;");
            throw e;
        }
    }

    public async deleteNonfinalizedBlobData(timestamp: number, limit: number = 1000): Promise<number> {
        assert(this.blobDb, "Blob driver is not available");

        this.blobDb.exec("BEGIN;");

        try {
            const sql = `DELETE FROM openodin_blob_data WHERE dataid IN
                (SELECT dataid FROM openodin_blob_data WHERE creationtime<${timestamp} AND finalized=0 LIMIT ${limit})
                RETURNING creationtime;`;

            const timestamps = await this.blobDb.all(sql);

            this.blobDb.exec("COMMIT;");

            return timestamps.length;
        }
        catch(e) {
            this.blobDb.exec("ROLLBACK;");

            throw e;
        }
    }

    /**
     * @see BlobDriverInterface.
     *
     * Note: Writing sparsely might not work. Each fragment must be touched to be existing,
     * meaning that if writing a huge blob of 0-bytes it is not
     * enough to only write the last byte in the last fragment.
     * The last byte of every fragment must in such case be written to.
     */
    public async writeBlob(dataId: Buffer, pos: number, data: Buffer, now: number) {
        assert(this.blobDb, "Blob driver is not available");

        await this.blobDb.exec("BEGIN;");
        try {
            // Handle first fragment
            //

            const res = await this.calcBlobStartFragment(dataId, pos, data);

            const {fragment, startFragmentIndex} = res;

            let index = res.index;

            assert(fragment.length <= BLOB_FRAGMENT_SIZE);

            await this.writeBlobFragment(dataId, fragment, startFragmentIndex, now);

            // calc end index, not including.
            const endFragmentIndex = Math.ceil((pos + data.length) / BLOB_FRAGMENT_SIZE);

            const countFragments = endFragmentIndex - startFragmentIndex;

            let fragmentIndex = startFragmentIndex + 1;

            // Handle middle fragments, not last fragment.
            //
            while (fragmentIndex < endFragmentIndex - 1) {
                const fragment = data.slice(index, index + BLOB_FRAGMENT_SIZE);

                index += fragment.length;

                await this.writeBlobFragment(dataId, fragment, fragmentIndex, now);

                fragmentIndex++;
            }

            // Handle last fragment.
            //
            if (countFragments > 1 && index < data.length) {
                const {fragment, lastFragmentIndex} =
                    await this.calcBlobEndFragment(dataId, pos, index, data);

                await this.writeBlobFragment(dataId, fragment, lastFragmentIndex, now);
            }

            await this.blobDb.exec("COMMIT;");
        }
        catch(e) {
            await this.blobDb.exec("ROLLBACK;");
            throw e;
        }
    }

    /**
     * @see BlobDriverInterface.
     */
    public async readBlob(nodeId1: Buffer, pos: number, length: number): Promise<Buffer | undefined> {
        assert(this.blobDb, "Blob driver is not available");

        const dataId = await this.getBlobDataId(nodeId1);

        if (!dataId) {
            return undefined;
        }

        let fragmentIndex = Math.floor(pos / BLOB_FRAGMENT_SIZE);
        const fragments: Buffer[] = [];
        let doneLength = 0;
        let posInFragment = pos - fragmentIndex * BLOB_FRAGMENT_SIZE;

        while (doneLength < length) {
            const fragment = await this.readBlobFragment(dataId, fragmentIndex, true);

            if (!fragment) {
                break;
            }

            const fragment2 = fragment.slice(posInFragment, posInFragment + length - doneLength);

            fragments.push(fragment2);

            doneLength += fragment2.length;


            fragmentIndex++;
            posInFragment = 0;
        }

        return Buffer.concat(fragments);
    }

    /**
     * @param dataId
     * @param pos position in blob
     * @param data meant to be written starting at blob position.
     * @returns data of first fragment, the fragment index and the index used up within the fragment.
     */
    protected async calcBlobStartFragment(dataId: Buffer, pos: number, data: Buffer):
        Promise<{fragment: Buffer, startFragmentIndex: number, index: number}> {

        const startFragmentIndex = Math.floor(pos / BLOB_FRAGMENT_SIZE);

        const boundaryDiff = pos - startFragmentIndex * BLOB_FRAGMENT_SIZE;

        const index = Math.min(BLOB_FRAGMENT_SIZE - boundaryDiff, data.length);

        const dataSlice = data.slice(0, index);

        let fragment: Buffer | undefined;

        assert(dataSlice.length <= BLOB_FRAGMENT_SIZE);

        if (dataSlice.length < BLOB_FRAGMENT_SIZE) {
            fragment = await this.readBlobFragment(dataId, startFragmentIndex);

            if (fragment) {
                const diff = (dataSlice.length + boundaryDiff) - fragment.length;

                if (diff > 0) {
                    fragment = Buffer.concat([fragment, Buffer.alloc(diff)]);
                }
            }
            else {
                fragment = Buffer.alloc(boundaryDiff + dataSlice.length);
            }

            dataSlice.copy(fragment, boundaryDiff);
        }
        else {
            fragment = dataSlice;
        }

        return {fragment, startFragmentIndex, index};
    }

    /**
     * Calculate the end fragment if applicable.
     * @param dataId
     * @param startPos the original start position in the blob for the writing.
     * @param index the index of data reached so far.
     * @param data the unmodifed data buffer to write from.
     *
     * @returns data of last fragment and the fragment index of last fragment.
     * @throws on invalid input parameters.
     */
    protected async calcBlobEndFragment(dataId: Buffer, startPos: number, index: number,
        data: Buffer): Promise<{fragment: Buffer, lastFragmentIndex: number}> {

        const startFragmentIndex = Math.floor(startPos / BLOB_FRAGMENT_SIZE);

        // not including
        const endFragmentIndex = Math.ceil((startPos + data.length) / BLOB_FRAGMENT_SIZE);

        const lastFragmentIndex = endFragmentIndex - 1;

        const currentFragmentIndex = Math.floor((startPos + index) / BLOB_FRAGMENT_SIZE);

        if (index >= data.length) {
            throw new Error("End of data reached");
        }
        else if (startFragmentIndex === currentFragmentIndex) {
            throw new Error("This is not the end fragment, looks like the start fragment");
        }
        else if (currentFragmentIndex < lastFragmentIndex) {
            throw new Error("This is not the end fragment, looks like a middle fragment");
        }
        else if (lastFragmentIndex * BLOB_FRAGMENT_SIZE !== startPos + index) {
            throw new Error("The end fragment must begin on the exact fragment boundary");
        }


        let fragment: Buffer | undefined;

        if (index + BLOB_FRAGMENT_SIZE === data.length) {
            fragment = data.slice(index, index + BLOB_FRAGMENT_SIZE);
        }
        else {
            const dataSlice = data.slice(index);

            fragment = await this.readBlobFragment(dataId, lastFragmentIndex);

            if (!fragment) {
                fragment = dataSlice;
            }
            else {
                const remainingLength = Math.max(0, dataSlice.length - fragment.length);
                fragment = Buffer.concat([fragment, Buffer.alloc(remainingLength)]);
                dataSlice.copy(fragment, 0);
            }
        }

        return {fragment, lastFragmentIndex};
    }

    /**
     * Insert or replace existing fragment if not finalized already.
     *
     * This function expects to be run within a transaction.
     *
     * @param dataId
     * @param fragment data to insert/replace
     * @param fragmentIndex the fragment index to write to
     * @throws on error
     */
    protected async writeBlobFragment(dataId: Buffer, fragment: Buffer, fragmentIndex: number, now: number) {
        assert(this.blobDb, "Blob driver is not available");

        if (fragment.length > BLOB_FRAGMENT_SIZE) {
            throw new Error("Blob fragment too large");
        }

        // Note that this write runs in the parent transaction of caller.
        //

        const ph = this.blobDb.generatePlaceholders(5);

        const sql = `INSERT INTO openodin_blob_data (dataid, fragmentnr, finalized, fragment, creationtime)
            VALUES ${ph}
            ON CONFLICT (dataid, fragmentnr) DO UPDATE SET fragment=excluded.fragment,
            creationtime=excluded.creationtime
            WHERE openodin_blob_data.finalized=0;`;

        await this.blobDb.run(sql, [dataId, fragmentIndex, 0, fragment, now]);
    }

    /**
     * Read a full blob fragment, finalized or not.
     *
     * @param dataId
     * @param fragmentIndex
     * @param onlyFinalized set to true to require that the fragment has been finalized.
     * @throws on error
     */
    protected async readBlobFragment(dataId: Buffer, fragmentIndex: number, onlyFinalized: boolean = false): Promise<Buffer | undefined> {
        assert(this.blobDb, "Blob driver is not available");

        if (!Number.isInteger(fragmentIndex)) {
            throw new Error("fragmentIndex not integer");
        }

        const finalized = onlyFinalized ? "AND finalized=1" : "";

        const ph = this.blobDb.generatePlaceholders(1);

        const sql = `SELECT fragment FROM openodin_blob_data
            WHERE dataid=${ph} AND fragmentnr=${fragmentIndex} ${finalized};`;

        const row = await this.blobDb.get(sql, [dataId]);

        return row?.fragment;
    }

    /**
     * @see BlobDriverInterface.
     */
    public async readBlobIntermediaryLength(dataId: Buffer): Promise<number | undefined> {
        assert(this.blobDb, "Blob driver is not available");

        const ph = this.blobDb.generatePlaceholders(1);

        // Does not differ on finalized or unfinalized data.
        //
        const sql = `SELECT SUM(LENGTH(fragment)) AS length
            FROM openodin_blob_data
            WHERE dataid=${ph} GROUP BY dataid LIMIT 1`;

        const row = await this.blobDb.get(sql, [dataId]);

        return row?.length;
    }

    /**
     * @see BlobDriverInterface.
     */
    public async finalizeWriteBlob(nodeId1: Buffer, dataId: Buffer, blobLength: number, blobHash: Buffer, now: number) {
        assert(this.blobDb, "Blob driver is not available");

        const length = await this.readBlobIntermediaryLength(dataId);

        if (length !== blobLength) {
            throw new Error("blob length not correct");
        }

        await this.blobDb.exec("BEGIN;");

        // Check if data is already finalized.
        //
        const ph = this.blobDb.generatePlaceholders(1);

        const sql = `SELECT COUNT(fragment) AS count FROM openodin_blob_data
                WHERE dataid=${ph} AND finalized=1 LIMIT 1;`;

        const row = await this.blobDb.get(sql, [dataId]);

        // Data is not finalized.
        //
        if (!row || row.count === 0) {
            const ph = this.blobDb.generatePlaceholders(1);

            const sql = `SELECT fragment FROM openodin_blob_data
                WHERE dataid=${ph} AND finalized=0 ORDER BY fragmentnr;`;

            const blake = blake2b(32);

            try {
                await this.blobDb.each(sql, [dataId], (row: any): any => {
                    blake.update(row?.fragment);
                });
            }
            catch(e) {
                await this.blobDb.exec("ROLLBACK;");

                throw e;
            }

            const hash = Buffer.from(blake.digest());

            if (!hash.equals(blobHash)) {
                // Delete data and commit.
                const sqlDelete = `DELETE FROM openodin_blob_data
                    WHERE dataid=${ph} AND finalized=0;`;

                await this.blobDb.run(sqlDelete, [dataId]);

                await this.blobDb.exec("COMMIT;");

                throw new Error("Blob hash does not match. Temporary blob data deleted. Write again.");
            }

            const ph1 = this.blobDb.generatePlaceholders(1);

            const sqlUpdate = `UPDATE openodin_blob_data SET finalized=1
            WHERE dataid=${ph1} AND finalized=0;`;

            try {
                await this.blobDb.run(sqlUpdate, [dataId]);

                // commit below
            }
            catch(e) {
                await this.blobDb.exec("ROLLBACK;");

                throw e;
            }
        }

        // Connect blob data with nodeId1.
        //
        const ph2 = this.blobDb.generatePlaceholders(3);

        const sqlInsert = `INSERT INTO openodin_blob (node_id1, dataid, storagetime) VALUES ${ph2};`;

        try {
            await this.blobDb.run(sqlInsert, [nodeId1, dataId, now]);

            await this.blobDb.exec("COMMIT;");
        }
        catch(e) {
            await this.blobDb.exec("ROLLBACK;");

            throw e;
        }
    }

    /**
     * @see BlobDriverInterface.
     */
    public async getBlobDataId(nodeId1: Buffer): Promise<Buffer | undefined> {
        assert(this.blobDb, "Blob driver is not available");

        const ph = this.blobDb.generatePlaceholders(1);

        const sql = `SELECT openodin_blob.dataid FROM openodin_blob, openodin_blob_data
            WHERE node_id1=${ph} AND openodin_blob_data.dataid = openodin_blob.dataid LIMIT 1`;

        const row = await this.blobDb.get(sql, [nodeId1]);

        if (row?.dataid) {
            return Buffer.from(row.dataid, "hex");
        }

        return undefined;
    }

    /**
     * @see BlobDriverInterface.
     */
    public async blobExists(nodeId1s: Buffer[]): Promise<Buffer[]> {
        assert(this.blobDb, "Blob driver is not available");

        const ph = this.blobDb.generatePlaceholders(nodeId1s.length);

        const sql = `SELECT node_id1 FROM openodin_blob WHERE node_id1 IN ${ph};`;

        const rows = await this.blobDb.all(sql, nodeId1s);

        const id1s: Buffer[] = [];

        const rowsLength = rows.length;
        for (let i=0; i<rowsLength; i++) {
            const row = rows[i];
            id1s.push(row.node_id1);
        }

        return id1s;
    }

    public close() {
        this.blobDb?.close();
    }
}
