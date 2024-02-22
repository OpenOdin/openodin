// TODO: add counters, same as native HandshakeFactory has.
//
import crypto from "crypto";

import {
    SocketFactory,
    ConnectCallback,
    ErrorCallback,
    SocketFactoryConfig,
    SocketFactoryStats,
    ServerInitErrorCallback,
    ServerListenErrorCallback,
    ClientInitErrorCallback,
    ClientConnectErrorCallback,
    CloseCallback,
    ClientRefuseCallback,
    CreatePair,
    ClientInterface,
    WSClient,
} from "pocket-sockets"

import {
    HandshakeFactoryInterface,
    HandshakeErrorCallback,
    HandshakeCallback,
    ExpectingReply,
    HandshakeResult,
} from "pocket-messaging"

import {
    PocketConsole,
} from "pocket-console";

import {
    RouteAction,
} from "../p2pclient/types";

import {
    UnsubscribeRequest,
} from "../types";

import {
    APIAuthFactoryConfig,
    AuthServerProcessInterface,
    AuthClientProcessInterface,
    APISession,
    APIRequest,
    APIAuthRequest,
    APIAuthResponse,
    RouteActions,
} from "./types";

import {
    SendResponse,
} from "./SendResponse";

import {
    PromiseCallback,
} from "../util/common";

import {
    createServer,
    IncomingMessage,
    ServerResponse,
} from "http";

import * as ws from "ws";

import {
    APIDataTransformer,
} from "./APIDataTransformer";

import {
    APITransformerClient,
} from "./APITransformerClient";

import {
    AuthClientProcessHandshake,
} from "./AuthClientProcessHandshake";

import {
    AuthServerProcessHandshake,
} from "./AuthServerProcessHandshake";

import {
    AuthServerProcessLogin,
} from "./AuthServerProcessLogin";

const console = PocketConsole({module: "APIHandshakeFactory"});

const WebSocketServer = ws.Server;

const CLIENT_AUTH_PROCESS_FACTORY =
    function(name: string, webSocket: ClientInterface, apiAuthFactoryConfig: APIAuthFactoryConfig):
        AuthClientProcessInterface | undefined
{
    if (name === AuthClientProcessHandshake.NAME) {
        return new AuthClientProcessHandshake(webSocket, apiAuthFactoryConfig);
    }

    return undefined;
};

const SERVER_AUTH_PROCESS_FACTORY =
    function(name: string, apiAuthFactoryConfig: APIAuthFactoryConfig):
        AuthServerProcessInterface | undefined
{
    if (name === AuthServerProcessHandshake.NAME) {
        return new AuthServerProcessHandshake(apiAuthFactoryConfig);
    }
    else if (name === AuthServerProcessLogin.NAME) {
        return new AuthServerProcessLogin(apiAuthFactoryConfig);
    }

    return undefined;
};

export class APIHandshakeFactory implements HandshakeFactoryInterface {
    protected apiDataTransformer = new APIDataTransformer();

    protected aggregatedData: Buffer = Buffer.alloc(0);

    protected handlers: {[name: string]: ( (...args: any) => void)[]} = {};

    protected socketFactory: SocketFactory;

    protected sessions: {[sessionToken: string]: APISession} = {};

    constructor(protected apiAuthFactoryConfig: APIAuthFactoryConfig) {

        const {socketFactoryConfig, socketFactoryStats} = this.apiAuthFactoryConfig;

        if (socketFactoryConfig.server) {
            if (socketFactoryConfig.server.socketType !== "TCP") {
                throw new Error("APIHandshakeFactory server socketType must be TCP (it will be turned into a WebSocket upon client request)");
            }

            if (!socketFactoryConfig.server.serverOptions?.cert || socketFactoryConfig.server.serverOptions?.cert.length === 0) {
                console.warn("APIHandshakeFactory server should really be run with TLS as traffic is not encrypted!");
            }

            // Force socket to be in text mode.
            //
            socketFactoryConfig.server.serverOptions.textMode = true;
        }

        if (socketFactoryConfig.client) {
            if (!socketFactoryConfig.client.clientOptions?.secure) {
                console.warn("APIHandshakeFactory client should really be run with TLS as traffic is not encrypted!");
            }

            // Force socket to be in text mode.
            //
            socketFactoryConfig.client.clientOptions.textMode = true;
        }

        this.socketFactory = new SocketFactory(socketFactoryConfig, socketFactoryStats);

        this.socketFactory.onConnect(this.handleOnConnect);

        this.socketFactory.onError( error => {
            this.triggerEvent("error", error);
        });
    }

