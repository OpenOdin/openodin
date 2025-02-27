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
} from "pocket-messaging";

import {
    SignatureOffloaderInterface,
} from "../signatureoffloader/types";

import {
    P2PClient,
    AutoFetch,
    P2PClientForwarder,
    P2PClientExtender,
    P2PClientAutoFetcher,
    BlobEvent,
    Formats,
    PeerInfo,
    PeerInfoSchema,
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
    AuthCert,
    AuthCertInterface,
    SignCert,
    SignCertInterface,
    Hash,
    CarrierNodeType,
    CMP,
} from "../datamodel";

import {
    Status,
    Version,
} from "../types";

import {
    RegionUtil,
} from "../util/RegionUtil";

import {
    ParseSchema,
    ToJSONObject,
} from "../util/SchemaUtil";

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
    ServicePeerFactoryCreateErrorCallback,
    ServicePeerParseErrorCallback,
    ServicePeerAuthCertErrorCallback,
    ServiceStorageCloseCallback,
    ServiceStorageConnectCallback,
    ServiceStorageFactoryCreateCallback,
    ServiceStorageFactoryCreateErrorCallback,
    ServiceStorageParseErrorCallback,
    ServiceStorageAuthCertErrorCallback,
    EVENT_SERVICE_START,
    EVENT_SERVICE_STOP,
    EVENT_SERVICE_BLOB,
    EVENT_SERVICE_STORAGE_CLOSE,
    EVENT_SERVICE_STORAGE_CONNECT,
    EVENT_SERVICE_STORAGE_FACTORY_CREATE,
    EVENT_SERVICE_STORAGE_FACTORY_CREATE_ERROR,
    EVENT_SERVICE_STORAGE_AUTHCERT_ERROR,
    EVENT_SERVICE_STORAGE_PARSE_ERROR,
    EVENT_SERVICE_PEER_FACTORY_CREATE,
    EVENT_SERVICE_PEER_FACTORY_CREATE_ERROR,
    EVENT_SERVICE_PEER_CONNECT,
    EVENT_SERVICE_PEER_CLOSE,
    EVENT_SERVICE_PEER_AUTHCERT_ERROR,
    EVENT_SERVICE_PEER_PARSE_ERROR,
} from "./types";

import {
    AuthFactoryInterface,
} from "../auth/types";

import {
    DeepCopy,
    DeepHash,
    sleep,
    PromiseCallback,
    CopyBuffer,
} from "../util/common";

