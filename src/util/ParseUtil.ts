import {
    ClientOptions,
    ServerOptions,
    SocketFactoryConfig,
} from "pocket-sockets";

import {
    HandshakeFactoryConfig,
} from "pocket-messaging";

import {
    KeyPair,
    Decoder,
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
    DATA_NODE_TYPE,
} from "../datamodel";

import {
    AllowEmbed,
    FetchQuery,
    Match,
    LimitField,
    FetchTransform,
} from "../types";

import {
    AutoFetch,
    P2PClientPermissions,
    P2PClientFetchPermissions,
    P2PClientStorePermissions,
    UNCHECKED_PERMISSIVE_PERMISSIONS,
    PERMISSIVE_PERMISSIONS,
    DEFAULT_PEER_PERMISSIONS,
} from "../p2pclient/types";

import {
    LocalStorageConfig,
    ConnectionConfig,
    DriverConfig,
    UniverseConf,
    WalletConf,
    PeerConf,
    SyncConf,
    StorageConf,
} from "../service/types";

import {
    ThreadTemplate,
    ThreadLicenseParams,
    ThreadDataParams,
} from "../storage/thread";

import {
    DeepCopy,
} from "../util/common";

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
     *  }[],
     *  sync?: {
     *      peerPublicKeys:    Buffer[],
     *      blobSizeMaxLimit:  number,
     *      threads: {
     *          name:               string,
     *          stream?:            boolean,
     *          direction?:         "push" | "pull" " "both",
     *      }[],
     *  }[]
     * }
     *
     * Note that threads[].threadFetchParams are not supported to be parsed.
     *
     * @returns UniverseConf
     * @throws if malconfigured.
     */
    public static ParseUniverseConf(conf: any): UniverseConf {
        const format = ParseUtil.ParseVariable("universeConf.format must be number, if set", conf.format, "number", true) ?? 1;

        if (format !== 1) {
            throw new Error("universeConf.format must be set to 1");
        }

        const name = ParseUtil.ParseVariable("universeConf.name must be string", conf.name, "string");
        const version = ParseUtil.ParseVariable("universeConf.version must be string", conf.version, "string");
        const title = ParseUtil.ParseVariable("universeConf.title must be string, if set", conf.title, "string", true) ?? "";
        const description = ParseUtil.ParseVariable("universeConf.description must be string, if set", conf.description, "string", true) ?? "";
        const homepage = ParseUtil.ParseVariable("universeConf.homepage must be string, if set", conf.homepage, "string", true) ?? "";
        const author = ParseUtil.ParseVariable("universeConf.author must be string, if set", conf.author, "string", true) ?? "";
        const repository = ParseUtil.ParseVariable("universeConf.repository must be string, if set", conf.repository, "string", true) ?? "";
        const custom = ParseUtil.ParseVariable("universeConf.custom must be object, if set", conf.custom, "object", true) ?? {};

        const threads: {[name: string]: ThreadTemplate} = {};
        const threadTemplates = ParseUtil.ParseVariable("universeConf.threads must be object, if set", conf.threads, "object", true) ?? {};
        for (let name in threadTemplates) {
            const threadTemplate = threadTemplates[name];

            const query     = ParseUtil.ParseQuery(threadTemplate.query ?? {});
            const transform = ParseUtil.ParseTransform(threadTemplate.transform);

            const post: {[name: string]: ThreadDataParams} = {};

            Object.keys(threadTemplate.post).forEach( name => {
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

            threads[name] = {
                query,
                transform,
                post,
                postLicense,
            };
        }

        const peers: PeerConf[] = [];
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
            const peerPublicKeys = ParseUtil.ParseVariable("universeConf.sync.peerPublicKeys must be hex-string or Buffer array", syncConf.peerPublicKeys, "hex[]");

            const blobSizeMaxLimit = ParseUtil.ParseVariable("universeConf.sync.blobSizeMaxLimit must be number, if set", syncConf.blobSizeMaxLimit, "number", true) ?? -1;

            const threads: any[] = [];
            (syncConf.threads ?? []).forEach( (thread: any) => {

                const name = ParseUtil.ParseVariable("universeConf.sync.threads.name must be string", thread.name, "string");

                const stream = ParseUtil.ParseVariable("universeConf.sync.threads.stream must be boolean, if set", thread.stream, "boolean", true) ?? false;

                const direction = ParseUtil.ParseVariable("universeConf.sync.threads.direction must be string, if set", thread.direction, "string", true) ?? "pull";

                if (!["push", "pull", "both"].includes(direction)) {
                    throw new Error("universeConf.sync.threads.direction must be either \"push\", \"pull\", \"both\", if set");
                }

                threads.push({
                    name,
                    stream,
                    threadFetchParams: {},
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

        if (conf.hasOwnProperty("validSeconds")) {
            threadLicenseParams.validSeconds =
                ParseUtil.ParseVariable("ThreadLicenseParams.validSeconds must be number, if set",
                    conf.validSeconds, "number", true);  // allow undefined.
        }

        if (conf.hasOwnProperty("targets")) {
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

        if (conf.hasOwnProperty("validSeconds")) {
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
     * @returns UniverseConf
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
            storage.database = ParseUtil.ParseConfigLocalStorage(conf.storage?.database ?? {});
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
     * @returns LocalStorageConfig
     * @throws if malconfigured
     */
    public static ParseConfigLocalStorage(obj: any): LocalStorageConfig {
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
            const sqlite = ParseUtil.ParseVariable("local storage config driver.sqlite must be string, if set", obj.driver.sqlite, "string", true);
            const pg = ParseUtil.ParseVariable("local storage config driver.pg must be string, if set", obj.driver.pg, "string", true);
            const reconnectDelay = ParseUtil.ParseVariable("local storage config driver.reconnectDelay must be number, if set", obj.driver.reconnectDelay, "number", true);

            if (sqlite && pg) {
                throw new Error("local storage driver cannot have both 'sqlite' and 'pg' set");
            }

            if (!sqlite && !pg) {
                throw new Error("local storage driver must have either 'sqlite' or 'pg' set");
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
            const sqlite = ParseUtil.ParseVariable("local storage config blobDriver.sqlite must be string, if set", obj.blobDriver.sqlite, "string", true);
            const pg = ParseUtil.ParseVariable("local storage config blobDriver.pg must be string, if set", obj.blobDriver.pg, "string", true);
            const reconnectDelay = ParseUtil.ParseVariable("local storage config blobDriver.reconnectDelay must be number, if set", obj.blobDriver.reconnectDelay, "number", true);

            if (sqlite && pg) {
                throw new Error("local storage blobDriver cannot have both 'sqlite' and 'pg' set");
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

        const local: LocalStorageConfig = {
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
     * }
     * @returns ConnectionConfig
     * @throws if malconfigured
     */
    public static ParseConfigConnectionConfig(connectionConfig: any): ConnectionConfig {
        const handshakeFactoryConfig = ParseUtil.ParseHandshakeFactory(connectionConfig.connection);
        let region: string | undefined;
        let jurisdiction: string | undefined;

        if (connectionConfig !== undefined) {
            region = ParseUtil.ParseVariable("local storage region must be string, if set", connectionConfig.region, "string", true);
            jurisdiction = ParseUtil.ParseVariable("local storage jurisdiction must be string, if set", connectionConfig.jurisdiction, "string", true);
        }

        if (connectionConfig.permissions === undefined) {
            throw new Error("permissions need to be set on connection config");
        }

        const permissions = ParseUtil.ParseP2PClientPermissions(connectionConfig.permissions);

        return {
            handshakeFactoryConfig,
            region,
            jurisdiction,
            permissions,
        };
    }

    /**
     * @param obj object with the following properties:
     * {
     *  galaxy: string,
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
        // NOTE: we refer to the discriminator at "galaxy" in this context.
        const discriminator = Buffer.from(ParseUtil.ParseVariable("connection galaxy must be string, if set", obj.galaxy, "string", true) ?? "");

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
            if (socketType !== "WebSocket" && socketType !== "TCP") {
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
            };
            client = {
                socketType,
                clientOptions,
                reconnectDelay,
            };
        }
        if (obj.server) {
            const socketType = ParseUtil.ParseVariable("connection server socketType must be string", obj.server.socketType, "string");
            if (socketType !== "WebSocket" && socketType !== "TCP") {
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
            allowTrigger: false,
            allowEmbed: [],
            allowTransform: [],
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
     *  allowEmbed: {nodeType: hexstring | Buffer, filters: Filter[]}[],
     *  allowTrigger: boolean,
     *  allowNodeTypes: string[] | Buffer[],
     *  allowTransform: number[],
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
                const nodeType = ParseUtil.ParseVariable("permissions allowEmbed[index] nodeType must be hex-string or Buffer", allowEmbedObj.nodeType, "hex");
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

        const allowTrigger = ParseUtil.ParseVariable("permissions allowTrigger must be boolean, if set", permissions.allowTrigger, "boolean", true) ?? false;
        const allowTransform = ParseUtil.ParseVariable("permissions transform must be number[], if set", permissions.allowTransform, "number[]", true) ?? [];
        const allowNodeTypes: Buffer[] = ParseUtil.ParseVariable("permissions allowNodeTypes must be hex-string[] or Buffer[]", permissions.allowNodeTypes, "hex[]");

        const allowReadBlob = ParseUtil.ParseVariable("permissions allowReadBlob must be boolean, if set", permissions.allowReadBlob, "boolean", true) ?? false;

        return {
            allowEmbed,
            allowTrigger,
            allowNodeTypes,
            allowTransform,
            allowReadBlob,
        };
    }

    /**
     * @param AutoFetch as:
     * {
     *  remotePublicKey?: hexstring | Buffer,   // undefined or empty string means match ALL public keys.
     *  query: FetchQuery,
     *  transform: FetchTransform,
     *  blobSizeMaxLimit?: number,
     *  reverse?: boolean
     * }
     * @returns AutoFetch
     * @throws on unparseable data
     */
    public static ParseConfigAutoFetch(autoFetch: any): AutoFetch {
        const blobSizeMaxLimit = ParseUtil.ParseVariable("autoFetch blobSizeMaxLimit must be integer, if set", autoFetch.blobSizeMaxLimit, "number", true) ?? -1;
        const reverse = ParseUtil.ParseVariable("autoFetch reverse must be boolean, if set", autoFetch.reverse, "boolean", true) ?? false;
        const remotePublicKey = ParseUtil.ParseVariable("autoFetch remotePublicKey must be hex-string or Buffer, if set", autoFetch.remotePublicKey, "hex", true) ?? Buffer.alloc(0);
        const query = ParseUtil.ParseQuery(autoFetch.query);
        const transform = ParseUtil.ParseTransform(autoFetch.transform ?? {});

        return {
            remotePublicKey,
            fetchRequest: {query, transform},
            blobSizeMaxLimit,
            reverse,
        };
    }

    /**
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
     *  embed: {nodeType: hexstring | Buffer, filters: Filter[]}[],
     *  region?: string,
     *  jurisdiction?: string,
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
        const cutoffTime = ParseUtil.ParseVariable("query cutoffTime must be number, if set", query.cutoffTime, "bigint", true) ?? 0n;
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

        const allowEmbed0 = ParseUtil.ParseVariable("query embed must be object[], if set", query.embed, "object[]", true);
        let allowEmbed: AllowEmbed[] = [];
        if (allowEmbed0) {
            allowEmbed = allowEmbed0.map( (allowEmbedObj: AllowEmbed) => {
                const nodeType = ParseUtil.ParseVariable("query embed[index] nodeType must be hex-string or Buffer", allowEmbedObj.nodeType, "hex");
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
            embed: allowEmbed,
            targetPublicKey,
            sourcePublicKey,
            region,
            jurisdiction,
        };

        return query2;
    }

    /**
     * @param transform as:
     * {
     *  algos: number[],
     *  reverse?: boolean,
     *  cursorId1?: hexstring | Buffer,
     *  head?: number,
     *  tail?: number,
     *  msgId?: hexstring | Buffer,
     *
     * }
     * @returns FetchTransform
     * @throws on unparseable data
     */
    public static ParseTransform(transform: any): FetchTransform {
        if (typeof transform !== "object" || transform.constructor !== Object) {
            throw new Error("Expecting transform to be object.");
        }

        const msgId = ParseUtil.ParseVariable("transform msgId must be hex-string or Buffer, if set", transform.msgId, "hex", true) ?? Buffer.alloc(0);
        const algos = ParseUtil.ParseVariable("transform algos must be number[], if set", transform.algos, "number[]", true) ?? [];
        const head = ParseUtil.ParseVariable("transform head must be number, if set", transform.head, "number", true) ?? 0;
        const tail = ParseUtil.ParseVariable("transform tail must be number, if set", transform.tail, "number", true) ?? 0;
        const reverse = ParseUtil.ParseVariable("transform reverse must be boolean, if set", transform.reverse, "boolean", true) ?? false;
        const cursorId1 = ParseUtil.ParseVariable("transform cursorId1 must be hex-string or Buffer, if set", transform.cursorId1, "hex", true) ?? Buffer.alloc(0);

        return {
            algos,
            reverse,
            cursorId1,
            head,
            tail,
            msgId,
        };
    }

    /**
     * Parse array of Match objects.
     * @param supposed Match[] as:
     * [
     *  {
     *   nodeType: hexstring | Buffer,
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
     * @returns Macth[]
     * @throws on unparseable data
     */
    public static ParseMatch(matches: any[]): Match[] {
        return matches.map( (match: Match) => {
            const nodeType = ParseUtil.ParseVariable("match nodeType must be hex-string or Buffer, if set", match.nodeType, "hex", true) ?? DATA_NODE_TYPE;
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
     *  expireTime?: number,
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
        const expireTime = ParseUtil.ParseVariable("expireTime must be number, if set", params.expireTime, "number", true);
        const region = ParseUtil.ParseVariable("region must be string, if set", params.region, "string", true);
        const jurisdiction = ParseUtil.ParseVariable("jurisdiction must be string, if set", params.jurisdiction, "string", true);

        return {
            publicKey,
            creationTime,
            expireTime,
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
     *  network?: hexstring | Buffer,
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
     *  hasDynamicSelf?: boolean,
     *  hasDynamicCert?: boolean,
     *  hasDynamicEmbedding?: boolean,
     *  isPublic?: boolean,
     *  isLicensed?: boolean,
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
        const network = ParseUtil.ParseVariable("network must be hex-string or Buffer, if set", params.network, "hex",true);
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
        const blobLength = ParseUtil.ParseVariable("blobLength must be number, if set", params.blobLength, "bigint", true);
        const licenseMinDistance = ParseUtil.ParseVariable("licenseMinDistance must be number, if set", params.licenseMinDistance, "number", true);
        const licenseMaxDistance = ParseUtil.ParseVariable("licenseMaxDistance must be number, if set", params.licenseMaxDistance, "number", true);
        const transientConfig = ParseUtil.ParseVariable("transientConfig must be number, if set", params.transientConfig, "number", true);
        const transientStorageTime = ParseUtil.ParseVariable("transientStorageTime must be number, if set", params.transientStorageTime, "number", true);
        const isLeaf = ParseUtil.ParseVariable("isLeaf must be boolean, if set", params.isLeaf, "boolean", true);
        const hasDynamicSelf = ParseUtil.ParseVariable("hasDynamicSelf must be boolean, if set", params.hasDynamicSelf, "boolean", true);
        const hasDynamicCert = ParseUtil.ParseVariable("hasDynamicCert must be boolean, if set", params.hasDynamicCert, "boolean", true);
        const hasDynamicEmbedding = ParseUtil.ParseVariable("hasDynamicEmbedding must be boolean, if set", params.hasDynamicEmbedding, "boolean", true);
        const isPublic = ParseUtil.ParseVariable("isPublic must be boolean, if set", params.isPublic, "boolean", true);
        const isLicensed = ParseUtil.ParseVariable("isLicensed must be boolean, if set", params.isLicensed, "boolean", true);
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

        return {
            modelType,
            id1,
            copiedId1,
            id2,
            parentId,
            copiedParentId,
            config,
            network,
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
            hasDynamicSelf,
            hasDynamicCert,
            hasDynamicEmbedding,
            isPublic,
            isLicensed,
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
     *  hasDynamicFriendCert?: boolean,
     *  isDynamicFriendCertsActive?: boolean,
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
        const hasDynamicFriendCert = ParseUtil.ParseVariable("hasDynamicFriendCert must be boolean, if set", params.hasDynamicFriendCert, "boolean", true);
        const isDynamicFriendCertsActive = ParseUtil.ParseVariable("isDynamicFriendCertsActive must be boolean, if set", params.isDynamicFriendCertsActive, "boolean", true);
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
            hasDynamicFriendCert,
            isDynamicFriendCertsActive,
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
     *  dynamicSelfSpec?: hexstring | Buffer,
     *  hasDynamicSelf?: boolean,
     *  hasDynamicCert?: boolean,
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
        const dynamicSelfSpec = ParseUtil.ParseVariable("dynamicSelfSpec must be hex-string or Buffer, if set", params.dynamicSelfSpec, "hex", true);
        const hasDynamicSelf = ParseUtil.ParseVariable("hasDynamicSelf must be boolean, if set", params.hasDynamicSelf, "boolean", true);
        const hasDynamicCert = ParseUtil.ParseVariable("hasDynamicCert must be boolean, if set", params.hasDynamicCert, "boolean", true);
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
            dynamicSelfSpec,
            hasDynamicSelf,
            hasDynamicCert,
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

    /**
     * @param error: string the exception to throw when type does not match.
     * @param expectedType: any "string", "number", "bigint", "boolean", "object", "hex", also suffix with "[]" to expect array as "string[]".
     * "hex" is expected to be either hexadecimal string then translated to Buffer or already a Buffer.
     * @param allowUndefined if true then allow value to be undefined (or null, undefined will be returned in null cases).
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
                    if (expectedType === "hex") {
                        if (!Buffer.isBuffer(v)) {
                            if (typeof v !== "string") {
                                throw new Error(error);
                            }
                            const v2 = Buffer.from(v, "hex");
                            if (v2.toString("hex").toLowerCase() !== v.toLowerCase()) {
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
                if (expectedType === "hex") {
                    if (!Buffer.isBuffer(value)) {
                        if (typeof value !== "string") {
                            throw new Error(error);
                        }
                        const value2 = Buffer.from(value, "hex");
                        if (value2.toString("hex").toLowerCase() !== value.toLowerCase()) {
                            throw new Error(error);
                        }
                        return value2;
                    }
                }
                else if (typeof value !== expectedType) {
                    throw new Error(error);
                }
                return DeepCopy(value);
            }
        }
    }
}
