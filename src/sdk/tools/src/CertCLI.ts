#!/usr/bin/env node

import {
    Decoder,
} from "../../../decoder";

import {
    CertUtil,
    ModelTypeToNameMap,
} from "../../../util";

import {
    JSONUtil,
} from "../../../util/JSONUtil";

import {
    ParseSchema,
    ToJSONObject,
} from "../../../util/SchemaUtil";

import {
    AuthCert,
    AuthCertConstraintValues,
    ChainCert,
    ChainCertConstraintValues,
    BaseCert,
    FriendCert,
    FriendCertConstraintValues,
    DataCert,
    DataCertConstraintValues,
    LicenseCert,
    LicenseCertConstraintValues,
    AuthCertSchema,
    ChainCertSchema,
    FriendCertSchema,
    DataCertSchema,
    LicenseCertSchema,
    AuthCertConstraintSchema,
    ChainCertConstraintSchema,
    DataCertConstraintSchema,
    FriendCertConstraintSchema,
    LicenseCertConstraintSchema,
} from "../../../datamodel/cert";

import {
    KeyPair,
    KeyPairSchema,
} from "../../../datamodel/types";

import {
    PocketConsole,
} from "pocket-console";

const console = PocketConsole({format: "%c[%L%l]%C "});

const USAGE_TEXT=`
Usage:
    cert help|-h|--help
        Show this help

    The type of cert created is defined by the "modelType" field in the certParams.json file.

    cert constraints <certParams.json> <constraintParams.json> [--logLevel=debug|info|error|none]
        Calculate constraints for a proposed cert.
        Allowed dynamic params in certParams.json are ".owner", ".targetPublicKeys",
            ".creationTime" and ".expireTime".
        Allowed dynamic params in constraintsParams.json are ".publicKey",
            ".creationTime" and ".expireTime".

    cert create <certParams.json> [--keyFile=<keyfile.json>] [--logLevel=debug|info|error|none]
        Create a new packed cert.
        --keyFile must be given if "signature" is not set in certParams so
            that the cert can be signed.
        Allowed dynamic params in certParams.json are ".cert", ".constraints", ".owner",
            ".targetPublicKeys", ".creationTime" and ".expireTime".

    cert verify <cert.json> [<constraintParams.json>]
            [--time=UNIXms] [--logLevel=debug|info|error|none]
        Verify a cert stack deep to see that it verifies cryptographically and is valid.
        Optionally calculate constraints and validate with cert.
        Optionally validate against given UNIX time in milliseconds, if no time is given
        then the cert(s) are not validated in time.

    cert export <cert.json> [--logLevel=debug|info|error|none]
        Export a packed and signed cert back into its cert params JSON format.

    cert show <cert.json> [--logLevel=debug|info|error|none]
        Dissect and show all details of a cert and any embedded certs.
        json format: {"cert": "hexdata"}.

    cert list
        List all known cert types.
        This list can be used to extract modelType parameters.

`;

/**
 * This helper loads JSON files and set up calls for calling CertUtil.ts.
 * All native file handling is done here.
 */
export class CertCLI {
    /**
     * @returns non-zero on error.
     */
    public async showCert(certObject: {cert: string}): Promise<number> {
        try {
            const image = Buffer.from(certObject.cert, "hex");
            const certUtil = new CertUtil();
            const info = await certUtil.unpackCert(image);
            console.log(JSON.stringify(ToJSONObject(info), null, 4));
        }
        catch(e) {
            const message = (e as Error)?.message ? (e as Error).message : e;
            console.error("Failed unpacking cert", message);
            return 1;
        }
        return 0;
    }

    /**
     * @returns non-zero on error.
     */
    public async exportCert(certObject: {cert: string}): Promise<number> {
        try {
            const image = Buffer.from(certObject.cert, "hex");
            const cert = Decoder.DecodeAnyCert(image);
            const params = cert.getParams();
            console.log(JSON.stringify(ToJSONObject(params), null, 4));
        }
        catch(e) {
            const message = (e as Error)?.message ? (e as Error).message : e;
            console.error("Failed exporting cert", message);
            return 1;
        }
        return 0;
    }

