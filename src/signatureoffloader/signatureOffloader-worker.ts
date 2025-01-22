/**
 * NOTE: This file is TypeScript compiled into
 * "./build/src/signatureoffloader/signatureOffloader-worker.js" which is the file loaded into
 * the worker thread when running in NodeJS.
 *
 * That compiled file is also browserified during the build process to
 * "./build/src/signatureoffloader/signatureOffloader-worker-browser.js" which is the file loaded
 * when running in a browser, and this file must always be copied to the browser application
 * public root directory so it is accessible to be loaded by the browser's Worker() in run-time.
 *
 */

import {
    RPC,
} from "../util/RPC";

import {
    ToBeSigned,
    SignaturesCollection,
} from "./types";

import {
    KeyPair,
} from "../datamodel";

import {
    SignatureOffloaderWorker,
} from "./SignatureOffloaderWorker";

function main(self?: any) {
    // In case of Browser, self is likely to be set.
    // This is where the event listener needs to get installed to.
    if(self) {
        self.addEventListener = addEventListener;
    }

    const postMessageWrapped = (message: any) => {
        postMessage({message});
    };

    const listenMessage = (listener: any) => {
        addEventListener("message", (event: any) => {
            listener(event.data.message);
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

main();
