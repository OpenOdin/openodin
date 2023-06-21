import {
    Decoder,
    SignatureOffloaderInterface,
} from "../datamodel/decoder";

import {
    KeyPair,
} from "../datamodel/node";

import {
    BaseCertInterface,
    AuthCert,
    AuthCertConstraintValues,
    AuthCertParams,
    ChainCert,
    ChainCertParams,
    ChainCertConstraintValues,
    FriendCert,
    FriendCertParams,
    FriendCertConstraintValues,
    DataCert,
    DataCertParams,
    DataCertConstraintValues,
    LicenseCert,
    LicenseCertParams,
    LicenseCertConstraintValues,
    PRIMARY_INTERFACE_CHAINCERT_ID,
    PRIMARY_INTERFACE_DEFAULTCERT_ID,
    PRIMARY_INTERFACE_NODECERT_ID,
} from "../datamodel/cert";

import {
    CertStack,
} from "./types";

/** Map of all supported certs. */
export const ModelTypeToNameMap: {[modelType: string]: string | undefined} = {
    [ChainCert.GetType().toString("hex")]: "ChainCert",
    [AuthCert.GetType().toString("hex")]: "AuthCert",
    [FriendCert.GetType().toString("hex")]: "FriendCert",
    [DataCert.GetType().toString("hex")]: "DataCert",
    [LicenseCert.GetType().toString("hex")]: "LicenseCert",
};

/**
 * This helper creates, manages and dissects all types of certs.
 */
export class CertUtil {
    protected signatureOffloader?: SignatureOffloaderInterface;

    /**
     * @param signatureOffloader if provided then signing and verifying will be threaded. Must already have been initialized.
     */
    constructor(signatureOffloader?: SignatureOffloaderInterface) {
        this.signatureOffloader = signatureOffloader;
    }

    /**
    * Check in the image header data if it looks like a cert.
    * @param image the cert image
    * @returns true if the image header is recognized as being of primary interface cert.
    */
    public static IsCert(image: Buffer): boolean {
        const chainCertPrimaryInterface = Buffer.from([0, PRIMARY_INTERFACE_CHAINCERT_ID]);
        if (image.slice(0, 2).equals(chainCertPrimaryInterface)) {
            return true;
        }

        const defaultCertPrimaryInterface = Buffer.from([0, PRIMARY_INTERFACE_DEFAULTCERT_ID]);
        if (image.slice(0, 2).equals(defaultCertPrimaryInterface)) {
            return true;
        }

        const nodeCertPrimaryInterface = Buffer.from([0, PRIMARY_INTERFACE_NODECERT_ID]);
        if (image.slice(0, 2).equals(nodeCertPrimaryInterface)) {
            return true;
        }

        return false;
    }

    /**
     * Calculate constraints on auth.
     * @returns the calculated auth cert constraints hash on the target.
     * @throws on error calculating or validating constraints.
     */
    public calcAuthCertConstraintValues(authCertParams: AuthCertParams, authCertConstraintValues: AuthCertConstraintValues): Buffer {
        const authCert = new AuthCert();
        authCert.setParams(authCertParams);
        const constraints = authCert.calcConstraintsOnTarget(authCertConstraintValues);
        authCert.setConstraints(constraints);

        const val = authCert.validateAgainstTarget(authCertConstraintValues);

        if (!val[0]) {
            throw new Error(val[1]);
        }

        return constraints;
    }

    /**
     * Calculate constraints on chain cert.
     * @returns the calculated chain cert constraints hash on the target.
     * @throws on error calculating or validating constraints.
     */
    public calcChainCertConstraintValues(chainCertParams: ChainCertParams, chainCertConstraintValues: ChainCertConstraintValues): Buffer | undefined {
        const chainCert = new ChainCert();
        chainCert.setParams(chainCertParams);
        const constraints = chainCert.calcConstraintsOnTarget(chainCertConstraintValues);
        chainCert.setConstraints(constraints);

        const val = chainCert.validateAgainstTarget(chainCertConstraintValues);

        if (!val[0]) {
            throw new Error(val[1]);
        }

        return constraints;
    }

    /**
     * Calculate constraints on friend.
     * @returns the calculated friend cert constraints hash on the target.
     * @throws on error calculating or validating constraints.
     */
    public calcFriendCertConstraintValues(friendCertParams: FriendCertParams, friendCertConstraintValues: FriendCertConstraintValues): Buffer | undefined {
        const friendCert = new FriendCert();
        friendCert.setParams(friendCertParams);
        const constraints = friendCert.calcConstraintsOnTarget(friendCertConstraintValues);
        friendCert.setConstraints(constraints);

        const val = friendCert.validateAgainstTarget(friendCertConstraintValues);

        if (!val[0]) {
            throw new Error(val[1]);
        }

        return constraints;
    }

