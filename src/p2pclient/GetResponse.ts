import EventEmitter from "eventemitter3";

import {
    RouteEvent,
    ReplyEvent,
    CloseEvent,
    ErrorEvent,
    AnyEvent,
    EventType,
    ExpectingReply,
} from "pocket-messaging";

import {
    P2PClient,
    HandlerFn,
} from "./P2PClient";

import {
    DeserializeInterface,
    SerializeInterface,
} from "./types";

import {
    PocketConsole,
} from "pocket-console";

import {
    Status,
    FetchResponse,
} from "../types";

const console = PocketConsole({module: "GetResponse"});

export type AnyData<ResponseDataType> = {
    type: EventType,
    error?: string,                     // only for onError
    hadError?: boolean,                 // Only for onClose
    response?: ResponseDataType,        // Only for onReply
    fromMsgId?: Buffer,                 // Only for onReply
    expectingReply?: ExpectingReply,    // Only for onReply
    sendResponse?: SendResponseFn<ResponseDataType>,  // Only for onReply
};

type SendResponseReturn<ResponseDataType> = {msgId: Buffer, getResponse?: GetResponse<ResponseDataType>};

/**
 * @throws on serialization error or socket error
 */
export type SendResponseFn<ResponseDataType> = (response: ResponseDataType, timeout?: number, stream?: boolean, timeoutStream?: number) => SendResponseReturn<ResponseDataType> | undefined;

export const SendResponseFactory = <ResponseDataType>(p2pClient: P2PClient, event: RouteEvent | ReplyEvent, serializeResponse: SerializeInterface<ResponseDataType> | undefined, deserializeResponse: DeserializeInterface<ResponseDataType>): SendResponseFn<ResponseDataType> | undefined => {

    if (event.expectingReply !== ExpectingReply.NONE && !serializeResponse) {
        throw new Error("Peer is asking for response but this route does not support responses.");
    }

    if (event.expectingReply === ExpectingReply.NONE) {
        return undefined;
    }

    return (response: ResponseDataType, timeout?: number, stream?: boolean, timeoutStream?: number, multipleStream?: boolean) => {
        if (serializeResponse) {
            const serialized = serializeResponse(response);
            const isStream = Boolean(stream);
            const sendReturn = p2pClient.getMessaging().send(event.fromMsgId, serialized, timeout, isStream, Number(timeoutStream));
            if (!sendReturn) {
                return undefined;
            }
            if (sendReturn.eventEmitter) {
                const isMultipleStream = Boolean(multipleStream);
                const getResponse = new GetResponse<ResponseDataType>(sendReturn.eventEmitter, sendReturn.msgId, serializeResponse, deserializeResponse, p2pClient, isStream, isMultipleStream);
                return {msgId: sendReturn.msgId, getResponse};
            }
            return {msgId: sendReturn.msgId};
        }
        throw new Error("Peer not expecting reply");
    };
};

/**
 * The GetResponse is what is used to collect replies from a peer we sent a request to.
 * @template ResponseDataType
 */
export class GetResponse<ResponseDataType> {
    protected eventEmitter: EventEmitter;
    protected triggers: {
        reply:   HandlerFn<ResponseDataType, ResponseDataType>[],
        error:   ((error: string) => void)[],
        timeout: (() => void)[],
        close:   ((hadError: boolean) => void)[],
        any:     ((anyData: AnyData<ResponseDataType>) => void)[],
        cancel:  (() => void)[],
    };
    protected deserializeResponse: DeserializeInterface<ResponseDataType>;
    protected serializeResponse?: SerializeInterface<ResponseDataType>;
    protected msgId: Buffer;
    protected p2pClient: P2PClient;
    protected isStream: boolean;
    protected isMultipleStream: boolean;

    /** Count the number of batches by remembering all endSeq numbers. */
    protected endSeqs: {[endSeq: string]: boolean} = {};

    /** Count fetch results to protect from overwhelm attacks. */
    protected fetchCount: number = 0;

    protected limit: number;

    /**
     *
     * @param limit optional limit which makes sense for certain ResponseDataTypes.
     *  For FetchResponse limit detects erroneous overflows in resultsets.
     */
    constructor(eventEmitter: EventEmitter, msgId: Buffer, serializeResponse: SerializeInterface<ResponseDataType> | undefined, deserializeResponse: DeserializeInterface<ResponseDataType>, p2pClient: P2PClient, isStream: boolean = false, isMultipleStream: boolean = false, limit: number = -1) {
        this.eventEmitter = eventEmitter;
        this.msgId = msgId;
        this.deserializeResponse = deserializeResponse;
        this.serializeResponse   = serializeResponse;
        this.p2pClient = p2pClient;
        this.isStream = isStream;
        this.isMultipleStream = isMultipleStream;
        this.limit = limit;
        this.triggers = { reply: [], error: [], timeout: [], close: [], any: [], cancel: [] };
        this.hookEvents();
    }

