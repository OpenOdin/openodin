import {
    P2PClient,
    FetchResponse,
    StoreResponse,
    DATANODE_TYPE,
    DataInterface,
    NodeInterface,
    Status,
    StorageUtil,
    App,
    SignatureOffloader,
    sleep,
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

    constructor(signatureOffloader: SignatureOffloader, console: any, onMessage: Function) {
        super(signatureOffloader);
        this.console = console;
        this.onMessage = onMessage;
    }

    /**
     * @throws on signing failure.
     */
    public async sendMessage(message: string) {
        const keyPair = this.getKeyPair();
        const publicKey = this.getPublicKey();
        if (!this.isConnected() || !keyPair || !publicKey) {
            this.console.error("App not connected to storage, cannot send message");
            return;
        }

        const nodeCerts = this.getNodeCerts();

        const node = await this.nodeUtil.createDataNode({owner: publicKey, isLicensed: true, data: Buffer.from(message)}, keyPair, nodeCerts);
        const license = await this.nodeUtil.createLicenseNode({nodeId1: node.getId1(), owner: publicKey, extensions: 2, targetPublicKey: publicKey}, keyPair, nodeCerts);
        const storeRequest = StorageUtil.CreateStoreRequest({nodes: [node.export(), license.export()]});
        const storageClient = this.getStorageClient();


        if (!storageClient) {
            throw new Error("Missing storage client");
        }

        const {getResponse} = storageClient.store(storeRequest);

        if (!getResponse) {
            throw new Error("Could not store nodes.");
        }

        getResponse.onReply( async (peer: P2PClient, storeResponse: StoreResponse) => {
            if (storeResponse.status !== Status.RESULT || storeResponse.storedId1.length < 2) {
                throw new Error(`Unexpected result on store: ${storeResponse.error}`);
            }
        });
    }

    public setupAppFetch() {
        if (!this.isConnected()) {
            throw new Error("Not connected");
        }

        const fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId: Buffer.alloc(32),fill(0),
            triggerNodeId: Buffer.alloc(32),fill(0),
            discardRoot: true,
            match: [
                {nodeType: DATANODE_TYPE},
            ],
        }});

        const storageClient = this.getStorageClient();
        if (!storageClient) {
            this.console.error("No storage. Could not setup fetch against storage. No data will flow.");
            return;
        }

        const {getResponse} = storageClient.fetch(fetchRequest);
        if (!getResponse) {
            this.console.error("Could not setup fetch against storage. No data will flow.");
            return;
        }

        // Keep 1000 last node IDs in a list to avoid event duplicates. Due to the nature of at-least-once delivery guarantees.
        const cachedNodeIds1: Buffer[] = [];

        getResponse.onReply( async (peer: P2PClient, fetchResponse: FetchResponse) => {
            if (fetchResponse.status !== Status.RESULT) {
                this.console.error(`Error code (${fetchResponse.status}) returned on fetch, error message: ${fetchResponse.error}`);
                return;
            }
            // Data incoming from storage
            // Transform and render
            // Note that since we are fetching nodes from our Storage we opt to not verify them ourselves but trust the Storage.
            const nodes = StorageUtil.ExtractFetchResponseNodes(fetchResponse);
            nodes.forEach( (node: NodeInterface) => {
                const id1 = node.getId1();
                if (!id1) {
                    return;
                }
                if (!cachedNodeIds1.some( id1b => id1b.equals(id1) )) {
                    if (node.getType().equals(DATANODE_TYPE)) {
                        this.onMessage((node as DataInterface).getData()?.toString());
                        cachedNodeIds1.unshift(id1);
                        if (cachedNodeIds1.length > 1000) {
                            cachedNodeIds1.length = 1000;
                        }
                    }
                }
            });
        });
    }
}

async function main() {
    const consoleMain = PocketConsole({module: "Main  "});

    const signatureOffloader = new SignatureOffloader();
    await signatureOffloader.init();

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

    let abortTimeout = setTimeout( () => {
        consoleMain.error("Messages not transferred within timeout, aborting.");
        process.exit(1);
    }, 15000);

    let messageCounter = 0;

    const checkToQuit = () => {
        messageCounter++;
        if (messageCounter === 4) {
            clearTimeout(abortTimeout);
            consoleMain.aced("All messages transferred, closing Server and Client");
            setTimeout( () => {
                chatServer.stop();
                chatClient.stop();
            }, 500);
        }
    };

    consoleMain.info("Init Chat Server");
    const consoleServer = PocketConsole({module: "Server"});
    const chatServer = new Chat(signatureOffloader, consoleServer, (message: string) => {
        consoleServer.info(message);
        checkToQuit();
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
    await chatServer.start();

    await sleep(1000);

    consoleMain.info("Init Chat Client");
    const consoleClient = PocketConsole({module: "Client"});
    const chatClient = new Chat(signatureOffloader, consoleClient, (message: string) => {
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
        chatClient.sendMessage("Hello from Client");
    });
    [status, err] = await chatClient.parseConfig(clientConfig);
    if (!status) {
        consoleMain.error(`Could not parse config: ${err}.`);
        process.exit(1);
    }
    chatClient.onStorageConnect( () => {
        chatClient.setupAppFetch();
    });
    await chatClient.start();

    chatClient.onStop( () => {
        signatureOffloader.close();
    });
}

main();