    /**
     * Calculate constraints on data node.
     * @returns the calculated data node cert constraints hash on the target.
     * @throws on error calculating or validating constraints.
     */
    public calcDataCertConstraintValues(dataCertParams: DataCertParams, dataCertConstraintValues: DataCertConstraintValues): Buffer {
        const dataCert = new DataCert();
        dataCert.setParams(dataCertParams);
        const constraints = dataCert.calcConstraintsOnTarget(dataCertConstraintValues);
        dataCert.setConstraints(constraints);

        const val = dataCert.validateAgainstTarget(dataCertConstraintValues);

        if (!val[0]) {
            throw new Error(val[1]);
        }

        return constraints;
    }

    /**
     * Calculate constraints on license node.
     * @returns the calculated license node cert constraints hash on the target.
     * @throws on error calculating or validating constraints.
     */
    public calcLicenseCertConstraintValues(licenseCertParams: LicenseCertParams, licenseCertConstraintValues: LicenseCertConstraintValues): Buffer {
        const licenseCert = new LicenseCert();
        licenseCert.setParams(licenseCertParams);
        const constraints = licenseCert.calcConstraintsOnTarget(licenseCertConstraintValues);
        licenseCert.setConstraints(constraints);

        const val = licenseCert.validateAgainstTarget(licenseCertConstraintValues);

        if (!val[0]) {
            throw new Error(val[1]);
        }

        return constraints;
    }

    /**
     * Create and populate AuthCert with given parameters, optionally sign it.
     * Do run a verifyAuthCert afterwards unless all embedded nodes and certs are already verified.
     *
     * @param authCertParams the params to populate the cert with.
     * @param publicKey signer. Key pair should have been added to SignatureOffloader.
     * @param secretKey if provided then sign directly using this key pair instead of using SignatureOffloader.
     * @returns auth cert, not deep verified.
     * @throws if could not be signed
     */
    public async createAuthCert(authCertParams: AuthCertParams, publicKey?: Buffer, secretKey?: Buffer): Promise<AuthCert> {
        const authCert = new AuthCert();
        authCert.setParams(authCertParams);

        if (publicKey) {
            if (authCert.getOwner() === undefined) {
                if (!authCertParams.cert) {
                    // If no cert is used then automatically set owner.
                    authCert.setOwner(publicKey);
                }
            }

            if (secretKey) {
                authCert.sign({publicKey, secretKey});
            }
            else if (this.signatureOffloader) {
                await this.signatureOffloader.sign([authCert], publicKey);
            }
        }

        return authCert;
    }

    /**
     * Create and populate ChainCert with given parameters, optionally sign it.
     * Do run a verifyChainCert afterwards unless all embedded nodes and certs are already verified.
     * Note that not fully signed certs can be returned if not providing publicKey.
     * For multisig certs feed the returned cert back as params with the next publicKey.
     *
     * @param chainCertParams the params to populate the cert with.
     * @param publicKey signer. Key pair should have been added to SignatureOffloader.
     * @param secretKey if provided then sign directly using this key pair instead of using SignatureOffloader.
     * @returns chain cert, not deep verified, possibly signed.
     * @throws if could not be signed
     */
    public async createChainCert(chainCertParams: ChainCertParams, publicKey?: Buffer, secretKey?: Buffer): Promise<ChainCert> {
        const chainCert = new ChainCert();
        chainCert.setParams(chainCertParams);

        if (publicKey) {
            if (chainCert.getOwner() === undefined) {
                if (!chainCertParams.cert) {
                    // If no cert is used then automatically set owner.
                    chainCert.setOwner(publicKey);
                }
            }

            if (secretKey) {
                chainCert.sign({publicKey, secretKey});
            }
            else if (this.signatureOffloader) {
                await this.signatureOffloader.sign([chainCert], publicKey);
            }
        }

        return chainCert;
    }

    /**
     * Create and populate FriendCert with given parameters, optionally sign it.
     * Do run a verifyFriendCert afterwards unless all embedded nodes and certs are already verified.
     *
     * @param friendCertParams the params to populate the cert with.
     * @param publicKey signer. Key pair should have been added to SignatureOffloader.
     * @param secretKey if provided then sign directly using this key pair instead of using SignatureOffloader.
     * @returns friend cert, not deep verified.
     * @throws if could not be signed
     */
    public async createFriendCert(friendCertParams: FriendCertParams, publicKey?: Buffer, secretKey?: Buffer): Promise<FriendCert> {
        const friendCert = new FriendCert();
        friendCert.setParams(friendCertParams);

        if (publicKey) {
            if (friendCert.getOwner() === undefined) {
                if (!friendCertParams.cert) {
                    // If no cert is used then automatically set owner.
                    friendCert.setOwner(publicKey);
                }
            }

            if (secretKey) {
                friendCert.sign({publicKey, secretKey});
            }
            else if (this.signatureOffloader) {
                await this.signatureOffloader.sign([friendCert], publicKey);
            }
        }

        return friendCert;
    }