    public init() {
        this.socketFactory.init();
    }

    /**
     * TCP socket connected.
     * The socket is used in a HTTP server, but is also
     * allowed to be upgraded to a WebSocket.
     *
     * HTTP sockets are allowed to use different sessions on each request.
     * WebSocket are associated with its first session and cannot change sessions,
     * this is because traffic originating from the server can be pushed out on the websocket.
     */
    protected handleOnConnect: ConnectCallback = async (e) => {
        if (e.isServer) {
            this.handleOnConnectServer(e.client);
        }
        else {
            this.handleOnConnectClient(e.client);
        }
    }

    protected async handleOnConnectClient(webSocket: ClientInterface) {
        if (!webSocket.isWebSocket()) {
            throw new Error("WebSocket client expected");
        }

        const [handshakeResult, sessionToken] = await this.authAsClient(webSocket);

        if (!handshakeResult || !sessionToken) {
            // Handshake failed.
            //
            webSocket.close();
            // TODO trigger onClientError
            return;
        }

        // Now setup comm.
        //

        const wrappedClient = new APITransformerClient(webSocket, sessionToken);

        this.triggerEvent("handshake", {isServer: false, handshakeResult,
            client: webSocket, wrappedClient});
    }

    protected async authAsClient(webSocket: ClientInterface):
        Promise<[HandshakeResult | undefined, string?]>
    {
        const authRequestMethod = this.apiAuthFactoryConfig.clientAuth?.method ?? "";

        const authProcess = CLIENT_AUTH_PROCESS_FACTORY(authRequestMethod, webSocket,
            this.apiAuthFactoryConfig);

        if (authProcess) {
            const [handshakeResult, sessionToken] = await authProcess.auth();

            return [handshakeResult, sessionToken];
        }
        else {
            console.error(`Unknown client auth process: ${authRequestMethod}`);

            return [undefined, undefined];
        }
    }

    protected handleOnConnectServer(client: ClientInterface) {
        const httpServer = createServer( (req: IncomingMessage, res: ServerResponse) => {
            try {
                this.handleHTTPRequest(req, res);
            }
            catch(e) {
                res.write(JSON.stringify({
                    error: "could not wrap http socket",
                }));

                res.end();
            }
        });

        const wsServer = new WebSocketServer({
            server: httpServer,
        });

        wsServer.on("connection", (socket: ws) => {
            const webSocket = new WSClient({textMode: true, port: 0}, socket);

            webSocket.onData( (body: string | Buffer) => {
                this.handleWebSocketRequest(webSocket, body as string);
            });
        });

        const socket = client.getSocket();

        httpServer.emit("connection", socket);
    }

    protected async handleHTTPRequest(req: IncomingMessage, res: ServerResponse) {
        const sendResponse = new SendResponse(res);

        try {
            if (req.method === "GET") {
                // TODO handle download of blob
                sendResponse.sendError("GET not supported");
                return;
            }

            if (req.method !== "POST") {
                sendResponse.sendError("POST required for the JSON-RPC API");
                return;
            }

            if (req.headers["content-type"] === "multipart/form-data") {
                // TODO handle upload of blob
                sendResponse.sendError("Upload not supported");
                return;
            }

            if (req.headers["content-type"] !== "application/json") {
                sendResponse.sendError("Content-Type expected to be application/json");
                return;
            }

            // Get all the body.
            //
            const bodyPromise = PromiseCallback();
            const chunks: string[] = [];
            req.on("data", (chunk: string) => chunks.push(chunk) );
            req.on("end", bodyPromise.cb);

            await bodyPromise.promise;

            const body = chunks.join("");

            const [apiRequest, apiAuthRequest] = this.apiDataTransformer.parseRequest(body);

            if (!apiAuthRequest && !apiRequest) {
                sendResponse.sendError("Could not parse request");
                return;
            }

            if (apiAuthRequest) {
                const sessionToken = apiAuthRequest.sessionToken;
                let session = sessionToken ? this.sessions[sessionToken] : undefined;

                if (sessionToken && !session) {
                    sendResponse.sendError("Invalid sessionToken");
                    return;
                }

                if (!session) {
                    // Create session
                    //
                    const sessionToken = Buffer.from(crypto.randomBytes(16)).toString("hex");

                    const now = Date.now();

                    session = {
                        sessionToken,
                        msgs: {},
                        created: now,
                        lastActive: now,
                        keepAlive: true,
                    };

                    this.sessions[sessionToken] = session;
                }

                if (!session.messagingClient) {
                    // Start or continue with authentication.
                    //
                    this.authAsServer(session, apiAuthRequest, sendResponse);

                    return;
                }

                if (session.messagingClient) {
                    sendResponse.sendError("Already authenticated");
                    return;
                }
            }
            else if (apiRequest) {
                const sessionToken = apiRequest.sessionToken;
                const session = this.sessions[sessionToken];

                if (!session || !session.messagingClient) {
                    sendResponse.sendError("Invalid sessionToken");
                    return;
                }

                this.routeMessage(session, apiRequest, sendResponse);
            }
        }
        catch(e) {
            sendResponse.sendError((e as Error).message);
        }
    }

