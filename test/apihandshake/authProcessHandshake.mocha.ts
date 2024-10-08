import {assert} from "chai";

import {
    CreatePair,
} from "pocket-sockets";

import {
    AuthClientProcessHandshake,
    AuthServerProcessHandshake,
    sleep,
    APIAuthFactoryConfig,
    Crypto,
    APIAuthRequest,
    PromiseCallback,
    ParseSchema,
    //APIAuthFactoryConfigSchema,
    HandshakeFactoryConfigSchema,
} from "../../src";

describe("AuthProcessHandshake", function() {

    const keyPair1 = Crypto.GenKeyPair();
    const keyPair2 = Crypto.GenKeyPair();

    it("Should be able to perform mutual handshake", async function() {
        const [socket1, socket2] = CreatePair();

        let p = [PromiseCallback<Buffer>()];

        socket1.onData( (data: any) => {
            p[0].cb(undefined, data);
        });

        const apiAuthFactoryConfigClient: APIAuthFactoryConfig = ParseSchema(HandshakeFactoryConfigSchema, {
            client: {
                auth: {
                    method: "handshake",
                },
                socketType: "WebSocket",
                port: 8000,
                serverPublicKey: keyPair2.publicKey,
            }
        });

        apiAuthFactoryConfigClient.keyPair = keyPair1;

        const authClientProcessHandshake = new AuthClientProcessHandshake(socket2, apiAuthFactoryConfigClient);

        // Read msg1 from handshake
        //
        const pResult = authClientProcessHandshake.auth();

        const response = await p[0].promise;

        const msg1 = JSON.parse(response.toString());

        assert(msg1.auth === "handshake");
        assert(msg1.data.length === 65 * 2);


        // Pass msg1 into server side
        // and read msg2 from server handshake
        //

        const apiAuthFactoryConfigServer: APIAuthFactoryConfig = ParseSchema(HandshakeFactoryConfigSchema, {});

        apiAuthFactoryConfigServer.keyPair = keyPair2;

        const authServerProcessHandshake = new AuthServerProcessHandshake(apiAuthFactoryConfigServer);

        const session: any = {
            sessionToken: "blablablabla",
        };

        const [error, msg2] = await authServerProcessHandshake.next(session, msg1);

        assert(!error);
        assert(msg2);
        assert(msg2.data);

        assert(msg2.sessionToken === session.sessionToken);

        assert(msg2.data.length > 0);


        // Pass msg2 into client side
        //

        p[0] = PromiseCallback<Buffer>();

        socket1.send(Buffer.from(JSON.stringify(msg2)));

        // Read msg3 from client side
        //
        const response3 = await p[0].promise;
        delete p[0];

        const msg3 = JSON.parse(response3.toString());

        // Pass msg3 into server side
        // and read back msg4
        //
        const [error2, msg4, serverHandshakeResult] = await authServerProcessHandshake.next(session, msg3);

        assert(!error2);
        assert(msg4);
        assert(msg4.data);
        assert(serverHandshakeResult);
        assert(serverHandshakeResult.peerLongtermPk.equals(keyPair1.publicKey));

        assert(msg4.sessionToken === session.sessionToken);

        assert(msg4.data.length > 0);

        // Pass msg4 into client side
        //

        p[0] = PromiseCallback<Buffer>();

        socket1.send(Buffer.from(JSON.stringify(msg4)));

        const [handshakeResult, sessionToken] = await pResult;

        assert(sessionToken === session.sessionToken);
        assert(handshakeResult);
        assert(handshakeResult.peerLongtermPk.equals(keyPair2.publicKey));

        socket1.close();
    });
});
