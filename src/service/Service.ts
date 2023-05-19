import { strict as assert } from "assert";

import {
    CreatePair,
    SocketFactoryStats,
} from "pocket-sockets";

import {
    Messaging,
    HandshakeFactory,
    HandshakeFactoryConfig,
    HandshakeResult,
    EventType,
} from "pocket-messaging";

import {EVENTS as HANDSHAKEFACTORY_EVENTS} from "pocket-messaging";

import {
    SignatureOffloader,
} from "../datamodel/decoder";

import {
    P2PClient,
    PeerProps,
    PeerDataUtil,
    ConnectionType,
    ConnectionTypeName,
    AutoFetch,
    P2PClientForwarder,
    P2PClientExtender,
    P2PClientAutoFetcher,
    BlobEvent,
} from "../p2pclient";

import {
    DriverInterface,
    BlobDriverInterface,
    Driver,
    BlobDriver,
    Storage,
    DBClient,
} from "../storage";

import {
    KeyPair,
    PrimaryNodeCertInterface,
    AuthCertInterface,
    DataInterface,
    Data,
    DataConfig,
    SPECIAL_NODES,
    CMP,
    Hash,
} from "../datamodel";

import {
    Status,
} from "../types";

import {
    ParseUtil,
} from "../util/ParseUtil";

import {
    RegionUtil,
} from "../util/RegionUtil";

import {
    LocalStorageConfig,
    ConnectionConfig,
    ExposeStorageToApp,
} from "./types";

import {
    UNCHECKED_PERMISSIVE_PERMISSIONS,
    PERMISSIVE_PERMISSIONS,
    LOCKED_PERMISSIONS,
} from "../p2pclient/types";

import {
    DeepCopy,
    DeepEquals,
    sleep,
    PromiseCallback,
} from "../util/common";

import {
    StorageUtil,
} from "../util/StorageUtil";

import {
    NodeUtil,
} from "../util/NodeUtil";

import {
    DatabaseUtil,
} from "../util/DatabaseUtil";

import {
    PocketConsole,
} from "pocket-console";

declare const window: any;

const isNode = (typeof process !== "undefined" && process?.versions?.node);
let isBrowser = false;
if (!isNode) {
    isBrowser = (typeof (window as any) !== "undefined");
    if(!isBrowser) {
        assert(false, "Unexpected error: current environment is neither Node.js or Browser");
    }
}

const console = PocketConsole({module: "Service"});


/**
 * The configuration of this Service.
 * These configs are allowed to change in runtime by calling the set functions,
 * however when in the running state they might not be modifiable.
 */
export type ServiceConfig = {
    /** The cryptographic KeyPair of this side. It is used for handshaking and signing. */
    keyPair?: KeyPair,

    /** Optional AuthCert of this side. It is used to authenticate as another public key. */
    authCert?: AuthCertInterface,

    /** Certificates used for signing new nodes when having authenticated using an Auth Cert. */
    nodeCerts: PrimaryNodeCertInterface[],

    /** Set if using a local storage (either in-mem or disk backed). Mutually exclusive to storageConnectionConfigs. */
    localStorage?: LocalStorageConfig,

    /**
     * Added to if using a remote storage connected to over socket. Mutually exclusive to localStorage.
     * There can be many connection factories but only one connected socket will be allowed.
     */
    storageConnectionConfigs: ConnectionConfig[],

    /**
     */
    connectionConfigs: ConnectionConfig[],

    /**
     * If set to true then connectionConfigs will be automatically instantiated to factories when
     * a storage connection has been established, and also later when new connection configs are added.
     */
    autoStartConnections: boolean,

    /** AutoFetch objects to initiate on autoFetcher clients. */
    autoFetch: AutoFetch[],

    exposeStorageToApp?: ExposeStorageToApp,

    /** Arbitrary app config accessable to the app. */
    app: any,
};

type ServiceState = {
    /** Set when connected to a storage, either local or remote. */
    storageClient?: P2PClient,

    /** Set together with storageClient and is used for local apps to access the storage so that permissions works as expected. */
    externalStorageClient?: P2PClient,

    autoFetchers: P2PClientAutoFetcher[],

    storageServers: P2PClientForwarder[],

    extenderServers: P2PClientExtender[],

    /**
     * The connections factories instantiated from the storageConnectionConfigs.
     * Matches config.storageConnectionConfigs on index.
     */
    storageConnectionFactories: HandshakeFactory[],

    /**
     * The connections factories instantiated from the connectionConfigs.
     * Matches config.connectionConfigs on index.
     */
    connectionFactories: HandshakeFactory[],

    /**
     * Initially this value gtes copied from localStorage.driver.reconnectDelay.
     * If it is set to 0 or undefined then reconnect is cancelled.
     */
    localDatabaseReconnectDelay?: number,
};

/**
 */
export const EVENTS = {
    START: {
       name: "START",
    },
    STOP: {
       name: "STOP",
    },
    STORAGE_CLOSE: {
       name: "STORAGE_CLOSE",
    },
    STORAGE_CONNECT: {
       name: "STORAGE_CONNECT",
    },
    STORAGE_FACTORY_CREATE: {
       name: "STORAGE_FACTORY_CREATE",
    },
    STORAGE_AUTHCERT_ERROR: {
       name: "STORAGE_AUTHCERT_ERROR",
    },
    STORAGE_PARSE_ERROR: {
       name: "STORAGE_PARSE_ERROR",
    },
    STORAGE_ERROR: {
        ...HANDSHAKEFACTORY_EVENTS.ERROR,
        subEvents: [...HANDSHAKEFACTORY_EVENTS.ERROR.subEvents, "STORAGE_PARSE_ERROR", "STORAGE_AUTHCERT_ERROR"],
    },

    STORAGE_CLIENT_FACTORY_CREATE: {
       name: "STORAGE_CLIENT_FACTORY_CREATE",
    },
    STORAGE_CLIENT_CONNECT: {
       name: "STORAGE_CLIENT_CONNECT",
    },
    STORAGE_CLIENT_CLOSE: {
       name: "STORAGE_CLIENT_CLOSE",
    },
    STORAGE_CLIENT_AUTHCERT_ERROR: {
       name: "STORAGE_CLIENT_AUTHCERT_ERROR",
    },
    STORAGE_CLIENT_PARSE_ERROR: {
       name: "STORAGE_CLIENT_PARSE_ERROR",
    },
    STORAGE_CLIENT_ERROR: {
        ...HANDSHAKEFACTORY_EVENTS.ERROR,
        subEvents: [...HANDSHAKEFACTORY_EVENTS.ERROR.subEvents, "STORAGE_CLIENT_PARSE_ERROR", "STORAGE_CLIENT_AUTHCERT_ERROR"],
    },

    CONNECTION_FACTORY_CREATE: {
       name: "CONNECTION_FACTORY_CREATE",
    },
    CONNECTION_CONNECT: {
       name: "CONNECTION_CONNECT",
    },
    CONNECTION_CLOSE: {
       name: "CONNECTION_CLOSE",
    },
    CONNECTION_AUTHCERT_ERROR: {
       name: "CONNECTION_AUTHCERT_ERROR",
    },
    CONNECTION_PARSE_ERROR: {
       name: "CONNECTION_PARSE_ERROR",
    },
    CONNECTION_ERROR: {
        ...HANDSHAKEFACTORY_EVENTS.ERROR,
        subEvents: [...HANDSHAKEFACTORY_EVENTS.ERROR.subEvents, "CONNECTION_PARSE_ERROR", "CONNECTION_AUTHCERT_ERROR"],
    },
}