    /**
     * @returns non-zero on error.
     */
    public calcCertConstraintValues(paramsObject: any, constraintParamsObject: any): number {
        try {
            if (!constraintParamsObject) {
                throw new Error("Missing constraintsParamsObject");
            }

            const certUtil = new CertUtil();

            const modelTypeHex = paramsObject.modelType;

            if (modelTypeHex === undefined) {
                throw new Error("modelType must be set in cert params file");
            }

            const modelType = Buffer.from(modelTypeHex, "hex");

            let timestamp = Date.now();
            const date = `${new Date(timestamp)}`;
            timestamp = timestamp * 1000;  // milliseconds

            const className = ModelTypeToNameMap[modelTypeHex] ?? "<unknown>";
            console.info(`Calculating constraints for cert type: ${className}, modelType: ${modelTypeHex}`);

            let constraints: Buffer | undefined;

            if (modelType.equals(AuthCert.GetType())) {
                const authCertParams = ParseSchema(AuthCertSchema, paramsObject);
                console.debug("Parsed AuthCertParams", authCertParams);

                const authCertConstraintValues = ParseSchema(AuthCertConstraintSchema, constraintParamsObject);
                console.debug("Parsed AuthCertConstraintValues", authCertConstraintValues);

                constraints = certUtil.calcAuthCertConstraintValues(authCertParams, authCertConstraintValues);
            }
            else if (modelType.equals(ChainCert.GetType())) {
                const chainCertParams = ParseSchema(ChainCertSchema, paramsObject);
                console.debug("Parsed ChainCertParams", chainCertParams);

                const chainCertConstraintValues = ParseSchema(ChainCertConstraintSchema, constraintParamsObject);
                console.debug("Parsed ChainCertConstraintValues", chainCertConstraintValues);

                constraints = certUtil.calcChainCertConstraintValues(chainCertParams, chainCertConstraintValues);
            }
            else if (modelType.equals(FriendCert.GetType())) {
                const friendCertParams = ParseSchema(FriendCertSchema, paramsObject);
                console.debug("Parsed FriendCertParams", friendCertParams);

                const friendCertConstraintValues = ParseSchema(FriendCertConstraintSchema, constraintParamsObject);
                console.debug("Parsed FriendCertConstraintValues", friendCertConstraintValues);

                constraints = certUtil.calcFriendCertConstraintValues(friendCertParams, friendCertConstraintValues);
            }
            else if (modelType.equals(DataCert.GetType())) {
                const dataCertParams = ParseSchema(DataCertSchema, paramsObject);
                console.debug("Parsed DataCertParams", dataCertParams);

                const dataCertConstraintValues = ParseSchema(DataCertConstraintSchema, constraintParamsObject);
                console.debug("Parsed DataCertConstraintValues", dataCertConstraintValues);

                constraints = certUtil.calcDataCertConstraintValues(dataCertParams, dataCertConstraintValues);
            }
            else if (modelType.equals(LicenseCert.GetType())) {
                const licenseCertParams = ParseSchema(LicenseCertSchema, paramsObject);
                console.debug("Parsed LicenseCertParams", licenseCertParams);

                const licenseCertConstraintValues = ParseSchema(LicenseCertConstraintSchema, constraintParamsObject);
                console.debug("Parsed LicenseCertConstraintValues", licenseCertConstraintValues);

                constraints = certUtil.calcLicenseCertConstraintValues(licenseCertParams, licenseCertConstraintValues);
            }
            else {
                throw new Error(`Cert modelType ${modelTypeHex} is not recognized.`);
            }

            const result = {
                [` ## ${className}ConstraintValues-created`]: `${date}`,
                timestamp,
                constraints: constraints ? constraints.toString("hex") : null,
            };

            console.log(JSON.stringify(result, null, 4));

            return 0;
        }
        catch(e) {
            console.error("Failed calculating cert constraints", (e as any as Error).message);
            console.debug(e);
            return 1;
        }
    }

