import { strict as assert } from "assert";

import {
    P2PClient,
    FetchResponse,
    ReadBlobResponse,
    DATANODE_TYPE,
    DataInterface,
    NodeInterface,
    Status,
    StorageUtil,
    App,
    SignatureOffloader,
    SignatureOffloaderInterface,
    HandshakeFactoryFactoryInterface,
    CreateHandshakeFactoryFactory,
    sleep,
    Hash,
    BlobEvent,
    ParseUtil,
} from "../../../";

import {
    KeyManager,
    Universe,
} from "../../../src/keymanager";

import {
    JSONUtil,
} from "../../../src/util/JSONUtil";

import {
    LogLevel,
    PocketConsole,
} from "pocket-console";

const BLOB_DATA = Buffer.concat([Buffer.alloc(1024 * 20).fill(0xa0),
    Buffer.alloc(1024 * 20).fill(0xb0),
    Buffer.alloc(1024 * 20).fill(0xc0)]);

class Chat extends App {
    protected console: any;
    protected onMessage: Function;
    protected onBlob?: Function;

    constructor(publicKey: Buffer, signatureOffloader: SignatureOffloaderInterface,
        handshakeFactoryFactory: HandshakeFactoryFactoryInterface,
        console: any, onMessage: Function, onBlob?: Function) {

        super(publicKey, signatureOffloader, handshakeFactoryFactory);

        this.console = console;
        this.onMessage = onMessage;
        this.onBlob = onBlob;
    }

    protected onBlobHandler = (blobEvent: BlobEvent) => {
        if (this.onBlob) {
            this.onBlob(blobEvent);
        }
    };

    /**
     * @throws on signing failure.
     */
    public async sendMessage(message: string, blobData?: Buffer) {
        const publicKey = this.getPublicKey();

        if (!publicKey) {
            throw new Error("App not configured, cannot send message");
        }

        let blobLength: bigint | undefined;
        let blobHash: Buffer | undefined;

        if (blobData) {
            blobLength = BigInt(blobData.length);
            blobHash = Hash(blobData);
        }

        const nodeCerts = this.getNodeCerts();

        const dataNode = await this.nodeUtil.createDataNode({owner: publicKey, isLicensed: true, data: Buffer.from(message), blobHash, blobLength}, publicKey, undefined, nodeCerts);
        const licenseNode = await this.nodeUtil.createLicenseNode({nodeId1: dataNode.getId1(), owner: publicKey, extensions: 2, targetPublicKey: publicKey}, publicKey, undefined, nodeCerts);

        const nodes = [dataNode, licenseNode];

        this.storeNodes(nodes).then( (storedId1s: Buffer[]) => {
            if (storedId1s.length !== nodes.length) {
                throw new Error(`Expected to store ${nodes.length} nodes`);
            }

            if (blobData) {
                // Upload blob with a delay to test that the trigger works.
                setTimeout( () => {

                    this.storeBlob(dataNode.getId1()!, blobData);

                }, 500);
            }
        }).catch( e => {
            console.error("Could not store nodes", e);
        });
    }

    public setupAppFetch() {
        if (!this.isConnected()) {
            throw new Error("Not connected");
        }

        const fetchRequest = StorageUtil.CreateFetchRequest({
            query: {
                parentId: Buffer.alloc(32).fill(0),
                triggerNodeId: Buffer.alloc(32).fill(0),
                discardRoot: true,
                match: [
                    {nodeType: DATANODE_TYPE},
                ],
            },
            transform: {
                algos: [2],
                cacheId: 1,
                tail: 30,
                includeDeleted: true,
            },
        });

        this.fetchNodes(fetchRequest, (nodes: NodeInterface[]) => {
            nodes.forEach( (node: NodeInterface) => {
                if (node.getType().equals(DATANODE_TYPE)) {
                    this.onMessage((node as DataInterface).getData()?.toString());
                }
            });
        }).catch( e => {
            console.error("Unexpected error occured when fetching nodes", e);
            throw e;
        });
    }
}

