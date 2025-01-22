/**
 * A stateless driver over SQLite or PostgreSQL to efficiently drive data from the underlying database.
 *
 * Each query runs in a transaction to prevent skewed resultsets if concurrent writes are present.
 *
 * SELECTs are batched to minimize the number of round trips done to the underlying database,
 * this is especially important when using a remote database instead of a local sqlite database.
 *
 * Data permissions and license rights are automatically applied according to the
 * client,targetPublic key combo in the request.
 *
 * Data is efficiently streamed in batches from the underlying storage,
 * however for each running query there is a buildup of memory caching each node ID
 * processed to prevent cyclic fetching and to efficiently apply permissions.
 * The cache is dropped when a query is completed.
 *
 * The datamodel is built on seven SQL tables which are loosely connected.
 */

import { strict as assert } from "assert";

import {
    DriverInterface,
    FetchReplyData,
    HandleFetchReplyData,
    TABLES,
    InsertAchillesHash,
    InsertLicensingHash,
    InsertDestroyHash,
    InsertFriendCert,
    MAX_BATCH_SIZE,
    NOW_TOLERANCE,
} from "./types";

import {
    FetchQuery,
    Status,
} from "../types";

import {
    DBClient,
} from "./DBClient";

import {
    QueryProcessor,
    ReverseFetch,
} from "./QueryProcessor";

import {
    BaseNodeInterface,
    BaseDataNode,
    BaseDataNodeInterface,
    LicenseNode,
    LicenseNodeInterface,
    BaseLicenseNode,
    BaseLicenseNodeInterface,
    UnpackNode,
    HashList,
    MAX_LICENSE_DISTANCE,
    CarrierNode,
    CarrierNodeInterface,
} from "../datamodel";

import {
    ParseSchema,
} from "../util/SchemaUtil";

import {
    FetchRequestSchema,
} from "../request/jsonSchema";

import {
    PocketConsole,
} from "pocket-console";

const console = PocketConsole({module: "Driver"});

/**
 * How parents up from inserted/bumped nodes to update the trailupdatetime.
 * 1 means update only the parent nodes.
 * 0 does not update anything.
 */
const MAX_FRESHEN_DEPTH = 10;

/**
 * @see DriverInterface for details on public functions.
 */
export class Driver implements DriverInterface {
    constructor(
        protected readonly db: DBClient,
    ) {}


    public async init() {
    }


    public async createTables(): Promise<boolean> {
        try {
            const allTables = await this.db.listTables();

            let tableExistingCount = 0;
            for (const table in TABLES) {
                if (allTables.includes(table)) {
                    tableExistingCount++;
                }
            }

            if (tableExistingCount > 0 && tableExistingCount < Object.keys(TABLES).length) {
                return false;
            }

            if (tableExistingCount > 0 && tableExistingCount === Object.keys(TABLES).length) {
                return true;
            }

            await this.db.exec("BEGIN;");

            for (const table in TABLES) {
                const columns = TABLES[table].columns.join(",");
                const sql = `CREATE TABLE ${table} (${columns});`;

                await this.db.exec(sql);

                // Create indexes
                for (const idx in TABLES[table].indexes) {
                    const columns = TABLES[table].indexes[idx].columns.join(",");
                    const unique = TABLES[table].indexes[idx].unique ? "UNIQUE" : "";

                    const sql = `CREATE ${unique} INDEX ${idx} ON ${table}(${columns});`;

                    await this.db.exec(sql);
                }
            }

            await this.db.exec("COMMIT;");
        }
        catch(e) {
            await this.db.exec("ROLLBACK;");
            throw(e);
        }

        return true;
    }

    /**
     * The query in a read-transaction to guarantee from skewed data.
     *
     */
    public async fetch(fetchQuery: FetchQuery, now: number, handleFetchReplyData: HandleFetchReplyData) {
        let rootNode: BaseNodeInterface | undefined;

        if (fetchQuery.rootNodeId1.length > 0) {
            let errorReply: FetchReplyData | undefined;

            // Note we do not run this inside a read-transaction since it is not necessary.
            //
            [rootNode, errorReply] = await this.getRootNode(fetchQuery, now);

            if (errorReply) {
                handleFetchReplyData(errorReply);
                return;
            }

            assert(rootNode, "rootNode expected to be set");
        }

        // We wrap the read in a read-transaction to gurantee non-skewed
        // result.
        await this.db.exec("BEGIN;");

        try {
            const queryProcessor =
                new QueryProcessor(this.db, fetchQuery, rootNode, now, handleFetchReplyData);

            await queryProcessor.run();

            await this.db.exec("COMMIT;");
        }
        catch(e) {
            await this.db.exec("ROLLBACK;");
            throw e;
        }
    }

