import { strict as assert } from "assert";

import {
    ExpectingReply,
} from "pocket-messaging";

import {
    CRDTManager,
} from "./crdt/CRDTManager";

import {
    P2PClient,
    HandlerFn,
    SendResponseFn,
} from "../p2pclient";

import {TimeFreeze} from "./TimeFreeze";

import {
    SignatureOffloaderInterface,
} from "../signatureoffloader/types";

import {
    Decoder,
} from "../decoder";

import {
    NodeInterface,
    DataInterface,
    Hash,
    DATA_NODE_TYPE,
} from "../datamodel";

import {
    Status,
    StoreRequest,
    StoreResponse,
    FetchRequest,
    FetchResponse,
    UnsubscribeRequest,
    UnsubscribeResponse,
    WriteBlobRequest,
    WriteBlobResponse,
    ReadBlobRequest,
    ReadBlobResponse,
    MESSAGE_SPLIT_BYTES,
} from "../types";

import {
    HandleFetchReplyData,
    FetchReplyData,
    DriverInterface,
    BlobDriverInterface,
    Trigger,
    MAX_READBLOB_LENGTH,
    MAX_BATCH_SIZE,
} from "./types";

import {
    CopyBuffer,
    DeepCopy,
    sleep,
} from "../util/common";

import {
    Mutex,
    Lock,
} from "../util/Lock";

import {
    PocketConsole,
} from "pocket-console";

/** How many retries to do if database is busy. */
const MAX_BUSY_RETRIES = 3;

/** The BUSY errors for SQLite, SQLiteJS and for the PostgreSQL driver we are using. */
const BUSY_ERRORS = ["SQLITE_BUSY: database is locked", "canceling statement due to lock timeout"];

const console = PocketConsole({module: "Storage"});

const EMPTY_FETCHRESPONSE: FetchResponse = {
    status: Status.RESULT,
    result: {
        nodes: [],
        embed: [],
        cutoffTime: 0n,
    },
    crdtResult: {
        delta: Buffer.alloc(0),
        length: 0,
        cursorIndex: -1,
    },
    rowCount: 0,
    error: "",
    seq: 0,
    endSeq: 0,
};

/**
 * The Storage is an object instance which is connected to a client via a P2PClient object.
 * It facilitates requests from the client to the underlaying database via the Driver.
 */
export class Storage {
    protected p2pClient: P2PClient;

    /** The driver object provided in the constructor. */
    protected driver: DriverInterface;

    /** The driver used for blob data. */
    protected blobDriver?: BlobDriverInterface;

    /**
     * Transient values are properties which a node can hold but is not necessarily persisted to
     * storage and is never part of the hashing a node.
     *
     * Transient values represent states a node can hold although the data of the node is still
     * immutable.
     *
     * A fetch request can request that transient values are preserved over serialization boundaries,
     * while a store request can request the transient properties of the nodes it is storing be
     * preserved to the storage.
     *
     * The allowPreserveTransient property of the Storage must be set to true to allow store
     * requests to preserve transient properties.
     */
    protected allowPreserveTransient: boolean;

    protected triggerTimeout: ReturnType<typeof setTimeout> | undefined;

    protected signatureOffloader: SignatureOffloaderInterface;

    protected triggers: {[parentId: string]: Trigger[]} = {};

    /**
     * TimeFreeze is used to keep track of timestamps used for cutoff of results to minimize
     * the duplication of nodes in return data sets.
     * This is an at-least-once system.
     */
    protected timeFreeze: TimeFreeze;

    protected triggerTimeoutInterval = 10000;

    protected crdtManager: CRDTManager;

    protected lock: Lock;

    /**
     * @param p2pClient the connection to the client.
     * @param signatureOffloader
     * @param driver
     * @param blobDriver if provided it must not use the same underlaying connection as the driver.
     * @param allowPreserveTransient set to true to allow store requests to also store the transient
     * values of the nodes.
     * @throws on misconfiguration
     */
    constructor(
        p2pClient: P2PClient,
        signatureOffloader: SignatureOffloaderInterface,
        driver: DriverInterface,
        blobDriver?: BlobDriverInterface,
        allowPreserveTransient: boolean = false,
    ) {
        this.p2pClient = p2pClient;

        this.signatureOffloader = signatureOffloader;
        this.driver = driver;
        this.blobDriver = blobDriver;
        this.allowPreserveTransient = allowPreserveTransient;

        this.timeFreeze = new TimeFreeze();
        this.triggerTimeout = setTimeout( this.triggersTimeout, this.triggerTimeoutInterval );

        this.crdtManager = new CRDTManager();

        this.lock = new Lock();
    }

    /**
     * Always call this after instantiating the Storage.
     * It will hook the p2p events.
     */
    public init() {
        this.driver.onClose( () => this.close());
        this.blobDriver?.onClose( () => this.close());
        this.p2pClient.onStore( this.handleStore );
        this.p2pClient.onFetch( this.handleFetch );
        this.p2pClient.onUnsubscribe( this.handleUnsubscribe );
        this.p2pClient.onReadBlob( this.handleReadBlob );
        this.p2pClient.onWriteBlob( this.handleWriteBlob );
        this.p2pClient.onClose( this.handleClose );
    }

    /**
     * Close the Storage by closing the connection to the client.
     * Note that the database instance is not automatically closed when the storage is closed,
     * but the storage is automatically closed when the database is closed or when the p2pclient
     * is closed.
     */
    public close() {
        this.p2pClient.close();
    }

