import {
    ClientOptions,
    ServerOptions,
    SocketFactoryConfig,
    SOCKET_WEBSOCKET,
    SOCKET_TCP,
} from "pocket-sockets";

import {
    HandshakeFactoryConfig,
} from "pocket-messaging";

import {
    KeyPair,
    PrimaryNodeCertInterface,
    CMP,
    Filter,
    AuthCertInterface,
    AuthCertConstraintValues,
    AuthCertParams,
    BaseCertParams,
    ChainCertParams,
    ChainCertConstraintValues,
    FriendCertParams,
    FriendCertConstraintValues,
    NodeParams,
    DataParams,
    LicenseParams,
    PrimaryNodeCertParams,
    DataCertParams,
    DataCertConstraintValues,
    LicenseCertParams,
    LicenseCertConstraintValues,
    DATA0_NODE_TYPE,
    DATA0_NODE_TYPE_ALIAS,
    LICENSE0_NODE_TYPE,
    LICENSE0_NODE_TYPE_ALIAS,
} from "../datamodel";

import {
    Decoder,
} from "../decoder";

import {
    AllowEmbed,
    FetchQuery,
    Match,
    LimitField,
    FetchCRDT,
    FetchRequest,
    FetchResponse,
    FetchResult,
    CRDTResult,
    StoreRequest,
    StoreResponse,
    UnsubscribeRequest,
    UnsubscribeResponse,
    WriteBlobRequest,
    WriteBlobResponse,
    ReadBlobRequest,
    ReadBlobResponse,
    GenericMessageResponse,
    GenericMessageRequest,
} from "../types";

import {
    P2PClientPermissions,
    P2PClientFetchPermissions,
    P2PClientStorePermissions,
    UNCHECKED_PERMISSIVE_PERMISSIONS,
    PERMISSIVE_PERMISSIONS,
    DEFAULT_PEER_PERMISSIONS,
} from "../p2pclient/types";

import {
    DatabaseConfig,
    ConnectionConfig,
    DriverConfig,
    ApplicationConf,
    WalletConf,
    SyncConf,
    StorageConf,
} from "../service/types";

import {
    ThreadTemplate,
    ThreadLicenseParams,
    ThreadDataParams,
    ThreadQueryParams,
    ThreadCRDTParams,
    ThreadFetchParams,
} from "../storage/thread";

import {
    DeepCopy,
    StripObject,
} from "../util/common";

import {
    APIAuthFactoryConfig,
    NativeAuthFactoryConfig,
} from "../auth/types";

const NodeTypes: {[alias: string]: Buffer} = {
    [DATA0_NODE_TYPE_ALIAS.toLowerCase()]: DATA0_NODE_TYPE,
    [LICENSE0_NODE_TYPE_ALIAS.toLowerCase()]: LICENSE0_NODE_TYPE,
};

/**
 * Parse config object fragments.
 */
export class ParseUtil {
    /**
     * @param conf object
     * {
     *  format?:        1,
     *  name:           string,
     *  version:        string,
     *  title?:         string,
     *  description?:   string,
     *  homepage?:      string,
     *  author?:        string,
     *  repository?:    string,
     *  custom?:        {[key: string]: any};
     *  threads?:       {[name: string]: ThreadTemplate};
     *  peers?: {
     *      connection:     HandshakeFactoryConfig,
     *      permissions:    P2PClientPermissions,
     *      region?:        string,
     *      jurisdiction?:  string,
     *      serializeFormat?: number,
     *  }[],
     *  sync?: {
     *      peerPublicKeys:    Buffer[],
     *      blobSizeMaxLimit:  number,
     *      threads: {
     *          name:               string,
     *          stream?:            boolean,
     *          threadFetchParams?: ThreadFetchParams,
     *          direction?:         "push" | "pull" " "both",
     *      }[],
     *  }[]
     * }
     *
     * @returns ApplicationConf
     * @throws if malconfigured.
     */
    public static ParseApplicationConf(conf: any): ApplicationConf {
        const format = ParseUtil.ParseVariable("applicationConf.format must be number, if set", conf.format, "number", true) ?? 1;

        if (format !== 1) {
            throw new Error("applicationConf.format must be set to 1");
        }

        const name = ParseUtil.ParseVariable("applicationConf.name must be string", conf.name, "string");

        const version = ParseUtil.ParseVariable("applicationConf.version must be string on semver format (x.y.z)", conf.version, "string");
        const [major, minor, patch] = version.split(".").map( (n: any) => parseInt(n));
        if (major >=0 && major <= 65535 && minor >= 0 && minor <= 65535 && patch >= 0 && patch <= 65535 && `${major}.${minor}.${patch}` === conf.version) {
            // Do nothing
        }
        else {
            throw new Error(`applicationConf.version must be string on semver format (x.y.z). Given: ${conf.version}`);
        }

        const title = ParseUtil.ParseVariable("applicationConf.title must be string, if set", conf.title, "string", true) ?? "";
        const description = ParseUtil.ParseVariable("applicationConf.description must be string, if set", conf.description, "string", true) ?? "";
        const homepage = ParseUtil.ParseVariable("applicationConf.homepage must be string, if set", conf.homepage, "string", true) ?? "";
        const author = ParseUtil.ParseVariable("applicationConf.author must be string, if set", conf.author, "string", true) ?? "";
        const repository = ParseUtil.ParseVariable("applicationConf.repository must be string, if set", conf.repository, "string", true) ?? "";
        const custom = ParseUtil.ParseVariable("applicationConf.custom must be object, if set", conf.custom, "object", true) ?? {};

        const threads: {[name: string]: ThreadTemplate} = {};
        const threadTemplates = ParseUtil.ParseVariable("applicationConf.threads must be object, if set", conf.threads, "object", true) ?? {};
        for (const name in threadTemplates) {
            threads[name] = ParseUtil.ParseThread(threadTemplates[name]);
        }

        const peers: ConnectionConfig[] = [];
        (conf.peers ?? []).forEach( (peerConf: any) => {
            if (peerConf.permissions === null || peerConf.permissions === undefined) {
                peerConf = {
                    ...peerConf,
                    permissions: DEFAULT_PEER_PERMISSIONS,
                };
            }

            const connectionConfig = ParseUtil.ParseConfigConnectionConfig(peerConf);

            peers.push(connectionConfig);
        });

        const sync: SyncConf[] = [];
        (conf.sync ?? []).forEach( (syncConf: any) => {
            const peerPublicKeys = ParseUtil.ParseVariable("applicationConf.sync.peerPublicKeys must be hex-string or Buffer array", syncConf.peerPublicKeys, "hex[]");

            const blobSizeMaxLimit = ParseUtil.ParseVariable("applicationConf.sync.blobSizeMaxLimit must be number, if set", syncConf.blobSizeMaxLimit, "number", true) ?? -1;

            const threads: any[] = [];
            (syncConf.threads ?? []).forEach( (thread: any) => {

                const name = ParseUtil.ParseVariable("applicationConf.sync.threads.name must be string", thread.name, "string");

                const stream = ParseUtil.ParseVariable("applicationConf.sync.threads.stream must be boolean, if set", thread.stream, "boolean", true) ?? false;

                const direction = ParseUtil.ParseVariable("applicationConf.sync.threads.direction must be string, if set", thread.direction, "string", true) ?? "pull";

                const threadFetchParams = ParseUtil.ParseThreadFetchParams(thread.threadFetchParams ?? {});

                if (!["push", "pull", "both"].includes(direction)) {
                    throw new Error("applicationConf.sync.threads.direction must be either \"push\", \"pull\", \"both\", if set");
                }

                threads.push({
                    name,
                    stream,
                    threadFetchParams,
                    direction,
                });
            });

            sync.push({
                peerPublicKeys,
                blobSizeMaxLimit,
                threads,
            });
        });

        return {
            format,
            name,
            version,
            title,
            description,
            homepage,
            author,
            repository,
            custom,
            threads,
            peers,
            sync,
        };
    }

    /**
     * @throws on error
     */
    public static ParseThread(threadTemplate: any): ThreadTemplate {
        const query     = ParseUtil.ParseQuery(threadTemplate.query ?? {});
        const crdt      = ParseUtil.ParseCRDT(threadTemplate.crdt ?? {});

        const post: {[name: string]: ThreadDataParams} = {};

        Object.keys(threadTemplate.post ?? {}).forEach( name => {
            const params = threadTemplate.post[name];
            if (params) {
                post[name] = ParseUtil.ParseThreadDataParams(params) ?? {};
            }
        });

        const postLicense: {[name: string]: ThreadLicenseParams} = {};

        Object.keys(threadTemplate.postLicense ?? {}).forEach( name => {
            const params = threadTemplate.postLicense[name];
            if (params) {
                postLicense[name] = ParseUtil.ParseThreadLicenseParams(params) ?? {};
            }
        });

        return {
            query,
            crdt,
            post,
            postLicense,
        };
    }

    /**
     * @param conf object
     * {
     *  ...LicenseParams,
     *  validSeconds?: number,
     *  targets?: (hexstring | Buffer)[],
     *
     *  @returns ThreadLicenseParams or undefined
     */
    public static ParseThreadLicenseParams(conf: any): ThreadLicenseParams | undefined {
        if (!conf) {
            return undefined;
        }

        const licenseParams = ParseUtil.ParseLicenseParams(conf);

        const threadLicenseParams: ThreadLicenseParams = {
            ...licenseParams,
        };

        if (Object.prototype.hasOwnProperty.call(conf, "validSeconds")) {
            threadLicenseParams.validSeconds =
                ParseUtil.ParseVariable("ThreadLicenseParams.validSeconds must be number, if set",
                    conf.validSeconds, "number", true);  // allow undefined.
        }

        if (Object.prototype.hasOwnProperty.call(conf, "targets")) {
            threadLicenseParams.targets =
                ParseUtil.ParseVariable("ThreadLicenseParams.targets must be hex-string or Buffer array, if set",
                    conf.targets, "hex[]", true);  // allow undefined
        }

        return threadLicenseParams;
    }

    /**
     * @param conf object
     * {
     *  ...DataParams,
     *  validSeconds?: number,
     *
     *  @returns ThreadDataParams or undefined
     */
    public static ParseThreadDataParams(conf: any): ThreadDataParams | undefined {
        if (!conf) {
            return undefined;
        }

        const dataParams = ParseUtil.ParseDataParams(conf);

        const threadDataParams: ThreadDataParams = {
            ...dataParams,
        };

        if (Object.prototype.hasOwnProperty.call(conf, "validSeconds")) {
            threadDataParams.validSeconds =
                ParseUtil.ParseVariable("ThreadDataParams.validSeconds must be number, if set",
                    conf.validSeconds, "number", true);  // allow undefined.
        }

        return threadDataParams;
    }

    /**
     * @param conf object
     * {
     *  keyPairs?: {
     *      publicKey: hexstring | Buffer,
     *      secretKey: hexstring | Buffer
     *  }[],
     *  authCert?: hexstring | Buffer,
     *  nodeCerts?: (hexstring | Buffer)[],
     *  storage?: {
     *      peer?: {
     *          connection:     HandshakeFactoryConfig,
     *          region?:        string,
     *          jurisdiction?:  string,
     *          permissions:    P2PClientPermissions,
     *          serializeFormat?: number,
     *      },
     *      database?: {
     *          permissions?: P2PClientPermissions,
     *          appPermissions?: P2PClientPermissions,
     *          driver?: DriverConfig,
     *          blobDriver?: DriverConfig,
     *      }
     *  }
     * }
     *
     * @returns WalletConf
     * @throws if malconfigured.
     */
    public static ParseWalletConf(conf: any): WalletConf {
        conf = conf ?? {};

        const keyPairs = (conf.keyPairs ?? []).map( (keyPair: any) => ParseUtil.ParseKeyPair(keyPair) );

        const authCert = conf.authCert ? ParseUtil.ParseConfigAuthCert(conf.authCert) : undefined;

        const nodeCerts = ParseUtil.ParseConfigNodeCerts(conf.nodeCerts ?? []);

        const storage: StorageConf = {};

        if (conf.storage?.peer) {
            storage.peer = ParseUtil.ParseConfigConnectionConfig(conf.storage.peer);
        }
        else {
            storage.database = ParseUtil.ParseConfigDatabase(conf.storage?.database ?? {});
        }

        return {
            keyPairs,
            authCert,
            nodeCerts,
            storage,
        };
    }