    /**
     * Get a root node node by its id1.
     *
     * The node is not allowed to be licensed (incl. rightsByAssociation, restrictiveWriter mode).
     *
     * This function does not need or manage its own read transaction.
     *
     * @returns node on success else FetchReplyData is set with error reply.
     */
    protected async getRootNode(fetchQuery: FetchQuery, now: number): Promise<[BaseNodeInterface | undefined, FetchReplyData | undefined]> {
        const node = await this.getNodeById1(fetchQuery.rootNodeId1, now);

        if (!node) {
            return [undefined, {
                status: Status.MissingRootnode,
                error: "The root node is not found but expected to exist.",
            }];
        }

        const flags = node.loadFlags();

        if (flags.isPublic) {
            return [node, undefined];
        }
        else if (flags.isLicensed) {
            return [undefined, {
                status: Status.RootnodeLicensed,
                error: "Licensed node cannot be used as root node.",
            }];
        }
        else if (flags.isBeginRestrictiveWriteMode) {
            return [undefined, {
                status: Status.RootnodeLicensed,
                error: "Begin restrictive writer mode node cannot be used as root node.",
            }];
        }
        else if (node.canSendPrivately(fetchQuery.sourcePublicKey, fetchQuery.targetPublicKey)) {
            return [node, undefined];
        }
        else if (flags.hasRightsByAssociation) {
            return [undefined, {
                status: Status.RootnodeLicensed,
                error: "Root node cannot use hasRightsByAssociation.",
            }];
        }
        else {
            return [undefined, {
                status: Status.NotAllowed,
                error: "Access to requested root node is not allowed.",
            }];
        }
    }

    /**
     * Fetch single node applying permissions.
     *
     * Note that any restrictive writer mode is ignored but which is
     * of no importance since we are directly asking for a specific node.
     *
     * This function does not need or manage its own read transaction.
     *
     * @returns node if permissions allow.
     */
    public async fetchSingleNode(nodeId1: Buffer, now: number, sourcePublicKey: Buffer, targetPublicKey: Buffer): Promise<BaseNodeInterface | undefined> {
        if (!Number.isInteger(now)) {
            throw new Error("now not integer");
        }

        const node = await this.getNodeById1(nodeId1, now);

        if (node) {
            const flags = node.loadFlags();

            if (flags.isPublic) {
                return node;
            }
            else if (flags.isLicensed || flags.hasRightsByAssociation) {

                const fetchRequest = ParseSchema(FetchRequestSchema, {query: {
                    sourcePublicKey,
                    targetPublicKey,
                    depth: MAX_LICENSE_DISTANCE,
                    match: [
                        {
                            nodeType: Buffer.alloc(0),
                            filters: []
                        }
                    ]
                }});

                const handleFetchReplyData: HandleFetchReplyData = () => {
                    // Do nothing.
                };

                const reverse = flags.hasRightsByAssociation ? ReverseFetch.ALL_PARENTS :
                    ReverseFetch.ONLY_LICENSED;

                const queryProcessor =
                    new QueryProcessor(this.db, fetchRequest.query, node, now,
                        handleFetchReplyData, reverse);

                await queryProcessor.run();

                const nodes = (await queryProcessor.filterPermissions([node])).nodes;

                return nodes[0];
            }
            else if (node.canSendPrivately(sourcePublicKey, targetPublicKey)) {
                return node;
            }
        }

        return undefined;
    }

    /**
     * Get single node on id1, preserve transient values.
     *
     * This function does not need or manage its own read transaction.
     *
     * @param nodeId1 the ID1 of the node.
     */
    public async getNodeById1(nodeId1: Buffer, now: number): Promise<BaseNodeInterface | undefined> {
        const ph = this.db.generatePlaceholders(1);

        if (!Number.isInteger(now)) {
            throw new Error("now not integer");
        }

        const now2 = now + NOW_TOLERANCE;

        const sql = `SELECT image, storagetime FROM openodin_nodes
            WHERE id1 = ${ph} AND (expiretime IS NULL OR expiretime > ${now})
            AND creationTime <= ${now2} LIMIT 1;`;

        const row = await this.db.get(sql, [nodeId1]);

        if (row) {
            const node = UnpackNode(row.image, true);

            node.getProps().transientStorageTime = row.storagetime;

            return node;
        }

        return undefined;
    }

    /**
     * Get list of nodes on their id1s, preserve transient values.
     *
     * Nodes not found are ignored, no error is thrown on not found.
     *
     * This function preserves the order of returned nodes with given (found) id1s.
     *
     * This function does not need or manage its own read transaction.
     *
     * @param id1s the ID1s of the nodes.
     */
    public async getNodesById1(id1s: Buffer[], now: number): Promise<BaseNodeInterface[]> {
        if (id1s.length > MAX_BATCH_SIZE) {
            throw new Error("Overflow in batch size of id1s");
        }

        if (id1s.length === 0) {
            return [];
        }

        const ph = this.db.generatePlaceholders(id1s.length);

        if (!Number.isInteger(now)) {
            throw new Error("now not integer");
        }

        const now2 = now + NOW_TOLERANCE;

        const sql = `SELECT image, storagetime FROM openodin_nodes WHERE id1 IN ${ph}
            AND (expiretime IS NULL OR expiretime > ${now})
            AND creationTime <= ${now2};`;

        const rows = await this.db.all(sql, id1s);

        const nodes: BaseNodeInterface[] = [];

        const rowsLength = rows.length;
        for (let index=0; index<rowsLength; index++) {
            try {
                const row = rows[index];

                const node = UnpackNode(row.image, true);

                node.getProps().transientStorageTime = row.storagetime;

                nodes.push(node);
            }
            catch(e) {
                console.debug(e);
            }
        }

        const nodes2: BaseNodeInterface[] = [];

        // Preserve the order of nodes as given in id1s.
        const id1sLength = id1s.length;
        for (let i=0; i<id1sLength; i++) {
            const id1 = id1s[i];
            const nodesLength = nodes.length;
            for (let i=0; i<nodesLength; i++) {
                const node = nodes[i];
                if ((node.getProps().id1 as Buffer).equals(id1)) {
                    nodes2.push(node);
                }
            }
        }

        return nodes2;
    }