    protected hookEvents() {
        // These are events emitted by the Messaging instance.
        this.eventEmitter.on(EventType.REPLY, (replyEvent: ReplyEvent) => {
            try {
                const response = this.decodeReplyEvent(replyEvent);

                // Dirty check to see if FetchResponse
                //
                if (typeof((response as unknown as FetchResponse).result) === "object" &&
                    Array.isArray((response as unknown as FetchResponse).result.nodes) &&
                    Array.isArray((response as unknown as FetchResponse).result.embed))
                {
                    this.fetchCount += (response as unknown as FetchResponse).result.nodes.length
                        + (response as unknown as FetchResponse).result.embed.length;

                    if (this.limit > -1 && this.fetchCount > this.limit) {
                        // Overflow detected.
                        //
                        console.error(`Overflow detected in GetResponse, too many nodes/embed returned on query. limit=${this.limit}, fetchCount=${this.fetchCount}. Cancelling.`);

                        this.cancel();

                        return;
                    }
                }

                // Dirty check
                //
                if (typeof((response as unknown as FetchResponse).endSeq) === "number") {
                    const endSeq = (response as unknown as FetchResponse).endSeq;
                    if (endSeq > 0) {
                        this.endSeqs[endSeq] = true;
                    }
                }

                if (this.isStream) {
                    // The message in reply is expecting streaming responses.

                    // NOTE: Here we break out of the generics to do some dirty checks on the response object.
                    // We know in this code path that the response is with FetchResponse or ReadBlobResponse.

                    // We do a dirty check on the response object to look if it has the
                    // "seq" and "endSeq" attributes.
                    // seq must be set, must be > 0 and must be equal to endSeq.
                    const isEndOfStream = (response as unknown as FetchResponse)?.seq &&
                        (response as unknown as FetchResponse).seq === (response as unknown as FetchResponse).endSeq;

                    // Dirty check
                    // seq==0 indicates an error and we want to remove the message.
                    const cancelSeq = (response as unknown as FetchResponse)?.seq === 0;

                    // Dirty check
                    //
                    if (cancelSeq || (response as unknown as FetchResponse).status === Status.DroppedTrigger) {
                        this.cancel();
                    }
                    else if (isEndOfStream && this.isMultipleStream) {
                        // End of stream detected, since we are expecting more streams we clear
                        // the stream timeout so the message does not timeout unexpectedly,
                        // since we don't know when the next stream will start.
                        this.clearTimeout();

                        // Clear the nodes and embed count.
                        //
                        this.fetchCount = 0;
                    }
                    else if (isEndOfStream) {
                        // End of stream and no further streams expected, so remove message.
                        this.done();
                    }
                }

                const sendResponse = SendResponseFactory<ResponseDataType>(this.p2pClient,
                    replyEvent, this.serializeResponse, this.deserializeResponse);

                this.triggerReply(response, replyEvent.fromMsgId, replyEvent.expectingReply,
                    sendResponse);
            }
            catch(e) {
                // This is unexpected and needs to be inspected, we do not send back any reply to the sender.
                console.error("Unhandled exception in Responder.onReply handler function", e);
            }
        });

        this.eventEmitter.on(EventType.TIMEOUT, (/*timeoutEvent: TimeoutEvent*/) => {
            try {
                this.triggerTimeout();
                this.cancel();
            }
            catch(e) {
                console.error("Unhandled exception in Responder.onTimeout handler function", e);
            }
        });

        this.eventEmitter.on(EventType.ERROR, (errorEvent: ErrorEvent) => {
            try {
                this.triggerError(errorEvent.error);
                this.cancel();
            }
            catch(e) {
                console.error("Unhandled exception in Responder.onError handler function", e);
            }
        });

        this.eventEmitter.on(EventType.CLOSE, (closeEvent: CloseEvent) => {
            try {
                this.triggerClose(closeEvent.hadError);
                this.cancel();
            }
            catch(e) {
                console.error("Unhandled exception in Responder.onClose handler function", e);
            }
        });

        this.eventEmitter.on(EventType.ANY, (anyEvent: AnyEvent) => {
            if (this.triggers.any.length === 0) {
                // Don't bother
                return;
            }
            try {
                const anyData: AnyData<ResponseDataType> = {
                    type: anyEvent.type,
                };
                if (anyEvent.type === EventType.REPLY) {
                    const replyEvent = (anyEvent.event as ReplyEvent);
                    const response = this.decodeReplyEvent(replyEvent);
                    const sendResponse = SendResponseFactory<ResponseDataType>(this.p2pClient, replyEvent, this.serializeResponse, this.deserializeResponse);
                    anyData.response = response;
                    anyData.fromMsgId = replyEvent.fromMsgId;
                    anyData.expectingReply = replyEvent.expectingReply;
                    anyData.sendResponse = sendResponse;
                }
                else if (anyEvent.type === EventType.ERROR) {
                    const errorEvent = (anyEvent.event as ErrorEvent);
                    anyData.error = errorEvent.error;
                }
                else if (anyEvent.type === EventType.CLOSE) {
                    const closeEvent = (anyEvent.event as CloseEvent);
                    anyData.hadError = closeEvent.hadError;
                }
                else if (anyEvent.type === EventType.TIMEOUT) {
                    // No nothing
                }

                this.triggerAny(anyData);
            }
            catch(e) {
                console.error("Unhandled exception in Responder.onAny handler function", e);
            }
        });
    }