async function main() {
    const consoleMain = PocketConsole({module: "Main  "});

    let serverConfig;
    let clientConfig;
    try {
        serverConfig = JSONUtil.LoadJSON(`${__dirname}/server.json`, ['.']);
        clientConfig = JSONUtil.LoadJSON(`${__dirname}/client.json`, ['.']);
    }
    catch(e) {
        consoleMain.error(`Could not load and parse config files`, e);
        process.exit(1);
    }

    // -----------------------------------------------------------------------

    // This is how to config it for the app to manage its own private keys.
    //
    //const keyPair1 = ParseUtil.ParseKeyPair(serverConfig.keyPair);
    //const keyPair2 = ParseUtil.ParseKeyPair(clientConfig.keyPair);
    //
    //const signatureOffloader1 = new SignatureOffloader();
    //await signatureOffloader1.init();
    //await signatureOffloader1.addKeyPair(keyPair1);

    //const signatureOffloader2 = new SignatureOffloader();
    //await signatureOffloader2.init();
    //await signatureOffloader2.addKeyPair(keyPair2);

    //const handshakeFactoryFactory1 = CreateHandshakeFactoryFactory(keyPair1);
    //const handshakeFactoryFactory2 = CreateHandshakeFactoryFactory(keyPair2);

    // -----------------------------------------------------------------------

    //
    // This is how to config it for the app to not manage its own private keys,
    // but use the KeyManager instead.
    //
    // We extract and reset the keyPairs to show that it is the KeyManager who is managing the keys from here on.
    //
    const keyPair1 = ParseUtil.ParseKeyPair(serverConfig.keyPair);
    const keyPair2 = ParseUtil.ParseKeyPair(clientConfig.keyPair);

    serverConfig.keyPair = {
        publicKey: Buffer.alloc(0),
        secretKey: Buffer.alloc(0),
    };

    clientConfig.keyPair = {
        publicKey: Buffer.alloc(0),
        secretKey: Buffer.alloc(0),
    };

    //
    // This part sets up the communication between the isolated parts of the code.
    //
    const callbacks1: Function[] = [];
    const callbacks2: Function[] = [];

    const postMessage1 = (message: any) => {
        callbacks2.forEach( cb => cb(message) );
    };

    const listenMessage1 = ( cb: (message: any) => void) => {
        callbacks1.push(cb);

    };

    const postMessage2 = (message: any) => {
        callbacks1.forEach( cb => cb(message) );
    };

    const listenMessage2 = ( cb: (message: any) => void) => {
        callbacks2.push(cb);
    };

    const keyManager1 = new KeyManager(postMessage1, listenMessage1);
    const keyManager2 = new KeyManager(postMessage1, listenMessage1);

    keyManager1.onAuth( async () => {
        return {
            keyPairs: [keyPair1],
        };
    });

    keyManager2.onAuth( async () => {
        return {
            keyPairs: [keyPair2],
        };
    });

    //
    // In a browser context the 'universe' object would be provided as window.universe,
    // but here we create two of our own (this test app is running double clients).
    //
    const universe1 = new Universe(postMessage2, listenMessage2, keyManager1.getRPCId());
    const rpcClients1 = await universe1.auth();
    if (rpcClients1.error || !rpcClients1.signatureOffloader || !rpcClients1.handshakeFactoryFactory) {
        console.error('Error in auth: ${rpcClients1.error}');
        process.exit(1);
        return;
    }
    const signatureOffloader1 = rpcClients1.signatureOffloader;
    const handshakeFactoryFactory1 = rpcClients1.handshakeFactoryFactory;

    const universe2 = new Universe(postMessage2, listenMessage2, keyManager2.getRPCId());
    const rpcClients2 = await universe2.auth();
    if (rpcClients2.error || !rpcClients2.signatureOffloader || !rpcClients2.handshakeFactoryFactory) {
        console.error('Error in auth: ${rpcClients2.error}');
        process.exit(1);
        return;
    }
    const signatureOffloader2 = rpcClients2.signatureOffloader;
    const handshakeFactoryFactory2 = rpcClients2.handshakeFactoryFactory;

    //
    // -----------------------------------------------------------------------

    let abortTimeout = setTimeout( () => {
        consoleMain.error("Messages not transferred within timeout, aborting.");
        process.exit(1);
    }, 15000);

    let messageCounter = 0;

    const checkToQuit = () => {
        messageCounter++;
        if (messageCounter === 5) {
            clearTimeout(abortTimeout);
            consoleMain.aced("All messages transferred, closing Server and Client");
            setTimeout( () => {
                chatServer.stop();
                chatClient.stop();
            }, 500);
        }
    };

    let blobResolve: Function | undefined;

    const blobPromise = new Promise( (resolve, reject) => {
        blobResolve = resolve;
    });

    consoleMain.info("Init Chat Server");

    const consoleServer = PocketConsole({module: "Server"});

    const chatServer = new Chat(keyPair1.publicKey, signatureOffloader1, handshakeFactoryFactory1, consoleServer, (message: string) => {
        consoleServer.info(message);
        checkToQuit();
    }, async (blobEvent: BlobEvent) => {
        if (blobEvent.nodeId1 && !blobEvent.error) {
            const blobData = await chatServer.readBlob(blobEvent.nodeId1!);

            if (blobResolve) {
                blobResolve(blobData);
            }
        }
    });

    chatServer.onConnectionError( (e) => {
        consoleMain.error("Connection error in server", e);
        process.exit(1);
    });

    chatServer.onStorageConnect( () => {
        // Here we send as soon as Storage is connected, peer might or might
        // not be connected yet.
        consoleMain.info("Storage connected, send message from Server side");
        chatServer.sendMessage("Hello from Server");
    });

    chatServer.onConnectionConnect( () => {
        consoleMain.info("Connection connected to server");
    });

    let [status, err] = await chatServer.parseConfig(serverConfig);

    if (!status) {
        consoleMain.error(`Could not parse config: ${err}.`);
        process.exit(1);
    }

    chatServer.onStorageConnect( () => {
        chatServer.setupAppFetch();
    });

    chatServer.onStop( () => {
        signatureOffloader1.close();
    });

    await chatServer.start();

    await sleep(1000);

    consoleMain.info("Init Chat Client");
    const consoleClient = PocketConsole({module: "Client"});

    const chatClient = new Chat(keyPair2.publicKey, signatureOffloader2, handshakeFactoryFactory2, consoleClient, (message: string) => {
        consoleClient.info(message);
        checkToQuit();
    });

    chatClient.onConnectionError( (e) => {
        consoleMain.error("Connection error in client", e);
        process.exit(1);
    });

    chatClient.onConnectionConnect( () => {
        // Here we send when peer (server) is connected.
        consoleMain.info("Connection connected to client, send message from Client side");
        chatClient.sendMessage("Hello from Client", BLOB_DATA);
    });

    [status, err] = await chatClient.parseConfig(clientConfig);

    if (!status) {
        consoleMain.error(`Could not parse config: ${err}.`);
        process.exit(1);
    }

    chatClient.onStorageConnect( () => {
        chatClient.setupAppFetch();
    });

    chatClient.onStop( () => {
        signatureOffloader2.close();
    });

    await chatClient.start();

    const blobData = await blobPromise as Buffer;
    assert(blobData.equals(BLOB_DATA));

    consoleServer.info("Downloaded blob");
    checkToQuit();
}

main();
