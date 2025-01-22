/**
 * Schemas for parsing JSON into native objects which can be passed into bebop parsers.
 */

import {
    CopyBuffer,
} from "../util/common";

import {
    DataNodeType,
    DataNodeTypeAlias,
    LicenseNodeType,
    LicenseNodeTypeAlias,
} from "../datamodel";

import {
    ParseEnum,
    ParseSchemaType,
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
export const ParseNodeType = function(schema: ParseSchemaType, v: string | Buffer | Uint8Array): Buffer {
    const nodeAliases: {[alias: string]: Buffer} = {
        [DataNodeTypeAlias]: Buffer.from(DataNodeType),
        [LicenseNodeTypeAlias]: Buffer.from(LicenseNodeType),
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

export const FilterSchema: ParseSchemaType = {
    field: "",
    "operator?": "",
    cmp: "",
    value: "",
} as const;

export const EmbedSchema: ParseSchemaType = {
    nodeType: ParseNodeType,
    "filters?": [FilterSchema],
} as const;

export const FetchQuerySchema: ParseSchemaType = {
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

export const FetchCRDTSchema: ParseSchemaType = {
    "algo?": ParseEnum([AlgoSorted.GetId(), AlgoRefId.GetId(), AlgoSortedRefId.GetId()], ""),
    "conf?": "",
    "msgId?": new Uint8Array(0),
    "reverse?": false,
    "head?": 0,
    "tail?": 0,
    "cursorId1?": new Uint8Array(0),
    "cursorIndex?": -1,
} as const;

export const FetchRequestSchema: ParseSchemaType = {
    query: FetchQuerySchema,
    "crdt?": FetchCRDTSchema,
} as const;

export const StoreRequestSchema: ParseSchemaType = {
    nodes: [new Uint8Array(0)],
    "sourcePublicKey?": new Uint8Array(0),
    "targetPublicKey?": new Uint8Array(0),
    "muteMsgIds?": [new Uint8Array(0)],
    "preserveTransient?": false,
    "batchId?": 0,
    "hasMore?": false,
} as const;

export const UnsubscribeRequestSchema: ParseSchemaType = {
    originalMsgId: new Uint8Array(0),
    "targetPublicKey?": new Uint8Array(0),
} as const;

export const WriteBlobRequestSchema: ParseSchemaType = {
    nodeId1: new Uint8Array(0),
    data: new Uint8Array(0),
    "pos?": 0n,
    "sourcePublicKey?": new Uint8Array(0),
    "targetPublicKey?": new Uint8Array(0),
    "muteMsgIds?": [new Uint8Array(0)],
} as const;

export const ReadBlobRequestSchema: ParseSchemaType = {
    nodeId1: new Uint8Array(0),
    "pos?": 0n,
    length: 0,
    "sourcePublicKey?": new Uint8Array(0),
    "targetPublicKey?": new Uint8Array(0),
} as const;

export const GenericMessageRequestSchema: ParseSchemaType = {
    action: "",
    "sourcePublicKey?": new Uint8Array(0),
    data: new Uint8Array(0),
} as const;

export const FetchResultSchema: ParseSchemaType = {
    nodes: [new Uint8Array(0)],
    "embed?": [new Uint8Array(0)],
    cutoffTime: 0n,
} as const;

export const CRDTResultSchema: ParseSchemaType = {
    delta: new Uint8Array(0),
    cursorIndex: 0,
    length: 0,
} as const;

export const FetchResponseSchema: ParseSchemaType = {
    status: ParseEnum(Object.values(Status)),
    result: FetchResultSchema,
    crdtResult: CRDTResultSchema,
    seq: 0,
    endSeq: 0,
    rowCount: 0,
    "error?": "",
} as const;

export const StoreResponseSchema: ParseSchemaType = {
    status: ParseEnum(Object.values(Status)),
    storedId1List: [new Uint8Array(0)],
    missingBlobId1List: [new Uint8Array(0)],
    missingBlobSizes: [0n],
    "error?": "",
} as const;

export const WriteBlobResponseSchema: ParseSchemaType = {
    status: ParseEnum(Object.values(Status)),
    currentLength: 0n,
    "error?": "",
} as const;

export const ReadBlobResponseSchema: ParseSchemaType = {
    status: ParseEnum(Object.values(Status)),
    data: new Uint8Array(0),
    seq: 0,
    endSeq: 0,
    blobLength: 0n,
    "error?": "",
} as const;

export const GenericMessageResponseSchema: ParseSchemaType = {
    status: ParseEnum(Object.values(Status)),
    data: new Uint8Array(0),
    "error?": "",
} as const;

export const UnsubscribeResponseSchema: ParseSchemaType = {
    status: ParseEnum(Object.values(Status)),
    "error?": "",
} as const;
