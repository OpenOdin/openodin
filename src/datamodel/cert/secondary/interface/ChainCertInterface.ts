import {
    PrimaryChainCertInterface,
} from "../../primary/interface/PrimaryChainCertInterface";

import {
    BaseCertParams,
} from "../../base/types";

export const SECONDARY_INTERFACE_CHAINCERT_ID = 1;

export type ChainCertConstraintValues = BaseCertParams;

/**
 * A secondary interface for Chain Certs.
 */
export interface ChainCertInterface extends PrimaryChainCertInterface {
}