    /**
     * Add on close event handler to the p2pClient object to get notified when the
     * storage instance closes.
     */
    public onClose(cb: (peer: P2PClient) => void) {
        this.p2pClient.onClose(cb);
    }

    protected handleClose = () => {
        if (this.triggerTimeout) {
            clearTimeout(this.triggerTimeout);
            this.triggerTimeout = undefined;
        }

        this.crdtManager.close();
    };

    protected handleStore: HandlerFn<StoreRequest, StoreResponse> =
        async (storeRequest: StoreRequest, peer: P2PClient, fromMsgId: Buffer,
            expectingReply: ExpectingReply, sendResponse?: SendResponseFn<StoreResponse>) =>
    {

        let ts: number | undefined;

        // Collect all locks here in case finally needs to release all locks.
        const locks: Mutex[] = [];

        try {
            if (storeRequest.targetPublicKey.length === 0) {
                throw new Error("targetPublicKey expected to be set");
            }

            if (storeRequest.sourcePublicKey.length === 0) {
                throw new Error("sourcePublicKey expected to be set");
            }

            if (storeRequest.preserveTransient && !this.allowPreserveTransient) {
                if (sendResponse) {
                    const error = "StoreRequest not allowed to use preserveTransient for this connection.";
                    const errorStoreResponse: StoreResponse = {
                        status: Status.MALFORMED,
                        storedId1s: [],
                        missingBlobId1s: [],
                        missingBlobSizes: [],
                        error,
                    };

                    sendResponse(errorStoreResponse);
                }

                return;
            }

            const now = this.timeFreeze.now();

            const decodedNodes: NodeInterface[] = [];
            const images = storeRequest.nodes;
            const imagesLength = images.length;
            for (let index=0; index<imagesLength; index++) {
                const image = images[index];
                try {
                    const node = Decoder.DecodeNode(image, storeRequest.preserveTransient);

                    if (node.isPrivate()) {
                        if (!node.canReceivePrivately(storeRequest.sourcePublicKey,
                            storeRequest.targetPublicKey)) {

                            continue;
                        }
                    }

                    const expireTime = node.getExpireTime();
                    if (expireTime !== undefined && expireTime <= now) {
                        // Node already expired, do not store it.
                        continue;
                    }

                    // FYI: license requirements of nodes are not checked at this point.
                    // However, an unlicensed node can never be read back without a license
                    // and will get garbage collected.
                    decodedNodes.push(node);
                }
                catch(e) {
                    // Do nothing
                }
            }

            // Cryptographically verify all nodes.
            const verifiedNodes =
                await this.signatureOffloader.verify(decodedNodes) as NodeInterface[];

            ts = this.timeFreeze.freeze();

            let result = undefined;

            const mutex1 = this.lock.acquire("driver");

            locks.push(mutex1);

            if (mutex1.p) {
                await mutex1.p;
            }

            for (let retry=0; retry<=MAX_BUSY_RETRIES; retry++) {
                try {
                    result = await this.driver.store(verifiedNodes, ts,
                        storeRequest.preserveTransient);

                    break;
                }
                catch(e) {
                    if (BUSY_ERRORS.includes((e as Error).message)) {
                        console.debug("Database BUSY on store. Sleep and retry.");
                        await sleep(100);
                        continue;
                    }

                    throw e;
                }
            }

            this.lock.release(mutex1);

            let storeResponse: StoreResponse;

            if (result) {
                const [storedId1s, parentIds, blobId1s] = result;

                const missingBlobId1s: Buffer[] = [];
                const missingBlobSizes: bigint[] = [];

                if (blobId1s.length > 0 && this.blobDriver) {
                    const mutex2 = this.lock.acquire("blobDriver");

                    locks.push(mutex2);

                    if (mutex2.p) {
                        await mutex2.p;
                    }

                    const existingBlobId1s = await this.blobDriver.blobExists(blobId1s);

                    this.lock.release(mutex2);

                    const existingMap: {[id1: string]: boolean} = {};

                    const existingBlobId1sLength = existingBlobId1s.length;
                    for (let i=0; i<existingBlobId1sLength; i++) {
                        const existingBlobId1 = existingBlobId1s[i];
                        existingMap[existingBlobId1.toString("hex")] = true;
                    }

                    const blobId1sLength = blobId1s.length;
                    for (let i=0; i<blobId1sLength; i++) {
                        const blobId1 = blobId1s[i];
                        if (!existingMap[blobId1.toString("hex")]) {

                            const node = verifiedNodes.find( node => node.getId1()?.equals(blobId1) );

                            const blobSize = node?.getBlobLength();

                            if (blobSize !== undefined) {
                                missingBlobId1s.push(blobId1);
                                missingBlobSizes.push(blobSize);
                            }
                        }
                    }
                }

                if (parentIds.length > 0) {
                    setImmediate( () => this.triggerInsertEvent(parentIds, storeRequest.muteMsgIds) );
                }

                storeResponse = {
                    status: Status.RESULT,
                    storedId1s,
                    missingBlobId1s,
                    missingBlobSizes,
                    error: "",
                };
            }
            else {
                console.debug("Database BUSY, all retries failed.");
                storeResponse = {
                    status: Status.STORE_FAILED,
                    storedId1s: [],
                    missingBlobId1s: [],
                    missingBlobSizes: [],
                    error: "Failed storing nodes, database busy.",
                };
            }

            if (sendResponse) {
                sendResponse(storeResponse);
            }
        }
        catch(e) {
            console.debug("Exception in handleStore", e);
            if (sendResponse) {
                const error = `store failed: ${e}`;
                const errorStoreResponse: StoreResponse = {
                    status: Status.ERROR,
                    storedId1s: [],
                    missingBlobId1s: [],
                    missingBlobSizes: [],
                    error,
                };

                sendResponse(errorStoreResponse);
            }
        }
        finally {
            if (ts !== undefined) {
                this.timeFreeze.unfreeze(ts);
            }

            locks.forEach( lock => {
                this.lock.release(lock);
            });
        }
    };

