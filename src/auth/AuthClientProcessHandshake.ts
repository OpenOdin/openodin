/**
 * Experimental.
 */

import {
    ClientInterface,
    ByteSize,
    CreatePair,
} from "pocket-sockets";

import {
    HandshakeResult,
    HandshakeAsClient,
} from "pocket-messaging";

import {
    AuthClientProcessInterface,
    APIAuthFactoryConfig,
    APIAuthRequest,
} from "./types";

import {
    PromiseCallback,
    CopyBuffer,
} from "../util/common";

export class AuthClientProcessHandshake implements AuthClientProcessInterface {
    public static readonly NAME = "handshake";

    protected socket1: ClientInterface;

    protected pResult = PromiseCallback<HandshakeResult>();

    constructor(protected webSocket: ClientInterface,
        protected apiAuthFactoryConfig: APIAuthFactoryConfig)
    {
        //const config = apiAuthFactoryConfig.clientAuth?.config ?? {};

        const [socket1, socket2] = CreatePair();

        this.socket1 = socket1;

        let peerData: Buffer | undefined;

        if (typeof this.apiAuthFactoryConfig.peerData === "function") {
            peerData = this.apiAuthFactoryConfig.peerData(/*isServer=*/false);
        }
        else {
            peerData = this.apiAuthFactoryConfig.peerData;
        }

        const keyPair = this.apiAuthFactoryConfig.keyPair;

        const clientLongtermSk = CopyBuffer(keyPair.secretKey);

        const clientLongtermPk = CopyBuffer(keyPair.publicKey);

        const serverLongtermPk =
            CopyBuffer(this.apiAuthFactoryConfig.serverPublicKey ?? Buffer.alloc(0));

        const discriminator = CopyBuffer(this.apiAuthFactoryConfig.discriminator);

        // TODO: FIXME
        // move from constructor.
        try {
            const p = HandshakeAsClient(socket2, clientLongtermSk,
                clientLongtermPk, serverLongtermPk, discriminator, peerData);

            p.then((handshakeResult: HandshakeResult) => this.pResult.cb(undefined, handshakeResult)).
                catch((error: Error) => this.pResult.cb(error));
        }
        catch(e) {
            // Do nothing
        }
    }

    public async auth(): Promise<[HandshakeResult | undefined, string?]> {
        try {
            // msg 1 generated, extract it.
            //
            const msg1 = await new ByteSize(this.socket1).read(-1);

            // send extracted msg 1 on websocket
            //
            const apiAuthRequest1: APIAuthRequest = {
                auth: AuthClientProcessHandshake.NAME,
                data: msg1.toString("hex"),
            };

            this.webSocket.send(JSON.stringify(apiAuthRequest1));


            // now, await msg 2 incoming on websocket
            //
            const msg2Json = await new ByteSize(this.webSocket).read(-1);
            const apiAuthResponse2 = JSON.parse(msg2Json.toString());

            const sessionToken = apiAuthResponse2.sessionToken;

            if (apiAuthResponse2.error || !sessionToken || typeof(sessionToken) !== "string") {
                return [undefined, undefined];
            }

            if (apiAuthResponse2.auth !== AuthClientProcessHandshake.NAME) {
                return [undefined, undefined];
            }

            const msg2 = apiAuthResponse2.data;

            // then pass msg2 to HandshakeAsClient
            //
            this.socket1.send(Buffer.from(msg2, "hex"));

            // read msg3 generated in HandshakeAsClient
            //
            const msg3 = await new ByteSize(this.socket1).read(-1);

            // send extracted msg 3 on websocket
            //
            const apiAuthRequest3: APIAuthRequest = {
                auth: AuthClientProcessHandshake.NAME,
                data: msg3.toString("hex"),
            };

            this.webSocket.send(JSON.stringify(apiAuthRequest3));


            // now, await msg 4 incoming on websocket
            //
            const s = await new ByteSize(this.webSocket).read(-1);

            const apiAuthResponse4 = JSON.parse(s.toString());

            if (apiAuthResponse4.error || apiAuthResponse4.sessionToken !== sessionToken) {
                return [undefined, undefined];
            }

            if (apiAuthResponse4.auth !== AuthClientProcessHandshake.NAME) {
                return [undefined, undefined];
            }

            const msg4 = apiAuthResponse4.data;


            // then pass msg4 to HandshakeAsClient
            //
            this.socket1.send(Buffer.from(msg4, "hex"));

            try {
                const handshakeResult = await this.pResult.promise;

                return [handshakeResult, sessionToken];
            }
            catch(e) {
                return [undefined, undefined];
            }
        }
        catch(e) {
            return [undefined, undefined];
        }
        finally {
            this.socket1.close();
        }
    }
}
