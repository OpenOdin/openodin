import {
    Messaging,
    RouteEvent,
    PongEvent,
    ErrorEvent,
    EventType,
    ExpectingReply,
} from "pocket-messaging";

import {
    BebopSerialize,
    BebopDeserialize,
} from "./bebop";

import {
    Status,
    FetchRequest,
    StoreRequest,
    UnsubscribeRequest,
    WriteBlobRequest,
    ReadBlobRequest,
    GenericMessageRequest,
    WriteBlobResponse,
    ReadBlobResponse,
    StoreResponse,
    FetchResponse,
    UnsubscribeResponse,
    GenericMessageResponse,
    AllowEmbed,
} from "../types";

import {
    Filter,
} from "../datamodel";

import {
    GetResponse,
    SendResponseFn,
    SendResponseFactory,
} from "./GetResponse";

import {
    DeserializeInterface,
    SerializeInterface,
    P2PClientPermissions,
    LOCKED_PERMISSIONS,
    RouteAction,
} from "./types";

import {
    PeerData,
} from "./PeerData";

import {
    CopyBuffer,
    DeepHash,
    DeepCopy,
} from "../util/common";

import {
    RegionUtil,
} from "../util/RegionUtil";

import {
    PocketConsole,
} from "pocket-console";

const console = PocketConsole({module: "P2PClient"});

export type HandlerFn<RequestDataType, ResponseDataType> = (incoming: RequestDataType, peer: P2PClient, fromMsgId: Buffer, expectingReply: ExpectingReply, sendResponse?: SendResponseFn<ResponseDataType>) => void;

/**
 * The purpose of the P2PClient is to connect two peers over a common request-response protocol.
 * The P2PClient has a predefined set of requests which can be made, however the implementation
 * of the processing of the requests is not part of the P2PClient.
 *
 * The Client part of the protocol:
 * A message thread is initiated by the Client part of the protocol by calling one of the public functions:
 *  - fetch()
 *  - store()
 *  - readBlob()
 *  - writeBlob()
 *  - unsubscribe()
 *  - message()
 *
 * The client methods return a GetResponse object which is used to read the response from the server side.
 *
 * The Server part of the protocol 
 * An application hooks server side events to process and respond to incoming client requests.
 * - onFetch()
 * - onStore()
 * - onReadBlob()
 * - onWriteBlob()
 * - onUnsubscribe()
 * - onMessage()
 *
 * The handler function provided to the event registerer is provided the incoming message and a function to be used for sending a response.
 *
 * The Client also can send a response back on the first response sent from the Server and the Server can reply on that second message, etc, etc.
 */
export class P2PClient {
    protected messaging: Messaging;
    protected _isClosed: boolean;
    protected onCloseHandlers: ((peer: P2PClient) => void)[];
    protected handlerStore?: HandlerFn<StoreRequest, StoreResponse>;
    protected handlerFetch?: HandlerFn<FetchRequest, FetchResponse>;
    protected handlerUnsubscribe?: HandlerFn<UnsubscribeRequest, UnsubscribeResponse>;
    protected handlerReadBlob?: HandlerFn<ReadBlobRequest, ReadBlobResponse>;
    protected handlerWriteBlob?: HandlerFn<WriteBlobRequest, WriteBlobResponse>;
    protected handlerGenericMessage?: HandlerFn<GenericMessageRequest, GenericMessageResponse>;
    protected localPeerData: PeerData;
    protected remotePeerData: PeerData;
    protected readonly permissions: P2PClientPermissions;
    protected serialize: BebopSerialize;      // Note this should become an interface if we have more than one type of serializer.
    protected deserialize: BebopDeserialize;  // Note this should become an interface if we have more than one type of deserializer.

    /**
     * Semver version of the P2PClient.
     * Each field is 16 bit BE encoded uint.
     */
    public static readonly Version: Buffer = Buffer.from([0,0, 0,1, 0,0]);  // 0.1.0.

    /** Supported serializer formats. */
    public static readonly Formats: number[] = [0];  // 0 means Bebop serializer

    /** Event handlers who support multiple hooks. */
    protected handlers: {[name: string]: ( (...args: any) => void)[]} = {};

    protected sessionExpireTimeout?: ReturnType<typeof setTimeout>;

