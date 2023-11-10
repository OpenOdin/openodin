import { strict as assert } from "assert";

import {
    DataInterface,
    SignatureOffloader,
    CreateHandshakeFactoryFactory,
    sleep,
    Hash,
    BlobEvent,
    ParseUtil,
    CRDTVIEW_EVENT,
    AbstractStreamReader,
    Service,
    Thread,
    StorageUtil,
    UniverseConf,
    WalletConf,
    BufferStreamWriter,
    BufferStreamReader,
    StreamStatus,
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
        if (messageCounter === 4) {
            clearTimeout(abortTimeout);
            consoleMain.aced("All messages transferred, closing Server and Client");
            setTimeout( () => {
                chatServer.stop();
                chatClient.stop();
            }, 500);
        }
        else {
            consoleMain.error("Not exact nr of messages (4) recieved", messageCounter);
            process.exit(1);
        }
    };

    let blobResolve: Function | undefined;

    const blobPromise = new Promise( (resolve, reject) => {
        blobResolve = resolve;
    });

    consoleMain.info("Init Chat Server");

    const consoleServer = PocketConsole({module: "Server"});

    const chatServer = new Service(serverConfig, serverWallet, signatureOffloader1, handshakeFactoryFactory1);

    await chatServer.init();

    chatServer.onPeerError( (e) => {
        consoleMain.error("Peer connection error in server", e);
        process.exit(1);
    });

    chatServer.onStorageConnect( async (e) => {
        const storageClient = e.p2pClient;

        const serverThread = chatServer.makeThread("channel", {parentId: Buffer.alloc(32),
            targets: [keyPair1.publicKey]});

        const responseAPI = serverThread.stream();
        responseAPI.onChange( async (event) => {
            if (event.added.length === 0) {
                return;
            }

            messageCounter++;

            assert(event.added.length === 1);

            const id1 = event.added[0];

            const dataNode = responseAPI.getCRDTView().getNode(id1);

            assert(dataNode);

            const message = dataNode.getData()?.toString();

            consoleServer.info(message);

            if (dataNode.hasBlob()) {
                const streamReader = serverThread!.getBlobStreamReader(dataNode.getId1()!);

                const streamWriter = new BufferStreamWriter(streamReader);

                const writeData = await streamWriter.run();

                if (writeData.status === StreamStatus.RESULT) {
                    const blobData = Buffer.concat(streamWriter.getBuffers());

                    blobResolve && blobResolve(blobData);

                    return;
                }

                consoleServer.error(`Could not download blob: ${streamWriter.getError()}`);

                blobResolve && blobResolve();
            }
        });

        // Here we send as soon as Storage is connected, peer might or might
        // not be connected yet.
        consoleMain.info("Storage connected, send message from Server side");
        const [node] = await serverThread.post("message", {data: Buffer.from("Hello from Server")});
        if (node) {
            serverThread.postLicense("message", node);
        }
    });

    chatServer.onPeerConnect( () => {
        consoleMain.info("Peer connected to server");
    });

    chatServer.onStop( () => {
        signatureOffloader1.close();
    });

    await chatServer.start();

    await sleep(1000);

    consoleMain.info("Init Chat Client");
    const consoleClient = PocketConsole({module: "Client"});


    const chatClient = new Service(clientConfig, clientWallet, signatureOffloader2, handshakeFactoryFactory2);

    await chatClient.init();

    chatClient.onPeerError( (e) => {
        consoleMain.error("Peer error in client", e);
        process.exit(1);
    });

    let clientThread: Thread | undefined;

    chatClient.onStorageConnect( (e) => {
        const storageClient = e.p2pClient;

        clientThread = chatClient.makeThread("channel", {parentId: Buffer.alloc(32),
            targets: [keyPair2.publicKey]});

        const responseAPI = clientThread.stream();

        responseAPI.onChange( (event) => {
            if (event.added.length === 0) {
                return;
            }

            event.added.forEach( id1 => {
                messageCounter++;

                const dataNode = responseAPI.getCRDTView().getNode(id1);

                assert(dataNode);

                const message = dataNode.getData()?.toString();
                consoleClient.info(message);
            });
        });
    });

    chatClient.onPeerConnect( async () => {
        consoleMain.info("Peer connected to client, send message from Client side");
        const blobLength = BigInt(BLOB_DATA.length);
        const blobHash = Hash(BLOB_DATA);
        const streamReader = new BufferStreamReader(BLOB_DATA);
        const [node] = await clientThread!.post("message", {blobHash, blobLength, data: Buffer.from("Hello from Client with attachment")});
        if (node) {
            clientThread!.postLicense("message", node);

            const nodeId1 = node.getId1();

            const streamWriter = clientThread!.getBlobStreamWriter(nodeId1!, streamReader);

            const writeData = await streamWriter.run();
        }
    });

    chatClient.onStop( () => {
        signatureOffloader2.close();
    });

    await chatClient.start();

    const blobData = await blobPromise as Buffer;
    assert(blobData);
    assert(blobData.equals(BLOB_DATA));

    consoleServer.aced("Downloaded blob successfully");

    setTimeout( () => checkToQuit(), 100 );
}

main();
