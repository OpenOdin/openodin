import { strict as assert } from "assert";

import {
    DataInterface,
    SignatureOffloader,
    CreateHandshakeFactoryFactory,
    sleep,
    Hash,
    BlobEvent,
    ParseUtil,
    TransformerItem,
    AbstractStreamReader,
    Service,
    Thread,
    StorageUtil,
    UniverseConf,
    WalletConf,
} from "../../../";

import {
    KeyManager,
    Universe,
    RPC,
} from "../../../src/keymanager";

import {
    JSONUtil,
} from "../../../src/util/JSONUtil";

import {
    PocketConsole,
} from "pocket-console";

const BLOB_DATA = Buffer.concat([Buffer.alloc(1024 * 20).fill(0xa0),
    Buffer.alloc(1024 * 20).fill(0xb0),
    Buffer.alloc(1024 * 20).fill(0xc0)]);

class StreamReader extends AbstractStreamReader {
    constructor(protected data: Buffer) {
        super(0n);
    }

    protected async read() {
        if (this.pos === 0n) {
            this.buffered.push({size: BigInt(this.data.length), data: this.data, pos: this.pos});
            this.pos = BigInt(this.data.length);
        }
        else {
            this.buffered.push({size: BigInt(this.data.length), data: Buffer.alloc(0), pos: this.pos});
        }
    }
}

async function main() {
    const consoleMain = PocketConsole({module: "Main  "});

    let serverConfig: UniverseConf;
    let clientConfig: UniverseConf;
    let serverWallet: WalletConf;
    let clientWallet: WalletConf;
    try {
        serverConfig = ParseUtil.ParseUniverseConf(
            JSONUtil.LoadJSON(`${__dirname}/server-universe.json`, ['.']));

        clientConfig = ParseUtil.ParseUniverseConf(
            JSONUtil.LoadJSON(`${__dirname}/client-universe.json`, ['.']));

        serverWallet = ParseUtil.ParseWalletConf(
            JSONUtil.LoadJSON(`${__dirname}/server-wallet.json`, ['.']));

        clientWallet = ParseUtil.ParseWalletConf(
            JSONUtil.LoadJSON(`${__dirname}/client-wallet.json`, ['.']));
    }
    catch(e) {
        consoleMain.error(`Could not load and parse config files`, e);
        process.exit(1);
    }

    const keyPair1 = serverWallet.keyPairs[0];
    assert(keyPair1);

    const keyPair2 = clientWallet.keyPairs[0];
    assert(keyPair2);

    const handshakeFactoryFactory1 = CreateHandshakeFactoryFactory(keyPair1);
    const handshakeFactoryFactory2 = CreateHandshakeFactoryFactory(keyPair2);

    const signatureOffloader1 = new SignatureOffloader();
    await signatureOffloader1.init();

    const signatureOffloader2 = new SignatureOffloader();
    await signatureOffloader2.init();


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

    const chatServer = new Service(serverConfig, signatureOffloader1, handshakeFactoryFactory1);

    await chatServer.init(serverWallet);

    chatServer.onConnectionError( (e) => {
        consoleMain.error("Connection error in server", e);
        process.exit(1);
    });

    chatServer.onStorageConnect( async (e) => {
        const storageClient = e.p2pClient;

        const serverThread = chatServer.makeThread("channel", {parentId: Buffer.alloc(32),
            licenseTargets: [keyPair1.publicKey]});

        serverThread.stream({}, (getResponse, transformerCache) => {
            transformerCache?.onChange( (item: TransformerItem) => {
                const message = (item.node as DataInterface).getData()?.toString();
                consoleServer.info(message);
                checkToQuit();
            });
        });

        // Here we send as soon as Storage is connected, peer might or might
        // not be connected yet.
        consoleMain.info("Storage connected, send message from Server side");
        const [node] = await serverThread.post({data: Buffer.from("Hello from Server")});
        if (node) {
            serverThread.postLicense(node);
        }
    });

    chatServer.onBlob( async (blobEvent: BlobEvent) => {
        if (blobEvent.nodeId1 && !blobEvent.error) {
            consoleServer.info("server got attachment");
            const storageUtil = new StorageUtil(chatServer.getStorageClient()!);
            const blobData = await storageUtil.readBlob(blobEvent.nodeId1!);

            if (blobResolve) {
                blobResolve(blobData);
            }
        }
    });

    chatServer.onConnectionConnect( () => {
        consoleMain.info("Connection connected to server");
    });

    chatServer.onStop( () => {
        signatureOffloader1.close();
    });

    await chatServer.start();

    await sleep(1000);

    consoleMain.info("Init Chat Client");
    const consoleClient = PocketConsole({module: "Client"});


    const chatClient = new Service(clientConfig, signatureOffloader2, handshakeFactoryFactory2);

    await chatClient.init(clientWallet);

    chatClient.onConnectionError( (e) => {
        consoleMain.error("Connection error in client", e);
        process.exit(1);
    });

    var clientThread: Thread | undefined;

    chatClient.onStorageConnect( (e) => {
        const storageClient = e.p2pClient;

        clientThread = chatClient.makeThread("channel", {parentId: Buffer.alloc(32),
            licenseTargets: [keyPair2.publicKey]});

        clientThread.stream({}, (getResponse, transformerCache) => {
            transformerCache?.onChange( (item: TransformerItem, changeType: string) => {
                const message = (item.node as DataInterface).getData()?.toString();
                consoleClient.info(message);
                checkToQuit();
            });
        });
    });

    chatClient.onConnectionConnect( async () => {
        consoleMain.info("Connection connected to client, send message from Client side");
        const blobLength = BigInt(BLOB_DATA.length);
        const blobHash = Hash(BLOB_DATA);
        const streamReader = new StreamReader(BLOB_DATA);
        const [node] = await clientThread!.post({blobHash, blobLength, data: Buffer.from("Hello from Client with attachment")});
        if (node) {
            clientThread!.postLicense(node);

            const nodeId1 = node.getId1();
            const storageUtil = new StorageUtil(chatClient.getStorageClient()!);
            storageUtil.streamStoreBlob(nodeId1!, streamReader);
        }
    });

    chatClient.onStop( () => {
        signatureOffloader2.close();
    });

    await chatClient.start();

    const blobData = await blobPromise as Buffer;
    assert(blobData.equals(BLOB_DATA));

    consoleServer.aced("Downloaded blob successfully");
    checkToQuit();
}

main();
