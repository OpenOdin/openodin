import {
    PrimaryChainCertInterface,
} from "../../primary/interface/PrimaryChainCertInterface";

import {
    BaseCertParams,
    BaseCertSchema,
} from "../../base/types";

export const SECONDARY_INTERFACE_CHAINCERT_ID = 1;

export type ChainCertConstraintValues = BaseCertParams;

export const ChainCertConstraintSchema = {
    ...BaseCertSchema,
} as const;

/**
 * A secondary interface for Chain Certs.
 */
export interface ChainCertInterface extends PrimaryChainCertInterface {}