    /**
     * @param keyPair object with hex encoded string properties:
     * {
     *  publicKey: hexstring | Buffer,
     *  secretKey: hexstring | Buffer
     * }
     * @returns KeyPair
     * @throws if malconfigured.
     */
    public static ParseKeyPair(keyPair: any): KeyPair {
        const publicKey = ParseUtil.ParseVariable("keyPair publicKey must be hex-string or Buffer", keyPair.publicKey, "hex");
        const secretKey = ParseUtil.ParseVariable("keyPair secretKey must be hex-string or Buffer", keyPair.secretKey, "hex");

        return {
            publicKey,
            secretKey,
        };
    }

    /**
     * @param encoded hex encoded string of exported Auth Cert
     * @returns AuthCert
     * @throws if malconfigured or cert cannot be decoded.
     */
    public static ParseConfigAuthCert(encoded: any): AuthCertInterface {
        const buf = ParseUtil.ParseVariable("authCert must be hex-string or Buffer", encoded, "hex");
        const authCert = Decoder.DecodeAuthCert(buf);
        return authCert;
    }

    /**
     * @param arr array with hex encoded string properties;
     * [
     *  hexstring | Buffer,
     *  hexstring | Buffer
     * ]
     * @returns list of decoded node certs.
     * @throws if malconfigured or certs cannot be decoded.
     */
    public static ParseConfigNodeCerts(arr: any): PrimaryNodeCertInterface[] {
        const nodeCerts: PrimaryNodeCertInterface[] = [];
        const arr2 = ParseUtil.ParseVariable("nodeCerts must be hex[] or Buffer[], if set.", arr, "hex[]", true);
        (arr2 || []).forEach( (str: any) => {
            const buf = ParseUtil.ParseVariable("nodeCert must be hex-string or Buffer.", str, "hex");
            nodeCerts.push(Decoder.DecodeNodeCert(buf));
        });
        return nodeCerts;
    }

    /**
     * @param obj object with properties:
     * {
     *  permissions?: P2PClientPermissions,
     *  appPermissions?: P2PClientPermissions,
     *  driver?: DriverConfig,
     *  blobDriver?: DriverConfig,
     * }
     * @returns DatabaseConfig
     * @throws if malconfigured
     */
    public static ParseConfigDatabase(obj: any): DatabaseConfig {
        const permissions = ParseUtil.ParseP2PClientPermissions(obj.permissions ?? UNCHECKED_PERMISSIVE_PERMISSIONS);
        const appPermissions = ParseUtil.ParseP2PClientPermissions(obj.appPermissions ?? PERMISSIVE_PERMISSIONS);

        let driver: DriverConfig = {
            sqlite: ":memory:",
            reconnectDelay: 3,
        };

        let blobDriver: DriverConfig | undefined = {
            sqlite: ":memory:",
            reconnectDelay: 3,
        };

        if (obj.driver) {
            const sqlite = ParseUtil.ParseVariable("databaseConfig.driver.sqlite must be string, if set", obj.driver.sqlite, "string", true);
            const pg = ParseUtil.ParseVariable("databaseConfig.driver.pg must be string, if set", obj.driver.pg, "string", true);
            const reconnectDelay = ParseUtil.ParseVariable("databaseConfig.driver.reconnectDelay must be number, if set", obj.driver.reconnectDelay, "number", true);

            if (sqlite && pg) {
                throw new Error("databaseConfig.driver cannot have both 'sqlite' and 'pg' set");
            }

            if (!sqlite && !pg) {
                throw new Error("databaseConfig.driver must have either 'sqlite' or 'pg' set");
            }

            if (sqlite) {
                driver = {
                    sqlite,
                    reconnectDelay,
                };
            }
            else if (pg) {
                driver = {
                    pg,
                    reconnectDelay,
                };
            }
        }

        if (obj.blobDriver) {
            const sqlite = ParseUtil.ParseVariable("databaseConfig.blobDriver.sqlite must be string, if set", obj.blobDriver.sqlite, "string", true);
            const pg = ParseUtil.ParseVariable("databaseConfig.blobDriver.pg must be string, if set", obj.blobDriver.pg, "string", true);
            const reconnectDelay = ParseUtil.ParseVariable("databaseConfig.blobDriver.reconnectDelay must be number, if set", obj.blobDriver.reconnectDelay, "number", true);

            if (sqlite && pg) {
                throw new Error("databaseConfig.blobDriver cannot have both 'sqlite' and 'pg' set");
            }

            if (sqlite) {
                blobDriver = {
                    sqlite,
                    reconnectDelay,
                };
            }
            else if (pg) {
                blobDriver = {
                    pg,
                    reconnectDelay,
                };
            }
            else {
                blobDriver = undefined;
            }
        }

        const local: DatabaseConfig = {
            permissions,
            appPermissions,
            driver,
            blobDriver,
        };

        return local;
    }

    /**
     * @param obj object with properties:
     * {
     *  connection: HandshakeFactoryConfig,
     *  region?: string,
     *  jurisdiction?: string,
     *  permissions: P2PClientPermissions,
     *  serializeFormat?: number,
     * }
     * @returns ConnectionConfig
     * @throws if malconfigured
     */
    public static ParseConfigConnectionConfig(connectionConfig: any): ConnectionConfig {
        let authFactoryConfig;

        if (connectionConfig.connection?.factory === "api") {
            authFactoryConfig = ParseUtil.ParseAPIAuthFactory(connectionConfig.connection);
        }
        else if (connectionConfig.connection?.factory === "native" || !connectionConfig.connection?.factory) {
            authFactoryConfig = ParseUtil.ParseNativeAuthFactory(connectionConfig.connection);
        }
        else {
            throw new Error("Uknkown factory, use native or api");
        }

        let region: string | undefined;
        let jurisdiction: string | undefined;
        let serializeFormat: number = 0;

        if (connectionConfig !== undefined) {
            region = ParseUtil.ParseVariable("connectionConfig.region must be string, if set", connectionConfig.region, "string", true);
            jurisdiction = ParseUtil.ParseVariable("connectionConfig.jurisdiction must be string, if set", connectionConfig.jurisdiction, "string", true);
            serializeFormat = ParseUtil.ParseVariable("connectionConfig.serializeFormat must be number between 0 and 255, if set", connectionConfig.serializeFormat, "number", true) ?? 0;
        }

        if (connectionConfig.permissions === undefined) {
            throw new Error("permissions need to be set on connection config");
        }

        if (connectionConfig.serializeFormat < 0 || connectionConfig.serializeFormat > 255) {
            throw new Error("serializeFormat must be number between 0 and 255, if set");
        }

        const permissions = ParseUtil.ParseP2PClientPermissions(connectionConfig.permissions);

        return {
            authFactoryConfig,
            region,
            jurisdiction,
            permissions,
            serializeFormat,
        };
    }


    /**
     * {
     *  client: {
     *      auth: {
     *          method: string,
     *          config?: object,
     *      }
     *  },
     *  server: {
     *      auth: {
     *          methods: {
     *              method1: {config},
     *              method2: {config},
     *          },
     *      }
     *  },
     *  ...HandshakeFactoryConfig,
     * }
     */
    public static ParseAPIAuthFactory(obj: any): APIAuthFactoryConfig {
        const handshakeFactoryConfig = ParseUtil.ParseHandshakeFactory(obj);

        let clientAuth;
        let serverAuth;

        if (obj.client) {
            const method = ParseUtil.ParseVariable(
                "client.auth.method must be string",
                obj.client.auth?.method, "string");

            const config = ParseUtil.ParseVariable(
                "client.auth.config must be object, if set",
                obj.client.auth?.config, "object", true);

            clientAuth = {
                method,
                config,
            };
        }

        if (obj.server) {
            const methods = ParseUtil.ParseVariable(
                "server.auth.methods must be object",
                obj.server.auth?.methods, "object");

            serverAuth = {
                methods,
            };
        }

        return {
            factory: "api",
            clientAuth,
            serverAuth,
            ...handshakeFactoryConfig,
        };
    }

    /**
     * {
     *  ...HandshakeFactoryConfig,
     * }
     */
    public static ParseNativeAuthFactory(obj: any): NativeAuthFactoryConfig {
        const handshakeFactoryConfig = ParseUtil.ParseHandshakeFactory(obj);

        return {
            factory: "native",
            ...handshakeFactoryConfig,
        };
    }

    /**
     * @param obj object with the following properties:
     * {
     *  discriminator?: string,
     *  maxConnections?: number,
     *  maxConnectionsPerIp?: number,
     *  maxConnectionsPerClient?: number,
     *  maxConnectionsPerClientPair?: number,
     *  pingInterval?: number,
     *  client?: {
     *   socketType: "WebSocket" | "TCP",
     *   serverPublicKey: hexstring | Buffer,
     *   reconnectDelay?: number,
     *   host?: string,
     *   port: number,
     *   secure?: boolean,
     *   rejectUnauthorized?: boolean,
     *   cert?: string[],
     *   key?: string[],
     *   ca?: string[],
     *  },
     *  server?: {
     *   socketType: "WebSocket" | "TCP",
     *   allowedClients?: hexstring[] | Buffer[],
     *   deniedIPs?: string[],
     *   allowedIPs?: string[],
     *   host?: string,
     *   port: number,
     *   ipv6Only?: boolean,
     *   requestCert?: boolean,
     *   rejectUnauthorized?: boolean,
     *   cert?: string | string[],
     *   key?: string | string[],
     *   ca?: string | string[],
     *  }
     * }
     * @returns HandshakeFactoryConfig (template) which needs keyPair and peerData to be set before using.
     * @throws if malconfigured
     */
    public static ParseHandshakeFactory(obj: any): HandshakeFactoryConfig {
        const discriminator = Buffer.from(ParseUtil.ParseVariable("connection discriminator must be string, if set", obj.discriminator, "string", true) ?? "");

        const maxConnections = ParseUtil.ParseVariable("connection maxConnections must be number, if set", obj.maxConnections, "number", true);
        const maxConnectionsPerIp = ParseUtil.ParseVariable("connection maxConnectionsPerIp must be number, if set", obj.maxConnectionsPerIp, "number", true);
        const maxConnectionsPerClient = ParseUtil.ParseVariable("connection maxConnectionsPerClient must be number, if set", obj.maxConnectionsPerClient, "number", true);
        const maxConnectionsPerClientPair = ParseUtil.ParseVariable("connection maxConnectionsPerClientPair must be number, if set", obj.maxConnectionsPerClientPair, "number", true);
        const pingInterval = ParseUtil.ParseVariable("connection pingInterval must be number, if set", obj.pingInterval, "number", true);
        let client: SocketFactoryConfig["client"] | undefined;
        let server: SocketFactoryConfig["server"] | undefined;
        let serverPublicKey: Buffer | undefined;
        let allowedClients: Buffer[] | undefined;

        if (obj.client) {
            const socketType = ParseUtil.ParseVariable("connection client socketType must be string", obj.client.socketType, "string");
            if (socketType !== SOCKET_WEBSOCKET && socketType !== SOCKET_TCP) {
                throw new Error(`socketType must be "WebSocket" or "TCP"`);
            }
            serverPublicKey = ParseUtil.ParseVariable("connection client serverPublicKey must be hex-string or Buffer", obj.client.serverPublicKey, "hex");
            const reconnectDelay = ParseUtil.ParseVariable("connection client reconnectDelay must be string", obj.client.reconnectDelay, "number", true);
            const host = ParseUtil.ParseVariable("connection client host must be string, if set", obj.client.host, "string", true);
            const port = ParseUtil.ParseVariable("connection client port must be number", obj.client.port, "number");
            const secure = ParseUtil.ParseVariable("connection client secure must be boolean, if set", obj.client.secure, "boolean", true);
            const rejectUnauthorized = ParseUtil.ParseVariable("connection client rejectUnauthorized must be boolean, if set", obj.client.rejectUnauthorized, "boolean", true);
            const cert = ParseUtil.ParseVariable("connection client cert must be array of strings, if set", obj.client.cert, "string[]", true);
            const key = ParseUtil.ParseVariable("connection client key must be array of strings, if set", obj.client.key, "string[]", true);
            const ca = ParseUtil.ParseVariable("connection client ca must be array of strings, if set", obj.client.ca, "string[]", true);

            const clientOptions: ClientOptions = {
                host,
                port,
                secure,
                rejectUnauthorized,
                cert,
                key,
                ca,
                textMode: false,
            };
            client = {
                socketType,
                clientOptions,
                reconnectDelay,
            };
        }
        if (obj.server) {
            const socketType = ParseUtil.ParseVariable("connection server socketType must be string", obj.server.socketType, "string");
            if (socketType !== SOCKET_WEBSOCKET && socketType !== SOCKET_TCP) {
                throw new Error(`socketType must be "WebSocket" or "TCP"`);
            }
            allowedClients = ParseUtil.ParseVariable("connection server allowedClients must be hex-string[] or Buffer[], if set", obj.server.allowedClients, "hex[]", true);
            const deniedIPs = ParseUtil.ParseVariable("connection server deniedIPs must be string[], if set", obj.server.deniedIPs, "string[]", true);
            const allowedIPs = ParseUtil.ParseVariable("connection server allowedIPs must be string[], if set", obj.server.allowedIPs, "string[]", true);
            const host = ParseUtil.ParseVariable("connection server host must be string, if set", obj.server.host, "string", true);
            const port = ParseUtil.ParseVariable("connection server port must be number", obj.server.port, "number");
            const ipv6Only = ParseUtil.ParseVariable("connection server ipv6Only must be boolean, if set", obj.server.ipv6Only, "boolean", true);
            const requestCert = ParseUtil.ParseVariable("connection server requestCert must be boolean, if set", obj.server.requestCert, "boolean", true);
            const rejectUnauthorized = ParseUtil.ParseVariable("connection server rejectUnauthorized must be boolean, if set", obj.server.rejectUnauthorized, "boolean", true);
            const cert = ParseUtil.ParseVariable("connection server cert must be string[], if set", obj.server.cert, "string[]", true);
            const key = ParseUtil.ParseVariable("connection server key must be string[], if set", obj.server.key, "string[]", true);
            const ca = ParseUtil.ParseVariable("connection server ca must be string[], if set", obj.server.ca, "string[]", true);

            const serverOptions: ServerOptions = {
                host,
                port,
                ipv6Only,
                requestCert,
                rejectUnauthorized,
                cert,
                key,
                ca,
                textMode: false,
            };
            server = {
                socketType,
                serverOptions,
                deniedIPs,
                allowedIPs,
            };
        }

        const socketFactoryConfig: SocketFactoryConfig = {
            client,
            server,
            maxConnections,
            maxConnectionsPerIp,
        };
        const template: HandshakeFactoryConfig = {
            keyPair: {
                publicKey: Buffer.alloc(0),
                secretKey: Buffer.alloc(0),
            },
            discriminator,
            socketFactoryConfig,
            serverPublicKey,
            allowedClients,
            maxConnectionsPerClient,
            maxConnectionsPerClientPair,
            pingInterval,
        };
        return template;
    }

