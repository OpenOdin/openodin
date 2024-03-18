/**
 * ThreadControllers work on Threads who are using CRDTs.
 * They provide a model to be used by the UI, either the CRDT view model (with added data) or its own model.
 *
 * A ThreadController always runs a streaming fetch request using a CRDT.
 *
 * The underlaying FetchRequest can be updated to allow for expanding/changing the scope of the model (for example for paging and expanding history).
 */

import {
    Thread,
} from "./Thread";

import {
    ThreadDefaults,
    ThreadFetchParams,
    ThreadStreamResponseAPI,
    UpdateStreamParams,
} from "./types";

import {
    DataInterface,
} from "../../datamodel";

import {
    CRDTViewExternalData,
    CRDTViewItem,
    CRDTVIEW_EVENT,
} from "../crdt/types";

import {
    Service,
} from "../../service/Service";

export type ThreadControllerParams = {
    threadName?: string,  // this is optional just so extending classes can set the default.

    threadDefaults?: ThreadDefaults,

    threadFetchParams?: ThreadFetchParams,
};

export class ThreadController {
    protected params: ThreadControllerParams;
    protected service: Service;
    protected thread: Thread;
    protected threadName: string;
    protected handlers: {[name: string]: ( (...args: any) => void)[]} = {};
    protected isClosed: boolean = false;
    protected threadStreamResponseAPI: ThreadStreamResponseAPI;
    protected purgeTimer?: ReturnType<typeof setInterval>;

    constructor(params: ThreadControllerParams, service: Service,
        purgeInterval: number = 60_000)
    {
        if (!params.threadName) {
            throw new Error("ThreadControllerParams.threadName must be provided to controller");
        }

        this.params     = params;
        this.service    = service;
        this.threadName = params.threadName;

        this.thread = this.service.makeThread(this.threadName, params.threadDefaults ?? {});

        // Note that when we set includeLicenses=3 the Storage will automatically add relevent licenses
        // to the response and also automatically request licenses to be extended for data matched.
        // This is a more fine grained approach in requesting licenses than using
        // query.embed and query.match on licenses.
        const threadFetchParams = {...params.threadFetchParams};
        threadFetchParams.query = threadFetchParams.query ?? {};
        threadFetchParams.query.includeLicenses = 3;
        this.service.addThreadSync(this.thread, threadFetchParams);

        this.threadStreamResponseAPI = this.thread.stream(params.threadFetchParams);

        this.threadStreamResponseAPI.onChange((...args) => this.handleCRDTViewOnChange(...args))
            .onCancel(() => this.close());

        if (purgeInterval) {
            this.purgeTimer = setInterval( () => this.purge(), purgeInterval);
        }
    }

    /**
     * @param age call with 0 to purge all items
     *
     */
    protected purge(age: number = 600_000) {
        this.threadStreamResponseAPI.getCRDTView().purge(age).forEach( (data: any) => {
            this.purgeData(data);
        });
    }

    protected purgeData(data: any) {
        // Do nothing. Override to use to free allocated resources.
    }

    protected handleCRDTViewOnChange(event: CRDTVIEW_EVENT) {
        event.added.forEach( id1 => {
            const node = this.threadStreamResponseAPI.getCRDTView().getNode(id1);
            const data = this.threadStreamResponseAPI.getCRDTView().getData(id1);

            if (node && data) {
                this.makeData(node, data, false);
            }
        });

        event.updated.forEach( id1 => {
            const node = this.threadStreamResponseAPI.getCRDTView().getNode(id1);
            const data = this.threadStreamResponseAPI.getCRDTView().getData(id1);

            if (node && data) {
                this.makeData(node, data, true);
            }
        });

        this.triggerEvent("change", event);
    }

    public onChange(cb: (event: CRDTVIEW_EVENT) => void) {
        this.hookEvent("change", cb);
    }

    /**
     * This function is called for every new or updated node to create the associated node data.
     * The data is a representation of the node in the context of the deriving controller.
     *
     * For example the data could be a message in an application, where the source of the
     * data is the node and then there could be further meta data associated with that.
     *
     * The function is also called for updated nodes allowing the associated data to be
     * properly updated alongside node transition or annotations updates.
     */
    protected makeData(node: DataInterface, data: CRDTViewExternalData, isUpdate: boolean) {
        // Do nothing.
        // Override to format new data.
    }

