import {
    GetResponse,
} from "../../p2pclient";

import {
    TransformerCache,
} from "../transformer";

import {
    DataParams,
    LicenseParams,
} from "../../datamodel";

import {
    FetchResponse,
} from "../../types";

/**
 * The JSON parsed structure of the Thread template.
 * At this point not verified for accurucy but will
 * be when parsed as typed structures.
 */
export type ThreadTemplate = {
    /**
     * Query has to be set if performing queries on the thread.
     * Parameters match the FetchQuery data type.
     */
    query?: any,

    /**
     * Transform can be set if query is set.
     * Parameters match the FetchTransform data type.
     */
    transform?: any,

    /**
     * Default parameters for when posting new data nodes.
     * Not required to be set to post, but then all parameters
     * must be passed as arguments to post() instead.
     */
    post?: any,

    /**
     * Default parameters for when posting new license nodes.
     * Not required to be set to post licenses, but then all parameters
     * must be passed as arguments to postLicense() instead.
     */
    postLicense?: any,
};

export type ThreadTemplates = {[name: string]: ThreadTemplate};

/**
 * These are the relevat properties of FetchQuery which could be
 * set to override the template properties of query.
 * A value of undefined will also overwrite and set
 * the final property to undefined.
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
};

/**
 * These are the relevat properties of FetchTransform which could be
 * set to override the template properties of transform.
 * A value of undefined will also overwrite and set
 * the final property to undefined.
 */
export type ThreadTransformerParams = {
    reverse?:           boolean,
    head?:              number,
    tail?:              number,
    cursorId1?:         Buffer,
    includeDeleted?:    boolean,
};

export type ThreadParams = {
    query?: ThreadQueryParams,
    transform?: ThreadTransformerParams,
};

/**
 * Optional parameters of DataParams.
 * These parameters have precedence over the template parameters
 * when posting new data nodes.
 */
export type ThreadDataParams = {[param: string]: any} | DataParams;

/**
 * Optional parameters of LicenseParams.
 * These parameters have precedence over the template parameters
 * when posting new license nodes.
 */
export type ThreadLicenseParams = {[param: string]: any} | LicenseParams;

export type ThreadQueryCallback = (getResponse: GetResponse<FetchResponse>, transformerCache?: TransformerCache) => void;

export type ThreadDefaults = {
    parentId?: Buffer,
    licenseTargets?: Buffer[],
};
