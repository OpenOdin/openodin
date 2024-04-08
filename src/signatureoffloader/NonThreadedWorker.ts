import {
    RPC,
} from "../util/RPC";

import {
    SignatureOffloaderWorker,
} from "./SignatureOffloaderWorker";

import {
    KeyPair,
} from "../datamodel/types";

import {
    ToBeSigned,
    SignaturesCollection,
} from "./types";

export class NonThreadedWorker {
    protected cb?: Function;

    protected listener?: Function;

    // Faking the Worker interface
    //
    public onerror: any;

    constructor(_?: string) {
        const postMessage = (event: any) => {
            this.cb?.(event);
        };

        const addEventListener = (_: "message", listener: Function) => {
            this.listener = listener;
        };

        main(postMessage, addEventListener);
    }

    public postMessage(message: any) {
        this.listener?.(message);
    }

    public addEventListener(topic: "message", cb: Function) {
        this.cb = cb;
    }

    public terminate() {
    }
}

function main(postMessage: Function, addEventListener: Function) {
    const postMessageWrapped = (message: any) => {
        const event = {
            type: "message",
            timeStamp: Date.now(),
            data: {
                message,
            },
            currentTarget: undefined,
            target: undefined,
        };

        postMessage(event);
    };

    const listenMessage = (listener: any) => {
        addEventListener("message", (data: any) => {
            listener(data.message);
        });
    };

    const signatureOffloaderWorker = new SignatureOffloaderWorker();

    const rpc = new RPC(postMessageWrapped, listenMessage);

    rpc.onCall("addKeyPair", (keyPair: KeyPair) => {
        return signatureOffloaderWorker.addKeyPair(keyPair);
    });

    rpc.onCall("verify", (signaturesCollections: SignaturesCollection[]) => {
        return signatureOffloaderWorker.verify(signaturesCollections);
    });

    rpc.onCall("sign", (toBeSigned: ToBeSigned[]) => {
        return signatureOffloaderWorker.sign(toBeSigned);
    });

    signatureOffloaderWorker.init().then( () => rpc.call("hello") );
}