/** Event emitted when user calls start(). */
export type StartCallback = () => void;

/** Event emitted when user calls stop(). */
export type StopCallback = () => void;

/**
 * Event emitted when there is an error on socket, handshake or validating an auth cert.
 */
export type ConnectionErrorCallback = (e: {subEvent: string, e: any}) => void;

/**
 * Event emitted when a connected peer has closed.
 */
export type ConnectionCloseCallback = (e: {p2pClient: P2PClient}) => void;

/**
 * Event emitted when a peer has connected.
 */
export type ConnectionConnectCallback = (e: {p2pClient: P2PClient}) => void;

/**
 * Event emitted when the handshake factory for a peer connection has been setup.
 * This factory can be used to more closely monitor events directly on the factory,
 * and also to tune and set parameters such as blocked IP addresses.
 */
export type ConnectionFactoryCreateCallback = (e: {handshakeFactory: HandshakeFactory}) => void;

export type ConnectionParseErrorCallback = (e: {error: Error, localProps: PeerProps, remoteProps: PeerProps}) => void;
export type ConnectionAuthCertErrorCallback = (e: {p2pClient: P2PClient}) => void;

/**
 * Event emitted when there is an error on socket, handshake or validating an auth cert.
 */
export type StorageErrorCallback = (e: {subEvent: string, e: any}) => void;

/** Event emitted when the storage connection has closed. */
export type StorageCloseCallback = (e: {p2pClient: P2PClient}) => void;

/**
 * Event emitted when a connection to Storage has been setup.
 */
export type StorageConnectCallback = (e: {p2pClient: P2PClient}) => void;

/**
 * Event emitted when the handshake factory for storage connections has been setup.
 * This factory can be used to more closely monitor events directly on the factory.
 */
export type StorageFactoryCreateCallback = (e: {handshakeFactory: HandshakeFactory}) => void;

export type StorageParseErrorCallback = (e: {error: Error, localProps: PeerProps, remoteProps: PeerProps}) => void;
export type StorageAuthCertErrorCallback = (e: {p2pClient: P2PClient}) => void;

/**
 */
export class Service {
    protected _isRunning: boolean;
    protected handlers: {[name: string]: ( (...args: any) => void)[]};

    /** The configuration of the whole Service, which is partly allowed to change during runtime. */
    protected config: ServiceConfig;

    /** The current running state. */
    protected state: ServiceState;

    protected signatureOffloader: SignatureOffloader;

    protected nodeUtil: NodeUtil;

    /** Storage connection factories share socket stats to not make redundant connections. */
    protected sharedStorageFactoriesSocketFactoryStats: SocketFactoryStats;

    /**
     * @param signatureOffloader already initiated, needed to sign and verify signatures.
     * @param config optional initial config.
     */
    constructor(signatureOffloader: SignatureOffloader, config?: ServiceConfig) {
        this._isRunning = false;
        this.handlers = {};
        this.signatureOffloader = signatureOffloader;
        this.nodeUtil = new NodeUtil(this.signatureOffloader);
        this.sharedStorageFactoriesSocketFactoryStats = {counters: {}};
        this.config = config ?? {
            nodeCerts: [],
            connectionConfigs: [],
            storageConnectionConfigs: [],
            autoStartConnections: true,
            autoFetch: [],
            app: {},
        };
        this.state = {
            autoFetchers: [],
            storageServers: [],
            extenderServers: [],
            storageConnectionFactories: [],
            connectionFactories: [],
            localDatabaseReconnectDelay: undefined,
        };
    }

    /**
     * Start this Service.
     *
     * @throws
     */
    public async start() {
        if (this._isRunning) {
            return;
        }
        this._isRunning = true;
        this.triggerEvent(EVENTS.START.name);
        await this.initStorage();
    }

    /**
     * Stop this service.
     * A stopped service can be restarted.
     */
    public stop() {
        if (!this._isRunning) {
            return;
        }
        this._isRunning = false;
        this.closeEverythingStorage();
        this.closeConnectionFactories();
        this.triggerEvent(EVENTS.STOP.name);
    }

    /**
     * @returns true if the Service is running.
     */
    public isRunning(): boolean {
        return this._isRunning;
    }

    /**
     * @returns true if there is a storage connection ready.
     */
    public isConnected(): boolean {
        return this.state.storageClient ? true : false;
    }

    /**
     * @returns a storage client to be used to an app.
     */
    public getStorageClient(): P2PClient | undefined {
        return this.state.externalStorageClient;
    }

    protected closeEverythingStorage() {
        this.state.storageServers.forEach( (forwarder: P2PClientForwarder) => {
            forwarder.close();
        });
        this.state.storageServers = [];

        this.state.extenderServers.forEach( (extender: P2PClientExtender) => {
            extender.close();
        });
        this.state.extenderServers = [];

        this.state.autoFetchers.forEach( (autoFetcher: P2PClientAutoFetcher) => {
            autoFetcher.close();
        });
        this.state.autoFetchers = [];

        this.state.storageConnectionFactories.forEach( (factory: HandshakeFactory) => {
            factory.close();
        });

        this.state.storageConnectionFactories = [];

        this.state.localDatabaseReconnectDelay = undefined;

        this.state.storageClient?.close();
        this.state.externalStorageClient?.close();
    }

    /**
     * Detect and filter out all closed clients.
     */
    protected garbageCollectClients() {
        for (let i=0; i<this.state.storageServers.length; i++) {
            if (this.state.storageServers[i].isClosed()) {
                this.state.storageServers.splice(i, 1);
                i = 0;
                continue;
            }
        }
        for (let i=0; i<this.state.extenderServers.length; i++) {
            if (this.state.extenderServers[i].isClosed()) {
                this.state.extenderServers.splice(i, 1);
                i = 0;
                continue;
            }
        }
        for (let i=0; i<this.state.autoFetchers.length; i++) {
            if (this.state.autoFetchers[i].isClosed()) {
                this.state.autoFetchers.splice(i, 1);
                i = 0;
                continue;
            }
        }
    }