    /**
     * @param messaging is the handshaked Messaging instance.
     * @param localPeerData the PeerData representing this side.
     * @param remotePeerData the PeerData representing the remote side.
     * @param permissions which this p2pclient will enforce on incoming requests. Default permissions are locked down for incoming requests.
     * @param maxClockSkew milliseconds allowed between peer's clocks. No constraint if not set.
     */
    constructor(messaging: Messaging, localPeerData: PeerData, remotePeerData: PeerData, permissions?: P2PClientPermissions, maxClockSkew?: number) {
        this.messaging = messaging;
        this._isClosed = false;
        this.onCloseHandlers = [];

        if (remotePeerData.getSerializeFormat() === 0) {
            this.serialize = new BebopSerialize();
            this.deserialize = new BebopDeserialize();
        }
        else {
            throw new Error(`Given serialize format ${remotePeerData.getSerializeFormat()} is not supported by this P2PClient. Only these formats supported: ${P2PClient.Formats}`);
        }

        const remoteMajor = remotePeerData.getMajorVersion();
        const remoteMinor = remotePeerData.getMinorVersion();
        const localMajor = P2PClient.Version.readUInt16BE(0);
        const localMinor = P2PClient.Version.readUInt16BE(2);

        if (remoteMajor > localMajor || (remoteMajor === localMajor && remoteMinor >= localMinor)) {
            // Peer is either greater or same as us, we continue and let peer
            // decide if to abort connection in case it is greater and can't backadjust to our version.
            // Fall through
        }
        else {
            // Peer is lesser version than us, we decide if we can back adjust
            // and in such case instantiate that version of P2PClient.
            throw new Error(`Peer versions do not match, remote peer has a lesser version: ${remotePeerData.getVersion()} < ${P2PClient.Version}`);
        }

        if (maxClockSkew !== undefined && Math.abs(localPeerData.getClockDiff()) > maxClockSkew) {
            throw new Error(`Peer clock is too much off relatively to our clock. diff is=${localPeerData.getClockDiff()} ms`);
        }

        // Copy the PeerData objects, keeping transient values.
        //
        this.localPeerData = new PeerData();
        this.localPeerData.load(localPeerData.export(true), true);
        this.remotePeerData = new PeerData();
        this.remotePeerData.load(remotePeerData.export(true), true);

        const expireTime = localPeerData.getExpireTime() ?? 0;
        if (expireTime > 0) {
            console.debug(`Setting up session expiration in ${expireTime} seconds`);
            this.sessionExpireTimeout = setTimeout(() => {
                console.debug("Closing P2PClient session on expireTime");
                this.close();
            }, expireTime * 1000);
        }

        // Default permissions are locked down.
        this.permissions = DeepCopy(permissions ?? LOCKED_PERMISSIONS);

        const eventEmitter = this.messaging.getEventEmitter();
        eventEmitter.on(EventType.CLOSE, this.close);
        eventEmitter.on(EventType.ROUTE, this.routeIncoming);

        eventEmitter.on(EventType.PONG, (pongEvent: PongEvent) =>
            this.triggerEvent("messagingPong", pongEvent.roundTripTime) );

        eventEmitter.on(EventType.ERROR, (errorEvent: ErrorEvent) =>
            this.triggerEvent("messagingError", errorEvent.error) );
    }

    public getMessaging(): Messaging {
        return this.messaging;
    }

    public close = () => {
        if (this._isClosed) {
            return;
        }

        if (this.sessionExpireTimeout) {
            clearTimeout(this.sessionExpireTimeout);
        }

        this._isClosed = true;
        this.onCloseHandlers.forEach( cb => cb(this) );
        this.messaging.close();
    }

    public isClosed() {
        return this._isClosed;
    }

    public onClose(cb: (peer: P2PClient) => void) {
        this.onCloseHandlers.push(cb);
    }

    public offClose(cb: (peer: P2PClient) => void) {
        const index = this.onCloseHandlers.findIndex(cb2 => cb2 === cb);

        if (index > -1) {
            this.onCloseHandlers.splice(index, 1);
        }
    }

    /**
     * Get the PeerData describing this peer.
     */
    public getLocalPeerData(): PeerData {
        return this.localPeerData;
    }

    /**
     * @returns either the cryptographically handshaked key or primarily the key from an auth cert used
     * by this local peer to handshake.
     */
    public getLocalPublicKey(): Buffer {
        return CopyBuffer(this.localPeerData.getAuthCertPublicKey() ?? this.localPeerData.getHandshakePublicKey());
    }

    /**
     * @returns the PeerData describing the remote peer.
     */
    public getRemotePeerData(): PeerData {
        return this.remotePeerData;
    }

    /**
     * @returns the remote peer's public key,
     * either the cryptographically handshooked public key of the peer or the public key provided
     * by an auth cert on handshake.
     */
    public getRemotePublicKey(): Buffer {
        return CopyBuffer(this.remotePeerData.getAuthCertPublicKey() ?? this.remotePeerData.getHandshakePublicKey());
    }

    public getPermissions(): P2PClientPermissions {
        return DeepCopy(this.permissions) as P2PClientPermissions;
    }



    /***************************************************************************
     ******************************* Server part *******************************
     **************************************************************************/