    /**
     * @returns non-zero on error.
     */
    public async createCert(paramsObject: any, keyPairHolder?: any): Promise<number> {
        try {
            const certUtil = new CertUtil();

            let keyPair: KeyPair | undefined;
            if (keyPairHolder) {
                if (!keyPairHolder.keyPair) {
                    throw new Error("Wrong format for keyPair.");
                }

                keyPair = ParseSchema(KeyPairSchema, keyPairHolder.keyPair);
            }

            const modelTypeHex = paramsObject.modelType;

            if (modelTypeHex === undefined) {
                throw new Error("modelType must be set in cert params file");
            }

            const modelType = Buffer.from(modelTypeHex, "hex");

            let timestamp = Date.now();
            const date = `${new Date(timestamp)}`;
            timestamp = timestamp * 1000;  // milliseconds

            const className = ModelTypeToNameMap[modelTypeHex] ?? "<unknown>";
            console.info(`New cert request for ${className}, modelType: ${modelTypeHex}`);

            let cert: BaseCert;
            if (modelType.equals(AuthCert.GetType())) {
                const authCertParams = ParseSchema(AuthCertSchema, paramsObject);
                console.debug("Parsed AuthCertParams", authCertParams);
                cert = await certUtil.createAuthCert(authCertParams, keyPair?.publicKey, keyPair?.secretKey);
            }
            else if (modelType.equals(ChainCert.GetType())) {
                const chainCertParams = ParseSchema(ChainCertSchema, paramsObject);
                console.debug("Parsed ChainCertParams", chainCertParams);
                cert = await certUtil.createChainCert(chainCertParams, keyPair?.publicKey, keyPair?.secretKey);
            }
            else if (modelType.equals(FriendCert.GetType())) {
                const friendCertParams = ParseSchema(FriendCertSchema, paramsObject);
                console.debug("Parsed FriendCertParams", friendCertParams);
                cert = await certUtil.createFriendCert(friendCertParams, keyPair?.publicKey, keyPair?.secretKey);
            }
            else if (modelType.equals(DataCert.GetType())) {
                const dataCertParams = ParseSchema(DataCertSchema, paramsObject);
                console.debug("Parsed DataCertParams", dataCertParams);
                cert = await certUtil.createDataCert(dataCertParams, keyPair?.publicKey, keyPair?.secretKey);
            }
            else if (modelType.equals(LicenseCert.GetType())) {
                const licenseCertParams = ParseSchema(LicenseCertSchema, paramsObject);
                console.debug("Parsed LicenseCertParams", licenseCertParams);
                cert = await certUtil.createLicenseCert(licenseCertParams, keyPair?.publicKey, keyPair?.secretKey);
            }
            else {
                throw new Error(`Cannot handle cert of modelType ${modelTypeHex}.`);
            }

            console.debug("Created cert:", cert);

            const val = cert.validate(2);

            if (!val[0]) {
                console.error("Could not validate certificate.", val[1]);
                return 3;
            }

            if (cert.calcSignaturesNeeded() === 0) {
                try {
                    const image = cert.export();
                    await certUtil.verifyCert(image);
                    console.aced("Cert successfully created, deep validated and verified.");
                }
                catch(e) {
                    console.error("Failed verifying newly created cert:", (e as any as Error).message);
                    console.debug(e);
                    return 2;
                }
            }
            else {
                if (keyPair) {
                    console.warn(`Cert created and signed, but still requiring ${cert.calcSignaturesNeeded()} more signature(s).`);
                }
                else {
                    console.warn(`Cert created, but still requiring ${cert.calcSignaturesNeeded()} more signature(s).`);
                }
            }

            const result = {
                [` ## ${className}-created`]: `${date}`,
                timestamp,
                cert: cert.export().toString("hex"),
            };

            console.log(JSON.stringify(result, null, 4));
        }
        catch(e) {
            console.error("Failed creating cert", (e as any as Error).message);
            console.debug(e);
            return 1;
        }

        return 0;
    }