    /**
     * Parse config object fragment and add/set extracted config parameters.
     * This can be called in runtime as long as only such runtime changeable parameters are set.
     *
     * @param configObject POJO typically parsed from JSON.
     * @returns [false, err] on bad config format or [true] on no error
     */
    public async parseConfig(obj: any): Promise<[boolean, string | undefined]> {
        try {
            const autoStartConnections = ParseUtil.ParseVariable("autoStartConnections must be boolean, if set", obj.autoStartConnections, "boolean", true) ?? true;
            this.setAutoStartConnections(autoStartConnections);
            if (obj.keyPair) {
                const keyPair = ParseUtil.ParseKeyPair(obj.keyPair);
                if (keyPair) {
                    this.setKeyPair(keyPair);
                }
            }

            if (obj.authCert) {
                const authCert = await ParseUtil.ParseConfigAuthCert(obj.authCert);
                if (authCert) {
                    await this.setAuthCert(authCert);
                }
            }

            if (obj.nodeCerts) {
                const nodeCerts = await ParseUtil.ParseConfigNodeCerts(obj.nodeCerts);
                for (let i=0; i<nodeCerts.length; i++) {
                    await this.addNodeCert(nodeCerts[i]);
                }
            }

            if (obj.storage?.local && obj.storage?.remote) {
                console.warn("Both local and remote connected storage configuration present. Will opt for the remote storage config.");
            }

            if (obj.storage?.local && !obj.storage.remote) {
                if (obj.storage.local.permissions === undefined) {
                    obj.storage.local.permissions = UNCHECKED_PERMISSIVE_PERMISSIONS;
                }

                const localStorage = ParseUtil.ParseConfigLocalStorage(obj.storage.local);

                let exposeToApp: ExposeStorageToApp | undefined = undefined;
                if (obj.storage.local.exposeToApp) {
                    exposeToApp = {
                        permissions: ParseUtil.ParseP2PClientPermissions(obj.storage.local.exposeToApp.permissions ?? PERMISSIVE_PERMISSIONS),
                    };
                }

                this.setLocalStorage(localStorage);
                this.setExposeStorageToApp(exposeToApp);
            }

            if (obj.storage?.remote) {
                if (obj.storage.remote.connections) {
                    if (!Array.isArray(obj.storage.remote.connections)) {
                        throw new Error("storage.remote.connections is expected to be object[]");
                    }

                    // If we have multiple factories we aim at having at most one connection live.
                    // This is done by sharing stats between the connection factories.
                    const sharedFactoryStats = {};

                    obj.storage.remote.connections.forEach( (config: any) => {
                        if (config.permissions !== undefined) {
                            throw new Error("permissions object must not be set on storage remote configs.");
                        }

                        if (config.connectionType === undefined) {
                            config.connectionType = {
                                clientType: ConnectionTypeName.STORAGE_CLIENT,
                            };
                        }
                        else if (config.connectionType.serverType !== undefined) {
                            throw new Error("Remote storage client must not have the serverType property set.");
                        }

                        // We do not allow any incoming requests, so we lock it down.
                        config.permissions = LOCKED_PERMISSIONS;

                        const connectionConfig = ParseUtil.ParseConfigConnectionConfig(config, sharedFactoryStats);

                        this.addStorageConnectionConfig(connectionConfig);
                    });
                }

                if (obj.storage.remote.exposeToApp) {
                    if (obj.storage.remote.exposeToApp.permissions) {
                        throw new Error("exposeToApp must not have permissions set when using remote storage.");
                    }
                    this.setExposeStorageToApp({});
                }
            }

            if (obj.connections) {
                if (!Array.isArray(obj.connections)) {
                    throw new Error("connections is expected to be object[]");
                }

                obj.connections.forEach( (config: any) => {
                    if (config.permissions === undefined) {
                        config.permissions = LOCKED_PERMISSIONS;
                    }

                    const connectionConfig = ParseUtil.ParseConfigConnectionConfig(config);

                    if (connectionConfig.connectionType === undefined) {
                        throw new Error(`connections[].connectionType must be "{clientType: ${ConnectionTypeName.STORAGE_CLIENT}" or "${ConnectionTypeName.EXTENDER_CLIENT}", serverType: "[${ConnectionTypeName.STORAGE_SERVER},]${ConnectionTypeName.EXTENDER_SERVER}"}`);
                    }

                    this.addConnectionConfig(connectionConfig);
                });
            }

            if (obj.autoFetch) {
                if (!Array.isArray(obj.autoFetch)) {
                    throw new Error("autoFetch is expected to be object[]");
                }
                obj.autoFetch.forEach( (autoFetch: any) => {
                    this.addAutoFetch(ParseUtil.ParseConfigAutoFetch(autoFetch));
                });
            }

            if (obj.app) {
                if (typeof obj.app !== "object" || obj.app.constructor !== Object) {
                    throw new Error("app config must be object, if set.");
                }
                this.config.app = obj.app;
            }
        }
        catch(e) {
            return [false, `Error when parsing config: ${(e as Error).message}`];
        }
        return [true, undefined];
    }

    /**
     * @throws
     */
    public setKeyPair(keyPair: KeyPair | undefined) {
        if (this._isRunning) {
            throw new Error("Cannot set key pair while running.");
        }
        this.config.keyPair = keyPair;
    }

    public getKeyPair(): KeyPair | undefined {
        return this.config.keyPair;
    }

    /**
     * Return the public key of this side.
     * First the root issuer public key from the Auth Cert,
     * secondly the public key from the keyPair.
     * @returns publicKey from authCert or keyPair.
     */
    public getPublicKey(): Buffer | undefined {
        if (this.config.authCert) {
            return this.config.authCert.getIssuerPublicKey();
        }
        return this.config.keyPair?.publicKey;
    }

    /**
     * As soon as a config is ready and the storage connection is established
     * peers and Storage client factories can be initiated automatically.
     */
    public setAutoStartConnections(autoStartConnections: boolean) {
        this.config.autoStartConnections = autoStartConnections;
    }

    public getAutoStartConnections(): boolean {
        return this.config.autoStartConnections;
    }

    /**
     * Set or remove auth cert.
     * Auth cert will be cryptographically verified, but
     * the auth cert will not be online verified at this point.
     * The receiving side of a auth cert always validates it online.
     * @param authCert
     * @throws
     */
    public async setAuthCert(authCert?: AuthCertInterface) {
        if (this._isRunning) {
            throw new Error("Cannot set auth cert while running.");
        }
        if (authCert && (await this.signatureOffloader.verify([authCert])).length === 0) {
            throw new Error("Invalid AuthCert provided, cert could not be verified.");
        }
        this.config.authCert = authCert;
    }

    /**
     * @returns cryptographically verified authCert, if set.
     */
    public getAuthCert(): AuthCertInterface | undefined {
        return this.config.authCert;
    }

    /**
     * Add NodeCert.
     * The cert will get cryptographically verified, but not online verified.
     * The receiving storage will always online verify certificates (if applicable).
     * @param nodeCert
     * @throws
     */
    public async addNodeCert(nodeCert: PrimaryNodeCertInterface) {
        if (this.config.nodeCerts.some( (nodeCert2: PrimaryNodeCertInterface) => nodeCert2.calcId1().equals(nodeCert.calcId1()) )) {
            // Already exists.
            return;
        }

        if ((await this.signatureOffloader.verify([nodeCert])).length === 0) {
            throw new Error("Invalid NodeCert provided, could not be verified.");
        }

        this.config.nodeCerts.push(nodeCert);

        // hot-update the extenders with new list.
        this.state.extenderServers.forEach( (extender: P2PClientExtender) => {
            extender.setNodeCerts(this.config.nodeCerts);
        });
    }

    /**
     * Remove specific node cert from the config and from all extenders.
     * @param nodeCert to be removed.
     */
    public removeNodeCert(nodeCert: PrimaryNodeCertInterface) {
        this.config.nodeCerts = this.config.nodeCerts.filter( (nodeCert2: PrimaryNodeCertInterface) => {
            return !nodeCert.calcId1().equals(nodeCert2.calcId1());
        });

        // hot-update the extenders with new list.
        this.state.extenderServers.forEach( (extender: P2PClientExtender) => {
            extender.setNodeCerts(this.config.nodeCerts);
        });
    }

    /**
     * @returns array copy of all node certs.
     */
    public getNodeCerts(): PrimaryNodeCertInterface[] {
        return this.config.nodeCerts.slice();
    }

    /**
     * Set (and replace current local/remote) storage.
     * @param localStorage
     * @throws if running.
     */
    public setLocalStorage(localStorage: LocalStorageConfig | undefined) {
        if (this._isRunning) {
            throw new Error("Cannot set local storage while running.");
        }

        this.config.localStorage = localStorage;

        this.state.localDatabaseReconnectDelay = this.config.localStorage?.driver.reconnectDelay;
    }

