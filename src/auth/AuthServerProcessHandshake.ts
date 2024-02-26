import {
    ClientInterface,
    CreatePair,
    ByteSize,
} from "pocket-sockets";

import {
    HandshakeResult,
    HandshakeAsServer,
} from "pocket-messaging";

import {
    AuthServerProcessInterface,
    APIAuthFactoryConfig,
    APISession,
    APIAuthResponse,
    APIAuthRequest,
    NodeSignProxyInterface,
} from "./types";

import {
    PromiseCallback,
    CopyBuffer,
} from "../util/common";

export class AuthServerProcessHandshake implements AuthServerProcessInterface {
    public static readonly NAME = "handshake";

    protected socket1: ClientInterface;

    protected pResult = PromiseCallback<HandshakeResult>();

    protected phase = 1;

    constructor(protected apiAuthFactoryConfig: APIAuthFactoryConfig) {
        //const config = (apiAuthFactoryConfig.serverAuth?.methods ?? {})
            //[AuthServerProcessHandshake.NAME] ?? {};

        const [socket1, socket2] = CreatePair();

        this.socket1 = socket1;

        let peerData: Buffer | undefined;

        if (typeof this.apiAuthFactoryConfig.peerData === "function") {
            peerData = this.apiAuthFactoryConfig.peerData(/*isServer=*/true);
        }
        else {
            peerData = this.apiAuthFactoryConfig.peerData;
        }

        const keyPair = this.apiAuthFactoryConfig.keyPair;

        const serverLongtermSk = CopyBuffer(keyPair.secretKey);

        const serverLongtermPk = CopyBuffer(keyPair.publicKey);

        const discriminator = CopyBuffer(this.apiAuthFactoryConfig.discriminator);

        const allowedClientKeys = this.apiAuthFactoryConfig.allowedClients;

        const p = HandshakeAsServer(socket2, serverLongtermSk, serverLongtermPk, discriminator,
            allowedClientKeys, peerData);

        p.then((handshakeResult: HandshakeResult) => this.pResult.cb(undefined, handshakeResult)).
            catch((error: Error) => this.pResult.cb(error));
    }

    public async next(session: APISession, apiAuthRequest: APIAuthRequest):
        Promise<[boolean, APIAuthResponse?, HandshakeResult?, NodeSignProxyInterface?]>
    {
        if (this.phase === 1) {
            // First incoming msg from client.
            //

            try {
                // pass on msg1 to HandshakeAsServer
                //
                if (typeof(apiAuthRequest.data) !== "string") {
                    throw new Error("Unexpected data");
                }

                this.socket1.send(Buffer.from(apiAuthRequest.data, "hex"));

                // await msg2 generated in HandshakeAsServer
                //
                const msg2 = await new ByteSize(this.socket1).read(-1);

                const apiAuthResponse: APIAuthResponse = {
                    sessionToken: session.sessionToken,
                    auth: apiAuthRequest.auth,
                    data: msg2.toString("hex"),
                };

                this.phase = 3;

                // write msg2 back to client
                //
                return [false, apiAuthResponse];
            }
            catch(e) {
                // write error back to client
                const apiAuthResponse: APIAuthResponse = {
                    sessionToken: session.sessionToken,
                    auth: apiAuthRequest.auth,
                    error: "Error in handshake",
                };

                return [true, apiAuthResponse];
            }
        }
        else if (this.phase === 3) {
            // Second incoming msg from client (msg 3)
            //

            try {
                // pass on msg3 to HandshakeAsServer
                //
                if (typeof(apiAuthRequest.data) !== "string") {
                    throw new Error("Unexpected data");
                }

                this.socket1.send(Buffer.from(apiAuthRequest.data, "hex"));

                // await msg4 generated in HandshakeAsServer
                //
                const msg4 = await new ByteSize(this.socket1).read(-1);

                const apiAuthResponse: APIAuthResponse = {
                    sessionToken: session.sessionToken,
                    auth: apiAuthRequest.auth,
                    data: msg4.toString("hex"),
                };

                this.phase = 0;

                // We are done, await result.
                //
                const handshakeResult = await this.pResult.promise;
                const proxy = undefined; // TODO

                // write msg4 back to client
                //
                return [false, apiAuthResponse, handshakeResult, proxy];
            }
            catch(e) {
                // write error back to client
                const apiAuthResponse: APIAuthResponse = {
                    sessionToken: session.sessionToken,
                    auth: apiAuthRequest.auth,
                    error: "Error in handshake",
                };

                return [true, apiAuthResponse];
            }
        }
        else {
            // Cannot happen
            throw new Error("Unexpected error in handshake");
        }
    }
}