    /**
     * Route new incoming requests.
     * Note that reply messages are routed directly from the pocket-messaging instance.
     */
    protected routeIncoming = async (routeEvent: RouteEvent) => {
        try {
            switch(routeEvent.target) {
                case RouteAction.STORE:
                    this.route<StoreRequest, StoreResponse>(RouteAction.STORE, routeEvent, this.handlerStore, this.limitStoreRequest, this.deserialize.StoreRequest, this.serialize.StoreResponse, this.deserialize.StoreResponse, {storedId1s: [], missingBlobId1s: [], missingBlobSizes: [], status: Status.ERROR, error: ""});
                    break;
                case RouteAction.FETCH:
                    this.route<FetchRequest, FetchResponse>(RouteAction.FETCH, routeEvent, this.handlerFetch, this.limitFetchRequest, this.deserialize.FetchRequest, this.serialize.FetchResponse, this.deserialize.FetchResponse, {seq: 0, endSeq: 0, result: {nodes: [], embed: [], cutoffTime: 0n}, crdtResult: {delta: Buffer.alloc(0), length: 0, cursorIndex: -1}, status: Status.ERROR, error: "", rowCount: 0});
                    break;
                case RouteAction.UNSUBSCRIBE:
                    this.route<UnsubscribeRequest, UnsubscribeResponse>(RouteAction.UNSUBSCRIBE, routeEvent, this.handlerUnsubscribe, this.limitUnsubscribeRequest, this.deserialize.UnsubscribeRequest, this.serialize.UnsubscribeResponse, this.deserialize.UnsubscribeResponse, {status: Status.ERROR, error: ""});
                    break;
                case RouteAction.WRITE_BLOB:
                    this.route<WriteBlobRequest, WriteBlobResponse>(RouteAction.WRITE_BLOB, routeEvent, this.handlerWriteBlob, this.limitWriteBlobRequest, this.deserialize.WriteBlobRequest, this.serialize.WriteBlobResponse, this.deserialize.WriteBlobResponse, {status: Status.ERROR, error: "", currentLength: 0n});
                    break;
                case RouteAction.READ_BLOB:
                    this.route<ReadBlobRequest, ReadBlobResponse>(RouteAction.READ_BLOB, routeEvent, this.handlerReadBlob, this.limitReadBlobRequest, this.deserialize.ReadBlobRequest, this.serialize.ReadBlobResponse, this.deserialize.ReadBlobResponse, {data: Buffer.alloc(0), seq: 0, endSeq: 0, blobLength: 0n, status: Status.ERROR, error: ""});
                    break;
                case RouteAction.MESSAGE:
                    this.route<GenericMessageRequest, GenericMessageResponse>(RouteAction.MESSAGE, routeEvent, this.handlerGenericMessage, this.limitGenericMessageRequest, this.deserialize.GenericMessageRequest, this.serialize.GenericMessageResponse, this.deserialize.GenericMessageResponse, {data: Buffer.alloc(0), status: Status.ERROR, error: ""});
                    break;
                default:
                    // This is either a request for an unknown action on this side, or
                    // more likely a reply to a sent message which has gotten timeouted and removed from the Messaging instance and also the message ID happens to be all alphanumeric.
                    // In the case the incoming message is a reply message we must not reply to avoid endless reply loops, so we
                    // do nothing.
            }
        }
        catch(e) {
            console.error("An error occurred while routing message of type ${routeEvent.target}", e);
        }
    }

    /**
     * Set handler for incoming store request sent from peer.
     * Note there can only be one handler set.
     * Any exception thrown by the handler function will be stringified and sent as response to peer.
     */
    public onStore(fn: HandlerFn<StoreRequest, StoreResponse>) {
        this.handlerStore = fn;
    }

    /**
     * Set handler for incoming fetch request sent from peer.
     * Note there can only be one handler set.
     * Any exception thrown by the handler function will be stringified and sent as response to peer.
     */
    public onFetch(fn: HandlerFn<FetchRequest, FetchResponse>) {
        this.handlerFetch = fn;
    }

    /**
     * Set handler for incoming unsubscribe request sent from peer.
     * Note there can only be one handler set.
     * Any exception thrown by the handler function will be stringified and sent as response to peer.
     */
    public onUnsubscribe(fn: HandlerFn<UnsubscribeRequest, UnsubscribeResponse>) {
        this.handlerUnsubscribe = fn;
    }

    /**
     * Set handler for incoming read-blob request sent from peer.
     * Note there can only be one handler set.
     * Any exception thrown by the handler function will be stringified and sent as response to peer.
     */
    public onReadBlob(fn: HandlerFn<ReadBlobRequest, ReadBlobResponse>) {
        this.handlerReadBlob = fn;
    }

    /**
     * Set handler for incoming write-blob request sent from peer.
     * Note there can only be one handler set.
     * Any exception thrown by the handler function will be stringified and sent as response to peer.
     */
    public onWriteBlob(fn: HandlerFn<WriteBlobRequest, WriteBlobResponse>) {
        this.handlerWriteBlob = fn;
    }

    /**
     * Set handler for incoming generic message request sent from peer.
     * Note there can only be one handler set.
     * Any exception thrown by the handler function will be stringified and sent as response to peer.
     */
    public onMessage(fn: HandlerFn<GenericMessageRequest, GenericMessageResponse>) {
        this.handlerGenericMessage = fn;
    }

