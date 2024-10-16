import { strict as assert } from "assert";

import {
    sleep,
} from "../util/common";

import {
    RegionUtil,
    DeepCopy,
    ParseSchema,
} from "../util";

import {
    FetchRequestSchema,
} from "../request/jsonSchema";

import {
    NodeInterface,
    Hash,
    Data,
    LicenseInterface,
    License,
    FriendCertInterface,
} from "../datamodel";

import {
    Decoder,
} from "../decoder";

import {
    FetchQuery,
    Status,
    Match,
    MAX_LICENSE_DISTANCE,
} from "../types";

import {
    HandleFetchReplyData,
    MAX_QUERY_LEVEL_LIMIT,
    MAX_QUERY_ROWS_LIMIT,
    SelectLicenseeHash,
    LicenseNodeEntry,
    SelectFriendCertPair,
    MAX_BATCH_SIZE,
    NOW_TOLERANCE,
} from "./types";

import {
    DBClient,
} from "./DBClient";

import {
    PocketConsole,
} from "pocket-console";

const console = PocketConsole({module: "QueryProcessor"});

/**
 * Mutable data structure used to keep track of query status.
 */
export type MatchState = {
    counter: number,
    cursorPassed: boolean;
    group: {[key: string]: {[key: string]: number}},
    done: boolean,
};

type PermissionsResult = {
    nodes: NodeInterface[],
    embed: {originalNode: NodeInterface, embeddedNode: NodeInterface}[],
    includedLicenses: {[nodeId1: string]: {[licenseId1: string]: Buffer}},
    includedLicensesEmbedded: LicenseInterface[],
};

type NodeRow = {
    id1: Buffer,
    id2: Buffer,
    id: Buffer,
    parentid: Buffer,
    creationTime: number,
    expiretime?: number,
    region?: string,
    jurisdiction?: string,
    owner: Buffer,
    hasonline: number,
    isonline: number,
    transienthash: Buffer,
    sharedhash: Buffer,
    ispublic: number,
    difficulty: number,
    image: Buffer,
    storagetime: number,
    updatetime: number,
    trailupdatetime: number,
};

type Obj1 = {
    owner: Buffer,
    parentId: string,
    childMinDifficulty: number,
    disallowPublicChildren: boolean,
    onlyOwnChildren: boolean,
    beginRestrictiveWriterMode: boolean,
    endRestrictiveWriterMode: boolean,
    flushed: boolean,
    passed: boolean,
    restrictiveNodes: NodeInterface[],
    restrictiveManager: {[id1: string]: boolean},
    trailUpdateTime: number,
    storageTime: number,
    updateTime: number,
    discard: boolean,
    bottom: boolean,
    matchIndexes: number[],
    node: NodeInterface,
};

export type AlreadyProcessedCache =
    {[nodeId: string]: {matched: number[], id1s: {[id1: string]: Obj1}}};

export enum ReverseFetch {
    /** Do not fetch in reverse. */
    OFF             = 0,

    /**
     * Fetch all nodes going upwards.
     * When fetching in reverse the node(s) of the given parentId of the query is included in the resultset on their IDs as level 1.
     *
     * If a rootNode is given (instead of parentId) then the root node is included in the resultset
     * as level 0 and the level 1 is fetched on their IDs which equal the root node's parentId.
     */
    ALL_PARENTS     = 1,

    /**
     * Fetch only licensed nodes going upwards.
     * When fetching in reverse the node(s) of the given parentId of the query is included in the resultset on their IDs as level 1.
     *
     * If a rootNode is given (instead of parentId) then the root node is included in the resultset
     * as level 0 and the level 1 is fetched on their IDs which equal the root node's parentId.
     */
    ONLY_LICENSED   = 2,
}

export class QueryProcessor {
    /**
     * Keep track of visited nodes to avoid loops and to use as parent path when looking up parent licenses,
     * and also keeping track of which Match matched the current node.
     */
    protected alreadyProcessedNodes: AlreadyProcessedCache = {};

    protected parentId: Buffer;

    /**
     * The rows from the nodes table fetched and yet not flushed.
     * Nodes are all on the same current level.
     */
    protected currentRows: NodeInterface[] = [];

    /**
     * The node IDs we use to fetch for the next level in the graph.
     */
    protected nextLevelIds: {[nodeId: string]: Buffer} = {};

    /**
     * The node IDs we are currently fetching/below for the current
     * level of the graph.
     */
    protected currentIds: Buffer[] = [];

    /**
     * We keep track of the total amount of rows fetched from the database
     * to be able to limit resources spent on each query.
     * This is regardless of how many nodes are sent as a result to the client.
     */
    protected rowCount  = 0;

    /** The total node count of nodes put into the resultset, including embedded nodes. */
    protected nodeCount = 0;

    /** The current level we are fetching on. */
    protected level     = 0;

    /** The node count of the current level put into the resultset. */
    protected nodeLevelCount = 0;

    protected currentLevelMatches: [Match, MatchState][] = [];

    /** If set then idle on fetching the next batch of rows from the database. */
    protected backPressure = false;

    /** Count each row returned performing select query. */
    protected addRowCount = 0;

    protected flushCount: number = 0;

    protected _error: Error | undefined;

    protected includedLicensesEmbedded: {[originalId1: string]: boolean} = {};

    // Keep track of nodes flushed and if to add includedLicenses.
    protected nodesMap: {[id1: string]: true} = {};

    /**
     * @now now timestamp used to compare against expireTime of nodes.
     * expireTime must be less than now to be existing.
     */
    constructor(
        protected readonly db: DBClient,
        protected readonly fetchQuery: FetchQuery,
        protected readonly rootNode: NodeInterface | undefined,
        protected readonly now: number,
        protected readonly handleFetchReplyData: HandleFetchReplyData,
        protected reverseFetch: ReverseFetch = ReverseFetch.OFF,
        protected allowLicensed: boolean = true,
        protected allowEmbed: boolean = true,
        protected queryBatchLimit: number = 5000,
    ) {
        if (!Number.isInteger(this.now)) {
            throw new Error("now not integer");
        }

        this.parentId = this.fetchQuery.parentId;

        if (this.rootNode) {
            if (reverseFetch === ReverseFetch.OFF) {
                this.parentId = this.rootNode.getId() as Buffer;
            }
            else {
                this.parentId = this.rootNode.getParentId() as Buffer;
            }
        }

        assert(this.parentId.length > 0, "parentId nor rootNode set on fetchQuery when constucting QueryProcessor");
    }

    public setProcessedCache(cache: AlreadyProcessedCache) {
        this.alreadyProcessedNodes = cache;
    }

    /**
     * @throws on error
     */
    public async run() {
        const parentIdStr = this.parentId.toString("hex");
        this.nextLevelIds[parentIdStr] = this.parentId;

        if (this.rootNode) {
            const parentIdStr = (this.rootNode.getParentId() ?? Buffer.alloc(0)).toString("hex");
            const idStr = (this.rootNode.getId() as Buffer).toString("hex");
            const id1Str = (this.rootNode.getId1() as Buffer).toString("hex");
            const owner = this.rootNode.getOwner() as Buffer;
            const childMinDifficulty = this.rootNode.getChildMinDifficulty() ?? 0;
            const disallowPublicChildren = this.rootNode.disallowPublicChildren();
            const onlyOwnChildren = this.rootNode.onlyOwnChildren();

            if (this.alreadyProcessedNodes[idStr]) {
                // Already processed
                this.flushCount++;
                this.handleFetchReplyData({
                    status: Status.Result, rowCount: 0, now: this.now, isFirst: true, isLast: true});
                return;
            }

            this.alreadyProcessedNodes[idStr] = {
                matched: [],
                id1s: {
                    [id1Str]: {
                        owner,
                        parentId: parentIdStr,
                        childMinDifficulty,
                        disallowPublicChildren,
                        onlyOwnChildren,
                        beginRestrictiveWriterMode: false,
                        endRestrictiveWriterMode: false,
                        flushed: false,
                        passed: true,
                        restrictiveNodes: [],
                        restrictiveManager: {},
                        trailUpdateTime: 0,
                        storageTime: 0,
                        updateTime: 0,
                        discard: false,
                        bottom: false,
                        matchIndexes: [],
                        node: this.rootNode,
                    }
                }
            };

            if ((this.fetchQuery.limit === -1 || this.fetchQuery.limit > 0) &&
                !this.fetchQuery.discardRoot) {

                this.currentRows.push(this.rootNode);

                await this.flush();
            }
        }


        while (!this.error() && !this.done() && this.hasNextLevel()) {
            this.initNextLevel();

            // Process the current level.
            while (!this.error() && !this.done() && !this.levelDone() && this.hasCurrentIds()) {
                const currentIds = this.currentIds.splice(0, MAX_BATCH_SIZE);

                // Process the current batch on the current level.
                let offset = 0;
                while (currentIds.length > 0 && !this.error() && !this.done() && !this.levelDone()) {
                    while (this.backPressure) {
                        await sleep(100);
                    }

                    const [sql, limit, params] = this.prepareSQL(currentIds, offset,
                        this.level === 1 ? Number(this.fetchQuery.cutoffTime) : 0);

                    if (limit <= 0) {
                        // There is nothing more to fetch for this current batch.
                        currentIds.length = 0;
                        break;
                    }

                    this.addRowCount = 0;

                    try {
                        await this.db.each(sql, params, this.addRow);
                    }
                    catch(e) {
                        console.debug("error in db.each", e);
                        this._error = e as Error;
                        break;
                    }

                    await this.flush();

                    if (this.addRowCount < limit || this.addRowCount === 0) {
                        // If no more rows to be fetched on current query then
                        // fetch on the next batch of currentIds if more data needed.
                        currentIds.length = 0;
                        break;
                    }

                    offset = offset + this.addRowCount;
                }
            }
        }

        const isFirst = this.flushCount === 0;

        this.flushCount++;

        if (this.error()) {
            this.handleFetchReplyData({
                status: Status.Error, error: "Error fetching from database", rowCount: this.rowCount, now: this.now, isFirst, isLast: true});
            throw this._error;
        }

        this.handleFetchReplyData({
            status: Status.Result, rowCount: this.rowCount, now: this.now, isFirst, isLast: true});
    }

