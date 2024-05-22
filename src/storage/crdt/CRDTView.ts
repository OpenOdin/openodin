/**
 * This class is to keep a local view of the CRDT model.
 *
 * The model only uses Data nodes who are not flagged as isSpecial, all other nodes are ignored.
 */

import {
    DataInterface,
    NodeInterface,
    Data,
} from "../../datamodel";

import {
    FetchResponse,
} from "../../types";

import {
    CRDTViewModel,
    CRDTViewItem,
    CRDTViewExternalData,
    CRDTOnChangeCallback,
    SetDataFn,
    UnsetDataFn,
    CRDTCustomData,
    CRDTEvent,
} from "./types";

import {
    StorageUtil,
} from "../../util/StorageUtil";

import * as fossilDelta from "fossil-delta";

export class CRDTView {
    protected handlers: {[name: string]: ( (...args: any) => void)[]} = {};

    protected isClosed: boolean = false;

    protected model: CRDTViewModel = {
        list: [],
        nodes: {},
        datas: {},
    };

    protected itemIndex: {[id: string]: number} = {};

    protected cachedGetItems?: CRDTViewItem[];

    protected addedNodesId1s: Buffer[] = [];

    protected updatedNodesId1s: Buffer[] = [];

    protected deletedNodesId1s: Buffer[] = [];

    protected delta = Buffer.alloc(0);

    constructor(protected preserveTransient: boolean = false,
        protected setDataFn?: SetDataFn,
        protected unsetDataFn?: UnsetDataFn) {}

    /**
     * Will only use data nodes which are not flagged as special, other nodes are ignored.
     */
    public handleResponse(fetchResponse: FetchResponse) {
        const nodes = StorageUtil.ExtractFetchResponseNodes(fetchResponse,
            this.preserveTransient, Data.GetType(4));

        // Apply nodes to model.
        //
        const nodesLength = nodes.length;
        for (let i=0; i<nodesLength; i++) {
            const node = nodes[i];

            if ((node as DataInterface).isSpecial()) {
                continue;
            }

            const id1 = node.getId1() as Buffer;

            const id1Str = id1.toString("hex");

            if (this.model.nodes[id1Str] === undefined) {
                this.addedNodesId1s.push(id1);
            }
            else {
                this.updatedNodesId1s.push(id1);
            }

            // Always replace the node in case it has updated transient values.
            this.model.nodes[id1Str] = node as DataInterface;

            // If none already existing lingering or preset data exists, we create the data object.
            //
            if (!this.model.datas[id1Str]) {
                const custom = {};
                this.setDataFn?.(node as DataInterface, custom);

                this.model.datas[id1Str] = {_deleted: undefined, custom};
            }
            else {
                // In case existing data was tagged for deletion we untag it from deletion.
                //
                this.model.datas[id1Str]._deleted = undefined

                this.setDataFn?.(node as DataInterface, this.model.datas[id1Str].custom);
            }
        }

        // concat delta
        //
        this.delta = Buffer.concat([this.delta, fetchResponse.crdtResult.delta]);

        const isLast = fetchResponse.seq === fetchResponse.endSeq;

        if (isLast) {
            delete this.cachedGetItems;
            const appendedNodesId1s: Buffer[] = [];

            if (this.delta.length > 0) {
                // Apply patch.
                const deltaType = this.delta[0];
                if (deltaType !== 0) {
                    throw new Error("Delta type not supported");
                }

                const list: Buffer[] = [];

                try {
                    const newMerged = Buffer.from(fossilDelta.apply(Buffer.concat(this.model.list),
                        JSON.parse(this.delta.slice(1).toString()).patch));

                    // Split into seperate buffers.
                    // NOTE: Assuming IDs are 32 bytes long.
                    for (let i=0; i<newMerged.length; i+=32) {
                        list.push(newMerged.slice(i, i + 32));
                    }
                }
                catch(e) {
                    console.error("Error in applying patch. State might have gotten inconsistent. Please reload");
                    console.error(e);
                }

                this.model.list = list;

                this.itemIndex = {};

                this.model.list.forEach( (id1, index) => {
                    const id1Str = id1.toString("hex");
                    this.itemIndex[id1Str] = index;
                });

                Object.keys(this.model.nodes).forEach( nodeId1Str => {

                    if (this.itemIndex[nodeId1Str] === undefined) {
                        delete this.model.nodes[nodeId1Str];

                        this.deletedNodesId1s.push(Buffer.from(nodeId1Str, "hex"));

                        const data = this.model.datas[nodeId1Str];

                        if (data) {
                            // Set timestamp for GC to know.
                            //
                            data._deleted = Date.now();
                        }
                    }
                });

                // Check for all added nodes which nodes are considered appended
                // to the end of the list.
                //
                const addedNodesId1sMap: {[id1: string]: true} = {};
                const addedNodesId1sLength = this.addedNodesId1s.length;
                for (let i=0; i<addedNodesId1sLength; i++) {
                    const id1 = this.addedNodesId1s[i];
                    const id1Str = id1.toString("hex");
                    addedNodesId1sMap[id1Str] = true;
                }

                const listLength = this.model.list.length;
                for (let i=listLength-1; i>=0; i--) {
                    const id1 = this.model.list[i];
                    const id1Str = id1.toString("hex");
                    if (addedNodesId1sMap[id1Str]) {
                        appendedNodesId1s.unshift(id1);
                    }
                    else {
                        break;
                    }
                }
            }
            else {
                // No delta, meaning this is not CRDT,
                // So just use an append only model.
                //
                this.model.list.push(...this.addedNodesId1s);

                this.itemIndex = {};

                this.model.list.forEach( (id1, index) => {
                    const id1Str = id1.toString("hex");
                    this.itemIndex[id1Str] = index;
                });

                appendedNodesId1s.push(...this.addedNodesId1s);
            }

            if (this.addedNodesId1s.length > 0 || this.updatedNodesId1s.length > 0 ||
                this.deletedNodesId1s.length > 0)
            {
                const added: CRDTViewItem[] = [];
                const updated: CRDTViewItem[] = [];
                const appended: CRDTViewItem[] = [];

                const addedNodesId1sLength = this.addedNodesId1s.length;
                for (let i=0; i<addedNodesId1sLength; i++) {
                    const id1 = this.addedNodesId1s[i];
                    const item = this.findItem(id1);

                    if (item) {
                        added.push(item);
                    }
                }

                const updatedNodesId1sLength = this.updatedNodesId1s.length;
                for (let i=0; i<updatedNodesId1sLength; i++) {
                    const id1 = this.updatedNodesId1s[i];
                    const item = this.findItem(id1);

                    if (item) {
                        updated.push(item);
                    }
                }

                const appendedNodesId1sLength = appendedNodesId1s.length;
                for (let i=0; i<appendedNodesId1sLength; i++) {
                    const id1 = appendedNodesId1s[i];
                    const item = this.findItem(id1);

                    if (item) {
                        appended.push(item);
                    }
                }

                const crdtEvent: CRDTEvent = {
                    added,
                    updated,
                    deleted: this.deletedNodesId1s,
                    appended,
                };

                this.triggerEvent("change", crdtEvent);
            }

            this.delta = Buffer.alloc(0);
            this.addedNodesId1s = [];
            this.updatedNodesId1s = [];
            this.deletedNodesId1s = [];
        }
    }