    /**
     * Deep verify any of our known certificates, with out witout target proprties.
     * @returns non-zero on error.
     */
    public async verifyCert(certObject: {cert: string}, expectedModelType: string | undefined, timeMS: number | undefined, constraintParamsObject: object | undefined): Promise<number> {
        const certUtil = new CertUtil();
        let image;
        try {
            image = Buffer.from(certObject.cert, "hex");
        }
        catch(e) {
            console.error(`Bad file provided as cert file. Expecting JSON file with a "cert" property.`);
            return 1;
        }
        const modelType = image.slice(0, 6);
        const modelTypeHex = modelType.toString("hex");

        if (expectedModelType) {
            if (expectedModelType !== modelTypeHex.slice(0, expectedModelType.length)) {
                console.error(`Expecting modelType: ${expectedModelType}. Cert modelTypeHex: ${modelTypeHex.slice(0, expectedModelType.length)}`);
                return 1;
            }
        }

        let cert: BaseCert;
        try {
            if (modelType.equals(AuthCert.GetType())) {
                console.info(`Certificate detected as AuthCert: ${modelTypeHex}`);
                let authCertConstraintValues: AuthCertConstraintValues | undefined;
                if (constraintParamsObject) {
                    authCertConstraintValues = ParseSchema(AuthCertConstraintSchema, constraintParamsObject);
                    console.debug("Parsed AuthCertConstraintValues", authCertConstraintValues);
                }
                cert = await certUtil.verifyAuthCert(image, authCertConstraintValues);
            }
            else if (modelType.equals(ChainCert.GetType())) {
                console.info(`Certificate detected as ChainCert: ${modelTypeHex}`);
                let chainCertConstraintValues: ChainCertConstraintValues | undefined;
                if (constraintParamsObject) {
                    chainCertConstraintValues = ParseSchema(ChainCertConstraintSchema, constraintParamsObject);
                    console.debug("Parsed ChainCertConstraintValues", chainCertConstraintValues);
                }
                cert = await certUtil.verifyChainCert(image, chainCertConstraintValues);
            }
            else if (modelType.equals(FriendCert.GetType())) {
                console.info(`Certificate detected as FriendCert: ${modelTypeHex}`);
                let friendCertConstraintValues: FriendCertConstraintValues | undefined;
                if (constraintParamsObject) {
                    friendCertConstraintValues = ParseSchema(FriendCertConstraintSchema, constraintParamsObject);
                    console.debug("Parsed FriendCertConstraintValues", friendCertConstraintValues);
                }
                cert = await certUtil.verifyFriendCert(image, friendCertConstraintValues);
            }
            else if (modelType.equals(DataCert.GetType())) {
                console.info(`Certificate detected as DataCert: ${modelTypeHex}`);
                let dataCertConstraintValues: DataCertConstraintValues | undefined;
                if (constraintParamsObject) {
                    dataCertConstraintValues = ParseSchema(DataCertConstraintSchema, constraintParamsObject);
                    console.debug("Parsed DataCertConstraintValues", dataCertConstraintValues);
                }
                cert = await certUtil.verifyDataCert(image, dataCertConstraintValues);
            }
            else if (modelType.equals(LicenseCert.GetType())) {
                console.info(`Certificate detected as LicenseCert: ${modelTypeHex}`);
                let licenseCertConstraintValues: LicenseCertConstraintValues | undefined;
                if (constraintParamsObject) {
                    licenseCertConstraintValues = ParseSchema(LicenseCertConstraintSchema, constraintParamsObject);
                    console.debug("Parsed LicenseCertConstraintValues", licenseCertConstraintValues);
                }
                cert = await certUtil.verifyLicenseCert(image, licenseCertConstraintValues);
            }
            else {
                console.error(`Unknown cert modelType: ${modelTypeHex}`);
                return 1;
            }

            if (constraintParamsObject) {
                console.aced("Cert successfully deep verified including against constraints.");
            }
            else {
                console.aced("Cert successfully deep verified (without checking constraints).");
            }

            if (timeMS !== undefined) {
                const val = cert.validate(1, timeMS);
                if (val[0]) {
                    console.aced("Cert successfully deep validated against given timestamp.");
                }
                else {
                    throw new Error("Cert could not deep validate against timestamp.");
                }
            }

            return 0;
        }
        catch(e) {
            console.error("Could not verify cert", (e as any as Error).message);
            console.debug(e);
            return 1;
        }
    }

