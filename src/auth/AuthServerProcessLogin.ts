/**
 * Experimental.
 *
 * curl 127.0.0.1:8181 -X POST -H "Content-Type: application/json" --data '{"auth":"login","data":{"serverPublicKey":"357bedc5af371564a70388c48c7edf2616e21f3ccae98e04c05b8d2fbbeb249a", "discriminator":"", "randomId":"aabbcc","timestamp":123}}'
 *
 * token=9bbba7a1c583b2bf29f5313b8a19be30
 * curl 127.0.0.1:8181 -X POST -H "Content-Type: application/json" --data '{"sessionToken":"'${token}'","auth":"login","data":{"username":"alice", "password":"123456"}}'
 *
 * TODO:
 * conf structure with wallet conf
 *
 */
import {
    HandshakeResult,
} from "pocket-messaging";

import {
    KeyPair,
} from "../datamodel";

import {
    AuthServerProcessInterface,
    APIAuthFactoryConfig,
    APISession,
    APIAuthResponse,
    APIAuthRequest,
    NodeSignProxyInterface,
} from "./types";

import {
    SignatureOffloader,
} from "../signatureoffloader/SignatureOffloader";

import {
    CopyBuffer,
} from "../util/common";

import {
    NodeSignProxy,
} from "./NodeSignProxy";

export class AuthServerProcessLogin implements AuthServerProcessInterface {
    public static readonly NAME = "login";

    protected phase = 1;

    protected clockDiff = 0;

    constructor(protected apiAuthFactoryConfig: APIAuthFactoryConfig) {}

    public async next(session: APISession, apiAuthRequest: APIAuthRequest):
        Promise<[boolean, APIAuthResponse?, HandshakeResult?, NodeSignProxyInterface?]>
    {
        const config = (this.apiAuthFactoryConfig.serverAuth?.methods ?? {})[AuthServerProcessLogin.NAME] ?? {};

        const keyPair = this.apiAuthFactoryConfig.keyPair;

        if (this.phase === 1) {
            // First incoming msg from client.
            //
            // msg1: {
            //  serverPublicKey,
            //  discriminator,
            //  randomId,
            //  timestamp,
            // }
            //
            // msg2: {
            //  sessionToken,
            //  auth: "login",
            //  data: {
            //   signature,
            //   clockDiff,
            //  }
            // }

            const discriminator = this.apiAuthFactoryConfig.discriminator;

            try {
                const timestamp = Date.now();

                if (typeof(apiAuthRequest.data) !== "object") {
                    throw new Error("Unexpected data");
                }

                const msg1 = apiAuthRequest.data;

                const serverPublicKey = Buffer.from(msg1.serverPublicKey, "hex");

                if (!serverPublicKey.equals(keyPair.publicKey)) {
                    throw new Error("Mismatch server public key");
                }

                if (!Buffer.from(msg1.discriminator).equals(discriminator)) {
                    throw new Error("Mismatch discriminator");
                }

                // TODO sign randomId
                //const randomId = Buffer.from(msg1.randomId, "hex");
                const signature = Buffer.alloc(64).toString("hex");

                this.clockDiff = timestamp - msg1.timestamp ?? 0;

                const apiAuthResponse: APIAuthResponse = {
                    sessionToken: session.sessionToken,
                    auth: apiAuthRequest.auth,
                    data: {
                        signature,
                        clockDiff: -this.clockDiff,
                    },
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
                    error: `Error in auth: ${e}`,
                };

                return [true, apiAuthResponse];
            }
        }
        else if (this.phase === 3) {
            // Second incoming msg from client (msg 3)
            //
            // msg3: {
            //  username,
            //  password,
            // }
            //
            // msg4: {
            //  sessionToken,
            //  auth: "login",
            //  data: {
            //   clientPublicKey,
            //   peerData,
            //  }
            // }

            try {
                if (typeof(apiAuthRequest.data) !== "object") {
                    throw new Error("Unexpected data");
                }

                const msg3 = apiAuthRequest.data;

                let peerData: Buffer | undefined;

                if (typeof this.apiAuthFactoryConfig.peerData === "function") {
                    peerData = this.apiAuthFactoryConfig.peerData(/*isServer=*/true);
                }
                else {
                    peerData = this.apiAuthFactoryConfig.peerData ?? Buffer.alloc(0);
                }

                const username = msg3.username;
                const password = msg3.password;

                const account = config.accounts[username];

                if (!account || account.password !== password) {
                    throw new Error("Bad auth");
                }

                const clientKeyPair: KeyPair = {
                    publicKey: Buffer.from(account.keyPair.publicKey, "hex"),
                    secretKey: Buffer.from(account.keyPair.secretKey, "hex"),
                };

                const clientPublicKey = clientKeyPair.publicKey.toString("hex");

                const apiAuthResponse: APIAuthResponse = {
                    sessionToken: session.sessionToken,
                    auth: apiAuthRequest.auth,
                    data: {
                        clientPublicKey,
                        peerData: peerData.toString("hex"),
                    },
                };

                this.phase = 0;

                const signatureOffloader = new SignatureOffloader(1);

                signatureOffloader.addKeyPair(clientKeyPair);

                await signatureOffloader.init();

                const proxy = new NodeSignProxy(clientKeyPair.publicKey, signatureOffloader);

                const handshakeResult: HandshakeResult = {
                    longtermPk: CopyBuffer(keyPair.publicKey),
                    peerLongtermPk: CopyBuffer(clientKeyPair.publicKey),
                    clientToServerKey: Buffer.alloc(0),
                    clientNonce: Buffer.alloc(0),
                    serverToClientKey: Buffer.alloc(0),
                    serverNonce: Buffer.alloc(0),
                    clockDiff: this.clockDiff,
                    peerData,
                };

                // write msg4 back to client
                //
                return [false, apiAuthResponse, handshakeResult, proxy];
            }
            catch(e) {
                // write error back to client
                const apiAuthResponse: APIAuthResponse = {
                    sessionToken: session.sessionToken,
                    auth: apiAuthRequest.auth,
                    error: "Error in auth",
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
