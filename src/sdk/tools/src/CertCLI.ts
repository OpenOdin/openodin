#!/usr/bin/env node

import {
    JSONUtil,
} from "../../../util/JSONUtil";

import {
    ParseSchema,
    ToJSONObject,
} from "../../../util/SchemaUtil";

import {
    AuthCert,
    AuthCertType,
    AuthCertTypeAlias,
    AuthCertLockedConfig,
    AuthCertInterface,
    ParseAuthCertSchema,
    FriendCert,
    FriendCertType,
    FriendCertTypeAlias,
    FriendCertLockedConfig,
    FriendCertInterface,
    ParseFriendCertSchema,
    SignCert,
    SignCertType,
    SignCertTypeAlias,
    SignCertLockedConfig,
    SignCertInterface,
    ParseSignCertSchema,
    KeyPair,
    ParseKeyPairSchema,
    UnpackCert,
    BaseCertInterface,
    GetModelType,
    DataNodeType,
    DataNodeTypeAlias,
    LicenseNodeType,
    LicenseNodeTypeAlias,
} from "../../../datamodel";

import {
    PocketConsole,
} from "pocket-console";

const console = PocketConsole({format: "%c[%L%l]%C "});

/** Map of all supported certs. */
const ModelToAlias: {[modelType: string]: string | undefined} = {
    [Buffer.from(SignCertType).toString("hex")]: SignCertTypeAlias,
    [Buffer.from(AuthCertType).toString("hex")]: AuthCertTypeAlias,
    [Buffer.from(FriendCertType).toString("hex")]: FriendCertTypeAlias,
    [Buffer.from(DataNodeType).toString("hex")]: DataNodeTypeAlias,
    [Buffer.from(LicenseNodeType).toString("hex")]: LicenseNodeTypeAlias,
};

const AliasToModel: {[alias: string]: string | undefined} = {
    [SignCertTypeAlias]: Buffer.from(SignCertType).toString("hex"),
    [AuthCertTypeAlias]: Buffer.from(AuthCertType).toString("hex"),
    [FriendCertTypeAlias]: Buffer.from(FriendCertType).toString("hex"),
    [DataNodeTypeAlias]: Buffer.from(DataNodeType).toString("hex"),
    [LicenseNodeTypeAlias]: Buffer.from(LicenseNodeType).toString("hex"),
};