    /**
     * @returns list of promises used for testing purposes.
     */
    protected triggerInsertEvent(triggerNodeIds: Buffer[], muteMsgIds: Buffer[],
        doneTriggerNodeIds: Set<Buffer> = new Set()): Promise<number>[]
    {
        const promises: Promise<number>[] = [];

        const triggerNodeIdsLength = triggerNodeIds.length;
        for (let index=0; index<triggerNodeIdsLength; index++) {
            const triggerNodeId = triggerNodeIds[index];
            const triggerNodeIdStr = triggerNodeId.toString("hex");
            const triggers = this.triggers[triggerNodeIdStr];

            const triggersLength = triggers?.length ?? 0;
            for (let index=0; index<triggersLength; index++) {
                const trigger = triggers[index];
                if (muteMsgIds.findIndex( msgId => msgId.equals(trigger.msgId) ) === -1) {
                    const promise = this.runTrigger(trigger);
                    promises.push(promise);
                }
            }

            doneTriggerNodeIds.add(triggerNodeId);
        }

        const now = this.timeFreeze.now();

        this.driver.getNodesById(triggerNodeIds, now).then( nodes => {
            const parentIds = nodes.map(node =>
                (node.bubbleTrigger() && !node.isLeaf()) ? node.getParentId() : undefined).
                    filter( nodeId => {
                        return nodeId && !doneTriggerNodeIds.has(nodeId);
                    }) as Buffer[];

            if (parentIds.length > 0) {
                this.triggerInsertEvent(parentIds, muteMsgIds, doneTriggerNodeIds);
            }
        });

        return promises;
    }

    protected handleFetch: HandlerFn<FetchRequest, FetchResponse> =
        async (fetchRequest: FetchRequest, peer: P2PClient, fromMsgId: Buffer,
            expectingReply: ExpectingReply, sendResponse?: SendResponseFn<FetchResponse>) => {

        if (!sendResponse) {
            return;
        }

        let status: Status | undefined;

        try {
            // Deep copy the fetch request object since we might update some properties.
            const fetchRequestCopy = DeepCopy(fetchRequest) as FetchRequest;

            //
            // Verify all properties.
            //

            if (fetchRequestCopy.query.sourcePublicKey.length === 0) {
                status = Status.MALFORMED;
                throw new Error("sourcePublicKey expected to be set");
            }

            if (fetchRequestCopy.query.targetPublicKey.length === 0) {
                status = Status.MALFORMED;
                throw new Error("targetPublicKey expected to be set");
            }

            if (fetchRequestCopy.query.rootNodeId1.length > 0 &&
                fetchRequestCopy.query.parentId.length > 0) {

                status = Status.MALFORMED;
                throw new Error("rootNodeId1 and parentId are exclusive to each other, set only one");
            }

            // Don't allow smaller triggerInterval than 60 seconds.
            if (fetchRequestCopy.query.triggerInterval !== 0) {
                fetchRequestCopy.query.triggerInterval =
                    Math.max(fetchRequestCopy.query.triggerInterval, 60);
            }

            if (fetchRequestCopy.crdt.algo > 0) {
                if (fetchRequestCopy.query.cutoffTime !== 0n) {
                    status = Status.MALFORMED;
                    throw new Error("query.cutoffTime must be set to 0 when fetching with CRDT");
                }

                if (fetchRequestCopy.query.onlyTrigger) {
                    status = Status.MALFORMED;
                    throw new Error("onlyTrigger cannot be true when fetching with CRDT");
                }

                if (fetchRequestCopy.crdt.msgId.length === 0) {
                    // Regular call, not updating request.
                    //
                    if (fetchRequestCopy.query.triggerNodeId.length > 0 &&
                        fetchRequestCopy.query.triggerInterval === 0) {

                        status = Status.MALFORMED;
                        throw new Error("triggerInterval must be set when fetching with CRDT and triggerNodeId.");
                    }
                }
                else {
                    // Updating the request.
                    if (fetchRequestCopy.query.triggerInterval !== 0 &&
                        (fetchRequestCopy.query.triggerInterval < 60 ||
                        fetchRequestCopy.query.triggerInterval > 600)) {

                        status = Status.MALFORMED;
                        throw new Error("triggerInterval must be set within 60 to 600 seconds when updating the CRDT fetch request.");
                    }
                }
            }


            //
            // This is a request to update the underlying fetch request.
            //
            if (fetchRequestCopy.crdt.algo > 0 &&
                fetchRequestCopy.crdt.msgId.length > 0) {

                const key = CRDTManager.HashKey(fetchRequestCopy);

                const trigger = this.getTrigger(key, fetchRequestCopy.crdt.msgId);

                if (trigger) {
                    if (fetchRequestCopy.query.triggerInterval > 0) {
                        trigger.fetchRequest.query.triggerInterval =
                            fetchRequestCopy.query.triggerInterval;
                    }

                    trigger.fetchRequest.crdt.head        = fetchRequestCopy.crdt.head;

                    trigger.fetchRequest.crdt.tail        = fetchRequestCopy.crdt.tail;

                    trigger.fetchRequest.crdt.reverse     = fetchRequestCopy.crdt.reverse;

                    trigger.fetchRequest.crdt.cursorId1   =
                        CopyBuffer(fetchRequestCopy.crdt.cursorId1);

                    trigger.fetchRequest.crdt.cursorIndex = fetchRequestCopy.crdt.cursorIndex;

                    const fetchResponse = DeepCopy(EMPTY_FETCHRESPONSE);

                    sendResponse(fetchResponse);

                    // Rerun the trigger using the updated query.
                    this.runTrigger(trigger);
                }
                else {
                    const fetchResponse = DeepCopy(EMPTY_FETCHRESPONSE);
                    fetchResponse.status = Status.MALFORMED;
                    fetchResponse.error  = "Trigger does not exist";
                    sendResponse(fetchResponse);
                }

                return;
            }

            // Check if to create a trigger?
            //
            let trigger;

            if (fetchRequestCopy.query.triggerNodeId.length > 0 ||
                fetchRequestCopy.query.triggerInterval > 0) {

                trigger = this.addTrigger(fetchRequestCopy, fromMsgId);
            }

            const handleFetchReplyData =
                this.handleFetchReplyDataFactory(sendResponse, trigger,
                    fetchRequestCopy.query.preserveTransient);

            if (trigger) {
                trigger.handleFetchReplyData = handleFetchReplyData;
            }

            // Check if to perform a fetch?
            const doFetch = !fetchRequestCopy.query.onlyTrigger;

            if (doFetch) {
                await this.fetch(fetchRequestCopy, handleFetchReplyData, trigger);
            }

            // If a trigger was created it is time to uncork it now.
            if (trigger) {
                this.uncorkTrigger(trigger);
            }
        }
        catch(e) {
            console.debug("Exception in handleFetch", e);
            const error = `${e}`;

            // Note that this message has seq === 0 which will cancel the trigger.
            //
            const errorFetchResponse = DeepCopy(EMPTY_FETCHRESPONSE);
            errorFetchResponse.status = status ?? Status.ERROR;
            errorFetchResponse.error  = error;

            sendResponse(errorFetchResponse);
        }
    };