    /**
     * Inject nodes into the already processed cache.
     *
     */
    public injectNodes(nodes: NodeInterface[]) {
        const nodesLength = nodes.length;
        for (let i=0; i<nodesLength; i++) {
            const node = nodes[i];
            this.addAlreadyProcessed(node, this.now, this.now, this.now);
        }
    }

    /**
     * @returns true if the cursor should be aborted.
     */
    protected addRow = (row: NodeRow): boolean => {
        this.rowCount++;
        this.addRowCount++;

        if (!row || !row.image) {
            return false;
        }

        try {
            const node = Decoder.DecodeNode(row.image, true);
            node.setTransientStorageTime(row.storagetime);

            const passed = this.addAlreadyProcessed(node, row.storagetime, row.updatetime, row.trailupdatetime);

            // Always run this to not miss flipping the cursorPassed flag.
            const passed2 = this.matchFirst(node, this.currentLevelMatches);

            if (!passed || !passed2) {
                return false;
            }

            this.currentRows.push(node);

            if (this.currentRows.length >= 1000) {
                if (this.levelDone()) {
                    // Abort the cursor.
                    return true;
                }
            }
        }
        catch(e) {
            console.error("Exception in QueryProcessor.addRow", e);
            // Do nothing
        }

        return false;
    }

    /**
     * @returns false if not allowed.
     */
    protected addAlreadyProcessed(node: NodeInterface, storageTime: number, updateTime: number, trailUpdateTime: number): boolean {
        const idStr = (node.getId() as Buffer).toString("hex");
        const id1Str = (node.getId1() as Buffer).toString("hex");
        const parentIdStr = (node.getParentId() as Buffer).toString("hex");

        const obj = this.alreadyProcessedNodes[idStr] ?? {matched: [], id1s: {}};

        let obj1 = obj.id1s[id1Str];

        if (obj1) {
            // This exact node (same id1) has already been encountered.
            // This either means that its parent has copies on different levels of the graph
            // or that there is a cyclic loop in the graph.
            // If there is a loop we ignore this node and move on,
            // otherwise let it pass but we keep the current obj1 object so we can skip flushing it a second time.

            if (this.detectLoop(parentIdStr)) {
                return false;
            }
        }
        else {
            // Add new obj1
            obj1 = {
                childMinDifficulty: node.getChildMinDifficulty() ?? 0,
                disallowPublicChildren: node.disallowPublicChildren(),
                onlyOwnChildren: node.onlyOwnChildren(),
                endRestrictiveWriterMode: node.isEndRestrictiveWriteMode(),
                beginRestrictiveWriterMode: node.isBeginRestrictiveWriteMode(),
                node: node,
                parentId: parentIdStr,
                owner: (node.getOwner() as Buffer),
                flushed: false,
                passed: false,
                restrictiveNodes: [],
                restrictiveManager: {},
                trailUpdateTime,
                storageTime,
                updateTime,
                discard: false,  // Will be set later.
                bottom: false,   // Will be set later.
                matchIndexes: [],
            };
        }

        obj.id1s[id1Str] = obj1;

        this.alreadyProcessedNodes[idStr] = obj;

        const parentObj = this.alreadyProcessedNodes[parentIdStr];

        if (parentObj) {
            // Note that if a node has multiple parents, it means that those
            // are copies and since all parents share the same properties
            // we only need to look at a single parent when checking basic criterieas below.
            //
            const parentObj1 = Object.values(parentObj.id1s).filter( parentObj1 => parentObj1.passed )[0];

            if(parentObj1 === undefined) {
                return false;
            }

            if (parentObj1.disallowPublicChildren && node.isPublic()) {
                return false;
            }
            else if ((node.getDifficulty() ?? 0) < parentObj1.childMinDifficulty) {
                return false;
            }
            else if (parentObj1.onlyOwnChildren && !parentObj1.owner.equals((node.getOwner() as Buffer))) {
                return false;
            }


            // Inherit all restrictiveNodes from all parents who have passed=true.
            //
            obj1.restrictiveNodes = [];
            obj1.restrictiveManager = {};
            obj1.passed = false;

            const parentId1s = Object.keys(parentObj.id1s);

            const parentId1sLength = parentId1s.length;


            for (let i=0; i<parentId1sLength; i++) {
                const parentId1  = parentId1s[i];
                const parentObj1 = parentObj.id1s[parentId1];

                if (!parentObj1.passed) {
                    continue;
                }

                obj1.updateTime = Math.max(obj1.updateTime, parentObj1.updateTime);

                obj1.restrictiveNodes.push(...parentObj1.restrictiveNodes);

                if (parentObj1.endRestrictiveWriterMode) {
                    obj1.restrictiveNodes = obj1.restrictiveNodes.filter( node => {
                        const id1Str = (node.getId1() as Buffer).toString("hex");
                        if (parentObj1.restrictiveManager[id1Str]) {
                            return false;
                        }

                        return true;
                    });
                }

                if (parentObj1.beginRestrictiveWriterMode) {
                    obj1.restrictiveNodes.push(parentObj1.node);
                }
            }
        }

        return true;
    }