    /** If set then a storage is exposed to be available for a local app. */
    public setExposeStorageToApp(exposeStorageToApp: ExposeStorageToApp | undefined) {
        this.config.exposeStorageToApp = exposeStorageToApp;
    }

    public getExposeStorageToApp(): ExposeStorageToApp | undefined {
        return this.config.exposeStorageToApp;
    }

    public getAppConfig(): any {
        return this.config.app;
    }

    /**
     * Add connection configuration.
     *
     * The HandshakeFactoryConfig in the ConnectionConfig will be complemented with keyPair and peerData upon connecting.
     * KeyPair is configured seperately from connections.
     *
     * If existing storage client and autoStartConnections is true then immediately init the connection factory.
     * @param connectionConfig object
     */
    public addConnectionConfig(connectionConfig: ConnectionConfig) {
        if (this.config.connectionConfigs.some( (connectionConfig2: any) => DeepEquals(connectionConfig, connectionConfig2) )) {
            // Already exists.
            return;
        }
        this.config.connectionConfigs.push(connectionConfig);
        if (this.state.storageClient && this.config.autoStartConnections) {
            this.initConnectionFactories();
        }
    }

    /**
     * Remove connection config and close factory (including its connections) if instantiated.
     *
     * @param index of the connection config to remove
     */
    public removeConnectionConfig(index: number) {
        this.config.connectionConfigs.splice(index, 1);
        const connectionFactory = this.state.connectionFactories.splice(index, 1)[0];
        connectionFactory?.close();
    }

    /**
     * Add Remote Storage connection configuration.
     *
     * The HandshakeFactoryConfig in the ConnectionConfig will be complemented with keyPair and peerData upon connecting.
     * KeyPair is configured seperately from connections.
     *
     * If existing storage client and autoStartConnections is true then immediately init the connection factory.
     * @param connectionConfig object
     */
    public addStorageConnectionConfig(connectionConfig: ConnectionConfig) {
        if (this.config.storageConnectionConfigs.some( (connectionConfig2: any) => DeepEquals(connectionConfig, connectionConfig2) )) {
            // Already exists.
            return;
        }
        this.config.storageConnectionConfigs.push(connectionConfig);
        if (this._isRunning && !this.config.localStorage) {
            this.initStorageFactories();
        }
    }

    /**
     * Remove remote storage connection config and close factory (including its connections) if instantiated.
     *
     * @param index of the connection config to remove
     */
    public removeStorageConnectionConfig(index: number) {
        this.config.storageConnectionConfigs.splice(index, 1);
        const connectionFactory = this.state.storageConnectionFactories.splice(index, 1)[0];
        connectionFactory?.close();
    }

    /**
     * Add AutoFetch to the autoFetchers.
     * A AutoFetch is an automated way of fetching from peers according to some rules.
     * This is useful so you don't have to write code for straight forward syncing.
     * @param autoFetch to add to autoFetchers.
     */
    public addAutoFetch(autoFetch: AutoFetch) {
        if (this.config.autoFetch.some( (autoFetch2: any) => DeepEquals(autoFetch, autoFetch2) )) {
            // Already exists.
            return;
        }
        this.config.autoFetch.push(autoFetch);
        this.state.autoFetchers.forEach( (autoFetcher: P2PClientAutoFetcher) => {
            autoFetcher.addFetch([autoFetch]);
        });
    }

    /**
     * Remove AutoFetch.
     * Each P2PClientAutoFetcher will unsubscribe from subscriptions it has associated with the removed autoFetch.
     * @param autoFetch to remove from autoFetchers.
     */
    public removeAutoFetch(autoFetch: AutoFetch) {
        for (let i=0; i<this.config.autoFetch.length; i++) {
            const autoFetch2 = this.config.autoFetch[i];
            if (DeepEquals(autoFetch, autoFetch2)) {
                this.config.autoFetch.splice(i, 1);
                this.state.autoFetchers.forEach( (autoFetcher: P2PClientAutoFetcher) => {
                    autoFetcher.removeFetch(autoFetch);
                });
                break;
            }
        }
    }

    /**
     * @returns copy of list of all auto fetch objects.
     */
    public getAutoFetch(): AutoFetch[] {
        return this.config.autoFetch.slice();  // copy to avoid direct mutations.
    }

    /**
     * @throws
     */
    protected async initStorage() {
        if (!this.config.keyPair) {
            throw new Error("KeyPair must be set before initializing storage.");
        }
        if (this.config.localStorage) {
            await this.initLocalStorage(this.config.localStorage);
        }
        else if (this.config.storageConnectionConfigs.length > 0) {
            this.initStorageFactories();
        }
        else {
            throw new Error("No storage configured.");
        }
    }

    /**
     * Create and start any peer connection factory yet not started.
     * Idempotent function, can be run again after a new peer config has been added to connect to that peer.
     */
    public initConnectionFactories() {
        if (!this.state.storageClient) {
            throw new Error("Cannot init peer connection factories unless connected to storage.");
        }

        const configsToInit = this.config.connectionConfigs.slice(this.state.connectionFactories.length);
        configsToInit.forEach( (config: ConnectionConfig) => {
            const handshakeFactory = this.initConnectionFactory(config);
            this.state.connectionFactories.push(handshakeFactory);
            handshakeFactory.init();
        });
    }

    /**
     * Setup and initiate a peer connection factory.
     */
    protected initConnectionFactory(config: ConnectionConfig): HandshakeFactory {
        const localProps = this.makePeerProps(config.connectionType, config.region, config.jurisdiction);

        let remoteProps: PeerProps | undefined;

        const handshakeFactory = new HandshakeFactory(this.makeHandshakeFactoryConfig(config.handshakeFactoryConfig, localProps));
        this.triggerEvent(EVENTS.CONNECTION_FACTORY_CREATE.name, {handshakeFactory});
        handshakeFactory.onHandshake( async (e: {messaging: Messaging, isServer: boolean, handshakeResult: HandshakeResult}) => {
            try {
                if (!this.state.storageClient) {
                    // If there is no storage client there is no point proceeding with this.
                    console.debug("No Storage connected, must close newly accepted socket.");
                    e.messaging.close();
                    return;
                }

                remoteProps = await PeerDataUtil.HandshakeResultToProps(e.handshakeResult, localProps, this.signatureOffloader);

                // Validate region and jurisdiction provided by the remote peer.
                this.validateRemoteProps(remoteProps, e.messaging.getClient()?.getRemoteAddress());

                const p2pClient = new P2PClient(e.messaging, localProps, remoteProps, config.permissions);

                // Note that the auth cert at this point is already cryptographically verified and validated against the target,
                // here we also check so that it verifies online (if it has any such properties).
                if (remoteProps.authCert && await this.validateAuthCert(remoteProps.authCert, this.state.storageClient) !== 0) {
                    this.triggerEvent(EVENTS.CONNECTION_AUTHCERT_ERROR.name, {p2pClient});
                    this.triggerEvent(EVENTS.CONNECTION_ERROR.name, {subEvent: EVENTS.CONNECTION_AUTHCERT_ERROR.name, e: {p2pClient}});
                    e.messaging.close();
                    return;
                }
                e.messaging.open();
                this.connected(p2pClient);
            }
            catch (error) {
                this.triggerEvent(EVENTS.CONNECTION_PARSE_ERROR.name, {error, localProps, remoteProps});
                this.triggerEvent(EVENTS.CONNECTION_ERROR.name, {subEvent: EVENTS.CONNECTION_PARSE_ERROR.name, e: {error, localProps, remoteProps}});
                e.messaging.close();
            }
        });
        handshakeFactory.onError( (e: {subEvent: string, e: object}) => {
            this.triggerEvent(EVENTS.CONNECTION_ERROR.name, e);
        });

        return handshakeFactory;
    }

