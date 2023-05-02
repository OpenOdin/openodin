import {
    ModelType,
} from "../../../model";

import {
    PRIMARY_INTERFACE_NODECERT_ID,
} from "../../primary/interface/PrimaryNodeCertInterface";

import {
    SECONDARY_INTERFACE_DATACERT_ID,
} from "../interface/DataCertInterface";

import {
    PrimaryNodeCertParams,
} from "../../primary/nodecert/types";

export const DATACERT_TYPE: ModelType = Buffer.from([0, PRIMARY_INTERFACE_NODECERT_ID, 0, SECONDARY_INTERFACE_DATACERT_ID, 0, 0]);

export type DataCertParams = PrimaryNodeCertParams & {
    isLockedOnDataConfig?: boolean,
    isLockedOnContentType?: boolean,
    isLockedOnUserBits?: boolean,
};

/**
 * Extends Node cert locked config.
 * Bit numbers must not conflict with bits in PrimaryNodeCertLockedConfig.
 */
export enum DataCertLockedConfig {
    IS_LOCKED_ON_DATACONFIG     = 18,
    IS_LOCKED_ON_CONTENTTYPE    = 19,
    IS_LOCKED_ON_USERBITS       = 20,
}
