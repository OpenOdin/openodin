/**
 * Schemas for parsing JSON into native objects which can be passed into bebop parsers.
 */

import {
    CopyBuffer,
} from "../util/common";

import {
    DATA0_NODE_TYPE,
    DATA0_NODE_TYPE_ALIAS,
    LICENSE0_NODE_TYPE,
    LICENSE0_NODE_TYPE_ALIAS,
} from "../datamodel";

const Filter = {
    field: "",
    "operator?": "",
    cmp: "",
    value: "",
};

/**
 * Parse given nodetype to check for node aliases.
 * @param v string as alias or hexadecimal node type, or buffer as node type
 */
const parseNodeType = function(v: string | Buffer | Uint8Array): Buffer {
    const nodeAliases: {[alias: string]: Buffer} = {
        [DATA0_NODE_TYPE_ALIAS]: CopyBuffer(DATA0_NODE_TYPE),
        [LICENSE0_NODE_TYPE_ALIAS]: CopyBuffer(LICENSE0_NODE_TYPE),
    };

    if (Buffer.isBuffer(v)) {
        return CopyBuffer(v);
    }
    else if (v instanceof Uint8Array) {
        return CopyBuffer(v);
    }

    if (typeof v !== "string") {
        throw new Error("parseNodeType requires string, Buffer or Uint8Array as argument");
    }

    if (nodeAliases[v]) {
        return CopyBuffer(nodeAliases[v]);
    }

    const b = Buffer.from(v, "hex");

    if (b.length === 0 || b.toString("hex").toLowerCase() !== v.toLowerCase()) {
        throw new Error(`Unknown nodeType alias provided: ${v}`);
    }

    return b;
}

export const FetchQuerySchema = {
    "depth?": -1,
    "limit?": -1,
    "cutoffTime?": 0n,
    "rootNodeId1?": new Uint8Array(0),
    "discardRoot?": false,
    "parentId?": new Uint8Array(0),
    "targetPublicKey?": new Uint8Array(0),
    "sourcePublicKey?": new Uint8Array(0),
    "match?": [{
        "nodeType": parseNodeType,
        "filters?": [Filter],
        "limit?": -1,
        "limitField?": {
            "name?": "",
            "limit?": 0,
        },
        "level?": [0],
        "discard?": false,
        "bottom?": false,
        "id?": 0,
        "requireId?": 0,
        "cursorId1?": new Uint8Array(0),
    }],
    "embed?": [{
        "nodeType": parseNodeType,
        "filters?": [Filter],
    }],
    "triggerNodeId?": new Uint8Array(0),
    "triggerInterval?": 0,
    "onlyTrigger?": false,
    "descending?": false,
    "orderByStorageTime?": false,
    "ignoreInactive?": false,
    "ignoreOwn?": false,
    "preserveTransient?": false,
    "region?": "",
    "jurisdiction?": "",
    "includeLicenses?": "",
};

export const FetchCRDTSchema = {
    "algo?": "",
    "conf?": "",
    "msgId?": new Uint8Array(0),
    "reverse?": false,
    "head?": 0,
    "tail?": 0,
    "cursorId1?": new Uint8Array(0),
    "cursorIndex?": -1,
};

export const FetchRequestSchema = {
    query: FetchQuerySchema,
    "crdt?": FetchCRDTSchema,
};