    protected closeConnectionFactories() {
        this.state.connectionFactories.forEach( (factory?: HandshakeFactory) => {
            factory?.close();
        });

        this.state.connectionFactories = [];
    }

    /**
     * Create Storage.
     * @throws on error.
     */
    protected async initLocalStorage(localStorage: LocalStorageConfig) {
        if (!localStorage.driver.sqlite && !localStorage.driver.pg) {
            throw new Error("Driver not properly configured. Expecting localStorage.driver.sqlite/pg to be set.");
        }

        if (localStorage.driver.sqlite && localStorage.driver.pg) {
            throw new Error("Driver not properly configured. Expecting only one of localStorage.driver.sqlite/pg to be set.");
        }

        if (localStorage.blobDriver?.sqlite && localStorage.blobDriver?.pg) {
            throw new Error("Driver not properly configured. Expecting maxium one of localStorage.driver.sqlite/pg to be set.");
        }

        // The PeerProps which the Storage sees as the this side.
        // The publicKey set here is what dictatates the permissions we have in the Storage.
        const localProps = this.makePeerProps(ConnectionType.STORAGE_CLIENT);

        // The PeerProps of the Storage "sent" to this side in the handshake.
        // When using a local storage the storage uses the same keys for identity as the client side.
        const remoteProps = this.makePeerProps(ConnectionType.STORAGE_SERVER);

        while (true) {
            const [driver, blobDriver] = await this.connectToDatabase(localStorage);

            if (driver) {
                // Create virtual paired sockets.
                const [socket1, socket2] = CreatePair();
                const messaging1 = new Messaging(socket1, 0);
                const messaging2 = new Messaging(socket2, 0);

                const p2pStorage = new P2PClient(messaging1, remoteProps, localProps, localStorage.permissions);

                const storage = new Storage(p2pStorage, this.signatureOffloader, driver, blobDriver);

                storage.onClose( () => {
                    // We need to explicitly close the Driver instance.
                    driver?.close();
                    blobDriver?.close();
                });

                storage.init();

                const internalStorageClient = new P2PClient(messaging2, localProps, remoteProps);

                messaging1.open();
                messaging2.open();

                let externalStorageClient: P2PClient | undefined;
                const exposeStorageToApp = this.getExposeStorageToApp();

                if (exposeStorageToApp) {
                    // Create virtual paired sockets.
                    const [socket3, socket4] = CreatePair();
                    const messaging3 = new Messaging(socket3, 0);
                    const messaging4 = new Messaging(socket4, 0);

                    // Set permissions on this to limit the local app's access to the storage.
                    const intermediaryStorageClient =
                        new P2PClient(messaging3, this.makePeerProps(ConnectionType.STORAGE_CLIENT),
                            this.makePeerProps(ConnectionType.STORAGE_SERVER), exposeStorageToApp.permissions);

                    // This client only initiates requests and does not need any permissions to it.
                    externalStorageClient =
                        new P2PClient(messaging4, this.makePeerProps(ConnectionType.STORAGE_CLIENT),
                        this.makePeerProps(ConnectionType.STORAGE_SERVER));

                    new P2PClientForwarder(intermediaryStorageClient, internalStorageClient);

                    messaging3.open();
                    messaging4.open();
                }

                const closePromise = PromiseCallback();

                internalStorageClient.onClose( (peer: P2PClient) => {
                    closePromise.cb();
                });

                this.storageConnected(internalStorageClient, externalStorageClient);

                await closePromise.promise;

                console.error("Database connection closed");
            }

            if (!this.state.localDatabaseReconnectDelay) {
                break;
            }

            console.debug(`Sleep ${this.state.localDatabaseReconnectDelay} second(s) before reconnecting`);

            await sleep(this.state.localDatabaseReconnectDelay * 1000);
        }
    }

    protected async connectToDatabase(localStorage: LocalStorageConfig): Promise<[DriverInterface | undefined, BlobDriverInterface | undefined]> {
        let driver: DriverInterface | undefined;
        let blobDriver: BlobDriverInterface | undefined;

        try {
            if (localStorage.driver.sqlite) {
                const db = isBrowser ?
                    await DatabaseUtil.OpenSQLiteJS() :
                    await DatabaseUtil.OpenSQLite(localStorage.driver.sqlite);
                driver = new Driver(new DBClient(db));
            }
            else if (localStorage.driver.pg) {
                const connection = await DatabaseUtil.OpenPG(localStorage.driver.pg);
                driver = new Driver(new DBClient(connection));
            }

            if (localStorage.blobDriver?.sqlite) {
                const db = isBrowser ?
                    await DatabaseUtil.OpenSQLiteJS(false) :
                    await DatabaseUtil.OpenSQLite(localStorage.blobDriver.sqlite, false);
                blobDriver = new BlobDriver(new DBClient(db));
            }
            else if (localStorage.blobDriver?.pg) {
                const connection = await DatabaseUtil.OpenPG(localStorage.blobDriver.pg, false);
                blobDriver = new BlobDriver(new DBClient(connection));
            }
        }
        catch(e) {
            console.warn(`Database connection error`, (e as Error).message);

            return [undefined, undefined];
        }

        if (!driver) {
            return [undefined, undefined];
        }

        await driver.init();

        if (await driver.createTables()) {
            console.debug("Database tables created or already existing");
        }
        else {
            throw new Error("Database tables creation could not proceed due to inconsistent state");
        }

        if (blobDriver) {
            await blobDriver.init();

            if (await blobDriver.createTables()) {
                console.debug("Database blob tables created or already existing");
            }
            else {
                driver?.close();
                throw new Error("Database blob tables creation could not proceed due to inconsistent state");
            }
        }

        return [driver, blobDriver];
    }

    /**
     * Setup and initiate a factory connection factory.
     * @throws
     */
    protected initStorageFactories() {
        const configsToInit = this.config.storageConnectionConfigs.slice(this.state.storageConnectionFactories.length);
        configsToInit.forEach( (config: ConnectionConfig) => {
            const handshakeFactory = this.initStorageConnectionFactory(config);
            this.state.storageConnectionFactories.push(handshakeFactory);
            handshakeFactory.init();
        });
    }

