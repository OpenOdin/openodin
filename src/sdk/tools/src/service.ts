#!/usr/bin/env node

import { strict as assert } from "assert";

import {
    Service,
    ApplicationConf,
    WalletConf,
} from "../../../service";

import {
    AuthFactory,
} from "../../../auth/AuthFactory";

import {
    P2PClient,
} from "../../../p2pclient";

import {
    JSONUtil,
} from "../../../util/JSONUtil";

import {
    ParseUtil,
} from "../../../util/ParseUtil";

import {
    SignatureOffloader,
} from "../../../signatureoffloader/SignatureOffloader";

import {
    PocketConsole,
} from "pocket-console";

const console = PocketConsole({module: "Service", format: "%t %c[%L%l]%C "});

async function main(applicationConf: ApplicationConf, walletConf: WalletConf) {
    console.info("Initializing...");

    const keyPair = walletConf.keyPairs[0];

    assert(keyPair);

    const authFactory = new AuthFactory(keyPair);

    const signatureOffloader = new SignatureOffloader();

    await signatureOffloader.init();

    const service = new Service(applicationConf, walletConf, signatureOffloader, authFactory);

    await service.init();

    console.info(`PublicKey: ${service.getPublicKey().toString("hex")}`);

    service.onStorageConnect( () => {
        console.aced("Connected to storage");
    });

    service.onStorageClose( () => {
        console.error("Disconnected from storage");
    });

    service.onStorageParseError( (error) => {
        console.error("Could not parse storage configuraton", error.message);
    });


    service.onPeerConnect( (p2pClient: P2PClient) => {
        const pubKey = p2pClient.getRemotePublicKey();
        console.info(`Peer connected: ${pubKey.toString("hex")}`);

        p2pClient.onMessagingError( (message: string) => {
            console.error("Error in peer", message);
        });

        p2pClient.onMessagingPong( (roundTripTime: number) => {  //eslint-disable-line @typescript-eslint/no-unused-vars
            //console.debug("Ping/pong round trip time [ms]", roundTripTime);
        });
    });

    service.onPeerClose( (p2pClient: P2PClient) => {
        const pubKey = p2pClient.getRemotePublicKey();
        console.info(`Peer disconnected: ${pubKey.toString("hex")}`);
    });

    service.onPeerAuthCertError( (error: Error, authCert: Buffer) => {
        console.info("Peer's auth cert not valid", error, authCert);
    });

    service.onPeerParseError( (error: Error) => {
        console.error("Could not parse peer configuraton", error.message);
    });

    service.onPeerFactoryCreate( (handshakeFactory) => {
        handshakeFactory.onSocketFactoryError( (name, error) => {
            console.error("Socket error", name, error.message);
        });

        handshakeFactory.onHandshakeError( (error) => {
            console.debug("Handshake error", error.message);
        });
    });

    service.onStop( () => {
        signatureOffloader.close();
    });

    try {
        await service.start();
    }
    catch(e) {
        signatureOffloader.close();
        console.error("Could not init Service", e);
        process.exit(1);
    }
}

if (process.argv.length < 4) {
    console.getConsole().error(`Usage: service.ts application.json wallet.json`);
    process.exit(1);
}

const applicationConfigPath = process.argv[2];
const walletConfigPath = process.argv[3];

if (typeof(applicationConfigPath) !== "string" || typeof(walletConfigPath) !== "string") {
    console.getConsole().error(`Usage: service.ts application.json wallet.json`);
    process.exit(1);
}

let applicationConf: ApplicationConf;
let walletConf: WalletConf;

try {
    applicationConf = ParseUtil.ParseApplicationConf(
        JSONUtil.LoadJSON(applicationConfigPath, ['.']));

    walletConf = ParseUtil.ParseWalletConf(
        JSONUtil.LoadJSON(walletConfigPath, ['.']));
}
catch(e) {
    console.error("Could not parse config files", (e as any as Error).message);
    process.exit(1);
}

main(applicationConf, walletConf);