    protected async fetch(fetchRequest: FetchRequest, handleFetchReplyData: HandleFetchReplyData,
        trigger?: Trigger) {

        const locks: Mutex[] = [];

        try {
            const now = this.timeFreeze.read();

            const mutex1 = this.lock.acquire("driver");

            locks.push(mutex1);

            if (mutex1.p) {
                await mutex1.p;
            }

            const usesCrdt = fetchRequest.crdt.algo > 0;

            if (usesCrdt) {
                const key = CRDTManager.HashKey(fetchRequest);

                const mutex2 = this.lock.acquire(`crdt_${key}`);

                locks.push(mutex2);

                if (mutex2.p) {
                    await mutex2.p;
                }

                await this.updateCRDTModel(fetchRequest, now,
                    handleFetchReplyData, trigger);

                this.lock.release(mutex2);
            }
            else {
                await this.driver.fetch(fetchRequest.query, now, handleFetchReplyData);
            }

            this.lock.release(mutex1);

            if (trigger?.closed) {
                this.dropTrigger(trigger.msgId, trigger.fetchRequest.query.targetPublicKey);
            }

            fetchRequest.query.cutoffTime = BigInt(now);
        }
        catch(e) {
            console.debug(e);

            locks.forEach( lock => {
                this.lock.release(lock);
            });

            if (trigger) {
                this.dropTrigger(trigger.msgId, trigger.fetchRequest.query.targetPublicKey);
            }

            throw e;
        }
    }

    protected dropTrigger(msgId: Buffer, targetPublicKey: Buffer) {
        for (const parentId in this.triggers) {
            const triggers = this.triggers[parentId];

            const index = triggers.findIndex( (trigger: Trigger) => {
                if (trigger.msgId.equals(msgId)) {
                    if (trigger.fetchRequest.query.targetPublicKey.equals(targetPublicKey)) {
                        return true;
                    }
                }

                return false;
            });

            if (index > -1) {
                const trigger = triggers.splice(index, 1)[0];

                if (triggers.length === 0) {
                    delete this.triggers[parentId];
                }

                if (trigger.handleFetchReplyData) {
                    trigger.handleFetchReplyData({status: Status.DROPPED_TRIGGER});
                }
            }
        }
    }

    protected addTrigger(fetchRequest: FetchRequest, msgId: Buffer): Trigger {

        fetchRequest.crdt.msgId = CopyBuffer(msgId);

        const key = CRDTManager.HashKey(fetchRequest);

        const trigger: Trigger = {
            key,
            msgId,
            fetchRequest,
            isRunning: false,
            isPending: false,
            isCorked: true,
            lastIntervalRun: 0,
            closed: false,
            crdtView: {list: [], transientHashes: {}, annotations: {}},
        };

        // Note that if triggerInterval is set but not triggerNodeId then idStr will be "",
        // which is fine.
        const idStr = fetchRequest.query.triggerNodeId.toString("hex");

        const triggers = this.triggers[idStr] ?? [];

        triggers.push(trigger);

        this.triggers[idStr] = triggers;

        return trigger;
    }

