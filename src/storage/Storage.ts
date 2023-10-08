import { strict as assert } from "assert";

import {
    ExpectingReply,
} from "pocket-messaging";

import {
    P2PClient,
    HandlerFn,
    SendResponseFn,
} from "../p2pclient";

import {TimeFreeze} from "./TimeFreeze";

import {
    SignatureOffloaderInterface,
} from "../datamodel/decoder/types";

import {
    Decoder,
} from "../datamodel/decoder/Decoder";

import {
    NodeInterface,
    Hash,
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
} from "./types";

import {
    CopyBuffer,
    DeepCopy,
    PromiseCallback,
    sleep,
} from "../util/common";

import {
    Transformer,
} from "./transformer/Transformer";

import {
    PocketConsole,
} from "pocket-console";

/** How many retries to do if database is busy. */
const MAX_BUSY_RETRIES = 3;

/** The BUSY errors for SQLite, SQLiteJS and for the PostgreSQL driver we are using. */
const BUSY_ERRORS = ["SQLITE_BUSY: database is locked", "canceling statement due to lock timeout"];

const console = PocketConsole({module: "Storage"});

let osModule: any;
if (typeof process !== "undefined" && process?.versions?.node) {
    osModule = require("os");
}

/** When running in browser allow maximum amount of transformers. */
const MAX_TRANSFORMERS_BROWSER = 20;

/** When running in nodejs this is minimum amount of free RAM required to allow another transformer. */
const MIN_TRANSFORMER_FREE_MEM = 100 * 1024 * 1024;