    /**
     * Get list of nodes on their ids (id2 || id1), preserve transient values.
     *
     * Nodes not found are ignored, no error is thrown on not found.
     *
     * This function does not preserve the order of nodes as given in the arguments.
     *
     * This function does not need or manage its own read transaction.
     *
     * @param ids the IDs of the nodes.
     */
    public async getNodesById(ids: Buffer[], now: number): Promise<BaseNodeInterface[]> {
        if (ids.length > MAX_BATCH_SIZE) {
            throw new Error("Overflow in batch size of ids");
        }

        if (ids.length === 0) {
            return [];
        }

        const ph = this.db.generatePlaceholders(ids.length);

        if (!Number.isInteger(now)) {
            throw new Error("now not integer");
        }

        const now2 = now + NOW_TOLERANCE;

        const sql = `SELECT image, storagetime FROM openodin_nodes WHERE id IN ${ph}
            AND (expiretime IS NULL OR expiretime > ${now})
            AND creationTime <= ${now2};`;

        const rows = await this.db.all(sql, ids);

        const nodes: BaseNodeInterface[] = [];

        const rowsLength = rows.length;
        for (let index=0; index<rowsLength; index++) {
            try {
                const row = rows[index];

                const node = UnpackNode(row.image, true);

                node.getProps().transientStorageTime = row.storagetime;

                nodes.push(node);
            }
            catch(e) {
                console.debug(e);
            }
        }

        return nodes;
    }

    public async getExpiredNodeId1s(now: number, limit: number = 1000): Promise<Buffer[]> {
        if (!Number.isInteger(now)) {
            throw new Error("now not integer");
        }

        const sql = `SELECT id1 FROM openodin_nodes WHERE
            expiretime IS NOT NULL AND expiretime <= ${now} LIMIT ${limit}`;

        const rows = await this.db.all(sql);

        const id1s = rows.map( row => row.id1 as Buffer );

        return id1s;
    }

    /**
     *
     * This function wraps the calls inside a transaction.
     *
     * @returns [id1s, parentIds, blobId1s]
     * blobId1s are the node ID1s of the nodes who have blobs and are stored (or already stored).
     * @throws on error
     * If the exception indicates a BUSY error then the caller should retry the store.
     * This can happen for concurrent transaction between processes.
     */
    public async store(nodes: BaseNodeInterface[], now: number, preserveTransient: boolean = false): Promise<[Buffer[], Buffer[], Buffer[]]> {
        if (nodes.length > MAX_BATCH_SIZE) {
            throw new Error(`Calling store with too many (${nodes.length} nodes), maximum allowed is ${MAX_BATCH_SIZE}.`);
        }

        if (!Number.isInteger(now)) {
            throw new Error("now not integer");
        }

        if (nodes.length === 0) {
            return [[], [], []];
        }

        await this.db.exec("BEGIN;");

        try {
            const nonDestroyedNodes = await this.filterDestroyed(nodes);

            const nodesToStoreMaybe =
                await this.filterUnique(nonDestroyedNodes);

            const nodesToStore =
                await this.filterExisting(nodesToStoreMaybe, preserveTransient);

            // Extract all node Id1s and parentIds of those inserted.
            //
            const id1Map: {[id1: string]: Buffer} = {};
            const parentIdMap: {[parentId: string]: Buffer} = {};
            const blobId1sMap: {[id1: string]: Buffer} = {};

            const nodesToStoreLength = nodesToStore.length;
            for (let index=0; index<nodesToStoreLength; index++) {
                const node = nodesToStore[index];
                const id1 = node.getProps().id1;
                const parentId = node.getProps().parentId;

                if (!id1 || !parentId) {
                    continue;
                }

                id1Map[id1.toString("hex")] = id1;
                parentIdMap[parentId.toString("hex")] = parentId;
            }

            const nodesToStoreMaybeLength = nodesToStoreMaybe.length;
            for (let i=0; i<nodesToStoreMaybeLength; i++) {
                const node = nodesToStoreMaybe[i];
                const id1 = node.getProps().id1;

                if (id1 && BaseDataNode.Is(node.getProps().modelType) && (node as BaseDataNodeInterface).getProps().blobHash) {
                    blobId1sMap[id1.toString("hex")] = id1;
                }
            }

            // Find all bottom nodes, those are nodes who are never referred to as parentId.
            // These nodes are the basis of updating the cache timestamp of the graph upwards.
            //
            // Also take not of all license nodes so we can bump related nodes.
            //
            const bottomNodeParentIds: {[parentId: string]: Buffer} = {};
            const licenseNodes: LicenseNode[] = [];

            for (let index=0; index<nodesToStoreLength; index++) {
                const node = nodesToStore[index];
                const id = node.getProps().id;

                // Is this node not refered to as parent?
                // This this node is at the bottom of the inserted graph fragment.
                //
                if (id && !parentIdMap[id.toString("hex")]) {
                    const parentId = node.getProps().parentId;

                    if (parentId) {
                        const parentIdStr = parentId.toString("hex");
                        // We will update the trail from the bottom node's parent.
                        // No point updating from the node it self since it is already fresh.
                        bottomNodeParentIds[parentIdStr] = parentId;
                    }
                }

                if (LicenseNode.Is(node.getProps().modelType)) {
                    const license = node as LicenseNode;
                    licenseNodes.push(license);
                }
            }

            if (licenseNodes.length > 0) {
                const bumpHashes = await this.getRelatedBumpHashes(licenseNodes, now);

                const bumpNodeParentIds = await this.bumpNodes(bumpHashes, now);

                const bumpNodeIdsLength = bumpNodeParentIds.length;
                for (let i=0; i<bumpNodeIdsLength; i++) {
                    const bumpNodeParentId = bumpNodeParentIds[i];
                    bottomNodeParentIds[bumpNodeParentId.toString("hex")] = bumpNodeParentId;
                }
            }

            await this.storeNodes(nodesToStore, now, preserveTransient);

            await this.freshenParentTrail(Object.values(bottomNodeParentIds), now);

            await this.db.exec("COMMIT;");

            return [
                Object.values(id1Map),
                Object.values(parentIdMap),
                Object.values(blobId1sMap)
            ];
        }
        catch(e) {
            console.error(e);
            await this.db.exec("ROLLBACK;");
            throw e;
        }
    }

