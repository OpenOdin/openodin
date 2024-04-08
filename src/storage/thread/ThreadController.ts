/**
 * ThreadControllers work on Threads who are using CRDTs.
 *
 * They provide a model to be used by the UI, either the CRDT view model (with added data)
 * or its own model.
 *
 * A ThreadController always runs a streaming fetch request using a CRDT.
 *
 * The underlaying FetchRequest can be updated to allow for expanding/changing the scope of the
 * model (for example for paging and expanding history).
 */

import {
    Thread,
} from "./Thread";

import {
    ThreadFetchParams,
    ThreadTemplate,
    ThreadStreamResponseAPI,
    UpdateStreamParams,
} from "./types";

import {
    FetchRequest,
} from "../../types";

import {
    DataInterface,
} from "../../datamodel";

import {
    CRDTViewExternalData,
    CRDTViewItem,
} from "../crdt/types";

import {
    Service,
} from "../../service/Service";

import {
    AutoFetch,
} from "../../p2pclient/types";

import {
    DeepCopy,
} from "../../util/common";

export class ThreadController {
    protected threadTemplate: ThreadTemplate;

    protected threadFetchParams: ThreadFetchParams;

    protected service: Service;

    protected autoFetchers: AutoFetch[] = [];

    protected thread: Thread;

    protected handlers: {[name: string]: ( (...args: any) => void)[]} = {};

    protected isClosed: boolean = false;

    protected threadStreamResponseAPI: ThreadStreamResponseAPI;

    protected purgeInterval: number;

    protected purgeTimer?: ReturnType<typeof setInterval>;

    /**
     * @param service the Service object needed to communicate with storage and to sync from peers
     * @param threadTemplate the ThreadTemplate of the Thred the controller will instantiate
     * @param threadFetchParams the parameters to override the template with
     * @param autoSync if true then automatically initiate sync fetch operations via the Service,
     * default is true.
     * @param purgeInterval how often in milliseconds to run a purge over old data to be
     * garbage collected, default is 60000 milliseconds.
     */
    constructor(service: Service, threadTemplate: ThreadTemplate,
        threadFetchParams: ThreadFetchParams = {},
        autoSync: boolean = true,
        purgeInterval: number = 60_000)
    {
        this.service            = service;
        this.threadTemplate     = threadTemplate;
        this.threadFetchParams  = threadFetchParams;
        this.purgeInterval      = purgeInterval;

        const storageClient = service.getStorageClient();

        if (!storageClient) {
            throw new Error("Missing storageClient in Service");
        }

        this.thread = new Thread(threadTemplate, threadFetchParams,
            storageClient, service.getNodeUtil(), service.getPublicKey(),
            service.getSignerPublicKey());

        if (autoSync) {
            this.addAutoSync();
        }

        this.threadStreamResponseAPI = this.thread.stream();

        this.threadStreamResponseAPI.onChange((...args) => this.handleCRDTViewOnChange(...args))
            .onCancel(() => this.close());

        if (purgeInterval) {
            this.purgeTimer = setTimeout( () => this.purge(), purgeInterval);
        }
    }

    /**
     * Create auto sync configurations and pass them to the Service object.
     *
     * @param fetchRequest deriving classes can optionally set this to override the thread template
     * fetch request
     * @param fetchRequestReverse deriving class can optionally set this to override the thread
     * template fetch request for the reverse-fetch, that is what is pushed to remote peer(s).
     */
    protected addAutoSync(fetchRequest?: FetchRequest, fetchRequestReverse?: FetchRequest) {
        this.removeAutoSync();

        fetchRequest = fetchRequest ? DeepCopy(fetchRequest) as FetchRequest :
            this.thread.getFetchRequest(true);

        // Note that when we set includeLicenses=3 the Storage will automatically
        // add relevent licenses to the response and also automatically request licenses
        // to be extended for data matched.
        // This is a more fine grained approach in requesting licenses than using
        // query.embed and query.match on licenses.
        //
        fetchRequest.query.includeLicenses = 3;

        // Not relevant/allowed for auto fetch.
        //
        fetchRequest.query.preserveTransient = false;
        fetchRequest.crdt.algo = 0;

        const autoFetch: AutoFetch = {
            fetchRequest,
            remotePublicKey: Buffer.alloc(0),
            blobSizeMaxLimit: -1,
            reverse: false,
        };

        this.service.addAutoFetch(autoFetch);

        this.autoFetchers.push(autoFetch);


        fetchRequestReverse = fetchRequestReverse ? DeepCopy(fetchRequestReverse) as FetchRequest :
            this.thread.getFetchRequest(true);

        fetchRequestReverse.query.includeLicenses = 3;
        fetchRequestReverse.query.preserveTransient = false;
        fetchRequestReverse.crdt.algo = 0;

        const autoFetchReverse: AutoFetch = {
            fetchRequest: fetchRequestReverse,
            remotePublicKey: Buffer.alloc(0),
            blobSizeMaxLimit: -1,
            reverse: true,
        };

        this.service.addAutoFetch(autoFetchReverse);

        this.autoFetchers.push(autoFetchReverse);
    }

    protected removeAutoSync() {
        this.autoFetchers.forEach( autoFetch => this.service.removeAutoFetch(autoFetch) );
        this.autoFetchers = [];
    }

    /**
     * @param age call with 0 to purge all items
     *
     */
    protected purge(age: number = 600_000) {
        delete this.purgeTimer;

        this.threadStreamResponseAPI.getCRDTView().purge(age).forEach( (data: any) => {
            this.purgeData(data);
        });

        if (!this.isClosed) {
            this.purgeTimer = setTimeout( () => this.purge(), this.purgeInterval);
        }
    }

    protected purgeData(data: any) {
        // Do nothing. Override to use to free allocated resources.
    }

    protected handleCRDTViewOnChange(addedId1s: Buffer[], updatedId1s: Buffer[],
        deletedId1s: Buffer[])
    {
        const added: CRDTViewItem[] = [];
        const updated: CRDTViewItem[] = [];

        addedId1s.forEach( id1 => {
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

        updatedId1s.forEach( id1 => {
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

        if (added.length > 0 || updated.length > 0 || deletedId1s.length > 0) {
            this.triggerEvent("change", added, updated, deletedId1s);
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
            clearTimeout(this.purgeTimer);
        }

        this.removeAutoSync();

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