    protected decodeReplyEvent(replyEvent: ReplyEvent): ResponseDataType {
        return this.deserializeResponse(replyEvent.data);
    }

    public getBatchCount(): number {
        return Object.keys(this.endSeqs).length;
    }

    /**
     * Hook event for incoming response for when peer is replying to the request sent.
     * @throws if message is not pending reply.
     */
    public onReply = (fn: HandlerFn<ResponseDataType, ResponseDataType>) => {
        this.checkMsgPending();
        this.triggers.reply.push(fn);
        return this;
    }

    public offReply = (fn: HandlerFn<ResponseDataType, ResponseDataType>) => {
        const index = this.triggers.reply.indexOf(fn);
        if (index > -1) {
            this.triggers.reply.splice(index, 1);
        }
    }

    /**
     * Hook event for when error occurs on the socket.
     * @throws if message is not pending reply.
     */
    public onError = (fn: (error: string) => void) => {
        this.checkMsgPending();
        this.triggers.error.push(fn);
        return this;
    }

    public offError = (fn: (error: string) => void) => {
        const index = this.triggers.error.indexOf(fn);
        if (index > -1) {
            this.triggers.error.splice(index, 1);
        }
    }

    /**
     * Hook event for when a timeout is reached while waiting for a reply.
     * @throws if message is not pending reply.
     */
    public onTimeout = (fn: () => void) => {
        this.checkMsgPending();
        this.triggers.timeout.push(fn);
        return this;
    }

    public offTimeout = (fn: () => void) => {
        const index = this.triggers.timeout.indexOf(fn);
        if (index > -1) {
            this.triggers.timeout.splice(index, 1);
        }
    }

    /**
     * Hook event for when the underlying socket is closed.
     * @throws if message is not pending reply.
     */
    public onClose = (fn: (hadError: boolean) => void) => {
        this.checkMsgPending();
        this.triggers.close.push(fn);
        return this;
    }

    public offClose = (fn: (hadError: boolean) => void) => {
        const index = this.triggers.close.indexOf(fn);
        if (index > -1) {
            this.triggers.close.splice(index, 1);
        }
    }

    /**
     * Hook event for when the GetResponse is cancelled,
     * either on socket error, error response, timeout, unsubscription or socket close.
     * 
     * If socket closed then onClose is first triggerd then onCancel is triggered.
     *
     * NOTE: this event is NOT also triggered as an ANY event.
     *
     * @throws if message is not pending reply.
     */
    public onCancel = (fn: () => void) => {
        this.checkMsgPending();
        this.triggers.cancel.push(fn);
        return this;
    }

    public offCancel = (fn: () => void) => {
        const index = this.triggers.cancel.indexOf(fn);
        if (index > -1) {
            this.triggers.cancel.splice(index, 1);
        }
    }

    /**
     * Hook event for when any type of event is incoming.
     * @throws if message is not pending reply.
     */
    public onAny = (fn: (anyData: AnyData<ResponseDataType>) => void) => {
        this.checkMsgPending();
        this.triggers.any.push(fn);
        return this;
    }

    public offAny = (fn: (anyData: AnyData<ResponseDataType>) => void) => {
        const index = this.triggers.any.indexOf(fn);
        if (index > -1) {
            this.triggers.any.splice(index, 1);
        }
    }

