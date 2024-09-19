/** Template format of DataParams */
export type DataParamsTemplate = any;

/** Template format of LicenseParams */
export type LicenseParamsTemplate = any;

export type FetchCRDTTemplate = any;

export type FetchQueryTemplate = any;

/** Template format of FetchRequest */
export type FetchRequestTemplate = {
    query?: FetchQueryTemplate,
    crdt?: FetchCRDTTemplate,
};

/**
 * The JSON parsed structure of the Thread template.
 * At this point not verified for validity but will
 * be when parsed as typed structures as it is used by Thread.
 *
 * Data set here will pass through ParseUtil functions before used,
 * meaning that types are allowed to be more loose and for example instead of Buffer
 * hexadecimal strings are tolerated.
 * This is because ThreadTemplate is often parsed from JSON, but we still want
 * to set the expected types here as it helps understanding.
 */
export type ThreadTemplate = {
    /**
     * Query has to be set if performing queries on the thread.
     */
    query?: FetchQueryTemplate,

    /**
     * CRDT can be set if query is set.
     */
    crdt?: FetchCRDTTemplate,

    /**
     * Declare default parameters for each post type.
     *
     */
    post?: {[name: string]: DataParamsTemplate},

    /**
     * Declare default parameters for each postLicense type.
     */
    postLicense?: {[name: string]: LicenseParamsTemplate},
};

export type ThreadTemplates = {[name: string]: ThreadTemplate};

/**
 * This map contains values to be substituted anywhere in the ThreadTemplate.
 */
export type ThreadVariables = Record<string, any>;