    protected handleWebSocketRequest(webSocket: ClientInterface, body: string) {
        const sendResponse = new SendResponse(undefined, webSocket);

        try {
            const [apiRequest, apiAuthRequest] = this.apiDataTransformer.parseRequest(body);

            if (!apiAuthRequest && !apiRequest) {
                sendResponse.sendError("Could not parse request");
                return;
            }

            // Check if websocket already is bound to a session.
            // A websocket is always tied to the first session it associates with.
            //
            // Note: this should be optimized to not iterate through every session.
            //
            let session: APISession | undefined;
            const sessions = Object.values(this.sessions);
            const sessionsLength = sessions.length;
            for (let i=0; i<sessionsLength; i++) {
                session = sessions[i];
                if (session.webSocket === webSocket) {
                    break;
                }
                session = undefined;
            }

            if (!session && apiRequest) {
                // Check if a valid sessinToken is provided and associate it with the websocket.
                //
                const sessionToken = apiRequest.sessionToken;
                session = this.sessions[sessionToken];

                if (session && session.messagingClient) {
                    if (session.webSocket) {
                        sendResponse.sendError("Session already associated with a different websocket");
                        return;
                    }

                    session.webSocket = webSocket;

                    webSocket.onClose( () => this.handleWebSocketClose(webSocket, sessionToken) );

                    // session exists,
                    // fall through
                }
                else {
                    sendResponse.sendError("Invalid sessionToken");
                    return;
                }
            }

            if (session && apiRequest) {
                if (!session.messagingClient) {
                    sendResponse.sendError("Session not authenticated");

                    return;
                }

                if (apiRequest.sessionToken !== session.sessionToken) {
                    sendResponse.sendError("WebSocket not allowed to change session");
                    return;
                }

                this.routeMessage(session, apiRequest, sendResponse);
            }

            if (!session && apiAuthRequest) {
                // Create session
                //
                const sessionToken = Buffer.from(crypto.randomBytes(16)).toString("hex");

                const now = Date.now();

                session = {
                    sessionToken,
                    msgs: {},
                    webSocket,
                    created: now,
                    lastActive: now,
                    keepAlive: false,
                };

                this.sessions[sessionToken] = session;

                webSocket.onClose( () =>
                    this.handleWebSocketClose(webSocket, sessionToken) );

                // session exists,
                // fall through
            }

            if (session && apiAuthRequest) {
                if (session.messagingClient) {
                    sendResponse.sendError("Already authenticated");

                    return;
                }

                this.authAsServer(session, apiAuthRequest, sendResponse);
            }
        }
        catch(e) {
            sendResponse.sendError((e as Error).message);
        }
    }

