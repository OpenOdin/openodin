/**
 * A stateless driver over SQLite or PostgreSQL meant to efficiently drive data
 * from the underlying database.
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

import blake2b from "blake2b"

import { strict as assert } from "assert";

import {
    DriverInterface,
    BlobDriverInterface,
    FetchReplyData,
    HandleFetchReplyData,
    TABLES,
    InsertAchillesHash,
    InsertLicenseeHash,
    InsertDestroyHash,
    InsertFriendCert,
    MIN_DIFFICULTY_TOTAL_DESTRUCTION,
    BLOB_FRAGMENT_SIZE,
} from "./types";

import {
    FetchQuery,
    Status,
    MAX_LICENSE_DISTANCE,
} from "../types";

import {
    DBClient,
} from "./DBClient";

import {
    QueryProcessor,
    ReverseFetch,
} from "./QueryProcessor";

import {
    NodeInterface,
    License,
    FriendCert,
    FriendCertInterface,
    Data,
    DataInterface,
    SPECIAL_NODES,
    Hash,
} from "../datamodel";

import {
    Decoder,
} from "../datamodel/decoder";

import {
    StorageUtil,
} from "../util/StorageUtil";

/**
 * How parents up from inserted/bumped nodes to update the trailupdatetime.
 * 1 means update only the parent nodes.
 * 0 does not update anything.
 */
const MAX_FRESHEN_DEPTH = 10;

/**
 * @see DriverInterface and BlobDriverInterface for details on public functions.
 */
export class Driver implements DriverInterface, BlobDriverInterface {
    constructor(
        protected readonly db: DBClient,
        protected readonly blobDb?: DBClient,
    ) {}

    public async init() {
    }

    public async createTables() {
        try {
            await this.db.exec("BEGIN;");

            const allTables = await this.db.listTables();

            for (const table in TABLES) {
                if (allTables.includes(table)) {
                    throw new Error(`Table ${table} already exists. Aborting.`);
                }
            }

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
            this.db.exec("ROLLBACK;");
            throw(e);
        }
    }

    public async fetch(fetchQuery: FetchQuery, now: number, handleFetchReplyData: HandleFetchReplyData) {
        let rootNode: NodeInterface | undefined;

        if (fetchQuery.rootNodeId1.length > 0) {
            let errorReply: FetchReplyData | undefined;

            [rootNode, errorReply] = await this.getRootNode(fetchQuery, now);

            if (errorReply) {
                handleFetchReplyData(errorReply);
                return;
            }

            assert(rootNode);
        }

        const queryProcessor = 
            new QueryProcessor(this.db, fetchQuery, rootNode, now, handleFetchReplyData);

        await queryProcessor.run();
    }

    /**
     * Get a root node node by its id1.
     *
     * The node is not allowed to be licensed (incl. rightsByAssociation, restrictiveWriter mode).
     *
     * @returns node on success else FetchReplyData is set with error reply.
     */
    protected async getRootNode(fetchQuery: FetchQuery, now: number): Promise<[NodeInterface | undefined, FetchReplyData | undefined]> {
        const node = await this.getNodeById1(fetchQuery.rootNodeId1, now);

        if (!node) {
            return [undefined, {
                status: Status.MISSING_ROOTNODE,
                error: "The root node is not found but expected to exist.",
            }];
        }

        if (node.isPublic()) {
            return [node, undefined];
        }
        else if (node.isLicensed()) {
            return [undefined, {
                status: Status.ROOTNODE_LICENSED,
                error: "Licensed node cannot be used as root node.",
            }];
        }
        else if (node.isBeginRestrictiveWriteMode()) {
            return [undefined, {
                status: Status.ROOTNODE_LICENSED,
                error: "Begin restrictive writer mode node cannot be used as root node.",
            }];
        }
        else if (node.canSendPrivately(fetchQuery.clientPublicKey, fetchQuery.targetPublicKey)) {
            return [node, undefined];
        }
        else if (node.hasRightsByAssociation()) {
            return [undefined, {
                status: Status.ROOTNODE_LICENSED,
                error: "Root node cannot use hasRightsByAssociation.",
            }];
        }
        else {
            return [undefined, {
                status: Status.NOT_ALLOWED,
                error: "Access to requested root node is not allowed.",
            }];
        }
    }