    public onMessagingError(callback: (message: string) => void) {
        this.hookEvent("messagingError", callback);
    }

    public onMessagingPong(callback: (roundTripTime: number) => void) {
        this.hookEvent("messagingPong", callback);
    }

    /**
     * Handles an incoming request on the router.
     * @throws if response is requested but not supported and on socket error.
     */
    protected async route<RequestDataType, ResponseDataType>(routeAction: string, routeEvent: RouteEvent, handlerFn: HandlerFn<RequestDataType, ResponseDataType> | undefined, limitFn: (request: RequestDataType, sendResponse: SendResponseFn<ResponseDataType> | undefined) => RequestDataType | undefined, deserializeRequest: DeserializeInterface<RequestDataType>, serializeResponse: SerializeInterface<ResponseDataType> | undefined, deserializeResponse: DeserializeInterface<ResponseDataType>, defaultErrorData: ResponseDataType) {
        if (!this.messaging) {
            return;
        }

        const sendResponse = SendResponseFactory<ResponseDataType>(this, routeEvent, serializeResponse, deserializeResponse);

        try {
            if (!handlerFn) {
                throw new Error(`Method not supported`);
            }

            const request = limitFn(deserializeRequest(routeEvent.data), sendResponse);

            if (!request) {
                return;
            }

            await handlerFn(request, this, routeEvent.fromMsgId, routeEvent.expectingReply, sendResponse);
        }
        catch(e) {
            console.error(`Exception when routing incoming message with action: ${routeAction}`, e);
            const error = `Request ${routeAction} failed: ${e}`;
            const errorResponse: ResponseDataType = {
                ...defaultErrorData,  // We need this to populate the object with empty properties since missing properties are not allowed.
                error,
            };
            if (sendResponse) {
                sendResponse(errorResponse);
            }
        }
    }

    /**
     * Limit an incoming GenericMessageRequest according to the permissions in this P2PClient.
     * @param GenericMessageRequest
     * @returns limited genericMessageRequest
     */
    protected limitGenericMessageRequest = (genericMessageRequest: GenericMessageRequest/*, sendResponse: SendResponseFn<GenericMessageResponse> | undefined*/): GenericMessageRequest => {

        if (this.permissions.allowUncheckedAccess) {
            if (genericMessageRequest.sourcePublicKey.length === 0) {
                throw new Error("peerPublicKey expected to be set when calling");
            }
        }
        else {
            // Set default values
            if (genericMessageRequest.sourcePublicKey.length === 0) {
                genericMessageRequest.sourcePublicKey = this.getRemotePublicKey();
            }

            // Check so values are set as expected.
            if (!genericMessageRequest.sourcePublicKey.equals(this.getRemotePublicKey())) {
                throw new Error("Mismatch in provided sourcePublicKey");
            }
        }

        return genericMessageRequest;
    };

    /**
     * Limit an incoming WriteBlobRequest according to the permissions in this P2PClient.
     * @param writeBlobRequest
     * @returns limited WriteBlobRequest or undefined if not allowed.
     */
    protected limitWriteBlobRequest = (writeBlobRequest: WriteBlobRequest, sendResponse: SendResponseFn<WriteBlobResponse> | undefined): WriteBlobRequest | undefined => {
        if (!this.permissions.storePermissions.allowWriteBlob) {
            const writeBlobResponse: WriteBlobResponse = {
                status: Status.NOT_ALLOWED,
                error: "Write blob is not allowed",
                currentLength: 0n,
            };

            if (sendResponse) {
                sendResponse(writeBlobResponse);
            }

            return undefined;
        }

        if (this.permissions.allowUncheckedAccess) {
            if (writeBlobRequest.sourcePublicKey.length === 0) {
                throw new Error("sourcePublicKey expected to be set when calling");
            }

            if (writeBlobRequest.targetPublicKey.length === 0) {
                throw new Error("targetPublicKey expected to be set when calling");
            }
        }
        else {
            // Set default values
            if (writeBlobRequest.sourcePublicKey.length === 0) {
                writeBlobRequest.sourcePublicKey = this.getRemotePublicKey();
            }

            if (writeBlobRequest.targetPublicKey.length === 0) {
                writeBlobRequest.targetPublicKey = this.getLocalPublicKey();
            }

            // Check so values are set as expected.
            if (!writeBlobRequest.sourcePublicKey.equals(this.getRemotePublicKey())) {
                throw new Error("Mismatch in provided sourcePublicKey");
            }

            if (!writeBlobRequest.targetPublicKey.equals(this.getLocalPublicKey())) {
                throw new Error("Mismatch in provided targetPublicKey");
            }
        }

        return writeBlobRequest;
    };

