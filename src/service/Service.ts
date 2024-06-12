import { strict as assert } from "assert";

import {
    CreatePair,
    SocketFactoryStats,
    ClientInterface,
} from "pocket-sockets";

import {
    Messaging,
    HandshakeFactoryInterface,
    HandshakeResult,
    EventType,
    HandshakeFactoryConfig,
} from "pocket-messaging";

import {
    SignatureOffloaderInterface,
} from "../signatureoffloader/types";

import {
    Decoder,
} from "../decoder";

import {
    P2PClient,
    PeerDataUtil,
    PeerData,
    AutoFetch,
    P2PClientForwarder,
    P2PClientExtender,
    P2PClientAutoFetcher,
    BlobEvent,
    Formats,
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
    PrimaryNodeCertInterface,
    AuthCertInterface,
    DataInterface,
    CMP,
    Hash,
    DATA0_NODE_TYPE,
    KeyPair,
    Data,
} from "../datamodel";

import {
    Status,
    Version,
} from "../types";

import {
    RegionUtil,
} from "../util/RegionUtil";

import {
    DatabaseConfig,
    ConnectionConfig,
    ApplicationConf,
    SyncConf,
    WalletConf,
    ServiceStartCallback,
    ServiceStopCallback,
    ServicePeerCloseCallback,
    ServicePeerConnectCallback,
    ServicePeerFactoryCreateCallback,
    ServicePeerParseErrorCallback,
    ServicePeerAuthCertErrorCallback,
    ServiceStorageCloseCallback,
    ServiceStorageConnectCallback,
    ServiceStorageFactoryCreateCallback,
    ServiceStorageParseErrorCallback,
    ServiceStorageAuthCertErrorCallback,
    EVENT_SERVICE_START,
    EVENT_SERVICE_STOP,
    EVENT_SERVICE_BLOB,
    EVENT_SERVICE_STORAGE_CLOSE,
    EVENT_SERVICE_STORAGE_CONNECT,
    EVENT_SERVICE_STORAGE_FACTORY_CREATE,
    EVENT_SERVICE_STORAGE_AUTHCERT_ERROR,
    EVENT_SERVICE_STORAGE_PARSE_ERROR,
    EVENT_SERVICE_PEER_FACTORY_CREATE,
    EVENT_SERVICE_PEER_CONNECT,
    EVENT_SERVICE_PEER_CLOSE,
    EVENT_SERVICE_PEER_AUTHCERT_ERROR,
    EVENT_SERVICE_PEER_PARSE_ERROR,
} from "./types";

import {
    AuthFactoryConfig,
    AuthFactoryInterface,
    NativeAuthFactoryConfig,
} from "../auth/types";

