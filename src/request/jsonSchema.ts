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

import {
    ParseEnum,
} from "../util/SchemaUtil";

import {
    Status,
} from "./types";

import {
    AlgoSorted,
    AlgoRefId,
    AlgoSortedRefId,
} from "../storage/crdt";

/**
 * Parse given nodetype to check for node aliases.
 * @param v string as alias or hexadecimal node type, or buffer as node type
 */
export const ParseNodeType = function(v: string | Buffer | Uint8Array): Buffer {
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
        throw new Error("ParseNodeType requires string, Buffer or Uint8Array as argument");
    }

    if (nodeAliases[v]) {
        return CopyBuffer(nodeAliases[v]);
    }

    if (v.startsWith("base64:")) {
        return Buffer.from(v.slice(7), "base64");
    }

    const b = Buffer.from(v, "hex");

    if (b.length === 0 || b.toString("hex").toLowerCase() !== v.toLowerCase()) {
        throw new Error(`Unknown nodeType alias provided: ${v}`);
    }

    return b;
}

export const FilterSchema = {
    field: "",
    "operator?": "",
    cmp: "",
    value: "",
} as const;

export const EmbedSchema = {
    nodeType: ParseNodeType,
    "filters?": [FilterSchema],
} as const;

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
        nodeType: ParseNodeType,
        "filters?": [FilterSchema],
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
    "embed?": [EmbedSchema],
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
} as const;

export const FetchCRDTSchema = {
    "algo?": ParseEnum([AlgoSorted.GetId(), AlgoRefId.GetId(), AlgoSortedRefId.GetId()], ""),
    "conf?": "",
    "msgId?": new Uint8Array(0),
    "reverse?": false,
    "head?": 0,
    "tail?": 0,
    "cursorId1?": new Uint8Array(0),
    "cursorIndex?": -1,
} as const;

export const FetchRequestSchema = {
    query: FetchQuerySchema,
    "crdt?": FetchCRDTSchema,
} as const;

export const StoreRequestSchema = {
    nodes: [new Uint8Array(0)],
    "sourcePublicKey?": new Uint8Array(0),
    "targetPublicKey?": new Uint8Array(0),
    "muteMsgIds?": [new Uint8Array(0)],
    "preserveTransient?": false,
    "batchId?": 0,
    "hasMore?": false,
} as const;

export const UnsubscribeRequestSchema = {
    originalMsgId: new Uint8Array(0),
    "targetPublicKey?": new Uint8Array(0),
} as const;

export const WriteBlobRequestSchema = {
    nodeId1: new Uint8Array(0),
    data: new Uint8Array(0),
    "pos?": 0n,
    "sourcePublicKey?": new Uint8Array(0),
    "targetPublicKey?": new Uint8Array(0),
    "muteMsgIds?": [new Uint8Array(0)],
} as const;

export const ReadBlobRequestSchema = {
    nodeId1: new Uint8Array(0),
    "pos?": 0n,
    length: 0,
    "sourcePublicKey?": new Uint8Array(0),
    "targetPublicKey?": new Uint8Array(0),
} as const;

export const GenericMessageRequestSchema = {
    action: "",
    "sourcePublicKey?": new Uint8Array(0),
    data: new Uint8Array(0),
} as const;

export const FetchResultSchema = {
    nodes: [new Uint8Array(0)],
    "embed?": [new Uint8Array(0)],
    cutoffTime: 0n,
} as const;

export const CRDTResultSchema = {
    delta: new Uint8Array(0),
    cursorIndex: 0,
    length: 0,
} as const;

export const FetchResponseSchema = {
    status: ParseEnum(Object.values(Status)),
    result: FetchResultSchema,
    crdtResult: CRDTResultSchema,
    seq: 0,
    endSeq: 0,
    rowCount: 0,
    "error?": "",
} as const;

export const StoreResponseSchema = {
    status: ParseEnum(Object.values(Status)),
    storedId1List: [new Uint8Array(0)],
    missingBlobId1List: [new Uint8Array(0)],
    missingBlobSizes: [0n],
    "error?": "",
} as const;

export const WriteBlobResponseSchema = {
    status: ParseEnum(Object.values(Status)),
    currentLength: 0n,
    "error?": "",
} as const;

export const ReadBlobResponseSchema = {
    status: ParseEnum(Object.values(Status)),
    data: new Uint8Array(0),
    seq: 0,
    endSeq: 0,
    blobLength: 0n,
    "error?": "",
} as const;

export const GenericMessageResponseSchema = {
    status: ParseEnum(Object.values(Status)),
    data: new Uint8Array(0),
    "error?": "",
} as const;

export const UnsubscribeResponseSchema = {
    status: ParseEnum(Object.values(Status)),
    "error?": "",
} as const;
