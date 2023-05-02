import {
    Node,
} from "../../../datamodel";

function GenKeyPair() {
    const keyPair = Node.GenKeyPair();
    const date = `${Date()}`;
    const result = {
        ["#KeyPair-created"]: `${date}`,
        keyPair: {
            publicKey: Buffer.from(keyPair.publicKey).toString("hex"),
            secretKey: Buffer.from(keyPair.secretKey).toString("hex")
        }
    };
    console.log(JSON.stringify(result, null, 4));
}

GenKeyPair();