    protected detectLoop(parentIdStr: string, path?: string[]): boolean {
        path = path ?? [];

        const parentObj = this.alreadyProcessedNodes[parentIdStr];

        if (parentObj === undefined) {
            return false;
        }

        const parentId1s = Object.keys(parentObj.id1s);

        const parentId1sLength = parentId1s.length;
        for (let i=0; i<parentId1sLength; i++) {
            const parentId1Str = parentId1s[i];

            if (path.includes(parentId1Str)) {
                return true;
            }

            path.push(parentId1Str);

            const parentObj1 = parentObj.id1s[parentId1Str];

            if (this.detectLoop(parentObj1.parentId, path)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Flush out the data which the caller has rights to.
     * Flushes are batched by MAX_BATCH_SIZE.
     */
    protected async flush() {
        while (true) {
            let maxNodesLeft = this.fetchQuery.limit > -1 ?
                this.fetchQuery.limit - this.nodeCount : MAX_QUERY_ROWS_LIMIT;

            const currentRows = this.currentRows.splice(0, MAX_BATCH_SIZE);

            const embed: NodeInterface[] = [];

            let nodesToFlush: NodeInterface[] = [];

            const nodes: NodeInterface[] = [];

            let includedLicenses: {[nodeId1: string]: {[licenseId1: string]: Buffer}} | undefined;

            // Note: we do not check any permissions at all when fetching upwards.
            //
            if (this.level > 0 && this.reverseFetch === ReverseFetch.OFF) {
                const currentRows2 = await this.filterRestrictiveMode(currentRows);

                const permissionsResult = await this.filterPermissions(currentRows2);

                includedLicenses = permissionsResult.includedLicenses;

                // These are nodes we are willing to flush out,
                // if they pass the stateful part of the matching.
                nodesToFlush = this.matchSecond(permissionsResult.nodes, this.currentLevelMatches);

                // We handle the extra includedLicensesEmbedded seperately here do not clutter
                // the overall fetch process.
                //
                const includedLicensesEmbeddedLength =
                    permissionsResult.includedLicensesEmbedded.length;

                for (let i=0; i<includedLicensesEmbeddedLength; i++) {
                    if (maxNodesLeft <= 0) {
                        break;
                    }

                    const includedLicenseEmbedded = permissionsResult.includedLicensesEmbedded[i];

                    if (!includedLicenseEmbedded) {
                        continue;
                    }

                    try {
                        const originalNode = includedLicenseEmbedded.getEmbeddedObject();

                        if (!originalNode) {
                            continue;
                        }

                        const id1Str = (originalNode.getId1() as Buffer).toString("hex");

                        if (!this.includedLicensesEmbedded[id1Str]) {
                            embed.push(includedLicenseEmbedded);
                            this.includedLicensesEmbedded[id1Str] = true;
                            maxNodesLeft--;
                        }
                    }
                    catch(e) {
                        // Do nothing
                    }
                }

                // We also want to match and alter match state for the nodes being embedded.
                const originalNodes = permissionsResult.embed.map( tuple => tuple.originalNode );

                const nodesToEmbed = this.matchSecond(originalNodes,
                    this.currentLevelMatches).filter(
                        embeddable => {
                            const idStr = (embeddable.getId() as Buffer).toString("hex");
                            const id1Str = (embeddable.getId1() as Buffer).toString("hex");
                            const obj = this.alreadyProcessedNodes[idStr] ?? {matched: [], id1s: {}};
                            const obj1 = obj.id1s[id1Str];

                            if (!obj1) {
                                return true;
                            }

                            if (!obj1.discard && obj1.updateTime >= this.fetchQuery.cutoffTime) {
                                return true;
                            }

                            return false;
                        });


                const embeddedNodesLength = permissionsResult.embed.length;
                const nodesToEmbedLength = nodesToEmbed.length;

                for (let i=0; i<nodesToEmbedLength; i++) {
                    if (maxNodesLeft <= 0) {
                        break;
                    }

                    const node = nodesToEmbed[i];

                    for (let i=0; i<embeddedNodesLength; i++) {
                        const {originalNode, embeddedNode} = permissionsResult.embed[i];

                        const id1 = originalNode.getId1() as Buffer;

                        const id1Str = id1.toString("hex");

                        if (this.includedLicensesEmbedded[id1Str]) {
                            continue;
                        }

                        if (id1.equals(node.getId1() as Buffer)) {
                            embed.push(embeddedNode);
                            maxNodesLeft--;
                        }
                    }
                }
            }
            else {
                nodesToFlush = currentRows;
            }

            const nodesLength = nodesToFlush.length;
            for (let index=0; index<nodesLength; index++) {
                if (maxNodesLeft <= 0) {
                    break;
                }

                const node = nodesToFlush[index];

                const idStr = (node.getId() as Buffer).toString("hex");
                const id1Str = (node.getId1() as Buffer).toString("hex");

                const obj = this.alreadyProcessedNodes[idStr] ?? {matched: [], id1s: {}};
                const obj1 = obj.id1s[id1Str];

                if (!obj1) {
                    nodes.push(node);
                    maxNodesLeft--;
                    this.nodesMap[id1Str] = true;
                    continue;
                }

                obj1.passed = true;

                if (!obj1.discard && obj1.updateTime >= this.fetchQuery.cutoffTime) {
                    if (!obj1.flushed) {
                        nodes.push(node);
                        maxNodesLeft--;
                        obj1.flushed = true;
                        this.nodesMap[id1Str] = true;
                    }
                }

                // Populate next level IDs.
                //
                if (this.reverseFetch === ReverseFetch.OFF) {
                    if (!obj1.bottom && this.fetchQuery.cutoffTime <= Math.max(obj1.trailUpdateTime, obj1.updateTime)) {
                        if (!node.isLeaf() &&
                            (!node.hasOnlineId() || node.isOnlineIdValidated())) {

                            this.nextLevelIds[(node.getId() as Buffer).toString("hex")] =
                                node.getId() as Buffer;
                        }
                    }
                }
                else if (this.reverseFetch === ReverseFetch.ALL_PARENTS) {
                    // NOTE: criterias are handled in the SQL-query.
                    //
                    const parentId = node.getParentId();
                    if (parentId) {
                        this.nextLevelIds[parentId.toString("hex")] = parentId;
                    }
                }
                else if (this.reverseFetch === ReverseFetch.ONLY_LICENSED) {
                    // NOTE: criterias are handled in the SQL-query.
                    //
                    if (node.usesParentLicense() && !node.hasOnlineId() &&
                        (!node.hasOnline() || node.isOnline())) {

                        const parentId = node.getParentId();

                        if (parentId) {
                            this.nextLevelIds[parentId.toString("hex")] = parentId;
                        }
                    }
                }
            }

            if (includedLicenses) {
                const licenseNodeId1s: Buffer[] = [];

                const nodesLength2 = nodes.length;
                for (let i=0; i<nodesLength2; i++) {
                    if (maxNodesLeft <= 0) {
                        break;
                    }

                    const node = nodes[i];

                    if (node.isLicensed()) {
                        const nodeId1Str = node.getId1()!.toString("hex");

                        const il = includedLicenses[nodeId1Str] ?? {};

                        const keys = Object.keys(il);

                        const keysLength = keys.length;
                        for (let i=0; i<keysLength; i++) {
                            const licenseId1Str = keys[i];

                            if (!this.nodesMap[licenseId1Str]) {
                                licenseNodeId1s.push(il[licenseId1Str]);
                                maxNodesLeft--;
                                this.nodesMap[licenseId1Str] = true;
                            }

                            if (maxNodesLeft <= 0) {
                                break;
                            }
                        }
                    }
                }

                const licenseNodes: LicenseInterface[] = [];

                while (licenseNodeId1s.length > 0) {
                    licenseNodes.push(
                        ...await this.getNodesById1(
                            licenseNodeId1s.splice(0, MAX_BATCH_SIZE)) as LicenseInterface[]);
                }

                nodes.push(...licenseNodes);
            }

            const isFirst = this.flushCount === 0;

            this.nodeLevelCount = this.nodeLevelCount + nodes.length + embed.length;

            this.nodeCount = this.nodeCount + nodes.length + embed.length;

            if (isFirst || nodes.length > 0 || embed.length > 0) {
                this.flushCount++;

                this.handleFetchReplyData({
                    status: Status.Result, nodes, embed, rowCount: this.rowCount, now: this.now, isFirst});
            }

            if (this.currentRows.length === 0) {
                break;
            }
        }
    }

    protected initNextLevel() {
        this.level++;

        this.currentIds = Object.values(this.nextLevelIds);

        this.nextLevelIds = {};

        this.nodeLevelCount = 0;

        this.currentLevelMatches = this.extractMatches(this.level);
    }

    protected extractMatches(level: number): [Match, MatchState][] {
        const matches: [Match, MatchState][] = [];

        this.fetchQuery.match.forEach( match => {
            if (match.level.length === 0 || match.level.includes(level)) {

                match = DeepCopy(match) as Match;

                const filtersLength = match.filters.length;
                for (let i=0; i<filtersLength; i++) {
                    const filter = match.filters[i];
                    if (filter.field === "creationTime" && Number(filter.value) < 0) {
                        filter.value = String(this.now + Number(filter.value));
                    }
                }

                matches.push([match, {
                    counter: 0,
                    cursorPassed: false,
                    group: {},
                    done: false,
                }]);
            }
        });

        return matches;
    }

    protected levelDone(): boolean {
        const currentLevelMatchesLength = this.currentLevelMatches.length;
        for (let i=0; i<currentLevelMatchesLength; i++) {
            //eslint-disable-next-line @typescript-eslint/no-unused-vars
            const [match, state] = this.currentLevelMatches[i];
            if (!state.done) {
                return false;
            }
        }

        return true;
    }

    protected done(): boolean {
        if (this.fetchQuery.depth > -1 && this.level > this.fetchQuery.depth) {
            return true;
        }

        if (this.rowCount >= MAX_QUERY_ROWS_LIMIT) {
            return true;
        }

        return false;
    }

    public error(): boolean {
        return this._error !== undefined;
    }

    protected hasCurrentIds(): boolean {
        return this.currentIds.length > 0;
    }

    protected hasNextLevel(): boolean {
        return Object.keys(this.nextLevelIds).length > 0;
    }

    protected prepareSQL(currentIds: Buffer[], offset: number, cutoffTime: number = 0): [string, number, any[]] {
        const now = this.now;

        if (!Number.isInteger(now)) {
            throw new Error("now not integer");
        }

        const now2 = now + NOW_TOLERANCE;

        if (!Number.isInteger(offset)) {
            throw new Error("offset not integer");
        }

        if (currentIds.length > MAX_BATCH_SIZE) {
            throw "Max batch size overflow";
        }

        // Calculate a reasonable batch size.
        const limit = Math.min(MAX_QUERY_LEVEL_LIMIT - this.nodeLevelCount,
            MAX_QUERY_ROWS_LIMIT - this.rowCount, this.queryBatchLimit,
            this.fetchQuery.limit > -1 ? this.fetchQuery.limit : MAX_QUERY_LEVEL_LIMIT);

        const params: any[] = [];

        params.push(...currentIds);

        const ph = this.db.generatePlaceholders(currentIds.length);

        const orderByColumn = this.fetchQuery.orderByStorageTime ? "storagetime" : "creationtime";

        let sql: string;

        if (this.reverseFetch === ReverseFetch.OFF) {
            const ordering = this.fetchQuery.descending ? "DESC" : "ASC";

            const secondaryOrdering = this.fetchQuery.orderByStorageTime ? `,creationTime ${ordering}` : "";

            const ignoreInactive = this.fetchQuery.ignoreInactive ? `AND (hasonline = 0 OR isonline = 1)` : "";

            let ignoreOwn = "";
            if (this.fetchQuery.ignoreOwn) {
                const ph = this.db.generatePlaceholders(1, 1, params.length + 1);
                params.push(this.fetchQuery.targetPublicKey);
                ignoreOwn =  `AND owner <> ${ph}`;
            }

            let region = "";
            if (this.fetchQuery.region.length > 0) {
                const regions = RegionUtil.GetRegions(this.fetchQuery.region);

                const ph = this.db.generatePlaceholders(regions.length, 1, params.length + 1);

                params.push(...regions);

                region = this.fetchQuery.region ? `AND (region IS NULL OR region IN ${ph})` : "";
            }

            let jurisdiction = "";
            if (this.fetchQuery.jurisdiction.length > 0) {
                const jurisdictions = RegionUtil.GetJurisdictions(this.fetchQuery.jurisdiction);

                const ph = this.db.generatePlaceholders(jurisdictions.length, 1, params.length + 1);

                params.push(...jurisdictions);

                jurisdiction = this.fetchQuery.jurisdiction ? `AND (jurisdiction IS NULL OR jurisdiction IN ${ph})` : "";
            }

            let cutoff = "";
            if (cutoffTime > 0) {
                cutoff = `AND ${cutoffTime} <= trailupdatetime`;
            }

            sql = `SELECT id1, id2, id, parentid, creationtime, expiretime, region, jurisdiction,
                owner, hasonline, isonline, ispublic, difficulty, transienthash, sharedhash, image,
                storagetime, updatetime, trailupdatetime, islicensed, disallowparentlicensing, isleaf
                FROM openodin_nodes
                WHERE parentid IN ${ph} AND (expiretime IS NULL OR expiretime > ${now})
                AND creationtime <= ${now2}
                ${cutoff} ${ignoreInactive} ${ignoreOwn} ${region} ${jurisdiction}
                ORDER BY ${orderByColumn} ${ordering} ${secondaryOrdering}, id1 ${ordering} LIMIT ${limit} OFFSET ${offset};`;
        }
        else if (this.reverseFetch === ReverseFetch.ALL_PARENTS) {
            sql = `SELECT id1, id2, id, parentid, creationtime, expiretime, region, jurisdiction,
                owner, hasonline, isonline, ispublic, difficulty, transienthash, sharedhash, image,
                storagetime, updatetime, trailupdatetime, islicensed, disallowparentlicensing, isleaf
                FROM openodin_nodes
                WHERE id IN ${ph} AND (expiretime IS NULL OR expiretime > ${now})
                AND creationtime <= ${now2}
                AND isleaf = 0
                ORDER BY ${orderByColumn}, id1 LIMIT ${limit} OFFSET ${offset};`;
        }
        else if (this.reverseFetch === ReverseFetch.ONLY_LICENSED) {
            sql = `SELECT id1, id2, id, parentid, creationtime, expiretime, region, jurisdiction,
                owner, hasonline, isonline, ispublic, difficulty, transienthash, sharedhash, image,
                storagetime, updatetime, trailupdatetime, islicensed, disallowparentlicensing, isleaf
                FROM openodin_nodes
                WHERE id IN ${ph} AND (expiretime IS NULL OR expiretime > ${now})
                AND creationtime <= ${now2}
                AND islicensed = 1 AND disallowparentlicensing = 0 AND isleaf = 0
                ORDER BY ${orderByColumn}, id1 LIMIT ${limit} OFFSET ${offset};`;
        }
        else {
            throw new Error("misconfiguration on reverseFetch");
        }

        return [sql, limit, params];
    }

    /**
     *
     * Updates cursor state, if passed.
     * This is the only state affected by this function.
     *
     * Set obj1.matchIndexes with the matched indexes.
     */
    protected matchFirst(node: NodeInterface, currentLevelMatches: [Match, MatchState][]): boolean {
        let matched = false;

        const idStr = (node.getId() as Buffer).toString("hex");
        const id1Str = (node.getId1() as Buffer).toString("hex");

        const obj1 = this.alreadyProcessedNodes[idStr]?.id1s[id1Str];

        const matchesLength = currentLevelMatches.length;
        for (let index=0; index<matchesLength; index++) {
            const [match, state] = currentLevelMatches[index];

            if (state.done) {
                continue;
            }

            if (match.limit > -1 && state.counter >= match.limit) {
                continue;
            }

            if (!match.nodeType.equals(node.getType().slice(0, match.nodeType.length))) {
                continue;
            }

            if (match.requireId > 0) {
                const parentId = node.getParentId();

                if (!parentId) {
                    continue;
                }

                const parentIdStr = parentId.toString("hex");

                const obj = this.alreadyProcessedNodes[parentIdStr];

                if (!obj) {
                    continue;
                }

                if (!obj.matched.includes(match.requireId)) {
                    continue;
                }
            }

            // filters
            try {
                if (!node.checkFilters(match.filters)) {
                    continue;
                }
            }
            catch(e) {
                console.error(e);
                continue;
            }

            if (match.limitField?.name && match.limitField.name.length > 0) {
                const hashedValue = node.getHashedValue(match.limitField.name);
                if (hashedValue) {
                    const group = state.group[match.limitField.name] ?? {};
                    const counter = (group[hashedValue] ?? 0) + 1;

                    if (counter > match.limitField.limit) {
                        continue;
                    }
                }
            }

            // Can mutate state
            //
            if (match.cursorId1.length > 0 && !state.cursorPassed) {
                if ((node.getId1() as Buffer).equals(match.cursorId1)) {
                    state.cursorPassed = true;
                }

                continue;
            }

            matched = true;

            if (obj1) {
                obj1.matchIndexes.push(index);
            }
        }

        return matched;
    }

    protected matchSecond(nodes: NodeInterface[], currentLevelMatches: [Match, MatchState][]): NodeInterface[] {

        const nodesMatched: NodeInterface[] = [];

        const nodesLength = nodes.length;
        for (let index=0; index<nodesLength; index++) {
            const node = nodes[index];

            const idStr = (node.getId() as Buffer).toString("hex");
            const id1Str = (node.getId1() as Buffer).toString("hex");

            let matched = false;
            let discard = true;
            let bottom  = true;


            const obj1 = this.alreadyProcessedNodes[idStr]?.id1s[id1Str];

            if (!obj1 ) {
                nodesMatched.push(node);
                continue;
            }

            for (const index of obj1.matchIndexes) {
                const [match, state] = currentLevelMatches[index];

                if (state.done) {
                    continue;
                }

                if (match.limit > -1 && state.counter >= match.limit) {
                    state.done = true;
                    continue;
                }

                if (match.limitField?.name && match.limitField.name.length > 0) {
                    const hashedValue = node.getHashedValue(match.limitField.name);
                    if (hashedValue) {
                        const group = state.group[match.limitField.name] ?? {};
                        const counter = (group[hashedValue] ?? 0) + 1;

                        if (counter > match.limitField.limit) {
                            continue;
                        }

                        group[hashedValue] = counter;
                        state.group[match.limitField.name] = group;
                    }
                }

                state.counter++;

                if (match.id > 0) {
                    const obj = this.alreadyProcessedNodes[idStr];
                    obj?.matched.push(match.id);
                }

                if (!match.discard) {
                    discard = false;
                }

                if (!match.bottom) {
                    bottom = false;
                }

                matched = true;
            }

            if (matched) {
                nodesMatched.push(node);

                const idStr = (node.getId() as Buffer).toString("hex");
                const id1Str = (node.getId1() as Buffer).toString("hex");
                const obj = this.alreadyProcessedNodes[idStr] ?? {matched: [], id1s: {}};
                const obj1 = obj.id1s[id1Str];

                if (obj1) {
                    obj1.discard = discard;
                    obj1.bottom  = bottom;
                }
            }
        }

        return nodesMatched;
    }

    /**
     * Return nodes which the caller has permissions to and also nodes which can be embedded.
     *
     */
    public async filterPermissions(allNodes: NodeInterface[],
        allowRightsByAssociation: boolean = true): Promise<PermissionsResult>
    {
        const includedLicensesEmbedded: LicenseInterface[] = [];

        const includeLicenses = (this.fetchQuery.includeLicenses === "Include" ||
            this.fetchQuery.includeLicenses === "IncludeExtend");

        const [allowedNodes, includedLicenses] = await this.filterLicensedNodes(allNodes,
            this.fetchQuery.targetPublicKey, includeLicenses);

        const includeEmbeddableLicenses = (this.fetchQuery.includeLicenses === "Extend" ||
            this.fetchQuery.includeLicenses === "IncludeExtend");

        if (includeEmbeddableLicenses &&
            !this.fetchQuery.targetPublicKey.equals(this.fetchQuery.sourcePublicKey))
        {
            //eslint-disable-next-line @typescript-eslint/no-unused-vars
            const [_, addedEmbeddableLicenses] = await this.filterLicensedNodes(allNodes,
                this.fetchQuery.sourcePublicKey, true);

            const licenseNodeId1s: Buffer[] = [];

            for (const nodeId1Str in addedEmbeddableLicenses) {
                licenseNodeId1s.push(...Object.values(addedEmbeddableLicenses[nodeId1Str]));
            }

            const embeddableLicenses: LicenseInterface[] = [];

            while (licenseNodeId1s.length > 0) {
                embeddableLicenses.push(
                    ...await this.getNodesById1(licenseNodeId1s.splice(0,
                        MAX_BATCH_SIZE)) as LicenseInterface[]);
            }

            const embeddable = embeddableLicenses.filter( license => {
                if (license.isPrivate() && license.isUnique() && !license.canSendPrivately(
                    this.fetchQuery.sourcePublicKey, this.fetchQuery.targetPublicKey) &&
                    license.canSendEmbedded(this.fetchQuery.sourcePublicKey,
                        this.fetchQuery.targetPublicKey)) {

                    return true;
                }

                return false;
            });

            const embeddedNodes = (await this.embedNodes(embeddable)).map( b => b.embeddedNode );

            includedLicensesEmbedded.push(...(embeddedNodes as LicenseInterface[]));
        }

        const [nodes, toEmbed] = await this.filterPrivateNodes(allowedNodes,
            allowRightsByAssociation);

        const embed = await this.embedNodes(toEmbed);

        return {
            nodes,
            embed,
            includedLicenses,
            includedLicensesEmbedded,
        };
    }

    /**
     * Embed nodes and also check if any equivalent already exists.
     *
     * @param nodes nodes to embed
     * @returns the original nodes and their embeddings. Any nodes who
     * cannot be successfully embedded are ignored and not returned.
     */
    protected async embedNodes(nodes: NodeInterface[]):
        Promise<{originalNode: NodeInterface, embeddedNode: NodeInterface}[]>
    {
        const triples: {originalNode: NodeInterface, embeddedNode: NodeInterface, sharedHashStr: string}[] = [];

        const allSharedHashes: Buffer[] = [];

        const friendLicenses: [LicenseInterface, LicenseInterface][] = [];
        const distinctLicenseOwners: {[friendAPublicKey: string]: Buffer} = {};

        const nodesLength = nodes.length;
        for (let i=0; i<nodesLength; i++) {
            const node = nodes[i];

            try {
                const embeddedNode = node.embed(this.fetchQuery.targetPublicKey);

                if (!embeddedNode) {
                    continue;
                }

                // Check if this is a friend license.
                //
                if (node.getType(4).equals(License.GetType(4)) &&
                    embeddedNode.getType(4).equals(License.GetType(4))) {

                    const license = node as LicenseInterface;
                    const embeddedLicense = embeddedNode as LicenseInterface;

                    if (license.getFriendLevel() !== undefined) {
                        const friendAPublicKey = license.getOwner();

                        if (friendAPublicKey) {
                            friendLicenses.push([license, embeddedLicense]);
                            distinctLicenseOwners[friendAPublicKey.toString("hex")] = friendAPublicKey;
                        }

                        continue;
                    }
                }

                const sharedHash = embeddedNode.hashShared();
                const sharedHashStr = sharedHash.toString("hex");

                triples.push({originalNode: node, embeddedNode, sharedHashStr});
                allSharedHashes.push(sharedHash);
            }
            catch(e) {
                // Do nothing
            }
        }

        const friendLicensesLength = friendLicenses.length;

        if (friendLicensesLength > 0) {
            const friendCertPairs = await this.getFriendCerts(Object.values(distinctLicenseOwners));

            for (let i=0; i<friendLicensesLength; i++) {
                const [license, embeddedLicense] = friendLicenses[i];

                const friendAPublicKey = license.getOwner();

                if (!friendAPublicKey) {
                    continue;
                }

                const rows = friendCertPairs[friendAPublicKey.toString("hex")] ?? [];

                if (rows.length === 0) {
                    continue;
                }

                let certsApplied = false;
                const rowsLength = rows.length;
                for (let i2=0; i2<rowsLength; i2++) {
                    const row = rows[i2];

                    const certObjectA = row.aCertObject;
                    const certObjectB = row.bCertObject;

                    if (!certObjectA || !certObjectB) {
                        continue;
                    }

                    if (await this.applyFriendCerts(embeddedLicense, certObjectA, certObjectB)) {
                        certsApplied = true;
                        break;
                    }
                }

                // No certs matched.
                if (!certsApplied) {
                    continue;
                }

                const sharedHash = embeddedLicense.hashShared();
                const sharedHashStr = sharedHash.toString("hex");

                triples.push({originalNode: license, embeddedNode: embeddedLicense, sharedHashStr});
                allSharedHashes.push(sharedHash);
            }
        }

        const existingHashes = await this.getExistingSharedHashes(allSharedHashes);

        return triples.filter( triple => !existingHashes[triple.sharedHashStr] ).map( triple => {
            return {originalNode: triple.originalNode, embeddedNode: triple.embeddedNode}; } );
    }

    /**
     * Attempt to set the friend certificates on the embedded license in place.
     *
     * @param embeddingLicense the license which has embedded the license that has friendLevel set.
     * This license is modified in place with friend certs and possible expireTime.
     * @param aCert the certificate of user A.
     * @param bCert the certificate of user B.
     * @returns boolean true if found and set (the license is modified in place).
     */
    protected async applyFriendCerts(embeddingLicense: LicenseInterface, aCert: FriendCertInterface, bCert: FriendCertInterface): Promise<boolean> {
        const expireTime = embeddingLicense.getExpireTime();  // Save for later.

        const certATargetMaxExpireTime = aCert.getTargetMaxExpireTime();
        const certBTargetMaxExpireTime = bCert.getTargetMaxExpireTime();

        if (certATargetMaxExpireTime !== undefined || certBTargetMaxExpireTime !== undefined) {

            const targetMaxExpireTime = Math.min(
                certATargetMaxExpireTime ?? Number.MAX_SAFE_INTEGER,
                certBTargetMaxExpireTime ?? Number.MAX_SAFE_INTEGER);

            if (expireTime === undefined || targetMaxExpireTime < expireTime) {
                // Limit the license's expireTime to not exceed the friend connections expire time.
                embeddingLicense.setExpireTime(targetMaxExpireTime);
            }
        }

        // Attempt to validate the license now that it has friend certs to see if it validates.
        try {
            embeddingLicense.setFriendACertObject(aCert);
            embeddingLicense.setFriendBCertObject(bCert);

            // Validate embedded license proposal.
            // Parameter 2 means do not validate signatures (since embeddingLicense is not signed yet).
            //
            if (embeddingLicense.validate(2)[0]) {
                // The License is happy with the certs, now check that
                return true;
            }
        }
        catch(e) {
            // try next.
        }

        // Restore values and return.
        embeddingLicense.setExpireTime(expireTime);
        embeddingLicense.setFriendACertObject(undefined);
        embeddingLicense.setFriendBCertObject(undefined);

        return false;
    }

    /**
     * Fetch cert pairs for which the client has permissions to.
     */
    protected async getFriendCerts(licenseOwners: Buffer[]): Promise<{[friendAPublicKey: string]: SelectFriendCertPair[]}> {
        const friendCerts: {[friendAPublicKey: string]: SelectFriendCertPair[]} = {};

        const now = this.now;

        if (!Number.isInteger(now)) {
            throw new Error("now not integer");
        }

        const now2 = now + NOW_TOLERANCE;

        // Sprinkle some reality dust.
        //
        if (licenseOwners.length > 10000) {
            licenseOwners.length = 10000;
        }

        while (licenseOwners.length > 0) {
            const friendAPublicKeys = licenseOwners.splice(0, MAX_BATCH_SIZE);

            const params: Buffer[] = [];

            const ph1 = this.db.generatePlaceholders(1);
            params.push(this.fetchQuery.targetPublicKey);

            const ph2 = this.db.generatePlaceholders(friendAPublicKeys.length, 1, 2);
            params.push(...friendAPublicKeys);

            const sql = `SELECT a.id1 AS aid1, a.issuer AS aissuer, a.constraints AS aconstraints, a.image AS aimage,
                b.id1 AS bid1, b.issuer AS bissuer, b.constraints AS bconstraints, b.image AS bimage
                FROM openodin_friend_certs AS a, openodin_friend_certs AS b,
                openodin_nodes AS nodesa, openodin_nodes AS nodesb
                WHERE b.issuer = ${ph1} AND
                a.issuer IN ${ph2} AND a.constraints = b.constraints
                AND a.id1 = nodesa.id1 AND (nodesa.expiretime IS NULL OR nodesa.expiretime > ${now})
                AND nodesa.creationTime <= ${now2}
                AND b.id1 = nodesb.id1 AND (nodesb.expiretime IS NULL OR nodesb.expiretime > ${now})
                AND nodesb.creationTime <= ${now2};`;

            try {
                const rows = await this.db.all(sql, params);

                const rowsLength = rows.length;

                const id1s: Buffer[] = [];

                for (let index=0; index<rowsLength; index++) {
                    const row = rows[index] as SelectFriendCertPair;
                    id1s.push(row.aid1, row.bid1);
                }

                const nodesWithPermissions = await this.checkSourceNodesPermissions(id1s);

                for (let index=0; index<rowsLength; index++) {
                    const row = rows[index] as SelectFriendCertPair;

                    const id1StrA = row.aid1.toString("hex");
                    const id1StrB = row.bid1.toString("hex");

                    if (nodesWithPermissions[id1StrA] && nodesWithPermissions[id1StrB]) {
                        row.aCertObject = Decoder.DecodeFriendCert(row.aimage);
                        row.bCertObject = Decoder.DecodeFriendCert(row.bimage);

                        const friendAPublicKey = row.aissuer.toString("hex");
                        const list = friendCerts[friendAPublicKey] ?? [];
                        friendCerts[friendAPublicKey] = list;
                        list.push(row);
                    }
                }
            }
            catch(e) {
                console.error(e);
                return {};
            }
        }

        return friendCerts;
    }

    /**
     * This function checks permissions on nodes independent of the running query
     * not for targetPublicKey but for sourcePublicKey.
     *
     * This function must not be used in general to determine if a node can be sent to target.
     *
     * Note that any restrictive writer mode is ignored as the query is never traversing downwards.
     * This is of less importance since we are asking for specific nodes.
     *
     * @param nodeId1s id1s of nodes to check permissions for.
     * @returns object of node id1s which have access permissions.
     */
    protected async checkSourceNodesPermissions(nodeId1s: Buffer[]): Promise<{[id1: string]: boolean}> {
        const nodesWithPermissions: {[id1: string]: boolean} = {};

        const nodes = await this.getNodesById1(nodeId1s);

        const nodesPerParent: {[parentId: string]: NodeInterface[]} = {};
        const parentIdsMap: {[id1Str: string]: Buffer} = {};

        const handleFetchReplyData: HandleFetchReplyData = () => {
            // Do nothing
        };

        const nodesLength = nodes.length;
        for (let i=0; i<nodesLength; i++) {
            const node = nodes[i];
            const id1Str = (node.getId1() as Buffer).toString("hex");

            if (node.isPublic()) {
                nodesWithPermissions[id1Str] = true;
            }
            else if (node.isLicensed() || node.hasRightsByAssociation()) {
                const parentId = node.getParentId();
                if (parentId) {
                    const parentIdStr = parentId.toString("hex");
                    const list = nodesPerParent[parentIdStr] ?? [];
                    nodesPerParent[parentIdStr] = list;
                    list.push(node);
                    parentIdsMap[parentIdStr] = parentId;
                }
            }
            else {
                // Is private.
                // Check is sourcePublicKey has access to the node.
                if (node.canSendPrivately(this.fetchQuery.sourcePublicKey, this.fetchQuery.sourcePublicKey)) {
                    nodesWithPermissions[id1Str] = true;
                }
            }
        }

        const parentIds = Object.values(parentIdsMap);
        const parentIdsLength = parentIds.length;
        for (let i=0; i<parentIdsLength; i++) {
            const parentId = parentIds[i];

            const fetchRequest = ParseSchema(FetchRequestSchema, {query: {
                parentId,
                sourcePublicKey: this.fetchQuery.sourcePublicKey,
                targetPublicKey: this.fetchQuery.sourcePublicKey,  // Yes, sourcePublicKey since it's the source who needs access to the nodes in this case.
                depth: MAX_LICENSE_DISTANCE,
                match: [
                    {
                        nodeType: Buffer.alloc(0),
                        filters: [],
                    }
                ]
            }});

            const queryProcessor =
                new QueryProcessor(this.db, fetchRequest.query, undefined, this.now,
                    handleFetchReplyData, ReverseFetch.ONLY_LICENSED);

            await queryProcessor.run();

            const nodes = nodesPerParent[parentId.toString("hex")] ?? [];

            queryProcessor.injectNodes(nodes);

            const permissionsResult = await queryProcessor.filterPermissions(nodes);

            const nodesLength = permissionsResult.nodes.length;
            for (let i=0; i<nodesLength; i++) {
                const node = permissionsResult.nodes[i];
                const id1Str = (node.getId1() as Buffer).toString("hex");
                nodesWithPermissions[id1Str] = true;
            }
        }

        return nodesWithPermissions;
    }

    protected async getExistingSharedHashes(hashes: Buffer[]): Promise<{[sharedHash: string]: boolean}> {
        if (hashes.length === 0) {
            return {};
        }

        const now = this.now;

        if (!Number.isInteger(now)) {
            throw new Error("now not integer");
        }

        const now2 = now + NOW_TOLERANCE;

        const ph = this.db.generatePlaceholders(hashes.length);

        const sql = `SELECT sharedhash FROM openodin_nodes WHERE sharedhash IN ${ph}
            AND (expiretime IS NULL OR expiretime > ${now})
            AND creationtime <= ${now2};`;

        const rows = await this.db.all(sql, hashes);

        const existingHashes: {[sharedHash: string]: boolean} = {};

        const rowsLength = rows.length;
        for (let index=0; index<rowsLength; index++) {
            const row = rows[index];
            existingHashes[row.sharedhash.toString("hex")] = true;
        }

        return existingHashes;
    }

    /**
     * Filter away licensed nodes for which the caller has no license.
     * Return all non licensed nodes and those licensed nodes who have appropiate licenses.
     *
     * Checking licenses is done in three steps:
     *
     * 1. For each licensed node, fetch it and the nodes upwards if utilizing parent licensing.
     *    Each node entry comes with a set of license hashes (hashes requried to license the node),
     *    and a set of path hashes which can be needed if license nodes have parentPathHash set.
     *
     * 2. Select from the database which of the license hashes exist and are fetch licenses.
     *    Each row returned represents a License.
     *
     * 3. Check again each node if any of its license hashes have been returned from step 2.
     *    If a match is found then check the License details of
     *      a) disallowing retro licensing,
     *      b) requiring a specific parent path hash,
     *
     * The upwards paths checked are the paths this query just traversed downwards and are
     * cached in the alreadyProcessedNodes data structure.
     *
     * @param nodes all nodes to check. Non licensed nodes are returned as they are, while
     * licensed nodes are checked for existing licenses and returned if there is any active license.
     *
     * @param targetPublicKey the public key of the receiver of the nodes and for whom there
     * must exist active licenses for the nodes requested.
     *
     * @param includeLicenses is set to true then return all active licenses for licensed nodes
     * returned. Including licenses for any embedded nodes.
     *
     * @returns tuple of nodes and licenses found (if includeLicenses is set).
     */
    protected async filterLicensedNodes(nodes: NodeInterface[], targetPublicKey: Buffer,
        includeLicenses: boolean = false):
        Promise<[nodes: NodeInterface[],
        includedLicenses: {[nodeId1: string]: {[licenseId1: string]: Buffer}}]>
    {
        const nodeTrees: {[id1: string]: LicenseNodeEntry[]} = {};

        const distinctHashes: {[hash: string]: Buffer} = {};

        const allowedNodes: NodeInterface[] = [];

        const includedLicenses: {[nodeId1: string]: {[licenseId1: string]: Buffer}} = {};

        if (this.allowLicensed) {
            for (const node of nodes) {
                const parentId = node.getParentId();

                if (!parentId) {
                    continue;
                }

                // Check licensed nodes and any licensed embedded nodes.
                //
                let eyesOnNode: NodeInterface | undefined = node;

                const id1List: Buffer[] = [];

                while (eyesOnNode) {
                    const id1 = eyesOnNode.getId1() as Buffer;

                    id1List.push(id1);

                    if (eyesOnNode.isLicensed()) {
                        const parentId2 = eyesOnNode.getParentId();

                        if (!parentId2) {
                            break;
                        }

                        const sameParentId = parentId2.equals(parentId);

                        // Get all relevant licenses hashes for this particular node 
                        //
                        const entries = this.getLicenseNodeTree(eyesOnNode, undefined,
                            targetPublicKey, sameParentId ? undefined : parentId);

                        const id1Concated = id1List.map( id1 => id1.toString("hex") ).join("_");

                        nodeTrees[id1Concated] = entries;

                        // Save all license hashes once so we can fetch the
                        // licenses themselves later on.
                        //
                        for (const entry of entries) {
                            for (const hash of entry.licenseHashes) {
                                distinctHashes[hash.toString("hex")] = hash;
                            }
                        }
                    }

                    if (eyesOnNode.getEmbedded()) {
                        try {
                            const dataModel = eyesOnNode.getEmbeddedObject();
                            // Check if data model is of primary interface Node,
                            // since node is the datamodel which can be licensed.
                            if (dataModel.getType(2).equals(Data.GetType(2))) {
                                eyesOnNode = dataModel as NodeInterface;
                                if (!eyesOnNode.allowEmbed()) {
                                    break;
                                }

                                const parentId2 = eyesOnNode.getParentId();

                                if (!parentId2) {
                                    break;
                                }

                                const sameParentId = parentId2.equals(parentId);

                                if (!sameParentId && !eyesOnNode.allowEmbedMove()) {
                                    // The embedded node has another parentId but it is apparently
                                    // not allowed to be moved around.
                                    break;
                                }
                            }
                            else {
                                // Not a node, do not check any further.
                                eyesOnNode = undefined;
                            }
                        }
                        catch (e) {
                            console.error(e);
                            eyesOnNode = undefined;
                        }
                    }
                    else {
                        eyesOnNode = undefined;
                    }
                }
            }


            // Get as many of all possible relevant licenses as we can.
            //
            const licenseRows = await this.fetchLicenses(Object.values(distinctHashes));

            // Iterate over all nodes AGAIN and now check if any of the relevant licenses
            // needed are available for each licensed node and also for every embedded node
            // which is licensed.
            //
            for (const node of nodes) {
                const parentId = node.getParentId();
                const nodeId1 = node.getId1();

                if (!parentId || !nodeId1) {
                    continue;
                }

                const nodeId1Str = nodeId1.toString("hex");

                const id1List: Buffer[] = [];

                let eyesOnNode: NodeInterface | undefined = node;

                let found = true;

                while (eyesOnNode) {
                    const id1 = eyesOnNode.getId1() as Buffer;

                    id1List.push(id1);

                    if (eyesOnNode.isLicensed()) {
                        const parentId2 = eyesOnNode.getParentId();

                        if (!parentId2) {
                            found = false;
                            break;
                        }

                        const sameParentId = parentId2.equals(parentId);

                        const id1Concated = id1List.map( id1 => id1.toString("hex") ).join("_");

                        const entries = nodeTrees[id1Concated];

                        if (!entries) {
                            found = false;
                            break;
                        }

                        const creationTime = eyesOnNode.getCreationTime() ?? 0;

                        let innerFound = false;

                        for (const entry of entries) {
                            if (entry.distance > 0 && !sameParentId) {
                                // For moved embedded nodes we only accept sibling licenses
                                // of distance 0.
                                continue;
                            }

                            if (entry.distance < eyesOnNode.getLicenseMinDistance()) {
                                continue;
                            }

                            // Note we do not need to check getLicenseMaxDistance
                            // for eyesOnNode since entries was already fetched with that in mind.

                            for (const hash of entry.licenseHashes) {
                                const hashStr = hash.toString("hex");

                                const licenses = licenseRows[hashStr] ?? [];

                                for (const license of licenses) {
                                    if (license.disallowretrolicensing) {
                                        if (license.creationtime > creationTime) {
                                            continue;
                                        }
                                    }

                                    if (license.parentpathhash) {
                                        if (entry.pathHashes.findIndex( hash =>
                                            hash.equals(license.parentpathhash as Buffer)) === -1) {

                                            continue;
                                        }
                                    }

                                    if (includeLicenses) {
                                        // Collect all active licenses, read and write.
                                        //
                                        const id1Str = license.id1.toString("hex");
                                        const o = includedLicenses[nodeId1Str] ?? {};
                                        o[id1Str] = license.id1;
                                        includedLicenses[nodeId1Str] = o;
                                    }

                                    // Check so it is a read license.
                                    //
                                    if (!license.restrictivemodewriter &&
                                        !license.restrictivemodemanager)
                                    {
                                        // We can only allow read license to license the node
                                        // when fetching.
                                        innerFound = true;

                                        if (!includeLicenses) {
                                            // We don't need more confirmation than one license.
                                            break;
                                        }
                                    }

                                    // If it is a write license then keep iterating.
                                    //
                                }

                                if (innerFound && !includeLicenses) {
                                    break;
                                }
                            }

                            if (innerFound && !includeLicenses) {
                                break;
                            }
                        }

                        if (!innerFound) {
                            found = false;
                            break;
                        }
                    }

                    // Load next embedded node to be checked.
                    //
                    if (eyesOnNode.getEmbedded()) {
                        try {
                            const dataModel = eyesOnNode.getEmbeddedObject();
                            // Check if data model is of primary interface Node,
                            // since node is the datamodel which can be licensed.
                            if (dataModel.getType(2).equals(Data.GetType(2))) {
                                eyesOnNode = dataModel as NodeInterface;
                            }
                            else {
                                // Not a node, do not check any further.
                                eyesOnNode = undefined;
                            }
                        }
                        catch (e) {
                            console.error(e);
                            eyesOnNode = undefined;
                        }
                    }
                    else {
                        eyesOnNode = undefined;
                    }
                }

                // Node and all embedded nodes have now been checked.

                if (found) {
                    allowedNodes.push(node);
                }
            }
        }

        return [allowedNodes, includedLicenses];
    }

    /**
     * Filter away nodes who are below a restrictive mode node and lack licenses.
     *
     * For each node extract the hashes needed to license the node for the node's owner.
     *
     * If a node has multiple restrictiveWriterNodes then all of those must have matching licenses.
     *
     * If all has a matching license then the node will be returned.
     *
     * If the node is endRestrictiveWriterMode then all restrictiveWriterNodes it has manage permissions on
     * will be removed from the list.
     *
     * If the node is beginRestrictiveWriterMode then it will add it self to the list to be inherited.
     *
     */
    protected async filterRestrictiveMode(allNodes: NodeInterface[]): Promise<NodeInterface[]> {
        const distinctHashes: {[hash: string]: Buffer} = {};

        for (const node of allNodes) {
            const idStr = (node.getId() as Buffer).toString("hex");
            const id1Str = (node.getId1() as Buffer).toString("hex");

            const obj1 = this.alreadyProcessedNodes[idStr]?.id1s[id1Str];

            if (!obj1) {
                continue;
            }

            for (const restrictiveWriterNode of obj1.restrictiveNodes) {
                const hashes = restrictiveWriterNode.getLicensingHashes(restrictiveWriterNode.getOwner(),
                    node.getOwner());

                for (const hash of hashes) {
                    distinctHashes[hash.toString("hex")] = hash;
                }
            }
        }


        const licenseRows = await this.fetchLicenses(Object.values(distinctHashes), true);


        return allNodes.filter( node => {
            const idStr = (node.getId() as Buffer).toString("hex");
            const id1Str = (node.getId1() as Buffer).toString("hex");

            const obj1 = this.alreadyProcessedNodes[idStr]?.id1s[id1Str];

            if (!obj1 || obj1.restrictiveNodes.length === 0) {
                return true;
            }


            for (const restrictiveWriterNode of obj1.restrictiveNodes) {
                const hashes = restrictiveWriterNode.getLicensingHashes(restrictiveWriterNode.getOwner(),
                    node.getOwner());

                let found = false;
                for (const hash of hashes) {
                    const hashStr = hash.toString("hex");

                    const licenses = licenseRows[hashStr] ?? [];

                    for (const license of licenses) {
                        if (license.restrictivemodemanager) {
                            const id1Str = (restrictiveWriterNode.getId1() as Buffer).toString("hex");
                            obj1.restrictiveManager[id1Str] = true;
                        }

                        if (license.restrictivemodewriter) {
                            found = true;
                        }
                    }
                }

                if (!found) {
                    return false;
                }
            }

            return true;
        });
    }

    /**
     * Get all license hashes eligible to be used checking for licenses from the tree
     * we have built fetching.
     *
     * The node given as argument sets the max distance to traverse updwards in the tree.
     * For each parent upwards we check calculate license hashes which license each node.
     * These hashes are returned.
     *
     * When looking for eligible nodes to use for licensing
     * we check upwards all parents which we have passed when fetching,
     * who also fulfill these criterias:
     *
     * 1. Each parent must it self be licensed.
     * 2. Each parent nodes min/maxLicenseDistance does not matter,
     *    as long as each parent node use parent licenses themselves. It is the first
     *    node given as first argument which decide the maximum distance used.
     * 3. Parents are not fetched if the parent node to get parents by has online id (id2).
     *    We do not go past such a node.
     * 4. A parent is allowed to be validated online, but it must be valid.
     * 5. A parent cannot be configured with disallowParentLicensing.
     *
     * @param node The node to start building the tree from (bottom node).
     * @param ownerPublicKey
     * @param targetPublicKey
     * @param actualParentId if set then only check licenses for node given in arguments,
     * do not check for parent node's licenses. This is because when checking licenses
     * for a node which is embedded and have changed parent, there must be a license
     * below that same parent (sibling node) since parent licensing is not allowed
     * for embedded nodes who have changed their parent because they are embedded
     * into a node which has a different parent.
     *
     * @return array of nodes and each node's set of calculated pathHashes.
     */
    protected getLicenseNodeTree(node: NodeInterface, ownerPublicKey: Buffer | undefined,
        targetPublicKey: Buffer, actualParentId?: Buffer): LicenseNodeEntry[]
    {
        const entries: LicenseNodeEntry[] = [];

        const maxDistance = Math.min(node.getLicenseMaxDistance(),
            actualParentId ? 0 : MAX_LICENSE_DISTANCE);


        let currentLevelNodes: [NodeInterface, Buffer[]][] = [ [node, []] ];

        for (let distance=0; distance<=maxDistance; distance++) {
            const nextLevelNodes: [NodeInterface, Buffer[]][] = [];

            for (const [node, prevHashes] of currentLevelNodes) {
                if (!node.isLicensed()) {
                    continue;
                }

                const licenseHashes = node.getLicensingHashes(ownerPublicKey, targetPublicKey,
                    actualParentId);

                const pathHashes: Buffer[] = prevHashes.map( prevHash => {
                    return Hash([node.getId1() as Buffer, Buffer.from([1]), prevHash]);
                });

                pathHashes.push(Hash(node.getId1() as Buffer));

                entries.push({
                    licenseHashes,
                    pathHashes,
                    distance,
                });

                // Apply some sanity control in max processing tolerated.
                if (entries.length > 10000) {
                    break;
                }

                if (distance > 0 && node.hasOnlineId()) {
                    // We can't step past a parent node who has online id.
                    continue;
                }

                if (!node.usesParentLicense()) {
                    continue;
                }

                // Get parents.
                //
                const parentId = node.getParentId();
                const id = node.getId();
                const id1 = node.getId1();

                if (distance < maxDistance && parentId && id1 && id) {
                    const parentIdStr = parentId.toString("hex");
                    const parentNodes = (this.alreadyProcessedNodes[parentIdStr] ?? {}).id1s ?? {};

                    for (const parentObj1 of Object.values(parentNodes)) {
                        const parentNode = parentObj1.node;

                        if (!parentNode) {
                            continue;
                        }

                        if (!parentObj1.passed) {
                            continue;
                        }

                        if (parentNode.isLeaf()) {
                            continue;
                        }

                        if (!parentNode.isLicensed() || parentNode.disallowParentLicensing()) {
                            continue;
                        }

                        if (parentNode.hasOnline() && !parentNode.isOnline()) {
                            // We can't use a parent node who is not online.
                            continue;
                        }

                        nextLevelNodes.push([parentNode, pathHashes]);
                    }
                }
            }

            currentLevelNodes = nextLevelNodes;
        }

        return entries;
    }


    /**
     * Returns map of all found licenses by their licensing hashes.
     *
     * @param licenseHashes
     * @param selectOnlyWriteLicenses if true then only get for restrictivemodewriter and/or
     * restrictivemodemanager.
     * @returns array of found license rows.
     */
    protected async fetchLicenses(licenseHashes: Buffer[], selectOnlyWriteLicenses: boolean = false):
        Promise<{[hash: string]: SelectLicenseeHash[]}>
    {

        const licenseRows: {[hash: string]: SelectLicenseeHash[]} = {};

        const now = this.now;

        if (!Number.isInteger(now)) {
            throw new Error("now not integer");
        }

        const now2 = now + NOW_TOLERANCE;

        const onlyWriteLicensesSQL = selectOnlyWriteLicenses ?
            "AND (restrictivemodewriter = 1 OR restrictivemodemanager = 1)" : "";

        // Apply some sanity.
        if (licenseHashes.length > 10000) {
            licenseHashes.length = 10000;
        }

        while (licenseHashes.length > 0) {
            const hashes = licenseHashes.splice(0, MAX_BATCH_SIZE);

            const ph = this.db.generatePlaceholders(hashes.length);

            const sql = `SELECT hash, disallowretrolicensing, parentpathhash, restrictivemodewriter,
                restrictivemodemanager, nodes.creationtime AS creationtime, hashes.id1 AS id1
                FROM openodin_licensee_hashes AS hashes, openodin_nodes AS nodes
                WHERE hashes.hash IN ${ph} AND hashes.id1 = nodes.id1
                ${onlyWriteLicensesSQL} AND
                (nodes.expiretime IS NULL OR nodes.expiretime > ${now})
                AND nodes.creationtime <= ${now2};`;

            try {
                const rows = await this.db.all(sql, hashes);

                const rowsLength = rows.length;
                for (let index=0; index<rowsLength; index++) {
                    const row = rows[index] as SelectLicenseeHash;
                    const hashStr = row.hash.toString("hex");
                    const list = licenseRows[hashStr] ?? [];
                    licenseRows[hashStr] = list;
                    list.push(row);
                }
            }
            catch(e) {
                console.error(e);
                return {};
            }
        }

        return licenseRows;
    }

    /**
     * Filter out private nodes which caller does not have rights to,
     * filter nodes to be embedded seperately.
     *
     * @returns tuple of allowedNodes, nodesToEmbed,
     */
    protected async filterPrivateNodes(allNodes: NodeInterface[], allowRightsByAssociation: boolean):
        Promise<[NodeInterface[], NodeInterface[]]>
    {
        const keep: {[index: number]: boolean} = {};
        const checkAssociation: {[index: number]: Buffer} = {};

        const nodesLength = allNodes.length;
        for (let index=0; index<nodesLength; index++) {
            const node = allNodes[index];

            if (node.isPublic() || node.isLicensed()) {
                keep[index] = true;
            }
            else if (node.canSendPrivately(this.fetchQuery.sourcePublicKey, this.fetchQuery.targetPublicKey)) {
                keep[index] = true;
            }
            else if (node.hasRightsByAssociation()) {
                const refId = node.getRefId();
                if (refId && allowRightsByAssociation) {
                    checkAssociation[index] = refId;
                }
            }
        }

        const refIds = Object.values(checkAssociation);

        if (refIds.length > 0) {
            const nodesByRef = await this.getNodesById1(refIds);
            if (nodesByRef.length > 0) {

                const {nodes} = await this.filterPermissions(nodesByRef, false);

                const id1s: {[id1: string]: boolean} = {};

                const nodesLength = nodes.length;
                for (let index=0; index<nodesLength; index++) {
                    const node = nodes[index];
                    const id1Str = node.getId1()!.toString("hex");
                    id1s[id1Str] = true;
                }

                for (const index in checkAssociation) {
                    const refId = checkAssociation[index];
                    const index2 = nodes.findIndex( node2 => node2.getId1()?.equals(refId) );
                    if (index2 > -1) {
                        const node2 = nodes[index2];
                        if ((allNodes[index].getParentId() as Buffer).equals(node2.getParentId() as Buffer)) {
                            if (!node2.hasOnline() || node2.isOnline()) {
                                keep[index] = true;
                            }
                        }
                    }
                }
            }
        }

        const nodes: NodeInterface[] = [];

        const embed: NodeInterface[] = [];

        const nodesLength2 = allNodes.length;
        for (let index=0; index<nodesLength2; index++) {
            if (keep[index]) {
                nodes.push(allNodes[index]);
            }

            const node = allNodes[index];

            if (!keep[index] || node?.getType(4).equals(License.GetType(4))) {
                // If node was not allowed to send privately or if it is a license, then
                // see if we can embed the node to send it.
                // Licenses are a special case where the license created by target will be sent
                // but also it could get embedded towards target and also sent.
                if (node.canSendEmbedded(this.fetchQuery.sourcePublicKey, this.fetchQuery.targetPublicKey) &&
                    node.isUnique() && this.allowEmbedNode(node)) {
                    embed.push(node);
                }
            }
        }

        return [nodes, embed];
    }

    protected allowEmbedNode(node: NodeInterface): boolean {
        if (!this.allowEmbed || this.reverseFetch !== ReverseFetch.OFF) {
            return false;
        }

        const allowEmbed = this.fetchQuery.embed;

        try {
            for (let i=0; i<allowEmbed.length; i++) {
                const ae = allowEmbed[i];
                if (ae.nodeType.equals(node.getType().slice(0, ae.nodeType.length))) {
                    if (node.checkFilters(ae.filters)) {
                        return true;
                    }
                }
            }
        }
        catch(e) {
            console.error("Exception calling node.checkFilters", e);
        }

        return false;
    }

    /**
     * Get nodes by their id1.
     * This function preserves the order of returned nodes with given (found) id1s.
     *
     * @param id1s the ID1s of the nodes.
     */
    protected async getNodesById1(id1s: Buffer[]): Promise<NodeInterface[]> {
        if (id1s.length > MAX_BATCH_SIZE) {
            throw new Error("Overflow in batch size of id1s");
        }

        const ph = this.db.generatePlaceholders(id1s.length);

        const now = this.now;

        if (!Number.isInteger(now)) {
            throw new Error("now not integer");
        }

        const now2 = now + NOW_TOLERANCE;

        const sql = `SELECT image, storagetime FROM openodin_nodes WHERE id1 IN ${ph}
            AND (expiretime IS NULL OR expiretime > ${now})
            AND creationtime <= ${now2};`;

        const rows = await this.db.all(sql, id1s);

        const nodes: NodeInterface[] = [];

        const rowsLength = rows.length;
        for (let index=0; index<rowsLength; index++) {
            try {
                const node = Decoder.DecodeNode(rows[index].image, true);
                node.setTransientStorageTime(rows[index].storagetime);
                nodes.push(node);
            }
            catch(e) {
                console.error(e);
            }
        }

        const nodes2: NodeInterface[] = [];

        // Preserve the order of nodes as given in id1s.
        const id1sLength = id1s.length;
        for (let i=0; i<id1sLength; i++) {
            const id1 = id1s[i];
            const nodesLength = nodes.length;
            for (let i=0; i<nodesLength; i++) {
                const node = nodes[i];
                if ((node.getId1() as Buffer).equals(id1)) {
                    nodes2.push(node);
                }
            }
        }

        return nodes2;
    }
}
