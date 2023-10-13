import { strict as assert } from "assert";

import {
    Service,
    CreateHandshakeFactoryFactory,
    UniverseConf,
    WalletConf,
} from "../../../service";

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
} from "../../../datamodel/decoder/SignatureOffloader";

import {
    PocketConsole,
} from "pocket-console";

const console = PocketConsole({module: "Service", format: "%t %c[%L%l]%C "});

async function main(universeConf: UniverseConf, walletConf: WalletConf) {
    console.info("Initializing...");

    const keyPair = walletConf.keyPairs[0];

    assert(keyPair);

    const handshakeFactoryFactory = CreateHandshakeFactoryFactory(keyPair);

    const signatureOffloader = new SignatureOffloader();

    await signatureOffloader.init();

    const service = new Service(universeConf, walletConf, signatureOffloader, handshakeFactoryFactory);

    await service.init()

    service.onPeerError( (e: {subEvent: string, e: any}) => {
        console.debug("Peer connection error", `${e.e.error}`);
    });

    service.onStorageConnect( () => {
        console.aced("Connected to storage");
    });

    service.onStorageClose( () => {
        console.error("Disconnected from storage");
    });

    service.onPeerConnect( (e: {p2pClient: P2PClient}) => {
        const pubKey = e.p2pClient.getRemotePublicKey();
        console.info(`Peer just connected to service, peer's publicKey is ${pubKey.toString("hex")}`);
    });

    service.onPeerClose( (e: {p2pClient: P2PClient}) => {
        const pubKey = e.p2pClient.getRemotePublicKey();
        console.info(`Peer disconnected, who has publicKey ${pubKey.toString("hex")}`);
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
    console.getConsole().error(`Usage: service.ts universe.json wallet.json`);
    process.exit(1);
}

const universeConfigPath = process.argv[2];
const walletConfigPath = process.argv[3];

if (typeof(universeConfigPath) !== "string" || typeof(walletConfigPath) !== "string") {
    console.getConsole().error(`Usage: service.ts universe.json wallet.json`);
    process.exit(1);
}

let universeConf: UniverseConf;
let walletConf: WalletConf;

try {
    universeConf = ParseUtil.ParseUniverseConf(
        JSONUtil.LoadJSON(universeConfigPath, ['.']));

    walletConf = ParseUtil.ParseWalletConf(
        JSONUtil.LoadJSON(walletConfigPath, ['.']));
}
catch(e) {
    console.error("Could not parse config files", (e as any as Error).message);
    process.exit(1);
}

main(universeConf, walletConf);
