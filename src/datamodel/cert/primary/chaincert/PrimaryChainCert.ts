import {
    BaseCert,
} from "../../base/BaseCert";

import {
    PrimaryChainCertInterface,
} from "../interface/PrimaryChainCertInterface";


/**
 * A chain Cert is a base class for certs used as chain certs in other certs.
 */
export abstract class PrimaryChainCert extends BaseCert implements PrimaryChainCertInterface {
    /**
     * We override getCertObject to be specific about that it is ChainCerts we are using.
     */
    public getCertObject(): PrimaryChainCertInterface {
        const cert = super.getCertObject();
        return cert as PrimaryChainCertInterface;
    }
}