    /**
     * Bump a data node carrying a blob.
     * Call this when the blob has finalized and exists to trigger peers to download the blob.
     */
    public async bumpBlobNode(node: BaseNodeInterface, now: number) {
        if (!Number.isInteger(now)) {
            throw new Error("now not integer");
        }

        const id1 = node.getProps().id1;
        const parentId = node.getProps().parentId;

        if (!id1 || !parentId) {
            return;
        }

        const ph = this.db.generatePlaceholders(1);

        const sql = `UPDATE openodin_nodes
            SET updatetime=${now}, trailupdatetime=${now}
            WHERE id1=${ph};`;

        await this.db.run(sql, [id1]);

        await this.freshenParentTrail([parentId], now);
    }

    /**
     * @returns array of bumpHashes, array of parent ids
     */
    protected async getRelatedBumpHashes(licenseNodes: LicenseNodeInterface[], now: number): Promise<Buffer[]> {
        const bumpHashes: Buffer[] = [];

        const distinctHashes: {[hash: string]: Buffer} = {};

        const licenseNodesLength = licenseNodes.length;

        for (let i=0; i<licenseNodesLength; i++) {
            const licenseNode = licenseNodes[i];

            const hashes = licenseNode.getLicensingHashes();

            const hashesLength = hashes.length;
            for (let i2=0; i2<hashesLength; i2++) {
                const hash = hashes[i2];
                distinctHashes[hash.toString("hex")] = hash;
            }
        }

        const licenseRows = await this.checkLicenses(Object.values(distinctHashes), now);

        for (let i=0; i<licenseNodesLength; i++) {
            const licenseNode = licenseNodes[i];

            const hashes = licenseNode.getLicensingHashes();

            const hashesLength = hashes.length;
            for (let index=0; index<hashesLength; index++) {
                const hashStr = hashes[index].toString("hex");
                if (!licenseRows[hashStr]) {
                    bumpHashes.push(HashList([licenseNode.getProps().refId, licenseNode.getProps().parentId]));
                    break;
                }
            }
        }

        return bumpHashes;
    }

    /**
     * From the given node IDs update the caching timestamp from there and upwards in the graph.
     * Note that since the fetch is done in reverse the node(s) having their ID equal to the
     * parentId of the query are included in the resultset.
     *
     * It is expected there is a surrounding transaction in play.
     *
     * @param parentIds update from these nodes and upwards.
     * @param now time to set as updated time
     * @param depth default (and maximum) of MAX_FRESHEN_DEPTH levels up is updated for trailupdatetime.
     * The count is from the nodes below the given parent node, meaning that
     * a value of 1 updates only the parent nodes given by parentIds.
     * a value of 0 does nothing.
     */
    protected async freshenParentTrail(parentIds: Buffer[], now: number, depth: number = MAX_FRESHEN_DEPTH) {
        // Note: if inserts are very scattered then this function might need optimization
        // reusing the graph state.

        depth = Math.min(depth, MAX_FRESHEN_DEPTH);

        const id1s: {[id1: string]: Buffer} = {};

        const handleFetchReplyData: HandleFetchReplyData = (fetchReplyData: FetchReplyData) => {
            const nodes = fetchReplyData.nodes ?? [];

            const nodesLength = nodes.length;
            for (let i=0; i<nodesLength; i++) {
                const node = nodes[i];

                const id1 = node.getProps().id1 as Buffer;
                const id1Str = id1.toString("hex");
                id1s[id1Str] = id1;
            }
        };

        const nodeIdsLength = parentIds.length;
        for (let i=0; i<nodeIdsLength; i++) {
            const nodeId = parentIds[i];

            const fetchRequest = ParseSchema(FetchRequestSchema, {query: {
                parentId: nodeId,
                depth,
                match: [
                    {
                        nodeType: Buffer.alloc(0),
                        filters: [],
                    }
                ]
            }});

            // Setup the QueryProcessor to fetch in reverse, skipping permissions enforcement.
            //
            const queryProcessor =
                new QueryProcessor(this.db, fetchRequest.query, undefined, now,
                    handleFetchReplyData, ReverseFetch.ALL_PARENTS);

            await queryProcessor.run();
        }

        await this.setTrailUpdateTime(Object.values(id1s), now);
    }