    /**
     * Init a handshake factory for connecting with remote storage.
     */
    protected initStorageConnectionFactory(config: ConnectionConfig): HandshakeFactory {
        const localProps = this.makePeerProps(config.connectionType, config.region, config.jurisdiction);

        let remoteProps: PeerProps | undefined;

        config.handshakeFactoryConfig.socketFactoryConfig.maxConnections = 1;  // Force this for storage connection factories.
        const handshakeFactory = new HandshakeFactory(this.makeHandshakeFactoryConfig(config.handshakeFactoryConfig, localProps));
        this.triggerEvent(EVENTS.STORAGE_FACTORY_CREATE.name, {handshakeFactory});
        handshakeFactory.onHandshake( async (e: {messaging: Messaging, isServer: boolean, handshakeResult: HandshakeResult}) => {
            try {
                if (this.state.storageClient) {
                    // If there is a storage client already there is no point proceeding with this.
                    console.debug("Storage client already present, closing newly opened.");
                    e.messaging.close();
                    return;
                }

                remoteProps = await PeerDataUtil.HandshakeResultToProps(e.handshakeResult, localProps, this.signatureOffloader);

                // Validate region and jurisdiction provided by the remote peer.
                this.validateRemoteProps(remoteProps, e.messaging.getClient()?.getRemoteAddress());

                const p2pClient = new P2PClient(e.messaging, localProps, remoteProps);

                // Note that the auth cert at this point is already cryptographically verified and validated against the target,
                // here we also check so that it verifies online (if it has any such properties).
                if (remoteProps.authCert && await this.validateAuthCert(remoteProps.authCert, p2pClient) !== 0) {
                    this.triggerEvent(EVENTS.STORAGE_AUTHCERT_ERROR.name, {p2pClient});
                    this.triggerEvent(EVENTS.STORAGE_ERROR.name, {subEvent: EVENTS.STORAGE_AUTHCERT_ERROR.name, e: {p2pClient}});
                    e.messaging.close();
                    return;
                }
                e.messaging.open();
                this.storageConnected(p2pClient, p2pClient);
            }
            catch (error) {
                this.triggerEvent(EVENTS.STORAGE_PARSE_ERROR.name, {error, localProps, remoteProps});
                this.triggerEvent(EVENTS.STORAGE_ERROR.name, {subEvent: EVENTS.STORAGE_PARSE_ERROR.name, e: {error, localProps, remoteProps}});
                e.messaging.close();
            }
        });
        handshakeFactory.onError( (e: {subEvent: string, e: object}) => {
            this.triggerEvent(EVENTS.STORAGE_ERROR.name, e);
        });

        return handshakeFactory;
    }

    /**
     * Validate region and jurisdiction set by the remote peer.
     *
     * @param remoteProps.
     * @param ipAddress version 4 or 6.
     * @throws if not validated correctly or on lookup error.
     */
    protected validateRemoteProps(remoteProps: PeerProps, ipAddress: string | undefined) {
        if (remoteProps.region && remoteProps.region.length > 0) {
            const ipRegion = RegionUtil.GetRegionByIpAddress(ipAddress);

            if (!ipRegion) {
                throw new Error(`Could not lookup IP address: ${ipAddress}`);
            }

            if (ipRegion !== remoteProps.region) {
                throw new Error(`Region ${remoteProps.region} does not match IP lookup of ${ipAddress}`);
            }
        }

        if (remoteProps.jurisdiction && remoteProps.jurisdiction.length > 0) {
            // TODO: FIXME: 0.9.8-beta1.
            // We currently have no possibility to enforce that the user belongs
            // to a specific jurisdiction as remoteProps.jurisdiction might state.
        }
    }

    /**
     * Validate the certificate in the storage and if applicable also online.
     * A cert which is not marked as indestructible can have been destroyed by destroy-nodes,
     * this we must check in our connected storage.
     * Furthermore if the auth cert is dynamic in it self then we need to see that the cert is marked as active.
     * We assume that the auth cert is already cryptographically verified and validated against its intended target.
     *
     * @returns 0 if auth cert successfully validates in the storage.
     * 1 if the auth cert cannot be verified likely due to a destroy node destroying the cert.
     * 2 if a dynamic cert did not become active within the timeout.
     */
    protected async validateAuthCert(authCert: AuthCertInterface, storageP2PClient: P2PClient): Promise<number> {
        let wrappedAuthCertDataNode = await this.fetchAuthCertDataWrapper(authCert, storageP2PClient);

        if (!wrappedAuthCertDataNode) {
            // Attempt to store
            if (! await this.storeAuthCertDataWrapper(authCert, storageP2PClient)) {
                return 1;
            }

            // Read again
            wrappedAuthCertDataNode = await this.fetchAuthCertDataWrapper(authCert, storageP2PClient);
        }

        if (!wrappedAuthCertDataNode) {
            // It seems as there are destroy nodes present for the auth cert,
            // since it cannot be read back even if stored again.
            return 1;
        }

        if (!wrappedAuthCertDataNode.isDynamic()) {
            // If the node is not dynamic then we are all good already.
            return 0;
        }

        // Node is dynamic but not marked as active.
        // Fetch is immediately first, then wait 10 secs before fetching it again
        // to give it time to become active. Try threee times in total.
        for (let i=0; i<4; i++) {
            // Sleep some to await cert potentially becoming active.
            await sleep(i * 3000);

            // Now fetch the wrapper again, but tell it to ignore any non-active nodes.
            // Note we could solve this using preserveTransient, but storages are not require
            // to support that feature. This way is rock solid.
            wrappedAuthCertDataNode = await this.fetchAuthCertDataWrapper(authCert, storageP2PClient, true);
            if (wrappedAuthCertDataNode) {
                return 0;
            }

        }

        return 2;
    }