    /**
     * Authenticate as server.
     */
    protected async authAsServer(session: APISession, apiAuthRequest: APIAuthRequest,
        sendResponse: SendResponse)
    {
        if (!session.authProcess) {
            // This is a fresh auth attempt.
            // Setup the auth process.
            //

            const authRequestMethod = apiAuthRequest.auth;

            let authProcess;

            if ((this.apiAuthFactoryConfig.serverAuth?.methods ?? {})[authRequestMethod]) {
                authProcess = SERVER_AUTH_PROCESS_FACTORY(authRequestMethod,
                    this.apiAuthFactoryConfig);
            }

            if (!authProcess) {
                console.error(`Unsupported server auth process: ${authRequestMethod}`);

                const errResponse: APIAuthResponse = {
                    auth: apiAuthRequest.auth,
                    error: "Auth method not supported",
                };

                sendResponse.sendObj(errResponse);

                return;
            }

            session.authProcess = authProcess;

            // Fall through
            //
        }

        const [error, apiAuthResponse, handshakeResult, proxy] =
            await session.authProcess.next(session, apiAuthRequest);

        if (error) {
            this.closeSession(session.sessionToken);

            sendResponse.sendObj(apiAuthResponse);

            return;
        }

        if (apiAuthResponse) {
            sendResponse.sendObj(apiAuthResponse);
        }

        if (handshakeResult) {
            // Handshake is done
            //
            delete session.authProcess;

            session.proxy = proxy;

            const [messagingClient, innerClient] = CreatePair();

            messagingClient.onData( (data: Buffer | string) =>
                this.handleDataFromServerMessaging(data as Buffer, session.sessionToken));

            messagingClient.onClose( () => {
                this.closeSession(session.sessionToken);
            });

            session.messagingClient = messagingClient;

            this.triggerEvent("handshake", {isServer: false, handshakeResult,
                client: innerClient, wrappedClient: innerClient});
        }
    }

    protected handleWebSocketClose(webSocket: ClientInterface, sessionToken: string) {
        const session = this.sessions[sessionToken];

        if (!session) {
            return;
        }

        delete session.webSocket;

        if (session.keepAlive) {
            this.cleanSession(sessionToken);
        }
        else {
            this.closeSession(sessionToken);
        }
    }

    /**
     * Clean up session of lingering cached msgs.
     *
     * This should be done on an interval.
     */
    protected cleanSession(sessionToken: string) {
        const session = this.sessions[sessionToken];

        if (!session) {
            return;
        }

        const msgsIds = Object.keys(session.msgs);

        const msgsIdsLength = msgsIds.length;
        for (let i=0; i<msgsIdsLength; i++) {
            const msgId = msgsIds[i];
            if (session.msgs[msgId][0].isClosed()) {
                delete session.msgs[msgId];
            }
        }
    }

    /**
     * End and remove session.
     */
    protected closeSession(sessionToken: string) {
        const session = this.sessions[sessionToken];

        if (session) {
            session.webSocket?.close();

            session.messagingClient?.close();

            delete this.sessions[sessionToken];

            session.proxy?.close();
        }
    }

    protected async routeMessage(session: APISession, apiRequest: APIRequest, sendResponse: SendResponse) {
        if (!session.messagingClient) {
            sendResponse.sendError("MessagingClient not initiated");
            return;
        }

        const msgId = apiRequest.msgId;

        if (!msgId) {
            sendResponse.sendError("msgId missing");
            return;
        }

        if (apiRequest.expectingReply) {
            const msgIdStr = msgId.toString("hex");

            if (session.msgs[msgIdStr]) {
                sendResponse.sendError("Cannot reuse msgId");
                return;
            }

            session.msgs[msgIdStr] = [sendResponse, apiRequest.expectingReply];
        }

        if (apiRequest.target.toString() === RouteAction.UNSUBSCRIBE) {
            // Remove pending sendResponse on session
            const originalMsgId = (apiRequest.data as UnsubscribeRequest).originalMsgId;

            const originalMsgIdStr = originalMsgId.toString("hex");

            if (originalMsgId) {
                const [sendResponse] = session.msgs[originalMsgIdStr] ?? [];

                sendResponse?.free();

                delete session.msgs[originalMsgIdStr];
            }
        }

        if (apiRequest.target.toString() === RouteAction.STORE) {
            // Go through each node to see if it is signed or not.
            //
            if (session.proxy) {
                await session.proxy.signMissing(apiRequest);
            }
        }

        const data = this.apiDataTransformer.serialize(apiRequest);

        session.messagingClient?.send(data);
    }