import {
    FetchRequestSchema,
    StoreRequestSchema,
} from "../request/jsonSchema";

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
    signCerts: SignCertInterface[],

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

    protected walletConf: WalletConf;

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
    constructor(applicationConf: ApplicationConf, walletConf: WalletConf,
        protected signatureOffloader: SignatureOffloaderInterface,
        protected authFactory: AuthFactoryInterface)
    {
        if (applicationConf.format !== 1) {
            throw new Error("Unknown ApplicationConf format, expecting 1");
        }

        if (walletConf.authCert && !walletConf.signCerts?.length) {
            throw new Error("When using an authCert also signCerts are required");
        }

        this.applicationConf   = DeepCopy(applicationConf) as ApplicationConf;
        this.walletConf        = DeepCopy(walletConf) as WalletConf;

        this.nodeUtil = new NodeUtil(this.signatureOffloader);

        this.sharedStorageFactoriesSocketFactoryStats = {counters: {}};

        this.config = {
            signCerts: [],
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

        for (let i=0; i<this.walletConf.signCerts.length; i++) {
            await this.addSignCert(this.walletConf.signCerts[i]);
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
            const publicKey = this.config.authCert.getProps().owner;
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

    /**
     * @returns same WalletConf object as provided in constructor.
     */
    public getWalletConf(): WalletConf {
        return DeepCopy(this.walletConf);
    }

    public getApplicationConf(): ApplicationConf {
        return DeepCopy(this.applicationConf);
    }

    /**
     * Set or remove auth cert.
     *
     * Auth cert will be decoded, cryptographically verified, but
     * the auth cert will not be online verified at this point.
     * The receiving side of a auth cert always validates it online.
     *
     * @param packed
     * @throws
     */
    public async setAuthCert(packed?: Buffer | undefined) {

        if (this._isRunning) {
            throw new Error("Cannot set auth cert while running.");
        }


        if (packed) {
            const authCert = new AuthCert(packed);

            authCert.unpack();

            if (authCert && (await this.signatureOffloader.verify([authCert])).length === 0) {
                throw new Error("Invalid AuthCert provided, cert could not be verified.");
            }

            this.config.authCert = authCert;
        }
        else {
            this.config.authCert = undefined;
        }
    }

    /**
     * @returns cryptographically verified authCert, if set.
     */
    public getAuthCert(): AuthCertInterface | undefined {
        return this.config.authCert;
    }

    public addThreadTemplate(name: string, threadTemplate: ThreadTemplate) {
        this.threadTemplates[name] = DeepCopy(threadTemplate) as ThreadTemplate;
    }

    /**
     * Returns added thread templates, which are unparsed structures.
     */
    public getThreadTemplates(): ThreadTemplates {
        return DeepCopy(this.threadTemplates);
    }

    /**
     * Add SignCert.
     *
     * The cert will get decoded and cryptographically verified, but not online verified.
     * The receiving storage will always online verify certificates (if applicable).
     * @param packed
     * @throws
     */
    public async addSignCert(packed: Buffer) {
        const signCert = new SignCert(packed);

        signCert.unpack();

        const id1 = signCert.getProps().id1;

        assert(id1);

        if (this.config.signCerts.some(
            (signCert2: SignCertInterface) => signCert2.getProps().id1?.equals(id1)))
        {
            // Already exists.
            return;
        }

        if ((await this.signatureOffloader.verify([signCert])).length === 0) {
            throw new Error("Invalid signCert provided, could not be verified.");
        }

        this.config.signCerts.push(signCert);

        // hot-update the extenders with new list.
        this.state.extenderServers.forEach( (extender: P2PClientExtender) => {
            extender.setSignCerts(this.config.signCerts);
        });

        // hot-update the NodeUtil with new cert list.
        this.nodeUtil.setSignCerts(this.config.signCerts);
    }

    /**
     * Remove specific node cert from the config and from all extenders.
     * @param signCert to be removed.
     */
    public removeSignCert(signCert: SignCertInterface) {
        const id1 = signCert.getProps().id1;

        assert(id1);

        this.config.signCerts = this.config.signCerts.filter( (signCert2: SignCertInterface) => {
            return signCert2.getProps().id1?.equals(id1);
        });

        // hot-update the extenders with new cert list.
        this.state.extenderServers.forEach( (extender: P2PClientExtender) => {
            extender.setSignCerts(this.config.signCerts);
        });

        // hot-update the NodeUtil with new cert list.
        this.nodeUtil.setSignCerts(this.config.signCerts);
    }

    /**
     * @returns array copy of all node certs.
     */
    public getSignCerts(): SignCertInterface[] {
        return this.config.signCerts.slice();
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
     * The ConnectionConfig will be complemented with peerData.
     *
     * If existing storage client and service started then immediately init the connection factory.
     * @param connectionConfig object
     */
    public addPeerConnectionConfig(connectionConfig: ConnectionConfig) {
        const connectionConfig2 = DeepCopy(connectionConfig) as ConnectionConfig;

        const connection = connectionConfig2.connection;

        const peerData = this.makePeerData(connectionConfig);

        if (connection.handshake) {
            connection.handshake.peerData = peerData;

            if (!connection.handshake.socketFactoryStats) {
                connection.handshake.socketFactoryStats =
                    this.sharedStorageFactoriesSocketFactoryStats;
            }
        }

        if (connection.api) {
            connection.api.peerData = peerData;

            if (!connection.api.socketFactoryStats) {
                connection.api.socketFactoryStats =
                    this.sharedStorageFactoriesSocketFactoryStats;
            }
        }

        this.config.peerConnectionConfigs.push(connectionConfig2);

        if (this._isRunning && this.state.storageClient) {
            this.initPeerFactory(connectionConfig2);
        }
    }

    /**
     * Add Remote Storage connection configuration.
     *
     * The ConnectionConfig will be complemented with peerData.
     *
     * If existing storage client and service is started then immediately init the connection factory.
     * @param connectionConfig object
     */
    public addStorageConnectionConfig(connectionConfig: ConnectionConfig) {
        const connectionConfig2 = DeepCopy(connectionConfig) as ConnectionConfig;

        const connection = connectionConfig2.connection;

        const peerData = this.makePeerData(connectionConfig);

        if (connection.handshake) {
            connection.handshake.peerData = peerData;

            // Force this for storage connection factories using sockets
            // to limit nr of connections to 1.
            //
            connection.handshake.socketFactoryConfig.maxConnections = 1;
        }

        if (connection.api) {
            connection.api.peerData = peerData;

            // Force this for storage connection factories using sockets
            // to limit nr of connections to 1.
            //
            connection.api.socketFactoryConfig.maxConnections = 1;
        }

        this.config.storageConnectionConfigs.push(connectionConfig2);

        if (this._isRunning && !this.config.databaseConfig) {
            this.initStorageFactory(connectionConfig2);
        }
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


                const fetchRequest = Thread.GetFetchRequest(threadTemplate, syncThread.threadVariables,
                    syncThread.stream);

                // CRDTs are not allowed to be used when auto syncing.
                fetchRequest.crdt.algo = "";

                if (syncThread.direction === "Pull" || syncThread.direction === "PushPull") {
                    autoFetchers.push({
                        remotePublicKey,
                        fetchRequest,
                        blobSizeMaxLimit,
                        reverse: false,
                    });
                }

                if (syncThread.direction === "Push" || syncThread.direction === "PushPull") {
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
     * Create and start all peer connection factories.
     */
    protected async initPeerFactories() {
        if (!this.state.storageClient) {
            throw new Error("Cannot init peer connection factories unless connected to storage.");
        }

        assert(this.state.peerConnectionFactories.length === 0);

        this.config.peerConnectionConfigs.forEach( config =>
            this.initPeerFactory(config) );
    }

    protected async initPeerFactory(connectionConfig: ConnectionConfig) {
        let handshakeFactory;

        try {
            handshakeFactory = await this.initPeerConnectionFactory(connectionConfig);
        }
        catch(error) {
            console.error("Could not create peer connection factory", error);

            const peerCreateErrorEvent: Parameters<ServicePeerFactoryCreateErrorCallback> =
                [error as Error];

            this.triggerEvent(EVENT_SERVICE_PEER_FACTORY_CREATE_ERROR, ...peerCreateErrorEvent);

            return;
        }

        try {
            handshakeFactory.init();
        }
        catch(error) {
            const peerParseErrorEvent: Parameters<ServicePeerParseErrorCallback> =
                [error as Error];

            this.triggerEvent(EVENT_SERVICE_PEER_PARSE_ERROR, ...peerParseErrorEvent);
        }

        this.state.peerConnectionFactories.push(handshakeFactory);
    }

    /**
     * Setup and initiate a peer connection factory.
     * @throws if factory cannot be created
     */
    protected async initPeerConnectionFactory(connectionConfig: ConnectionConfig):
        Promise<HandshakeFactoryInterface>
    {
        // Throws if refused
        //
        const handshakeFactory = await this.authFactory.create(connectionConfig.connection);

        const pingInterval = connectionConfig.connection.handshake?.pingInterval ??
            connectionConfig.connection.api?.pingInterval ?? 0;

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

                const remotePeerInfo = await this.handshakeResultToPeerInfo(handshakeResult);

                // Validate region and jurisdiction provided by the remote peer.
                //
                this.validateRemotePeerInfo(remotePeerInfo, wrappedClient.getRemoteAddress());

                await wrappedClient.init();

                const messaging = new Messaging(wrappedClient, pingInterval);

                const p2pClient = new P2PClient(messaging, this.makeLocalPeerInfo(), remotePeerInfo,
                    connectionConfig.permissions, handshakeResult.clockDiff);

                // Note that the auth cert at this point is already cryptographically verified.
                //
                const authCert = remotePeerInfo.authCert;

                if (authCert) {
                    const [status, error] =
                        await this.validateAuthCert(authCert, this.state.storageClient,
                            remotePeerInfo.handshakePublicKey,
                            connectionConfig.region,
                            connectionConfig.jurisdiction);

                    if (status !== 0) {
                        console.debug("AuthCert did not validate", error);

                        const peerAuthCertErrorEvent: Parameters<ServicePeerAuthCertErrorCallback> =
                            [new Error(error), authCert];

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
                console.debug(error);

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
        // Use same PeerInfo for all needs below which is correct since we are not connecting
        // to any other peer.
        //
        const peerInfo = this.makeLocalPeerInfo();

        while (true) {
            const [driver, blobDriver] = await Service.ConnectToDatabase(databaseConfig);

            if (driver) {
                // Create virtual paired sockets.
                const [socket1, socket2] = CreatePair();
                const messaging1 = new Messaging(socket1, 0);
                const messaging2 = new Messaging(socket2, 0);

                // Passing in permissions as this p2pClient is connected to the Storage.
                //
                const p2pStorage = new P2PClient(messaging1, peerInfo, peerInfo,
                    databaseConfig.permissions);

                const storage = new Storage(p2pStorage, this.signatureOffloader, driver, blobDriver);

                storage.onClose( () => {
                    // We need to explicitly close the Driver instance.
                    driver?.close();
                    blobDriver?.close();
                });

                await storage.init();

                // This client only initiates requests and does not need any permissions to so,
                // so we do not pass in any permissions object here.
                //
                const internalStorageClient = new P2PClient(messaging2, peerInfo, peerInfo);

                messaging1.open();
                messaging2.open();

                // Create virtual paired sockets.
                const [socket3, socket4] = CreatePair();
                const messaging3 = new Messaging(socket3, 0);
                const messaging4 = new Messaging(socket4, 0);

                // Set permissions on this to limit the local app's access to the storage.
                //
                const intermediaryStorageClient =
                    new P2PClient(messaging3, peerInfo, peerInfo, databaseConfig.appPermissions);

                // This client only initiates requests and does not need any permissions to it.
                //
                const externalStorageClient =
                    new P2PClient(messaging4, peerInfo, peerInfo);

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
     * Setup and initiate all storage factories.
     */
    protected async initStorageFactories() {
        assert(this.state.storageConnectionFactories.length === 0);

        this.config.storageConnectionConfigs.forEach( config =>
            this.initStorageFactory(config) );
    }

    protected async initStorageFactory(connectionConfig: ConnectionConfig) {
        let handshakeFactory;

        try {
            handshakeFactory = await this.initStorageConnectionFactory(connectionConfig);
        }
        catch(error) {
            console.error("Could not create storage connection factory", error);

            const storageCreateErrorEvent: Parameters<ServiceStorageFactoryCreateErrorCallback> =
                [error as Error];

            this.triggerEvent(EVENT_SERVICE_STORAGE_FACTORY_CREATE_ERROR, ...storageCreateErrorEvent);

            return;
        }

        try {
            handshakeFactory.init();
        }
        catch(error) {
            const storageParseErrorEvent: Parameters<ServiceStorageParseErrorCallback> =
                [error as Error];

            this.triggerEvent(EVENT_SERVICE_STORAGE_PARSE_ERROR, ...storageParseErrorEvent);
        }

        this.state.storageConnectionFactories.push(handshakeFactory);
    }

    /**
     * Init a handshake factory for connecting with remote storage.
     */
    protected async initStorageConnectionFactory(connectionConfig: ConnectionConfig):
        Promise<HandshakeFactoryInterface>
    {
        const pingInterval = connectionConfig.connection.handshake?.pingInterval ??
        connectionConfig.connection.api?.pingInterval ?? 0;

        const handshakeFactory = await this.authFactory.create(connectionConfig.connection);

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

                    const remotePeerInfo = await this.handshakeResultToPeerInfo(handshakeResult);

                    // Validate region and jurisdiction provided by the remote peer.
                    this.validateRemotePeerInfo(remotePeerInfo, wrappedClient.getRemoteAddress());

                    await wrappedClient.init();

                    const messaging = new Messaging(wrappedClient, pingInterval);

                    const p2pClient = new P2PClient(messaging, this.makeLocalPeerInfo(),
                        remotePeerInfo, undefined, handshakeResult.clockDiff);

                    // Note that the auth cert at this point is already cryptographically verified
                    // and validated against the target,
                    // here we also check so that it verifies online (if it has any such properties).
                    //
                    const authCert = remotePeerInfo.authCert;

                    if (authCert) {
                        const [status, error] = await this.validateAuthCert(authCert, p2pClient,
                            remotePeerInfo.handshakePublicKey, connectionConfig.region,
                            connectionConfig.jurisdiction);

                        if (status !== 0) {
                            console.debug("AuthCert did not validate", error);

                            const storageAuthCertErrorEvent: Parameters<ServiceStorageAuthCertErrorCallback> =
                                [new Error(error), authCert];

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
                    console.debug(error);

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
     * @param remotePeerInfo.
     * @param ipAddress version 4 or 6.
     * @throws if not validated correctly or on lookup error.
     */
    protected validateRemotePeerInfo(remotePeerInfo: PeerInfo, ipAddress: string | undefined) {
        // TODO: we are not enforcing this as for now
        //
        const region = remotePeerInfo.region;

        if (region && region.length > 0) {
            const ipRegion = RegionUtil.GetRegionByIpAddress(ipAddress);

            if (!ipRegion) {
                //throw new Error(`Could not lookup region for IP address: ${ipAddress}`);
            }

            if (ipRegion !== region) {
                //throw new Error(`Region ${region} does not match IP lookup of ${ipAddress}`);
            }
        }

        const jurisdiction = remotePeerInfo.jurisdiction;

        if (jurisdiction && jurisdiction.length > 0) {
            // TODO:
            // We currently have no possibility to enforce that the user belongs
            // to a specific jurisdiction as remotePeerInfo.jurisdiction might state.
        }
    }

    /**
     * Check constraints of auth cert and validate the certificate using the storage and also if
     * applicable check it online.
     *
     * A cert which is not marked as indestructible can have been destroyed by destroy-nodes,
     * this we must check in our connected storage.
     * Furthermore if the auth cert is online in it self then we need to see that the cert is marked as validated.
     * We assume that the auth cert is already cryptographically verified and validated against its intended target.
     *
     * @param image the binary to decode and check
     * @param storageP2PClient the storage to be leveraged for checking the certificate
     * @param publicKey the publicKey to check auth cert constraints against
     * @param region the region to check auth cert constraints against
     * @param jurisdiction the jurisdiction to check auth cert constraints against
     *
     * @returns 0 if auth cert successfully validates in the storage.
     * 1 if the auth cert cannot be verified likely due to a destroy node destroying the cert.
     * 2 if the cert does not validate against its target.
     *
     * If status > 0 then return error string as second argument in array
     */
    protected async validateAuthCert(image: Buffer, storageP2PClient: P2PClient,
        publicKey: Buffer, region?: string, jurisdiction?: string): Promise<[number, string?]>
    {
        // Validate auth cert against target
        //
        const authCert = new AuthCert(image);

        authCert.unpack();

        const val = authCert.validate(true);

        if (!val[0]) {
            console.debug(`Could not validate auth cert : ${val[1]}`);

            return [2, "The auth cert does not validate"];
        }

        const props = authCert.getProps();

        if (props.region) {
            if (props.region !== region) {
                return [2, "Region does not match in auth cert and connection"];
            }
        }

        if (props.jurisdiction) {
            if (props.jurisdiction !== jurisdiction) {
                return [2, "Jurisdiction does not match in auth cert and connection"];
            }
        }

        let wrappedAuthCertDataNode = await this.fetchAuthCertDataWrapper(image, storageP2PClient);

        if (!wrappedAuthCertDataNode) {
            // Attempt to store
            if (! await this.storeAuthCertDataWrapper(image, storageP2PClient)) {
                return [1, "The auth cert could not be stored possibly due to a destroy node destroying the cert"];
            }

            // Read again
            wrappedAuthCertDataNode = await this.fetchAuthCertDataWrapper(image, storageP2PClient);
        }

        if (!wrappedAuthCertDataNode) {
            // It seems as there are destroy nodes present for the auth cert,
            // since it cannot be read back even if stored again.
            return [1, "The auth cert could not be read back possibly due to a destroy node destroying the cert"];
        }

        return [0];
    }

    protected async fetchAuthCertDataWrapper(authCert: Buffer, storageP2PClient: P2PClient,
        ignoreInactive: boolean = true): Promise<AuthCertInterface | undefined>
    {
        const parentId = Hash(authCert);

        // A fetch request to query for data nodes wrapping the authcert.
        const fetchRequest = ParseSchema(FetchRequestSchema, {query: {
            parentId,
            depth: 1,
            limit: 1,
            cutoffTime: 0n,
            ignoreInactive,
            discardRoot: true,
            sourcePublicKey: this.publicKey,
            targetPublicKey: this.publicKey,
            match: [
                {
                    nodeType: Buffer.from(CarrierNodeType),
                    filters: [
                        {
                            field: "owner",
                            operator: "",
                            cmp: CMP.EQ,
                            value: this.publicKey.toString("hex"),
                        },
                        {
                            field: "info",
                            operator: "",
                            cmp: CMP.EQ,
                            value: "AuthCert",
                        },
                        {
                            field: "authCert",
                            operator: "hash",
                            cmp: CMP.EQ,
                            value: Hash(authCert).toString("hex"),
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

            if (fetchResponse && fetchResponse.status === Status.Result) {
                if (fetchResponse.result.nodes.length > 0) {
                    return new AuthCert(fetchResponse.result.nodes[0]);
                }
            }
        }

        return undefined;
    }

    /**
     * Bundle the AuthCert in a CarrierNode to store it temporarily in the database.
     * This will detect if the AuthCert has been targeted for destruction, as the CarrierNode
     * will not be able to be stored.
     */
    protected async storeAuthCertDataWrapper(authCert: Buffer, storageP2PClient: P2PClient): Promise<boolean> {
        // Make up some virtual parentId, doesn't really matter
        // but we want to avoid placing it somewhere were it might show up and interfere.
        //
        const parentId = Hash(authCert);

        const carrierNode = await this.nodeUtil.createCarrierNode(
            {
                owner: this.publicKey,
                parentId,
                authCert,
                info: "AuthCert",
                expireTime: Date.now() + 3600 * 1000,
            }, this.publicKey);

        const storeRequest = ParseSchema(StoreRequestSchema, {
            sourcePublicKey: this.publicKey,
            targetPublicKey: this.publicKey,
            nodes: [carrierNode.pack()],
        });

        const {getResponse} = storageP2PClient.store(storeRequest);

        if (!getResponse) {
            return false;
        }

        const anyData = await getResponse.onceAny();

        if (anyData.type === EventType.REPLY) {
            const storeResponse = anyData.response;

            if (storeResponse?.status === Status.Result) {
                if (storeResponse.storedId1List.length === 1) {
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
            (permissions.fetchPermissions.allowIncludeLicenses === "Extend" ||
                permissions.fetchPermissions.allowIncludeLicenses === "IncludeExtend"))
        {
            const storageExtender = new P2PClientExtender(p2pClient, this.state.storageClient,
                this.publicKey, this.config.signCerts, this.signatureOffloader, muteMsgIds);

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

        await this.initPeerFactories();

        const storageConnectEvent: Parameters<ServiceStorageConnectCallback> =
            [externalStorageClient];
        this.triggerEvent(EVENT_SERVICE_STORAGE_CONNECT, ...storageConnectEvent);
    }

    /**
     * Create a peer data binary for this peer to exchange in the handhake.
     *
     * @param connectionConfig this peer's configuration
     *
     * @returns peer data representing this peer
     */
    protected makePeerData(connectionConfig: ConnectionConfig): Buffer {
        const serializeFormat = connectionConfig.serializeFormat;

        if (!Formats[serializeFormat]) {
            throw new Error(`serializeFormat ${serializeFormat} is not supported`);
        }

        const peerData = {
            peerDataFormat: 0,
            serializeFormat,
            version:        Version,
            appVersion:     this.applicationConf.version,
            region:         connectionConfig.region,
            jurisdiction:   connectionConfig.jurisdiction,
            authCert:       this.config.authCert?.pack(),
            sessionTimeout: 0,
        };

        // TODO: we possibly would want this binary packed instead.
        // or make into an json array to save space
        //
        const peerDataJSONObj = ToJSONObject(peerData);

        return Buffer.from(JSON.stringify(peerDataJSONObj));
    }

    /**
     * Make PeerInfo to be used locally.
     * @returns PeerInfo
     */
    protected makeLocalPeerInfo(): PeerInfo {
        const serializeFormat =
            Object.values(Formats).find(format => format.expires === undefined)?.id;

        assert(serializeFormat !== undefined);

        return {
            serializeFormat,
            version:            Version,
            appVersion:         this.getAppVersion(),
            sessionTimeout:     0,
            handshakePublicKey: this.publicKey,
            authCert:           this.config.authCert?.pack(),
            authCertPublicKey:  this.config.authCert?.getProps().owner,
        };
    }

    /**
     * Convert HandshakeResult into PeerInfo for remote side.
     *
     * This function will cryptographically verify any auth cert given but will not check it
     * for validity as this is done elsewhere.
     *
     * @param handshakeResult received upon successful handshake
     *
     * @throws if authCert does not verify or on data parsing error
     */
    protected async handshakeResultToPeerInfo(handshakeResult: HandshakeResult): Promise<PeerInfo>
    {
        const peerDataJSONObj = JSON.parse(handshakeResult.peerData.toString());

        assert(peerDataJSONObj.peerDataFormat === 0, "Expected peerDataFormat to be 0");

        peerDataJSONObj.handshakePublicKey = handshakeResult.peerLongtermPk;

        const peerInfo = ParseSchema(PeerInfoSchema, peerDataJSONObj);

        const authCert = peerInfo.authCert;

        let authCertObj: AuthCertInterface | undefined;
        let authCertPublicKey: Buffer | undefined;

        if (authCert) {
            authCertObj = new AuthCert(authCert);

            authCertObj.unpack();

            if ((await this.signatureOffloader.verify([authCertObj])).length !== 1) {
                throw new Error("Could not verify signatures in auth cert.");
            }

            authCertPublicKey = authCertObj.getProps().owner;
        }

        peerInfo.authCertPublicKey  = authCertPublicKey;

        return peerInfo;
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

    public getStorageConnectionFactories(): HandshakeFactoryInterface[] {
        return this.state.storageConnectionFactories.slice();
    }

    public getPeerConnectionFactories(): HandshakeFactoryInterface[] {
        return this.state.peerConnectionFactories.slice();
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

    /**
     * Event typically emitted when user refuses the application to connect via DataWallet.
     */
    public onStorageFactoryCreateError(callback: ServiceStorageFactoryCreateErrorCallback) {
        this.hookEvent(EVENT_SERVICE_STORAGE_FACTORY_CREATE_ERROR, callback);
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
     * Event typically emitted when user refuses the application to connect via DataWallet.
     */
    public onPeerFactoryCreateError(callback: ServicePeerFactoryCreateErrorCallback) {
        this.hookEvent(EVENT_SERVICE_PEER_FACTORY_CREATE_ERROR, callback);
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