    /**
     * Sugar over this.threadStreamResponseAPI.getCRDTView().getItems().
     */
    public getItems(): CRDTViewItem[] {
        return this.threadStreamResponseAPI.getCRDTView().getItems();
    }

    /**
     * Sugar over this.threadStreamResponseAPI.getCRDTView().getItem().
     */
    public getItem(index: number): CRDTViewItem | undefined {
        return this.threadStreamResponseAPI.getCRDTView().getItem(index);
    }

    /**
     * Sugar over this.threadStreamResponseAPI.getCRDTView().getLastItem().
     */
    public getLastItem(): CRDTViewItem | undefined {
        return this.threadStreamResponseAPI.getCRDTView().getLastItem();
    }

    /**
     * Sugar over this.threadStreamResponseAPI.getCRDTView().findItem()().
     */
    public findItem(nodeId1: Buffer): CRDTViewItem | undefined {
        return this.threadStreamResponseAPI.getCRDTView().findItem(nodeId1);
    }

    /**
     * Sugar over this.threadStreamResponseAPI.getCRDTView().getData().
     */
    public getData(id1: Buffer): CRDTViewExternalData | undefined {
        return this.threadStreamResponseAPI.getCRDTView().getData(id1);
    }

    /**
     * Sugar over this.threadStreamResponseAPI.getCRDTView().getData().
     */
    public setData(id1: Buffer, data: CRDTViewExternalData) {
        this.threadStreamResponseAPI.getCRDTView().setData(id1, data);
    }

    /**
     * Sugar over this.threadStreamResponseAPI.getCRDTView().getNode().
     */
    public getNode(id1: Buffer): DataInterface | undefined {
        return this.threadStreamResponseAPI.getCRDTView().getNode(id1);
    }

    /**
     * Sugar over this.service.getPublicKey().
     *
     * @returns publicKey of this peer.
     */
    public getPublicKey(): Buffer {
        return this.service.getPublicKey();
    }

    public getTail(): number {
        return this.thread.getFetchRequest(this.params.threadFetchParams).crdt.tail;
    }

    /**
     * When streaming from the thread this function can be used to modify the underlying fetch request,
     * to change the scope of the data being fed to the CRDT view model.
     *
     * @throws if closed
     */
    public updateStream(updateStreamParams: UpdateStreamParams) {
        if (this.isClosed) {
            throw new Error("ThreadController is closed.");
        }

        this.threadStreamResponseAPI.updateStream(updateStreamParams);
    }

    public close() {
        if (this.isClosed) {
            return;
        }

        this.isClosed = true;

        if (this.purgeTimer) {
            clearInterval(this.purgeTimer);
        }

        this.threadStreamResponseAPI.stopStream();

        // Purge all items allocating resources.
        //
        this.purge(0);

        this.triggerEvent("close");
    }

    protected update(obj?: any) {
        this.triggerEvent("update", obj);
    }

    public onUpdate(cb: (obj: any) => void): ThreadController {
        this.hookEvent("update", cb);

        return this;
    }

    /**
     * Invoked when the underlying thread has been cancelled,
     * which happens when close() is called on the controller
     * or the underlying thread streamer is unsubscribed or fails.
     */
    public onClose(cb: () => void): ThreadController {
        this.hookEvent("close", cb);

        return this;
    }

    protected notify(message?: any) {
        this.triggerEvent("notification", message);
    }

    /**
     * Invoked when the controller wants to signal that something
     * worthy of attention just happened.
     */
    public onNotification(cb: (message?: any) => void): ThreadController {
        this.hookEvent("notification", cb);

        return this;
    }

    protected hookEvent(name: string, callback: ( (...args: any[]) => void)) {
        const cbs = this.handlers[name] || [];
        this.handlers[name] = cbs;
        cbs.push(callback);
    }

    protected unhookEvent(name: string, callback: ( (...args: any[]) => void)) {
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
