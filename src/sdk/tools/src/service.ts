import {
    Service,
    CreateHandshakeFactoryFactory,
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

async function main(config: any) {
    console.info("Initializing...");
    const keyPair = ParseUtil.ParseKeyPair(config.keyPair);

    const handshakeFactoryFactory = CreateHandshakeFactoryFactory(keyPair);

    const signatureOffloader = new SignatureOffloader(keyPair);

    await signatureOffloader.init();

    const service = new Service(signatureOffloader, handshakeFactoryFactory);

    const [stat, err] = await service.parseConfig(config);

    if (!stat) {
        signatureOffloader.close();
        console.error("Could not parse config file", err);
        process.exit(1);
    }

    service.onConnectionError( (e: {subEvent: string, e: any}) => {
        console.debug("Connection error", `${e.e.error}`);
    });

    service.onStorageConnect( () => {
        console.aced("Connected to storage");
    });

    service.onStorageClose( () => {
        console.error("Disconnected from storage");
    });

    service.onConnectionConnect( (e: {p2pClient: P2PClient}) => {
        const pubKey = e.p2pClient.getRemotePublicKey();
        console.info(`Peer just connected to service, peer's publicKey is ${pubKey.toString("hex")}`);
    });

    service.onConnectionClose( (e: {p2pClient: P2PClient}) => {
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

if (process.argv.length < 3) {
    console.getConsole().error(`Usage: service.ts service.json`);
    process.exit(1);
}

const serviceConfigPath = process.argv[2];

if (typeof(serviceConfigPath) !== "string") {
    console.getConsole().error(`Usage: service.ts service.json`);
    process.exit(1);
}

let config;
try {
    config = JSONUtil.LoadJSON(serviceConfigPath, ['.']);
}
catch(e) {
    console.error((e as any as Error).message);
    process.exit(1);
}

main(config);
