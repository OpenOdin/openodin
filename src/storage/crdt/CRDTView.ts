/**
 * The view of a CRDT model,
 * used to keep a subset of the CRDT model up to date.
 */

import {
    DataInterface,
} from "../../datamodel";

import {
    CRDTViewModel,
    CRDTViewItem,
    CRDTViewExternalData,
    CRDTOnChangeCallback,
} from "./types";

import * as fossilDelta from "fossil-delta";

export class CRDTView {
    protected handlers: {[name: string]: ( (...args: any) => void)[]} = {};

    protected model: CRDTViewModel = {
        list: [],
        nodes: {},
        datas: {},
    };

    public handleResponse(nodes: DataInterface[], delta?: Buffer) {
        const addedNodesId1s: Buffer[] = [];

        const updatedNodesId1s: Buffer[] = [];

        const deletedNodesId1s: Buffer[] = [];

        // Apply nodes to model.
        nodes.forEach( node => {
            const id1 = node.getId1() as Buffer;

            const id1Str = id1.toString("hex");

            if (this.model.nodes[id1Str] === undefined) {
                addedNodesId1s.push(id1);
            }
            else {
                updatedNodesId1s.push(id1);
            }

            // Always replace the node in case it has updated transient values.
            this.model.nodes[id1Str] = node;

            // If no lingering or preset data create it.
            //
            if (!this.model.datas[id1Str]) {
                this.model.datas[id1Str] = {};
            }
            else {
                // In case existing data was tagged for deletion we untag it from deletion.
                //
                delete this.model.datas[id1Str]._deleted;
            }
        });

        if (delta && delta.length > 0) {
            // Apply patch.
            const deltaType = delta[0];
            if (deltaType !== 0) {
                throw new Error("Delta type not supported");
            }

            const list: Buffer[] = [];

            try {
                const newMerged = Buffer.from(fossilDelta.apply(Buffer.concat(this.model.list),
                    JSON.parse(delta.slice(1).toString()).patch));

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

            const listNodeId1s: {[id: string]: boolean} = {};

            this.model.list.forEach( id1 => {
                const id1Str = id1.toString("hex");
                listNodeId1s[id1Str] = true;
            });

            Object.keys(this.model.nodes).forEach( nodeId1Str => {

                if (listNodeId1s[nodeId1Str] === undefined) {
                    delete this.model.nodes[nodeId1Str];

                    deletedNodesId1s.push(Buffer.from(nodeId1Str, "hex"));

                    const data = this.model.datas[nodeId1Str];

                    if (data) {
                        // Set timestamp so purge can remove it.
                        data._deleted = Date.now();
                    }
                }
            });
        }

        return [addedNodesId1s, updatedNodesId1s, deletedNodesId1s];
    }

    /**
     * Purge deleted data items and return them to let the caller clear up any resources associated.
     */
    public purge(age: number = 0): any[] {
        const datas: any[] = [];

        for (const id1Str in this.model.datas) {
            const data = this.model.datas[id1Str];

            if (data._deleted !== undefined && Date.now() - data._deleted >= age) {
                delete this.model.datas[id1Str];

                datas.push(data);
            }
        }

        return datas;
    }

    public triggerOnChange(addedId1s: Buffer[], updatedId1s: Buffer[], deletedId1s: Buffer[]) {
        this.triggerEvent("change", addedId1s, updatedId1s, deletedId1s);
    }

    /**
     * @returns the internal items object to be used with the application as read-only.
     */
    public getItems(): CRDTViewItem[] {
        const items: CRDTViewItem[] = [];

        const listLength = this.model.list.length;

        for (let index=0; index<listLength; index++) {
            const item = this.getItem(index);

            if (item) {
                items.push(item);
            }

        }

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

    /**
     * Find item in view of items.
     */
    public findItem(id1: Buffer): CRDTViewItem | undefined {
        const items = this.getItems();

        const itemsLength = items.length;

        for (let i=0; i<itemsLength; i++) {
            const item = items[i];

            if (item.id1.equals(id1)) {
                return item;
            }
        }

        return undefined;
    }

    public getNode(id1: Buffer): DataInterface | undefined {
        const id1Str = id1.toString("hex");

        return this.model.nodes[id1Str];
    }

    public getData(id1: Buffer): CRDTViewExternalData | undefined {
        const id1Str = id1.toString("hex");

        return this.model.datas[id1Str];
    }

    /**
     * Update or create data object.
     * This can be used to pre-create the object with pre-populated data.
     * If data object not set then set to given data param object.
     */
    public setData(id1: Buffer, data: CRDTViewExternalData) {
        const id1Str = id1.toString("hex");

        const data2 = this.model.datas[id1Str] ?? data;

        // In case it was set we remove it.
        delete data2._deleted;

        this.model.datas[id1Str] = data2;

        for (const key in data) {
            data2[key] = data[key];
        }
    }

    public getLastItem(): CRDTViewItem | undefined {
        return this.getItem(this.model.list.length - 1);
    }

    /**
     * Empty the model.
     */
    public empty() {
        this.handleResponse([], Buffer.alloc(0));
    }

    public onChange(cb: CRDTOnChangeCallback): CRDTView {
        this.hookEvent("change", cb);

        return this;
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