    protected showUsage(error?: string) {
        console.getConsole().error(`${error ? "Error: " + error : ""}${USAGE_TEXT}`);
    }

    protected parseArgs(): {[key: string]: string} {
        const flags = ["logLevel=", "keyFile=", "modelType=", "time=", "help"];
        const result: {[key: string]: string} = {};

        let argc = 0;
        process.argv.slice(2).forEach( arg => {
            if (arg.startsWith("--")) {
                let flag = arg.slice(2);
                let value = "true";
                const i = arg.indexOf('=');
                if (i > -1) {
                    flag = arg.slice(2, i+1);
                    value = arg.slice(i+1);
                }
                if (!flags.includes(flag)) {
                    this.showUsage(`Unknown flag: ${arg}`);
                    process.exit(1);
                }
                if (i>-1) {
                    flag = flag.slice(0, flag.length - 1);
                    if (value === "") {
                        this.showUsage(`Flag requires a value: ${arg}`);
                        process.exit(1);
                    }
                }
                result[flag] = value;
                return;
            }
            // Positional arg.
            result[String(argc)] = arg;
            argc++;
        });
        return result;
    }

    public async main() {
        const args = this.parseArgs();
        if (args.logLevel) {
            console.setLevel(args.logLevel);
        }
        const action = args[0];

        if (action === "help") {
            this.showUsage();
            process.exit(0);
        }
        else if (action === "constraints") {
            if (args[3] !== undefined) {
                this.showUsage("Too many args.");
                process.exit(1);
            }
            await this.handleConstraints(args[1], args[2]);
        }
        else if (action === "create") {
            if (args[2] !== undefined) {
                this.showUsage("Too many args.");
                process.exit(1);
            }
            await this.handleCreate(args[1], args.keyFile);
        }
        else if (action === "verify") {
            if (args[3] !== undefined) {
                this.showUsage("Too many args.");
                process.exit(1);
            }
            await this.handleVerify(args[1], args[2], args.modelType, args.time !== undefined ? Number(args.time) : undefined);
        }
        else if (action === "show") {
            if (args[2] !== undefined) {
                this.showUsage("Too many args.");
                process.exit(1);
            }
            await this.handleShow(args[1]);
        }
        else if (action === "export") {
            if (args[2] !== undefined) {
                this.showUsage("Too many args.");
                process.exit(1);
            }
            await this.handleExport(args[1]);
        }
        else if (action === "list") {
            if (args[1] !== undefined) {
                this.showUsage("Too many args.");
                process.exit(1);
            }
            await this.handleList();
        }
        else {
            this.showUsage(`Unknown command: ${action ?? ""}`);
            process.exit(1);
        }
    }

