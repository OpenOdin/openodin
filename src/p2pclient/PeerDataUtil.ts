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
    PeerProps,
} from "./types";

import {
    Decoder,
    SignatureOffloaderInterface,
} from "../datamodel/decoder";

/**
 * A class of static functions to pack and unpack PeerData.
 */
export class PeerDataUtil {

    /**
     * Convert PeerData into PeerProps.
     * Will cryptographically verify any auth cert but will not check it online for validity.
     * @throws
     */
    public static async HandshakeResultToProps(handshakeResult: HandshakeResult, localProps: PeerProps, signatureOffloader: SignatureOffloaderInterface): Promise<PeerProps> {
        const peerData = new PeerData();
        peerData.load(handshakeResult.peerData);
        const version = peerData.getVersion();
        const serializeFormat = peerData.getSerializeFormat();
        const clock = peerData.getClock();
        const appVersion = peerData.getAppVersion();
        const jurisdiction = peerData.getJurisdiction();
        const region = peerData.getRegion();
        const connectionType = peerData.getConnectionType();

        if (!version || serializeFormat === undefined || clock === undefined) {
            throw new Error("Missing required fields in handshakeResult.peerData");
        }

        const authCertBin = peerData.getAuthCert();
        let authCert: AuthCertInterface | undefined;
        if (authCertBin) {
            authCert = Decoder.DecodeAuthCert(authCertBin);
            if ((await signatureOffloader.verify([authCert])).length !== 1) {
                throw new Error("Could not verify signatures in auth cert.");
            }
            const authConstraintvalues: AuthCertConstraintValues = {
                publicKey: handshakeResult.peerLongtermPk,
                creationTime: Date.now(),
                expireTime: undefined,
                jurisdiction: localProps.jurisdiction,
                region: localProps.region,
                connectionType: localProps.connectionType,
            };
            const val = authCert.validateAgainstTarget(authConstraintvalues);
            if (!val[0]) {
                throw new Error(`Could not validate auth cert: ${val[1]}`);
            }
        }

        const peerProps: PeerProps = {
            version,
            serializeFormat,
            appVersion,
            jurisdiction,
            region,
            handshakedPublicKey: handshakeResult.peerLongtermPk,
            clock,
            authCert,
            authCertPublicKey: authCert ? authCert.getIssuerPublicKey() : undefined,
            connectionType,
        };

        return peerProps;
    }

    /**
     * Convert PeerProps into PeerData.
     * @returns PeerData to be used in handshake.
     * @throws if auth cert could not be exported.
     */
    public static PropsToPeerData(props: PeerProps): PeerData {
        const peerData = new PeerData();
        peerData.setVersion(props.version);
        peerData.setSerializeFormat(props.serializeFormat);
        peerData.setAppVersion(props.appVersion);
        peerData.setJurisdiction(props.jurisdiction);
        peerData.setRegion(props.region);
        peerData.setClock(props.clock);
        peerData.setAuthCert(props.authCert ? props.authCert.export() : undefined);
        peerData.setConnectionType(props.connectionType);
        return peerData;
    }
}