    /**
     * @param permissions object of type:
     * {
     *  fetchPermissions?: P2PClientFetchPermissions,
     *  storePermissions?: P2PClientStorePermissions,
     *  allowUncheckedAccess: boolean,
     * }
     *
     * @returns by default a locked down permissions object.
     */
    public static ParseP2PClientPermissions(permissions: any): P2PClientPermissions {
        let fetchPermissions: P2PClientFetchPermissions = {
            allowNodeTypes: [],
            allowIncludeLicenses: 0,
            allowTrigger: false,
            allowEmbed: [],
            allowAlgos: [],
            allowReadBlob: false,
        };

        let storePermissions = {
            allowStore: false,
            allowWriteBlob: false,
        };

        if (permissions.fetchPermissions) {
            fetchPermissions = ParseUtil.ParseP2PClientFetchPermissions(permissions.fetchPermissions);
        }

        if (permissions.storePermissions) {
            storePermissions = ParseUtil.ParseP2PClientStorePermissions(permissions.storePermissions);
        }

        const allowUncheckedAccess = ParseUtil.ParseVariable("permissions allowUncheckedAccess must be boolean, if set", permissions.allowUncheckedAccess, "boolean", true) ?? false;

        return {
            allowUncheckedAccess,
            fetchPermissions,
            storePermissions,
        }
    }

    /**
     * @param permissions object of type:
     * {
     *  allowStore?: boolean,
     *  allowWriteBlob?: boolean,
     * }
     * @returns P2PClientStorePermissions object
     * @throws if malconfigured
     */
    public static ParseP2PClientStorePermissions(permissions: any): P2PClientStorePermissions {
        const allowStore = ParseUtil.ParseVariable("permissions allowStore must be boolean, if set", permissions.allowStore, "boolean", true) ?? false;
        const allowWriteBlob = ParseUtil.ParseVariable("permissions allowWriteBlob must be boolean, if set", permissions.allowWriteBlob, "boolean", true) ?? false;

        return {
            allowStore,
            allowWriteBlob,
        }
    }

    /**
     * @param permissions object of type:
     * {
     *  allowEmbed: {nodeType: alias | hexstring | Buffer, filters: Filter[]}[],
     *  allowIncludeLicenses?: number,
     *  allowTrigger: boolean,
     *  allowNodeTypes: hexstring[] | Buffer[],
     *  allowAlgos: number[],
     *  allowReadBlob?: boolean,
     * }
     * @returns P2PClientFetchPermissions object
     * @throws if malconfigured
     */
    public static ParseP2PClientFetchPermissions(permissions: any): P2PClientFetchPermissions {
        const allowEmbed0 = ParseUtil.ParseVariable("permissions allowEmbed must be object[], if set", permissions.allowEmbed, "object[]", true);
        let allowEmbed: AllowEmbed[] = [];

        if (allowEmbed0) {
            allowEmbed = allowEmbed0.map( (allowEmbedObj: AllowEmbed) => {
                const nodeType = ParseUtil.ParseNodeType("permissions allowEmbed[index] nodeType must be alias | hex-string or Buffer", allowEmbedObj.nodeType);

                let filters: Filter[] = [];
                const filters0 = ParseUtil.ParseVariable("permissions allowEmbed[index] filters must be Filter[], if set", allowEmbedObj.filters, "object[]", true);
                if (filters0) {
                    filters = ParseUtil.ParseFilters(filters0);
                }
                return {
                    nodeType,
                    filters,
                };
            });
        }

        const allowIncludeLicenses = ParseUtil.ParseVariable("permissions allowIncludeLicenses must be number, if set", permissions.allowIncludeLicenses, "number", true) ?? 0;
        const allowTrigger = ParseUtil.ParseVariable("permissions allowTrigger must be boolean, if set", permissions.allowTrigger, "boolean", true) ?? false;
        const allowAlgos = ParseUtil.ParseVariable("permissions allowAlgos must be number[], if set", permissions.allowAlgos, "number[]", true) ?? [];
        const allowNodeTypes: Buffer[] = ParseUtil.ParseVariable("permissions allowNodeTypes must be hex-string[] or Buffer[]", permissions.allowNodeTypes, "hex[]");

        const allowReadBlob = ParseUtil.ParseVariable("permissions allowReadBlob must be boolean, if set", permissions.allowReadBlob, "boolean", true) ?? false;

        return {
            allowEmbed,
            allowIncludeLicenses,
            allowTrigger,
            allowNodeTypes,
            allowAlgos,
            allowReadBlob,
        };
    }

    /**
     * Stringify request/response into JSON.
     * Variable length binary fields are encoded as Base64,
     * other binary fields are encoded as hex.
     */
    public static StringifyRequestType(obj: any): string {
        if (typeof(obj) !== "object" || obj.constructor !== Object) {
            throw new Error("Could not stringify request/response");
        }

        // FetchResult
        if (obj.result?.nodes) {
            obj.result.nodes = obj.result.nodes.map( (buf: Buffer) => buf.toString("base64") );
        }

        if (obj.result?.embed) {
            obj.result.embed = obj.result.embed.map( (buf: Buffer) => buf.toString("base64") );
        }

        // CRDTResult
        if (obj.crdtResult?.delta) {
            obj.crdtResult.delta = obj.crdtResult.delta.toString("base64");
        }

        // StoreRequest
        if (obj.nodes) {
            obj.nodes = obj.nodes.map( (buf: Buffer) => buf.toString("base64") );
        }

        // WriteBlobRequest
        // ReadblobResponse
        // GenericMessageRequest
        // GenericMessageResponse
        //
        if (obj.data) {
            obj.data = obj.data.toString("base64");
        }

        return JSON.stringify(StripObject(obj));
    }

    /**
     * Parse JSON.
     * Detect request/response data type and parse it.
     * Variable length binary fields are decoded as base64,
     * other binary fields are decoded as hex.
     *
     * @returns parsed object
     * @throws
     */
    public static ParseRequestType(body: string): FetchRequest | FetchResponse | StoreRequest |
        StoreResponse | UnsubscribeRequest | UnsubscribeResponse | WriteBlobRequest |
        WriteBlobResponse | ReadBlobRequest | ReadBlobResponse | GenericMessageResponse |
        GenericMessageRequest
    {
        const obj = JSON.parse(body);

        if (typeof(obj) !== "object" || obj.constructor !== Object) {
            throw new Error("Could not parse request/response type");
        }

        if (obj.query) {
            return ParseUtil.ParseFetchRequest(obj);
        }
        else if (obj.result) {
            return ParseUtil.ParseFetchResponse(obj);
        }
        else if (obj.nodes) {
            return ParseUtil.ParseStoreRequest(obj);
        }
        else if (obj.storedId1s) {
            return ParseUtil.ParseStoreResponse(obj);
        }
        else if (obj.originalMsgId) {
            return ParseUtil.ParseUnsubscribeRequest(obj);
        }
        else if (obj.nodeId1 && obj.data) {
            return ParseUtil.ParseWriteBlobRequest(obj);
        }
        else if (obj.currentLength !== undefined) {
            return ParseUtil.ParseWriteBlobResponse(obj);
        }
        else if (obj.nodeId1 && obj.length!== undefined) {
            return ParseUtil.ParseReadBlobRequest(obj);
        }
        else if (obj.blobLength !== undefined) {
            return ParseUtil.ParseReadBlobResponse(obj);
        }
        else if (obj.action !== undefined) {
            return ParseUtil.ParseGenericMessageRequest(obj);
        }
        else if (obj.status !== undefined && obj.data !== undefined) {
            return ParseUtil.ParseGenericMessageResponse(obj);
        }
        else if (obj.status !== undefined && obj.error !== undefined) {
            return ParseUtil.ParseUnsubscribeResponse(obj);
        }

        throw new Error("Could not parse request/response type");
    }

    protected static ParseFetchRequest(obj: any): FetchRequest {
        if (typeof obj !== "object" || obj.constructor !== Object) {
            throw new Error("Expecting fetch request to be object.");
        }

        const query = ParseUtil.ParseQuery(obj.query);

        const crdt = ParseUtil.ParseCRDT(obj.crdt ?? {});

        return {
            query,
            crdt,
        };
    }

    protected static ParseFetchResponse(obj: any): FetchResponse {
        if (typeof obj !== "object" || obj.constructor !== Object) {
            throw new Error("Expecting fetch response to be object.");
        }

        const status = ParseUtil.ParseVariable("fetchResponse status must be number",
            obj.status, "number") as number;

        const result = ParseUtil.ParseFetchResult(obj.result ?? {});

        const crdtResult = ParseUtil.ParseCRDTResult(obj.crdtResult ?? {});

        const seq = ParseUtil.ParseVariable("fetchResponse seq must be number, if set",
            obj.seq, "number", true) ?? 1;

        const endSeq = ParseUtil.ParseVariable("fetchResponse endSeq must be number, if set",
            obj.endSeq, "number", true) ?? 0;

        const error = ParseUtil.ParseVariable("fetchResponse error must be string, if set",
            obj.error, "string", true) ?? "";

        const rowCount = ParseUtil.ParseVariable("fetchResponse rowCount must be number, if set",
            obj.rowCount, "number", true) ?? 0;

        return {
            status,
            result,
            crdtResult,
            seq,
            endSeq,
            error,
            rowCount,
        };
    }

    protected static ParseFetchResult(obj: any): FetchResult {
        if (typeof obj !== "object" || obj.constructor !== Object) {
            throw new Error("Expecting fetch result to be object.");
        }

        const nodes = ParseUtil.ParseVariable(
            "fetchResult nodes must be array of base64 or Buffer, if set",
            obj.nodes, "base64[]", true) ?? [];

        const embed = ParseUtil.ParseVariable(
            "fetchResult embed must be array of base64 or Buffer, if set",
            obj.embed, "base64[]", true) ?? [];

        const cutoffTime = ParseUtil.ParseVariable(
            "fetchResult cutoffTime must be number or bigint as string, if set",
            obj.cutoffTime, "bigint", true) ?? 0n;

        return {
            nodes,
            embed,
            cutoffTime,
        };
    }

    protected static ParseCRDTResult(obj: any): CRDTResult {
        if (typeof obj !== "object" || obj.constructor !== Object) {
            throw new Error("Expecting crdtResult to be object.");
        }

        const delta = ParseUtil.ParseVariable("crdtResult delta must be base64 or Buffer, if set",
            obj.delta, "base64", true) ?? Buffer.alloc(0);

        const cursorIndex = ParseUtil.ParseVariable("crdtResult cursorIndex must be number, if set",
            obj.cursorIndex, "number", true) ?? 0;

        const length = ParseUtil.ParseVariable("crdtResult length must be number, if set",
            obj.length, "number", true) ?? 0;

        return {
            delta,
            cursorIndex,
            length,
        };
    }

