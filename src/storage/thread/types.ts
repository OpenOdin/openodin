import {
    GetResponse,
} from "../../p2pclient";

import {
    TransformerCache,
} from "../transformer";

import {
    DataParams,
    LicenseParams,
    NodeInterface,
} from "../../datamodel";

import {
    FetchResponse,
    FetchQuery,
    FetchTransform,
} from "../../types";

/**
 * The JSON parsed structure of the Thread template.
 * At this point not verified for accuracy but will
 * be when parsed as typed structures.
 */
export type ThreadTemplate = {
    /**
     * Query has to be set if performing queries on the thread.
     */
    query?: FetchQuery,

    /**
     * Transform can be set if query is set.
     * Parameters match the FetchTransform data type.
     */
    transform?: FetchTransform,

    /**
     * Declare default parameters for each post type.
     * Not required to be set, but then all arguments must be
     * passed as post(name, params) instead.
     */
    post: {[name: string]: ThreadDataParams},

    /**
     * Declare default parameters for each postLicense type.
     * Not required to be set, but then all arguments must be
     * passed as postLicense(name, node, params) instead.
     */
    postLicense: {[name: string]: ThreadLicenseParams},
};

export type ThreadTemplates = {[name: string]: ThreadTemplate};

/**
 * These are the relevat properties of FetchQuery which could be
 * set to override the template and default properties of a query.
 * Unset or undefined values are ignored.
 * If rootNodeId1 is set in query then it has precedence over parentId.
 */
export type ThreadQueryParams = {
    parentId?:              Buffer,
    depth?:                 number,
    limit?:                 number,
    cutoffTime?:            bigint,
    rootNodeId1?:           Buffer,
    discardRoot?:           boolean,
    descending?:            boolean,
    orderByStorageTime?:    boolean,
    ignoreInactive?:        boolean,
    ignoreOwn?:             boolean,
    preserveTransient?:     boolean,
    region?:                string,
    jurisdiction?:          string,
    includeLicenses?:       boolean,
};

/**
 * These are the relevant properties of FetchTransform which could be
 * set to override the template and default properties of transform.
 * Unset or undefined values are ignored.
 */
export type ThreadTransformerParams = {
    reverse?:           boolean,
    head?:              number,
    tail?:              number,
    cursorId1?:         Buffer,
};

/**
 * This is the argument type passed to post() and postLicense()
 * and the struct contains the properties which can be set to override
 * the template and default values of FetchRequest.
 */
export type ThreadFetchParams = {
    query?: ThreadQueryParams,
    transform?: ThreadTransformerParams,
};

/**
 * Parameters optionally passed to post() when posting new data nodes.
 *
 * These parameters have precedence over the template
 * and default properties when posting new data nodes.
 *
 */
export type ThreadDataParams = DataParams & {
    /**
     * Optionally set for how many seconds until the data node expires.
     * Note that expireTime has precedence over validSeconds.
     */
    validSeconds?: number,
};

/**
 * Parameters optionally passed to postLicense() when posting new license nodes.
 *
 * These parameters have precedence over the template
 * and default properties when posting new data nodes.
 */
export type ThreadLicenseParams = LicenseParams & {
    /** Optional list of target public keys to issue licenses or. */
    targets?: Buffer[],

    /**
     * Optionally set for how many seconds until the license node expires.
     * Note that expireTime has precedence over validSeconds.
     */
    validSeconds?: number,
};

/**
 * Default parameters layered on top of template properties but below function parameters.
 */
export type ThreadDefaults = {
    /**
     * Default parentId if parentId/rootNodeId1 if not set in post function params.
     * If rootNodeId1 is set in query then it has precedence over parentId.
     */
    parentId?: Buffer,

    /** Default license targets if not set in postLicense function params. */
    targets?: Buffer[],

    /** Default data and license expire time in milliseconds, if not set in function params. */
    expireTime?: number,

    /**
     * Default data and license valid time in seconds, if not set in function params.
     * Note that this property is only used if expireTime is not set.
     */
    validSeconds?: number,
};

export type UpdateStreamParams = {
    head?: number,
    tail?: number,
    cursorId1?: Buffer,
    reverse?: boolean,
    triggerInterval?: number,
};

/**
 * This is returend when calling thread.stream().
 */
export type ThreadStreamResponseAPI = {
    /** onChange events from the TransformerCache model. */
    onChange: (...parameters: Parameters<TransformerCache["onChange"]>) => ThreadStreamResponseAPI,

    /** Nodes incoming in getResponse.onReply. */
    onData: (cb: (nodes: NodeInterface[]) => void) => ThreadStreamResponseAPI,

    /**
     * Propagated from GetResponse.onCancel() and is called when the stream has been ended
     * either by error, from an unsubscribe call or when the socket has closed.
     */
    onCancel: (cb: () => void) => ThreadStreamResponseAPI,

    /**
     * Unsubscribe from the stream.
     */
    stopStream: () => void,

    /**
     * Update the running fetch request for this stream.
     */
    updateStream: (updateStreamParams: UpdateStreamParams) => void,

    getResponse: () => GetResponse<FetchResponse>,

    getTransformer: () => TransformerCache,
};

/**
 * This is returend when calling thread.query().
 */
export type ThreadQueryResponseAPI = {
    /** Nodes incoming in getResponse.onReply. */
    onData: (cb: (nodes: NodeInterface[]) => void) => ThreadQueryResponseAPI,

    /**
     * Propagated from GetResponse.onCancel() and is called when the
     * query was cancelled due to an error or when the socket has closed.
     */
    onCancel: (cb: () => void) => ThreadQueryResponseAPI,

    getResponse: () => GetResponse<FetchResponse>,
};