    /**
     * It is expected there is a surrounding transaction in play.
     * Ignore inactive license nodes.
     */
    protected async checkLicenses(licenseHashes: Buffer[], now: number): Promise<{[hash: string]: boolean}> {
        const hashesFound: {[hash: string]: boolean} = {};

        if (!Number.isInteger(now)) {
            throw new Error("now not integer");
        }

        const now2 = now + NOW_TOLERANCE;

        while (licenseHashes.length > 0) {
            const hashes = licenseHashes.splice(0, MAX_BATCH_SIZE);

            const ph = this.db.generatePlaceholders(hashes.length);

            const sql = `SELECT hash
            FROM openodin_licensing_hashes AS hashes, openodin_nodes AS nodes
            WHERE hashes.hash IN ${ph} AND hashes.id1 = nodes.id1 AND
            (nodes.expiretime IS NULL OR nodes.expiretime > ${now})
            AND nodes.creationTime <= ${now2} AND nodes.isinactive = 0;`;

            try {
                const rows = await this.db.all(sql, hashes);

                const rowsLength = rows.length;
                for (let index=0; index<rowsLength; index++) {
                    const row = rows[index];
                    const hashStr = row.hash.toString("hex");
                    hashesFound[hashStr] = true;
                }
            }
            catch(e) {
                console.debug("checkLicenses", e);
                return {};
            }
        }

        return hashesFound;
    }

    /**
     * Filter out nodes for which there are destroy hashes present.
     *
     * This function does not manage its own transaction.
     *
     * @returns list of nodes not destroyed.
     */
    protected async filterDestroyed(nodes: BaseNodeInterface[]): Promise<BaseNodeInterface[]> {
        const allHashes: Buffer[] = [];

        const nodesLength = nodes.length;
        for (let index=0; index<nodesLength; index++) {
            const node = nodes[index];
            allHashes.push(...node.getAchillesHashes());
        }

        if (allHashes.length === 0) {
            return nodes;
        }

        const ph = this.db.generatePlaceholders(allHashes.length);

        const sql = `SELECT COUNT(dh.hash), nodes.id1 AS id1
            FROM openodin_destroy_hashes AS dh, openodin_nodes as nodes
            WHERE dh.hash IN ${ph} AND dh.id1 = nodes.id1 GROUP BY nodes.id1;`;

        const destroyed: {[hash: string]: boolean} = {};

        const rows = await this.db.all(sql, allHashes);

        const rowsLength = rows.length;
        for (let index=0; index<rowsLength; index++) {
            const row = rows[index];
            const id1 = row.id1 as Buffer;
            const id1Str = id1.toString("hex");
            destroyed[id1Str] = true;
        }

        return nodes.filter( (node: BaseNodeInterface) => {
            const id1 = node.getProps().id1 as Buffer;
            const id1Str = id1.toString("hex");
            return !destroyed[id1Str];
        });
    }

    /**
     * Filter out already existing nodes and return nodes not existing in underlaying storage.
     *
     * This function does not manage its own transaction.
     *
     * @param nodes
     * @param preserveTransient if true then nodes are considered non-existing in the storage
     *  if their transient hashes differ from the stored nodes transient hashes.
     *  This is to allow updating of nodes transient hashes even if the node it self already exists.
     *
     * @return list of nodes not existing in the database (incl. w/ different transient hash).
     *
     * @throws on error.
     */
    protected async filterExisting(nodes: BaseNodeInterface[], preserveTransient: boolean = false): Promise<BaseNodeInterface[]> {
        const toKeep: {[id1: string]: {transientHash: Buffer | undefined, keep: boolean}} = {};

        if (nodes.length === 0) {
            return [];
        }

        const id1s: Buffer[] = [];

        const nodesLength = nodes.length;
        for (let index=0; index<nodesLength; index++) {
            const node = nodes[index];
            const id1 = node.getProps().id1 as Buffer;
            const id1Str = id1.toString("hex");

            const transientHash = preserveTransient ? node.hashTransient() : undefined;

            toKeep[id1Str] = {
                transientHash,
                keep: true,
            }

            id1s.push(id1);
        }

        const ph = this.db.generatePlaceholders(id1s.length);

        const sql = `SELECT id1, transienthash from openodin_nodes WHERE id1 IN ${ph};`;

        const rows = await this.db.all(sql, id1s);

        const rowsLength = rows.length;
        for (let index=0; index<rowsLength; index++) {
            const row = rows[index];
            const id1Str = (row.id1 as Buffer).toString("hex");
            const nodeObj = toKeep[id1Str];

            if (nodeObj.transientHash &&
                !nodeObj.transientHash.equals(row.transienthash ?? Buffer.alloc(0))) {
                // Keep since transient hashes differ
                continue;
            }

            nodeObj.keep = false;
        }

        return nodes.filter( (node: BaseNodeInterface) => {
            const id1Str = (node.getProps().id1 as Buffer).toString("hex");
            return toKeep[id1Str].keep;
        });
    }

