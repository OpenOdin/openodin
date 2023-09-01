import {
    ExpectingReply,
} from "pocket-messaging";

import {
    P2PClient,
} from "../p2pclient";

import {
    SendResponseFn,
} from "./GetResponse";

import {
    SubscriptionMap,
} from "./types";

import {
    FetchResponse,
    StoreRequest,
    ReadBlobRequest,
    ReadBlobResponse,
    WriteBlobRequest,
    WriteBlobResponse,
    GenericMessageRequest,
    Status,
    FetchRequest,
    StoreResponse,
    UnsubscribeRequest,
    UnsubscribeResponse,
    GenericMessageResponse,
} from "../types";

// Uncomment this if ever using con sole in this class.
//import {
    //PocketConsole,
//} from "pocket-console";

//let console = PocketConsole({module: "P2PClientForwarder"});

export class P2PClientForwarder {
    /** Keep track of subscription msgIds so we can properly unsubscribe. */
    protected subscriptionMaps: SubscriptionMap[];

    /** Keep track of subscription msgIds to mute when storing. This can be shared with an P2PClientAutoFetcher. */
    protected muteMsgIds: Buffer[];

    /** Client we are receiving requests from. */
    protected senderClient: P2PClient;

    /** Client we are tunneling requests to. */
    protected targetClient: P2PClient;

    constructor(senderClient: P2PClient, targetClient: P2PClient, muteMsgIds?: Buffer[]) {
        this.senderClient = senderClient;
        this.targetClient = targetClient;
        this.muteMsgIds = muteMsgIds ?? [];
        this.subscriptionMaps = [];

        senderClient.onFetch( (...args) => this.handleFetch(...args) );
        senderClient.onStore( (...args) => this.handleStore(...args) );
        senderClient.onUnsubscribe( (...args) => this.handleUnsubscribe(...args) );
        senderClient.onReadBlob( (...args) => this.handleReadBlob(...args) );
        senderClient.onWriteBlob( (...args) => this.handleWriteBlob(...args) );
        senderClient.onMessage( (...args) => this.handleMessage(...args) );

        this.senderClient.onClose( () => this.close() );
        this.targetClient.onClose( () => this.close() );
    }

    /**
     */
    protected handleFetch(fetchRequest: FetchRequest, senderClient: P2PClient, fromMsgId: Buffer, expectingReply: ExpectingReply, sendResponse?: SendResponseFn<FetchResponse>)  {
        const isSubscription = fetchRequest.query.triggerNodeId.length > 0 || fetchRequest.query.triggerInterval > 0;

        // Send the modified request to the target.
        const {getResponse} = this.targetClient.fetch(fetchRequest);
        if (!getResponse) {
            return;
        }

        if (isSubscription) {
            // Save msgId associated in the Storage to use for unsubscription on close.
            const nextMsgId = getResponse.getMsgId();
            this.muteMsgIds.push(nextMsgId);
            const clientPublicKey = fetchRequest.query.clientPublicKey;
            this.subscriptionMaps.push({fromMsgId, originalMsgId: nextMsgId, clientPublicKey});
        }

        //response.onTimeout( () => {
            // Unknown state of the Storage.
            // There is nothing to do, but possibly report the error.
        //});

        if (sendResponse) {
            getResponse.onReply( async (fetchResponse: FetchResponse, targetClient: P2PClient) => {
                this.handleFetchResponse(sendResponse, targetClient, fetchResponse);
            });
        }
    }

    protected handleFetchResponse(sendResponse: SendResponseFn<FetchResponse>, targetClient: P2PClient, fetchResponse: FetchResponse) {
        // Tunnel the response back to the senderClient.
        sendResponse(fetchResponse);
    }

    /**
     *
     */
    protected handleStore(storeRequest: StoreRequest, senderClient: P2PClient, fromMsgId: Buffer, expectingReply: ExpectingReply, sendResponse?: SendResponseFn<StoreResponse>) {

        // Start with all msgIds which does not come from this Forwarder.
        const muteMsgIds = this.muteMsgIds.filter( msgId => {
            for (let i=0; i<this.subscriptionMaps.length; i++) {
                const subscriptionMap = this.subscriptionMaps[i];
                if (subscriptionMap.originalMsgId.equals(msgId)) {
                    return false;
                }
            }

            return true;
        });

        // Add those the client specifically wants to mute events on.
        storeRequest.muteMsgIds.forEach( (msgId: Buffer) => {
            for (let i=0; i<this.subscriptionMaps.length; i++) {
                const subscriptionMap = this.subscriptionMaps[i];
                if (subscriptionMap.fromMsgId.equals(msgId)) {
                    muteMsgIds.push(subscriptionMap.originalMsgId);
                }
            }
        });

        storeRequest.muteMsgIds = muteMsgIds;

        const {getResponse} = this.targetClient.store(storeRequest);

        if (!getResponse) {
            return;
        }

        getResponse.onReply( async (storeResponse: StoreResponse) => {
            // Tunnel the response back to the senderClient.
            if (sendResponse) {
                sendResponse(storeResponse);
            }
        });
    }