    /**
     * @returns number signalling why the return was made.
     * This is used for testing purposes.
     */
    protected async runTrigger(trigger: Trigger): Promise<number> {
        if (!trigger.handleFetchReplyData || trigger.closed) {
            return 1;
        }

        if (trigger.isRunning || trigger.isCorked) {
            trigger.isPending = true;
            return 2;
        }

        trigger.isPending = false;
        trigger.isRunning = true;

        try {
            await this.fetch(trigger.fetchRequest, trigger.handleFetchReplyData, trigger);
        }
        catch(e) {
            // Note that error response has already been sent by the QueryProcessor.
            // Trigger has also already been dropped.
            return 3;
        }

        trigger.isRunning = false;

        if (trigger.closed) {
            // Trigger has already been dropped.
            return 4;
        }

        if (trigger.isPending) {
            trigger.isPending = false;
            return this.runTrigger(trigger);
        }

        return 0;
    }

    /**
     * Run the triggers who uses triggerInterval.
     */
    protected triggersTimeout = () => {
        this.triggerTimeout = undefined;

        const now = Date.now();

        for (const parentId in this.triggers) {
            const triggers = this.triggers[parentId];
            for (const trigger of triggers) {
                const interval = trigger.fetchRequest.query.triggerInterval * 1000;

                if (interval > 0 && now - trigger.lastIntervalRun > interval) {
                    if (!trigger.isRunning) {

                        if (trigger.fetchRequest.crdt.algo > 0) {
                            // Do full refetch when using CRDT and subscription.
                            trigger.fetchRequest.query.cutoffTime = 0n;
                        }

                        trigger.lastIntervalRun = Date.now();

                        this.runTrigger(trigger);
                    }
                }
            }
        }

        this.triggerTimeout = setTimeout( this.triggersTimeout, this.triggerTimeoutInterval );
    };

    protected handleFetchReplyDataFactory(sendResponse: SendResponseFn<FetchResponse>,
        trigger: Trigger | undefined, preserveTransient: boolean): HandleFetchReplyData {

        let seq = 1;

        return (fetchReplyData: FetchReplyData) => {
            const fetchResponses = Storage.ChunkFetchResponse(fetchReplyData, seq, preserveTransient);

            if (fetchResponses.length === 0) {
                return;
            }

            seq = fetchResponses[fetchResponses.length - 1].seq;

            for (const fetchResponse of fetchResponses) {
                sendResponse(fetchResponse);
            }

            if (seq === 0 && trigger) {
                trigger.closed = true;
            }
        };
    }

    protected static ChunkFetchResponse(fetchReplyData: FetchReplyData, seq: number,
        preserveTransient: boolean): FetchResponse[]
    {
        const fetchResponses: FetchResponse[] = [];

        const status                = fetchReplyData.status ?? Status.RESULT;
        const error                 = fetchReplyData.error;
        const nodes                 = fetchReplyData.nodes ?? [];
        const embed                 = fetchReplyData.embed ?? [];
        let delta1                  = fetchReplyData.delta ?? Buffer.alloc(0);
        const rowCount              = fetchReplyData.rowCount ?? 0;
        const cutoffTime            = BigInt(fetchReplyData.now ?? 0);
        const length                = fetchReplyData.length ?? 0;
        const cursorIndex           = fetchReplyData.cursorIndex ?? -1;

        if (status === Status.RESULT || status === Status.MISSING_CURSOR) {
            while (true) {
                const images: Buffer[]          = [];
                const imagesToEmbed: Buffer[]   = [];

                let delta = Buffer.alloc(0);
                let responseSize = 0;
                while (responseSize < MESSAGE_SPLIT_BYTES) {
                    if (delta.length === 0 && delta1.length > 0) {
                        const max = MESSAGE_SPLIT_BYTES - responseSize;
                        delta = delta1.slice(0, max);
                        delta1 = delta1.slice(delta.length);
                        responseSize += delta.length + 4;
                    }

                    const node = nodes[0];
                    if (node) {
                        const image = node.export(preserveTransient, preserveTransient);
                        if (responseSize + image.length >= MESSAGE_SPLIT_BYTES) {
                            break;
                        }

                        nodes.shift();

                        images.push(image);
                        responseSize += image.length + 4;
                        continue;
                    }

                    const nodeEmbed = embed[0];
                    if (nodeEmbed) {
                        const image = nodeEmbed.export(preserveTransient, preserveTransient);
                        if (responseSize + image.length >= MESSAGE_SPLIT_BYTES) {
                            break;
                        }

                        embed.shift();

                        imagesToEmbed.push(image);
                        responseSize += image.length + 4;
                        continue;
                    }

                    break;
                }

                fetchResponses.push({
                    status: Status.RESULT,
                    result: {
                        nodes: images,
                        embed: imagesToEmbed,
                        cutoffTime,
                    },
                    crdtResult: {
                        delta,
                        length,
                        cursorIndex,
                    },
                    rowCount,
                    seq: seq++,
                    endSeq: 0,
                    error: "",
                });

                if (nodes.length === 0 && embed.length === 0 && delta1.length === 0) {
                    break;
                }
            }
        }
        else {
            // Note that this message has seq === 0 which will cancel the trigger.
            //
            const fetchResponse = DeepCopy(EMPTY_FETCHRESPONSE);
            fetchResponse.status    = status;
            fetchResponse.error     = error ?? "";

            return [fetchResponse];
        }

        // If we know what endSeq should be we set it.
        //
        if (fetchReplyData.isLast) {
            const endSeq = fetchResponses.slice(-1)[0].seq;

            for (const fetchResponse of fetchResponses) {
                fetchResponse.endSeq = endSeq;
            }
        }

        return fetchResponses;
    }