import {
    DeepCopy,
    DeepEquals,
    DeepHash,
    sleep,
    PromiseCallback,
    CopyBuffer,
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

import {
    Thread,
    ThreadTemplate,
    ThreadTemplates,
} from "../storage/thread";

import {
    AuthFactory,
} from "../auth/AuthFactory";

declare const window: any;
declare const process: any;
declare const browser: any;
declare const chrome: any;

const isNode = (typeof process !== "undefined" && process?.versions?.node);
let isBrowser = false;
if (!isNode) {
    isBrowser = typeof window !== "undefined" || typeof browser !== "undefined" || typeof chrome !== "undefined";
    if(!isBrowser) {
        assert(false, "Unexpected error: current environment is neither Node.js, browser or browser extension");
    }
}

const console = PocketConsole({module: "Service"});


/**
 * The configuration of this Service.
 * These configs are allowed to change in runtime by calling the set functions,
 * however when in the running state they might not be modifiable.
 */
type ServiceConfig = {
    /** Optional AuthCert of this side. It is used to authenticate as another public key. */
    authCert?: AuthCertInterface,

    /** Certificates used for signing new nodes when having authenticated using an Auth Cert. */
    nodeCerts: PrimaryNodeCertInterface[],

    /** Set if using a database (either in-mem or disk-backed). Mutually exclusive to storageConnectionConfigs. */
    databaseConfig?: DatabaseConfig,

    /**
     * Added to if using a remote storage connected to over socket. Mutually exclusive to databaseConfig.
     * There can be many connection factories but only one connected socket will be allowed.
     */
    storageConnectionConfigs: ConnectionConfig[],

    /**
     */
    peerConnectionConfigs: ConnectionConfig[],

    /** AutoFetch objects to initiate on autoFetcher clients. */
    autoFetch: {[hash: string]: {autoFetch: AutoFetch, count: number}},
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
    storageConnectionFactories: HandshakeFactoryInterface[],

    /**
     * The connections factories instantiated from the peerConnectionConfigs.
     * Matches config.peerConnectionConfigs on index.
     */
    peerConnectionFactories: HandshakeFactoryInterface[],

    /**
     * Initially this value gtes copied from databaseConfig.driver.reconnectDelay.
     * If it is set to 0 or undefined then reconnect is cancelled.
     */
    localDatabaseReconnectDelay?: number,
};


/**
 */
export class Service {
    protected _isRunning: boolean = false;
    protected _isClosed: boolean = false;
    protected handlers: {[name: string]: ( (...args: any) => void)[]} = {};

    /** The configuration of the whole Service, which is partly allowed to change during runtime. */
    protected config: ServiceConfig;

    /** The current running state. */
    protected state: ServiceState;

    protected nodeUtil: NodeUtil;

    /** Storage connection factories share socket stats to not make redundant connections. */
    protected sharedStorageFactoriesSocketFactoryStats: SocketFactoryStats;

    /**
     * The cryptographic public key of the user running the Service.
     * The key pair must have been added to the SignatureOffloader
     * and the first key is extracted from there and set as publicKey on init().
     */
    protected publicKey: Buffer = Buffer.alloc(0);

    protected threadTemplates: ThreadTemplates = {};

    protected applicationConf: ApplicationConf;

    /**
     * After class has been constructed call init() then call start().
     *
     * @param applicationConf configuration object to setup the Service
     * @param walletConf wallet confuguration data. KeyPairs are added to the given signatureOffloader.
     *  Note that the walletConf is kept as a reference, it is not copied, meaning the outside must not change it.
     * @param signatureOffloader if not already initiated with key pairs then keyPairs
     * must be provided in the walletConf.
     * @param authFactory
     */
    constructor(applicationConf: ApplicationConf, protected walletConf: WalletConf,
        protected signatureOffloader: SignatureOffloaderInterface,
        protected authFactory: AuthFactoryInterface)
    {
        if (applicationConf.format !== 1) {
            throw new Error("Unknown ApplicationConf format, expecting 1");
        }

        if (walletConf.authCert && !walletConf.nodeCerts?.length) {
            throw new Error("When using an authCert also nodeCerts are required");
        }

        this.applicationConf   = DeepCopy(applicationConf);

        this.nodeUtil = new NodeUtil(this.signatureOffloader);

        this.sharedStorageFactoriesSocketFactoryStats = {counters: {}};

        this.config = {
            nodeCerts: [],
            peerConnectionConfigs: [],
            storageConnectionConfigs: [],
            autoFetch: {},
        };

        this.state = {
            autoFetchers: [],
            storageServers: [],
            extenderServers: [],
            storageConnectionFactories: [],
            peerConnectionFactories: [],
            localDatabaseReconnectDelay: undefined,
        };
    }

    public async init() {
        if (this.publicKey.length > 0) {
            throw new Error("Service already initiated");
        }

        const promises: Promise<void>[] = this.walletConf.keyPairs.map( (keyPair: KeyPair) => this.signatureOffloader.addKeyPair(keyPair) );
        await Promise.all(promises);

        const publicKeys = await this.signatureOffloader.getPublicKeys();

        if (publicKeys.length === 0) {
            throw new Error("No public keys added to SignatureOffloader");
        }

        this.publicKey = publicKeys[0];

        if (this.walletConf.authCert) {
            await this.setAuthCert(this.walletConf.authCert);
        }

        for (let i=0; i<this.walletConf.nodeCerts.length; i++) {
            await this.addNodeCert(this.walletConf.nodeCerts[i]);
        }

        if (this.walletConf.storage.peer) {
            this.addStorageConnectionConfig(this.walletConf.storage.peer);
        }
        else if (this.walletConf.storage.database) {
            this.setDatabaseConfig(this.walletConf.storage.database);
        }
        else {
            throw new Error("Missing walletConf.storage configuration");
        }

        for(const name in this.applicationConf.threads) {
            this.addThreadTemplate(name, this.applicationConf.threads[name]);
        }

        this.applicationConf.peers.forEach( (peerConf: ConnectionConfig) => {
            this.addPeerConnectionConfig(peerConf);
        });

        this.applicationConf.sync.forEach( (sync: SyncConf) => {
            this.addSync(sync);
        });
    }

    /**
     * Start this Service.
     *
     * @throws
     */
    public async start() {
        if (this._isClosed) {
            throw new Error("Attempting to (re-)start a Service which has been closed.");
        }

        if (this._isRunning) {
            return;
        }

        if (this.publicKey.length === 0) {
            throw new Error("PublicKey not set. Service must be initiated before started.");
        }

        this._isRunning = true;

        this.triggerEvent(EVENT_SERVICE_START);

        try {
            await this.initStorage();
        }
        catch(e) {
            this._isRunning = false;

            const storageParseErrorEvent: Parameters<ServiceStorageParseErrorCallback> =
                [e as Error];

            this.triggerEvent(EVENT_SERVICE_STORAGE_PARSE_ERROR, ...storageParseErrorEvent);

            this.triggerEvent(EVENT_SERVICE_STOP);
        }
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
        this.closePeerConnectionFactories();
        this.triggerEvent(EVENT_SERVICE_STOP);
    }

    /**
     * Stop the Service and make it unstartable again.
     *
     */
    public close() {
        if (this._isClosed) {
            return;
        }

        this._isClosed = true;

        this.stop();
    }

    /**
     * @returns true if the Service is running.
     */
    public isRunning(): boolean {
        return this._isRunning;
    }

    /**
     * @returns true if Service has been explicitly closed by calling close().
     */
    public isClosed(): boolean {
        return this._isClosed;
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

    public getNodeUtil(): NodeUtil {
        return this.nodeUtil;
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

        this.state.storageConnectionFactories.forEach( (factory: HandshakeFactoryInterface) => {
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
     * Return the public key of this side.
     * Primarily return the root issuer public key from the Auth Cert,
     * secondary return the public key from the SignatureOffloader.
     * @returns publicKey from authCert or SignatureOffloader.
     */
    public getPublicKey(): Buffer {
        if (this.config.authCert) {
            const publicKey = this.config.authCert.getIssuerPublicKey();
            assert(publicKey && publicKey.length > 0);
            return CopyBuffer(publicKey);
        }

        return this.getSignerPublicKey();
    }

    /**
     * @returns the signer publicKey, regardless if using authCert.
     */
    public getSignerPublicKey(): Buffer {
        return CopyBuffer(this.publicKey);
    }

    /**
     * @returns the custom object from the ApplicationConf object.
     */
    public getCustomConfig(): {[key: string]: any} {
        return DeepCopy(this.applicationConf.custom);
    }

    public getWalletConf(): WalletConf {
        return DeepCopy(this.walletConf);
    }

    public getApplicationConf(): ApplicationConf {
        return DeepCopy(this.applicationConf);
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

    public addThreadTemplate(name: string, threadTemplate: ThreadTemplate) {
        this.threadTemplates[name] = DeepCopy(threadTemplate);
    }

    public getThreadTemplates(): ThreadTemplates {
        return DeepCopy(this.threadTemplates);
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

        // hot-update the NodeUtil with new cert list.
        this.nodeUtil.setNodeCerts(this.config.nodeCerts);
    }

    /**
     * Remove specific node cert from the config and from all extenders.
     * @param nodeCert to be removed.
     */
    public removeNodeCert(nodeCert: PrimaryNodeCertInterface) {
        this.config.nodeCerts = this.config.nodeCerts.filter( (nodeCert2: PrimaryNodeCertInterface) => {
            return !nodeCert.calcId1().equals(nodeCert2.calcId1());
        });

        // hot-update the extenders with new cert list.
        this.state.extenderServers.forEach( (extender: P2PClientExtender) => {
            extender.setNodeCerts(this.config.nodeCerts);
        });

        // hot-update the NodeUtil with new cert list.
        this.nodeUtil.setNodeCerts(this.config.nodeCerts);
    }

    /**
     * @returns array copy of all node certs.
     */
    public getNodeCerts(): PrimaryNodeCertInterface[] {
        return this.config.nodeCerts.slice();
    }

    /**
     * Set (and replace current local/remote) storage.
     * @param databaseConfig
     * @throws if running.
     */
    public setDatabaseConfig(databaseConfig: DatabaseConfig | undefined) {
        if (this._isRunning) {
            throw new Error("Cannot set databaseConfig while running.");
        }

        this.config.databaseConfig = databaseConfig;

        this.state.localDatabaseReconnectDelay = this.config.databaseConfig?.driver.reconnectDelay;
    }

    /**
     * Add connection configuration.
     *
     * The NativeHandshakeFactoryConfig in the ConnectionConfig will be complemented with
     * peerData upon connecting.
     *
     * If existing storage client and service started then immediately init the connection factory.
     * @param connectionConfig object
     */
    public addPeerConnectionConfig(connectionConfig: ConnectionConfig) {
        if (AuthFactory.IsNativeHandshake(connectionConfig.authFactoryConfig) ||
            AuthFactory.IsAPIHandshake(connectionConfig.authFactoryConfig))
        {
            const handshakeFactoryConfig =
                connectionConfig.authFactoryConfig as unknown as NativeAuthFactoryConfig;

            if (!handshakeFactoryConfig.socketFactoryStats) {
                handshakeFactoryConfig.socketFactoryStats = this.sharedStorageFactoriesSocketFactoryStats;
            }
        }

        if (this.config.peerConnectionConfigs.some( (connectionConfig2: any) => DeepEquals(connectionConfig, connectionConfig2) )) {
            // Already exists.
            return;
        }

        this.config.peerConnectionConfigs.push(connectionConfig);

        if (this._isRunning && this.state.storageClient) {
            this.initPeerConnectionFactories();
        }
    }

    /**
     * Remove connection config and close factory (including its connections) if instantiated.
     *
     * @param index of the connection config to remove
     */
    public removePeerConnectionConfig(index: number) {
        this.config.peerConnectionConfigs.splice(index, 1);
        const connectionFactory = this.state.peerConnectionFactories.splice(index, 1)[0];
        connectionFactory?.close();
    }

    /**
     * Add Remote Storage connection configuration.
     *
     * The NativeAuthFactoryConfig in the ConnectionConfig will be complemented with peerData
     * upon connecting.
     *
     * If existing storage client and service is started then immediately init the connection factory.
     * @param connectionConfig object
     */
    public addStorageConnectionConfig(connectionConfig: ConnectionConfig) {
        if (this.config.storageConnectionConfigs.some( (connectionConfig2: any) => DeepEquals(connectionConfig, connectionConfig2) )) {
            // Already exists.
            return;
        }

        this.config.storageConnectionConfigs.push(connectionConfig);

        if (this._isRunning && !this.config.databaseConfig) {
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

    protected syncConfToAutoFetch(sync: SyncConf): AutoFetch[] {
        const autoFetchers: AutoFetch[] = [];

        sync.peerPublicKeys.forEach( (remotePublicKey: Buffer) => {
            const blobSizeMaxLimit = sync.blobSizeMaxLimit;

            sync.threads.forEach( syncThread => {
                const threadTemplate = this.threadTemplates[syncThread.name];

                if (!threadTemplate) {
                    throw new Error(`Missing thread template requried for sync: ${syncThread.name}`);
                }

                const threadFetchParams = DeepCopy(syncThread.threadFetchParams);

                threadFetchParams.query = threadFetchParams.query ?? {};

                const fetchRequest = Thread.GetFetchRequest(threadTemplate, threadFetchParams,
                    syncThread.stream);

                // CRDTs are not allowed to be used when auto syncing.
                fetchRequest.crdt.algo = 0;

                if (syncThread.direction === "pull" || syncThread.direction === "both") {
                    autoFetchers.push({
                        remotePublicKey,
                        fetchRequest,
                        blobSizeMaxLimit,
                        reverse: false,
                    });
                }

                if (syncThread.direction === "push" || syncThread.direction === "both") {
                    autoFetchers.push({
                        remotePublicKey,
                        fetchRequest,
                        blobSizeMaxLimit,
                        reverse: true,
                    });
                }
            });
        });

        return autoFetchers;
    }

    /**
     * This is a sugar function over addAutoFetch which uses a Thread template.
     */
    public addSync(sync: SyncConf) {
        this.syncConfToAutoFetch(sync).forEach( autoFetch => this.addAutoFetch(autoFetch) );
    }

    /**
     * Remove syncs added with addSync().
     */
    public removeSync(sync: SyncConf) {
        this.syncConfToAutoFetch(sync).forEach( autoFetch => this.removeAutoFetch(autoFetch) );
    }

    /**
     * Add AutoFetch to the autoFetchers.
     * A AutoFetch is an automated way of fetching from peers according to some rules.
     * This is useful so you don't have to write code for straight forward syncing.
     * @param autoFetch to add to autoFetchers.
     */
    public addAutoFetch(autoFetch: AutoFetch) {
        const hashStr = DeepHash(autoFetch).toString("hex");

        const item = this.config.autoFetch[hashStr] ?? {autoFetch, count: 0};

        this.config.autoFetch[hashStr] = item;

        item.count++;

        if (item.count === 1) {
            this.state.autoFetchers.forEach( (autoFetcher: P2PClientAutoFetcher) => {
                autoFetcher.addFetch([autoFetch]);
            });
        }
    }

    /**
     * Remove AutoFetch.
     * Each P2PClientAutoFetcher will unsubscribe from subscriptions it has associated with the removed autoFetch.
     * @param autoFetch to remove from autoFetchers.
     */
    public removeAutoFetch(autoFetch: AutoFetch) {
        const hashStr = DeepHash(autoFetch).toString("hex");

        const item = this.config.autoFetch[hashStr];

        if (item) {
            item.count--;

            if (item.count === 0) {
                delete this.config.autoFetch[hashStr];

                this.state.autoFetchers.forEach( (autoFetcher: P2PClientAutoFetcher) => {
                    autoFetcher.removeFetch(autoFetch);
                });
            }
        }
    }

    /**
     * @returns copy of list of all auto fetch objects.
     */
    public getAutoFetch(): AutoFetch[] {
        return Object.values(this.config.autoFetch).map( item => {
            return DeepCopy(item.autoFetch) as AutoFetch;
        });
    }

    /**
     * @throws
     */
    protected async initStorage() {
        if (this.config.databaseConfig) {
            this.initDatabase(this.config.databaseConfig);
        }
        else if (this.config.storageConnectionConfigs.length > 0) {
            await this.initStorageFactories();
        }
        else {
            throw new Error("No storage configured.");
        }
    }

    /**
     * Create and start any peer connection factory yet not started.
     * Idempotent function, can be run again after a new peer config has been added to connect to that peer.
     */
    public async initPeerConnectionFactories() {
        if (!this.state.storageClient) {
            throw new Error("Cannot init peer connection factories unless connected to storage.");
        }

        const configsToInit = this.config.peerConnectionConfigs.slice(this.state.peerConnectionFactories.length);

        const configsToInitLength = configsToInit.length;
        for (let i=0; i<configsToInitLength; i++) {
            const configToInit = configsToInit[i];
            const handshakeFactory = await this.initPeerConnectionFactory(configToInit);
            this.state.peerConnectionFactories.push(handshakeFactory);

            try {
                handshakeFactory.init();
            }
            catch(error) {
                const peerParseErrorEvent: Parameters<ServicePeerParseErrorCallback> =
                    [error as Error];

                this.triggerEvent(EVENT_SERVICE_PEER_PARSE_ERROR, ...peerParseErrorEvent);
            }
        }
    }

    /**
     * Setup and initiate a peer connection factory.
     */
    protected async initPeerConnectionFactory(config: ConnectionConfig):
        Promise<HandshakeFactoryInterface>
    {
        const authFactoryConfig = DeepCopy(config.authFactoryConfig) as AuthFactoryConfig;

        (authFactoryConfig as unknown as HandshakeFactoryConfig).peerData =
            this.makePeerData(config).export(true);

        let remotePeerData: PeerData | undefined;

        const handshakeFactory = await this.authFactory.create(authFactoryConfig);

        const peerFactoryCreateEvent: Parameters<ServicePeerFactoryCreateCallback> =
            [handshakeFactory];

        this.triggerEvent(EVENT_SERVICE_PEER_FACTORY_CREATE, ...peerFactoryCreateEvent);

        handshakeFactory.onHandshake( async (isServer: boolean, client: ClientInterface,
            wrappedClient: ClientInterface, handshakeResult: HandshakeResult) =>
        {
            try {
                if (!this.state.storageClient) {
                    // If there is no storage client there is no point proceeding with this.
                    console.debug("No Storage connected, must close newly accepted socket.");
                    wrappedClient.close();
                    return;
                }

                remotePeerData = await PeerDataUtil.HandshakeResultToPeerData(handshakeResult,
                    this.signatureOffloader, config.region, config.jurisdiction);

                // Validate region and jurisdiction provided by the remote peer.
                //
                this.validateRemotePeerData(remotePeerData, wrappedClient.getRemoteAddress());

                // We need a dedicated instance of PeerData to pass on to P2PClient.
                // We negate the clockDiff to get it for our side.
                //
                const localPeerData = this.makePeerData(config);
                localPeerData.setClockDiff(-remotePeerData.getClockDiff());

                await wrappedClient.init();

                const messaging = new Messaging(wrappedClient,
                    (authFactoryConfig as unknown as HandshakeFactoryConfig).pingInterval);

                const p2pClient = new P2PClient(messaging, localPeerData, remotePeerData,
                    config.permissions);

                // Note that the auth cert at this point is already cryptographically verified and
                // validated against the target,
                // here we also check so that it verifies online (if it has any such properties).
                //
                const authCert = remotePeerData.getAuthCert();

                if (authCert) {
                    const status = await this.validateAuthCert(authCert, this.state.storageClient);

                    if (status !== 0) {
                        const reason = status === 1 ? "The auth cert could not be verified likely due to a destroy node destroying the cert" :
                            "The auth cert could not validate within the timeout";

                        const peerAuthCertErrorEvent: Parameters<ServicePeerAuthCertErrorCallback> =
                            [new Error(reason), authCert];

                        this.triggerEvent(EVENT_SERVICE_PEER_AUTHCERT_ERROR, ...peerAuthCertErrorEvent);

                        wrappedClient.close();

                        return;
                    }
                }

                // Open after all hooks have been set.
                setImmediate( () => messaging.open() );

                this.peerConnected(p2pClient);
            }
            catch (error) {
                const peerParseErrorEvent: Parameters<ServicePeerParseErrorCallback> =
                    [error as Error];

                this.triggerEvent(EVENT_SERVICE_PEER_PARSE_ERROR, ...peerParseErrorEvent);

                wrappedClient.close();
            }
        });

        return handshakeFactory;
    }

    protected closePeerConnectionFactories() {
        this.state.peerConnectionFactories.forEach( (factory?: HandshakeFactoryInterface) => {
            factory?.close();
        });

        this.state.peerConnectionFactories = [];
    }

    /**
     * Create Storage.
     * @throws on error.
     */
    protected initDatabase(databaseConfig: DatabaseConfig) {
        if (!databaseConfig.driver.sqlite && !databaseConfig.driver.pg) {
            throw new Error("Driver not properly configured. Expecting databaseConfig.driver.sqlite/pg to be set.");
        }

        if (databaseConfig.driver.sqlite && databaseConfig.driver.pg) {
            throw new Error("Driver not properly configured. Expecting only one of databaseConfig.driver.sqlite/pg to be set.");
        }

        if (databaseConfig.blobDriver?.sqlite && databaseConfig.blobDriver?.pg) {
            throw new Error("Driver not properly configured. Expecting maxium one of databaseConfig.driver.sqlite/pg to be set.");
        }

        // Do not await this.
        this.connectDatabase(databaseConfig);
    }

    /**
     * This function does not return unless disconnected and not supposed to reconnect.
     *
     */
    protected async connectDatabase(databaseConfig: DatabaseConfig) {
        // The PeerData which the Storage sees as the this side.
        // The publicKey set here is what dictatates the permissions we have in the Storage.
        const localPeerData = this.makePeerData();

        // The PeerData of the Storage "sent" to this side in the handshake.
        // When using a database the storage uses the same keys for identity as the client side.
        const remotePeerData = this.makePeerData();

        while (true) {
            const [driver, blobDriver] = await Service.ConnectToDatabase(databaseConfig);

            if (driver) {
                // Create virtual paired sockets.
                const [socket1, socket2] = CreatePair();
                const messaging1 = new Messaging(socket1, 0);
                const messaging2 = new Messaging(socket2, 0);

                const p2pStorage = new P2PClient(messaging1, remotePeerData, localPeerData,
                    databaseConfig.permissions);

                const storage = new Storage(p2pStorage, this.signatureOffloader, driver, blobDriver/*,false, databaseConfig.blindlyTrustedPeers*/);

                storage.onClose( () => {
                    // We need to explicitly close the Driver instance.
                    driver?.close();
                    blobDriver?.close();
                });

                await storage.init();

                // This client only initiates requests and does not need any permissions to it.
                const internalStorageClient = new P2PClient(messaging2, localPeerData,
                    remotePeerData);

                messaging1.open();
                messaging2.open();

                // Create virtual paired sockets.
                const [socket3, socket4] = CreatePair();
                const messaging3 = new Messaging(socket3, 0);
                const messaging4 = new Messaging(socket4, 0);

                // Set permissions on this to limit the local app's access to the storage.
                const intermediaryStorageClient =
                    new P2PClient(messaging3, this.makePeerData(), this.makePeerData(),
                        databaseConfig.appPermissions);

                // This client only initiates requests and does not need any permissions to it.
                const externalStorageClient =
                    new P2PClient(messaging4, this.makePeerData(), this.makePeerData());

                // externalStorageClient (as client) (messaging4->messaging3) ->
                //  intermediaryStorageClient (as server) ->
                //      internalStorageClient (as client) (messaging->messaging1) ->
                //          p2pStorage (as server).
                new P2PClientForwarder(intermediaryStorageClient, internalStorageClient);

                messaging3.open();
                messaging4.open();

                const closePromise = PromiseCallback();

                internalStorageClient.onClose( () => {
                    closePromise.cb();
                });

                await this.storageConnected(internalStorageClient, externalStorageClient);

                await closePromise.promise;

                console.info("Database connection closed");
            }

            if (!this.state.localDatabaseReconnectDelay) {
                break;
            }

            console.debug(`Sleep ${this.state.localDatabaseReconnectDelay} second(s) before reconnecting`);

            await sleep(this.state.localDatabaseReconnectDelay * 1000);
        }
    }

    /**
     * Connect to databases and return drivers.
     * @param databaseConfig
     * @returns [DriverInterface?, BlobDriverInterface?]
     * @throws on error
     */
    public static async ConnectToDatabase(databaseConfig: DatabaseConfig): Promise<[DriverInterface | undefined, BlobDriverInterface | undefined]> {
        let driver: DriverInterface | undefined;
        let blobDriver: BlobDriverInterface | undefined;

        try {
            if (databaseConfig.driver.sqlite) {
                const db = isBrowser ?
                    await DatabaseUtil.OpenSQLiteJS() :
                    await DatabaseUtil.OpenSQLite(databaseConfig.driver.sqlite);
                driver = new Driver(new DBClient(db));
            }
            else if (databaseConfig.driver.pg) {
                const connection = await DatabaseUtil.OpenPG(databaseConfig.driver.pg);
                driver = new Driver(new DBClient(connection));
            }

            if (driver) {
                if (databaseConfig.blobDriver?.sqlite) {
                    const db = isBrowser ?
                        await DatabaseUtil.OpenSQLiteJS(false) :
                        await DatabaseUtil.OpenSQLite(databaseConfig.blobDriver.sqlite, false);
                    blobDriver = new BlobDriver(new DBClient(db));
                }
                else if (databaseConfig.blobDriver?.pg) {
                    const connection = await DatabaseUtil.OpenPG(databaseConfig.blobDriver.pg, false);
                    blobDriver = new BlobDriver(new DBClient(connection));
                }
            }
        }
        catch(e) {
            console.error(`Database connection error`, (e as Error).message);
            driver?.close();

            return [undefined, undefined];
        }

        if (!driver) {
            return [undefined, undefined];
        }

        await driver.init();

        if (await driver.createTables()) {
            console.debug("Database tables OK");
        }
        else {
            driver.close();
            blobDriver?.close();

            throw new Error("Database tables creation could not proceed due to inconsistent state");
        }

        if (blobDriver) {
            await blobDriver.init();

            if (await blobDriver.createTables()) {
                console.debug("Database blob tables OK");
            }
            else {
                driver.close();
                blobDriver.close();

                throw new Error("Database blob tables creation could not proceed due to inconsistent state");
            }
        }

        return [driver, blobDriver];
    }

    /**
     * Setup and initiate a factory connection factory.
     * @throws
     */
    protected async initStorageFactories() {
        const configsToInit = this.config.storageConnectionConfigs.slice(this.state.storageConnectionFactories.length);
        const configsToInitLength = configsToInit.length;

        for (let i=0; i<configsToInitLength; i++) {
            const configToInit = configsToInit[i];
            const handshakeFactory = await this.initStorageConnectionFactory(configToInit);
            this.state.storageConnectionFactories.push(handshakeFactory);

            try {
                handshakeFactory.init();
            }
            catch(error) {
                const storageParseErrorEvent: Parameters<ServiceStorageParseErrorCallback> =
                    [error as Error];

                this.triggerEvent(EVENT_SERVICE_STORAGE_PARSE_ERROR, ...storageParseErrorEvent);
            }
        }
    }

    /**
     * Init a handshake factory for connecting with remote storage.
     */
    protected async initStorageConnectionFactory(config: ConnectionConfig):
        Promise<HandshakeFactoryInterface>
    {
        const authFactoryConfig = DeepCopy(config.authFactoryConfig) as AuthFactoryConfig;

        (authFactoryConfig as unknown as HandshakeFactoryConfig).peerData =
            this.makePeerData(config).export(true);

        let remotePeerData: PeerData | undefined;

        if (AuthFactory.IsNativeHandshake(config.authFactoryConfig) ||
            AuthFactory.IsAPIHandshake(config.authFactoryConfig))
        {
            // Force this for storage connection factories using sockets
            // to limit nr of connections to 1.
            //
            (config.authFactoryConfig as unknown as NativeAuthFactoryConfig).
                socketFactoryConfig.maxConnections = 1;
        }

        const handshakeFactory = await this.authFactory.create(authFactoryConfig);

        const storageFactoryCreateEvent: Parameters<ServiceStorageFactoryCreateCallback> =
            [handshakeFactory];

        this.triggerEvent(EVENT_SERVICE_STORAGE_FACTORY_CREATE, ...storageFactoryCreateEvent);


        handshakeFactory.onHandshake( async (isServer: boolean, client: ClientInterface,
            wrappedClient: ClientInterface, handshakeResult: HandshakeResult) =>
        {
            try {
                if (this.state.storageClient) {
                    // If there is a storage client already there is no point proceeding with this.
                    console.debug("Storage client already present, closing newly opened.");
                    wrappedClient.close();
                    return;
                }

                remotePeerData = await PeerDataUtil.HandshakeResultToPeerData(handshakeResult,
                    this.signatureOffloader, config.region, config.jurisdiction);

                // Validate region and jurisdiction provided by the remote peer.
                this.validateRemotePeerData(remotePeerData, wrappedClient.getRemoteAddress());

                // We need a dedicated instance of PeerData to pass on to P2PClient.
                // We negate the clockDiff to get it for our side.
                //
                const localPeerData = this.makePeerData(config);
                localPeerData.setClockDiff(-remotePeerData.getClockDiff());

                await wrappedClient.init();

                const messaging = new Messaging(wrappedClient,
                    (authFactoryConfig as unknown as HandshakeFactoryConfig).pingInterval);

                const p2pClient = new P2PClient(messaging, localPeerData, remotePeerData);

                // Note that the auth cert at this point is already cryptographically verified
                // and validated against the target,
                // here we also check so that it verifies online (if it has any such properties).
                //
                const authCert = remotePeerData.getAuthCert();

                if (authCert) {
                    const status = await this.validateAuthCert(authCert, p2pClient);

                    if (status !== 0) {
                        const reason = status === 1 ? "The auth cert could not be verified likely due to a destroy node destroying the cert" :
                            "The auth cert could not validate within the timeout";

                        const storageAuthCertErrorEvent: Parameters<ServiceStorageAuthCertErrorCallback> =
                            [new Error(reason), authCert];

                        this.triggerEvent(EVENT_SERVICE_STORAGE_AUTHCERT_ERROR,
                            ...storageAuthCertErrorEvent);

                        wrappedClient.close();

                        return;
                    }
                }

                // Open after all hooks have been set.
                setImmediate( () => messaging.open() );

                await this.storageConnected(p2pClient, p2pClient);
            }
            catch (error) {
                const storageParseErrorEvent: Parameters<ServiceStorageParseErrorCallback> =
                    [error as Error];

                this.triggerEvent(EVENT_SERVICE_STORAGE_PARSE_ERROR, ...storageParseErrorEvent);

                wrappedClient.close();
            }
        });

        return handshakeFactory;
    }

    /**
     * Validate region and jurisdiction set by the remote peer.
     *
     * @param remotePeerData.
     * @param ipAddress version 4 or 6.
     * @throws if not validated correctly or on lookup error.
     */
    protected validateRemotePeerData(remotePeerData: PeerData, ipAddress: string | undefined) {
        const region = remotePeerData.getRegion();

        if (region && region.length > 0) {
            const ipRegion = RegionUtil.GetRegionByIpAddress(ipAddress);

            if (!ipRegion) {
                throw new Error(`Could not lookup region for IP address: ${ipAddress}`);
            }

            if (ipRegion !== region) {
                throw new Error(`Region ${region} does not match IP lookup of ${ipAddress}`);
            }
        }

        const jurisdiction = remotePeerData.getJurisdiction();

        if (jurisdiction && jurisdiction.length > 0) {
            // TODO: FIXME: 0.9.8-beta1.
            // We currently have no possibility to enforce that the user belongs
            // to a specific jurisdiction as remotePeerData.getJurisdiction() might state.
        }
    }

    /**
     * Validate the certificate in the storage and if applicable also online.
     * A cert which is not marked as indestructible can have been destroyed by destroy-nodes,
     * this we must check in our connected storage.
     * Furthermore if the auth cert is online in it self then we need to see that the cert is marked as validated.
     * We assume that the auth cert is already cryptographically verified and validated against its intended target.
     *
     * @returns 0 if auth cert successfully validates in the storage.
     * 1 if the auth cert cannot be verified likely due to a destroy node destroying the cert.
     * 2 if a online cert did not become validated within the timeout.
     */
    protected async validateAuthCert(authCert: Buffer, storageP2PClient: P2PClient): Promise<number> {
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

        if (!wrappedAuthCertDataNode.hasOnline()) {
            // If the node is not online then we are all good already.
            return 0;
        }

        // Node is online but not marked as validated.
        // Fetch is immediately first, then wait i*3 secs before fetching it again
        // to give it time to become online. Try three times in total.
        for (let i=0; i<4; i++) {
            // Sleep some to await cert potentially becoming valid.
            await sleep(i * 3000);

            // Now fetch the wrapper again, but tell it to ignore any non-valid nodes.
            // Note we could solve this using preserveTransient, but storages are not require
            // to support that feature. This way is rock solid.
            wrappedAuthCertDataNode = await this.fetchAuthCertDataWrapper(authCert, storageP2PClient, true);
            if (wrappedAuthCertDataNode) {
                return 0;
            }

        }

        return 2;
    }

    protected async fetchAuthCertDataWrapper(authCert: Buffer, storageP2PClient: P2PClient, ignoreInactive: boolean = false): Promise<DataInterface | undefined> {
        const parentId = Hash(authCert);

        // A fetch request to query for data nodes wrapping the authcert.
        const fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            depth: 1,
            cutoffTime: 0n,
            ignoreInactive,
            discardRoot: true,
            sourcePublicKey: this.publicKey,
            targetPublicKey: this.publicKey,
            match: [
                {
                    nodeType: DATA0_NODE_TYPE,
                    filters: [
                        {
                            field: "owner",
                            cmp: CMP.EQ,
                            value: this.publicKey,
                        },
                        {
                            field: "contentType",
                            cmp: CMP.EQ,
                            value: "temporary/authCert",
                        },
                        {
                            field: "embedded",
                            operator: "hash",
                            cmp: CMP.EQ,
                            value: Hash(authCert),
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
                const nodes = StorageUtil.ExtractFetchResponseNodes(fetchResponse, false, Data.GetType(4)) as DataInterface[];

                if (nodes.length > 0) {
                    return nodes[0];
                }
            }
        }

        return undefined;
    }

    protected async storeAuthCertDataWrapper(authCert: Buffer, storageP2PClient: P2PClient): Promise<boolean> {
        const authCertObj = Decoder.DecodeAuthCert(authCert);

        const parentId = Hash(authCert);

        const dataNode = await this.nodeUtil.createDataNode(
            {
                hasOnlineEmbedding: authCertObj.hasOnline(),
                owner: this.publicKey,
                parentId,
                embedded: authCert,
                contentType: "temporary/authCert",
                expireTime: Date.now() + 3600 * 1000, // TODO use TimeFreeze
            }, this.publicKey);

        const storeRequest = StorageUtil.CreateStoreRequest({
            sourcePublicKey: this.publicKey,
            targetPublicKey: this.publicKey,
            nodes: [dataNode.export()],

        });

        const {getResponse} = storageP2PClient.store(storeRequest);

        if (!getResponse) {
            return false;
        }

        const anyData = await getResponse.onceAny();

        if (anyData.type === EventType.REPLY) {
            const storeResponse = anyData.response;

            if (storeResponse?.status === Status.RESULT) {
                if (storeResponse.storedId1s.length === 1) {
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
    protected peerConnected(p2pClient: P2PClient) {
        if (!this.state.storageClient) {
            console.debug("Storage not setup properly, closing incoming socket.");
            p2pClient.close();
            return;
        }

        // These variables are shared across instances using the same underlaying P2PClient,
        // so that an AutoFetcher fetching from remote will not trigger the remotes
        // subscriptions it may have on the storage the AutoFetcher it storing to.
        const muteMsgIds: Buffer[] = [];
        const reverseMuteMsgIds: Buffer[] = [];

        const autoFetcher = new P2PClientAutoFetcher(p2pClient, this.state.storageClient,
            muteMsgIds, reverseMuteMsgIds);

        autoFetcher.onBlob( (blobEvent: BlobEvent) =>
            this.triggerEvent(EVENT_SERVICE_BLOB, blobEvent) )

        const autoFetcherReverse = new P2PClientAutoFetcher(p2pClient, this.state.storageClient,
            muteMsgIds, reverseMuteMsgIds, true);

        autoFetcherReverse.onBlob( (blobEvent: BlobEvent) =>
            this.triggerEvent(EVENT_SERVICE_BLOB, blobEvent) )

        const allAutoFetch = this.getAutoFetch();

        autoFetcher.addFetch(allAutoFetch);
        autoFetcherReverse.addFetch(allAutoFetch);

        this.state.autoFetchers.push(autoFetcher, autoFetcherReverse);

        const permissions = p2pClient.getPermissions();

        // If our permissions (as server) allow us to embed we spawn an extender server.
        //
        if (permissions.fetchPermissions.allowEmbed.length > 0 ||
            (permissions.fetchPermissions.allowIncludeLicenses & 2) > 0)
        {
            const storageExtender = new P2PClientExtender(p2pClient, this.state.storageClient,
                this.publicKey, this.config.nodeCerts, this.signatureOffloader, muteMsgIds);

            this.state.extenderServers.push(storageExtender);

            console.debug("Spawn Extender server.");
        }
        else if (permissions.fetchPermissions.allowNodeTypes.length > 0 ||
            permissions.storePermissions.allowStore || permissions.storePermissions.allowWriteBlob) {

            const storageForwarder = new P2PClientForwarder(p2pClient, this.state.storageClient,
                muteMsgIds);

            this.state.storageServers.push(storageForwarder);

            console.debug("Spawn Storage server forwarder.");
        }

        p2pClient.onClose( () => {
            this.garbageCollectClients();
            const peerCloseEvent: Parameters<ServicePeerCloseCallback> = [p2pClient];
            this.triggerEvent(EVENT_SERVICE_PEER_CLOSE, ...peerCloseEvent);
        });

        const peerConnectEvent: Parameters<ServicePeerConnectCallback> = [p2pClient];
        this.triggerEvent(EVENT_SERVICE_PEER_CONNECT, ...peerConnectEvent);
    }

    /**
     * Called when a storage connection has been setup, either locally or to a remote.
     * @param p2pClient
     */
    protected async storageConnected(internalStorageClient: P2PClient, externalStorageClient: P2PClient) {
        if (this.state.storageClient) {
            console.warn("Storage already connected.");
            internalStorageClient.close();
            return;
        }

        this.state.storageClient = internalStorageClient;
        this.state.externalStorageClient = externalStorageClient;

        this.state.externalStorageClient.onClose( () => {
            delete this.state.externalStorageClient;
        });

        this.state.storageClient.onClose( () => {
            delete this.state.storageClient;
            const storageCloseEvent: Parameters<ServiceStorageCloseCallback> =
                [externalStorageClient];
            this.triggerEvent(EVENT_SERVICE_STORAGE_CLOSE, ...storageCloseEvent);
            this.closePeerConnectionFactories();
            // Note: we do not delete storageFactory here, because it might spawn a new connection for us.
        });

        await this.initPeerConnectionFactories();

        const storageConnectEvent: Parameters<ServiceStorageConnectCallback> =
            [externalStorageClient];
        this.triggerEvent(EVENT_SERVICE_STORAGE_CONNECT, ...storageConnectEvent);
    }

    /**
     * Create a PeerData object for this peer.
     *
     * @param connectionConfig set if applicable
     *
     * @returns localPeerData
     */
    protected makePeerData(connectionConfig?: ConnectionConfig): PeerData {
        const serializeFormat = connectionConfig?.serializeFormat ?? 0;

        if (!Formats[serializeFormat]) {
            throw new Error(`serializeFormat ${serializeFormat} is not supported`);
        }

        return PeerDataUtil.create({
            version: Version,
            serializeFormat,
            handshakePublicKey: this.publicKey,
            authCert: this.config.authCert?.export(),
            authCertPublicKey: this.config.authCert ? this.config.authCert.getIssuerPublicKey() : undefined,
            clockDiff: 0,
            region: connectionConfig?.region,
            jurisdiction: connectionConfig?.jurisdiction,
            appVersion: this.applicationConf.version,
            expireTime: 0,
        });
    }

    /**
     * @returns the OpenOdin version
     */
    public getVersion(): string {
        return Version;
    }

    /**
     * @returns the application version as given in ApplicationConf.
     */
    public getAppVersion(): string {
        return this.applicationConf.version;
    }

    public getStorageConnectionFactories(): HandshakeFactoryInterface[] | undefined {
        return this.state.storageConnectionFactories;
    }

    public getPeerConnectionFactories(): HandshakeFactoryInterface[] {
        return this.state.peerConnectionFactories;
    }

    /**
     * Attempt to sync a specific blob from each connected peer to our storage.
     *
     * Note that this has no size limit on the blob.
     *
     * @returns Generator witch return type {promise: Promise<boolean>, streamWriter: StreamWriterInterface}.
     */
    public *syncBlob(nodeId1: Buffer, expectedLength: bigint = -1n) {

        // First check if any AutoFetcher is already syncing.
        for (let i=0; i<this.state.autoFetchers.length; i++) {
            const autoFetcher = this.state.autoFetchers[i];

            if (!autoFetcher || autoFetcher.isClosed() || autoFetcher.isReverse()) {
                continue;
            }

            const ret = autoFetcher.getSyncingBlob(nodeId1);

            if (ret) {

                yield ret;

                break;
            }
        }

        // Run through the list again from the top (list could have changed by now).
        for (let i=0; i<this.state.autoFetchers.length; i++) {
            const autoFetcher = this.state.autoFetchers[i];

            if (!autoFetcher || autoFetcher.isClosed() || autoFetcher.isReverse()) {
                continue;
            }

            yield autoFetcher.syncBlob(nodeId1, expectedLength, false);
        }
    }

    /**
     * Hook event for when the Service starts trying to connect to Storage.
     * @param callback
     */
    public onStart(callback: ServiceStartCallback) {
        this.hookEvent(EVENT_SERVICE_START, callback);
    }

    /**
     * Hook event for when the Service is stopped, either manually or if Storage connection closes.
     * @param callback
     */
    public onStop(callback: ServiceStopCallback) {
        this.hookEvent(EVENT_SERVICE_STOP, callback);
    }

    public onStorageParseError(callback: ServiceStorageParseErrorCallback) {
        this.hookEvent(EVENT_SERVICE_STORAGE_PARSE_ERROR, callback);
    }

    /**
     * Called when the storage supplies an auth cert for it self which is not valid.
     */
    public onStorageAuthCertError(callback: ServiceStorageAuthCertErrorCallback) {
        this.hookEvent(EVENT_SERVICE_STORAGE_AUTHCERT_ERROR, callback);
    }

    /**
     * Event emitted when a connection to Storage has been setup.
     */
    public onStorageConnect(callback: ServiceStorageConnectCallback) {
        this.hookEvent(EVENT_SERVICE_STORAGE_CONNECT, callback);
    }

    /**
     * Event emitted when the storage connection has closed.
     */
    public onStorageClose(callback: ServiceStorageCloseCallback) {
        this.hookEvent(EVENT_SERVICE_STORAGE_CLOSE, callback);
    }

    /**
     * Event emitted when the handshake factory for a client storage connection has been setup.
     * This factory can be used to more closely monitor events directly on the factory,
     * and also to tune and set parameters such as blocked IP addresses.
     */
    public onStorageFactoryCreate(callback: ServicePeerFactoryCreateCallback) {
        this.hookEvent(EVENT_SERVICE_PEER_FACTORY_CREATE, callback);
    }

    public onPeerParseError(callback: ServicePeerParseErrorCallback) {
        this.hookEvent(EVENT_SERVICE_PEER_PARSE_ERROR, callback);
    }

    /**
     * Event called when connected peer's auth cert is not valid.
     */
    public onPeerAuthCertError(callback: ServicePeerAuthCertErrorCallback) {
        this.hookEvent(EVENT_SERVICE_PEER_AUTHCERT_ERROR, callback);
    }

    /**
     * Event emitted when a peer has connected.
     */
    public onPeerConnect(callback: ServicePeerConnectCallback) {
        this.hookEvent(EVENT_SERVICE_PEER_CONNECT, callback);
    }

    /**
     * Event emitted when a connected peer has closed.
     */
    public onPeerClose(callback: ServicePeerCloseCallback) {
        this.hookEvent(EVENT_SERVICE_PEER_CLOSE, callback);
    }

    /**
     * Event emitted when the handshake factory for a peer connection has been setup.
     * This factory can be used to more closely monitor events directly on the factory,
     * and also to tune and set parameters such as blocked IP addresses.
     */
    public onPeerFactoryCreate(callback: ServicePeerFactoryCreateCallback) {
        this.hookEvent(EVENT_SERVICE_PEER_FACTORY_CREATE, callback);
    }

    /**
     * Event triggered when a blob for a specific node Id1 has successfully been synced to the storage.
     * The event is fired once and then the eventhandler is automatically unhooked.
     *
     * @param id1 the id1 we are listening for.
     * @param callback the callback to call when blob for id1 is available.
     * @returns fn to call to unhook the given callback from this event to cancel the event hook.
     */
    public onBlob(id1: Buffer, callback: () => void): () => void {
        const fn = (blobEvent: BlobEvent) => {
            if (id1.equals(blobEvent.nodeId1)) {
                this.unhookEvent(EVENT_SERVICE_BLOB, fn);
                callback();
            }
        };

        this.hookEvent(EVENT_SERVICE_BLOB, fn);

        return () => {
            this.unhookEvent(EVENT_SERVICE_BLOB, fn);
        };
    }

    protected hookEvent(name: string, callback: (...args: any[]) => void) {
        const cbs = this.handlers[name] || [];
        this.handlers[name] = cbs;
        cbs.push(callback);
    }

    protected unhookEvent(name: string, callback: (...args: any[]) => void) {
        const cbs = (this.handlers[name] || []).filter( (cb: ( (...args: any) => void)) => callback !== cb );
        this.handlers[name] = cbs;
    }

    protected triggerEvent(name: string, ...args: any[]) {
        const cbs = this.handlers[name] || [];
        cbs.forEach( (callback: ( (...args: any[]) => void)) => {
            setImmediate( () => callback(...args) );
        });
    }
}
