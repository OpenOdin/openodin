import {
    BaseCert,
} from "./BaseCert";

import {
    BaseTopCertInterface,
} from "./interface/BaseTopCertInterface";

import {
    ChainCertInterface,
} from "../secondary/interface/ChainCertInterface";

import {
    ChainCert,
} from "../secondary/chaincert/ChainCert";


/**
 * A Top Cert is a base class for certs used "at the top".
 * A Top Cert can embed a Chain Cert.
 */
export abstract class BaseTopCert extends BaseCert implements BaseTopCertInterface {
    protected static SUPPORTED_CERTS: {[modelType: string]: typeof ChainCert} = {
        [ChainCert.GetType(4).toString("hex")]: ChainCert,
    };

    public isCertTypeAccepted(certType: Buffer): boolean {
        if (BaseTopCert.SUPPORTED_CERTS[certType.toString("hex")] ||
            BaseTopCert.SUPPORTED_CERTS[certType.slice(0, 4).toString("hex")]) {

            return true;
        }
        return false;
    }

    /**
     * We override getCertObject to be specific about that it is ChainCerts we are using.
     */
    public getCertObject(): ChainCertInterface {
        const cert = super.getCertObject();
        return cert as ChainCertInterface;
    }

    protected decodeCert(): ChainCertInterface | undefined {
        const image = this.getCert();
        if (image) {
            const certType = image.slice(0, 6);
            const cls = BaseTopCert.SUPPORTED_CERTS[certType.toString("hex")] ||
                BaseTopCert.SUPPORTED_CERTS[certType.slice(0, 4).toString("hex")];
            if (cls) {
                const cert = new cls();
                cert.load(image);
                return cert;
            }
        }
        return undefined;
    }
}