    /**
     * @returns number returned from runTrigger or undefiend if runTrigger is not called.
     * Used for testing purposes.
     */
    protected async uncorkTrigger(trigger: Trigger): Promise<number | undefined> {
        trigger.isCorked = false;

        if (trigger.isPending) {
            return this.runTrigger(trigger);
        }

        return undefined;
    }

    protected getTrigger(key: string, msgId: Buffer): Trigger | undefined {
        for (const parentId in this.triggers) {
            const triggers = this.triggers[parentId];

            const triggersLength = triggers.length;

            for (let index=0; index<triggersLength; index++) {
                const trigger = triggers[index];

                if (trigger.msgId.equals(msgId)) {
                    return trigger;
                }
            }
        }

        return undefined;
    }

    protected handleUnsubscribe: HandlerFn<UnsubscribeRequest, UnsubscribeResponse> =
        (unsubscribeRequest: UnsubscribeRequest, peer: P2PClient, fromMsgId: Buffer,
            expectingReply: ExpectingReply, sendResponse?: SendResponseFn<UnsubscribeResponse>) => {

        try {
            if (unsubscribeRequest.targetPublicKey.length === 0) {
                throw new Error("targetPublicKey expected to be set");
            }

            this.dropTrigger(unsubscribeRequest.originalMsgId, unsubscribeRequest.targetPublicKey);

            if (sendResponse) {
                const unsubscribeResponse: UnsubscribeResponse = {
                    status: Status.RESULT,
                    error: "",
                };

                sendResponse(unsubscribeResponse);
            }
        }
        catch(e) {
            console.debug("Exception in handleUnsubscribe", e);
            if (sendResponse) {
                const error = `unsubscribe failed: ${e}`;
                const errorUnsubscribeResponse: UnsubscribeResponse = {
                    status: Status.ERROR,
                    error,
                };

                sendResponse(errorUnsubscribeResponse);
            }
        }
    };

    protected handleWriteBlob: HandlerFn<WriteBlobRequest, WriteBlobResponse> =
        async (writeBlobRequest: WriteBlobRequest, peer: P2PClient, fromMsgId: Buffer,
            expectingReply: ExpectingReply, sendResponse?: SendResponseFn<WriteBlobResponse>) => {

        let status: Status | undefined;

        // Collect all locks here in case finally needs to release all locks.
        const locks: Mutex[] = [];

        try {
            if (!this.blobDriver) {
                throw new Error("Blob driver is not configured");
            }

            if (writeBlobRequest.sourcePublicKey.length === 0) {
                throw new Error("sourcePublicKey expected to be set");
            }

            if (writeBlobRequest.targetPublicKey.length === 0) {
                throw new Error("targetPublicKey expected be set");
            }

            const nodeId1   = writeBlobRequest.nodeId1;
            const data      = writeBlobRequest.data;
            const posn      = writeBlobRequest.pos;

            if (posn > Number.MAX_SAFE_INTEGER) {
                throw new Error("position too large to handle");
            }

            const pos = Number(posn);

            const now = this.timeFreeze.read();

            const mutex1 = this.lock.acquire("blobDriver");

            locks.push(mutex1);

            if (mutex1.p) {
                await mutex1.p;
            }

            const mutex2 = this.lock.acquire("driver");

            locks.push(mutex2);

            if (mutex2.p) {
                await mutex2.p;
            }

            let node = await this.driver.getNodeById1(nodeId1, now);

            if (!node) {
                status = Status.NOT_ALLOWED;
                throw new Error("node not found or not allowed writing blob data");
            }

            // If writer is not owner then check permissions.
            // This is so that the owner can always write blob data even if
            // there is no active license (yet).
            //
            if (!writeBlobRequest.sourcePublicKey.equals(node.getOwner() as Buffer)) {
                node = await this.driver.fetchSingleNode(nodeId1, now,
                    writeBlobRequest.targetPublicKey, writeBlobRequest.sourcePublicKey);
            }

            this.lock.release(mutex2);




            if (!node) {
                status = Status.NOT_ALLOWED;
                throw new Error("node not found or not allowed writing blob data");
            }

            const blobLengthn = node.getBlobLength();
            const blobHash = node.getBlobHash();

            if (!node.hasBlob() || blobLengthn === undefined || blobHash === undefined) {
                status = Status.MALFORMED;
                throw new Error("node not configured for blob");
            }

            if (blobLengthn > Number.MAX_SAFE_INTEGER) {
                throw new Error("blob length too large to handle");
            }

            const blobLength = Number(blobLengthn);

            if (pos + data.length > blobLength) {
                status = Status.MALFORMED;
                throw new Error("write blob out of bounds");
            }

            if (await this.blobDriver.getBlobDataId(nodeId1)) {
                if (sendResponse) {
                    const writeBlobResponse = {
                        status: Status.EXISTS,
                        currentLength: blobLengthn,
                        error: "",
                    };

                    sendResponse(writeBlobResponse);
                }

                return;
            }


            const dataId = Hash([blobHash, writeBlobRequest.sourcePublicKey]);

            let done = false;

            for (let retry=0; retry<=MAX_BUSY_RETRIES; retry++) {
                try {
                    await this.blobDriver.writeBlob(dataId, pos, data);
                    done = true;
                    break;
                }
                catch(e) {
                    if (BUSY_ERRORS.includes((e as Error).message)) {
                        console.debug("Database BUSY on writeBlob. Sleep and retry.");
                        await sleep(100);
                        continue;
                    }

                    throw e;
                }
            }

            if (!done) {
                console.debug("Database BUSY on writeBlob, all retries failed.");
                status = Status.STORE_FAILED;
                throw new Error("Database BUSY, all retries failed.");
            }


            const currentLength = await this.blobDriver.readBlobIntermediaryLength(dataId);

            if (currentLength === undefined) {
                status = Status.ERROR;
                throw new Error("Could not read back blob length");
            }

            if (currentLength > blobLength) {
                // Should not happen, checked already initially above.
                status = Status.ERROR;
                throw new Error("Overflow");
            }

            if (currentLength === blobLength) {
                let done = false;

                for (let retry=0; retry<=MAX_BUSY_RETRIES; retry++) {
                    try {
                        await this.blobDriver.finalizeWriteBlob(nodeId1, dataId, blobLength,
                            blobHash, now);

                        done = true;

                        break;
                    }
                    catch(e) {
                        if (BUSY_ERRORS.includes((e as Error).message)) {
                            console.debug("Database BUSY on finalizeWriteBlob. Sleep and retry.");
                            await sleep(100);
                            continue;
                        }

                        throw e;
                    }
                }

                if (!done) {
                    console.debug("Database BUSY on finalizeWriteBlob, all retries failed.");
                    status = Status.STORE_FAILED;
                    throw new Error("Database BUSY, all retries failed.");
                }

                if (sendResponse) {
                    const writeBlobResponse = {
                        status: Status.EXISTS,
                        currentLength: blobLengthn,
                        error: "",
                    };

                    const parentId = node.getParentId();

                    assert(parentId);

                    const mutex5 = this.lock.acquire("driver");

                    locks.push(mutex5);

                    if (mutex5.p) {
                        await mutex5.p;
                    }

                    await this.driver.bumpBlobNode(node, now);

                    this.lock.release(mutex5);

                    sendResponse(writeBlobResponse);

                    setImmediate( () =>
                        this.triggerInsertEvent([parentId], writeBlobRequest.muteMsgIds) );
                }

                this.lock.release(mutex1);

                return;
            }


            if (sendResponse) {
                const writeBlobResponse = {
                    status: Status.RESULT,
                    currentLength: BigInt(currentLength),
                    error: "",
                };

                sendResponse(writeBlobResponse);
            }

            this.lock.release(mutex1);
        }
        catch(e) {
            console.debug("Exception in handleWriteBlob", e);
            if (sendResponse) {
                const error = `write blob failed: ${e}`;
                const errorWriteBlobResponse: WriteBlobResponse = {
                    status: status ?? Status.ERROR,
                    currentLength: 0n,
                    error,
                };

                sendResponse(errorWriteBlobResponse);
            }
        }
        finally {
            locks.forEach( lock => {
                this.lock.release(lock);
            });
        }
    };