    /**
     * Limit an incoming ReadBlobRequest according to the permissions in this P2PClient.
     * @param readBlobRequest
     * @returns limited ReadBlobRequest or undefined if not allowed.
     */
    protected limitReadBlobRequest = (readBlobRequest: ReadBlobRequest, sendResponse: SendResponseFn<ReadBlobResponse> | undefined): ReadBlobRequest | undefined => {
        if (!this.permissions.fetchPermissions.allowReadBlob) {
            const readBlobResponse: ReadBlobResponse = {
                status: Status.NOT_ALLOWED,
                error: "Read blob is not allowed",
                data: Buffer.alloc(0),
                blobLength: 0n,
                seq: 0,
                endSeq: 0,
            };

            if (sendResponse) {
                sendResponse(readBlobResponse);
            }

            return undefined;
        }

        if (this.permissions.allowUncheckedAccess) {
            if (readBlobRequest.targetPublicKey.length === 0) {
                throw new Error("targetPublicKey expected to be set when calling");
            }

            if (readBlobRequest.sourcePublicKey.length === 0) {
                throw new Error("sourcePublicKey expected to be set when calling");
            }
        }
        else {
            // Set default values
            if (readBlobRequest.targetPublicKey.length === 0) {
                readBlobRequest.targetPublicKey = this.getRemotePublicKey();
            }

            if (readBlobRequest.sourcePublicKey.length === 0) {
                readBlobRequest.sourcePublicKey = this.getLocalPublicKey();
            }

            // Check so values are set as expected.
            if (!readBlobRequest.targetPublicKey.equals(this.getRemotePublicKey())) {
                throw new Error("Mismatch in provided targetPublicKey");
            }

            if (!readBlobRequest.sourcePublicKey.equals(this.getLocalPublicKey())) {
                throw new Error("Mismatch in provided sourcePublicKey");
            }
        }

        return readBlobRequest;
    };

    /**
     * Limit an incoming UnsubscribeRequest according to the permissions in this P2PClient.
     * @param unsubscribeRequest
     * @returns limited UnsubscribeRequest
     */
    protected limitUnsubscribeRequest = (unsubscribeRequest: UnsubscribeRequest/*, sendResponse: SendResponseFn<UnsubscribeResponse> | undefined*/): UnsubscribeRequest => {
        if (this.permissions.allowUncheckedAccess) {
            if (unsubscribeRequest.targetPublicKey.length === 0) {
                throw new Error("targetPublicKey expected to be set when calling");
            }
        }
        else {
            // Set default values
            if (unsubscribeRequest.targetPublicKey.length === 0) {
                unsubscribeRequest.targetPublicKey = this.getRemotePublicKey();
            }

            // Check so values are set as expected.
            if (!unsubscribeRequest.targetPublicKey.equals(this.getRemotePublicKey())) {
                throw new Error("Mismatch in provided targetPublicKey");
            }
        }

        return unsubscribeRequest;
    };

    /**
     * Limit an incoming StoreRequest according to the permissions in this P2PClient.
     * @param storeRequest
     * @returns limited storeRequest or undefined if not allowed.
     */
    protected limitStoreRequest = (storeRequest: StoreRequest, sendResponse: SendResponseFn<StoreResponse> | undefined): StoreRequest | undefined => {
        if (!this.permissions.storePermissions.allowStore) {
            if (sendResponse) {
                const storeResponse: StoreResponse = {
                    status: Status.ERROR,
                    storedId1s: [],
                    missingBlobId1s: [],
                    missingBlobSizes: [],
                    error: "Store not allowed",
                };

                sendResponse(storeResponse);
            }

            return undefined;
        }

        if (this.permissions.allowUncheckedAccess) {
            if (storeRequest.targetPublicKey.length === 0) {
                throw new Error("targetPublicKey expected to be set when calling");
            }

            if (storeRequest.sourcePublicKey.length === 0) {
                throw new Error("sourcePublicKey expected to be set when calling");
            }
        }
        else {
            // Set default values
            if (storeRequest.sourcePublicKey.length === 0) {
                storeRequest.sourcePublicKey = this.getRemotePublicKey();
            }

            if (storeRequest.targetPublicKey.length === 0) {
                storeRequest.targetPublicKey = this.getRemotePublicKey();
            }

            // Check so values are set as expected.
            if (!storeRequest.sourcePublicKey.equals(this.getRemotePublicKey())) {
                throw new Error("Mismatch in provided sourcePublicKey");
            }

            if (!storeRequest.targetPublicKey.equals(this.getRemotePublicKey())) {
                throw new Error("Mismatch in provided targetPublicKey");
            }
        }

        return storeRequest;
    };