    protected static ParseStoreRequest(obj: any): StoreRequest {
        if (typeof obj !== "object" || obj.constructor !== Object) {
            throw new Error("Expecting storeRequest to be object.");
        }

        const nodes = ParseUtil.ParseVariable(
            "storeRequest nodes must be array of base64 or Buffer, if set",
            obj.nodes, "base64[]", true) ?? [];

        const sourcePublicKey = ParseUtil.ParseVariable(
            "storeRequest sourcePublicKey must be hex-string or Buffer, if set",
            obj.sourcePublicKey, "hex", true) ?? Buffer.alloc(0);

        const targetPublicKey = ParseUtil.ParseVariable(
            "storeRequest targetPublicKey must be hex-string or Buffer, if set",
            obj.targetPublicKey, "hex", true) ?? Buffer.alloc(0);

        const muteMsgIds = ParseUtil.ParseVariable(
            "storeRequest muteMsgIds must be array of hex-string or Buffer, if set",
            obj.muteMsgIds, "hex[]", true) ?? [];

        const preserveTransient = ParseUtil.ParseVariable(
            "storeResponse preserveTransient must be boolean, if set",
            obj.preserveTransient, "boolean", true) ?? false;

        const batchId = ParseUtil.ParseVariable(
            "storeResponse batchId must be number, if set",
            obj.batchId, "number", true) ?? 0;

        const hasMore = ParseUtil.ParseVariable(
            "storeResponse hasMore must be boolean, if set",
            obj.hasMore, "boolean", true) ?? false;

        return {
            nodes,
            sourcePublicKey,
            targetPublicKey,
            muteMsgIds,
            preserveTransient,
            batchId,
            hasMore,
        };
    }

    protected static ParseStoreResponse(obj: any): StoreResponse {
        if (typeof obj !== "object" || obj.constructor !== Object) {
            throw new Error("Expecting storeResponse to be object.");
        }

        const status = ParseUtil.ParseVariable(
            "storeResponse status must be number",
            obj.status, "number") as number;

        const storedId1s = ParseUtil.ParseVariable(
            "storeResponse storedId1s must be array of hex-string or Buffer, if set",
            obj.storedId1s, "hex[]", true) ?? [];

        const missingBlobId1s = ParseUtil.ParseVariable(
            "storeResponse missingBlobId1s must be array of hex-string or Buffer, if set",
            obj.missingBlobId1s, "hex[]", true) ?? [];

        const missingBlobSizes = ParseUtil.ParseVariable(
            "storeResponse missingBlobSizes must be array of numbers or bigints as strings, if set",
            obj.missingBlobSizes, "bigint[]", true) ?? [];

        const error = ParseUtil.ParseVariable("storeResponse error must be string, if set",
            obj.error, "string", true) ?? "";

        return {
            status,
            storedId1s,
            missingBlobId1s,
            missingBlobSizes,
            error,
        };
    }

    protected static ParseUnsubscribeRequest(obj: any): UnsubscribeRequest {
        if (typeof obj !== "object" || obj.constructor !== Object) {
            throw new Error("Expecting unsubscribeRequest to be object.");
        }

        const originalMsgId = ParseUtil.ParseVariable(
            "unsubscribeRequest originalMsgId must be hex-string or Buffer",
            obj.originalMsgId, "hex");

        const targetPublicKey = ParseUtil.ParseVariable(
            "unsubscribeRequest targetPublicKey must be hex-string or Buffer, if set",
            obj.targetPublicKey, "hex", true) ?? Buffer.alloc(0);

        return {
            originalMsgId,
            targetPublicKey,
        };
    }

    protected static ParseUnsubscribeResponse(obj: any): UnsubscribeResponse {
        if (typeof obj !== "object" || obj.constructor !== Object) {
            throw new Error("Expecting unsubscribeResponse to be object.");
        }

        const status = ParseUtil.ParseVariable(
            "unsubscribeResponse status must be number",
            obj.status, "number") as number;

        const error = ParseUtil.ParseVariable(
            "unsubscribeResponse error must be string, if set",
            obj.error, "string", true) ?? "";

        return {
            status,
            error,
        };
    }

    protected static ParseWriteBlobRequest(obj: any): WriteBlobRequest {
        if (typeof obj !== "object" || obj.constructor !== Object) {
            throw new Error("Expecting writeBlobRequest to be object.");
        }

        const nodeId1 = ParseUtil.ParseVariable(
            "unsubscribeRequest nodeId1 must be hex-string or Buffer",
            obj.nodeId1, "hex");

        const pos = ParseUtil.ParseVariable(
            "unsubscribeRequest pos must be number or bigint as string",
            obj.pos, "bigint");

        const data = ParseUtil.ParseVariable(
            "unsubscribeRequest data must be base64 or Buffer",
            obj.data, "base64");

        const sourcePublicKey = ParseUtil.ParseVariable(
            "unsubscribeRequest sourcePublicKey must be hex-string or Buffer, if set",
            obj.sourcePublicKey, "hex", true) ?? Buffer.alloc(0);

        const targetPublicKey = ParseUtil.ParseVariable(
            "unsubscribeRequest targetPublicKey must be hex-string or Buffer, if set",
            obj.targetPublicKey, "hex", true) ?? Buffer.alloc(0);

        const muteMsgIds = ParseUtil.ParseVariable(
            "writeBlobRequest muteMsgIds must be array of hex-string or Buffer, if set",
            obj.muteMsgIds, "hex[]", true) ?? [];

        return {
            nodeId1,
            pos,
            data,
            sourcePublicKey,
            targetPublicKey,
            muteMsgIds,
        };
    }

    protected static ParseWriteBlobResponse(obj: any): WriteBlobResponse {
        if (typeof obj !== "object" || obj.constructor !== Object) {
            throw new Error("Expecting writeBlobResponse to be object.");
        }

        const status = ParseUtil.ParseVariable(
            "writeBlobResponse status must be number",
            obj.status, "number") as number;

        const currentLength = ParseUtil.ParseVariable(
            "writeBlobResponse currentLength must be number or bigint as string",
            obj.currentLength, "bigint");

        const error = ParseUtil.ParseVariable(
            "writeBlobResponse error must be string, if set",
            obj.error, "string", true) ?? "";

        return {
            status,
            currentLength,
            error,
        };
    }

    protected static ParseReadBlobRequest(obj: any): ReadBlobRequest {
        if (typeof obj !== "object" || obj.constructor !== Object) {
            throw new Error("Expecting readBlobRequest to be object.");
        }

        const nodeId1 = ParseUtil.ParseVariable(
            "readBlobRequest nodeId1 must be hex-string or Buffer",
            obj.nodeId1, "hex");

        const pos = ParseUtil.ParseVariable(
            "readBlobRequest pos must be number or bigint as string",
            obj.pos, "bigint");

        const length = ParseUtil.ParseVariable(
            "readBlobRequest length must be number",
            obj.length, "number");

        const targetPublicKey = ParseUtil.ParseVariable(
            "readBlobRequest targetPublicKey must be hex-string or Buffer, if set",
            obj.targetPublicKey, "hex", true) ?? Buffer.alloc(0);

        const sourcePublicKey = ParseUtil.ParseVariable(
            "readBlobRequest sourcePublicKey must be hex-string or Buffer, if set",
            obj.sourcePublicKey, "hex", true) ?? Buffer.alloc(0);

        return {
            nodeId1,
            pos,
            length,
            targetPublicKey,
            sourcePublicKey,
        };
    }

    protected static ParseReadBlobResponse(obj: any): ReadBlobResponse {
        if (typeof obj !== "object" || obj.constructor !== Object) {
            throw new Error("Expecting readBlobResponse to be object.");
        }

        const status = ParseUtil.ParseVariable(
            "readBlobResponse status must be number",
            obj.status, "number") as number;

        const data = ParseUtil.ParseVariable(
            "readBlobResponse data must be base64 or Buffer",
            obj.data, "base64");

        const seq = ParseUtil.ParseVariable(
            "readBlobResponse seq must be number, if set",
            obj.seq, "number", true) ?? 1;

        const endSeq = ParseUtil.ParseVariable(
            "readBlobResponse endSeq must be number, if set",
            obj.endSeq, "number", true) ?? 0;

        const blobLength = ParseUtil.ParseVariable(
            "readBlobResponse blobLength must be number or bigint as string",
            obj.blobLength, "bigint");

        const error = ParseUtil.ParseVariable(
            "readBlobResponse error must be string, if set",
            obj.error, "string", true) ?? "";

        return {
            status,
            data,
            seq,
            endSeq,
            blobLength,
            error,
        };
    }

    protected static ParseGenericMessageRequest(obj: any): GenericMessageRequest {
        if (typeof obj !== "object" || obj.constructor !== Object) {
            throw new Error("Expecting genericMessageRequest to be object.");
        }

        const action = ParseUtil.ParseVariable(
            "genericMessageRequest action must be string",
            obj.action, "string");

        const sourcePublicKey = ParseUtil.ParseVariable(
            "genericMessageRequest sourcePublicKey must be hex-string or Buffer, if set",
            obj.sourcePublicKey, "hex", true) ?? Buffer.alloc(0);

        const data = ParseUtil.ParseVariable(
            "genericMessageRequest data must be base64 or Buffer, if set",
            obj.data, "base64", true) ?? Buffer.alloc(0);

        return {
            action,
            sourcePublicKey,
            data,
        };
    }

    protected static ParseGenericMessageResponse(obj: any): GenericMessageResponse {
        if (typeof obj !== "object" || obj.constructor !== Object) {
            throw new Error("Expecting genericMessageResponse to be object.");
        }

        const status = ParseUtil.ParseVariable(
            "genericMessageResponse status must be number",
            obj.status, "number") as number;

        const data = ParseUtil.ParseVariable(
            "genericMessageResponse data must be base64 or Buffer, if set",
            obj.data, "base64", true) ?? Buffer.alloc(0);

        const error = ParseUtil.ParseVariable(
            "genericMessageResponse error must be string, if set",
            obj.error, "string", true) ?? "";

        return {
            status,
            data,
            error,
        };
    }

