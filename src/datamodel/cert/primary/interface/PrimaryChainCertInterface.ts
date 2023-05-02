import {
    BaseCertInterface,
} from "../../base/interface/BaseCertInterface";

export const PRIMARY_INTERFACE_CHAINCERT_ID = 1;

/**
 * A primary interface for chain certs.
 *
 */
export interface PrimaryChainCertInterface extends BaseCertInterface {
    getCertObject(): PrimaryChainCertInterface;
}