    /**
     * Filter out nodes flagged as unique who's equivalent already exists in the database.
     *
     * A match on uniqueHashes but where also the id1s are equals is not treated
     * as a clash and such a node is not filterd out but returned instead.
     * This is necessary if a store is updating the transient value of an already
     * existing node which also isUnique.
     *
     * This function does not manage its own transaction.
     *
     * @return list of nodes not having unique equivalent already existing.
     *
     * @throws on error.
     */
    protected async filterUnique(nodes: BaseNodeInterface[]): Promise<BaseNodeInterface[]> {
        const unique_hashes: Buffer[] = [];

        const nodesLength = nodes.length;
        for (let index=0; index<nodesLength; index++) {
            const node = nodes[index];

            if (node.loadFlags().isUnique) {
                unique_hashes.push(node.uniqueHash());
            }
        }

        if (unique_hashes.length === 0) {
            return nodes;
        }

        const ph = this.db.generatePlaceholders(unique_hashes.length);

        const sql = `SELECT id1, uniquehash from openodin_nodes WHERE uniquehash IN ${ph};`;

        const rows = await this.db.all(sql, unique_hashes);

        const exists: {[hash: string]: Buffer} = {};

        const rowsLength = rows.length;
        for (let index=0; index<rowsLength; index++) {
            const row = rows[index];
            const uniqueHashStr = (row.uniquehash as Buffer).toString("hex");
            exists[uniqueHashStr] = row.id1;
        }

        return nodes.filter( (node: BaseNodeInterface) => {
            if (node.loadFlags().isUnique) {
                const uniqueHashStr = node.uniqueHash().toString("hex");

                if (!exists[uniqueHashStr]) {
                    return true;
                }

                return exists[uniqueHashStr].equals(node.getProps().id1 as Buffer);
            }

            return true;
        });
    }

    /**
     * Store nodes and associated data.
     *
     * All nodes are inserted into `nodes` table, and every node not flagged as `indestructable` also has their
     * achilles hashes put into the `achilles_hash` table.
     *
     * License nodes have their hashes inserted into the `licensing_hashes` table.
     *
     * Special Data destroy nodes have their hashes inserted into the `destroy_hashes` table.
     *
     * Special Data friend cert bearer nodes have their embedded certs inserted into the `friend_certs` table.
     *
     * This function expects to be already within a transaction.
     *
     * @throws on error
     */
    protected async storeNodes(nodes: BaseNodeInterface[], now: number,
        preserveTransient: boolean = false)
    {
        const destroyHashes = this.extractDestroyHashes(nodes);

        const achillesHashes = this.extractAchillesHashes(nodes);

        const friendCerts = this.extractFriendCerts(nodes);

        const licensingHashes = this.extractLicensingHashes(nodes);

        if (destroyHashes.length > 0) {
            await this.insertDestroyHashes(destroyHashes);
        }

        if (achillesHashes.length > 0) {
            await this.insertAchillesHashes(achillesHashes);
        }

        if (friendCerts.length > 0) {
            await this.insertFriendCerts(friendCerts);
        }

        if (licensingHashes.length > 0) {
            await this.insertLicensingHashes(licensingHashes);
        }

        await this.insertNodes(nodes, now, preserveTransient);
    }

    protected extractDestroyHashes(nodes: BaseNodeInterface[]): InsertDestroyHash[] {
        const destroyHashes: InsertDestroyHash[] = [];

        const nodesLength = nodes.length;
        for (let i=0; i<nodesLength; i++) {
            const node = nodes[i];

            if (!BaseDataNode.Is(node.getProps().modelType)) {
                continue;
            }

            const baseDataNode = node as BaseDataNodeInterface;

            const flags = baseDataNode.loadFlags();

            if (!flags.isDestroy || flags.isInactive) {
                continue;
            }

            const id1 = baseDataNode.getProps().id1;
            const owner = baseDataNode.getProps().owner;
            const refId = baseDataNode.getProps().refId;

            if (id1 && owner && refId) {
                destroyHashes.push({
                    id1,
                    hash: HashList([Buffer.from("destroy"), owner, refId]),
                });
            }
        }

        return destroyHashes;
    }

    protected extractAchillesHashes(nodes: BaseNodeInterface[]): InsertAchillesHash[] {
        const achillesHashes: InsertAchillesHash[] = [];

        const nodesLength = nodes.length;
        for (let i=0; i<nodesLength; i++) {
            const node = nodes[i];
            const id1 = node.getProps().id1 as Buffer;

            const hashes = node.getAchillesHashes();

            const hashesLength = hashes.length;

            for (let index=0; index<hashesLength; index++) {
                achillesHashes.push({
                    id1,
                    hash: hashes[index],
                });
            }
        }

        return achillesHashes;
    }

    protected extractFriendCerts(nodes: BaseNodeInterface[]): InsertFriendCert[] {
        const friendCerts: InsertFriendCert[] = [];

        const nodesLength = nodes.length;
        for (let i=0; i<nodesLength; i++) {
            const node = nodes[i];

            if (!CarrierNode.Is(node.getProps().modelType)) {
                continue;
            }

            const carrierNode = node as CarrierNodeInterface;

            if (carrierNode.loadFlags().isInactive) {
                continue;
            }

            if (!carrierNode.getProps().friendCert) {
                continue;
            }

            const friendCert = carrierNode.loadFriendCert();

            const id1 = carrierNode.getId1();
            const owner = friendCert.getProps().owner;
            const constraints = friendCert.getProps().constraints;

            if (id1 && owner && constraints) {
                friendCerts.push({
                    id1,
                    owner,
                    constraints,
                    image: friendCert.getPacked(),
                });
            }
        }

        return friendCerts;
    }

