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
 * 
 * These structures are tempaltes and will be variable substituted
 * before use, and then also parsed into proper typed objects.
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

// The schema is very loosely defined as it is a template
// and still not ready to be properly parsed.
//
export const ThreadTemplateSchema = {
    query: {},
    "crdt?": {},
    "post?": {},
    "postLicense?": {},
} as const;

export type ThreadTemplates = {[name: string]: ThreadTemplate};

/**
 * This map contains values to be substituted anywhere in the ThreadTemplate.
 */
export type ThreadVariables = Record<string, any>;