    /**
     * Parse Query.
     *
     * Note that parentId and rootNodeId1 are mutually exclusive and one is required to be present for
     * a query to run, this is not however enforced in parsing since other parameters might be
     * added later onto query objects and the data is enforced at a later point.
     *
     * @param query as:
     * {
     *  onlyTrigger?: boolean,
     *  triggerNodeId?: hexstring | Buffer,
     *  triggerInterval?: number,
     *  match?: Match[],
     *  depth?: number,
     *  limit?: number,
     *  cutoffTime?: bigint,
     *  rootNodeId1?: hexstring | Buffer,
     *  parentId?: hexstring | Buffer,
     *  descending?: boolean,
     *  orderByStorageTime?: boolean,
     *  discardRoot?: boolean,
     *  preserveTransient?: boolean,
     *  ignoreOwn?: boolean,
     *  ignoreInactive?: boolean,
     *  targetPublicKey?: hexstring | Buffer,
     *  sourcePublicKey?: hexstring | Buffer,
     *  embed: {nodeType: alias | hexstring | Buffer, filters: Filter[]}[],
     *  region?: string,
     *  jurisdiction?: string,
     *  includeLicenses?: number,
     * }
     * @returns FetchQuery
     * @throws on unparseable data
     */
    public static ParseQuery(query: any): FetchQuery {
        if (typeof query !== "object" || query.constructor !== Object) {
            throw new Error("Expecting query to be object.");
        }

        const onlyTrigger = ParseUtil.ParseVariable("query onlyTrigger must be boolean, if set", query.onlyTrigger, "boolean", true) ?? false;
        const triggerNodeId = ParseUtil.ParseVariable("query triggerNodeId must be hex-string or Buffer, if set", query.triggerNodeId, "hex", true) ?? Buffer.alloc(0);
        const triggerInterval = ParseUtil.ParseVariable("query interval must be number, if set", query.triggerInterval, "number", true) ?? 0;
        const match = ParseUtil.ParseMatch(ParseUtil.ParseVariable("query match must be object[], if set", query.match, "object[]", true) ?? []);
        const depth = ParseUtil.ParseVariable("query depth must be number, if set", query.depth, "number", true) ?? -1;
        const limit = ParseUtil.ParseVariable("query limit must be number, if set", query.limit, "number", true) ?? -1;
        const cutoffTime = ParseUtil.ParseVariable("query cutoffTime must be number or bigint as string, if set", query.cutoffTime, "bigint", true) ?? 0n;
        const rootNodeId1 = ParseUtil.ParseVariable("query rootNodeId1 must be hex-string or Buffer, if set", query.rootNodeId1, "hex", true) ?? Buffer.alloc(0);
        const parentId = ParseUtil.ParseVariable("query parentId must be hex-string or Buffer, if set", query.parentId, "hex", true) ?? Buffer.alloc(0);
        const descending = ParseUtil.ParseVariable("query descending must be boolean, if set", query.descending, "boolean", true) ?? false;
        const orderByStorageTime = ParseUtil.ParseVariable("query orderByStorageTime must be boolean, if set", query.orderByStorageTime, "boolean", true) ?? false;
        const discardRoot = ParseUtil.ParseVariable("query discardRoot must be boolean, if set", query.discardRoot, "boolean", true) ?? false;
        const preserveTransient = ParseUtil.ParseVariable("query preserveTransient must be boolean, if set", query.preserveTransient, "boolean", true) ?? false;
        const ignoreOwn = ParseUtil.ParseVariable("query ignoreOwn must be boolean, if set", query.ignoreOwn, "boolean", true) ?? false;
        const ignoreInactive = ParseUtil.ParseVariable("query ignoreInactive must be boolean, if set", query.ignoreInactive, "boolean", true) ?? false;
        const targetPublicKey = ParseUtil.ParseVariable("query targetPublicKey must be hex-string or Buffer, if set", query.targetPublicKey, "hex", true) ?? Buffer.alloc(0);
        const sourcePublicKey = ParseUtil.ParseVariable("query sourcePublicKey must be hex-string or Buffer, if set", query.sourcePublicKey, "hex", true) ?? Buffer.alloc(0);
        const region = ParseUtil.ParseVariable("query region must be string, if set", query.region, "string", true) ?? "";
        const jurisdiction = ParseUtil.ParseVariable("query jurisdiction must be string, if set", query.jurisdiction, "string", true) ?? "";
        const includeLicenses = ParseUtil.ParseVariable("query includeLicenses must be number, if set", query.includeLicenses, "number", true) ?? 0;

        let embed: AllowEmbed[] = [];

        const allowEmbed0 = ParseUtil.ParseVariable("query embed must be object[], if set", query.embed, "object[]", true);

        if (allowEmbed0) {
            embed = allowEmbed0.map( (allowEmbedObj: AllowEmbed) => {
                const nodeType = ParseUtil.ParseNodeType("query embed[index] nodeType must be alias, hex-string or Buffer", allowEmbedObj.nodeType);

                let filters: Filter[] = [];
                const filters0 = ParseUtil.ParseVariable("query embed[index] filters must be Filter[], if set", allowEmbedObj.filters, "object[]", true);
                if (filters0) {
                    filters = ParseUtil.ParseFilters(filters0);
                }
                return {
                    nodeType,
                    filters,
                };
            });
        }

        const query2: FetchQuery = {
            triggerNodeId,
            onlyTrigger,
            triggerInterval,
            match,
            depth,
            limit,
            cutoffTime,
            rootNodeId1,
            parentId,
            descending,
            orderByStorageTime,
            discardRoot,
            preserveTransient,
            ignoreOwn,
            ignoreInactive,
            embed,
            targetPublicKey,
            sourcePublicKey,
            region,
            jurisdiction,
            includeLicenses,
        };

        return query2;
    }

    /**
     * @param crdt as:
     * {
     *  algo: number,
     *  conf?: JSONObject | string,
     *  reverse?: boolean,
     *  cursorId1?: hexstring | Buffer,
     *  cursorIndex?: number,
     *  head?: number,
     *  tail?: number,
     *  msgId?: hexstring | Buffer,
     *
     * }
     * @returns FetchCRDT
     * @throws on unparseable data
     */
    public static ParseCRDT(crdt: any): FetchCRDT {
        if (typeof crdt !== "object" || crdt.constructor !== Object) {
            throw new Error("Expecting crdt to be object.");
        }

        const msgId = ParseUtil.ParseVariable("crdt msgId must be hex-string or Buffer, if set", crdt.msgId, "hex", true) ?? Buffer.alloc(0);
        const algo = ParseUtil.ParseVariable("crdt algo must be number, if set", crdt.algo, "number", true) ?? 0;

        let conf: string = "";

        if (typeof(crdt.conf) === "string") {
            conf = crdt.conf;
        }
        else if (crdt.conf) {
            conf = JSON.stringify(ParseUtil.ParseVariable("crdt conf must be object, if set", crdt.conf, "object"));
        }

        const head = ParseUtil.ParseVariable("crdt head must be number, if set", crdt.head, "number", true) ?? 0;
        const tail = ParseUtil.ParseVariable("crdt tail must be number, if set", crdt.tail, "number", true) ?? 0;
        const reverse = ParseUtil.ParseVariable("crdt reverse must be boolean, if set", crdt.reverse, "boolean", true) ?? false;
        const cursorId1 = ParseUtil.ParseVariable("crdt cursorId1 must be hex-string or Buffer, if set", crdt.cursorId1, "hex", true) ?? Buffer.alloc(0);
        const cursorIndex = ParseUtil.ParseVariable("crdt cursorIndex must be number, if set", crdt.cursorIndex, "number", true) ?? -1;

        return {
            algo,
            conf,
            reverse,
            cursorId1,
            cursorIndex,
            head,
            tail,
            msgId,
        };
    }

    /**
     * @param crdt as:
     * {
     *  reverse?: boolean,
     *  cursorId1?: hexstring | Buffer,
     *  cursorIndex?: number,
     *  head?: number,
     *  tail?: number,
     *
     * }
     * @returns ThreadCRDTParams
     * @throws on unparseable data
     */
    public static ParseThreadCRDTParams(crdt: any): ThreadCRDTParams {
        if (typeof crdt !== "object" || crdt.constructor !== Object) {
            throw new Error("Expecting crdt to be object.");
        }

        const head = ParseUtil.ParseVariable("crdt head must be number, if set", crdt.head, "number", true) ?? 0;
        const tail = ParseUtil.ParseVariable("crdt tail must be number, if set", crdt.tail, "number", true) ?? 0;
        const reverse = ParseUtil.ParseVariable("crdt reverse must be boolean, if set", crdt.reverse, "boolean", true) ?? false;
        const cursorId1 = ParseUtil.ParseVariable("crdt cursorId1 must be hex-string or Buffer, if set", crdt.cursorId1, "hex", true) ?? Buffer.alloc(0);
        const cursorIndex = ParseUtil.ParseVariable("crdt cursorIndex must be number, if set", crdt.cursorIndex, "number", true) ?? -1;

        return {
            reverse,
            cursorId1,
            cursorIndex,
            head,
            tail,
        };
    }

    /**
     * @param ThreadQueryParams as:
     * {
     *  depth?: number,
     *  limit?: number,
     *  cutoffTime?: bigint,
     *  rootNodeId1?: hexstring | Buffer,
     *  parentId?: hexstring | Buffer,
     *  descending?: boolean,
     *  orderByStorageTime?: boolean,
     *  discardRoot?: boolean,
     *  preserveTransient?: boolean,
     *  ignoreOwn?: boolean,
     *  ignoreInactive?: boolean,
     *  region?: string,
     *  jurisdiction?: string,
     *  includeLicenses?: number,
     * }
     * @returns FetchQuery
     * @throws on unparseable data
     */
    public static ParseThreadQueryParams(query: any): ThreadQueryParams {
        if (typeof query !== "object" || query.constructor !== Object) {
            throw new Error("Expecting query to be object.");
        }

        const depth = ParseUtil.ParseVariable("query depth must be number, if set", query.depth, "number", true) ?? -1;
        const limit = ParseUtil.ParseVariable("query limit must be number, if set", query.limit, "number", true) ?? -1;
        const cutoffTime = ParseUtil.ParseVariable("query cutoffTime must be number or bigint as string, if set", query.cutoffTime, "bigint", true) ?? 0n;
        const rootNodeId1 = ParseUtil.ParseVariable("query rootNodeId1 must be hex-string or Buffer, if set", query.rootNodeId1, "hex", true) ?? Buffer.alloc(0);
        const parentId = ParseUtil.ParseVariable("query parentId must be hex-string or Buffer, if set", query.parentId, "hex", true) ?? Buffer.alloc(0);
        const descending = ParseUtil.ParseVariable("query descending must be boolean, if set", query.descending, "boolean", true) ?? false;
        const orderByStorageTime = ParseUtil.ParseVariable("query orderByStorageTime must be boolean, if set", query.orderByStorageTime, "boolean", true) ?? false;
        const discardRoot = ParseUtil.ParseVariable("query discardRoot must be boolean, if set", query.discardRoot, "boolean", true) ?? false;
        const preserveTransient = ParseUtil.ParseVariable("query preserveTransient must be boolean, if set", query.preserveTransient, "boolean", true) ?? false;
        const ignoreOwn = ParseUtil.ParseVariable("query ignoreOwn must be boolean, if set", query.ignoreOwn, "boolean", true) ?? false;
        const ignoreInactive = ParseUtil.ParseVariable("query ignoreInactive must be boolean, if set", query.ignoreInactive, "boolean", true) ?? false;
        const region = ParseUtil.ParseVariable("query region must be string, if set", query.region, "string", true) ?? "";
        const jurisdiction = ParseUtil.ParseVariable("query jurisdiction must be string, if set", query.jurisdiction, "string", true) ?? "";
        const includeLicenses = ParseUtil.ParseVariable("query includeLicenses must be number, if set", query.includeLicenses, "number", true) ?? 0;

        const query2: ThreadQueryParams = {
            depth,
            limit,
            cutoffTime,
            rootNodeId1,
            parentId,
            descending,
            orderByStorageTime,
            discardRoot,
            preserveTransient,
            ignoreOwn,
            ignoreInactive,
            region,
            jurisdiction,
            includeLicenses,
        };

        return query2;
    }

    public static ParseThreadFetchParams(fetch: any): ThreadFetchParams {
        if (typeof fetch !== "object" || fetch.constructor !== Object) {
            throw new Error("Expecting fetch to be object.");
        }

        const query = fetch.query ? ParseUtil.ParseThreadQueryParams(fetch.query) : undefined;
        const crdt = fetch.crdt ? ParseUtil.ParseThreadCRDTParams(fetch.crdt) : undefined;

        return {
            query,
            crdt,
        };
    }

    /**
     * Parse array of Match objects.
     * @param supposed Match[] as:
     * [
     *  {
     *   nodeType: alias | hexstring | Buffer,
     *   filters?: Filter[],
     *   limit?: number,
     *   limitField?: LimitField,
     *   level?: number[],
     *   discard?: boolean,
     *   bottom?: boolean,
     *   id?: number,
     *   requireId?: number,
     *   cursorId1?: hexstring | Buffer,
     *  }
     * ]
     * @returns Match[]
     * @throws on unparseable data
     */
    public static ParseMatch(matches: any[]): Match[] {
        return matches.map( (match: Match) => {
            const nodeType = ParseUtil.ParseNodeType("match nodeType must be alias | hex-string or Buffer, if set", match.nodeType ?? DATA0_NODE_TYPE);

            let filters: Filter[] = [];
            const filters0 = ParseUtil.ParseVariable("match filters must be Filter[], if set", match.filters, "object[]", true);
            if (filters0) {
                filters = ParseUtil.ParseFilters(filters0);
            }
            const limit = ParseUtil.ParseVariable("match limit must be number, if set", match.limit, "number", true) ?? -1;
            const limitField: LimitField = {
                name: "",
                limit: 0,
            };
            const limitField0 = ParseUtil.ParseVariable("match limitField must be object, if set", match.limitField, "object", true);
            if (limitField0) {
                limitField.name = ParseUtil.ParseVariable("match limitField name must be string", limitField0.name, "string");
                limitField.limit = ParseUtil.ParseVariable("match limitField limit must be number", limitField0.limit, "number");
            }
            const level = ParseUtil.ParseVariable("match level must be number[], if set", match.level, "number[]", true) ?? [];
            const discard = ParseUtil.ParseVariable("match discard must be boolean, if set", match.discard, "boolean", true) ?? false;
            const bottom = ParseUtil.ParseVariable("match bottom must be boolean, if set", match.bottom, "boolean", true) ?? false;
            const id = ParseUtil.ParseVariable("match id must be number, if set", match.id, "number", true) ?? 0;
            const requireId = ParseUtil.ParseVariable("match requireId must be number, if set", match.requireId, "number", true) ?? 0;
            const cursorId1 = ParseUtil.ParseVariable("match cursorId1 must be hex-string or Buffer, if set", match.cursorId1, "hex", true) ?? Buffer.alloc(0);

            return {
                nodeType,
                filters,
                limit,
                limitField,
                level,
                discard,
                bottom,
                id,
                requireId,
                cursorId1,
            };
        }) as unknown as Match[];
    }