    /**
     * Handle data incoming from the Messaging instance.
     *
     */
    protected handleDataFromServerMessaging = (data: Buffer, sessionToken: string) => {
        try {
            this.aggregatedData = Buffer.concat([this.aggregatedData, data]);

            if (this.aggregatedData.length < 3) {
                return undefined;
            }

            const length = this.aggregatedData.readUInt32LE(1);

            if (length > this.aggregatedData.length) {
                return undefined;
            }

            const data2 = this.aggregatedData.slice(0, length);

            this.aggregatedData = Buffer.from(this.aggregatedData.slice(length));

            const apiRequest = this.apiDataTransformer.deserialize(data2);

            if (apiRequest.target.length === 0) {
                return;
            }

            apiRequest.sessionToken = sessionToken;

            const session = this.sessions[sessionToken];

            if (!session) {
                return;
            }

            // Is this not a response but a new request originating from server?
            // In such case send it out on associated websocket (if any).
            if (RouteActions.includes(apiRequest.target.toString())) {
                session.webSocket?.send(this.apiDataTransformer.stringifyAPIRequest(apiRequest));
            }
            else {
                // Check if the message is a reply,
                // in such case target is the msgId we are replying on.
                //
                const msgIdStr = apiRequest.target.toString("hex");

                const [sendResponse, expectingReply] = session.msgs[msgIdStr] ?? [];

                if (sendResponse) {
                    // A reply on request routed.
                    //
                    sendResponse.send(this.apiDataTransformer.stringifyAPIRequest(apiRequest));

                    if (!sendResponse.isWebSocket() || expectingReply !== ExpectingReply.MULTIPLE) {
                        sendResponse.free();

                        delete session.msgs[msgIdStr];
                    }
                }
            }
        }
        catch(e) {
            console.error(e);
            // Do nothing
        }
    }

    public getHandshakeFactoryConfig(): APIAuthFactoryConfig {
        return this.apiAuthFactoryConfig;
    }

    public onHandshakeError(callback: HandshakeErrorCallback) {
        this.hookEvent("handshakeError", callback);
    }

    /**
     * Event emitted upon successful handshake for a new session.
     */
    public onHandshake(callback: HandshakeCallback) {
        this.hookEvent("handshake", callback);
    }


    // pocket-sockets interface
    //

    /**
     * Event emitted on the start of a handshake.
     */
    public onConnect(callback: ConnectCallback) {
        this.socketFactory.onConnect(callback);
    }

    public onError(callback: ErrorCallback) {
        this.hookEvent("error", callback);
    }

    public getSocketFactoryConfig(): SocketFactoryConfig {
        return this.apiAuthFactoryConfig.socketFactoryConfig;
    }

    public close() {
        this.socketFactory.close();
    }

    public shutdown() {
        this.socketFactory.shutdown();
    }

    public isClosed(): boolean {
        return this.socketFactory.isClosed();
    }

    public isShutdown(): boolean {
        return this.socketFactory.isShutdown();
    }

    public getStats(): SocketFactoryStats {
        return this.socketFactory.getStats();
    }

    public onServerInitError(callback: ServerInitErrorCallback) {
        this.socketFactory.onServerInitError(callback);
    }

    public onServerListenError(callback: ServerListenErrorCallback) {
        this.socketFactory.onServerListenError(callback);
    }

    public onClientInitError(callback: ClientInitErrorCallback) {
        this.socketFactory.onClientInitError(callback);
    }

    public onConnectError(callback: ClientConnectErrorCallback) {
        this.socketFactory.onConnectError(callback);
    }

    public onClose(callback: CloseCallback) {
        this.socketFactory.onClose(callback);
    }

    public onRefusedClientConnection(callback: ClientRefuseCallback) {
        this.socketFactory.onRefusedClientConnection(callback);
    }

    protected hookEvent(name: string, callback: ( (...args: any) => void)) {
        const cbs = this.handlers[name] || [];
        this.handlers[name] = cbs;
        cbs.push(callback);
    }

    protected unhookEvent(name: string, callback: ( (...args: any) => void)) {
        const cbs = (this.handlers[name] || []).filter( (cb: ( (...args: any) => void)) => callback !== cb );
        this.handlers[name] = cbs;
    }

    protected triggerEvent(name: string, ...args: any) {
        const cbs = this.handlers[name] || [];
        cbs.forEach( (callback: ( (...args: any) => void)) => {
            setImmediate( () => callback(...args) );
        });
    }
}
