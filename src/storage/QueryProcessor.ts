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
    BaseNodeInterface,
    DataNode,
    DataNodeInterface,
    LicenseNodeInterface,
    LicenseNode,
    FriendCertInterface,
    FriendCert,
    Filter,
    Hash,
    HashList,
    MAX_LICENSE_DISTANCE,
    UnpackNode,
} from "../datamodel";

import {
    FetchQuery,
    Status,
    Match,
} from "../types";

import {
    HandleFetchReplyData,
    MAX_QUERY_LEVEL_LIMIT,
    MAX_QUERY_ROWS_LIMIT,
    SelectLicensingHash,
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
    nodes: BaseNodeInterface[],
    embed: {originalNode: BaseNodeInterface, embeddedNode: BaseNodeInterface}[],
    includedLicenses: {[nodeId1: string]: {[licenseId1: string]: Buffer}},
    includedLicensesEmbedded: LicenseNodeInterface[],
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
    isinactive: number,
    transienthash: Buffer,
    uniquehash: Buffer,
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
    restrictiveNodes: BaseNodeInterface[],
    restrictiveManager: {[id1: string]: boolean},
    trailUpdateTime: number,
    storageTime: number,
    updateTime: number,
    discard: boolean,
    bottom: boolean,
    matchIndexes: number[],
    node: BaseNodeInterface,
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
    protected currentRows: BaseNodeInterface[] = [];

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
        protected readonly rootNode: BaseNodeInterface | undefined,
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
                this.parentId = this.rootNode.getProps().id as Buffer;
            }
            else {
                this.parentId = this.rootNode.getProps().parentId as Buffer;
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
            const flags = this.rootNode.loadFlags();

            const parentIdStr = (this.rootNode.getProps().parentId ?? Buffer.alloc(0)).toString("hex");
            const idStr = (this.rootNode.getProps().id as Buffer).toString("hex");
            const id1Str = (this.rootNode.getProps().id1 as Buffer).toString("hex");
            const owner = this.rootNode.getProps().owner as Buffer;
            const childMinDifficulty = this.rootNode.getProps().childMinDifficulty ?? 0;
            const disallowPublicChildren = flags.disallowPublicChildren ?? false;
            const onlyOwnChildren = flags.onlyOwnChildren ?? false;

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
    public injectNodes(nodes: BaseNodeInterface[]) {
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
            const node = UnpackNode(row.image, true);

            node.getProps().transientStorageTime = row.storagetime;

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
    protected addAlreadyProcessed(node: BaseNodeInterface, storageTime: number, updateTime: number, trailUpdateTime: number): boolean {
        const idStr = (node.getProps().id as Buffer).toString("hex");
        const id1Str = (node.getProps().id1 as Buffer).toString("hex");
        const parentIdStr = (node.getProps().parentId as Buffer).toString("hex");

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
            const flags = node.loadFlags();

            obj1 = {
                childMinDifficulty: node.getProps().childMinDifficulty ?? 0,
                disallowPublicChildren: Boolean(flags.disallowPublicChildren),
                onlyOwnChildren: Boolean(flags.onlyOwnChildren),
                endRestrictiveWriterMode: Boolean(flags.isEndRestrictiveWriteMode),
                beginRestrictiveWriterMode: Boolean(flags.isBeginRestrictiveWriteMode),
                node: node,
                parentId: parentIdStr,
                owner: (node.getProps().owner as Buffer),
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

            if (parentObj1.disallowPublicChildren && node.loadFlags().isPublic) {
                return false;
            }
            else if ((node.getProps().difficulty ?? 0) < parentObj1.childMinDifficulty) {
                return false;
            }
            else if (parentObj1.onlyOwnChildren && !parentObj1.owner.equals((node.getProps().owner as Buffer))) {
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
                        const id1Str = (node.getProps().id1 as Buffer).toString("hex");
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

            const embed: BaseNodeInterface[] = [];

            let nodesToFlush: BaseNodeInterface[] = [];

            const nodes: BaseNodeInterface[] = [];

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

                    if (!includedLicenseEmbedded || !includedLicenseEmbedded.getProps().embedded) {
                        continue;
                    }

                    try {
                        const originalNode = includedLicenseEmbedded.loadEmbedded();

                        const id1Str = (originalNode.getProps().id1 as Buffer).toString("hex");

                        if (!this.includedLicensesEmbedded[id1Str]) {
                            embed.push(includedLicenseEmbedded);
                            this.includedLicensesEmbedded[id1Str] = true;
                            maxNodesLeft--;
                        }
                    }
                    catch(e) {
                        console.debug(e);
                        // Do nothing
                    }
                }

                // We also want to match and alter match state for the nodes being embedded.
                const originalNodes = permissionsResult.embed.map( tuple => tuple.originalNode );

                const nodesToEmbed = this.matchSecond(originalNodes,
                    this.currentLevelMatches).filter(
                        embeddable => {
                            const idStr = (embeddable.getProps().id as Buffer).toString("hex");
                            const id1Str = (embeddable.getProps().id1 as Buffer).toString("hex");
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

                        const id1 = originalNode.getProps().id1 as Buffer;

                        const id1Str = id1.toString("hex");

                        if (this.includedLicensesEmbedded[id1Str]) {
                            continue;
                        }

                        if (id1.equals(node.getProps().id1 as Buffer)) {
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

                const idStr = (node.getProps().id as Buffer).toString("hex");
                const id1Str = (node.getProps().id1 as Buffer).toString("hex");

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

                        // Cannot be leaf nor cannot be inactive when to be used as parent node.
                        //
                        const flags = node.loadFlags();

                        if (!flags.isLeaf && !flags.isInactive) {
                            this.nextLevelIds[(node.getProps().id as Buffer).toString("hex")] =
                                node.getProps().id as Buffer;
                        }
                    }
                }
                else if (this.reverseFetch === ReverseFetch.ALL_PARENTS) {
                    // NOTE: leaf and isinactive criterias are handled in the SQL-query.
                    //
                    const parentId = node.getProps().parentId;

                    if (parentId) {
                        this.nextLevelIds[parentId.toString("hex")] = parentId;
                    }
                }
                else if (this.reverseFetch === ReverseFetch.ONLY_LICENSED) {
                    // NOTE: leaf and isinactive criterias are handled in the SQL-query.
                    //
                    if (node.usesParentLicense()) {
                        const parentId = node.getProps().parentId;

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

                    if (node.loadFlags().isLicensed) {
                        const nodeId1Str = node.getProps().id1!.toString("hex");

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

                const licenseNodes: LicenseNodeInterface[] = [];

                while (licenseNodeId1s.length > 0) {
                    licenseNodes.push(
                        ...await this.getNodesById1(
                            licenseNodeId1s.splice(0, MAX_BATCH_SIZE)) as LicenseNodeInterface[]);
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

            const ignoreInactive = this.fetchQuery.ignoreInactive ? `AND isinactive = 0` : "";

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
                owner, isinactive, ispublic, difficulty, transienthash, uniquehash, image,
                storagetime, updatetime, trailupdatetime, islicensed, disallowparentlicensing, isleaf
                FROM openodin_nodes
                WHERE parentid IN ${ph} AND (expiretime IS NULL OR expiretime > ${now})
                AND creationtime <= ${now2}
                ${cutoff} ${ignoreInactive} ${ignoreOwn} ${region} ${jurisdiction}
                ORDER BY ${orderByColumn} ${ordering} ${secondaryOrdering}, id1 ${ordering} LIMIT ${limit} OFFSET ${offset};`;
        }
        else if (this.reverseFetch === ReverseFetch.ALL_PARENTS) {
            sql = `SELECT id1, id2, id, parentid, creationtime, expiretime, region, jurisdiction,
                owner, isinactive, ispublic, difficulty, transienthash, uniquehash, image,
                storagetime, updatetime, trailupdatetime, islicensed, disallowparentlicensing, isleaf
                FROM openodin_nodes
                WHERE id IN ${ph} AND (expiretime IS NULL OR expiretime > ${now})
                AND creationtime <= ${now2}
                AND isleaf = 0 AND isinactive = 0
                ORDER BY ${orderByColumn}, id1 LIMIT ${limit} OFFSET ${offset};`;
        }
        else if (this.reverseFetch === ReverseFetch.ONLY_LICENSED) {
            sql = `SELECT id1, id2, id, parentid, creationtime, expiretime, region, jurisdiction,
                owner, isinactive, ispublic, difficulty, transienthash, uniquehash, image,
                storagetime, updatetime, trailupdatetime, islicensed, disallowparentlicensing, isleaf
                FROM openodin_nodes
                WHERE id IN ${ph} AND (expiretime IS NULL OR expiretime > ${now})
                AND creationtime <= ${now2}
                AND islicensed = 1 AND disallowparentlicensing = 0 AND isleaf = 0 AND isinactive = 0
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
    protected matchFirst(node: BaseNodeInterface, currentLevelMatches: [Match, MatchState][]): boolean {
        let matched = false;

        const idStr = (node.getProps().id as Buffer).toString("hex");
        const id1Str = (node.getProps().id1 as Buffer).toString("hex");

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

            if (!match.nodeType.equals(node.getProps().modelType!.slice(0, match.nodeType.length))) {
                continue;
            }

            if (match.requireId > 0) {
                const parentId = node.getProps().parentId;

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
                if (!this.checkFilters(node, match.filters)) {
                    continue;
                }
            }
            catch(e) {
                console.error(e);
                continue;
            }

            if (match.limitField?.name && match.limitField.name.length > 0) {
                const hashedValue = node.hashField(match.limitField.name);
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
                if ((node.getProps().id1 as Buffer).equals(match.cursorId1)) {
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

    protected matchSecond(nodes: BaseNodeInterface[], currentLevelMatches: [Match, MatchState][]): BaseNodeInterface[] {

        const nodesMatched: BaseNodeInterface[] = [];

        const nodesLength = nodes.length;
        for (let index=0; index<nodesLength; index++) {
            const node = nodes[index];

            const idStr = (node.getProps().id as Buffer).toString("hex");
            const id1Str = (node.getProps().id1 as Buffer).toString("hex");

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
                    const hashedValue = node.hashField(match.limitField.name);
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

                const idStr = (node.getProps().id as Buffer).toString("hex");
                const id1Str = (node.getProps().id1 as Buffer).toString("hex");
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
    public async filterPermissions(allNodes: BaseNodeInterface[],
        allowRightsByAssociation: boolean = true): Promise<PermissionsResult>
    {
        const includedLicensesEmbedded: LicenseNodeInterface[] = [];

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

            const embeddableLicenses: LicenseNodeInterface[] = [];

            while (licenseNodeId1s.length > 0) {
                embeddableLicenses.push(
                    ...await this.getNodesById1(licenseNodeId1s.splice(0,
                        MAX_BATCH_SIZE)) as LicenseNodeInterface[]);
            }

            const embeddable = embeddableLicenses.filter( license => {
                const flags = license.loadFlags();

                if (!flags.isPublic && !flags.isLicensed && flags.isUnique &&
                    !license.canSendPrivately(this.fetchQuery.sourcePublicKey, this.fetchQuery.targetPublicKey) &&
                    license.canSendEmbedded(this.fetchQuery.sourcePublicKey, this.fetchQuery.targetPublicKey)) {

                    return true;
                }

                return false;
            });

            const embeddedNodes = (await this.embedNodes(embeddable)).map( b => b.embeddedNode );

            includedLicensesEmbedded.push(...(embeddedNodes as LicenseNodeInterface[]));
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
    protected async embedNodes(nodes: BaseNodeInterface[]):
        Promise<{originalNode: BaseNodeInterface, embeddedNode: BaseNodeInterface}[]>
    {
        const triples: {originalNode: BaseNodeInterface, embeddedNode: BaseNodeInterface, uniqueHashStr: string}[] = [];

        const allUniqueHashes: Buffer[] = [];

        const friendLicenses: [LicenseNodeInterface, LicenseNodeInterface][] = [];
        const distinctLicenseOwners: {[friendAPublicKey: string]: Buffer} = {};

        const nodesLength = nodes.length;
        for (let i=0; i<nodesLength; i++) {
            const node = nodes[i];

            try {
                // The outer node
                let embeddedNode: LicenseNodeInterface | DataNodeInterface | undefined = undefined;

                if (LicenseNode.Is(node.getProps().modelType)) {
                    embeddedNode = (node as LicenseNodeInterface).embed(this.fetchQuery.targetPublicKey);
                }
                else if (DataNode.Is(node.getProps().modelType)) {
                    embeddedNode = (node as DataNodeInterface).embed(this.fetchQuery.targetPublicKey);
                }

                if (!embeddedNode) {
                    continue;
                }

                // Check if this is a friend license.
                //
                if (LicenseNode.Is(node.getProps().modelType) &&
                    LicenseNode.Is(embeddedNode.getProps().modelType)) {

                    const license = node as LicenseNodeInterface;
                    const extendedLicense = embeddedNode as LicenseNodeInterface;

                    if (license.getProps().friendLevel !== undefined) {
                        const friendAPublicKey = license.getProps().owner;

                        if (friendAPublicKey) {
                            friendLicenses.push([license, extendedLicense]);

                            distinctLicenseOwners[friendAPublicKey.toString("hex")] =
                                friendAPublicKey;
                        }

                        continue;
                    }
                }

                embeddedNode.pack();

                const uniqueHash = embeddedNode.uniqueHash();

                const uniqueHashStr = uniqueHash.toString("hex");

                triples.push({originalNode: node, embeddedNode, uniqueHashStr});

                allUniqueHashes.push(uniqueHash);
            }
            catch(e) {
                console.debug(e);
                // Do nothing
            }
        }

        const friendLicensesLength = friendLicenses.length;

        if (friendLicensesLength > 0) {
            // For every license owner, get all possible licenses to match.
            //
            const friendCertPairs = await this.getFriendCerts(Object.values(distinctLicenseOwners));

            for (let i=0; i<friendLicensesLength; i++) {
                const [license, extendedLicense] = friendLicenses[i];

                const friendAPublicKey = license.getProps().owner;

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

                    const aCert = row.aCert;
                    const bCert = row.bCert;

                    if (!aCert || !bCert) {
                        continue;
                    }

                    if (await this.applyFriendCerts(extendedLicense, aCert, bCert)) {
                        certsApplied = true;
                        break;
                    }
                }

                // No certs matched.
                if (!certsApplied) {
                    continue;
                }

                extendedLicense.pack();

                const uniqueHash = extendedLicense.uniqueHash();
                const uniqueHashStr = uniqueHash.toString("hex");

                triples.push({originalNode: license, embeddedNode: extendedLicense, uniqueHashStr});

                allUniqueHashes.push(uniqueHash);
            }
        }

        const existingHashes = await this.getExistingUniqueHashes(allUniqueHashes);

        return triples.filter( triple => !existingHashes[triple.uniqueHashStr] ).map( triple => {
            return {originalNode: triple.originalNode, embeddedNode: triple.embeddedNode}; } );
    }

    /**
     * Attempt to set the friend certificates on the embedded license in place.
     *
     * @param extendedLicense the license which has embedded the license that has friendLevel set.
     * This license is modified in place with friend certs and possible expireTime.
     * @param aCert the certificate of user A.
     * @param bCert the certificate of user B.
     * @returns boolean true if found and set (the license is modified in place).
     */
    protected async applyFriendCerts(extendedLicense: LicenseNodeInterface, aCert: FriendCertInterface, bCert: FriendCertInterface): Promise<boolean> {
        const expireTime = extendedLicense.getProps().expireTime;  // Save for later.

        const certALicenseMaxExpireTime = aCert.getProps().licenseMaxExpireTime;
        const certBLicenseMaxExpireTime = bCert.getProps().licenseMaxExpireTime;

        if (certALicenseMaxExpireTime !== undefined || certBLicenseMaxExpireTime !== undefined) {

            const licenseMaxExpireTime = Math.min(
                certALicenseMaxExpireTime ?? Number.MAX_SAFE_INTEGER,
                certBLicenseMaxExpireTime ?? Number.MAX_SAFE_INTEGER);

            if (expireTime === undefined || licenseMaxExpireTime < expireTime) {
                // Limit the license's expireTime to not exceed the friend connections expire time.
                extendedLicense.getProps().expireTime = licenseMaxExpireTime;
            }
        }

        // Attempt to validate the license now that it has friend certs to see if it validates.
        try {
            extendedLicense.getProps().friendCert1 = aCert.getProps();
            extendedLicense.getProps().friendCert2 = bCert.getProps();

            // Deep validate embedded license proposal.
            //
            if (extendedLicense.validate(true)[0]) {
                // The License is happy with the certs.
                // Return with values set.
                //
                return true;
            }
        }
        catch(e) {
            // Fall through.
        }

        // Restore values and return.
        //
        extendedLicense.getProps().expireTime = expireTime;
        extendedLicense.getProps().friendCert1 = undefined;
        extendedLicense.getProps().friendCert2 = undefined;

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

            const sql = `SELECT a.id1 AS aid1, a.owner AS aowner, a.constraints AS aconstraints,
                a.image AS aimage, b.id1 AS bid1, b.owner AS bowner,
                b.constraints AS bconstraints, b.image AS bimage
                FROM openodin_friend_certs AS a, openodin_friend_certs AS b,
                openodin_nodes AS nodesa, openodin_nodes AS nodesb
                WHERE b.owner = ${ph1} AND
                a.owner IN ${ph2} AND a.constraints = b.constraints
                AND a.id1 = nodesa.id1 AND (nodesa.expiretime IS NULL OR nodesa.expiretime > ${now})
                AND nodesa.creationTime <= ${now2}
                AND b.id1 = nodesb.id1 AND (nodesb.expiretime IS NULL OR nodesb.expiretime > ${now})
                AND nodesb.creationTime <= ${now2};`;

            const rows = await this.db.all(sql, params);

            const rowsLength = rows.length;

            const id1s: Buffer[] = [];

            for (let index=0; index<rowsLength; index++) {
                const row = rows[index] as SelectFriendCertPair;
                id1s.push(row.aid1, row.bid1);
            }

            const nodesWithPermissions = await this.checkSourceNodesPermissions(id1s);

            for (let index=0; index<rowsLength; index++) {
                try {
                    const row = rows[index] as SelectFriendCertPair;

                    const id1StrA = row.aid1.toString("hex");
                    const id1StrB = row.bid1.toString("hex");

                    if (nodesWithPermissions[id1StrA] && nodesWithPermissions[id1StrB]) {
                        row.aCert = new FriendCert(row.aimage);

                        row.aCert.unpack();

                        row.bCert = new FriendCert(row.bimage);

                        row.bCert.unpack();

                        const friendAPublicKey = row.aowner.toString("hex");
                        const list = friendCerts[friendAPublicKey] ?? [];
                        friendCerts[friendAPublicKey] = list;
                        list.push(row);
                    }
                }
                catch(e) {
                    console.error(e);
                    // Do nothing
                }
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

        const nodesPerParent: {[parentId: string]: BaseNodeInterface[]} = {};
        const parentIdsMap: {[id1Str: string]: Buffer} = {};

        const handleFetchReplyData: HandleFetchReplyData = () => {
            // Do nothing
        };

        const nodesLength = nodes.length;
        for (let i=0; i<nodesLength; i++) {
            const node = nodes[i];
            const id1Str = (node.getProps().id1 as Buffer).toString("hex");

            const flags = node.loadFlags();

            if (flags.isPublic) {
                nodesWithPermissions[id1Str] = true;
            }
            else if (flags.isLicensed || flags.hasRightsByAssociation) {
                const parentId = node.getProps().parentId;
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
                const id1Str = (node.getProps().id1 as Buffer).toString("hex");
                nodesWithPermissions[id1Str] = true;
            }
        }

        return nodesWithPermissions;
    }

    protected async getExistingUniqueHashes(hashes: Buffer[]): Promise<{[uniqueHash: string]: boolean}> {
        if (hashes.length === 0) {
            return {};
        }

        const now = this.now;

        if (!Number.isInteger(now)) {
            throw new Error("now not integer");
        }

        const now2 = now + NOW_TOLERANCE;

        const ph = this.db.generatePlaceholders(hashes.length);

        const sql = `SELECT uniquehash FROM openodin_nodes WHERE uniquehash IN ${ph}
            AND (expiretime IS NULL OR expiretime > ${now})
            AND creationtime <= ${now2};`;

        const rows = await this.db.all(sql, hashes);

        const existingHashes: {[uniqueHash: string]: boolean} = {};

        const rowsLength = rows.length;
        for (let index=0; index<rowsLength; index++) {
            const row = rows[index];
            existingHashes[row.uniquehash.toString("hex")] = true;
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
    protected async filterLicensedNodes(nodes: BaseNodeInterface[], targetPublicKey: Buffer,
        includeLicenses: boolean = false):
        Promise<[nodes: BaseNodeInterface[],
        includedLicenses: {[nodeId1: string]: {[licenseId1: string]: Buffer}}]>
    {
        const nodeTrees: {[id1: string]: LicenseNodeEntry[]} = {};

        const distinctHashes: {[hash: string]: Buffer} = {};

        const allowedNodes: BaseNodeInterface[] = [];

        const includedLicenses: {[nodeId1: string]: {[licenseId1: string]: Buffer}} = {};

        // First part is only relevant to run if QueryProcessor is allowed to return licensed nodes at all.
        //
        if (this.allowLicensed) {
            for (const node of nodes) {
                const parentId = node.getProps().parentId;

                if (!parentId) {
                    continue;
                }

                // Check licensed nodes and any licensed embedded nodes.
                //
                let eyesOnNode: BaseNodeInterface | undefined = node;

                const id1List: Buffer[] = [];

                while (eyesOnNode) {
                    const id1 = eyesOnNode.getProps().id1 as Buffer;

                    id1List.push(id1);

                    if (eyesOnNode.loadFlags().isLicensed) {
                        const parentId2 = eyesOnNode.getProps().parentId;

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

                    // Check for embedded licensed node
                    if (!DataNode.Is(eyesOnNode.getProps().modelType)) {
                        // We only look for embedded nodes in data nodes.
                        break;
                    }

                    const dataNode = eyesOnNode as DataNodeInterface;

                    if (dataNode.getProps().embedded) {
                        try {
                            const embeddedDataNode = dataNode.loadEmbedded();

                            const flags = embeddedDataNode.loadFlags();

                            if (!flags.allowEmbed) {
                                break;
                            }

                            const parentId2 = embeddedDataNode.getProps().parentId;

                            if (!parentId2) {
                                break;
                            }

                            const sameParentId = parentId2.equals(parentId);

                            if (!sameParentId && !flags.allowEmbedMove) {
                                // The embedded node has another parentId but it is apparently
                                // not allowed to be moved around.
                                break;
                            }

                            eyesOnNode = embeddedDataNode;
                        }
                        catch (e) {
                            console.error(e);
                            break;
                        }
                    }
                    else {
                        break;
                    }
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
            const parentId = node.getProps().parentId;
            const nodeId1 = node.getProps().id1;

            if (!parentId || !nodeId1) {
                continue;
            }

            const nodeId1Str = nodeId1.toString("hex");

            const id1List: Buffer[] = [];

            let eyesOnNode: BaseNodeInterface | undefined = node;

            let found = true;

            while (eyesOnNode) {
                const id1 = eyesOnNode.getProps().id1 as Buffer;

                id1List.push(id1);

                if (eyesOnNode.loadFlags().isLicensed) {
                    const parentId2 = eyesOnNode.getProps().parentId;

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

                    const creationTime = eyesOnNode.getProps().creationTime ?? 0;

                    let innerFound = false;

                    for (const entry of entries) {
                        if (entry.distance > 0 && !sameParentId) {
                            // For moved embedded nodes we only accept sibling licenses
                            // of distance 0.
                            continue;
                        }

                        if (entry.distance < (eyesOnNode.getProps().licenseMinDistance ?? 0)) {
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

                // Check for embedded licensed node
                if (!DataNode.Is(eyesOnNode.getProps().modelType)) {
                    // We only look for embedded nodes in data nodes.
                    break;
                }

                const dataNode = eyesOnNode as DataNodeInterface;

                // Load next embedded node to be checked.
                //
                if (dataNode.getProps().embedded) {
                    try {
                        eyesOnNode = dataNode.loadEmbedded();
                    }
                    catch (e) {
                        console.error(e);
                        break;
                    }
                }
                else {
                    break;
                }
            }

            // Node and all embedded nodes have now been checked.

            if (found) {
                allowedNodes.push(node);
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
    protected async filterRestrictiveMode(allNodes: BaseNodeInterface[]): Promise<BaseNodeInterface[]> {
        const distinctHashes: {[hash: string]: Buffer} = {};

        for (const node of allNodes) {
            const idStr = (node.getProps().id as Buffer).toString("hex");
            const id1Str = (node.getProps().id1 as Buffer).toString("hex");

            const obj1 = this.alreadyProcessedNodes[idStr]?.id1s[id1Str];

            if (!obj1) {
                continue;
            }

            for (const restrictiveWriterNode of obj1.restrictiveNodes) {
                const hashes = restrictiveWriterNode.getLicenseHashes(true, restrictiveWriterNode.getProps().owner,
                    node.getProps().owner);

                for (const hash of hashes) {
                    distinctHashes[hash.toString("hex")] = hash;
                }
            }
        }


        const licenseRows = await this.fetchLicenses(Object.values(distinctHashes));


        return allNodes.filter( node => {
            const idStr = (node.getProps().id as Buffer).toString("hex");
            const id1Str = (node.getProps().id1 as Buffer).toString("hex");

            const obj1 = this.alreadyProcessedNodes[idStr]?.id1s[id1Str];

            if (!obj1 || obj1.restrictiveNodes.length === 0) {
                return true;
            }


            for (const restrictiveWriterNode of obj1.restrictiveNodes) {
                const hashes = restrictiveWriterNode.getLicenseHashes(true, restrictiveWriterNode.getProps().owner,
                    node.getProps().owner);

                let found = false;
                for (const hash of hashes) {
                    const hashStr = hash.toString("hex");

                    const licenses = licenseRows[hashStr] ?? [];

                    for (const license of licenses) {
                        if (license.restrictivemodemanager) {
                            const id1Str = (restrictiveWriterNode.getProps().id1 as Buffer).toString("hex");
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
     * 3. Parents are not fetched if the parent node to get parents by is inactive.
     * 4. A parent cannot be configured with disallowParentLicensing.
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
    protected getLicenseNodeTree(node: BaseNodeInterface, ownerPublicKey: Buffer | undefined,
        targetPublicKey: Buffer, actualParentId?: Buffer): LicenseNodeEntry[]
    {
        const entries: LicenseNodeEntry[] = [];

        const maxDistance = Math.min(node.getProps().licenseMaxDistance ?? 0,
            actualParentId ? 0 : MAX_LICENSE_DISTANCE);


        let currentLevelNodes: [BaseNodeInterface, Buffer[]][] = [ [node, []] ];

        for (let distance=0; distance<=maxDistance; distance++) {
            const nextLevelNodes: [BaseNodeInterface, Buffer[]][] = [];

            for (const [node, prevHashes] of currentLevelNodes) {
                const flags = node.loadFlags();

                if (!flags.isLicensed || flags.isInactive) {
                    continue;
                }

                const licenseHashes = node.getLicenseHashes(false, ownerPublicKey, targetPublicKey,
                    actualParentId);

                const pathHashes: Buffer[] = prevHashes.map( prevHash => {
                    return HashList([node.getProps().id1 as Buffer, Buffer.from([1]), prevHash]);
                });

                pathHashes.push(Hash(node.getProps().id1 as Buffer));

                entries.push({
                    licenseHashes,
                    pathHashes,
                    distance,
                });

                // Apply some sanity control in max processing tolerated.
                if (entries.length > 10000) {
                    break;
                }

                if (!node.usesParentLicense()) {
                    continue;
                }

                // Get parents.
                //
                const parentId = node.getProps().parentId;
                const id = node.getProps().id;
                const id1 = node.getProps().id1;

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

                        const parentFlags = parentNode.loadFlags();

                        if (parentFlags.isLeaf) {
                            continue;
                        }

                        if (!parentFlags.isLicensed || parentFlags.disallowParentLicensing) {
                            continue;
                        }

                        if (parentFlags.isInactive) {
                            // We can't use a parent node which is inactive.
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
     * Inactive license nodes are ignored.
     *
     * @param licenseHashes
     * @returns array of found license rows.
     */
    protected async fetchLicenses(licenseHashes: Buffer[]):
        Promise<{[hash: string]: SelectLicensingHash[]}>
    {

        const licenseRows: {[hash: string]: SelectLicensingHash[]} = {};

        const now = this.now;

        if (!Number.isInteger(now)) {
            throw new Error("now not integer");
        }

        const now2 = now + NOW_TOLERANCE;

        // Apply some sanity.
        if (licenseHashes.length > 10000) {
            licenseHashes.length = 10000;
        }

        while (licenseHashes.length > 0) {
            const hashes = licenseHashes.splice(0, MAX_BATCH_SIZE);

            const ph = this.db.generatePlaceholders(hashes.length);

            const sql = `SELECT hash, disallowretrolicensing, parentpathhash, restrictivemodewriter,
                restrictivemodemanager, nodes.creationtime AS creationtime, hashes.id1 AS id1
                FROM openodin_licensing_hashes AS hashes, openodin_nodes AS nodes
                WHERE hashes.hash IN ${ph} AND hashes.id1 = nodes.id1 AND
                (nodes.expiretime IS NULL OR nodes.expiretime > ${now})
                AND nodes.creationtime <= ${now2} AND nodes.isinactive = 0;`;

            try {
                const rows = await this.db.all(sql, hashes);

                const rowsLength = rows.length;
                for (let index=0; index<rowsLength; index++) {
                    const row = rows[index] as SelectLicensingHash;
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
    protected async filterPrivateNodes(allNodes: BaseNodeInterface[], allowRightsByAssociation: boolean):
        Promise<[BaseNodeInterface[], BaseNodeInterface[]]>
    {
        const keep: {[index: number]: boolean} = {};
        const checkAssociation: {[index: number]: Buffer} = {};

        const nodesLength = allNodes.length;
        for (let index=0; index<nodesLength; index++) {
            const node = allNodes[index];

            const flags = node.loadFlags();

            if (flags.isPublic || flags.isLicensed) {
                keep[index] = true;
            }
            else if (node.canSendPrivately(this.fetchQuery.sourcePublicKey, this.fetchQuery.targetPublicKey)) {
                keep[index] = true;
            }
            else if (flags.hasRightsByAssociation) {
                const refId = node.getProps().refId;
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
                    const id1Str = node.getProps().id1!.toString("hex");
                    id1s[id1Str] = true;
                }

                for (const index in checkAssociation) {
                    const refId = checkAssociation[index];
                    const index2 = nodes.findIndex( node2 => node2.getProps().id1?.equals(refId) );
                    if (index2 > -1) {
                        const node2 = nodes[index2];
                        if ((allNodes[index].getProps().parentId as Buffer).equals(node2.getProps().parentId as Buffer)) {
                            if (!node2.loadFlags().isInactive) {
                                keep[index] = true;
                            }
                        }
                    }
                }
            }
        }


        const nodes: BaseNodeInterface[] = [];

        const embed: BaseNodeInterface[] = [];

        const nodesLength2 = allNodes.length;
        for (let index=0; index<nodesLength2; index++) {
            const node = allNodes[index];

            if (keep[index]) {
                nodes.push(allNodes[index]);
                // Fall through
            }

            const flags = node.loadFlags();

            //if (!keep[index] || LicenseNode.Is(node?.getProps().modelType)) {
            if (flags.allowEmbed && flags.isUnique) {
                // If node was not allowed to send privately or if it is a license, then
                // see if we can embed the node to send it.
                // Licenses are a special case where the license created by target will be sent
                // but also it could get embedded towards target and also sent.
                if (node.canSendEmbedded(this.fetchQuery.sourcePublicKey, this.fetchQuery.targetPublicKey) &&
                    this.allowEmbedNode(node)) {
                    embed.push(node);
                }
            }
        }

        return [nodes, embed];
    }

    protected allowEmbedNode(node: BaseNodeInterface): boolean {
        if (!this.allowEmbed || this.reverseFetch !== ReverseFetch.OFF) {
            return false;
        }

        const allowEmbed = this.fetchQuery.embed;

        try {
            for (let i=0; i<allowEmbed.length; i++) {
                const ae = allowEmbed[i];
                if (ae.nodeType.equals(node.getProps().modelType!.slice(0, ae.nodeType.length))) {
                    if (this.checkFilters(node, ae.filters)) {
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
    protected async getNodesById1(id1s: Buffer[]): Promise<BaseNodeInterface[]> {
        if (id1s.length > MAX_BATCH_SIZE) {
            throw new Error("Overflow in batch size of id1s");
        }

        if (id1s.length === 0) {
            return [];
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

        const nodes: BaseNodeInterface[] = [];

        const rowsLength = rows.length;
        for (let index=0; index<rowsLength; index++) {
            try {
                const node = UnpackNode(rows[index].image, true);

                node.getProps().transientStorageTime = rows[index].storagetime;

                nodes.push(node);
            }
            catch(e) {
                console.error(e);
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
     * Check a list of filters against a node.
     *
     * @param filters list of filters to compare to, if empty list then this function returns true.
     * @returns false if any filter does not match this node, true if all filters match.
     * @throws on badly formatted filters.
     */
    public checkFilters(node: BaseNodeInterface, filters: Filter[]): boolean {
        for (let index=0; index<filters.length; index++) {
            const filter = filters[index];

            if (!node.filter(filter)) {
                return false;
            }
        }

        return true;
    }
}