    /**
     * Close and empty the model.
     */
    public close() {
        if (this.isClosed) {
            return;
        }

        this.model.list = [];
        this.model.nodes = {};
        this.model.datas = {};
        this.itemIndex = {};
        delete this.cachedGetItems;
        this.addedNodesId1s = [];
        this.updatedNodesId1s = [];
        this.deletedNodesId1s = [];
        this.delta = Buffer.alloc(0);

        this.isClosed = true;
    }

    /**
     * Purge deleted data items and return them to let the caller clear up any resources associated.
     * @param age milliseconds we give it until purging after marked as deleted. This is in the
     * scenario where the data reappears into existance for example due to a renewed license.
     */
    public purge(age: number = 300_000) {
        for (const id1Str in this.model.datas) {
            const data = this.model.datas[id1Str];

            if (data._deleted !== undefined && Date.now() - data._deleted >= age) {
                const data = this.model.datas[id1Str];

                delete this.model.datas[id1Str];

                this.unsetDataFn?.(Buffer.from(id1Str, "hex"), data.custom);
            }
        }
    }

    /**
     * @returns the internal items object to be used with the application as read-only.
     */
    public getItems(): CRDTViewItem[] {
        if (this.cachedGetItems) {
            return this.cachedGetItems;
        }

        const items: CRDTViewItem[] = [];

        const listLength = this.model.list.length;

        for (let index=0; index<listLength; index++) {
            const item = this.getItem(index);

            if (item) {
                items.push(item);
            }

        }

        this.cachedGetItems = items;

        return items;
    }

    public getItem(index: number): CRDTViewItem | undefined {
        const id1 = this.model.list[index];

        if (!id1) {
            return undefined;
        }

        const node = this.getNode(id1);

        const data = this.getData(id1);

        if (!node || !data) {
            return undefined;
        }

        return {
            index,
            id1,
            node,
            data,
        };
    }

    public getItemIndex(id1: Buffer): number | undefined {
        return this.itemIndex[id1.toString("hex")];
    }

    /**
     * Find item in view of items.
     */
    public findItem(id1: Buffer): CRDTViewItem | undefined {
        const index = this.getItemIndex(id1);

        if (index !== undefined) {
            return this.getItem(index);
        }

        return undefined;
    }

    public getNode(id1: Buffer): DataInterface | undefined {
        const id1Str = id1.toString("hex");

        return this.model.nodes[id1Str];
    }

    public getData(id1: Buffer): CRDTCustomData | undefined {
        const id1Str = id1.toString("hex");

        return this.model.datas[id1Str]?.custom;
    }

    /**
     * Update or create data object associated with node.
     * 
     * @param data all values are shallow copied to data object.
     *
     * This can be used to pre-create the object with pre-populated data.
     */
    public setData(id1: Buffer, data: CRDTCustomData) {
        const id1Str = id1.toString("hex");

        const data2 = this.model.datas[id1Str] ?? {_deleted: undefined, custom:{}};

        this.model.datas[id1Str] = data2;

        for (const key in data) {
            data2.custom[key] = data[key];
        }
    }

    public getLastItem(): CRDTViewItem | undefined {
        return this.getItem(this.model.list.length - 1);
    }

    public onChange(cb: CRDTOnChangeCallback) {
        this.hookEvent("change", cb);
    }

    public offChange(cb: CRDTOnChangeCallback) {
        this.unhookEvent("change", cb);
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