    /**
     * Parse array of Filter objects.
     * @param supposed Filter[]
     * @returns Filter[]
     * @throws on unparseable data
     */
    public static ParseFilters(filters: any[]): Filter[] {
        return filters.map( (filter: Filter) => {
            const field = ParseUtil.ParseVariable("filters[index2] field must be string", filter.field, "string");
            const operator = ParseUtil.ParseVariable("filters[index2] operator must be string, if set", filter.operator, "string", true) ?? "";
            const cmp0 = ParseUtil.ParseVariable("filters[index2] cmp must be string", filter.cmp, "string");
            const cmp = ParseUtil.MatchCMPEnum(cmp0);
            if (cmp === undefined) {
                throw new Error("permissions embed[index] filters[index2] cmp must match CMP enum.");
            }
            // value is parsed manually because it can have different types.
            let value = filter.value;
            if (Array.isArray(value)) {
                value = Buffer.from(value);
            }
            else if (Buffer.isBuffer(value)) {
                // Pass through
            }
            else if (typeof value === "string") {
                // Pass through
            }
            else if (typeof value === "number") {
                // Pass through
            }
            else if (value === undefined) {
                // Pass through
            }
            else if (value === null) {
                // null becomes undefined, since we only use undefined in our models.
                value = undefined;
            }
            else {
                throw new Error("filter.value must be string, number or number[] or undefined");
            }
            return {
                field,
                operator,
                cmp,
                value,
            };
        });
    }

    /**
     * @param cmp textual representation of a CMP enum key.
     * @return Matched CMP or undefined if not matched.
     */
    public static MatchCMPEnum(cmp: string): CMP | undefined {
        switch (cmp.toLowerCase()) {
            case "eq":
                return CMP.EQ;
                break;
            case "ne":
                return CMP.NE;
                break;
            case "lt":
                return CMP.LT;
                break;
            case "le":
                return CMP.LE;
                break;
            case "gt":
                return CMP.GT;
                break;
            case "ge":
                return CMP.GE;
                break;
            default:
                return undefined;
        }
    }

    /**
     * @param AuthCertConstraintValues object of type:
     * {
     *  publicKey: hexstring | Buffer,
     *  creationTime: number,
     *  region?: string,
     *  jurisdiction?: string,
     * }
     * @returns AuthCertConstraintValues object
     * @throws if malconfigured
     */
    public static ParseAuthCertConstraintValues(params: any): AuthCertConstraintValues {
        if (typeof params !== "object" || params.constructor !== Object) {
            throw new Error("Expecting params to be object.");
        }

        const publicKey = ParseUtil.ParseVariable("publicKey must be hex-string or Buffer", params.publicKey, "hex");
        const creationTime = ParseUtil.ParseVariable("creationTime must be number", params.creationTime, "number");
        const region = ParseUtil.ParseVariable("region must be string, if set", params.region, "string", true);
        const jurisdiction = ParseUtil.ParseVariable("jurisdiction must be string, if set", params.jurisdiction, "string", true);

        return {
            publicKey,
            creationTime,
            region,
            jurisdiction,
        };
    }

    /**
     * @param NodeParams object of type:
     * {
     *  modelType?: hexstring | Buffer,
     *  id1?: hexstring | Buffer,
     *  copiedId1?: hexstring | Buffer,
     *  id2?: hexstring | Buffer,
     *  parentId?: hexstring | Buffer,
     *  copiedParentId?: hexstring | Buffer,
     *  config?: number,
     *  onlineIdNetwork?: hexstring | Buffer,
     *  owner?: hexstring | Buffer,
     *  signature?: hexstring | Buffer,
     *  copiedSignature?: hexstring | Buffer,
     *  creationTime?: number,
     *  expireTime?: number,
     *  difficulty?: number,
     *  nonce?: hexstring | Buffer,
     *  refId?: hexstring | Buffer,
     *  cert?: hexstring | Buffer,
     *  embedded?: hexstring | Buffer,
     *  blobHash?: hexstring | Buffer,
     *  blobLength?: bigint,
     *  licenseMinDistance?: number,
     *  licenseMaxDistance?: number,
     *  transientConfig?: number,
     *  transientStorageTime?: number,
     *  isLeaf?: boolean,
     *  hasOnlineValidation?: boolean,
     *  hasOnlineCert?: boolean,
     *  hasOnlineEmbedding?: boolean,
     *  isPublic?: boolean,
     *  isLicensed?: boolean,
     *  isPrivate?: boolean,
     *  allowEmbed?: boolean,
     *  allowEmbedMove?: boolean,
     *  isUnique?: boolean,
     *  isBeginRestrictiveWriteMode?: boolean,
     *  isEndRestrictiveWriteMode?: boolean,
     *  isIndestructible?: boolean,
     *  region?: string,
     *  jurisdiction?: string,
     *  disallowParentLicensing?: boolean,
     *  onlyOwnChildren?: boolean,
     *  disallowPublicChildren?: boolean,
     *  bubbleTrigger?: boolean,
     * }
     * @returns NodeParams object
     * @throws if malconfigured
     */
    protected static ParseNodeParams(params: any): NodeParams {
        if (typeof params !== "object" || params.constructor !== Object) {
            throw new Error("Expecting params to be object.");
        }

        const modelType = ParseUtil.ParseVariable("modelType must be hex-string or Buffer, if set", params.modelType, "hex", true);
        const id1 = ParseUtil.ParseVariable("id1 must be hex-string or Buffer, if set", params.id1, "hex",true);
        const copiedId1 = ParseUtil.ParseVariable("copiedId1 must be hex-string or Buffer, if set", params.copiedId1, "hex",true);
        const id2 = ParseUtil.ParseVariable("id2 must be hex-string or Buffer, if set", params.id2, "hex",true);
        const parentId = ParseUtil.ParseVariable("parentId must be hex-string or Buffer, if set", params.parentId, "hex",true);
        const copiedParentId = ParseUtil.ParseVariable("copiedParentId must be hex-string or Buffer, if set", params.copiedParentId, "hex",true);
        const config = ParseUtil.ParseVariable("config must be number, if set", params.config, "number", true);
        const onlineIdNetwork = ParseUtil.ParseVariable("onlineIdNetwork must be hex-string or Buffer, if set", params.onlineIdNetwork, "hex",true);
        const owner = ParseUtil.ParseVariable("owner must be hex-string or Buffer, if set", params.owner, "hex",true);
        const signature = ParseUtil.ParseVariable("signature must be hex-string or Buffer, if set", params.signature, "hex",true);
        const copiedSignature = ParseUtil.ParseVariable("copiedSignature must be hex-string or Buffer, if set", params.copiedSignature, "hex",true);
        const creationTime = ParseUtil.ParseVariable("creationTime must be number, if set", params.creationTime, "number", true);
        const expireTime = ParseUtil.ParseVariable("expireTime must be number, if set", params.expireTime, "number", true);
        const difficulty = ParseUtil.ParseVariable("difficulty must be number, if set", params.difficulty, "number", true);
        const nonce = ParseUtil.ParseVariable("nonce must be hex-string or Buffer, if set", params.nonce, "hex",true);
        const refId = ParseUtil.ParseVariable("refId must be hex-string or Buffer, if set", params.refId, "hex",true);
        const cert = ParseUtil.ParseVariable("cert must be hex-string or Buffer, if set", params.cert, "hex",true);
        const embedded = ParseUtil.ParseVariable("embedded must be hex-string or Buffer, if set", params.embedded, "hex",true);
        const blobHash = ParseUtil.ParseVariable("blobHash must be hex-string or Buffer, if set", params.blobHash, "hex",true);
        const blobLength = ParseUtil.ParseVariable("blobLength must be number or bigint as string, if set", params.blobLength, "bigint", true);
        const licenseMinDistance = ParseUtil.ParseVariable("licenseMinDistance must be number, if set", params.licenseMinDistance, "number", true);
        const licenseMaxDistance = ParseUtil.ParseVariable("licenseMaxDistance must be number, if set", params.licenseMaxDistance, "number", true);
        const transientConfig = ParseUtil.ParseVariable("transientConfig must be number, if set", params.transientConfig, "number", true);
        const transientStorageTime = ParseUtil.ParseVariable("transientStorageTime must be number, if set", params.transientStorageTime, "number", true);
        const isLeaf = ParseUtil.ParseVariable("isLeaf must be boolean, if set", params.isLeaf, "boolean", true);
        const hasOnlineValidation = ParseUtil.ParseVariable("hasOnlineValidation must be boolean, if set", params.hasOnlineValidation, "boolean", true);
        const hasOnlineCert = ParseUtil.ParseVariable("hasOnlineCert must be boolean, if set", params.hasOnlineCert, "boolean", true);
        const hasOnlineEmbedding = ParseUtil.ParseVariable("hasOnlineEmbedding must be boolean, if set", params.hasOnlineEmbedding, "boolean", true);
        const isPublic = ParseUtil.ParseVariable("isPublic must be boolean, if set", params.isPublic, "boolean", true);
        const isLicensed = ParseUtil.ParseVariable("isLicensed must be boolean, if set", params.isLicensed, "boolean", true);
        const isPrivate = ParseUtil.ParseVariable("isPrivate must be boolean, if set", params.isPrivate, "boolean", true);
        const allowEmbed = ParseUtil.ParseVariable("allowEmbed must be boolean, if set", params.allowEmbed, "boolean", true);
        const allowEmbedMove = ParseUtil.ParseVariable("allowEmbedMove must be boolean, if set", params.allowEmbedMove, "boolean", true);
        const isUnique = ParseUtil.ParseVariable("isUnique must be boolean, if set", params.isUnique, "boolean", true);
        const isBeginRestrictiveWriteMode = ParseUtil.ParseVariable("isBeginRestrictiveWriteMode must be boolean, if set", params.isBeginRestrictiveWriteMode, "boolean", true);
        const isEndRestrictiveWriteMode = ParseUtil.ParseVariable("isEndRestrictiveWriteMode must be boolean, if set", params.isEndRestrictiveWriteMode, "boolean", true);
        const isIndestructible = ParseUtil.ParseVariable("isIndestructible must be boolean, if set", params.isIndestructible, "boolean", true);
        const region = ParseUtil.ParseVariable("region must be string, if set", params.region, "string", true);
        const jurisdiction = ParseUtil.ParseVariable("jurisdiction must be string, if set", params.jurisdiction, "string", true);
        const disallowParentLicensing = ParseUtil.ParseVariable("disallowParentLicensing must be boolean, if set", params.disallowParentLicensing, "boolean", true) ?? false;
        const onlyOwnChildren = ParseUtil.ParseVariable("onlyOwnChildren must be boolean, if set", params.onlyOwnChildren, "boolean", true) ?? false;
        const disallowPublicChildren = ParseUtil.ParseVariable("disallowPublicChildren must be boolean, if set", params.disallowPublicChildren, "boolean", true) ?? false;
        const bubbleTrigger = ParseUtil.ParseVariable("bubbleTrigger must be boolean, if set", params.bubbleTrigger, "boolean", true) ?? false;

        return {
            modelType,
            id1,
            copiedId1,
            id2,
            parentId,
            copiedParentId,
            config,
            onlineIdNetwork,
            owner,
            signature,
            copiedSignature,
            creationTime,
            expireTime,
            difficulty,
            nonce,
            refId,
            cert,
            embedded,
            blobHash,
            blobLength,
            licenseMinDistance,
            licenseMaxDistance,
            transientConfig,
            transientStorageTime,
            isLeaf,
            isPublic,
            hasOnlineValidation,
            hasOnlineCert,
            hasOnlineEmbedding,
            isLicensed,
            isPrivate,
            allowEmbed,
            allowEmbedMove,
            isUnique,
            isBeginRestrictiveWriteMode,
            isEndRestrictiveWriteMode,
            isIndestructible,
            region,
            jurisdiction,
            disallowParentLicensing,
            onlyOwnChildren,
            disallowPublicChildren,
            bubbleTrigger,
        };
    }

