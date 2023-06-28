import {
    RPC,
} from "./RPC";

import {
    CreateHandshakeFactoryFactoryRPCClient,
} from "./HandshakeFactoryFactoryRPCClient";

import {
    SignatureOffloaderInterface,
} from "../datamodel/decoder";

import {
    SignatureOffloaderRPCClient,
} from "./SignatureOffloaderRPCClient";

import {
    HandshakeFactoryFactoryInterface,
} from "../service/types";

export class Universe {
    protected postMessage: (message: any) => void;
    protected listenMessage: ( (message: any) => void);
    protected mainRPC: RPC;

    constructor(postMessage: (message: any) => void,
        listenMessage: ( (message: any) => void), mainRPCId: string) {

        this.postMessage = postMessage;
        this.listenMessage = listenMessage;

        this.mainRPC = new RPC(this.postMessage, this.listenMessage, mainRPCId);
    }

    public async auth(): Promise<{
        signatureOffloader: SignatureOffloaderInterface,
        handshakeFactoryFactory: HandshakeFactoryFactoryInterface,
    }> {

        const [rpcId1, rpcId2] = await this.mainRPC.call("auth");

        if (!rpcId1) {
            throw new Error("Auth failed");
        }

        const rpc1 = new RPC(this.postMessage, this.listenMessage, rpcId1);
        const signatureOffloader = new SignatureOffloaderRPCClient(rpc1);

        const rpc2 = new RPC(this.postMessage, this.listenMessage, rpcId2);
        const handshakeFactoryFactory = CreateHandshakeFactoryFactoryRPCClient(rpc2);

        return {
            signatureOffloader,
            handshakeFactoryFactory,
        };
    }
}