    protected handleReadBlob: HandlerFn<ReadBlobRequest, ReadBlobResponse> =
        async (readBlobRequest: ReadBlobRequest, peer: P2PClient, fromMsgId: Buffer,
            expectingReply: ExpectingReply, sendResponse?: SendResponseFn<ReadBlobResponse>) => {

        if (!sendResponse) {
            return;
        }

        let status: Status | undefined;

        // Collect all locks here in case finally needs to release all locks.
        const locks: Mutex[] = [];

        try {
            if (!this.blobDriver) {
                throw new Error("Blob driver is not configured");
            }

            if (readBlobRequest.targetPublicKey.length === 0) {
                throw new Error("targetPublicKey expected be set");
            }

            if (readBlobRequest.sourcePublicKey.length === 0) {
                throw new Error("sourcePublicKey expected be set");
            }

            const nodeId1   = readBlobRequest.nodeId1;
            const posn      = readBlobRequest.pos;
            let length      = readBlobRequest.length;

            if (posn > Number.MAX_SAFE_INTEGER) {
                throw new Error("position too large to handle");
            }

            const pos = Number(posn);

            const now = this.timeFreeze.read();

            const mutex1 = this.lock.acquire("blobDriver");

            locks.push(mutex1);

            if (mutex1.p) {
                await mutex1.p;
            }

            const mutex2 = this.lock.acquire("driver");

            locks.push(mutex2);

            if (mutex2.p) {
                await mutex2.p;
            }

            const node = await this.driver.fetchSingleNode(nodeId1, now,
                readBlobRequest.sourcePublicKey, readBlobRequest.targetPublicKey);

            this.lock.release(mutex2);

            if (!node) {
                status = Status.NOT_ALLOWED;
                throw new Error("node not found or not allowed");
            }

            const blobLengthn = node.getBlobLength();

            if (!node.hasBlob() || blobLengthn === undefined) {
                status = Status.MALFORMED;
                throw new Error("node not configured for blob");
            }

            if (blobLengthn > Number.MAX_SAFE_INTEGER) {
                throw new Error("blob length too large to handle");
            }

            const blobLength = Number(blobLengthn);

            if (pos > blobLength) {
                status = Status.MALFORMED;
                throw new Error("position out of bounds");
            }

            // Reads must be batched and next batch must be requested by the client.
            length = Math.min(length, MAX_READBLOB_LENGTH, blobLength - pos);

            const data = await this.blobDriver.readBlob(nodeId1, pos, length);

            this.lock.release(mutex1);

            if (!data) {
                // Blob data does not exist (in its finalized state).
                const readBlobResponse = {
                    status: Status.FETCH_FAILED,
                    data: Buffer.alloc(0),
                    seq: 0,
                    endSeq: 0,
                    blobLength: 0n,
                    error: "Blob data does not exist",
                };

                sendResponse(readBlobResponse);

                return;
            }


            if (data.length === 0) {
                const readBlobResponse = {
                    status: Status.RESULT,
                    data: Buffer.alloc(0),
                    seq: 1,
                    endSeq: 1,
                    blobLength: BigInt(blobLength),
                    error: "",
                };

                sendResponse(readBlobResponse);
                return;
            }

            const endSeq = Math.ceil(data.length / MESSAGE_SPLIT_BYTES);

            for (let seq=1; seq<=endSeq; seq++) {
                const readBlobResponse = {
                    status: Status.RESULT,
                    data: data.slice((seq-1) * MESSAGE_SPLIT_BYTES, seq * MESSAGE_SPLIT_BYTES),
                    seq,
                    endSeq,
                    blobLength: BigInt(blobLength),
                    error: "",
                };

                sendResponse(readBlobResponse);
            }
        }
        catch(e) {
            console.debug("Exception in handleReadblob", e);
            const error = `read blob failed: ${e}`;
            const errorReadBlobResponse: ReadBlobResponse = {
                status: status ?? Status.ERROR,
                data: Buffer.alloc(0),
                seq: 0,
                endSeq: 0,
                blobLength: 0n,
                error,
            };

            sendResponse(errorReadBlobResponse);
        }
        finally {
            locks.forEach( lock => {
                this.lock.release(lock);
            });
        }
    };

