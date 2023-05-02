import {
    BaseCertInterface,
} from "./BaseCertInterface";

import {
    ChainCertInterface,
} from "../../secondary/interface/ChainCertInterface";

/**
 * An abstract base interface for primary certs.
 */
export interface BaseTopCertInterface extends BaseCertInterface {
    getCertObject(): ChainCertInterface;
}