    /**
     * Fetch single node applying permissions.
     *
     * Note that any restrictive writer mode is ignored.
     * This is of less importance since we are asking for a specific node.
     *
     * @returns node if permissions allow.
     */
    public async fetchSingleNode(nodeId1: Buffer, now: number, clientPublicKey: Buffer, targetPublicKey: Buffer): Promise<NodeInterface | undefined> {

        if (!Number.isInteger(now)) {
            throw new Error("now not integer");
        }

        const node = await this.getNodeById1(nodeId1, now);

        if (node) {
            if (node.isPublic()) {
                return node;
            }
            else if (node.isLicensed() || node.hasRightsByAssociation()) {

                const fetchRequest = StorageUtil.CreateFetchRequest({query: {
                    clientPublicKey,
                    targetPublicKey,
                    depth: MAX_LICENSE_DISTANCE,
                    match: [
                        {
                            nodeType: Buffer.alloc(0),
                            filters: []
                        }
                    ]
                }});

                const handleFetchReplyData: HandleFetchReplyData = (fetchReplyData: FetchReplyData) => {
                    // Do nothing.
                };

                const reverse = node.hasRightsByAssociation() ? ReverseFetch.ALL_PARENTS :
                    ReverseFetch.ONLY_LICENSED;

                const queryProcessor =
                    new QueryProcessor(this.db, fetchRequest.query, node, now,
                        handleFetchReplyData, reverse);

                await queryProcessor.run();

                const nodes = (await queryProcessor.filterPermissions([node])).nodes;

                return nodes[0];
            }
            else {
                if (targetPublicKey) {
                    if (node.canSendPrivately(clientPublicKey, targetPublicKey)) {
                        return node;
                    }
                }
                else if (node.canHoldPrivately(clientPublicKey)) {
                    return node;
                }
            }
        }

        return undefined;
    }

    /**
     * Get single node on id1, preserve transient values.
     *
     * @param nodeId the ID1 of the node.
     */
    protected async getNodeById1(nodeId1: Buffer, now: number): Promise<NodeInterface | undefined> {
        const ph = this.db.generatePlaceholders(1);

        if (!Number.isInteger(now)) {
            throw new Error("now not integer");
        }

        const sql = `SELECT image FROM universe_nodes
            WHERE id1=${ph} AND (expiretime IS NULL OR expiretime>${now}) LIMIT 1;`;

        const row = await this.db.get(sql, [nodeId1]);

        if (row) {
            return Decoder.DecodeNode(row.image, true);
        }

        return undefined;
    }