    /**
     * @param DataParams object of type:
     * {
     * ...NodeParams,
     *  data?: hextring | Buffer,
     *  contentType?: string,
     *  dataConfig?: number,
     *  userConfig?: number,
     *  isSpecial?: boolean,
     * }
     * @returns DataParams object
     * @throws if malconfigured
     */
    public static ParseDataParams(params: any): DataParams {
        if (typeof params !== "object" || params.constructor !== Object) {
            throw new Error("Expecting params to be object.");
        }

        const nodeParams = ParseUtil.ParseNodeParams(params);

        const dataConfig = ParseUtil.ParseVariable("dataConfig must be number, if set", params.dataConfig, "number", true);
        const userConfig = ParseUtil.ParseVariable("userConfig must be number, if set", params.userConfig, "number", true);
        const contentType = ParseUtil.ParseVariable("contentType must be string, if set", params.contentType, "string", true);
        const data = ParseUtil.ParseVariable("data must be hex-string or Buffer, if set", params.data, "hex", true);
        const isSpecial = ParseUtil.ParseVariable("isSpecial must be boolean, if set", params.isSpecial, "boolean", true);

        return {
            ...nodeParams,
            dataConfig,
            userConfig,
            contentType,
            data,
            isSpecial,
        };
    }

    /**
     * @param LicenseParams object of type:
     * {
     * ...NodeParams,
     *  licenseConfig?: number,
     *  targetPublicKey?: hexstring | Buffer,
     *  terms?: hexstring | Buffer,
     *  extensions?: number,
     *  friendLevel?: number,
     *  friendCertA?: hexstring | Buffer,
     *  friendCertB?: hexstring | Buffer,
     *  licenseTransientConfig?: number,
     *  allowTargetSendPrivately?: boolean,
     *  disallowRetroLicensing?: boolean,
     *  isRestrictiveModeWriter?: boolean,
     *  isRestrictiveModeManager?: boolean,
     *  hasOnlineFriendCert?: boolean,
     *  isOnlineFriendCertsOnline?: boolean,
     *  nodeId1?: hexstring | Buffer,  // Overwrites refId if set.
     *  jumpPeerPublicKey?: hexstring | Buffer,
     *  parentPathHash?: hexstring | Buffer,
     *  maxDistance?: number,
     * }
     * @returns LicenseParams object
     * @throws if malconfigured
     */
    public static ParseLicenseParams(params: any): LicenseParams {
        if (typeof params !== "object" || params.constructor !== Object) {
            throw new Error("Expecting params to be object.");
        }

        const nodeParams = ParseUtil.ParseNodeParams(params);

        const licenseConfig = ParseUtil.ParseVariable("licenseConfig must be number, if set", params.licenseConfig, "number", true);
        const targetPublicKey = ParseUtil.ParseVariable("targetPublicKey must be hex-string or Buffer, if set", params.targetPublicKey, "hex", true);
        const terms = ParseUtil.ParseVariable("terms must be hex-string or Buffer, if set", params.terms, "hex", true);
        const extensions = ParseUtil.ParseVariable("extensions must be number, if set", params.extensions, "number", true);
        const friendLevel = ParseUtil.ParseVariable("friendLevel must be number, if set", params.friendLevel, "number", true);
        const friendCertA = ParseUtil.ParseVariable("friendCertA must be hex-string or Buffer, if set", params.friendCertA, "hex", true);
        const friendCertB = ParseUtil.ParseVariable("friendCertB must be hex-string or Buffer, if set", params.friendCertB, "hex", true);
        const licenseTransientConfig = ParseUtil.ParseVariable("licenseTransientConfig must be number, if set", params.licenseTransientConfig, "number", true);
        const allowTargetSendPrivately = ParseUtil.ParseVariable("allowTargetSendPrivately must be boolean, if set", params.allowTargetSendPrivately, "boolean", true);
        const disallowRetroLicensing = ParseUtil.ParseVariable("disallowRetroLicensing must be boolean, if set", params.disallowRetroLicensing, "boolean", true);
        const isRestrictiveModeWriter = ParseUtil.ParseVariable("isRestrictiveModeWriter must be boolean, if set", params.isRestrictiveModeWriter, "boolean", true);
        const isRestrictiveModeManager = ParseUtil.ParseVariable("isRestrictiveModeManager must be boolean, if set", params.isRestrictiveModeManager, "boolean", true);
        const hasOnlineFriendCert = ParseUtil.ParseVariable("hasOnlineFriendCert must be boolean, if set", params.hasOnlineFriendCert, "boolean", true);
        const isOnlineFriendCertsOnline = ParseUtil.ParseVariable("isOnlineFriendCertsOnline must be boolean, if set", params.isOnlineFriendCertsOnline, "boolean", true);
        const nodeId1 = ParseUtil.ParseVariable("nodeId1 must be hex-string or Buffer, if set", params.nodeId1, "hex", true);
        const jumpPeerPublicKey = ParseUtil.ParseVariable("jumpPeerPublicKey must be hex-string or Buffer, if set", params.jumpPeerPublicKey, "hex", true);
        const parentPathHash = ParseUtil.ParseVariable("parentPathHash must be hex-string or Buffer, if set", params.parentPathHash, "hex", true);
        const maxDistance = ParseUtil.ParseVariable("maxDistance must be number, if set", params.maxDistance, "number", true);

        return {
            ...nodeParams,
            licenseConfig,
            targetPublicKey,
            terms,
            extensions,
            friendLevel,
            friendCertA,
            friendCertB,
            licenseTransientConfig,
            allowTargetSendPrivately,
            disallowRetroLicensing,
            isRestrictiveModeWriter,
            isRestrictiveModeManager,
            hasOnlineFriendCert,
            isOnlineFriendCertsOnline,
            nodeId1,
            jumpPeerPublicKey,
            parentPathHash,
            maxDistance,
        };
    }

    /**
     * @param LicenseCertParams object of type:
     * {
     * ...PrimaryNodeCertParams,
     *  maxExtensions?: number,
     *  isLockedOnLicenseTargetPublicKey?: boolean,
     *  isLockedOnLicenseConfig?: boolean,
     *  isLockedOnTerms?: boolean,
     *  isLockedOnExtensions?: boolean,
     *  isLockedOnFriendLevel?: boolean,
     *  isLockedOnMaxExtensions?: boolean,
     * }
     * @returns LicenseCertParams object
     * @throws if malconfigured
     */
    public static ParseLicenseCertParams(params: any): LicenseCertParams {
        if (typeof params !== "object" || params.constructor !== Object) {
            throw new Error("Expecting params to be object.");
        }

        const certParams = ParseUtil.ParsePrimaryNodeCertParams(params);

        const maxExtensions = ParseUtil.ParseVariable("maxExtensions must be number, if set", params.maxExtensions, "number", true);
        const isLockedOnLicenseTargetPublicKey = ParseUtil.ParseVariable("isLockedOnLicenseTargetPublicKey must be boolean, if set", params.isLockedOnLicenseTargetPublicKey, "boolean", true);
        const isLockedOnLicenseConfig = ParseUtil.ParseVariable("isLockedOnLicenseConfig must be boolean, if set", params.isLockedOnLicenseConfig, "boolean", true);
        const isLockedOnTerms = ParseUtil.ParseVariable("isLockedOnTerms must be boolean, if set", params.isLockedOnTerms, "boolean", true);
        const isLockedOnExtensions = ParseUtil.ParseVariable("isLockedOnExtensions must be boolean, if set", params.isLockedOnExtensions, "boolean", true);
        const isLockedOnFriendLevel = ParseUtil.ParseVariable("isLockedOnFriendLevel must be boolean, if set", params.isLockedOnFriendLevel, "boolean", true);
        const isLockedOnMaxExtensions = ParseUtil.ParseVariable("isLockedOnMaxExtensions must be boolean, if set", params.isLockedOnMaxExtensions, "boolean", true);

        return {
            ...certParams,
            maxExtensions,
            isLockedOnLicenseTargetPublicKey,
            isLockedOnLicenseConfig,
            isLockedOnTerms,
            isLockedOnExtensions,
            isLockedOnFriendLevel,
            isLockedOnMaxExtensions,
        };
    }

    /**
     * @param DataCertConstraintValues object
     * @returns DataCertConstraintValues object which is identical to the DataParams object type.
     * @throws if malconfigured
     */
    public static ParseDataCertConstraintValues(params: any): DataCertConstraintValues {
        return ParseUtil.ParseDataParams(params);
    }

    /**
     * @param LicenseCertConstraintValues object
     * @returns LicenseCertConstraintValues object which is identical to the LicenseParams object type.
     * @throws if malconfigured
     */
    public static ParseLicenseCertConstraintValues(params: any): LicenseCertConstraintValues {
        return ParseUtil.ParseLicenseParams(params);
    }

    /**
     * @param AuthCertParams object of type:
     * {
     *  ...BaseCertParams,
     *  isLockedOnPublicKey?: boolean,
     *  isLockedOnRegion?: boolean,
     *  isLockedOnJurisdiction?: boolean,
     * }
     * @returns AuthCertParams object
     * @throws if malconfigured
     */
    public static ParseAuthCertParams(params: any): AuthCertParams {
        if (typeof params !== "object" || params.constructor !== Object) {
            throw new Error("Expecting params to be object.");
        }

        const certParams = ParseUtil.ParseBaseCertParams(params);

        const isLockedOnPublicKey = ParseUtil.ParseVariable("isLockedOnPublicKey must be boolean, if set", params.isLockedOnPublicKey, "boolean", true);
        const isLockedOnRegion = ParseUtil.ParseVariable("isLockedOnRegion must be boolean, if set", params.isLockedOnRegion, "boolean", true);
        const isLockedOnJurisdiction = ParseUtil.ParseVariable("isLockedOnJurisdiction must be boolean, if set", params.isLockedOnJurisdiction, "boolean", true);

        return {
            ...certParams,
            isLockedOnPublicKey,
            isLockedOnRegion,
            isLockedOnJurisdiction,
        };
    }

    /**
     * @see ParseUtil.ParseBaseCertParams().
     */
    public static ParseChainCertConstraintValues(params: any): ChainCertConstraintValues {
        return ParseUtil.ParseBaseCertParams(params) as ChainCertParams;
    }

    /**
     * @see ParseUtil.ParseBaseCertParams().
     */
    public static ParseChainCertParams(params: any): ChainCertParams {
        return ParseUtil.ParseBaseCertParams(params) as ChainCertParams;
    }

    /**
     * @param FriendCertParams object of type:
     * {
     *  ...BaseCertParams,
     *  isLockedOnIntermediary?: boolean,
     *  isLockedOnLevel?: boolean,
     * }
     * @returns FriendCertParams object
     * @throws if malconfigured
     */
    public static ParseFriendCertParams(params: any): FriendCertParams {
        if (typeof params !== "object" || params.constructor !== Object) {
            throw new Error("Expecting params to be object.");
        }

        const certParams = ParseUtil.ParseBaseCertParams(params);

        const key = ParseUtil.ParseVariable("key must be hex-string, if set", params.key, "hex", true);
        const isLockedOnIntermediary = ParseUtil.ParseVariable("isLockedOnIntermediary must be boolean, if set", params.isLockedOnIntermediary, "boolean", true);
        const isLockedOnLevel = ParseUtil.ParseVariable("isLockedOnLevel must be boolean, if set", params.isLockedOnLevel, "boolean", true);

        return {
            ...certParams,
            key,
            isLockedOnIntermediary,
            isLockedOnLevel,
        };
    }

    /**
     * @param FriendCertConstraintValues object of type:
     * {
     *  creationTime: number,
     *  expireTime?: number,
     *  modelType?: hexstring | Buffer,
     *  otherConstraints: hexstring | Buffer,
     *  publicKey: hexstring | Buffer,
     *  otherIssuerPublicKey: hexstring | Buffer,
     *  key: hexstring | Buffer,
     *  otherKey: hexstring | Buffer,
     *  intermediaryPublicKey: hexstring | Buffer,
     *  friendLevel: number
     * }
     * @returns FriendCertConstraintValues object
     * @throws if malconfigured
     */
    public static ParseFriendCertConstraintValues(params: any): FriendCertConstraintValues {
        if (typeof params !== "object" || params.constructor !== Object) {
            throw new Error("Expecting params to be object.");
        }

        const creationTime = ParseUtil.ParseVariable("creationTime must be number", params.creationTime, "number");
        const expireTime = ParseUtil.ParseVariable("expireTime must be number, if set", params.expireTime, "number", true);
        const modelType = ParseUtil.ParseVariable("modelType must be hex-string or Buffer", params.modelType, "hex", true);
        const otherConstraints = ParseUtil.ParseVariable("otherConstraints must be hex-string or Buffer", params.otherConstraints, "hex", true);
        const publicKey = ParseUtil.ParseVariable("publicKey must be hex-string or Buffer", params.publicKey, "hex", true);
        const otherIssuerPublicKey = ParseUtil.ParseVariable("otherIssuerPublicKey must be hex-string or Buffer", params.otherIssuerPublicKey, "hex", true);
        const key = ParseUtil.ParseVariable("key must be hex-string or Buffer", params.key, "hex", true);
        const otherKey = ParseUtil.ParseVariable("otherKey must be hex-string or Buffer", params.otherKey, "hex", true);
        const intermediaryPublicKey = ParseUtil.ParseVariable("intermediaryPublicKey must be hex-string or Buffer", params.intermediaryPublicKey, "hex", true);
        const friendLevel = ParseUtil.ParseVariable("friendLevel must be number", params.friendLevel, "number");

        return {
            creationTime,
            expireTime,
            modelType,
            otherConstraints,
            publicKey,
            otherIssuerPublicKey,
            key,
            otherKey,
            intermediaryPublicKey,
            friendLevel,
        };
    }