    /**
     * Create and populate DataCert with given parameters, optionally sign it.
     * Do run a verifyDataCert afterwards unless all embedded nodes and certs are already verified.
     *
     * @param dataCertParams the params to populate the cert with.
     * @param publicKey signer. Key pair should have been added to SignatureOffloader.
     * @param secretKey if provided then sign directly using this key pair instead of using SignatureOffloader.
     * @returns data cert, not deep verified.
     * @throws if could not be signed
     */
    public async createDataCert(dataCertParams: DataCertParams, publicKey?: Buffer, secretKey?: Buffer): Promise<DataCert> {
        const dataCert = new DataCert();
        dataCert.setParams(dataCertParams);

        if (publicKey) {
            if (dataCert.getOwner() === undefined) {
                if (!dataCertParams.cert) {
                    // If no cert is used then automatically set owner.
                    dataCert.setOwner(publicKey);
                }
            }

            if (secretKey) {
                dataCert.sign({publicKey, secretKey});
            }
            else if (this.signatureOffloader) {
                await this.signatureOffloader.sign([dataCert], publicKey);
            }
        }

        return dataCert;
    }

    /**
     * Create and populate LicenseCert with given parameters, optionally sign it.
     * Do run a verifyLicenseCert afterwards unless all embedded nodes and certs are already verified.
     *
     * @param licenseCertParams the params to populate the cert with.
     * @param publicKey signer. Key pair should have been added to SignatureOffloader.
     * @param secretKey if provided then sign directly using this key pair instead of using SignatureOffloader.
     * @returns license cert, not deep verified.
     * @throws if could not be signed
     */
    public async createLicenseCert(licenseCertParams: LicenseCertParams, publicKey?: Buffer, secretKey?: Buffer): Promise<LicenseCert> {
        const licenseCert = new LicenseCert();
        licenseCert.setParams(licenseCertParams);

        if (publicKey) {
            if (licenseCert.getOwner() === undefined) {
                if (!licenseCertParams.cert) {
                    // If no cert is used then automatically set owner.
                    licenseCert.setOwner(publicKey);
                }
            }

            if (secretKey) {
                licenseCert.sign({publicKey, secretKey});
            }
            else if (this.signatureOffloader) {
                await this.signatureOffloader.sign([licenseCert], publicKey);
            }
        }

        return licenseCert;
    }

    /**
     * Run a deep verification and validation of an auth cert with optional target constraint values.
     * @param image the binary to unpack.
     * @param authCertConstraintValues optionally also validate constraints on target.
     * @return authCert
     * @throws on error decoding, validating or verifying.
     */
    public async verifyAuthCert(image: Buffer, authCertConstraintValues?: AuthCertConstraintValues): Promise<AuthCert> {
        const authCert = await this.verifyCert(image) as AuthCert;

        if (!authCert.getType().equals(AuthCert.GetType())) {
            throw new Error("Cert is not of AuthCert type.");
        }

        if (authCertConstraintValues) {
            const val = authCert.validateAgainstTarget(authCertConstraintValues);
            if (!val[0]) {
                throw new Error(val[1]);
            }
        }

        return authCert;
    }

    /**
     * Run a deep verification and validation of a chain cert.
     * @param image the binary to unpack.
     * @param chainCertConstraintValues optionally also validate against constraints on target.
     * @return chainCert
     * @throws on error decoding, validating or verifying.
     */
    public async verifyChainCert(image: Buffer, chainCertConstraintValues?: ChainCertConstraintValues): Promise<ChainCert> {
        const chainCert = await this.verifyCert(image) as ChainCert;

        if (!chainCert.getType().equals(ChainCert.GetType())) {
            throw new Error("Cert is not of ChainCert type.");
        }

        if (chainCertConstraintValues) {
            const val = chainCert.validateAgainstTarget(chainCertConstraintValues);
            if (!val[0]) {
                throw new Error(val[1]);
            }
        }

        return chainCert;
    }

    /**
     * Run a deep verification and validation of an friend cert with optional target constraint values.
     * @param image the binary to unpack.
     * @param friendCertConstraintValues optionally also validate constraints on target.
     * @return friendCert
     * @throws on error decoding, validating or verifying.
     */
    public async verifyFriendCert(image: Buffer, friendCertConstraintValues?: FriendCertConstraintValues): Promise<FriendCert> {
        const friendCert = await this.verifyCert(image) as FriendCert;

        if (!friendCert.getType().equals(FriendCert.GetType())) {
            throw new Error("Cert is not of FriendCert type.");
        }

        if (friendCertConstraintValues) {
            const val = friendCert.validateAgainstTarget(friendCertConstraintValues);
            if (!val[0]) {
                throw new Error(val[1]);
            }
        }

        return friendCert;
    }

