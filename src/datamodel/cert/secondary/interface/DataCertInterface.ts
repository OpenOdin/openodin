import {
    PrimaryNodeCertInterface,
} from "../../primary/interface/PrimaryNodeCertInterface";

import {
    DataParams,
    DataNodeSchema,
} from "../../../node/secondary/data/types";

import {
    DataCertParams,
} from "../datacert/types";

export const SECONDARY_INTERFACE_DATACERT_ID = 1;

export type DataCertConstraintValues = DataParams;

export const DataCertConstraintSchema = {
    ...DataNodeSchema,
} as const;

/**
 * A secondary interface for DataCerts.
 *
 */
export interface DataCertInterface extends PrimaryNodeCertInterface {
    calcConstraintsOnTarget(target: DataCertConstraintValues): Buffer;
    setLockedOnContentType(isLocked: boolean): void;
    isLockedOnContentType(): boolean | undefined;
    setLockedOnUserBits(isLocked: boolean): void;
    isLockedOnUserBits(): boolean | undefined;
    setLockedOnDataConfig(isLocked: boolean): void;
    isLockedOnDataConfig(): boolean | undefined;
    getParams(): DataCertParams;
    setParams(params: DataCertParams): void;
}