    /**
     * Limit an incoming FetchRequest according to the permissions in this P2PClient.
     * If an error is encountered the it will send a response and return undefined.
     * @param fetchRequest
     * @returns limited fetchRequest or undefined on error
     */
    protected limitFetchRequest = (fetchRequest: FetchRequest, sendResponse: SendResponseFn<FetchResponse> | undefined): FetchRequest | undefined => {
        let errorMsg = "";
        let allowed: boolean = true;

        if (fetchRequest.query.triggerNodeId.length > 0 || fetchRequest.query.triggerInterval > 0) {
            if (!this.permissions.fetchPermissions.allowTrigger) {
                allowed = false;
            }
        }

        if (allowed) {
            // Check fetchRequest.query so that only allowed node types are in there.
            for (let i=0; i<fetchRequest.query.match.length; i++) {
                const match = fetchRequest.query.match[i];
                if (this.permissions.fetchPermissions.allowNodeTypes.findIndex( (nodeType: Buffer) => nodeType.equals(match.nodeType.slice(0, nodeType.length)) ) === -1) {
                    errorMsg = `nodeType requested (${match.nodeType.toString("hex")}) not allowed`;
                    allowed = false;
                    break;
                }
            }
        }

        if (allowed) {
            const algoId = fetchRequest.crdt.algo;

            if (algoId > 0 && this.permissions.fetchPermissions.allowAlgos.indexOf(algoId) === -1) {
                errorMsg = `CRDT algo ${algoId} requested is not supported`;
                allowed = false;
            }
        }

        if (!allowed) {
            const fetchResponseNotAllowed: FetchResponse = {
                status: Status.NOT_ALLOWED,
                error: `Fetch/Subscription request as stated is not allowed: ${errorMsg}.`,
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
                seq: 0,
                endSeq: 0,
                rowCount: 0,
            };
            if (sendResponse) {
                sendResponse(fetchResponseNotAllowed);
            }
            return undefined;
        }

        // Intersect what the client wants to embed and what we allow to be embedded.
        const allowEmbed = this.intersectAllowedEmbed(fetchRequest.query.embed, this.permissions.fetchPermissions.allowEmbed);


        // Copy fetchRequest with some changes to forward it to our storage.
        const fetchRequest2: FetchRequest = {
            query: {
                ...fetchRequest.query,
                embed: allowEmbed,
                includeLicenses: fetchRequest.query.includeLicenses & this.permissions.fetchPermissions.allowIncludeLicenses,
            },
            crdt: fetchRequest.crdt,
        };

        // Forcefully set region and jurisdiction on the fetchQuery.
        fetchRequest2.query.region = RegionUtil.IntersectRegions(this.remotePeerData.getRegion(), this.localPeerData.getRegion());
        fetchRequest2.query.jurisdiction = RegionUtil.IntersectJurisdictions(this.remotePeerData.getJurisdiction(), this.localPeerData.getJurisdiction());

        if (this.permissions.allowUncheckedAccess) {
            if (fetchRequest2.query.sourcePublicKey.length === 0) {
                throw new Error("sourcePublicKey expected to be set when calling");
            }

            if (fetchRequest2.query.targetPublicKey.length === 0) {
                throw new Error("targetPublicKey expected to be set when calling");
            }
        }
        else {
            // Set default values
            if (fetchRequest2.query.sourcePublicKey.length === 0) {
                fetchRequest2.query.sourcePublicKey = this.getLocalPublicKey();
            }

            if (fetchRequest2.query.targetPublicKey.length === 0) {
                fetchRequest2.query.targetPublicKey = this.getRemotePublicKey();
            }

            // Check so values are set as expected.
            if (!fetchRequest2.query.sourcePublicKey.equals(this.getLocalPublicKey())) {
                throw new Error("Mismatch in provided sourcePublicKey");
            }

            if (!fetchRequest2.query.targetPublicKey.equals(this.getRemotePublicKey())) {
                throw new Error("Mismatch in provided targetPublicKey");
            }
        }

        return fetchRequest2;
    };

    protected intersectAllowedEmbed(senderAllowedEmbed: AllowEmbed[], targetAllowedEmbed: AllowEmbed[]): AllowEmbed[] {
        const allowEmbed: AllowEmbed[] = [];
        for (let i=0; i<targetAllowedEmbed.length; i++) {
            const permitted = targetAllowedEmbed[i];
            for (let i2=0; i2<senderAllowedEmbed.length; i2++) {
                const clientAllowed = senderAllowedEmbed[i2];
                const nodeTypeClient = clientAllowed.nodeType;
                const nodeTypePermitted = permitted.nodeType;
                const minLength = Math.min(nodeTypeClient.length, nodeTypePermitted.length);
                if (nodeTypeClient.slice(0, minLength).equals(nodeTypePermitted.slice(0, minLength))) {
                    const longestNodeType = nodeTypeClient.length > minLength ? nodeTypeClient : nodeTypePermitted;

                    // Filter out duplicate filters.
                    const hashes: {[hash: string]: boolean} = {};
                    const filters: Filter[] = [...clientAllowed.filters, ...permitted.filters].filter( filter => {
                        const hash = DeepHash(filter).toString("hex");

                        if (hashes[hash]) {
                            return false;
                        }

                        hashes[hash] = true;

                        return true;
                    });

                    allowEmbed.push({
                        nodeType: longestNodeType,
                        filters,
                    });
                }
            }
        }

        return allowEmbed;
    }

