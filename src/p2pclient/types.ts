import {
    AuthCertInterface,
} from "../datamodel";

import {
    FetchRequest,
    AllowEmbed,
} from "../types";

export type SerializeInterface<DataType> = (data: DataType) => Buffer;
export type DeserializeInterface<DataType> = (serialized: Buffer) => DataType;

/**
 * A peer connection can have one client type and simultanously both the two server types set.
 * This means both peers can be client and server on the same connection.
 * Each peer announces their supported ConnectionType in the handshake and both sides hook up
 * each side's P2PClient accordingly.
 */
export const ConnectionType: {[key: string]: number} = {
    NONE:            0,
    STORAGE_CLIENT:  1,
    EXTENDER_CLIENT: 2,
    STORAGE_SERVER:  4,
    EXTENDER_SERVER: 8,
} as const;

export const ConnectionTypeName: {[key: string]: string} = {
    STORAGE_CLIENT:   "storage",
    STORAGE_SERVER:   "storage",
    EXTENDER_CLIENT:  "extender",
    EXTENDER_SERVER:  "extender",
} as const;

/**
 * These are the unpacked properties of "peerData" exchanged on handshake.
 */
export type PeerProps = {
    /** The P2PClient version of the peer (six bytes). */
    version: Buffer,

    /** The chosen serialize format by the peer. */
    serializeFormat: number,

    /**
     * The UNIX time in milliseconds of when the peer entered the handshake phase.
     * If the client and server's clocks are perfectly synchronized
     * then the client's clock value will be slighly behind the server's clock value,
     * this is because the client is the one initiating the handshake and therefore timestamping first.
     */
    clock: number,

    /** The cryptographically handshaked public key of the peer. */
    handshakedPublicKey: Buffer,

    /**
     * If the peer is using an auth cert this will differ from the handshakedPublicKey.
     * This is the issuerPublicKey of the potentially set authCert, set here for convenience.
     */
    authCertPublicKey?: Buffer,

    /**
     * The optional semver appversion (six bytes) of the peer's application.
     */
    appVersion?: Buffer,

    /**
     * If the peer is using an auth cert on handshake this is set, decoded and cryptographically verified.
     * It is however not automatically checked online for validity.
     */
    authCert?: AuthCertInterface,

    /**
     * The peer's physical region.
     */
    region?: string,

    /**
     * The peer's jurisdiction.
     */
    jurisdiction?: string,

    /**
     * The peer's supported/expected connection type.
     */
    connectionType?: number,
};

/** Internally used struct for keeping track of subscriptions. */
export type SubscriptionMap = {
    /** fromMsgId is the ID of the message received from a peer. */
    fromMsgId: Buffer,

    /**
     * This is the ID of message this client created when sending fetch request to the Storage.
     * This is is used to unsubscribe from a fetch request in the Storage.
     */
    originalMsgId: Buffer,

    /** The client creating the subscription. */
    clientPublicKey: Buffer,
};

/**
 * A AutoFetch is a fetch request which is automatically run when a peer is connected.
 * It matches on the peer's publicKey, then it fetches data from the
 * peer to store to the storage.
 * If set in `reverse` mode it will fetch from storage and store to remote peer.
 */
export type AutoFetch = {
    /**
     * If remotePublicKey is an empty buffer then this fetch request matches for any publicKey connecting,
     * otherwise it must match the publicKey of the peer connecting for it to match.
     */
    remotePublicKey: Buffer,

    /** The fetch/subscription to request */
    fetchRequest: FetchRequest,

    /** If true then automatically also download blob data for nodes who have blobs */
    downloadBlobs: boolean,

    /** If true then reverse the fetch and store so we fetch from storage and store to remote. */
    reverse: boolean,

};

/**
 * A P2PClient is instantiated with permissions which regulate the incoming requests it receives.
 */
export type P2PClientPermissions = {
    /**
     * If set then does not enforce matching of clientPublicKey for incoming requests.
     * This means that the peer sending the request (the remote side of the P2PClient connection)
     * does not have to be the same as the clientPublicKey property set in the request.
     * This feature is useful when chaining together P2PClients to tunnel requests unaltered,
     * but it comes with security implications if not used properly.
     */
    allowUncheckedAccess: boolean,

    /** The permissions which limits the incoming fetch requests from the remote peer. */
    fetchPermissions: P2PClientFetchPermissions,

    /** The permissions which limits the incoming store requests from the remote peer. */
    storePermissions: P2PClientStorePermissions,
};

/**
 * A struct that states what permissions the local client grants the remote client on fetching.
 */
export type P2PClientFetchPermissions = {
    /**
     * The types of the nodes to allow to be embedded before sent to peer. Shorter types work as wildcards.
     * The P2PClientExtender will automatically sign embedded nodes and store them back to the Storage,
     * so do not set allowEmbed if not trusting the Storage to propose correct nodes.
     */
    allowEmbed: AllowEmbed[],

    /** Set if to allow fetch requests using triggers. */
    allowTrigger: boolean,

    /** List of node types which are allowed to be queried for by peer. The full node type is six bytes, however fewer bytes can be set to act as wildcards. */
    allowNodeTypes: Buffer[],

    /** Algo IDs supported for transform requests. */
    allowTransform: number[],

    /** Is the peer allowed to read blob data? The peer must also have access to the node it self. */
    allowReadBlob: boolean,
};

/**
 * A struct that states what permissions the local client grants the remote client on storing.
 */
export type P2PClientStorePermissions = {
    /** Is the peer allowed to store nodes to this side? */
    allowStore: boolean,

    /** Is the peer allowed to write blob data to this side? This is regardless the value of allowStore. */
    allowWriteBlob: boolean,
};

/**
 * Event emitted when downloading and storing blobs.
 * if error is set then an error occoured,
 * then if isRead is true the error is for fetching the blob,
 * if isRead===false then the error is for storing the blob,
 * is isRead===undefined then the error is something else internally.
 * If only nodeId1 is set that means a successfull download and store of the blob.
 */
export type BlobEvent = {nodeId1: Buffer, error?: {isRead: boolean | undefined, message: string}};