const USAGE_TEXT=`

Usage:
    cert help|-h|--help
        Show this help

    cert create <certProps.json> [--keyFile=<keyfile.json>] [--logLevel=debug|info|error|none]
        Create a new packed cert.
        --keyFile must be given if "signature" is not set in certProps so
            that the cert can be signed.
        The type of cert created is defined by the "modelType" field in the certProps.json file.

    cert verify <cert.json> [<constraintProps.json>]
            [--modelType=hex]
            [--time=UNIXms] [--logLevel=debug|info|error|none]
        Verify a cert stack deep to see that it verifies cryptographically and is valid.
        Optionally calculate constraints and validate with cert.
        Optionally validate against given UNIX time in milliseconds, if no time is given
        Optionally validates against a given modelType.
        then the cert(s) are not validated in time.

    cert unpack <cert.json> [--logLevel=debug|info|error|none]
        Unpack a packed cert back into its JSON properies.
        The output could be fed back into the "create" command.

    cert constraints <certProps.json> <lockedFields.json> [--logLevel=debug|info|error|none]
        Hash constraints on a certtificate or node according to given locked fields.

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
    public unpackCert(certObject: {cert: string}): number {
        try {
            const packed = Buffer.from(certObject.cert, "hex");

            const cert = UnpackCert(packed, false, true);

            console.log(JSON.stringify(ToJSONObject(cert.getProps()), null, 4));
        }
        catch(e) {
            const message = (e as Error)?.message ? (e as Error).message : e;

            console.error("Failed unpacking cert", message);

            return 1;
        }
        return 0;
    }

    public hashConstraints(certProps: any, lockedFields: {[field: string]: boolean}): number {
        certProps.modelType = AliasToModel[certProps.modelType] ?? certProps.modelType;

        if (certProps.targetType) {
            certProps.targetType = AliasToModel[certProps.targetType] ?? certProps.targetType;
        }

        const modelTypeHex = certProps.modelType;

        if (!modelTypeHex) {
            console.error("modelType not defined");

            return 1;
        }

        const modelTypeAlias = ModelToAlias[modelTypeHex] ?? "";

        let cert: AuthCertInterface | SignCertInterface | FriendCertInterface;

        let enumMappings;

        if (modelTypeAlias === AuthCertTypeAlias) {
            console.info(`Hash constraints for AuthCert (${modelTypeHex})`);

            const props = ParseSchema(ParseAuthCertSchema, certProps);

            cert = new AuthCert();

            cert.mergeProps(props)

            cert.storeFlags(props);

            // Map the enum
            //
            enumMappings = {...AuthCertLockedConfig};
        }
        else if (modelTypeAlias === FriendCertTypeAlias) {
            console.info(`Hash constraints for FriendCert (${modelTypeHex})`);

            const props = ParseSchema(ParseFriendCertSchema, certProps);

            cert = new FriendCert();

            cert.mergeProps(props)

            cert.storeFlags(props);

            // Map the enum
            //
            enumMappings = {...FriendCertLockedConfig};
        }
        else if (modelTypeAlias === SignCertTypeAlias) {
            console.info(`Hash constraints for SignCert (${modelTypeHex})`);

            const props = ParseSchema(ParseSignCertSchema, certProps);

            cert = new SignCert();

            cert.mergeProps(props)

            cert.storeFlags(props);

            // Map the enum
            //
            enumMappings = {...SignCertLockedConfig};
        }
        else {
            throw new Error(`Cannot handle cert of modelType ${modelTypeHex}.`);
        }

        const enumKeys: string[] = Object.keys(enumMappings).
            filter( name => String(parseInt(name)) !== name );

        cert.pack();

        const fieldsList: string[] = [];

        let lockedConfig = 0;

        for (const field in lockedFields) {
            if (enumKeys.indexOf(field) < 0) {
                console.error(`Unknown field ${field} in locked config. These are available:`, enumKeys);
                return 1;
            }

            if (typeof(lockedFields[field]) !== "boolean") {
                console.error(`locked field ${field} value type must be boolean`);
                return 1;
            }

            if (!lockedFields[field]) {
                continue;
            }

            const bit = enumMappings[field as any];

            if (typeof(bit) === "number") {
                lockedConfig |= 2**bit;

                fieldsList.push(field);
            }
        }

        const constraints = cert.hashConstraints(lockedConfig);

        const timestamp = Date.now();

        const result = {
            [` ## ${modelTypeAlias}-hash-constraints`]: `${new Date(timestamp)}`,
            [" ## lockedFields"]: fieldsList,
            timestamp,
            constraints: constraints.toString("hex"),
        };

        console.log(JSON.stringify(result, null, 4));

        return 0;
    }

    /**
     * @returns non-zero on error.
     */
    public createCert(certProps: any, keyPairHolder?: any): number {
        try {
            let keyPair: KeyPair | undefined;

            if (keyPairHolder) {
                if (!keyPairHolder.keyPair) {
                    throw new Error("Wrong format for keyPair.");
                }

                keyPair = ParseSchema(ParseKeyPairSchema, keyPairHolder.keyPair);
            }

            certProps.modelType = AliasToModel[certProps.modelType] ?? certProps.modelType;

            if (certProps.targetType) {
                certProps.targetType = AliasToModel[certProps.targetType] ?? certProps.targetType;
            }

            const modelTypeHex = certProps.modelType;

            if (!modelTypeHex) {
                console.error("modelType not defined");

                return 1;
            }

            const modelTypeAlias = ModelToAlias[modelTypeHex] ?? "";

            let cert: BaseCertInterface;

            if (modelTypeAlias === AuthCertTypeAlias) {
                console.info(`New cert request for AuthCert (${modelTypeHex})`);

                const props = ParseSchema(ParseAuthCertSchema, certProps);

                cert = new AuthCert();

                cert.mergeProps(props)

                cert.storeFlags(props);
            }
            else if (modelTypeAlias === FriendCertTypeAlias) {
                console.info(`New cert request for FriendCert (${modelTypeHex})`);

                const props = ParseSchema(ParseFriendCertSchema, certProps);

                cert = new FriendCert();

                cert.mergeProps(props)

                cert.storeFlags(props);
            }
            else if (modelTypeAlias === SignCertTypeAlias) {
                console.info(`New cert request for SignCert (${modelTypeHex})`);

                const props = ParseSchema(ParseSignCertSchema, certProps);

                cert = new SignCert();

                cert.mergeProps(props)

                cert.storeFlags(props);
            }
            else {
                throw new Error(`Cannot handle cert of modelType ${modelTypeHex}.`);
            }

            console.debug("Created cert:", cert.getProps());

            const val = cert.validate(true);

            if (!val[0]) {
                console.error("Could not validate certificate.", val[1]);
                return 3;
            }

            cert.pack();

            if (cert.missingSignatures() > 0) {
                if (keyPair) {
                    cert.sign(keyPair);
                }
            }

            try {
                const cert2 = UnpackCert(cert.pack());

                if (!cert2.verify({allowUnsigned: true})) {
                    throw new Error("Could not repack and verify");
                }
            }
            catch(e) {
                console.error("Failed verifying newly created cert:", (e as any as Error).message);
                console.debug(e);

                return 2;
            }

            if (cert.missingSignatures() === 0) {
                if (keyPair) {
                    console.aced("Cert successfully created, signed, deep validated and verified.");
                }
                else {
                    console.aced("Cert successfully created, deep validated and verified.");
                }
            }
            else {
                if (keyPair) {
                    console.warn(`Cert created and signed, but still requiring ${cert.missingSignatures()} more signature(s).`);
                }
                else {
                    console.warn(`Cert created, but still requiring ${cert.missingSignatures()} more signature(s).`);
                }
            }

            const timestamp = Date.now();

            const result = {
                [` ## ${modelTypeAlias}-created`]: `${new Date(timestamp)}`,
                timestamp,
                cert: cert.pack().toString("hex"),
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
    public verifyCert(certObject: {cert: string}, expectedModelType: string | undefined, timeMS: number | undefined): number {
        let packed;

        try {
            packed = Buffer.from(certObject.cert, "hex");
        }
        catch(e) {
            console.error(`Bad file provided as cert file. Expecting JSON file with a "cert" property of hexadecimal data.`);

            return 1;
        }

        const modelType = GetModelType(packed);

        const modelTypeHex = modelType.toString("hex");

        if (expectedModelType) {
            if (expectedModelType !== modelTypeHex.slice(0, expectedModelType.length)) {
                console.error(`Expecting modelType: ${expectedModelType}. Cert modelTypeHex: ${modelTypeHex.slice(0, expectedModelType.length)}`);

                return 1;
            }
        }

        let cert: BaseCertInterface;

        try {
            if (AuthCert.Is(modelType)) {
                console.info(`Certificate detected as AuthCert: ${modelTypeHex}`);

                cert = new AuthCert(packed);
            }
            else if (FriendCert.Is(modelType)) {
                console.info(`Certificate detected as FriendCert: ${modelTypeHex}`);

                cert = new FriendCert(packed);
            }
            else if (SignCert.Is(modelType)) {
                console.info(`Certificate detected as SignCert: ${modelTypeHex}`);

                cert = new SignCert(packed);
            }
            else {
                console.warn(`Unknown cert modelType: ${modelTypeHex}`);

                cert = UnpackCert(packed);
            }

            cert.unpack();

            if (!cert.verify()) {
                console.error("Could not verify certificate signatures.");

                return 1;
            }

            console.debug(cert.getProps());

            const val = cert.validate(true, timeMS);

            if (!val[0]) {
                console.error("Could not deep validate certificate:", val[1]);

                return 1;
            }

            if (timeMS !== undefined) {
                console.aced("Certificate deep validatated. expireTime checked against given time.");
            }
            else {
                console.aced("Certificate deep validatated (no expireTime checked).");
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

    public main() {
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

            this.handleConstraints(args[1], args[2]);
        }
        else if (action === "create") {
            if (args[2] !== undefined) {
                this.showUsage("Too many args.");
                process.exit(1);
            }

            this.handleCreate(args[1], args.keyFile);
        }
        else if (action === "verify") {
            if (args[3] !== undefined) {
                this.showUsage("Too many args.");
                process.exit(1);
            }

            this.handleVerify(args[1], args.modelType, args.time !== undefined ? Number(args.time) : undefined);
        }
        else if (action === "unpack") {
            if (args[2] !== undefined) {
                this.showUsage("Too many args.");
                process.exit(1);
            }

            this.handleUnpack(args[1]);
        }
        else if (action === "list") {
            if (args[1] !== undefined) {
                this.showUsage("Too many args.");
                process.exit(1);
            }
            this.handleList();
        }
        else {
            this.showUsage(`Unknown command: ${action ?? ""}`);

            process.exit(1);
        }
    }

    public handleVerify(certFile: string | undefined, expectedModelType: string | undefined, timeMS: number | undefined) {
        if (!certFile) {
            this.showUsage("certFile must be given as first argument.");
            process.exit(1);
        }

        let certObject;
        try {
            console.debug(`Load file ${certFile}`);

            certObject = JSONUtil.LoadJSON(certFile);
        }
        catch(e) {
            console.error("Could not load JSON", (e as any as Error).message);
            console.debug(e);
            process.exit(1);
        }

        const status = this.verifyCert(certObject, expectedModelType, timeMS);

        process.exit(status);
    }

    public handleUnpack(certFile: string | undefined) {
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

        const status = this.unpackCert(certObject);

        process.exit(status);
    }

    public handleList() {
        console.log(JSON.stringify(ModelToAlias, null, 4));

        process.exit(0);
    }

    public handleConstraints(certPropsFile: string | undefined, lockedFieldsFile: string | undefined) {
        if (!certPropsFile) {
            this.showUsage("certProps.json must be given as argument when hashing constraints on target.");
            process.exit(1);
        }

        if (!lockedFieldsFile) {
            this.showUsage("lockedFields.json file must be given as argument when hashing constraints on target.");
            process.exit(1);
        }

        let certProps;
        let lockedFields;
        try {
            certProps = JSONUtil.LoadJSON(certPropsFile);
            lockedFields = JSONUtil.LoadJSON(lockedFieldsFile);
        }
        catch(e) {
            console.error("Could not load JSON", (e as any as Error).message);
            console.debug(e);
            process.exit(1);
        }

        const status = this.hashConstraints(certProps, lockedFields);

        process.exit(status);
    }

    public handleCreate(certPropsFile: string | undefined, keyPairFile: string | undefined) {
        if (!certPropsFile) {
            this.showUsage("certProps.json must be given as argument when creating a new cert.");
            process.exit(1);
        }

        let keyPairHolder;
        let certProps;
        try {
            if (keyPairFile) {
                keyPairHolder = JSONUtil.LoadJSON(keyPairFile);
            }
            certProps = JSONUtil.LoadJSON(certPropsFile);
            console.debug("Loaded JSON props object", certProps);
        }
        catch(e) {
            console.error(`Could not load JSON of file ${certPropsFile}`, (e as any as Error).message);
            console.debug(e);
            process.exit(1);
        }

        const status = this.createCert(certProps, keyPairHolder);

        process.exit(status);
    }
}

const certCLI = new CertCLI();

certCLI.main();
