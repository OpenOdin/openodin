/**
 * The client side of a transformer,
 * used to keep a subset of the transformer model up to date.
 */

import {
    DataInterface,
} from "../../datamodel";

import {
    TransformerModel,
    TransformerItem,
    TransformerExternalData,
    TRANSFORMER_EVENT,
} from "./types";

import * as fossilDelta from "fossil-delta";

type ONCHANGE_CALLBACK = (transformerEvents: TRANSFORMER_EVENT) => void;

export class TransformerCache {
    protected handlers: {[name: string]: ( (...args: any) => void)[]} = {};

    protected model: TransformerModel = {
        list: [],
        nodes: {},
        datas: {},
    };

    public handleResponse(nodes: DataInterface[], delta: Buffer) {
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

            // If there has been lingering/preset data keep it.
            if (!this.model.datas[id1Str]) {
                this.model.datas[id1Str] = {};
            }
            else {
                // But in case it already was tagged for deletion we untag it.
                delete this.model.datas[id1Str]._deleted;
            }
        });

        if (delta.length === 0) {
            // This is not a delta given.
            // Set the model and order exactly as given.
            this.model.list = nodes.map( node => node.getId1() as Buffer );
        }
        else {
            // Apply patch.
            const deltaType = delta[0];
            if (deltaType !== 0) {
                throw new Error("Delta type not supported");
            }

            const delta2 = JSON.parse(delta.slice(1).toString());

            // Note casting to any here due to the types being restrictive,
            // but fossil-delta does accept strings as input.
            const newList = fossilDelta.apply(
                this.model.list.map( id1 => id1.toString("hex")).join(" ") as any,
                delta2 as any);

            this.model.list = newList.join("").split(" ").map(
                (id1Str: string) => Buffer.from(id1Str, "hex"));
        }

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

        this.triggerOnChange(addedNodesId1s, updatedNodesId1s, deletedNodesId1s);
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

    public triggerOnChange(added: Buffer[], updated: Buffer[], deleted: Buffer[]) {
        const transformerEvent: TRANSFORMER_EVENT = {
            added,
            deleted,
            updated,
        };

        this.triggerEvent("change", transformerEvent);
    }

    /**
     * @returns the internal items object to be used with the application as read-only.
     */
    public getItems(): TransformerItem[] {
        const items: TransformerItem[] = [];

        const listLength = this.model.list.length;

        for (let index=0; index<listLength; index++) {
            const item = this.getItem(index);

            if (item) {
                items.push(item);
            }

        }

        return items;
    }

    public getItem(index: number): TransformerItem | undefined {
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
    public findItem(id1: Buffer): TransformerItem | undefined {
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

    public getData(id1: Buffer): TransformerExternalData | undefined {
        const id1Str = id1.toString("hex");

        return this.model.datas[id1Str];
    }

    /**
     * Update or create data object.
     * This can be used to pre-create the object with pre-populated data.
     * If data object not set then set to given data param object.
     */
    public setData(id1: Buffer, data: {[key: string]: any}) {
        const id1Str = id1.toString("hex");

        const data2 = this.model.datas[id1Str] ?? data;

        // In case it was set we remove it.
        delete data2._deleted;

        this.model.datas[id1Str] = data2;

        for (const key in data) {
            data2[key] = data[key];
        }
    }

    public getLastItem(): TransformerItem | undefined {
        return this.getItem(this.model.list.length - 1);
    }

    /**
     * Empty the model.
     */
    public empty() {
        this.handleResponse([], Buffer.alloc(0));
    }

    public onChange(cb: ONCHANGE_CALLBACK): TransformerCache {
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
