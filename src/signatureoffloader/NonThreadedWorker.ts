import {
    RPC,
} from "../util/RPC";

import {
    SignatureOffloaderWorker,
} from "./SignatureOffloaderWorker";

import {
    KeyPair,
} from "../datamodel";

import {
    ToBeSigned,
    SignaturesCollection,
} from "./types";

type Event = {
    type: "message",
    timeStamp: number,
    data: {
        message: any,
    },
    currentTarget?: any,
    target?: any,
};

type AddEventListener = (topic: "message", listener: (data: any) => void) => void;

export class NonThreadedWorker {
    protected cb?: (event: any) => void;

    protected listener?: (message: any) => void;

    // Faking the Worker interface
    //
    public onerror: any;

    constructor(_?: string) {  //eslint-disable-line @typescript-eslint/no-unused-vars
        const postMessage = (event: any) => {
            this.cb?.(event);
        };

        const addEventListener: AddEventListener =
            (_: "message", listener: (message: any) => void) => {
                this.listener = listener;
        };

        main(postMessage, addEventListener);
    }

    public postMessage(message: any) {
        this.listener?.(message);
    }

    public addEventListener(topic: "message", cb: (event: any) => void) {
        this.cb = cb;
    }

    public terminate() {
    }
}

function main(postMessage: (event: Event) => void, addEventListener: AddEventListener) {
    const postMessageWrapped = (message: any) => {
        const event: Event = {
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
