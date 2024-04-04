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
        const added: CRDTViewItem[] = [];
        const updated: CRDTViewItem[] = [];
        const deleted: Buffer[] = [];

        event.added.forEach( id1 => {
            const node = this.threadStreamResponseAPI.getCRDTView().getNode(id1);
            const data = this.threadStreamResponseAPI.getCRDTView().getData(id1);

            if (node && data) {
                this.makeData(node, data, false);

                const item = this.threadStreamResponseAPI.getCRDTView().findItem(id1);

                if (item) {
                    added.push(item);
                }
            }
        });

        event.updated.forEach( id1 => {
            const node = this.threadStreamResponseAPI.getCRDTView().getNode(id1);
            const data = this.threadStreamResponseAPI.getCRDTView().getData(id1);

            if (node && data) {
                this.makeData(node, data, true);

                const item = this.threadStreamResponseAPI.getCRDTView().findItem(id1);

                if (item) {
                    updated.push(item);
                }
            }
        });

        added.sort( (a, b) => a.index - b.index );

        updated.sort( (a, b) => a.index - b.index );

        if (added.length > 0 || updated.length > 0 || event.deleted.length > 0) {
            this.triggerEvent("change", added, updated, event.deleted);
        }
    }

    /**
     * onChange is called whenever an added, updated or delete event happened in the model.
     * added and updated items provided are ordered on their index in the model always
     * in ascending order.
     * Deleted is a list of deleted nodes id1s.
     */
    public onChange(cb: (added: CRDTViewItem[], updated: CRDTViewItem[], deleted: Buffer[]) => void):
        ThreadController
    {
        this.hookEvent("change", cb);

        return this;
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

    /**
     * Suger over this.threadStreamResponseAPI.getFetchRequest().crdt.tail
     *
     * @returns the current (possibly updated) value of tail.
     */
    public getTail(): number {
        return this.threadStreamResponseAPI.getFetchRequest().crdt.tail;
    }

    /**
     * Suger over this.threadStreamResponseAPI.getFetchRequest().crdt.head
     *
     * @returns the current (possibly updated) value of head.
     */
    public getHead(): number {
        return this.threadStreamResponseAPI.getFetchRequest().crdt.head;
    }

    /**
     * Suger over this.threadStreamResponseAPI.getFetchRequest().crdt.cursorId1
     *
     * @returns the current (possibly updated) value of cursorId1.
     */
    public getCursorId1(): Buffer {
        return this.threadStreamResponseAPI.getFetchRequest().crdt.cursorId1;
    }

    /**
     * Suger over this.threadStreamResponseAPI.getFetchRequest().crdt.cursorIndex
     *
     * @returns the current (possibly updated) value of cursorIndex.
     */
    public getCursorIndex(): number {
        return this.threadStreamResponseAPI.getFetchRequest().crdt.cursorIndex;
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

    /**
     * Deriving controller should call this whenever a relevant change which should be
     * reflected in the UI has happened.
     */
    protected update(obj?: any) {
        this.triggerEvent("update", obj);
    }

    /**
     * onUpdate is triggered whenever there is a change which the UI should update.
     * For some controllers onUpdate will be same as for onChange, but not necessarily.
     */
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