    //SELMA ♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥

    /***************************************************************************
     ******************************* Client part *******************************
     **************************************************************************/

    /**
     * Send a read-blob request to peer.
     *
     * @param timeout milliseconds to wait for a reply. Default is 60000. 0 means wait forever for reply.
     * @param timeoutStream: number default is 60000. 0 means wait forever on multiple replies.
     * @return {getResponse: GetResponse | undefined, msgId: Buffer | undefined} where
     * msgId is undefined on error sending and getResponse is undefined if not expecting any reply.
     */
    public readBlob(readBlobRequest: ReadBlobRequest, timeout: number = 60000, timeoutStream: number = 60000): {getResponse: GetResponse<ReadBlobResponse> | undefined, msgId: Buffer | undefined} {
        try {
            const data = this.serialize.ReadBlobRequest(readBlobRequest);
            const isStream = true;
            const sendReturn = this.messaging.send(RouteAction.READ_BLOB, data, timeout, isStream, timeoutStream);

            if (!sendReturn) {
                return {getResponse: undefined, msgId: undefined};
            }

            if (!sendReturn.eventEmitter) {
                return {getResponse: undefined, msgId: sendReturn.msgId};
            }

            const getResponse = new GetResponse<ReadBlobResponse>(sendReturn.eventEmitter, sendReturn.msgId, this.serialize.ReadBlobResponse, this.deserialize.ReadBlobResponse, this, isStream);
            return {getResponse, msgId: sendReturn.msgId};
        }
        catch(e) {
            console.error("Exception when sending readBlob request", e);
            return {getResponse: undefined, msgId: undefined};
        }
    }

    /**
     * Send a write-blob request to peer.
     *
     * @param timeout milliseconds to wait for a reply. Set to -1 to not expect reply. Default is 60000. 0 means wait forever for reply.
     * @return {getResponse: GetResponse | undefined, msgId: Buffer | undefined} where
     * msgId is undefined on error sending and getResponse is undefined if not expecting any reply.
     */
    public writeBlob(writeBlobRequest: WriteBlobRequest, timeout: number = 60000): {getResponse: GetResponse<WriteBlobResponse> | undefined, msgId: Buffer | undefined} {
        try {
            const data = this.serialize.WriteBlobRequest(writeBlobRequest);
            const sendReturn = this.messaging.send(RouteAction.WRITE_BLOB, data, timeout);

            if (!sendReturn) {
                return {getResponse: undefined, msgId: undefined};
            }

            if (!sendReturn.eventEmitter) {
                return {getResponse: undefined, msgId: sendReturn.msgId};
            }

            const getResponse = new GetResponse<WriteBlobResponse>(sendReturn.eventEmitter, sendReturn.msgId, this.serialize.WriteBlobResponse, this.deserialize.WriteBlobResponse, this);
            return {getResponse, msgId: sendReturn.msgId};
        }
        catch(e) {
            console.error("Exception when sending writeBlob request", e);
            return {getResponse: undefined, msgId: undefined};
        }
    }

    /**
     * Send an unsubscribe request to peer.
     *
     * Default behaviour of this function is to not expect any reply
     * @param timeout: number timeout in milliseconds to wait for reply. Default is -1 which means do not expect reply. 0 means wait forever for reply.
     * @return {getResponse: GetResponse | undefined, msgId: Buffer | undefined} where
     * msgId is undefined on error sending and getResponse is undefined if not expecting any reply.
     */
    public unsubscribe(unsubscribeRequest: UnsubscribeRequest, timeout: number = -1): {getResponse: GetResponse<UnsubscribeResponse> | undefined, msgId: Buffer | undefined} {
        try {
            const data = this.serialize.UnsubscribeRequest(unsubscribeRequest);

            const sendReturn = this.messaging.send(RouteAction.UNSUBSCRIBE, data, timeout);

            if (!sendReturn) {
                return {getResponse: undefined, msgId: undefined};
            }

            if (!sendReturn.eventEmitter) {
                return {getResponse: undefined, msgId: sendReturn.msgId};
            }

            const getResponse = new GetResponse<UnsubscribeResponse>(sendReturn.eventEmitter, sendReturn.msgId, this.serialize.UnsubscribeResponse, this.deserialize.UnsubscribeResponse, this);
            return {getResponse, msgId: sendReturn.msgId};
        }
        catch(e) {
            console.error("Exception when sending unsubscribe request", e);
            return {getResponse: undefined, msgId: undefined};
        }
    }