    /**
     * @param BaseCertParams object of type:
     * {
     *  modelType?: hexstring | Buffer,
     *  owner?: hexstring | Buffer,
     *  targetPublicKeys: (hexstring | Buffer)[],
     *  config?: number,
     *  lockedConfig?: number,
     *  creationTime: number,
     *  expireTime: number,
     *  cert?: hextring | Buffer,
     *  constraints?: hextring | Buffer,
     *  targetType?: hextring | Buffer,
     *  maxChainLength?: number,
     *  targetMaxExpireTime?: number,
     *  signature?: hexstring | Buffer,
     *  hasOnlineValidation?: boolean,
     *  hasOnlineCert?: boolean,
     *  isIndestructible?: boolean,
     * }
     * @returns BaseCertParams object
     * @throws if malconfigured
     */
    protected static ParseBaseCertParams(params: any): BaseCertParams {
        if (typeof params !== "object" || params.constructor !== Object) {
            throw new Error("Expecting params to be object.");
        }

        const modelType = ParseUtil.ParseVariable("modelType must be hex-string or Buffer", params.modelType, "hex", true);
        const owner = ParseUtil.ParseVariable("owner must be hex-string or Buffer, if set", params.owner, "hex", true);
        const targetPublicKeys = ParseUtil.ParseVariable("targetPublicKeys must be array of hex-string or Buffer", params.targetPublicKeys, "hex[]");
        const config = ParseUtil.ParseVariable("config must be number, if set", params.config, "number", true);
        const multiSigThreshold = ParseUtil.ParseVariable("multiSigThreshold must be number, if set", params.multiSigThreshold, "number", true);
        const lockedConfig = ParseUtil.ParseVariable("lockedConfig must be number, if set", params.lockedConfig, "number", true);
        const creationTime = ParseUtil.ParseVariable("creationTime must be set to a number", params.creationTime, "number");
        const expireTime = ParseUtil.ParseVariable("expireTime must be set to a number", params.expireTime, "number");
        const cert = ParseUtil.ParseVariable("cert must be hex-string or Buffer, if set", params.cert, "hex", true);
        const constraints = ParseUtil.ParseVariable("constraints must be hex-string or Buffer, if set", params.constraints, "hex", true);
        const targetType = ParseUtil.ParseVariable("targetType must be hex-string or Buffer, if set", params.targetType, "hex", true);
        const maxChainLength = ParseUtil.ParseVariable("maxChainLength must be number, if set", params.maxChainLength, "number", true);
        const targetMaxExpireTime = ParseUtil.ParseVariable("targetMaxExpireTime must be number, if set", params.targetMaxExpireTime, "number", true);
        const signature = ParseUtil.ParseVariable("signature must be hex-string or Buffer, if set", params.signature, "hex", true);
        const hasOnlineValidation = ParseUtil.ParseVariable("hasOnlineValidation must be boolean, if set", params.hasOnlineValidation, "boolean", true);
        const hasOnlineCert = ParseUtil.ParseVariable("hasOnlineCert must be boolean, if set", params.hasOnlineCert, "boolean", true);
        const isIndestructible = ParseUtil.ParseVariable("isIndestructible must be boolean, if set", params.isIndestructible, "boolean", true);

        return {
            modelType,
            owner,
            targetPublicKeys,
            config,
            lockedConfig,
            creationTime,
            expireTime,
            cert,
            constraints,
            multiSigThreshold,
            targetType,
            maxChainLength,
            targetMaxExpireTime,
            signature,
            hasOnlineValidation,
            hasOnlineCert,
            isIndestructible,
        };
    }

    /**
     * @param PrimaryNodeCertParams object of type:
     * {
     *  ...BaseCertParams,
     *  isLockedOnId2?: boolean,
     *  isLockedOnParentId?: boolean,
     *  isLockedOnConfig?: boolean,
     *  isLockedOnNetwork?: boolean,
     *  isLockedOnDifficulty?: boolean,
     *  isLockedOnRefId?: boolean,
     *  isLockedOnEmbedded?: boolean,
     *  isLockedOnLicenseMinDistance?: boolean
     *  isLockedOnLicenseMaxDistance?: boolean,
     *  isLockedOnRegion?: boolean,
     *  isLockedOnJurisdiction?: boolean,
     *  isLockedOnChildMinDifficulty?: boolean,
     *  isLockedOnBlobHash?: boolean,
     *  isLockedOnCopiedParentId?: boolean,
     *  isLockedOnCopiedId1?: boolean,
     * }
     * @returns PrimaryNodeCertParams object
     * @throws if malconfigured
     */
    protected static ParsePrimaryNodeCertParams(params: any): PrimaryNodeCertParams {
        if (typeof params !== "object" || params.constructor !== Object) {
            throw new Error("Expecting params to be object.");
        }

        const baseParams = ParseUtil.ParseBaseCertParams(params);

        const isLockedOnId2 = ParseUtil.ParseVariable("isLockedOnId2 must be boolean, if set", params.isLockedOnId2, "boolean", true);
        const isLockedOnParentId = ParseUtil.ParseVariable("isLockedOnParentId must be boolean, if set", params.isLockedOnParentId, "boolean", true);
        const isLockedOnConfig = ParseUtil.ParseVariable("isLockedOnConfig must be boolean, if set", params.isLockedOnConfig, "boolean", true);
        const isLockedOnNetwork = ParseUtil.ParseVariable("isLockedOnNetwork must be boolean, if set", params.isLockedOnNetwork, "boolean", true);
        const isLockedOnDifficulty = ParseUtil.ParseVariable("isLockedOnDifficulty must be boolean, if set", params.isLockedOnDifficulty, "boolean", true);
        const isLockedOnRefId = ParseUtil.ParseVariable("isLockedOnRefId must be boolean, if set", params.isLockedOnRefId, "boolean", true);
        const isLockedOnEmbedded = ParseUtil.ParseVariable("isLockedOnEmbedded must be boolean, if set", params.isLockedOnEmbedded, "boolean", true);
        const isLockedOnLicenseMinDistance = ParseUtil.ParseVariable("isLockedOnLicenseMinDistance must be boolean, if set", params.isLockedOnLicenseMinDistance, "boolean", true);
        const isLockedOnLicenseMaxDistance = ParseUtil.ParseVariable("isLockedOnLicenseMaxDistance must be boolean, if set", params.isLockedOnLicenseMaxDistance, "boolean", true);
        const isLockedOnRegion = ParseUtil.ParseVariable("isLockedOnRegion must be boolean, if set", params.isLockedOnRegion, "boolean", true);
        const isLockedOnJurisdiction = ParseUtil.ParseVariable("isLockedOnJurisdiction must be boolean, if set", params.isLockedOnJurisdiction, "boolean", true);
        const isLockedOnChildMinDifficulty = ParseUtil.ParseVariable("isLockedOnChildMinDifficulty must be boolean, if set", params.isLockedOnChildMinDifficulty, "boolean", true);
        const isLockedOnBlobHash = ParseUtil.ParseVariable("isLockedOnBlobHash must be boolean, if set", params.isLockedOnBlobHash, "boolean", true);
        const isLockedOnCopiedParentId = ParseUtil.ParseVariable("isLockedOnCopiedParentId must be boolean, if set", params.isLockedOnCopiedParentId, "boolean", true);
        const isLockedOnCopiedId1 = ParseUtil.ParseVariable("isLockedOnCopiedId1 must be boolean, if set", params.isLockedOnCopiedId1, "boolean", true);

        return {
            ...baseParams,
            isLockedOnId2,
            isLockedOnParentId,
            isLockedOnConfig,
            isLockedOnNetwork,
            isLockedOnDifficulty,
            isLockedOnRefId,
            isLockedOnEmbedded,
            isLockedOnLicenseMinDistance,
            isLockedOnLicenseMaxDistance,
            isLockedOnRegion,
            isLockedOnJurisdiction,
            isLockedOnChildMinDifficulty,
            isLockedOnBlobHash,
            isLockedOnCopiedParentId,
            isLockedOnCopiedId1,
        };
    }

    /**
     * @param DataCertParams object of type:
     * {
     *  ...PrimaryNodeCertParams,
     *  isLockedOnDataConfig?: boolean,
     *  isLockedOnContentType?: boolean,
     *  isLockedOnUserBits?: boolean,
     * }
     * @returns DataCertParams object
     * @throws if malconfigured
     */
    public static ParseDataCertParams(params: any): DataCertParams {
        if (typeof params !== "object" || params.constructor !== Object) {
            throw new Error("Expecting params to be object.");
        }

        const certParams = ParseUtil.ParsePrimaryNodeCertParams(params);

        const isLockedOnDataConfig = ParseUtil.ParseVariable("isLockedOnDataConfig must be boolean, if set", params.isLockedOnDataConfig, "boolean", true);
        const isLockedOnContentType = ParseUtil.ParseVariable("isLockedOnContentType must be boolean, if set", params.isLockedOnContentType, "boolean", true);
        const isLockedOnUserBits = ParseUtil.ParseVariable("isLockedOnUserBits must be boolean, if set", params.isLockedOnUserBits, "boolean", true);

        return {
            ...certParams,
            isLockedOnDataConfig,
            isLockedOnContentType,
            isLockedOnUserBits,
        };
    }

    public static ParseNodeType(error: string, nodeType: string | Buffer): Buffer {
        if (typeof(nodeType) === "string") {
            const nt = NodeTypes[nodeType.toLowerCase()];
            if (nt) {
                return nt;
            }
        }

        return ParseUtil.ParseVariable(error, nodeType, "hex");
    }

    /**
     * @param error: string the exception to throw when type does not match.
     *
     * @param expectedType: any "string", "number", "bigint", "boolean", "object", "hex", "base64",
     * also suffix with "[]" to expect array as "string[]".
     * "hex" is expected to be either hexadecimal string then translated to Buffer or already
     * a Buffer.
     * "base64" is expected to be either base64 encoded string then translated to Buffer or
     * already a Buffer.
     *
     * @param allowUndefined if true then allow value to be undefined (or null, undefined will
     * be returned in null cases).
     *
     * @returns value, same as given as argument.
     * @throws if type of value does not match expected type.
     */
    public static ParseVariable(error: any, value: any, expectedType: string, allowUndefined: boolean = false): any {
        if (value === undefined || value === null) {
            if (!allowUndefined) {
                throw new Error(error);
            }
            return undefined;
        }
        else {
            const expectArray = expectedType.endsWith("[]");
            expectedType = expectArray ? expectedType.substr(0, expectedType.length-2) : expectedType;

            if (Array.isArray(value)) {
                if (!expectArray) {
                    throw new Error(error);
                }
                const value2: any[] = [];
                value.forEach( (v: any) => {
                    if (expectedType === "hex" || expectedType === "base64") {
                        if (!Buffer.isBuffer(v)) {
                            if (typeof v !== "string") {
                                throw new Error(error);
                            }
                            const v2 = Buffer.from(v, expectedType);
                            if (v2.toString(expectedType).toLowerCase() !== v.toLowerCase()) {
                                throw new Error(error);
                            }
                            v = v2;
                        }
                    }
                    else if (typeof v !== expectedType) {
                        throw new Error(error);
                    }
                    value2.push(DeepCopy(v));
                });
                return value2;
            }
            else {
                if (expectArray) {
                    throw new Error(error);
                }
                if (expectedType === "hex" || expectedType === "base64") {
                    if (!Buffer.isBuffer(value)) {
                        if (typeof value !== "string") {
                            throw new Error(error);
                        }
                        const value2 = Buffer.from(value, expectedType);
                        if (value2.toString(expectedType).toLowerCase() !== value.toLowerCase()) {
                            throw new Error(error);
                        }
                        return value2;
                    }
                }
                else {
                    if (expectedType === "bigint") {
                        value = BigInt(value);
                    }
                    else if (typeof value !== expectedType) {
                        throw new Error(error);
                    }
                }
                return DeepCopy(value);
            }
        }
    }
}
