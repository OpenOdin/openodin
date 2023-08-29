import {
    NodeInterface,
} from "../../datamodel";

import {
    TransformerItem,
} from "./types";

type ON_CALLBACK = (transformerItem: TransformerItem) => void;
type ONCHANGE_CALLBACK = (transformerItem: TransformerItem, eventType: string) => void;

export class TransformerCache {
    protected handlers: {[name: string]: ( (...args: any) => void)[]} = {};
    protected items: TransformerItem[] = [];
    protected _isClosed: boolean = false;

    public handleResponse(nodes: NodeInterface[], indexes: number[], onlySet: boolean) {
        if (this._isClosed) {
            return;
        }

        const nodesLength = nodes.length;

        for (let i=0; i<nodesLength; i++) {
            const node = nodes[i];
            const index = indexes[i];

            if (index < 0) {
                // These events are subscription events of new nodes merging with the model,
                // and trigger either "add" or "insert" events.
                this.merge(node, index);
            }
            else {
                if (onlySet) {
                    // First result, just set the cache without triggering any events.
                    this.set(node, index);
                }
                else {
                    // Subscription events updates existing nodes and triggers "update" events.
                    this.update(node, index);
                }
            }
        }
    }

    public close() {
        if (this._isClosed) {
            return;
        }

        this._isClosed = true;

        this.triggerEvent("close");
    }

    public delete(indexes: number[]) {
        if (this._isClosed) {
            return;
        }

        indexes = indexes.slice();
        // We want to delete from the end to not mess up indexes.
        indexes.sort().reverse();
        indexes.forEach( index => {
            const arrayIndex = this.items.findIndex( (transformerItem: TransformerItem) => transformerItem.index === index );
            if (arrayIndex > -1) {
                const transformerItem = this.items.splice(arrayIndex, 1)[0];
                this.triggerEvent("delete", transformerItem);
                this.triggerEvent("change", transformerItem, "delete");
                for (let i=arrayIndex; i<this.items.length; i++) {
                    const transformerItem = this.items[i];
                    transformerItem.index--;
                }
            }
        });
    }

    /**
     * Update an existing item.
     * Emit "update" event.
     */
    public update(node: NodeInterface, index: number) {
        if (this._isClosed) {
            return;
        }

        if (index >= 0) {
            // For positive indexes these are updates and do not affect any other indexes.

            const arrayIndex = this.items.findIndex( (transformerItem: TransformerItem) => transformerItem.index === index );

            if (arrayIndex > -1) {
                // This node exists, replace it with the updated node.
                this.items[arrayIndex] = {node, index};
                this.triggerEvent("update", this.items[arrayIndex]);
                this.triggerEvent("change", this.items[arrayIndex], "update");
            }
        }
    }

    /**
     * Set an item.
     * This function does not emit any events.
     *
     * @param node the node to set
     * @param index the unallocated index to set the item at.
     */
    public set(node: NodeInterface, index: number) {
        if (this._isClosed) {
            return;
        }

        this.items[index] = {node, index};
    }

    /**
     * Manage insert into cache coming from subscription events.
     * @param index is expected to be negative (signals an injection in the transformer model).
     */
    public merge(node: NodeInterface, index: number) {
        if (this._isClosed) {
            return;
        }

        if (index < 0) {
            // For negative indexes these are inserts not updates.
            // An insert effects the indexes of all nodes after it.

            // Translate to positive index. -1 means index 0.
            index = index * -1 - 1;

            if (index > 0) {
                const arrayIndex = this.items.findIndex( (transformerItem: TransformerItem) => transformerItem.index === index - 1 );
                if (arrayIndex === -1) {
                    console.error("unexpected index", index);
                }
            }

            // Increase indexes of all following nodes to keep in sync with server model.
            for (let i=0; i<this.items.length; i++) {
                const transformerItem = this.items[i];
                if (transformerItem.index >= index) {
                    transformerItem.index++;
                }
            }

            const transformerItem = {node, index};

            this.items.push(transformerItem);

            this.sortItems();

            if (this.items.slice(-1)[0]?.index === index) {
                this.triggerEvent("add", transformerItem);
                this.triggerEvent("change", transformerItem, "add");
            }
            else {
                this.triggerEvent("insert", transformerItem);
                this.triggerEvent("change", transformerItem, "insert");
            }
        }
    }

    public getItems(): TransformerItem[] {
        return this.items.slice();
    }

    public getLast(): TransformerItem | undefined {
        return this.items.slice(-1)[0];
    }

    public onAdd(cb: ON_CALLBACK) {
        this.hookEvent("add", cb);
    }

    // A node with updated transient properties.
    // The node must already exist in the cache for this event to trigger.
    public onUpdate(cb: ON_CALLBACK) {
        this.hookEvent("update", cb);
    }

    public onInsert(cb: ON_CALLBACK) {
        this.hookEvent("insert", cb);
    }

    public onDelete(cb: ON_CALLBACK) {
        this.hookEvent("delete", cb);
    }

    public onChange(cb: ONCHANGE_CALLBACK) {
        this.hookEvent("change", cb);
    }

    public onClose(cb: (...args: any) => void ) {
        this.hookEvent("close", cb);
    }

    public find(nodeId1: Buffer): TransformerItem | undefined {
        const itemsLength = this.items.length;
        for (let i=0; i<itemsLength; i++) {
            const item = this.items[i];

            if (item.node.getId1()?.equals(nodeId1)) {
                return item;
            }
        }

        return undefined;
    }

    protected sortItems() {
        this.items.sort( (a: TransformerItem, b: TransformerItem) => {
            let diff = (a.index ?? 0) - (b.index ?? 0);

            if (diff === 0) {
                const id1a = a.node.getId1();
                const id1b = b.node.getId1();
                if (id1a && id1b) {
                    diff = id1a.compare(id1b);
                }
            }

            return diff;
        });
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
