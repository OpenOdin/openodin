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
    SignatureOffloader,
} from "../datamodel/decoder/SignatureOffloader";

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

/** Max read length for a read blob request, any larger requests must be split into multiple requests. */
const MAX_READBLOB_LENGTH = 1024 * 1024;

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
        deletedNodesId1: [],
        indexes: [],
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

    /** The public key of the connected peer. */
    protected clientPublicKey: Buffer;

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

    protected signatureOffloader: SignatureOffloader;

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
        signatureOffloader: SignatureOffloader,
        driver: DriverInterface,
        blobDriver?: BlobDriverInterface,
        allowPreserveTransient: boolean = false,
        maxTransformerLength: number = 100000,
    ) {
        this.p2pClient = p2pClient;

        const clientPublicKey = p2pClient.getRemotePublicKey();

        if (!clientPublicKey) {
            throw new Error("Peer client public key required");
        }

        this.clientPublicKey = clientPublicKey;
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

    protected handleStore: HandlerFn<StoreRequest, StoreResponse> = async (peer: P2PClient, storeRequest: StoreRequest, fromMsgId: Buffer, expectingReply: ExpectingReply, sendResponse?: SendResponseFn<StoreResponse>) => {
        let ts: number | undefined;

        try {
            const p = PromiseCallback();
            this.lockQueue.push(p.cb);
            if (this.lockQueue.length > 1) {
                await p.promise;
            }

            if (storeRequest.clientPublicKey.length === 0) {
                storeRequest.clientPublicKey = CopyBuffer(this.clientPublicKey);
            }

            if (storeRequest.sourcePublicKey.length === 0) {
                storeRequest.sourcePublicKey = CopyBuffer(storeRequest.clientPublicKey);
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
                        if (!node.canReceivePrivately(storeRequest.sourcePublicKey, storeRequest.clientPublicKey)) {
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

    protected handleFetch: HandlerFn<FetchRequest, FetchResponse> = async (peer: P2PClient, fetchRequest: FetchRequest, fromMsgId: Buffer, expectingReply: ExpectingReply, sendResponse?: SendResponseFn<FetchResponse>) => {
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

            // Deep copy the fetch request object since we will update its cutoffTime property.
            const fetchRequestCopy = DeepCopy(fetchRequest) as FetchRequest;

            if (fetchRequestCopy.query.clientPublicKey.length === 0) {
                fetchRequestCopy.query.clientPublicKey = CopyBuffer(this.clientPublicKey);
            }

            if (fetchRequestCopy.query.targetPublicKey.length === 0) {
                fetchRequestCopy.query.targetPublicKey = CopyBuffer(fetchRequestCopy.query.clientPublicKey);
            }

            if (fetchRequestCopy.query.triggerInterval > 0) {
                fetchRequestCopy.query.triggerInterval = Math.max(fetchRequestCopy.query.triggerInterval, 60);
            }

            if (fetchRequestCopy.query.rootNodeId1.length > 0 && fetchRequestCopy.query.parentId.length > 0) {
                status = Status.MALFORMED;
                throw new Error("rootNodeId1 and parentId are exclusive to each other, set only one");
            }

            if (fetchRequestCopy.transform.algos.length > 0) {
                if (fetchRequest.transform.includeDeleted &&
                    (fetchRequest.query.triggerInterval < 60 || fetchRequest.query.triggerInterval > 120)) {

                    status = Status.MALFORMED;
                    throw new Error("triggerInterval must be minimum 60 and maximum 120 (seconds) when fetching with transform and includeDeleted");
                }

                if (fetchRequest.query.onlyTrigger) {

                    status = Status.MALFORMED;
                    throw new Error("onlyTrigger cannot be true when fetching with transform");
                }

                if ( (fetchRequest.query.triggerNodeId.length > 0 || fetchRequest.query.triggerInterval > 0) &&
                    fetchRequest.transform.cachedTriggerNodeId.length > 0) {

                    status = Status.MALFORMED;
                    throw new Error("query.triggerNodeId/triggerInterval cannot be set together with transform.cachedTriggerNodeId");
                }
            }


            let transformer: Transformer | undefined;

            // Check for transformer algorithms to be run.
            //
            if (fetchRequestCopy.transform.algos.length > 0) {
                transformer = this.getTransformer(fetchRequestCopy, sendResponse);

                if (!transformer) {
                    // Fetch response already sent, either by using cached transformer
                    // or by sending error message.
                    return;
                }
                else {
                    // Fall through with newly created transformer.
                }
            }

            let handleFetchReplyData: HandleFetchReplyData | undefined;

            if (fetchRequestCopy.query.triggerNodeId.length > 0 || fetchRequestCopy.query.triggerInterval > 0) {
                trigger = this.addTrigger(fetchRequestCopy, fromMsgId, sendResponse, transformer);
                handleFetchReplyData = trigger.handleFetchReplyData;
            }
            else {
                const handleFetchReplyData0 = this.handleFetchReplyDataFactory(sendResponse, undefined, fetchRequest.query.preserveTransient);

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
                    this.dropTrigger(trigger.msgId, trigger.fetchRequest.query.clientPublicKey);
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
                this.dropTrigger(trigger.msgId, trigger.fetchRequest.query.clientPublicKey);
            }

            console.debug("Exception in handleFetch", e);
            const error = `${e}`;

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


    protected dropTrigger(msgId: Buffer, clientPublicKey: Buffer) {
        for (const parentId in this.triggers) {
            const triggers = this.triggers[parentId];
            const index = triggers.findIndex( (trigger: Trigger) => {
                if (trigger.msgId.equals(msgId)) {
                    if (trigger.fetchRequest.query.clientPublicKey.equals(clientPublicKey)) {
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
            }
        }
    }

    protected addTrigger(fetchRequest: FetchRequest, msgId: Buffer, sendResponse: SendResponseFn<FetchResponse>, transformer?: Transformer): Trigger {
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
            this.dropTrigger(trigger.msgId, trigger.fetchRequest.query.clientPublicKey);
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
            this.dropTrigger(trigger.msgId, trigger.fetchRequest.query.clientPublicKey);
            return 4;
        }

        trigger.fetchRequest.query.cutoffTime = BigInt(now);
        trigger.lastRun = Date.now();

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
                        if (trigger.fetchRequest.transform.includeDeleted) {
                            trigger.fetchRequest.query.cutoffTime = 0n;
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
        const deletedNodesId1b      = fetchReplyData.deletedNodesId1 ?? [];
        const indexesArray          = fetchReplyData.indexes ?? [];
        let extra1                  = fetchReplyData.extra ?? "";
        const rowCount              = fetchReplyData.rowCount ?? 0;
        const cutoffTime            = BigInt(fetchReplyData.now ?? 0);

        if (status === Status.RESULT) {
            while (true) {
                const images: Buffer[]          = [];
                const imagesToEmbed: Buffer[]   = [];
                const deletedNodesId1: Buffer[] = [];
                const indexes: number[]         = [];

                let extra = "";
                let responseSize = 0;
                while (responseSize < MESSAGE_SPLIT_BYTES) {
                    if (extra1.length > 0) {
                        extra = extra1;
                        responseSize += extra.length + 4;
                        extra1 = "";
                        continue;
                    }

                    const node = nodes.shift();
                    if (node) {
                        const image = node.export(preserveTransient, preserveTransient);
                        images.push(image);
                        responseSize += image.length + 4;
                        continue;
                    }

                    const nodeEmbed = embed.shift();
                    if (nodeEmbed) {
                        const image = nodeEmbed.export(preserveTransient, preserveTransient);
                        imagesToEmbed.push(image);
                        responseSize += image.length + 4;
                        continue;
                    }

                    const delNodeId1 = deletedNodesId1b.shift();
                    if (delNodeId1) {
                        deletedNodesId1.push(delNodeId1);
                        responseSize += delNodeId1.length + 4;
                        continue;
                    }

                    const index = indexesArray.shift();
                    if (index !== undefined) {
                        indexes.push(index);
                        responseSize += 4 + 4;
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
                        deletedNodesId1,
                        indexes,
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
            const fetchResponse = DeepCopy(EMPTY_FETCHRESPONSE);
            fetchResponse.status    = status;
            fetchResponse.error     = error ?? "";

            return [fetchResponse];
        }

        if (fetchReplyData.isLast) {
            for (const fetchResponse of fetchResponses) {
                fetchResponse.endSeq = seq - 1;
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

    protected handleUnsubscribe: HandlerFn<UnsubscribeRequest, UnsubscribeResponse> = (peer: P2PClient, unsubscribeRequest: UnsubscribeRequest, fromMsgId: Buffer, expectingReply: ExpectingReply, sendResponse?: SendResponseFn<UnsubscribeResponse>) => {
        try {
            if (unsubscribeRequest.clientPublicKey.length === 0) {
                unsubscribeRequest.clientPublicKey = CopyBuffer(this.clientPublicKey);
            }

            this.dropTrigger(unsubscribeRequest.originalMsgId, unsubscribeRequest.clientPublicKey);

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

    protected handleWriteBlob: HandlerFn<WriteBlobRequest, WriteBlobResponse> = async (peer: P2PClient, writeBlobRequest: WriteBlobRequest, fromMsgId: Buffer, expectingReply: ExpectingReply, sendResponse?: SendResponseFn<WriteBlobResponse>) => {
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

            if (writeBlobRequest.clientPublicKey.length === 0) {
                writeBlobRequest.clientPublicKey = CopyBuffer(this.clientPublicKey);
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
            if (!writeBlobRequest.clientPublicKey.equals(node.getOwner() as Buffer)) {
                node = await this.driver.fetchSingleNode(nodeId1, now, writeBlobRequest.clientPublicKey, writeBlobRequest.clientPublicKey);
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

            const dataId = Hash([nodeId1, writeBlobRequest.clientPublicKey]);

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
                if (!writeBlobRequest.clientPublicKey.equals(copyFromNode.getOwner() as Buffer)) {
                    copyFromNode = await this.driver.fetchSingleNode(writeBlobRequest.copyFromId1,
                        now, writeBlobRequest.clientPublicKey, writeBlobRequest.clientPublicKey);
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

    protected handleReadBlob: HandlerFn<ReadBlobRequest, ReadBlobResponse> = async (peer: P2PClient, readBlobRequest: ReadBlobRequest, fromMsgId: Buffer, expectingReply: ExpectingReply, sendResponse?: SendResponseFn<ReadBlobResponse>) => {
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

            if (readBlobRequest.clientPublicKey.length === 0) {
                readBlobRequest.clientPublicKey = CopyBuffer(this.clientPublicKey);
            }

            // Set default target consumer same as client
            if (readBlobRequest.targetPublicKey.length === 0) {
                readBlobRequest.targetPublicKey = CopyBuffer(readBlobRequest.clientPublicKey);
            }

            const nodeId1   = readBlobRequest.nodeId1;
            const posn      = readBlobRequest.pos;
            let length      = readBlobRequest.length;

            if (posn > Number.MAX_SAFE_INTEGER) {
                throw new Error("position too large to handle");
            }

            const pos = Number(posn);

            const now = this.timeFreeze.read();

            const node = await this.driver.fetchSingleNode(nodeId1, now, readBlobRequest.clientPublicKey, readBlobRequest.targetPublicKey);

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

    protected getTransformer(fetchRequest: FetchRequest, sendResponse: SendResponseFn<FetchResponse>): Transformer | undefined {

        fetchRequest.query.cutoffTime = 0n;

        // If this request does not create a trigger then reuse an existing transformers cache
        // to fetch from, if available.
        //
        if (fetchRequest.query.triggerNodeId.length === 0 && fetchRequest.query.triggerInterval === 0 &&
            fetchRequest.transform.cachedTriggerNodeId) {

            const transformer = this.getReadyTransformer(fetchRequest);

            if (transformer) {
                const handleFetchReplyData = this.handleFetchReplyDataFactory(sendResponse, undefined, fetchRequest.query.preserveTransient);

                const result = transformer.get(fetchRequest.transform.cursorId1,
                    fetchRequest.transform.head, fetchRequest.transform.tail);

                if (!result) {
                    const fetchReplyData: FetchReplyData = {
                        status: Status.MISSING_CURSOR,
                    };

                    handleFetchReplyData(fetchReplyData);

                    return undefined;
                }

                const [nodes, indexes] = result;

                const fetchReplyData: FetchReplyData = {
                    nodes,
                    indexes,
                };

                handleFetchReplyData(fetchReplyData);

                return undefined;
            }
        }

        if (!this.allowAnotherTransformer()) {
            const fetchReplyData: FetchReplyData = {
                status: Status.ERROR,
                error: "Out of memory to create transformer",
            };

            const handleFetchReplyData = this.handleFetchReplyDataFactory(sendResponse, undefined, fetchRequest.query.preserveTransient);
            handleFetchReplyData(fetchReplyData);

            return undefined;
        }

        const transformer = new Transformer(fetchRequest, this.maxTransformerLength);

        return transformer;
    }

    protected getReadyTransformer(fetchRequest: FetchRequest): Transformer | undefined {
        const key = Transformer.HashKey(fetchRequest);
        const idStr = fetchRequest.query.triggerNodeId.toString("hex");
        const triggers = this.triggers[idStr] ?? [];

        const triggersLength = triggers.length;
        for (let index=0; index<triggersLength; index++) {
            const trigger = triggers[index];
            if (trigger.key === key && trigger.hasFetched) {
                return trigger.transformer;
            }
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