    /**
     * Run a deep verification and validation of an data cert with optional target constraint values.
     * @param image the binary to unpack.
     * @param dataCertConstraintValues optionally also validate constraints on target.
     * @return dataCert
     * @throws on error decoding, validating or verifying.
     */
    public async verifyDataCert(image: Buffer, dataCertConstraintValues?: DataCertConstraintValues): Promise<DataCert> {
        const dataCert = await this.verifyCert(image) as DataCert;

        if (!dataCert.getType().equals(DataCert.GetType())) {
            throw new Error("Cert is not of DataCert type.");
        }

        if (dataCertConstraintValues) {
            const val = dataCert.validateAgainstTarget(dataCertConstraintValues);
            if (!val[0]) {
                throw new Error(val[1]);
            }
        }

        return dataCert;
    }

    /**
     * Run a deep verification and validation of an license cert with optional target constraint values.
     * @param image the binary to unpack.
     * @param licenseCertConstraintValues optionally also validate constraints on target.
     * @return licenseCert
     * @throws on error decoding, validating or verifying.
     */
    public async verifyLicenseCert(image: Buffer, licenseCertConstraintValues?: LicenseCertConstraintValues): Promise<LicenseCert> {
        const licenseCert = await this.verifyCert(image) as LicenseCert;

        if (!licenseCert.getType().equals(LicenseCert.GetType())) {
            throw new Error("Cert is not of LicenseCert type.");
        }

        if (licenseCertConstraintValues) {
            const val = licenseCert.validateAgainstTarget(licenseCertConstraintValues);
            if (!val[0]) {
                throw new Error(val[1]);
            }
        }

        return licenseCert;
    }

    /**
     * Run a deep verification and validation of a cert.
     * @param image the binary to unpack.
     * @returns the cert.
     * @throws on error decoding, validating or verifying.
     */
    public async verifyCert(image: Buffer): Promise<BaseCertInterface> {
        const cert = Decoder.DecodeAnyCert(image);

        if (this.signatureOffloader) {
            if ((await this.signatureOffloader.verify([cert])).length !== 1) {
                throw new Error("Could not verify cert.");
            }
        }
        else {
            if (!cert.verify()) {
                throw new Error("Could not verify cert.");
            }
        }

        return cert;
    }

    /**
     * Dissect and inspect a cert stack.
     *
     * If there is an unpacking error then the stack returned will be incomplete.
     *
     * @returns CertStack with outermost cert first and with highest stackIndex.
     * @throws on unexpected error.
     */
    public async unpackCert(image: Buffer): Promise<CertStack> {
        const certStack: CertStack = [];

        // First decode each cert in the stack.
        let cert: Buffer | undefined = image;
        while (cert) {
            try {
                const certObject = Decoder.DecodeAnyCert(cert, false);
                certStack.push({
                    params: certObject.getParams(),
                    certObject,
                    image: cert,
                });
                cert = certObject.getCert();
            }
            catch(e) {
                certStack.push({
                    params: undefined,
                    error: e && (e as Error).message ? (e as Error).message : e as string,
                    image: cert ?? Buffer.alloc(0),
                });
                break;
            }
        }

        // Now go reverse order to start with the root cert to verify and validate from the bottom up.
        let embeddedCert: BaseCertInterface | undefined = undefined;
        let stackIndex = 0;
        for (let i=certStack.length-1; i>=0; i--) {
            const obj = certStack[i];
            if (!obj) {
                break;
            }
            obj.stackIndex = stackIndex++;
            const certObject = obj.certObject;
            if (!certObject) {
                break;
            }
            obj.issuerPublicKey = certObject.getIssuerPublicKey();
            obj.modelClassName = ModelTypeToNameMap[obj.params.modelType.toString("hex")] ?? "<unknown>";
            certObject.setCertObject(embeddedCert);
            try {
                const val = certObject.validate();
                obj.validates = val[0];
                if (!val[0]) {
                    obj.error = val[1];
                }
            }
            catch(e) {
                obj.validates = false;
                obj.error = e && (e as Error).message ? (e as Error).message : e as string;
            }
            try {
                if (this.signatureOffloader) {
                    if ((await this.signatureOffloader.verify([certObject])).length !== 1) {
                        throw new Error("Could not verify signature.");
                    }
                }
                else {
                    if (!certObject.verify()) {
                        throw new Error("Could not verify signature.");
                    }
                }
                obj.verifies = true;
            }
            catch(e) {
                obj.verifies = false;
            }

            embeddedCert = certObject;
        }

        return certStack;
    }
}