    /**
     * @param timeout milliseconds to wait for a reply. set to -1 to not expect any reply. Default is 60000. 0 means wait forever for reply.
     * @return {getResponse: GetResponse | undefined, msgId: Buffer | undefined} where
     * msgId is undefined on error sending and getResponse is undefined if not expecting any reply.
     */
    public store(storeRequest: StoreRequest, timeout: number = 60000): {getResponse: GetResponse<StoreResponse> | undefined, msgId: Buffer | undefined} {
        try {
            const data = this.serialize.StoreRequest(storeRequest);
            const sendReturn = this.messaging.send(RouteAction.STORE, data, timeout);

            if (!sendReturn) {
                return {getResponse: undefined, msgId: undefined};
            }

            if (!sendReturn.eventEmitter) {
                return {getResponse: undefined, msgId: sendReturn.msgId};
            }

            const getResponse = new GetResponse<StoreResponse>(sendReturn.eventEmitter, sendReturn.msgId, this.serialize.StoreResponse, this.deserialize.StoreResponse, this);
            return {getResponse, msgId: sendReturn.msgId};
        }
        catch(e) {
            console.error("Exception when sending store request", e);
            return {getResponse: undefined, msgId: undefined};
        }
    }

    /**
     * @param fetchRequest to send to peer.
     * @param timeout How many milliseconds to wait for first reply. 0 means wait forever for first reply.
     * @param timeoutStream How many milliseconds until timeout if end-of-stream is not reached.
     * Set to 0 (default) to not timeout while streaming.
     * Timeout counter is reset on each message received in the stream.
     * @return {getResponse: GetResponse | undefined, msgId: Buffer | undefined} where
     * msgId is undefined on error sending and getResponse is undefined if not expecting any reply.
     */
    public fetch(fetchRequest: FetchRequest, timeout: number = 60000, timeoutStream: number = 0): {getResponse: GetResponse<FetchResponse> | undefined, msgId: Buffer | undefined} {
        try {
            // We are always ready for the response to be larger than a single envelope.
            const isStream = true;
            const data = this.serialize.FetchRequest(fetchRequest);
            const sendReturn = this.messaging.send(RouteAction.FETCH, data, timeout, isStream, timeoutStream);

            if (!sendReturn) {
                return {getResponse: undefined, msgId: undefined};
            }

            if (!sendReturn.eventEmitter) {
                return {getResponse: undefined, msgId: sendReturn.msgId};
            }

            // If subscription then we are expecting multiple responses.
            const isMultipleStream = fetchRequest.query.triggerNodeId.length > 0 || fetchRequest.query.triggerInterval > 0;
            const getResponse = new GetResponse<FetchResponse>(sendReturn.eventEmitter, sendReturn.msgId, this.serialize.FetchResponse, this.deserialize.FetchResponse, this, isStream, isMultipleStream);
            return {getResponse, msgId: sendReturn.msgId};
        }
        catch(e) {
            console.error("Exception when sending fetch request", e);
            return {getResponse: undefined, msgId: undefined};
        }
    }

    /**
     * @param timeout milliseconds to wait for reply. Set to -1 to not expect reply. Default is 60000. 0 means wait forever for reply.
     * @return {getResponse: GetResponse | undefined, msgId: Buffer | undefined} where
     * msgId is undefined on error sending and getResponse is undefined if not expecting any reply.
     */
    public message(genericMessageRequest: GenericMessageRequest, timeout: number | undefined = 60000, stream?: boolean, timeoutStream?: number, multipleStream?: boolean): {getResponse: GetResponse<GenericMessageResponse> | undefined, msgId: Buffer | undefined} {
        try {
            const data = this.serialize.GenericMessageRequest(genericMessageRequest);

            // Are we anticipating the response to be larger than a single envelope?
            const isStream = Boolean(stream);
            const sendReturn = this.messaging.send(RouteAction.MESSAGE, data, timeout, isStream, Number(timeoutStream));

            if (!sendReturn) {
                return {getResponse: undefined, msgId: undefined};
            }

            if (!sendReturn.eventEmitter) {
                return {getResponse: undefined, msgId: sendReturn.msgId};
            }

            // Are we expecting multiple responses to this message?
            const isMultipleStream = Boolean(multipleStream);
            const getResponse = new GetResponse<GenericMessageResponse>(sendReturn.eventEmitter, sendReturn.msgId, this.serialize.GenericMessageResponse, this.deserialize.GenericMessageResponse, this, isStream, isMultipleStream);
            return {getResponse, msgId: sendReturn.msgId};
        }
        catch(e) {
            return {getResponse: undefined, msgId: undefined};
        }
    }

    protected hookEvent(name: string, callback: (...args: any[]) => void) {
        const cbs = this.handlers[name] || [];
        this.handlers[name] = cbs;
        cbs.push(callback);
    }

    protected unhookEvent(name: string, callback: (...args: any[]) => void) {
        const cbs = (this.handlers[name] || []).filter( (cb: ( (...args: any) => void)) => callback !== cb );
        this.handlers[name] = cbs;
    }

    protected triggerEvent(name: string, ...args: any[]) {
        const cbs = this.handlers[name] || [];
        cbs.forEach( (callback: ( (...args: any[]) => void)) => {
            setImmediate( () => callback(...args) );
        });
    }
}
