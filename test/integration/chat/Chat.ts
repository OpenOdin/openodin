import { strict as assert } from "assert";

import {
    SignatureOffloader,
    AuthFactory,
    sleep,
    Hash,
    BlobEvent,
    Service,
    Thread,
    ApplicationConf,
    WalletConf,
    BufferStreamWriter,
    BufferStreamReader,
    StreamStatus,
    RPC,
    JSONUtil,
    P2PClient,
    ParseSchema,
    ApplicationConfSchema,
    WalletConfSchema,
    LicenseNode,
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
        serverConfig = ParseSchema(ApplicationConfSchema,
            JSONUtil.LoadJSON(`${__dirname}/server-conf.json`, ['.']));

        clientConfig = ParseSchema(ApplicationConfSchema,
            JSONUtil.LoadJSON(`${__dirname}/client-conf.json`, ['.']));

        serverWallet = ParseSchema(WalletConfSchema,
            JSONUtil.LoadJSON(`${__dirname}/server-wallet.json`, ['.']));

        clientWallet = ParseSchema(WalletConfSchema,
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

    const serverPublicKey = chatServer.getPublicKey();
    const clientPublicKey = chatClient.getPublicKey();

    consoleMain.info(`Server publicKey: ${serverPublicKey.toString("hex")}`);

    consoleMain.info(`Client publicKey: ${clientPublicKey.toString("hex")}`);


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

        const threadFetchParams = {query: {parentId: Buffer.alloc(32)}};

        const serverThread = Thread.fromService(threadTemplate, threadFetchParams, chatServer);

        const crdtView = serverThread.getStream().getView();

        serverThread.onChange( async ({added}) => {
            if (added.length === 0) {
                return;
            }

            messageCounter++;

            assert(added.length === 1);

            const id1 = added[0].id1;

            const dataNode = crdtView.getNode(id1);

            assert(dataNode);

            const message = dataNode.getProps().data?.toString();

            consoleServer.info(message);

            if (dataNode.getProps().blobHash) {
                const streamReader = serverThread!.getBlobStreamReader(dataNode.getProps().id1!);

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

        const targets = [serverPublicKey];

        await serverThread.postLicense("message", node, targets);
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

        const threadTemplate = chatClient.getThreadTemplates().channel;

        const threadFetchParams = {query: {parentId: Buffer.alloc(32)}};

        clientThread = Thread.fromService(threadTemplate, threadFetchParams, chatClient);

        const crdtView = clientThread.getStream().getView();

        clientThread.onChange( ({added}) => {
            if (added.length === 0) {
                return;
            }

            added.forEach( item => {
                messageCounter++;

                const dataNode = crdtView.getNode(item.id1);

                assert(dataNode);

                const message = dataNode.getProps().data?.toString();

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

        const targets = [clientPublicKey];

        await clientThread!.postLicense("message", node, targets);

        const nodeId1 = node.getProps().id1;

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
