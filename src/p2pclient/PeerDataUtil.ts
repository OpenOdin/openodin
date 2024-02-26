import {
    HandshakeResult,
} from "pocket-messaging";

import {
    PeerData,
} from "./PeerData";

import {
    AuthCertInterface,
    AuthCertConstraintValues,
} from "../datamodel";

import {
    SignatureOffloaderInterface,
} from "../signatureoffloader/types";

import {
    Decoder,
} from "../decoder";

/**
 * A class of static functions to pack and unpack PeerData.
 */
export class PeerDataUtil {
    public static create(params: {[key: string]: any}): PeerData {
        const peerData = new PeerData();

        peerData.setVersion(params.version);
        peerData.setSerializeFormat(params.serializeFormat);
        if (params.handshakePublicKey) {
            peerData.setHandshakePublicKey(params.handshakePublicKey);
        }
        peerData.setAuthCert(params.authCert);
        peerData.setAuthCertPublicKey(params.authCertPublicKey);

        let clockDiff = params.clockDiff ?? 0;
        if (clockDiff < -2147483648) {
            clockDiff = -2147483648;
        }
        else if (clockDiff > 2147483647) {
            clockDiff = 2147483647;
        }
        peerData.setClockDiff(clockDiff);

        peerData.setRegion(params.region);
        peerData.setJurisdiction(params.jurisdiction);
        peerData.setAppVersion(params.appVersion);

        return peerData;
    }

    /**
     * Convert HandshakeResult  into PeerData.
     *
     * Will cryptographically verify any auth cert given but will not check it online for validity.
     * @throws
     */
    public static async HandshakeResultToPeerData(handshakeResult: HandshakeResult,
        signatureOffloader: SignatureOffloaderInterface, region: string | undefined,
        jurisdiction: string | undefined): Promise<PeerData>
    {
        const peerData = new PeerData();

        peerData.load(handshakeResult.peerData);

        peerData.setHandshakePublicKey(handshakeResult.peerLongtermPk);

        const version           = peerData.getVersion();
        const serializeFormat   = peerData.getSerializeFormat();

        // the given clockDiff is for the local side, so we negate it
        // and use it for the remote side.
        //
        let clockDiff = handshakeResult.clockDiff;
        if (clockDiff < -2147483648) {
            clockDiff = -2147483648;
        }
        else if (clockDiff > 2147483647) {
            clockDiff = 2147483647;
        }
        peerData.setClockDiff(-clockDiff);

        if (!version || serializeFormat === undefined) {
            throw new Error("Missing required fields in handshakeResult.peerData");
        }

        const authCert = peerData.getAuthCert();

        let authCertObj: AuthCertInterface | undefined;
        let authCertPublicKey: Buffer | undefined;

        if (authCert) {
            authCertObj = Decoder.DecodeAuthCert(authCert);
            if ((await signatureOffloader.verify([authCertObj])).length !== 1) {
                throw new Error("Could not verify signatures in auth cert.");
            }

            authCertPublicKey = authCertObj.getIssuerPublicKey();

            const authConstraintvalues: AuthCertConstraintValues = {
                publicKey: handshakeResult.peerLongtermPk,
                creationTime: Date.now(),
                jurisdiction,
                region,
            };
            const val = authCertObj.validateAgainstTarget(authConstraintvalues);
            if (!val[0]) {
                throw new Error(`Could not validate auth cert: ${val[1]}`);
            }
        }

        peerData.setAuthCertPublicKey(authCertPublicKey);

        return peerData;
    }
}