    public async handleVerify(certFile: string | undefined, constraintParamsFile: string | undefined, expectedModelType: string | undefined, timeMS: number | undefined) {
        if (!certFile) {
            this.showUsage("certFile must be given as first argument.");
            process.exit(1);
        }

        let certObject;
        try {
            certObject = JSONUtil.LoadJSON(certFile);
        }
        catch(e) {
            console.error("Could not load JSON", (e as any as Error).message);
            console.debug(e);
            process.exit(1);
        }

        let constraintParamsObject;
        if (constraintParamsFile) {
            try {
                constraintParamsObject = JSONUtil.LoadJSON(constraintParamsFile, [".creationTime", ".expireTime", ".publicKey", ".otherIssuerPublicKey", ".otherConstraints", ".intermediaryPublicKey"]);
            }
            catch(e) {
                console.error("Could not load JSON", (e as any as Error).message);
                console.debug(e);
                process.exit(1);
            }
        }

        const status = await this.verifyCert(certObject, expectedModelType, timeMS, constraintParamsObject);
        process.exit(status);
    }

    public async handleShow(certFile: string | undefined) {
        if (!certFile) {
            this.showUsage("certFile must be given as argument.");
            process.exit(1);
        }

        let certObject;
        try {
            certObject = JSONUtil.LoadJSON(certFile);
        }
        catch(e) {
            console.error("Could not load JSON", (e as any as Error).message);
            console.debug(e);
            process.exit(1);
        }

        const status = await this.showCert(certObject);
        process.exit(status);
    }

    public async handleList() {
        console.log(JSON.stringify(ModelTypeToNameMap, null, 4));
        process.exit(0);
    }

    public async handleExport(certFile: string | undefined) {
        if (!certFile) {
            this.showUsage("certFile must be given as argument.");
            process.exit(1);
        }

        let certObject;
        try {
            certObject = JSONUtil.LoadJSON(certFile);
        }
        catch(e) {
            console.error("Could not load JSON", (e as any as Error).message);
            console.debug(e);
            process.exit(1);
        }

        const status = await this.exportCert(certObject);
        process.exit(status);
    }

    public async handleConstraints(certParamsFile: string | undefined, constraintParamsFile: string | undefined) {
        if (!certParamsFile) {
            this.showUsage("certParams.json must be given as argument when calculating constraints on target.");
            process.exit(1);
        }

        if (!constraintParamsFile) {
            this.showUsage("constraintParams file must be given as argument when calculating constraints on target.");
            process.exit(1);
        }

        let paramsObject;
        let constraintParamsObject;
        try {
            paramsObject = JSONUtil.LoadJSON(certParamsFile, [".targetPublicKeys", ".owner", ".creationTime", ".expireTime"]);
            constraintParamsObject = JSONUtil.LoadJSON(constraintParamsFile, [".targetPublicKeys", ".owner", ".creationTime", ".expireTime", ".publicKey", ".constraints", ".otherIssuerPublicKey", ".otherConstraints", ".intermediaryPublicKey"]);
        }
        catch(e) {
            console.error("Could not load JSON", (e as any as Error).message);
            console.debug(e);
            process.exit(1);
        }

        const status = this.calcCertConstraintValues(paramsObject, constraintParamsObject);
        process.exit(status);
    }

    public async handleCreate(certParamsFile: string | undefined, keyPairFile: string | undefined) {
        if (!certParamsFile) {
            this.showUsage("certParams.json must be given as argument when creating a new cert.");
            process.exit(1);
        }

        let keyPairHolder;
        let paramsObject;
        try {
            if (keyPairFile) {
                keyPairHolder = JSONUtil.LoadJSON(keyPairFile);
            }
            paramsObject = JSONUtil.LoadJSON(certParamsFile, [".cert", ".constraints", ".targetPublicKeys", ".owner", ".creationTime", ".expireTime"]);
            console.debug("Loaded JSON params object", paramsObject);
        }
        catch(e) {
            console.error("Could not load JSON", (e as any as Error).message);
            console.debug(e);
            process.exit(1);
        }

        const status = await this.createCert(paramsObject, keyPairHolder);
        process.exit(status);
    }
}

const certCLI = new CertCLI();
certCLI.main();
