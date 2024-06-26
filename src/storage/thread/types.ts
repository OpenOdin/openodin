import {
    DataParams,
    LicenseParams,
} from "../../datamodel";

import {
    FetchQuery,
    FetchCRDT,
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
     * crdt can be set if query is set.
     * Parameters match the FetchCRDT data type.
     */
    crdt?: FetchCRDT,

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
    includeLicenses?:       number,
};

/**
 * These are the relevant properties of FetchCRDT which could be
 * set to override the template and default properties of crdt.
 * Unset or undefined values are ignored.
 */
export type ThreadCRDTParams = {
    reverse?:           boolean,
    head?:              number,
    tail?:              number,
    cursorId1?:         Buffer,
    cursorIndex?:       number,
};

/**
 * This is the argument type passed to post() and postLicense()
 * and the struct contains the properties which can be set to override
 * the template and default values of FetchRequest.
 */
export type ThreadFetchParams = {
    query?: ThreadQueryParams,
    crdt?: ThreadCRDTParams,
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