    protected async updateCRDTModel(fetchRequest: FetchRequest, now: number,
        handleFetchReplyData: HandleFetchReplyData, trigger?: Trigger) {

        const key = CRDTManager.HashKey(fetchRequest);

        let rowCount: number = 0

        // The fetch drives through here.
        const fn = async (fetchReplyData: FetchReplyData) => {
            const mutex1 = this.lock.acquire(`fetch_${key}`);

            if (mutex1.p) {
                await mutex1.p;
            }

            try {
                const status = fetchReplyData.status ?? Status.RESULT;

                if (status !== Status.RESULT) {
                    handleFetchReplyData(fetchReplyData);
                    return;
                }

                // For CRDT models we only include data nodes,
                // which are not flagged as special nodes.
                const nodesToAdd = (fetchReplyData.nodes ?? []).
                    filter( node => node.getType().equals(DATA_NODE_TYPE) && !(node as DataInterface).isSpecial() ) as DataInterface[];

                const embed = fetchReplyData.embed ?? [];

                rowCount += fetchReplyData.rowCount ?? 0;

                await this.crdtManager.updateModel(fetchRequest, nodesToAdd);

                if (embed.length > 0) {
                    const fetchReplyData: FetchReplyData = {
                        nodes: [],
                        embed,
                        rowCount,
                        isLast: false,
                    };

                    handleFetchReplyData(fetchReplyData);
                }

                if (fetchReplyData.isLast) {
                    const currentCRDTView = trigger?.crdtView ??
                        {list: [], transientHashes: {}, annotations: {}};

                    const result = await this.crdtManager.diff(currentCRDTView, key,
                        fetchRequest.crdt.cursorId1,
                        fetchRequest.crdt.cursorIndex,
                        fetchRequest.crdt.head,
                        fetchRequest.crdt.tail,
                        fetchRequest.crdt.reverse);

                    if (!result) {
                        const fetchReplyData: FetchReplyData = {
                            status: Status.MISSING_CURSOR,
                            rowCount,
                            isLast: true,
                        };

                        handleFetchReplyData(fetchReplyData);
                    }
                    else {
                        const [missingNodesId1s, delta, crdtView, cursorIndex, length] = result;

                        if (trigger) {
                            trigger.crdtView = crdtView;
                        }

                        while (true) {
                            const id1s = missingNodesId1s.splice(0, MAX_BATCH_SIZE);

                            const nodes = await this.driver.getNodesById1(id1s, now);

                            nodes.forEach( node => {
                                const id1Str = node.getId1()!.toString("hex");

                                const annotations = crdtView.annotations[id1Str];

                                if (annotations) {
                                    try {
                                        (node as DataInterface).setAnnotations(annotations);
                                    }
                                    catch(e) {
                                        // Ignore error, could be a too large annotation.
                                        console.error("Could not set annotations on node", e);
                                    }
                                }
                            });

                            const isLast = missingNodesId1s.length === 0;

                            const fetchReplyData: FetchReplyData = {
                                nodes,
                                delta: isLast ? delta : undefined,
                                rowCount,
                                cursorIndex,
                                length,
                                isLast,
                            };

                            handleFetchReplyData(fetchReplyData);

                            if (missingNodesId1s.length === 0) {
                                break;
                            }
                        }
                    }
                }
            }
            finally {
                this.lock.release(mutex1);
            }
        };

        const detectDeletions = fetchRequest.query.cutoffTime === 0n;

        if (detectDeletions) {
            await this.crdtManager.beginDeletionTracking(key);
        }

        // Drive the fetch through the CRDT model.
        await this.driver.fetch(fetchRequest.query, now, fn);

        if (detectDeletions) {
            await this.crdtManager.commitDeletionTracking(key);
        }
    }
}