    protected checkMsgPending() {
        if (!this.p2pClient.getMessaging().isMessagePending(this.getMsgId())) {
            throw new Error("No reply can come since msgId is not pending a reply in Messaging. Did you use the once pattern wrongly?");
        }
    }

    /**
     * @returns the msgId of the message sent and getting replied to.
     * This is the msgId to use for unsubscribe requests.
     */
    public getMsgId(): Buffer {
        return this.msgId;
    }

    /**
     * Return promise to wait for a single reply event.
     * Note that the return is an array which should be destructed to get the five callback parameters.
     * This is necessary since Promises can only pass a single parameter when resolving.
     *
     * Note that if using the once pattern for multiple simultaneous requests you must
     * first gather the promises then await them. If you await the first request using once
     * before getting the promise of the second requests's once, then the second's response might already
     * have passed by without any event handler to take care of it.
     *
     * @returns Promise<args: any[]>
     */
    public onceReply(): Promise<[P2PClient, ResponseDataType, Buffer, boolean, HandlerFn<ResponseDataType, ResponseDataType>]> {
        return this.onceFn(this.onReply, this.offReply);
    }

    /**
     * Return promise to wait for a single error event.
     */
    public onceError(): Promise<Buffer | undefined> {
        return this.onceFn(this.onError, this.offError);
    }

    /**
     * Return promise to wait for a single timeout event.
     */
    public onceTimeout(): Promise<void> {
        return this.onceFn(this.onTimeout, this.offTimeout);
    }

    /**
     * Return promise to wait for a single close event.
     */
    public onceClose(): Promise<boolean> {
        return this.onceFn(this.onClose, this.offClose);
    }

    /**
     * Return promise to wait for a single any event.
     *
     * Note that if using the once pattern for multiple simultaneous requests you must
     * first gather the promises then await them. If you await the first request using once
     * before getting the promise of the second requests's once, then the second's response might already
     * have passed by without any event handler to take care of it.
     */
    public onceAny(): Promise<AnyData<ResponseDataType>> {
        return this.onceFn(this.onAny, this.offAny);
    }

    protected onceFn = (onFn: (...args: any) => void, offFn: (...args: any) => void): Promise<any> => {
        let resolve: (...args: any) => void | undefined;
        const resolveFn = (...args: any[]) => {
            if (resolve) {
                if (args.length > 1) {
                    resolve(args);  // Pass all parameters as array (applicable for onceReply).
                }
                else {
                    resolve(args[0]);  // Only single parameter expected.
                }
            }
            else {
                // Just in case there is some race condition between the promise and the callback.
                setImmediate( () => resolveFn(...args));  /* ♥Selma5♥ */
            }
        };
        const fn = (...args: any[]) => {
            offFn(fn);
            resolveFn(...args);
        };

        onFn(fn);

        return new Promise<any>( resolve2 => {
            resolve = resolve2;
        });
    };

    protected triggerReply(response: ResponseDataType, fromMsgId: Buffer, expectingReply: ExpectingReply, sendResponse?: SendResponseFn<ResponseDataType>) {
        this.triggers.reply.forEach( fn => {
            fn(response, this.p2pClient, fromMsgId, expectingReply, sendResponse);
        });
    }

    protected triggerTimeout() {
        this.triggers.timeout.forEach( fn => {
            fn();
        });
    }

    protected triggerError(error: string) {
        this.triggers.error.forEach( fn => {
            fn(error);
        });
    }

    protected triggerClose(hadError: boolean) {
        this.triggers.close.forEach( fn => {
            fn(hadError);
        });
    }

    protected triggerCancel() {
        this.triggers.cancel.forEach( fn => {
            fn();
        });
    }

    protected triggerAny(anyData: AnyData<ResponseDataType>) {
        this.triggers.any.forEach( fn => {
            fn(anyData);
        });
    }

    /**
     * Removes the Responder by removing its EventEmitter from the messaging instance.
     * Triggers the onCancel event.
     */
    protected cancel() {
        this.p2pClient.getMessaging().cancelPendingMessage(this.getMsgId());

        this.triggerCancel();

        this.triggers.cancel.length = 0;
    }

    /**
     * Removes the Responder by removing its EventEmitter from the messaging instance.
     */
    protected done() {
        this.p2pClient.getMessaging().cancelPendingMessage(this.getMsgId());
    }

    /**
     * Clears the timeout for the pending message.
     */
    public clearTimeout() {
        this.p2pClient.getMessaging().clearTimeout(this.getMsgId());
    }
}
