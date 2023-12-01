import {
    Crypto,
} from "../../../datamodel/Crypto";

const keyType = process.argv[2] || "ed25519";

if (!["ed25519", "ethereum"].includes(keyType)) {
    console.error(`Usage: keygen.ts [ed25519 | ethereum]`);
    process.exit(1);
}

let keyPair;
let keyTypeNote;

if (keyType === "ed25519") {
    keyPair = Crypto.GenKeyPair();
    keyTypeNote = "Ed25519: generated with NaCl";
}
else {
    keyPair = Crypto.GenEthereumKeyPair();
    keyTypeNote = "Ethereum: ECDSA key pair generated with @ethereumjs/wallet, publicKey=address";
}

const result = {
    ["#KeyPairCreated"]: `${Date()}`,
    ["#KeyPairType"]: `${keyTypeNote}`,
    keyPair: {
        publicKey: Buffer.from(keyPair.publicKey).toString("hex"),
        secretKey: Buffer.from(keyPair.secretKey).toString("hex")
    }
};

console.log(JSON.stringify(result, null, 4));
