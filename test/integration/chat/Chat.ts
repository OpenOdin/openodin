import { strict as assert } from "assert";

import {
    DataInterface,
    SignatureOffloader,
    AuthFactory,
    sleep,
    Hash,
    BlobEvent,
    ParseUtil,
    AbstractStreamReader,
    Service,
    Thread,
    StorageUtil,
    ApplicationConf,
    WalletConf,
    BufferStreamWriter,
    BufferStreamReader,
    StreamStatus,
    RPC,
    JSONUtil,
    P2PClient,
} from "../../../";

import {
    PocketConsole,
} from "pocket-console";

const BLOB_DATA = Buffer.concat([Buffer.alloc(1024 * 20).fill(0xa0),
    Buffer.alloc(1024 * 20).fill(0xb0),
    Buffer.alloc(1024 * 20).fill(0xc0)]);

async function main() {
    const consoleMain = PocketConsole({module: "Main  "});

    let serverConfig: ApplicationConf;
    let clientConfig: ApplicationConf;
    let serverWallet: WalletConf;
    let clientWallet: WalletConf;
    try {
        serverConfig = ParseUtil.ParseApplicationConf(
            JSONUtil.LoadJSON(`${__dirname}/server-conf.json`, ['.']));

        clientConfig = ParseUtil.ParseApplicationConf(
            JSONUtil.LoadJSON(`${__dirname}/client-conf.json`, ['.']));

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

    const keyPair2 = clientWallet.keyPairs[0];
    assert(keyPair2);

    const handshakeFactoryFactory1 = new AuthFactory(keyPair1);
    const handshakeFactoryFactory2 = new AuthFactory(keyPair2);

    const signatureOffloader1 = new SignatureOffloader();
    await signatureOffloader1.init();

    const signatureOffloader2 = new SignatureOffloader();
    await signatureOffloader2.init();

    const chatServer = new Service(serverConfig, serverWallet, signatureOffloader1, handshakeFactoryFactory1);

    await chatServer.init();

    const chatClient = new Service(clientConfig, clientWallet, signatureOffloader2, handshakeFactoryFactory2);

    await chatClient.init();

    const publicKey1 = chatServer.getPublicKey();
    const publicKey2 = chatClient.getPublicKey();


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

    chatServer.onStorageConnect( async (p2pClient: P2PClient) => {
        const storageClient = p2pClient;

        const threadTemplate = chatServer.getThreadTemplates().channel;

        const targets = [publicKey1];

        const threadFetchParams = {query: {parentId: Buffer.alloc(32)}};

        const serverThread = new Thread(threadTemplate, threadFetchParams,
            chatServer.getStorageClient()!, chatServer.getNodeUtil(), chatServer.getPublicKey(),
            chatServer.getSignerPublicKey());

        const responseAPI = serverThread.stream();
        responseAPI.onChange( async (added) => {
            if (added.length === 0) {
                return;
            }

            messageCounter++;

            assert(added.length === 1);

            const id1 = added[0];

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
        const node = await serverThread.post("message", {data: Buffer.from("Hello from Server")});
        serverThread.postLicense("message", node, {targets});
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


    let clientThread: Thread | undefined;

    chatClient.onStorageConnect( (p2pClient: P2PClient) => {
        const storageClient = p2pClient;

        const threadTemplate = chatServer.getThreadTemplates().channel;

        const threadFetchParams = {query: {parentId: Buffer.alloc(32)}};

        clientThread = new Thread(threadTemplate, threadFetchParams,
            chatClient.getStorageClient()!, chatClient.getNodeUtil(), chatClient.getPublicKey(),
            chatClient.getSignerPublicKey());

        const responseAPI = clientThread.stream();

        responseAPI.onChange( (added) => {
            if (added.length === 0) {
                return;
            }

            added.forEach( id1 => {
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
        const node = await clientThread!.post("message", {blobHash, blobLength, data: Buffer.from("Hello from Client with attachment")});

        const targets = [publicKey2];

        await clientThread!.postLicense("message", node, {targets});

        const nodeId1 = node.getId1();

        const streamWriter = clientThread!.getBlobStreamWriter(nodeId1!, streamReader);

        const writeData = await streamWriter.run();
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