const EMPTY_FETCHRESPONSE: FetchResponse = {
    status: Status.RESULT,
    result: {
        nodes: [],
        embed: [],
        cutoffTime: 0n,
    },
    transformResult: {
        delta: Buffer.alloc(0),
        extra: "",
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
     * Transient values are properties which a node can hold but is not necessarily persisted to storage and is never part of the hashing a node.
     *
     * Transient values represent states a node can hold although the data of the node is still immutable.
     *
     * A fetch request can request that transient values are preserved over serialization boundaries,
     * while a store request can request the transient properties of the nodes it is storing be preserved to the storage.
     *
     * The allowPreserveTransient property of the Storage must be set to true to allow store requests to preserve transient properties.
     */
    protected allowPreserveTransient: boolean;

    protected triggerTimeout: ReturnType<typeof setTimeout> | undefined;

    protected signatureOffloader: SignatureOffloaderInterface;

    protected triggers: {[parentId: string]: Trigger[]} = {};

    protected maxTransformerLength: number;

    /**
     * TimeFreeze is used to keep track of timestamps used for cutoff of results to minimize the duplication of nodes in return data sets.
     * This is an at-least-once system.
     */
    protected timeFreeze: TimeFreeze;

    protected triggerTimeoutInterval = 10000;

    protected lockQueue: (() => void)[] = [];
    protected lockBlobQueue: (() => void)[] = [];

    /**
     * @param p2pClient the connection to the client.
     * @param signatureOffloader
     * @param driver
     * @param blobDriver if provided it must not use the same underlaying connection as the driver.
     * @param allowPreserveTransient set to true to allow store requests to also store the transient values of the nodes.
     * @param maxTransformerLength set to the maximum allowed transformer internal length. Default is 100000.
     * @throws on misconfiguration
     */
    constructor(
        p2pClient: P2PClient,
        signatureOffloader: SignatureOffloaderInterface,
        driver: DriverInterface,
        blobDriver?: BlobDriverInterface,
        allowPreserveTransient: boolean = false,
        maxTransformerLength: number = 100000,
    ) {
        this.p2pClient = p2pClient;

        this.signatureOffloader = signatureOffloader;
        this.driver = driver;
        this.blobDriver = blobDriver;
        this.allowPreserveTransient = allowPreserveTransient;
        this.maxTransformerLength = maxTransformerLength;

        this.timeFreeze = new TimeFreeze();
        this.triggerTimeout = setTimeout( this.triggersTimeout, this.triggerTimeoutInterval );
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
     * but the storage is automatically closed when the database is closed or when the p2pclient is closed.
     */
    public close() {
        this.p2pClient.close();
    }

    /**
     * Add on close event handler to the p2pClient object to get notified when the storage instance closes.
     */
    public onClose(cb: (peer: P2PClient) => void) {
        this.p2pClient.onClose(cb);
    }

    protected handleClose = () => {
        if (this.triggerTimeout) {
            clearTimeout(this.triggerTimeout);
            this.triggerTimeout = undefined;
        }
    };

    protected handleStore: HandlerFn<StoreRequest, StoreResponse> = async (storeRequest: StoreRequest, peer: P2PClient, fromMsgId: Buffer, expectingReply: ExpectingReply, sendResponse?: SendResponseFn<StoreResponse>) => {
        let ts: number | undefined;

        try {
            const p = PromiseCallback();
            this.lockQueue.push(p.cb);
            if (this.lockQueue.length > 1) {
                await p.promise;
            }

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
                        if (!node.canReceivePrivately(storeRequest.sourcePublicKey, storeRequest.targetPublicKey)) {
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
            const verifiedNodes = await this.signatureOffloader.verify(decodedNodes) as NodeInterface[];

            ts = this.timeFreeze.freeze();

            let result = undefined;

            for (let retry=0; retry<=MAX_BUSY_RETRIES; retry++) {
                try {
                    result = await this.driver.store(verifiedNodes, ts, storeRequest.preserveTransient);
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

            let storeResponse: StoreResponse;

            if (result) {
                const [storedId1s, parentIds, blobId1s] = result;

                let missingBlobId1s: Buffer[] = [];

                if (blobId1s.length > 0 && this.blobDriver) {
                    const existingBlobId1s = await this.blobDriver.blobExists(blobId1s);

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
                            missingBlobId1s.push(blobId1);
                        }
                    }
                }
                else {
                    missingBlobId1s = blobId1s;
                }

                if (parentIds.length > 0) {
                    setImmediate( () => this.emitInsertEvent(parentIds, storeRequest.muteMsgIds) );
                }

                storeResponse = {
                    status: Status.RESULT,
                    storedId1s,
                    missingBlobId1s,
                    error: "",
                };
            }
            else {
                console.debug("Database BUSY, all retries failed.");
                storeResponse = {
                    status: Status.STORE_FAILED,
                    storedId1s: [],
                    missingBlobId1s: [],
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
                    error,
                };

                sendResponse(errorStoreResponse);
            }
        }
        finally {
            if (ts !== undefined) {
                this.timeFreeze.unfreeze(ts);
            }

            this.lockQueue.shift();

            const cb = this.lockQueue[0];
            if (cb) {
                cb();
            }
        }
    };

    /**
     * @returns list of promises used for testing purposes.
     */
    protected emitInsertEvent(triggerNodeIds: Buffer[], muteMsgIds: Buffer[]): Promise<number>[] {
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
        }

        return promises;
    }

    protected handleFetch: HandlerFn<FetchRequest, FetchResponse> = async (fetchRequest: FetchRequest, peer: P2PClient, fromMsgId: Buffer, expectingReply: ExpectingReply, sendResponse?: SendResponseFn<FetchResponse>) => {
        if (!sendResponse) {
            return;
        }

        let trigger: Trigger | undefined;
        let status: Status | undefined;

        try {
            const p = PromiseCallback();
            this.lockQueue.push(p.cb);
            if (this.lockQueue.length > 1) {
                await p.promise;
            }

            // Deep copy the fetch request object since we might update some properties property.
            const fetchRequestCopy = DeepCopy(fetchRequest) as FetchRequest;

            if (fetchRequestCopy.query.sourcePublicKey.length === 0) {
                status = Status.MALFORMED;
                throw new Error("sourcePublicKey expected to be set");
            }

            if (fetchRequestCopy.query.targetPublicKey.length === 0) {
                status = Status.MALFORMED;
                throw new Error("targetPublicKey expected to be set");
            }

            if (fetchRequestCopy.query.rootNodeId1.length > 0 && fetchRequestCopy.query.parentId.length > 0) {
                status = Status.MALFORMED;
                throw new Error("rootNodeId1 and parentId are exclusive to each other, set only one");
            }

            if (fetchRequestCopy.query.triggerInterval > 0) {
                fetchRequestCopy.query.triggerInterval = Math.max(fetchRequestCopy.query.triggerInterval, 60);
            }

            if (fetchRequestCopy.transform.algos.length > 0) {
                if (fetchRequestCopy.query.cutoffTime !== 0n) {
                    status = Status.MALFORMED;
                    throw new Error("query.cutoffTime must be 0 when fetching with transform");
                }

                if (fetchRequestCopy.query.onlyTrigger) {
                    status = Status.MALFORMED;
                    throw new Error("onlyTrigger cannot be true when fetching with transform");
                }

                if (fetchRequestCopy.transform.msgId.length === 0) {
                    // Regular call, not reusing or updating request.
                    //
                    if (fetchRequestCopy.query.triggerNodeId.length > 0 && fetchRequestCopy.query.triggerInterval === 0) {
                        status = Status.MALFORMED;
                        throw new Error("triggerInterval must be set when fetching with transform and triggerNodeId.");
                    }

                    // Note that triggerInterval can be set regardless of triggerNodeId.
                    if (fetchRequestCopy.query.triggerInterval < 60 || fetchRequestCopy.query.triggerInterval > 600) {
                        status = Status.MALFORMED;
                        throw new Error("triggerInterval must be set within 60 to 600 seconds when fetching with transform.");
                    }
                }
                else {
                    // Reusing transformer for single query or updating the request.
                    if (fetchRequestCopy.query.triggerNodeId.length === 0) {
                        status = Status.MALFORMED;
                        throw new Error("triggerNodeId must be set if msgId is set");
                    }
                }
            }


            // This is a request to update the underlaying fetch request.
            //
            if (fetchRequestCopy.transform.algos.length > 0 &&
                fetchRequestCopy.query.triggerNodeId.length > 0 &&
                fetchRequestCopy.query.triggerInterval > 0 &&
                fetchRequestCopy.transform.msgId.length > 0) {

                const key = Transformer.HashKey(fetchRequestCopy);

                const trigger = this.getTrigger(fetchRequestCopy.query.triggerNodeId, key, false);

                if (trigger) {
                    trigger.fetchRequest.query.cutoffTime       = 0n;
                    trigger.fetchRequest.query.triggerInterval  = fetchRequestCopy.query.triggerInterval;
                    trigger.fetchRequest.transform.head         = fetchRequestCopy.transform.head;
                    trigger.fetchRequest.transform.tail         = fetchRequestCopy.transform.tail;
                    trigger.fetchRequest.transform.cursorId1    = CopyBuffer(fetchRequestCopy.transform.cursorId1);
                    trigger.fetchRequest.transform.reverse      = fetchRequestCopy.transform.reverse;

                    const fetchResponse = DeepCopy(EMPTY_FETCHRESPONSE);
                    sendResponse(fetchResponse);

                    // Rerun the trigger using the updated query.
                    this.runTrigger(trigger);
                }
                else {
                    const fetchResponse = DeepCopy(EMPTY_FETCHRESPONSE);
                    fetchResponse.status = Status.TRANSFORMER_INVALIDATED;
                    sendResponse(fetchResponse);
                }

                return;
            }

            let transformer: Transformer | undefined;

            // Check for transformer algorithms to be run.
            //
            if (fetchRequestCopy.transform.algos.length > 0) {

                // This is a single query trying to reuse a model.
                // Return nodes but do not return any delta.
                if (fetchRequestCopy.query.triggerNodeId.length > 0 &&
                    fetchRequestCopy.query.triggerInterval === 0 &&
                    fetchRequestCopy.transform.msgId.length > 0) {

                    const transformer = this.getReadyTransformer(fetchRequestCopy);

                    if (transformer) {
                        const handleFetchReplyData = this.handleFetchReplyDataFactory(sendResponse,
                            undefined, fetchRequestCopy.query.preserveTransient);

                        const result = transformer.get(fetchRequestCopy.transform.cursorId1,
                            fetchRequestCopy.transform.head, fetchRequestCopy.transform.tail,
                            fetchRequestCopy.transform.reverse);

                        if (!result) {
                            const fetchReplyData: FetchReplyData = {
                                status: Status.MISSING_CURSOR,
                            };

                            handleFetchReplyData(fetchReplyData);
                        }
                        else {
                            const [nodes] = result;

                            const fetchReplyData: FetchReplyData = {
                                nodes,
                            };

                            handleFetchReplyData(fetchReplyData);
                        }
                    }
                    else {
                        // Send error message.
                        const fetchResponse = DeepCopy(EMPTY_FETCHRESPONSE);
                        fetchResponse.status = Status.TRANSFORMER_INVALIDATED;
                        sendResponse(fetchResponse);
                    }

                    return;
                }

                transformer = this.createTransformer(fetchRequestCopy, sendResponse);

                if (!transformer) {
                    // Error response already sent.
                    return;
                }
            }

            let handleFetchReplyData: HandleFetchReplyData | undefined;

            if (fetchRequestCopy.query.triggerNodeId.length > 0 || fetchRequestCopy.query.triggerInterval > 0) {
                trigger = this.addTrigger(fetchRequestCopy, fromMsgId, sendResponse, transformer);
                handleFetchReplyData = trigger.handleFetchReplyData;
            }
            else {
                const handleFetchReplyData0 = this.handleFetchReplyDataFactory(sendResponse, undefined, fetchRequestCopy.query.preserveTransient);

                handleFetchReplyData = transformer ?
                    transformer.handleFetchReplyDataFactory(handleFetchReplyData0) : handleFetchReplyData0;
            }

            if (!handleFetchReplyData) {
                return;
            }

            const doFetch = !fetchRequestCopy.query.onlyTrigger;

            if (doFetch) {
                const now = this.timeFreeze.read();

                await this.driver.fetch(fetchRequestCopy.query, now, handleFetchReplyData);

                if (trigger?.closed) {
                    this.dropTrigger(trigger.msgId, trigger.fetchRequest.query.targetPublicKey);
                    trigger = undefined;
                    transformer?.close();
                }

                if (!trigger && transformer) {
                    transformer.close();
                }

                if (trigger) {
                    trigger.hasFetched = true;
                }

                fetchRequestCopy.query.cutoffTime = BigInt(now);
            }

            if (trigger) {
                this.uncorkTrigger(trigger);
            }
        }
        catch(e) {
            if (trigger) {
                this.dropTrigger(trigger.msgId, trigger.fetchRequest.query.targetPublicKey);
            }

            console.debug("Exception in handleFetch", e);
            const error = `${e}`;

            // Note that this message has seq === 0 which will cancel the trigger.
            //
            const errorFetchResponse = DeepCopy(EMPTY_FETCHRESPONSE);
            errorFetchResponse.status = status ?? Status.ERROR;
            errorFetchResponse.error  = error;

            sendResponse(errorFetchResponse);
        }
        finally {
            this.lockQueue.shift();

            const cb = this.lockQueue[0];
            if (cb) {
                cb();
            }
        }
    };


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

                if (trigger.transformer) {
                    trigger.transformer.close();
                }

                if (triggers.length === 0) {
                    delete this.triggers[parentId];
                }

                if (trigger.handleFetchReplyData) {
                    trigger.handleFetchReplyData({status: Status.DROPPED_TRIGGER});
                }
            }
        }
    }

    protected addTrigger(fetchRequest: FetchRequest, msgId: Buffer, sendResponse: SendResponseFn<FetchResponse>, transformer?: Transformer): Trigger {
        fetchRequest.transform.msgId = CopyBuffer(msgId);

        const key = Transformer.HashKey(fetchRequest);

        const trigger: Trigger = {
            key,
            msgId,
            fetchRequest,
            isRunning: false,
            isPending: false,
            isCorked: true,
            transformer,
            lastRun: 0,
            closed: false,
            hasFetched: false,
        };

        // Note that if triggerInterval is set but not triggerNodeId then idStr will be "",
        // which is fine.
        const idStr = fetchRequest.query.triggerNodeId.toString("hex");

        const triggers = this.triggers[idStr] ?? [];
        triggers.push(trigger);
        this.triggers[idStr] = triggers;

        const handleFetchReplyData0 = this.handleFetchReplyDataFactory(sendResponse, trigger, fetchRequest.query.preserveTransient);

        const handleFetchReplyData = transformer ?
            transformer.handleFetchReplyDataFactory(handleFetchReplyData0) : handleFetchReplyData0;

        trigger.handleFetchReplyData = handleFetchReplyData;

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

        const now = this.timeFreeze.read();

        try {
            const p = PromiseCallback();
            this.lockQueue.push(p.cb);
            if (this.lockQueue.length > 1) {
                await p.promise;
            }

            await this.driver.fetch(trigger.fetchRequest.query, now, trigger.handleFetchReplyData);
        }
        catch(e) {
            // Note that error response has already been sent by the QueryProcessor.
            this.dropTrigger(trigger.msgId, trigger.fetchRequest.query.targetPublicKey);
            return 3;
        }
        finally {
            this.lockQueue.shift();

            const cb = this.lockQueue[0];
            if (cb) {
                cb();
            }
        }

        trigger.isRunning = false;

        if (trigger.closed) {
            this.dropTrigger(trigger.msgId, trigger.fetchRequest.query.targetPublicKey);
            return 4;
        }

        trigger.fetchRequest.query.cutoffTime = BigInt(now);

        if (trigger.fetchRequest.transform.algos.length === 0) {
            // Only update this here if not using a subscription with transformer.
            // since that trigger we always want run periodically full reftech to detect deleted nodes.
            trigger.lastRun = Date.now();
        }

        if (trigger.isPending) {
            trigger.isPending = false;
            this.runTrigger(trigger);
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

                if (interval > 0 && now - trigger.lastRun > interval) {
                    if (!trigger.isRunning) {
                        if (trigger.fetchRequest.transform.algos.length > 0) {
                            // Do full refetch when using transformer and subscription.
                            trigger.fetchRequest.query.cutoffTime = 0n;
                            trigger.lastRun = Date.now();
                        }

                        this.runTrigger(trigger);
                    }
                }
            }
        }

        this.triggerTimeout = setTimeout( this.triggersTimeout, this.triggerTimeoutInterval );
    };

    protected handleFetchReplyDataFactory(sendResponse: SendResponseFn<FetchResponse>, trigger?: Trigger, preserveTransient: boolean = false): HandleFetchReplyData {
        let seq = 1;

        return (fetchReplyData: FetchReplyData) => {
            const fetchResponses = this.chunkFetchResponse(fetchReplyData, seq, preserveTransient);

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

    protected chunkFetchResponse(fetchReplyData: FetchReplyData, seq: number, preserveTransient: boolean): FetchResponse[] {
        const fetchResponses: FetchResponse[] = [];

        const status                = fetchReplyData.status ?? Status.RESULT;
        const error                 = fetchReplyData.error;
        const nodes                 = fetchReplyData.nodes ?? [];
        const embed                 = fetchReplyData.embed ?? [];
        let extra1                  = fetchReplyData.extra ?? "";
        let delta1                  = fetchReplyData.delta ?? Buffer.alloc(0);
        const rowCount              = fetchReplyData.rowCount ?? 0;
        const cutoffTime            = BigInt(fetchReplyData.now ?? 0);

        if (status === Status.RESULT || status === Status.MISSING_CURSOR) {
            while (true) {
                const images: Buffer[]          = [];
                const imagesToEmbed: Buffer[]   = [];

                let extra = "";
                let delta = Buffer.alloc(0);
                let responseSize = 0;
                while (responseSize < MESSAGE_SPLIT_BYTES) {
                    if (delta1.length > 0) {
                        const max = MESSAGE_SPLIT_BYTES - responseSize;
                        delta = delta1.slice(0, max);
                        responseSize += delta.length + 4;
                        delta1 = delta1.slice(delta.length);
                        continue;
                    }

                    if (extra1.length > 0) {
                        const max = MESSAGE_SPLIT_BYTES - responseSize;
                        extra = extra1.slice(0, max);
                        responseSize += extra.length + 4;
                        extra1 = extra1.slice(extra.length);
                        continue;
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
                    transformResult: {
                        delta,
                        extra,
                    },
                    rowCount,
                    seq: seq++,
                    endSeq: 0,
                    error: "",
                });

                if (nodes.length === 0 && embed.length === 0) {
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

    protected getTrigger(triggerNodeId: Buffer, key: string,
        requireHasFetched: boolean = true): Trigger | undefined {

        const idStr = triggerNodeId.toString("hex");

        const triggers = this.triggers[idStr] ?? [];

        const triggersLength = triggers.length;

        for (let index=0; index<triggersLength; index++) {
            const trigger = triggers[index];
            if (trigger.key === key && (!requireHasFetched || trigger.hasFetched)) {
                return trigger;
            }
        }

        return undefined;
    }

    protected handleUnsubscribe: HandlerFn<UnsubscribeRequest, UnsubscribeResponse> = (unsubscribeRequest: UnsubscribeRequest, peer: P2PClient, fromMsgId: Buffer, expectingReply: ExpectingReply, sendResponse?: SendResponseFn<UnsubscribeResponse>) => {
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

    protected handleWriteBlob: HandlerFn<WriteBlobRequest, WriteBlobResponse> = async (writeBlobRequest: WriteBlobRequest, peer: P2PClient, fromMsgId: Buffer, expectingReply: ExpectingReply, sendResponse?: SendResponseFn<WriteBlobResponse>) => {
        let status: Status | undefined;

        try {
            const p = PromiseCallback();
            this.lockBlobQueue.push(p.cb);
            if (this.lockBlobQueue.length > 1) {
                await p.promise;
            }

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

            let node = await this.driver.getNodeById1(nodeId1, now);

            if (!node) {
                status = Status.NOT_ALLOWED;
                throw new Error("node not found or not allowed");
            }

            // If writer is not owner then check permissions.
            // This is so that the owner can always write blob data even if
            // there is no active license (yet).
            //
            if (!writeBlobRequest.sourcePublicKey.equals(node.getOwner() as Buffer)) {
                node = await this.driver.fetchSingleNode(nodeId1, now,
                    writeBlobRequest.targetPublicKey, writeBlobRequest.sourcePublicKey);
            }

            if (!node) {
                status = Status.NOT_ALLOWED;
                throw new Error("node not found or not allowed");
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
                throw new Error("write out of bounds");
            }

            const dataId = Hash([nodeId1, writeBlobRequest.sourcePublicKey]);

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

            if (writeBlobRequest.copyFromId1.length > 0) {
                // Copy blob data from other existing node.
                // Hashes must match and writer needs read permissions to the given source node.

                // Check first if client is owner then directly allow copy.
                // This is so owners can directly write and manage blobs even
                // if no licenses are created yet.
                //
                let copyFromNode = await this.driver.getNodeById1(writeBlobRequest.copyFromId1, now);

                if (!copyFromNode) {
                    status = Status.NOT_ALLOWED;
                    throw new Error("copy node not found or not allowed.");
                }

                // If not owner then fetch the node applying permissions.
                //
                if (!writeBlobRequest.sourcePublicKey.equals(copyFromNode.getOwner() as Buffer)) {
                    copyFromNode = await this.driver.fetchSingleNode(writeBlobRequest.copyFromId1,
                        now, writeBlobRequest.targetPublicKey, writeBlobRequest.sourcePublicKey);
                }

                if (!copyFromNode) {
                    status = Status.NOT_ALLOWED;
                    throw new Error("copy node not found or not allowed");
                }

                const copyBlobHash = copyFromNode.getBlobHash();
                const copyBlobLength = copyFromNode.getBlobLength();
                if (copyBlobHash === undefined || !copyBlobHash.equals(blobHash) ||
                    copyBlobLength === undefined || copyBlobLength !== blobLengthn) {

                    status = Status.MALFORMED;
                    throw new Error("copy node blob not does not match target");
                }

                let done = false;

                for (let retry=0; retry<=MAX_BUSY_RETRIES; retry++) {
                    try {
                        if (! (await this.blobDriver.copyBlob(writeBlobRequest.copyFromId1, nodeId1, now))) {
                            status = Status.ERROR;
                            throw new Error("copy node blob data not available as expected");
                        }

                        done = true;
                        break;
                    }
                    catch(e) {
                        if (BUSY_ERRORS.includes((e as Error).message)) {
                            console.debug("Database BUSY on copyBlob. Sleep and retry.");
                            await sleep(100);
                            continue;
                        }

                        throw e;
                    }
                }

                if (!done) {
                    console.debug("Database BUSY on copyBlob, all retries failed.");
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

                    await this.driver.bumpBlobNode(node, now);

                    sendResponse(writeBlobResponse);

                    setImmediate( () => this.emitInsertEvent([parentId], writeBlobRequest.muteMsgIds) );
                }

                return;
            }
            else {
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
                        await this.blobDriver.finalizeWriteBlob(nodeId1, dataId, blobLength, blobHash, now);
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

                    await this.driver.bumpBlobNode(node, now);

                    sendResponse(writeBlobResponse);

                    setImmediate( () => this.emitInsertEvent([parentId], writeBlobRequest.muteMsgIds) );
                }

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

        }
        catch(e) {
            console.debug("handleWriteBlob", e);
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
            this.lockBlobQueue.shift();

            const cb = this.lockBlobQueue[0];
            if (cb) {
                cb();
            }
        }
    };

    protected handleReadBlob: HandlerFn<ReadBlobRequest, ReadBlobResponse> = async (readBlobRequest: ReadBlobRequest, peer: P2PClient, fromMsgId: Buffer, expectingReply: ExpectingReply, sendResponse?: SendResponseFn<ReadBlobResponse>) => {
        if (!sendResponse) {
            return;
        }

        let status: Status | undefined;

        try {
            const p = PromiseCallback();
            this.lockBlobQueue.push(p.cb);
            if (this.lockBlobQueue.length > 1) {
                await p.promise;
            }

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

            const node = await this.driver.fetchSingleNode(nodeId1, now,
                readBlobRequest.sourcePublicKey, readBlobRequest.targetPublicKey);

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
            this.lockBlobQueue.shift();

            const cb = this.lockBlobQueue[0];
            if (cb) {
                cb();
            }
        }
    };

    protected createTransformer(fetchRequest: FetchRequest,
        sendResponse: SendResponseFn<FetchResponse>): Transformer | undefined {

        if (!this.allowAnotherTransformer()) {
            const fetchReplyData: FetchReplyData = {
                status: Status.ERROR,
                error: "Out of memory to create transformer",
            };

            const handleFetchReplyData = this.handleFetchReplyDataFactory(sendResponse,
                undefined, fetchRequest.query.preserveTransient);

            handleFetchReplyData(fetchReplyData);

            return undefined;
        }

        const transformer = new Transformer(fetchRequest, this.maxTransformerLength);

        return transformer;
    }

    protected getReadyTransformer(fetchRequest: FetchRequest): Transformer | undefined {
        const key = Transformer.HashKey(fetchRequest);

        const trigger = this.getTrigger(fetchRequest.query.triggerNodeId, key);

        if (trigger) {
            return trigger.transformer;
        }

        return undefined;
    }

    protected allowAnotherTransformer(): boolean {
        if (osModule) {
            const freeMem = osModule.freemem();
            return freeMem > MIN_TRANSFORMER_FREE_MEM;
        }
        else {
            let count = 0;
            for (const parentId in this.triggers) {
                const triggers = this.triggers[parentId];
                count += triggers.length;
            }

            return count < MAX_TRANSFORMERS_BROWSER;
        }
    }
}