    protected extractLicensingHashes(nodes: BaseNodeInterface[]): InsertLicensingHash[] {
        const licensingHashes: InsertLicensingHash[] = [];

        const nodesLength = nodes.length;
        for (let i=0; i<nodesLength; i++) {
            const node = nodes[i];
            const id1 = node.getProps().id1 as Buffer;

            if (!BaseLicenseNode.Is(node.getProps().modelType)) {
                continue;
            }

            const license = node as BaseLicenseNodeInterface;
            const hashes = license.getLicensingHashes();

            const hashesLength = hashes.length;
            for (let index=0; index<hashesLength; index++) {

                const flags = license.loadFlags();

                licensingHashes.push({
                    id1,
                    hash: hashes[index],
                    disallowretrolicensing: flags.disallowRetroLicensing ? 1 : 0,
                    parentpathhash: license.getProps().parentPathHash,
                    restrictivemodewriter: flags.restrictiveModeWriter ? 1 : 0,
                    restrictivemodemanager: flags.restrictiveModeManager ? 1 : 0,
                });
            }
        }

        return licensingHashes;
    }

    /**
     * Insert achilles hashes.
     *
     * It is expected there is a surrounding transaction in play.
     *
     * @throws on error
     */
    protected async insertAchillesHashes(achillesHashes: InsertAchillesHash[]): Promise<void> {
        if (achillesHashes.length === 0) {
            return;
        }

        const params: Buffer[] = [];

        const length = achillesHashes.length;
        for (let index=0; index<length; index++) {
            const obj = achillesHashes[index];
            params.push(obj.id1, obj.hash);
        }

        const ph = this.db.generatePlaceholders(2, achillesHashes.length);

        await this.db.run(`INSERT INTO openodin_achilles_hashes (id1, hash) VALUES ${ph};`, params);
    }

    /**
     * Insert licensing hashes.
     *
     * It is expected there is a surrounding transaction in play.
     *
     * @throws on error
     */
    protected async insertLicensingHashes(licensingHashes: InsertLicensingHash[]): Promise<void> {
        if (licensingHashes.length === 0) {
            return;
        }

        const params: any[] = [];

        const length = licensingHashes.length;
        for (let index=0; index<length; index++) {
            const obj = licensingHashes[index];
            params.push(obj.id1,
                obj.hash,
                obj.disallowretrolicensing,
                obj.parentpathhash ?? null,
                obj.restrictivemodewriter,
                obj.restrictivemodemanager,
            );
        }

        const ph = this.db.generatePlaceholders(6, licensingHashes.length);

        await this.db.run(`INSERT INTO openodin_licensing_hashes
            (id1, hash, disallowretrolicensing, parentpathhash, restrictivemodewriter, restrictivemodemanager) VALUES ${ph};`,
            params);
    }

    /**
     * Insert destroy hashes.
     *
     * It is expected there is a surrounding transaction in play.
     *
     * @throws on error
     */
    protected async insertDestroyHashes(destroyHashes: InsertDestroyHash[]): Promise<void> {
        if (destroyHashes.length === 0) {
            return;
        }

        const allHashes: Buffer[] = [];

        const params: Buffer[] = [];

        const length = destroyHashes.length;

        for (let index=0; index<length; index++) {
            const obj = destroyHashes[index];

            params.push(obj.id1, obj.hash);

            allHashes.push(obj.hash);
        }

        const ph = this.db.generatePlaceholders(2, destroyHashes.length);

        await this.db.run(`INSERT INTO openodin_destroy_hashes (id1, hash) VALUES ${ph};`, params);

        const ph2 = this.db.generatePlaceholders(allHashes.length);

        const sql = `SELECT nodes.id1 AS id1
            FROM openodin_achilles_hashes AS ah, openodin_nodes as nodes
            WHERE ah.hash IN ${ph2} AND ah.id1 = nodes.id1 GROUP BY nodes.id1;`;

        const rows = await this.db.all(sql, allHashes);

        const id1s = rows.map( row => row.id1 as Buffer );

        await this.deleteNodesInner(id1s);
    }

    /**
     * Insert friend certs.
     *
     * It is expected there is a surrounding transaction in play.
     *
     * @throws on error
     */
    protected async insertFriendCerts(friendCerts: InsertFriendCert[]): Promise<void> {
        if (friendCerts.length === 0) {
            return;
        }

        const params: Buffer[] = [];

        const length = friendCerts.length;
        for (let index=0; index<length; index++) {
            const obj = friendCerts[index];
            params.push(obj.owner, obj.constraints, obj.image, obj.id1);
        }

        const ph = this.db.generatePlaceholders(4, friendCerts.length);

        await this.db.run(`INSERT INTO openodin_friend_certs (owner, constraints, image, id1)
            VALUES ${ph};`, params);
    }