    /**
     */
    protected handleUnsubscribe(unsubscribeRequest: UnsubscribeRequest, senderClient: P2PClient, fromMsgId: Buffer, expectingReply: ExpectingReply, sendResponse?: SendResponseFn<UnsubscribeResponse>) {
        for (let i=0; i<this.subscriptionMaps.length; i++) {
            const subscriptionMap = this.subscriptionMaps[i];
            if (subscriptionMap.fromMsgId.equals(unsubscribeRequest.originalMsgId) && subscriptionMap.clientPublicKey.equals(unsubscribeRequest.clientPublicKey)) {
                this.subscriptionMaps.slice(i, 1);
                const {originalMsgId, clientPublicKey} = subscriptionMap;

                const index = this.muteMsgIds.findIndex( msgId => msgId.equals(originalMsgId) );
                if (index > -1) {
                    this.muteMsgIds.splice(index, 1);
                }

                this.targetClient.unsubscribe({originalMsgId, clientPublicKey});
                break;
            }
        }

        const unsubscribeResponse: UnsubscribeResponse = {
            status: Status.RESULT,
            error: "",
        };

        if (sendResponse) {
            sendResponse(unsubscribeResponse);
        }
    }

    /**
     */
    protected handleReadBlob(readBlobRequest: ReadBlobRequest, senderClient: P2PClient, fromMsgId: Buffer, expectingReply: ExpectingReply, sendResponse?: SendResponseFn<ReadBlobResponse>) {
        const {getResponse} = this.targetClient.readBlob(readBlobRequest);

        if (!getResponse) {
            return;
        }

        getResponse.onReply( async (readBlobResponse: ReadBlobResponse) => {
            if (sendResponse) {
                sendResponse(readBlobResponse);
            }
        });
    }

    protected handleWriteBlob(writeBlobRequest: WriteBlobRequest, senderClient: P2PClient, fromMsgId: Buffer, expectingReply: ExpectingReply, sendResponse?: SendResponseFn<WriteBlobResponse>) {
        const {getResponse} = this.targetClient.writeBlob(writeBlobRequest);
        if (!getResponse) {
            return;
        }

        getResponse.onReply( async (writeBlobResponse: WriteBlobResponse) => {
            if (sendResponse) {
                sendResponse(writeBlobResponse);
            }
        });
    }

    /*
     */
    protected handleMessage(genericMessageRequest: GenericMessageRequest, senderClient: P2PClient, fromMsgId: Buffer, expectingReply: ExpectingReply, sendResponse?: SendResponseFn<GenericMessageResponse>) {
        const {getResponse} = this.targetClient.message(genericMessageRequest);
        if (!getResponse) {
            return;
        }

        getResponse.onReply( async (genericMessageResponse: GenericMessageResponse) => {
            if (sendResponse) {
                sendResponse(genericMessageResponse);
            }
        });
    }

    /**
     * Unsubscribe from all subscriptions on targetClient.
     */
    public close() {
        const muteMsgIdsIndex: number[] = [];

        // Remove all subscriptions the senderClient has to the targetClient.
        this.subscriptionMaps.forEach( (subscriptionMap: SubscriptionMap) => {
            const index = this.muteMsgIds.findIndex( msgId => msgId.equals(subscriptionMap.originalMsgId) );
            if (index > -1) {
                muteMsgIdsIndex.push(index);
            }

            this.targetClient.unsubscribe({
                originalMsgId: subscriptionMap.originalMsgId,
                clientPublicKey: subscriptionMap.clientPublicKey,
            });
        });

        this.subscriptionMaps.length = 0;

        muteMsgIdsIndex.sort().reverse();

        muteMsgIdsIndex.forEach( index => this.muteMsgIds.splice(index, 1) );
    }

    public isClosed(): boolean {
        return this.senderClient.isClosed() || this.targetClient.isClosed();
    }
}
