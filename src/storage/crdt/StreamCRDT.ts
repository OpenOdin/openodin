import {
    DeepCopy,
} from "../../util/common";

import {
    Status,
    FetchResponse,
    FetchRequest,
} from "../../types";

import {
    P2PClient,
    GetResponse,
} from "../../p2pclient";

import {
    CRDTView,
} from "./CRDTView";

import {
    UpdateStreamParams,
    SetDataFn,
    UnsetDataFn,
} from "./types";

/**
 * Issue a streaming request into a CRDT model.
 *
 * This also works for FetchRequests without CRDT in which case the use of the model is append only
 * and also that there are no duplicates (this is useful as streaming directly from
 * P2PClient/GetResponse can yield duplicates due to the at-least-once nature of the system).
 */
export class StreamCRDT {
    protected handlers: {[name: string]: ( (...args: any) => void)[]} = {};

    protected getResponseObj: GetResponse<FetchResponse>;

    protected fetchRequest: FetchRequest;

    protected crdtView: CRDTView;

    protected isClosed: boolean = false;
    protected isStopped: boolean = false;

    protected purgeTimeout?: ReturnType<typeof setTimeout>;

    constructor(fetchRequest: FetchRequest,
        protected storageClient: P2PClient,
        protected setDataFn?: SetDataFn,
        protected unsetDataFn?: UnsetDataFn,
        protected purgeInterval: number = 60_000)
    {
        this.fetchRequest = DeepCopy(fetchRequest) as FetchRequest;

        this.crdtView = new CRDTView(fetchRequest.query.preserveTransient, setDataFn, unsetDataFn);

        const {getResponse} = this.storageClient.fetch(fetchRequest, /*timeout=*/0);

        if (!getResponse) {
            throw new Error("unexpectedly missing getResponse");
        }

        this.getResponseObj = getResponse;

        this.getResponseObj.onReply( (fetchResponse: FetchResponse) => {
            if (fetchResponse.status === Status.Result) {
                this.crdtView.handleResponse(fetchResponse);
            }
            else if (fetchResponse.status === Status.DroppedTrigger) {
                // Do nothing
            }
            else {
                console.debug(`Error code (${fetchResponse.status}) returned on fetch, error message: ${fetchResponse.error}`);
            }
        });

        this.getResponseObj.onCancel( () => {
            if (this.purgeTimeout) {
                clearTimeout(this.purgeTimeout);
                delete this.purgeTimeout;
                this.purgeInterval = 0;
            }

            if (!this.isStopped) {
                this.isStopped = true;
                this.triggerEvent("stop");
            }
        });

        if (this.purgeInterval > 0) {
            this.purgeTimeout = setTimeout( () => this.purge(), this.purgeInterval);
        }
    }

    protected purge() {
        this.crdtView.purge();

        if (!this.isClosed) {
            this.purgeTimeout = setTimeout( () => this.purge(), this.purgeInterval);
        }
    }

    /**
     * Unsubscribe from response and close model.
     *
     */
    public close() {
        if (this.isClosed) {
            return;
        }

        if (this.purgeTimeout) {
            clearTimeout(this.purgeTimeout);
            delete this.purgeTimeout;
            this.purgeInterval = 0;
        }

        this.stop();

        this.isClosed = true;

        this.crdtView.close();
    }

    /**
     * Unsubscribe from response meaning no further data will enter the model and deletions
     * can no longer be detected.
     * Model is kept as is until close() is called.
     */
    public stop() {
        if (this.isStopped) {
            return;
        }

        this.isStopped = true;
        this.triggerEvent("stop");

        this.storageClient.unsubscribe({
            originalMsgId: this.getResponseObj.getMsgId(),
            targetPublicKey: Buffer.alloc(0),
        });
    }

    /**
     * Update the fetch request used for streaming with CRDT.
     * Requests not having crdt.algo > 0 cannot be updated.
     */
    public update(updateStreamParams: UpdateStreamParams) {
        if (this.isStopped) {
            return;
        }

        this.fetchRequest.crdt.msgId = this.getResponseObj.getMsgId();

        if (updateStreamParams.triggerInterval !== undefined) {
            this.fetchRequest.query.triggerInterval = updateStreamParams.triggerInterval;
        }

        if (updateStreamParams.head !== undefined) {
            this.fetchRequest.crdt.head         = updateStreamParams.head;
        }

        if (updateStreamParams.tail !== undefined) {
            this.fetchRequest.crdt.tail         = updateStreamParams.tail;
        }

        if (updateStreamParams.cursorId1 !== undefined) {
            this.fetchRequest.crdt.cursorId1    = updateStreamParams.cursorId1;
        }

        if (updateStreamParams.cursorIndex !== undefined) {
            this.fetchRequest.crdt.cursorIndex  = updateStreamParams.cursorIndex;
        }

        if (updateStreamParams.reverse !== undefined) {
            this.fetchRequest.crdt.reverse      = updateStreamParams.reverse;
        }

        this.storageClient.fetch(this.fetchRequest);
    }

    /**
     * @returns the unerlaying GetResponse object.
     */
    public getResponse(): GetResponse<FetchResponse> {
        return this.getResponseObj;
    }

    /**
     * Returns the object which is the view of the model.
     */
    public getView(): CRDTView {
        return this.crdtView;
    }

    /**
     * @returns the possibly altered FetchRequest.
     */
    public getFetchRequest(): FetchRequest {
        return DeepCopy(this.fetchRequest);
    }

    public onStop(cb: () => void) {
        this.hookEvent("stop", cb);
    }

    public offStop(cb: () => void) {
        this.unhookEvent("stop", cb);
    }

    protected hookEvent(name: string, callback: ( (...args: any) => void)) {
        const cbs = this.handlers[name] || [];
        this.handlers[name] = cbs;
        cbs.push(callback);
    }

    protected unhookEvent(name: string, callback: ( (...args: any) => void)) {
        const cbs = (this.handlers[name] || []).filter( (cb: ( (...args: any) => void)) => callback !== cb );
        this.handlers[name] = cbs;
    }

    protected triggerEvent(name: string, ...args: any) {
        const cbs = this.handlers[name] || [];
        cbs.forEach( (callback: ( (...args: any) => void)) => {
            setImmediate( () => callback(...args) );
        });
    }
}