    /**
     * Insert nodes.
     * It is expected there is a surrounding transaction in play.
     *
     * @throws on error
     */
    protected async insertNodes(nodes: BaseNodeInterface[], now: number,
        preserveTransient: boolean = false)
    {
        if (nodes.length === 0) {
            return;
        }

        if (!Number.isInteger(now)) {
            throw new Error("now not integer");
        }

        const params: any[] = [];


        const length = nodes.length;
        for (let index=0; index<length; index++) {
            const node = nodes[index];

            let bumpHash: Buffer | null = null;

            const flags = node.loadFlags();

            if (flags.isLicensed) {
                bumpHash = HashList([node.getProps().id1, node.getProps().parentId]);
            }
            else if (flags.hasRightsByAssociation) {
                bumpHash = HashList([node.getProps().refId, node.getProps().parentId]);
            }

            params.push(
                node.getProps().id1,
                node.getProps().id2 ?? null,
                node.getProps().id,
                node.getProps().parentId,
                node.getProps().creationTime,
                node.getProps().expireTime ?? null,
                node.getProps().region ?? null,
                node.getProps().jurisdiction ?? null,
                node.getProps().owner,
                preserveTransient && flags.isInactive ? 1 : 0,
                flags.isPublic ? 1 : 0,
                flags.isLicensed ? 1 : 0,
                flags.disallowParentLicensing ? 1 : 0,
                flags.isLeaf ? 1 : 0,
                node.getProps().difficulty ?? 0,
                flags.isUnique ? node.uniqueHash() : node.getProps().id1,  // if not unique then use id1 as placeholder
                preserveTransient ? node.hashTransient() : null,
                now,
                now,
                now,
                bumpHash,
                node.pack(preserveTransient));
        }

        const ph = this.db.generatePlaceholders(22, nodes.length);

        const sql = `INSERT INTO openodin_nodes
        (id1, id2, id, parentid, creationtime, expiretime, region, jurisdiction, owner,
        isinactive, ispublic, islicensed, disallowparentlicensing, isleaf, difficulty,
        uniquehash, transienthash, storagetime, updatetime, trailupdatetime, bumphash, image)
        VALUES ${ph} ` + (preserveTransient ? `
        ON CONFLICT (id1) DO UPDATE SET
        transienthash=excluded.transienthash,
        updatetime=excluded.updatetime,
        trailupdatetime=excluded.trailupdatetime,
        isinactive=excluded.isinactive,
        image=excluded.image;` :
        `ON CONFLICT (id1) DO NOTHING;`);

        await this.db.run(sql, params);
    }

    /**
     * It is expected there is a surrounding transaction in play.
     */
    protected async setTrailUpdateTime(id1s: Buffer[], now: number): Promise<void> {
        if (id1s.length === 0) {
            return;
        }

        if (!Number.isInteger(now)) {
            throw new Error("now not integer");
        }


        const ph = this.db.generatePlaceholders(id1s.length);

        const sql = `UPDATE openodin_nodes SET trailupdatetime=${now} WHERE id1 IN ${ph};`;

        await this.db.run(sql, id1s);
    }

    /**
     * It is expected there is a surrounding transaction in play.
     *
     * @returns bumped nodes parent ids
     */
    protected async bumpNodes(bumpHashes: Buffer[], now: number): Promise<Buffer[]> {
        if (bumpHashes.length === 0) {
            return [];
        }

        if (!Number.isInteger(now)) {
            throw new Error("now not integer");
        }

        const ph = this.db.generatePlaceholders(bumpHashes.length);

        const sql = `UPDATE openodin_nodes
            SET updatetime=${now}, trailupdatetime=${now}
            WHERE bumphash IN ${ph}
            RETURNING parentid;`;

        const rows = await this.db.all(sql, bumpHashes);

        return rows.map( row => row.parentid );
    }

    public async deleteNodes(id1s: Buffer[]) {
        await this.db.exec("BEGIN;");

        try {
            await this.deleteNodesInner(id1s);
        }
        catch(e) {
            await this.db.exec("ROLLBACK;");
            throw e;
        }

        await this.db.exec("COMMIT;");
    }

    /**
     * This function expects there is a surrounding transaction in play which will be committed.
     */
    protected async deleteNodesInner(id1s: Buffer[]) {
        const id1sb = id1s.slice();

        while (id1sb.length > 0) {
            const id1s = id1sb.splice(0, MAX_BATCH_SIZE);

            const ph = this.db.generatePlaceholders(id1s.length);

            await this.db.run(`DELETE FROM openodin_nodes AS t WHERE t.id1 IN ${ph};`, id1s);

            await this.db.run(`DELETE FROM openodin_achilles_hashes AS t WHERE t.id1 IN ${ph};`, id1s);

            await this.db.run(`DELETE FROM openodin_licensing_hashes AS t WHERE t.id1 IN ${ph};`, id1s);

            await this.db.run(`DELETE FROM openodin_destroy_hashes AS t WHERE t.id1 IN ${ph};`, id1s);

            await this.db.run(`DELETE FROM openodin_friend_certs AS t WHERE t.id1 IN ${ph};`, id1s);
        }
    }

    /** Notify when the underlaying database connection closes. */
    public onClose(fn: () => void) {
        this.db.on("close", fn);
    }

    /** Deregister onClose callback. */
    public offClose(fn: () => void) {
        this.db.off("close", fn);
    }

    /** Notify when there is an error in the underlaying database connection. */
    public onError(fn: (err: Error) => void) {
        this.db.on("error", fn);
    }

    public offError(fn: (err: Error) => void) {
        this.db.off("error", fn);
    }

    public async close() {
        return this.db.close();
    }
}