    protected async fetchAuthCertDataWrapper(authCert: AuthCertInterface, storageP2PClient: P2PClient, ignoreInactive: boolean = false): Promise<DataInterface | undefined> {
        const owner = storageP2PClient.getLocalPublicKey();
        const parentId = Buffer.alloc(32).fill(255);
        const exportedAuthCert = authCert.export();

        // A fetch request to query for data nodes wrapping the authcert.
        const fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            depth: 1,
            cutoffTime: 0n,
            ignoreInactive,
            discardRoot: true,
            match: [
                {
                    nodeType: Data.GetType(),
                    filters: [
                        {
                            field: "refId",
                            cmp: CMP.EQ,
                            value: authCert.calcId1().toString("hex"),
                        },
                        {
                            field: "owner",
                            cmp: CMP.EQ,
                            value: owner.toString("hex"),
                        },
                        {
                            field: "contentType",
                            cmp: CMP.EQ,
                            value: SPECIAL_NODES.AUTHCERT,
                        },
                        {
                            field: "embedded",
                            operator: "hash",
                            cmp: CMP.EQ,
                            value: Hash(exportedAuthCert),
                        },
                        {
                            field: "dataConfig",
                            operator: `& ${(2**DataConfig.SPECIAL)}`,
                            cmp: CMP.GT,
                            value: 0,
                        },
                    ],
                }
            ]
        }});

        const {getResponse} = storageP2PClient.fetch(fetchRequest);
        if (!getResponse) {
            return undefined;
        }

        const anyData = await getResponse.onceAny();

        if (anyData.type === EventType.REPLY) {
            const fetchResponse = anyData.response;
            if (fetchResponse && fetchResponse.status === Status.RESULT) {
                const nodes = StorageUtil.ExtractFetchResponseNodes(fetchResponse);
                if (nodes.length > 0) {
                    return nodes[0] as DataInterface;
                }
            }
        }

        return undefined;
    }

    protected async storeAuthCertDataWrapper(authCert: AuthCertInterface, storageP2PClient: P2PClient): Promise<boolean> {
        const owner = storageP2PClient.getLocalPublicKey();
        const parentId = Buffer.alloc(32).fill(255);
        const exportedAuthCert = authCert.export();
        const refId = authCert.calcId1();

        const dataNode = await this.nodeUtil.createDataNode(
            {
                hasDynamicEmbedding: authCert.isDynamic(),
                owner,
                parentId,
                isSpecial: true,
                embedded: exportedAuthCert,
                contentType: SPECIAL_NODES.AUTHCERT,
                refId,
            }, this.config.keyPair, this.config.nodeCerts);

        const storeRequest = StorageUtil.CreateStoreRequest({nodes: [dataNode.export()]});

        const {getResponse} = storageP2PClient.store(storeRequest);
        if (!getResponse) {
            return false;
        }

        const anyData = await getResponse.onceAny();
        if (anyData.type === EventType.REPLY) {
            const storeResponse = anyData.response;
            if (storeResponse?.status === Status.RESULT) {
                if (storeResponse.storedId1.length === 1) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * A connection has been established.
     * @param p2pClient
     */
    protected connected(p2pClient: P2PClient) {
        if (!this.state.storageClient || !this.config.keyPair) {
            console.debug("Storage not setup properly, closing incoming socket.");
            p2pClient.close();
            return;
        }

        const localConnectionType = p2pClient.getLocalProps().connectionType ?? 0;
        const remoteConnectionType = p2pClient.getRemoteProps().connectionType ?? 0;
        const localClientType = localConnectionType & (ConnectionType.STORAGE_CLIENT | ConnectionType.EXTENDER_CLIENT);
        const remoteClientType = remoteConnectionType & (ConnectionType.STORAGE_CLIENT | ConnectionType.EXTENDER_CLIENT);
        const localServerType = localConnectionType & (ConnectionType.STORAGE_SERVER | ConnectionType.EXTENDER_SERVER);
        const remoteServerType = remoteConnectionType & (ConnectionType.STORAGE_SERVER | ConnectionType.EXTENDER_SERVER);

        // Shared across instances using the same underlaying P2PClient,
        // so that an AutoFetcher fetching from remote will not trigger the remotes
        // subscriptions it may have on on the storage the AutoFetcher it storing to.
        const muteMsgIds: Buffer[] = [];
        const reverseMuteMsgIds: Buffer[] = [];

        let autoFetcher: P2PClientAutoFetcher | undefined;
        let autoFetcherReverse: P2PClientAutoFetcher | undefined;
        let storageForwarder: P2PClientForwarder | undefined;
        let storageExtender: P2PClientExtender | undefined;

        if (localClientType === ConnectionType.STORAGE_CLIENT) {
            if ((remoteServerType & ConnectionType.STORAGE_SERVER) === ConnectionType.STORAGE_SERVER) {
                autoFetcher = new P2PClientAutoFetcher(p2pClient, this.state.storageClient, muteMsgIds, reverseMuteMsgIds);
                autoFetcher.onBlob(this.onBlobHandler);

                autoFetcherReverse = new P2PClientAutoFetcher(p2pClient, this.state.storageClient, muteMsgIds, reverseMuteMsgIds, true);
                autoFetcherReverse.onBlob(this.onBlobHandler);

                autoFetcher.addFetch(this.config.autoFetch);
                autoFetcherReverse.addFetch(this.config.autoFetch);
                this.state.autoFetchers.push(autoFetcher, autoFetcherReverse);
            }
            else {
                // Remote does not support Storage connections.
                console.debug("Remote does not support Storage client to connect.");
                p2pClient.close();
                return;
            }
        }
        else if (localClientType === ConnectionType.EXTENDER_CLIENT) {
            if ((remoteServerType & ConnectionType.EXTENDER_SERVER) === ConnectionType.EXTENDER_SERVER) {
                autoFetcher = new P2PClientAutoFetcher(p2pClient, this.state.storageClient, muteMsgIds, reverseMuteMsgIds);
                autoFetcher.onBlob(this.onBlobHandler);

                autoFetcherReverse = new P2PClientAutoFetcher(p2pClient, this.state.storageClient, muteMsgIds, reverseMuteMsgIds, true);
                autoFetcherReverse.onBlob(this.onBlobHandler);

                autoFetcher.addFetch(this.config.autoFetch);
                autoFetcherReverse.addFetch(this.config.autoFetch);
                this.state.autoFetchers.push(autoFetcher, autoFetcherReverse);
            }
            else {
                // Remote does not support Extender connections.
                console.debug("Remote does not support Extender client to connect.");
                p2pClient.close();
                return;
            }
        }

        if (remoteClientType === ConnectionType.STORAGE_CLIENT) {
            if ((localServerType & ConnectionType.STORAGE_SERVER) === ConnectionType.STORAGE_SERVER) {
                storageForwarder = new P2PClientForwarder(p2pClient, this.state.storageClient, muteMsgIds);
                this.state.storageServers.push(storageForwarder);
                console.debug("Spawn Storage server forwarder.");
            }
            else {
                // Local does not support Storage connections.
                console.debug("Peer local side does not support remote peer to connect as Storage client.");
                p2pClient.close();
                return;
            }
        }
        else if (remoteClientType === ConnectionType.EXTENDER_CLIENT) {
            if ((localServerType & ConnectionType.EXTENDER_SERVER) === ConnectionType.EXTENDER_SERVER) {
                storageExtender = new P2PClientExtender(p2pClient, this.state.storageClient,
                                                              this.config.keyPair, this.config.nodeCerts,
                                                              this.signatureOffloader, muteMsgIds);
                this.state.extenderServers.push(storageExtender);
                console.debug("Spawn Extender server.");
            }
            else {
                // Local does not support Extender connections.
                console.debug("Peer local side does not support remote peer to connect as Extender client.");
                p2pClient.close();
                return;
            }
        }

        p2pClient.onClose( () => {
            autoFetcher?.close();
            storageForwarder?.close();
            storageExtender?.close();
            this.garbageCollectClients();
            this.triggerEvent(EVENTS.CONNECTION_CLOSE.name, {p2pClient});
        });

        this.triggerEvent(EVENTS.CONNECTION_CONNECT.name, {p2pClient});
    }

    protected onBlobHandler = (blobEvent: BlobEvent /*, autoFetcher: P2PClientAutoFetcher*/) => {
        if (blobEvent.error) {
            if (blobEvent.error.isRead) {
                console.error(`Error fetching blob with nodeId1: ${blobEvent.nodeId1.toString("hex")}, ${blobEvent.error.message}`);
            }
            else if (blobEvent.error.isRead === false) {
                console.error(`Error storing blob with nodeId1: ${blobEvent.nodeId1.toString("hex")}, ${blobEvent.error.message}`);
            }
            else {
                console.error(`Error fetching/writing blob with nodeId1: ${blobEvent.nodeId1.toString("hex")}, ${blobEvent.error.message}`);
            }
        }
        else {
            console.info(`Blob with nodeId1 ${blobEvent.nodeId1.toString("hex")} successfully downloaded.`);
        }
    }

    /**
     * Called when a storage connection has been setup, either locally or to a remote.
     * @param p2pClient
     */
    protected storageConnected(internalStorageClient: P2PClient, externalStorageClient?: P2PClient) {
        if (this.state.storageClient) {
            console.warn("Storage already connected.");
            internalStorageClient.close();
            return;
        }

        const localConnectionType = internalStorageClient.getLocalProps().connectionType ?? 0;
        const remoteConnectionType = internalStorageClient.getRemoteProps().connectionType ?? 0;
        const localClientType = localConnectionType & (ConnectionType.STORAGE_CLIENT | ConnectionType.EXTENDER_CLIENT);
        const remoteServerType = remoteConnectionType & (ConnectionType.STORAGE_SERVER | ConnectionType.EXTENDER_SERVER);

        if (localClientType === ConnectionType.STORAGE_CLIENT) {
            if ((remoteServerType & ConnectionType.STORAGE_SERVER) !== ConnectionType.STORAGE_SERVER) {
                console.error("Remote server is not storage server, as expected. Closing.");
                internalStorageClient.close();
                return;
            }
        }
        else if (localClientType === ConnectionType.EXTENDER_CLIENT) {
            if ((remoteServerType & ConnectionType.EXTENDER_SERVER) !== ConnectionType.EXTENDER_SERVER) {
                console.error("Remote server is not extender server, as expected. Closing.");
                internalStorageClient.close();
                return;
            }
        }
        else {
            console.error("Local client type is unexpected. Closing.");
            internalStorageClient.close();
            return;
        }

        this.state.storageClient = internalStorageClient;
        this.state.externalStorageClient = externalStorageClient;

        this.state.externalStorageClient?.onClose( () => {
            delete this.state.externalStorageClient;
        });

        this.state.storageClient.onClose( () => {
            delete this.state.storageClient;
            this.triggerEvent(EVENTS.STORAGE_CLOSE.name, {p2pClient: externalStorageClient});
            this.closeConnectionFactories();
            // Note: we do not delete storageFactory here, because it might spawn a new connection for us.
        });

        if (this.config.autoStartConnections) {
            this.initConnectionFactories();
        }

        this.triggerEvent(EVENTS.STORAGE_CONNECT.name, {p2pClient: externalStorageClient});
    }

    /**
     * Create a PeerProps object for this side.
     * this.config.keyPair is expected to have been set.
     * @param connectionType must be set to the expected and supported connection type(s).
     * @param region set if applicable
     * @param jurisdiction set if applicable
     * @param appVersion set if applicable
     * @returns localProps
     */
    protected makePeerProps(connectionType: number, region?: string, jurisdiction?: string, appVersion?: Buffer): PeerProps {
        return {
            connectionType,
            version: P2PClient.Version,
            serializeFormat: P2PClient.Formats[0],
            handshakedPublicKey: this.config.keyPair ? this.config.keyPair.publicKey : Buffer.alloc(0),
            authCert: this.config.authCert,
            authCertPublicKey: this.config.authCert ? this.config.authCert.getIssuerPublicKey() : undefined,
            clock: Date.now(),
            region,
            jurisdiction,
            appVersion,
        };
    }

    /**
     * Create a HandshakeFactoryConfig from a template, ready to be used.
     * Expects that config.keyPair is set.
     * @param handshakeFactoryConfig the template to complement
     * @param localProps
     * @returns handshakeFactoryConfig with keyPair and peerData properties set.
     * @throws
     */
    protected makeHandshakeFactoryConfig(handshakeFactoryConfig: HandshakeFactoryConfig, localProps: PeerProps): HandshakeFactoryConfig {
        if (!this.config.keyPair) {
            throw new Error("KeyPair must be set to create handshake factory config.");
        }
        // Copy the config to not alter the template object.
        const handshakeFactoryConfig2 = DeepCopy(handshakeFactoryConfig) as HandshakeFactoryConfig;
        handshakeFactoryConfig2.keyPair = this.config.keyPair;
        handshakeFactoryConfig2.peerData = (/*isServer: boolean*/) => {
            // We need to get a fresh timestamp of when entering the handshake.
            // This is important for the calculated clock skew to be correct.
            // Note that this mutates the localProps object which is the same object
            // used after handshake when instantiating the P2PClient.
            localProps.clock = Date.now();
            return PeerDataUtil.PropsToPeerData(localProps).export();
        };

        return handshakeFactoryConfig2;
    }

    public getStorageConnectionFactories(): HandshakeFactory[] | undefined {
        return this.state.storageConnectionFactories;
    }

    public getConnectionFactories(): HandshakeFactory[] {
        return this.state.connectionFactories;
    }

    /**
     * Hook event for when the Service starts trying to connect to Storage.
     * @param callback
     */
    public onStart(callback: StartCallback) {
        this.hookEvent(EVENTS.START.name, callback);
    }

    /**
     * Hook event for when the Service is stopped, either manually or if Storage connection closes.
     * @param callback
     */
    public onStop(callback: StopCallback) {
        this.hookEvent(EVENTS.STOP.name, callback);
    }

    /**
     * Event emitted when a connection to Storage has been setup.
     */
    public onStorageFactoryCreate(callback: StorageFactoryCreateCallback) {
        this.hookEvent(EVENTS.STORAGE_FACTORY_CREATE.name, callback);
    }

    public onStorageParseError(callback: StorageParseErrorCallback) {
        this.hookEvent(EVENTS.STORAGE_PARSE_ERROR.name, callback);
    }

    public onStorageAuthCertError(callback: StorageAuthCertErrorCallback) {
        this.hookEvent(EVENTS.STORAGE_AUTHCERT_ERROR.name, callback);
    }

    /**
     * Event emitted when a connection to Storage has been setup.
     */
    public onStorageConnect(callback: StorageConnectCallback) {
        this.hookEvent(EVENTS.STORAGE_CONNECT.name, callback);
    }

    /**
     * Event emitted when the storage connection has closed.
     */
    public onStorageClose(callback: StorageCloseCallback) {
        this.hookEvent(EVENTS.STORAGE_CLOSE.name, callback);
    }

    /**
     * Event emitted when there is an error on socket, handshake or validating an auth cert.
     */
    public onStorageError(callback: StorageErrorCallback) {
        this.hookEvent(EVENTS.STORAGE_ERROR.name, callback);
    }

    /**
     * Event emitted when the handshake factory for a peer connection has been setup.
     * This factory can be used to more closely monitor events directly on the factory,
     * and also to tune and set parameters such as blocked IP addresses.
     */
    public onConnectionFactoryCreate(callback: ConnectionFactoryCreateCallback) {
        this.hookEvent(EVENTS.CONNECTION_FACTORY_CREATE.name, callback);
    }

    public onConnectionParseError(callback: ConnectionParseErrorCallback) {
        this.hookEvent(EVENTS.CONNECTION_PARSE_ERROR.name, callback);
    }

    public onConnectionAuthCertError(callback: ConnectionAuthCertErrorCallback) {
        this.hookEvent(EVENTS.CONNECTION_AUTHCERT_ERROR.name, callback);
    }

    /**
     * Event emitted when a peer has connected.
     */
    public onConnectionConnect(callback: ConnectionConnectCallback) {
        this.hookEvent(EVENTS.CONNECTION_CONNECT.name, callback);
    }

    /**
     * Event emitted when a connected peer has closed.
     */
    public onConnectionClose(callback: ConnectionCloseCallback) {
        this.hookEvent(EVENTS.CONNECTION_CLOSE.name, callback);
    }

    /**
     * Event emitted when there is an error on socket, handshake or validating an auth cert.
     */
    public onConnectionError(callback: ConnectionErrorCallback) {
        this.hookEvent(EVENTS.CONNECTION_ERROR.name, callback);
    }

    /**
     * Event emitted when the handshake factory for a client storage connection has been setup.
     * This factory can be used to more closely monitor events directly on the factory,
     * and also to tune and set parameters such as blocked IP addresses.
     */
    public onClientStorageFactoryCreate(callback: ConnectionFactoryCreateCallback) {
        this.hookEvent(EVENTS.CONNECTION_FACTORY_CREATE.name, callback);
    }

    protected hookEvent(name: string, callback: ( (...args: any) => void)) {
        const cbs = this.handlers[name] || [];
        this.handlers[name] = cbs;
        cbs.push(callback);
    }

    protected unhookEvent(name: string, callback: ( (...args: any) => void)) {
        const cbs = (this.handlers[name] || []).filter( (cb: ( (...args: any) => void)) => callback !== cb );
        this.handlers[name] = cbs;
    }

    protected triggerEvent(name: string, ...args: any) {
        const cbs = this.handlers[name] || [];
        cbs.forEach( (callback: ( (...args: any) => void)) => {
            setImmediate( () => callback(...args) );
        });
    }
}
