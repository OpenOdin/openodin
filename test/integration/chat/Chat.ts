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
    HandshakeFactoryFactoryInterface,
    CreateHandshakeFactoryFactory,
    sleep,
    Hash,
    BlobEvent,
    ParseUtil,
} from "../../../";

import {
    JSONUtil,
} from "../../../src/util/JSONUtil";

import {
    LogLevel,
    PocketConsole,
} from "pocket-console";

class Chat extends App {
    protected console: any;
    protected onMessage: Function;
    protected onBlob?: Function;

    constructor(signatureOffloader: SignatureOffloader,
        handshakeFactoryFactory: HandshakeFactoryFactoryInterface,
        console: any, onMessage: Function, onBlob?: Function) {

        super(signatureOffloader, handshakeFactoryFactory);

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

        const dataNode = await this.nodeUtil.createDataNode({owner: publicKey, isLicensed: true, data: Buffer.from(message), blobHash, blobLength}, undefined, nodeCerts);
        const licenseNode = await this.nodeUtil.createLicenseNode({nodeId1: dataNode.getId1(), owner: publicKey, extensions: 2, targetPublicKey: publicKey}, undefined, nodeCerts);

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

    const keyPair1 = ParseUtil.ParseKeyPair(serverConfig.keyPair);
    const keyPair2 = ParseUtil.ParseKeyPair(clientConfig.keyPair);

    const signatureOffloader1 = new SignatureOffloader(keyPair1);
    await signatureOffloader1.init();

    const signatureOffloader2 = new SignatureOffloader(keyPair2);
    await signatureOffloader2.init();

    const handshakeFactoryFactory1 = CreateHandshakeFactoryFactory(keyPair1);
    const handshakeFactoryFactory2 = CreateHandshakeFactoryFactory(keyPair2);

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

    const chatServer = new Chat(signatureOffloader1, handshakeFactoryFactory1, consoleServer, (message: string) => {
        consoleServer.info(message);
        checkToQuit();
    }, async (blobEvent: BlobEvent) => {
        if (blobEvent.nodeId1 && !blobEvent.error) {
            const blobData = await chatServer.readBlob(blobEvent.nodeId1!);

            assert(blobData.length === 1024 * 60);

            if (blobResolve) {
                blobResolve();
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

    const chatClient = new Chat(signatureOffloader2, handshakeFactoryFactory2, consoleClient, (message: string) => {
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
        chatClient.sendMessage("Hello from Client", Buffer.alloc(1024 * 60).fill(0xa0));
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

    await blobPromise;
    consoleServer.info("Downloaded blob");
    checkToQuit();
}

main();