    /**
     * @returns [id1s, parentIds]
     * @throws on error
     */
    public async store(nodes: NodeInterface[], now: number, preserveTransient: boolean = false): Promise<[Buffer[], Buffer[]] | undefined> {
        if (nodes.length > 1000) {
            throw new Error(`Calling store with too many (${nodes.length} nodes), maximum allowed is 1000.`);
        }

        if (!Number.isInteger(now)) {
            throw new Error("now not integer");
        }

        await this.db.exec("BEGIN;");

        try {
            const nodesToStore = await this.filterDestroyed(
                await this.filterUnique(
                    await this.filterExisting(nodes, preserveTransient)));

            // Extract all node Id1s and parentIds of those inserted.
            //
            const id1Map: {[id1: string]: Buffer} = {};
            const parentIdMap: {[parentId: string]: Buffer} = {};

            const nodesToStoreLength = nodesToStore.length;
            for (let index=0; index<nodesToStoreLength; index++) {
                const node = nodesToStore[index];
                const id1 = node.getId1();
                const parentId = node.getParentId();

                if (!id1 || !parentId) {
                    continue;
                }

                id1Map[id1.toString("hex")] = id1;
                parentIdMap[parentId.toString("hex")] = parentId;
            }

            // Find all bottom nodes, those are nodes who are never referred to as parentId.
            // These nodes are the basis of updating the cache timestamp of the graph upwards.
            //
            // Also filter out all license nodes so we can bump related nodes.
            //
            const bottomNodeParentIds: {[parentId: string]: Buffer} = {};
            const licenseNodes: License[] = [];

            for (let index=0; index<nodesToStoreLength; index++) {
                const node = nodesToStore[index];
                const id = node.getId();

                // Is this node not refered to as parent?
                // This this node is at the bottom of the inserted graph fragment.
                //
                if (id && !parentIdMap[id.toString("hex")]) {
                    const parentId = node.getParentId();

                    if (parentId) {
                        const parentIdStr = parentId.toString("hex");
                        // We will update the trail from the bottom node's parent.
                        // No point updating from the node it self since it is already fresh.
                        bottomNodeParentIds[parentIdStr] = parentId;
                    }
                }

                if (node.getType(4).equals(License.GetType(4))) {
                    const license = node as License;
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

            return [Object.values(id1Map), Object.values(parentIdMap)];
        }
        catch(e) {
            await this.db.exec("ROLLBACK;");
            throw e;
        }
    }

    /**
     * @returns array of bumpHashes, array of parent ids
     */
    protected async getRelatedBumpHashes(licenseNodes: License[], now: number): Promise<Buffer[]> {
        const bumpHashes: Buffer[] = [];

        const distinctHashes: {[hash: string]: Buffer} = {};

        const licenseNodesLength = licenseNodes.length;

        for (let i=0; i<licenseNodesLength; i++) {
            const licenseNode = licenseNodes[i];

            const hashes = licenseNode.getLicenseeHashes();

            const hashesLength = hashes.length;
            for (let i2=0; i2<hashesLength; i2++) {
                const hash = hashes[i2];
                distinctHashes[hash.toString("hex")] = hash;
            }
        }

        const licenseRows = await this.checkLicenses(Object.values(distinctHashes), now);

        for (let i=0; i<licenseNodesLength; i++) {
            const licenseNode = licenseNodes[i];

            const hashes = licenseNode.getLicenseeHashes();

            const hashesLength = hashes.length;
            for (let index=0; index<hashesLength; index++) {
                const hashStr = hashes[index].toString("hex");
                if (!licenseRows[hashStr]) {
                    bumpHashes.push(Hash([licenseNode.getNodeId1(), licenseNode.getParentId()]));
                    break;
                }
            }
        }

        return bumpHashes;
    }

    /**
     * From the given node IDs update the caching timestamp from there and upwards in the graph.
     * Note that since the fetch is done in reverse the node(s) having their ID equal to the
     * parentId of the query are included * in the resultset.
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
            (fetchReplyData.nodes ?? []).forEach( node => {
                const id1 = node.getId1() as Buffer;
                const id1Str = id1.toString("hex");
                id1s[id1Str] = id1;
            });
        };

        const nodeIdsLength = parentIds.length;
        for (let i=0; i<nodeIdsLength; i++) {
            const nodeId = parentIds[i];

            const fetchRequest = StorageUtil.CreateFetchRequest({query: {
                parentId: nodeId,
                clientPublicKey: Buffer.alloc(0),
                targetPublicKey: Buffer.alloc(0),
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

    protected async checkLicenses(licenseHashes: Buffer[], now: number): Promise<{[hash: string]: boolean}> {

        const hashesFound: {[hash: string]: boolean} = {};

        if (!Number.isInteger(now)) {
            throw new Error("now not integer");
        }

        while (licenseHashes.length > 0) {
            const hashes = licenseHashes.splice(0, 1000);

            const ph = this.db.generatePlaceholders(hashes.length);

            const sql = `SELECT hash
            FROM universe_licensee_hashes AS hashes, universe_nodes AS nodes
            WHERE hashes.hash IN ${ph} AND hashes.id1 = nodes.id1 AND
            (nodes.expiretime IS NULL OR nodes.expiretime > ${now});`;

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
                console.error("checkLicenses", e);
                return {};
            }
        }

        return hashesFound;
    }

    /**
     * Filter out nodes for which there are destroy hashes present.
     *
     * @returns list of nodes not destroyed.
     */
    protected async filterDestroyed(nodes: NodeInterface[]): Promise<NodeInterface[]> {
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
            FROM universe_destroy_hashes AS dh, universe_nodes as nodes
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

        return nodes.filter( (node: NodeInterface) => {
            const id1 = node.getId1() as Buffer;
            const id1Str = id1.toString("hex");
            return !destroyed[id1Str];
        });
    }

    /**
     * Filter out already existing nodes and return nodes not existing in underlaying storage.
     *
     * @param nodes
     * @param preserveTransient if true then nodes are considered non-existing in the storage
     *  if their transient hashes differ from the stored nodes transient hashes.
     *  This is to allow updating of nodes transient hashes even if the node it self already exists.
     *
     * @return list of nodes not existing in the database (incl w/ different transient hash).
     *
     * @throws on error.
     */
    protected async filterExisting(nodes: NodeInterface[], preserveTransient: boolean = false): Promise<NodeInterface[]> {

        const toKeep: {[id1: string]: {transientHash: Buffer | undefined, keep: boolean}} = {};

        const id1s: Buffer[] = [];

        const nodesLength = nodes.length;
        for (let index=0; index<nodesLength; index++) {
            const node = nodes[index];
            const id1 = node.getId1() as Buffer;
            const id1Str = id1.toString("hex");

            const transientHash = preserveTransient ? node.hashTransient() : undefined;

            toKeep[id1Str] = {
                transientHash,
                keep: true,
            }

            id1s.push(id1);
        }

        const ph = this.db.generatePlaceholders(id1s.length);

        const sql = `SELECT id1, transienthash from universe_nodes WHERE id1 IN ${ph};`;

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

        return nodes.filter( (node: NodeInterface) => {
            const id1Str = (node.getId1() as Buffer).toString("hex");
            return toKeep[id1Str].keep;
        });
    }

    /**
     * Filter out nodes flagged as unique who's equivalent already exists in the database.
     *
     * A match on sharedHashes but where also the id1s are equals is not treated
     * as a clash and such a node is not filterd out but returned instead.
     * This is necessary if a store is updating the transient value of an already
     * existing node which also isUnique.
     *
     * @return list of nodes not having unique equivalent already existing.
     *
     * @throws on error.
     */
    protected async filterUnique(nodes: NodeInterface[]): Promise<NodeInterface[]> {

        const exists: {[hash: string]: Buffer} = {};

        const hashes: {[hash: string]: boolean} = {};

        const shared_hashes: Buffer[] = [];

        const nodesLength = nodes.length;
        for (let index=0; index<nodesLength; index++) {
            const node = nodes[index];

            if (node.isUnique()) {
                const hash = node.hashShared();
                const hashStr = hash.toString("hex");

                if (!hashes[hashStr]) {
                    shared_hashes.push(hash);
                    hashes[hashStr] = true;
                }
            }
        }

        if (shared_hashes.length === 0) {
            return nodes;
        }

        const ph = this.db.generatePlaceholders(shared_hashes.length);

        const sql = `SELECT id1, sharedhash from universe_nodes WHERE sharedhash IN ${ph};`;

        const rows = await this.db.all(sql, shared_hashes);

        const rowsLength = rows.length;
        for (let index=0; index<rowsLength; index++) {
            const row = rows[index];
            const sharedHashStr = (row.sharedhash as Buffer).toString("hex");
            exists[sharedHashStr] = row.id1;
        }

        return nodes.filter( (node: NodeInterface) => {
            if (node.isUnique()) {
                const sharedHashStr = node.hashShared().toString("hex");

                if (!exists[sharedHashStr]) {
                    return true;
                }

                return exists[sharedHashStr].equals(node.getId1() as Buffer);
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
     * Special Data destroy nodes have their hashes inserted into the `killer_hashes` table.
     *
     * Special Data friend cert bearer nodes have their embedded certs inserted into the `friend_certs` table.
     */
    protected async storeNodes(nodes: NodeInterface[], now: number, preserveTransient: boolean = false) {
        const destroyHashes = this.extractDestroyHashes(nodes);

        const achillesHashes = this.extractAchillesHashes(nodes);

        const friendCerts = this.extractFriendCerts(nodes);

        const licenseeHashes = this.extractLicenseeHashes(nodes);

        if (destroyHashes.length > 0) {
            await this.insertDestroyHashes(destroyHashes);
        }

        if (achillesHashes.length > 0) {
            await this.insertAchillesHashes(achillesHashes);
        }

        if (friendCerts.length > 0) {
            await this.insertFriendCerts(friendCerts);
        }

        if (licenseeHashes.length > 0) {
            await this.insertLicenseeHashes(licenseeHashes);
        }

        await this.insertNodes(nodes, now, preserveTransient);
    }

    protected extractDestroyHashes(nodes: NodeInterface[]): InsertDestroyHash[] {
        const destroyHashes: InsertDestroyHash[] = [];

        const nodesLength = nodes.length;
        for (let i=0; i<nodesLength; i++) {
            const node = nodes[i];
            const id1 = node.getId1() as Buffer;

            if (!node.getType(4).equals(Data.GetType(4))) {
                continue;
            }

            const data = node as DataInterface;

            if (!data.isSpecial()) {
                continue;
            }

            if (data.getContentType() !== SPECIAL_NODES.DESTROYNODE) {
                continue;
            }

            const refId = data.getRefId();
            const owner = data.getOwner();

            if (!refId || !owner) {
                continue;
            }

            if (refId.equals(owner)) {
                if (data.getDifficulty() ?? 0 < MIN_DIFFICULTY_TOTAL_DESTRUCTION) {
                    continue;
                }
            }

            destroyHashes.push({
                id1,
                hash: Hash([refId, owner]),
            });
        }

        return destroyHashes;
    }

    protected extractAchillesHashes(nodes: NodeInterface[]): InsertAchillesHash[] {
        const achillesHashes: InsertAchillesHash[] = [];

        const nodesLength = nodes.length;
        for (let i=0; i<nodesLength; i++) {
            const node = nodes[i];
            const id1 = node.getId1() as Buffer;

            if (!node.isIndestructible()) {
                const hashes = node.getAchillesHashes();
                const hashesLength = hashes.length;

                for (let index=0; index<hashesLength; index++) {
                    achillesHashes.push({
                        id1,
                        hash: hashes[index],
                    });
                }
            }
        }

        return achillesHashes;
    }

    protected extractFriendCerts(nodes: NodeInterface[]): InsertFriendCert[] {
        const friendCerts: InsertFriendCert[] = [];

        const nodesLength = nodes.length;
        for (let i=0; i<nodesLength; i++) {
            const node = nodes[i];
            const id1 = node.getId1() as Buffer;

            if (!node.getType(4).equals(Data.GetType(4))) {
                continue;
            }

            const data = node as DataInterface;

            if (!data.isSpecial()) {
                continue;
            }

            if (data.getContentType() !== SPECIAL_NODES.FRIENDCERT) {
                continue;
            }

            const embedded = data.getEmbedded();

            if (!embedded) {
                continue;
            }

            try {
                const cert = data.getEmbeddedObject() as FriendCertInterface;

                if (cert.getType(4).equals(FriendCert.GetType(4))) {
                    const issuer = cert.getIssuerPublicKey();

                    const constraints = cert.getConstraints();

                    if (issuer && constraints) {
                        friendCerts.push({
                            id1,
                            issuer,
                            constraints,
                            image: embedded,
                        });
                    }
                }
            }
            catch(e) {
                // Do nothing.
            }
        }

        return friendCerts;
    }

    protected extractLicenseeHashes(nodes: NodeInterface[]): InsertLicenseeHash[] {
        const licenseeHashes: InsertLicenseeHash[] = [];

        const nodesLength = nodes.length;
        for (let i=0; i<nodesLength; i++) {
            const node = nodes[i];
            const id1 = node.getId1() as Buffer;

            if (!node.getType(4).equals(License.GetType(4))) {
                continue;
            }

            const license = node as License;
            const hashes = license.getLicenseeHashes();

            const hashesLength = hashes.length;
            for (let index=0; index<hashesLength; index++) {
                licenseeHashes.push({
                    id1,
                    hash: hashes[index],
                    disallowretrolicensing: license.disallowRetroLicensing() ? 1 : 0,
                    parentpathhash: license.getParentPathHash(),
                    restrictivemodewriter: license.isRestrictiveModeWriter() ? 1 : 0,
                    restrictivemodemanager: license.isRestrictiveModeManager() ? 1 : 0,
                });
            }
        }

        return licenseeHashes;
    }

    /**
     * Insert achilles hashes.
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

        await this.db.run(`INSERT INTO universe_achilles_hashes (id1, hash) VALUES ${ph};`, params);
    }

    /**
     * Insert licensee hashes.
     * It is expected there is a surrounding transaction in play.
     *
     * @throws on error
     */
    protected async insertLicenseeHashes(licenseeHashes: InsertLicenseeHash[]): Promise<void> {
        if (licenseeHashes.length === 0) {
            return;
        }

        const params: any[] = [];

        const length = licenseeHashes.length;
        for (let index=0; index<length; index++) {
            const obj = licenseeHashes[index];
            params.push(obj.id1,
                obj.hash,
                obj.disallowretrolicensing,
                obj.parentpathhash ?? null,
                obj.restrictivemodewriter,
                obj.restrictivemodemanager,
            );
        }

        const ph = this.db.generatePlaceholders(6, licenseeHashes.length);

        await this.db.run(`INSERT INTO universe_licensee_hashes
            (id1, hash, disallowretrolicensing, parentpathhash, restrictivemodewriter, restrictivemodemanager) VALUES ${ph};`,
            params);
    }

    /**
     * Insert destroy hashes.
     * It is expected there is a surrounding transaction in play.
     *
     * @throws on error
     */
    protected async insertDestroyHashes(destroyHashes: InsertDestroyHash[]): Promise<void> {
        if (destroyHashes.length === 0) {
            return;
        }

        const params: Buffer[] = [];

        const length = destroyHashes.length;
        for (let index=0; index<length; index++) {
            const obj = destroyHashes[index];
            params.push(obj.id1, obj.hash);
        }

        const ph = this.db.generatePlaceholders(2, destroyHashes.length);

        await this.db.run(`INSERT INTO universe_destroy_hashes (id1, hash) VALUES ${ph};`, params);
    }

    /**
     * Insert friend certs.
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
            params.push(obj.issuer, obj.constraints, obj.image, obj.id1);
        }

        const ph = this.db.generatePlaceholders(4, friendCerts.length);

        await this.db.run(`INSERT INTO universe_friend_certs (issuer, constraints, image, id1)
            VALUES ${ph};`, params);
    }

    /**
     * Insert nodes.
     * It is expected there is a surrounding transaction in play.
     *
     * @throws on error
     */
    protected async insertNodes(nodes: NodeInterface[], now: number, preserveTransient: boolean = false): Promise<void> {
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

            if (node.isLicensed()) {
                bumpHash = Hash([node.getId1(), node.getParentId()]);
            }
            else if (node.hasRightsByAssociation()) {
                bumpHash = Hash([node.getRefId(), node.getParentId()]);
            }

            params.push(
                node.getId1(),
                node.getId2() ?? null,
                node.getId(),
                node.getParentId(),
                node.getCreationTime(),
                node.getExpireTime() ?? null,
                node.getRegion() ?? null,
                node.getJurisdiction() ?? null,
                node.getOwner(),
                node.isDynamic() ? 1 : 0,
                node.isDynamic() && node.isDynamicActive() ? 1 : 0,
                node.isPublic() ? 1 : 0,
                node.isLicensed() ? 1 : 0,
                node.disallowParentLicensing() ? 1 : 0,
                node.isLeaf() ? 1 : 0,
                node.getDifficulty() ?? 0,
                node.hashShared(),
                node.hashTransient(),
                now,
                now,
                bumpHash,
                node.export(preserveTransient));
        }


        const ph = this.db.generatePlaceholders(22, nodes.length);

        let sql: string;

        if (preserveTransient) {
            sql = `INSERT INTO universe_nodes
            (id1, id2, id, parentid, creationtime, expiretime, region, jurisdiction, owner, dynamic,
            active, ispublic, islicensed, disallowparentlicensing, isleaf,
            difficulty, sharedhash, transienthash, storagetime, trailupdatetime, bumphash, image)
            VALUES ${ph}
            ON CONFLICT (id1) DO UPDATE SET
            transienthash=excluded.transienthash,
            storagetime=excluded.storagetime,
            active=excluded.active,
            image=excluded.image;`
        }
        else {
            sql = `INSERT INTO universe_nodes
            (id1, id2, id, parentid, creationtime, expiretime, region, jurisdiction, owner, dynamic,
            active, ispublic, islicensed, disallowparentlicensing, isleaf,
            difficulty, sharedhash, transienthash, storagetime, trailupdatetime, bumphash, image)
            VALUES ${ph}
            ON CONFLICT (id1) DO NOTHING;`
        }

        await this.db.run(sql, params);
    }

    protected async setTrailUpdateTime(id1s: Buffer[], now: number): Promise<void> {
        if (id1s.length === 0) {
            return;
        }

        if (!Number.isInteger(now)) {
            throw new Error("now not integer");
        }

        const ph = this.db.generatePlaceholders(id1s.length);

        const sql = `UPDATE universe_nodes SET trailupdatetime=${now} WHERE id1 IN ${ph};`;

        await this.db.run(sql, id1s);
    }

    /**
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

        const sql = `UPDATE universe_nodes
            SET storagetime=${now}, trailupdatetime=${now}
            WHERE bumphash IN ${ph}
            RETURNING parentid;`;

        const rows = await this.db.all(sql, bumpHashes);

        return rows.map( row => row.parentid );
    }

    public async deleteNodes(id1s: Buffer[]) {
        this.db.exec("BEGIN;");

        try {
            const ph = this.db.generatePlaceholders(id1s.length);

            await this.db.run(`DELETE FROM universe_nodes AS t WHERE t.id1 IN ${ph};`, id1s);

            await this.db.run(`DELETE FROM universe_achilles_hashes AS t WHERE t.id1 IN ${ph};`, id1s);

            await this.db.run(`DELETE FROM universe_licensee_hashes AS t WHERE t.id1 IN ${ph};`, id1s);

            await this.db.run(`DELETE FROM universe_destroy_hashes AS t WHERE t.id1 IN ${ph};`, id1s);

            await this.db.run(`DELETE FROM universe_friend_certs AS t WHERE t.id1 IN ${ph};`, id1s);

            this.db.exec("COMMIT;");
        }
        catch(e) {
            this.db.exec("ROLLBACK;");
            throw e;
        }
    }

    public async deleteBlobs(nodeId1s: Buffer[]) {
        this.db.exec("BEGIN;");

        try {
            const ph = this.db.generatePlaceholders(nodeId1s.length);

            await this.db.run(`DELETE FROM universe_blob_data AS t WHERE t.id1 IN ${ph};`, nodeId1s);

            await this.db.run(`DELETE FROM universe_blob AS t WHERE t.id1 IN ${ph};`, nodeId1s);

            this.db.exec("COMMIT;");
        }
        catch(e) {
            this.db.exec("ROLLBACK;");
            throw e;
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


    // Blob functions
    //
    //

    /**
     * @see BlobDriverInterface.
     *
     * Note: Writing sparsely might not work. Each fragment must be touched to be existing,
     * meaning that if writing a huge blob of 0-bytes it is not
     * enough to only write the last byte in the last fragment.
     * The last byte of every fragment must in such case be written to.
     */
    public async writeBlob(dataId: Buffer, pos: number, data: Buffer) {
        if (!this.blobDb) {
            throw new Error("Blob DB not available");
        }

        await this.db.exec("BEGIN;");
        try {
            // Handle first fragment
            //
            const res = await this.calcBlobStartFragment(dataId, pos, data);

            const {fragment, startFragmentIndex} = res;
            let index = res.index;

            await this.writeBlobFragment(dataId, fragment, startFragmentIndex);


            // Handle middle fragments.
            //
            const countFragments = Math.ceil((pos + data.length) / BLOB_FRAGMENT_SIZE);

            let fragmentIndex = startFragmentIndex + 1;

            while (fragmentIndex < startFragmentIndex + countFragments - 1) {
                const fragment = data.slice(index, index + BLOB_FRAGMENT_SIZE);

                index += BLOB_FRAGMENT_SIZE;

                await this.writeBlobFragment(dataId, fragment, fragmentIndex);

                fragmentIndex++;
            }

            // Handle last fragment.
            //
            if (countFragments > 1 && index < data.length) {
                const {fragment, endFragmentIndex} =
                    await this.calcBlobEndFragment(dataId, pos, index, data);

                await this.writeBlobFragment(dataId, fragment, endFragmentIndex);
            }

            await this.db.exec("COMMIT;");
        }
        catch(e) {
            await this.db.exec("ROLLBACK;");
            throw e;
        }
    }

    /**
     * @see BlobDriverInterface.
     */
    public async readBlob(nodeId1: Buffer, pos: number, length: number): Promise<Buffer> {
        if (!this.blobDb) {
            throw new Error("Blob DB not available");
        }

        const dataId = await this.getBlobDataId(nodeId1);

        if (!dataId) {
            throw new Error("node blob data does not exist in finalized state");
        }

        let fragmentIndex = Math.floor(pos / BLOB_FRAGMENT_SIZE);
        const fragments: Buffer[] = [];
        let l = 0;
        let pos2 = pos;

        while (l < length) {
            const fragment = await this.readBlobFragment(dataId, fragmentIndex, true);

            if (!fragment) {
                break;
            }

            const fragment2 = fragment.slice(pos2,pos2+length-l);

            fragments.push(fragment2);

            l += fragment2.length;

            fragmentIndex++;
            pos2 = 0;
        }

        return Buffer.concat(fragments);
    }

    /**
     * @param dataId
     * @param pos position in blob
     * @param data meant to be written starting at blob position.
     * @returns data of first fragment and the fragment index.
     */
    protected async calcBlobStartFragment(dataId: Buffer, pos: number, data: Buffer): Promise<{fragment: Buffer, startFragmentIndex: number, index: number}> {
        const startFragmentIndex = Math.floor(pos / BLOB_FRAGMENT_SIZE);
        const boundaryDiff = pos - startFragmentIndex * BLOB_FRAGMENT_SIZE;

        const index = Math.min(BLOB_FRAGMENT_SIZE - boundaryDiff, data.length);

        const dataSlice = data.slice(0, index);

        let fragment: Buffer | undefined;

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
     * @param data the unmodifed data buffer to write.
     *
     * @returns data of last fragment and the fragment index of last fragment.
     * @throws on invalid input parameters.
     */
    protected async calcBlobEndFragment(dataId: Buffer, startPos: number, index: number, data: Buffer): Promise<{fragment: Buffer, endFragmentIndex: number}> {
        const countFragments = Math.ceil((startPos + data.length) / BLOB_FRAGMENT_SIZE);
        const posFragmentIndex = Math.floor((startPos + index) / BLOB_FRAGMENT_SIZE);
        const endFragmentIndex = countFragments - 1;

        if (index >= data.length) {
            throw new Error("End of data reached");
        }
        else if (countFragments <= 1 || posFragmentIndex === 0) {
            throw new Error("This is not the end fragment, looks like the start fragment");
        }
        else if (posFragmentIndex !== endFragmentIndex) {
            throw new Error("This is not the end fragment, looks like a middle fragment");
        }
        else if (posFragmentIndex * BLOB_FRAGMENT_SIZE !== startPos + index) {
            throw new Error("The end fragment must begin on the exact fragment boundary");
        }

        let fragment: Buffer | undefined;

        if (index + BLOB_FRAGMENT_SIZE === data.length) {
            fragment = data.slice(index, index + BLOB_FRAGMENT_SIZE);
        }
        else {
            const dataSlice = data.slice(index);

            fragment = await this.readBlobFragment(dataId, endFragmentIndex);

            if (!fragment) {
                fragment = dataSlice;
            }
            else {
                const remainingLength = Math.max(0, dataSlice.length - fragment.length);
                fragment = Buffer.concat([fragment, Buffer.alloc(remainingLength)]);
                dataSlice.copy(fragment, 0);
            }
        }

        return {fragment, endFragmentIndex};
    }

    /**
     * Insert or replace existing fragment if not finalized already.
     *
     * @param dataId
     * @param fragment data to insert/replace
     * @param fragmentIndex the fragment index to write to
     * @throws on error
     */
    protected async writeBlobFragment(dataId: Buffer, fragment: Buffer, fragmentIndex: number) {
        if (fragment.length > BLOB_FRAGMENT_SIZE) {
            throw new Error("Blob fragment too large");
        }

        // Note that this write runs in the parent transaction of caller.
        //

        const ph = this.db.generatePlaceholders(4);

        const sql = `INSERT INTO universe_blob_data (dataid, fragmentnr, finalized, fragment)
            VALUES ${ph}
            ON CONFLICT (dataid, fragmentnr) DO UPDATE SET fragment=excluded.fragment
            WHERE universe_blob_data.finalized=0;`;

        await this.db.run(sql, [dataId, fragmentIndex, 0, fragment]);
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

        if (!Number.isInteger(fragmentIndex)) {
            throw new Error("fragmentIndex not integer");
        }

        const finalized = onlyFinalized ? "AND finalized=1" : "";

        const ph = this.db.generatePlaceholders(1);

        const sql = `SELECT fragment FROM universe_blob_data
            WHERE dataid=${ph} AND fragmentnr=${fragmentIndex} ${finalized};`;

        const row = await this.db.get(sql, [dataId]);

        return row?.fragment;
    }

    /**
     * @see BlobDriverInterface.
     */
    public async readBlobIntermediaryLength(dataId: Buffer): Promise<number | undefined> {
        if (!this.blobDb) {
            throw new Error("Blob DB not available");
        }

        const ph = this.db.generatePlaceholders(1);

        const sql = `SELECT SUM(LENGTH(fragment)) AS length
            FROM universe_blob_data
            WHERE dataid=${ph} GROUP BY dataid LIMIT 1`;

        const row = await this.db.get(sql, [dataId]);

        return row?.length;
    }

    /**
     * @see BlobDriverInterface.
     */
    public async finalizeWriteBlob(nodeId1: Buffer, dataId: Buffer, blobLength: number, blobHash: Buffer) {
        if (!this.blobDb) {
            throw new Error("Blob DB not available");
        }

        const length = await this.readBlobIntermediaryLength(dataId);

        if (length !== blobLength) {
            throw new Error("blob length not correct");
        }

        const ph = this.db.generatePlaceholders(1);

        const sql = `SELECT fragment FROM universe_blob_data
            WHERE dataid=${ph} AND finalized=0 ORDER BY fragmentnr;`;

        const blake = blake2b(32);

        await this.db.exec("BEGIN;");

        try {
            await this.db.each(sql, [dataId], (row: any): any => {
                blake.update(row?.fragment);
            });
        }
        catch(e) {
            await this.db.exec("ROLLBACK;");
            throw e;
        }

        const hash = Buffer.from(blake.digest());

        if (!hash.equals(blobHash)) {
            await this.db.exec("ROLLBACK;");
            throw new Error("blob hash not correct");
        }

        const ph1 = this.db.generatePlaceholders(1);

        const sqlUpdate = `UPDATE universe_blob_data SET finalized=1
            WHERE dataid=${ph1} AND finalized=0;`;

        const ph2 = this.db.generatePlaceholders(2);

        const sqlInsert = `INSERT INTO universe_blob (node_id1, dataid) VALUES ${ph2};`;

        try {
            await this.db.run(sqlUpdate, [dataId]);
            await this.db.run(sqlInsert, [nodeId1, dataId]);
            await this.db.exec("COMMIT;");
        }
        catch(e) {
            await this.db.exec("ROLLBACK;");
            throw e;
        }
    }

    /**
     * @see BlobDriverInterface.
     */
    public async getBlobDataId(nodeId1: Buffer): Promise<Buffer | undefined> {
        if (!this.blobDb) {
            throw new Error("Blob DB not available");
        }

        const ph = this.db.generatePlaceholders(1);

        const sql = `SELECT dataid FROM universe_blob
            WHERE node_id1=${ph} LIMIT 1`;

        const row = await this.db.get(sql, [nodeId1]);

        if (row?.dataid) {
            return Buffer.from(row.dataid, "hex");
        }

        return undefined;
    }

    public close() {
        this.db.close();
    }
}
