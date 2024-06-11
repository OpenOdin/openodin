/**
 * The types declared here match the bebop types used for serialization.
 * @module
 */

import {Filter} from "./datamodel";

/**
 * This struct is part of Match and is used to limit how many times a Match matches on specific fields.
 * When processing a query having a match with limitField set then for each identical value of the field
 * identified by limitField.name a counter is increased and when the counter is greater then limitField.limit
 * the following nodes who match limitField are ignored and not part of the result set.
 * A match state is reset for each query below a node, meaning a limitField constraint is local to a set of sibling nodes.
 * The usage of this could be to limit the number of occurrences of nodes returned who have the field "name" set to the same value.
 * For example setting limitField to `{name: "Highlander", limit: 1}` will only allow one node having the field `name` set
 * to "Highlander" within the same set of sibling nodes.
 * Note that if the chosen node is later discarded due to its timestamp the matched node will not be returned in the result
 * set as will no other node who was constrained under the limitField. In these cases one could increase the `limit` or try
 * reversing (descending=true) the result set to pick from neweset nodes instead of oldest nodes first.
 */
export type LimitField = {
    /** Name of the field to count identical values on. */
    name: string,
    /** Limit of identical hits on the field to return results for. */
    limit: number,
};

/**
 * A FetchQuery must have atleast one Match struct to match on nodes.
 * A Match is processed for each set of nodes in the tree in respect to their level in the tree.
 * Matches must have matched on levels above to be able to traverse downwards on those matched nodes.
 */
export type Match = {
    /** Up to six bytes, lesser means wildcard match on node type. */
    nodeType: Buffer,

    /**
     * For a Match to be valid all Filters (if any given) have to match.
     *
     * For filter.field === "creationTime" and filter.value < 0 then value is automatically
     * recalculated as Date.now() + value; This can be used to have a sliding window.
     */
    filters: Filter[],

    /**
     * Maximum nodes allowed for this match.
     * -1 means no limit.
     */
    limit: number,

    /** Limit max nr of key:value occurrences for this filter so it does not exceed limit. */
    limitField: LimitField,

    /**
     * The levels in the tree this Match is applicable to.
     * Leave empty for all levels.
     * 0 is root level of the FetchQuery, however Matches do not match at level 0
     * since the root node is already matched on its id in the query.
     * The match state is reset for each new level for Match's used on multiple levels.
     */
    level: number[],

    /**
     * If set then the node will be discarded from the resultset.
     * But up til that last moment the node will be used for traversing just as if not discarded,
     * and also match state is managed as when not discarding.
     * It is enough that a single Match object has discard=false for the node to be kept in the resultset.
     */
    discard: boolean,

    /**
     * Set to true to not allow any further matches on levels below this node.
     * If more than one Match matches a node and if any Match is not set as bottom
     * then the database will allow further matches below this node within the fetch query.
     */
    bottom: boolean,

    /**
     * If set > 0 then the running query will note that a node was matched with this specific match ID.
     * The use of matchId is for matches on the next level to requrie that a specific match was actively matching the parent node.
     * Ids are not unique, many matches can have the same id.
     */
    id: number,

    /**
     * If set > 0 then this match requires that at least one match matching the parent node had its matchId value set to this.
     */
    requireId: number,

    /**
     * When paging we use this do cutoff everything before and up til this node.
     * The Match is inert until the cursor node is passed.
     * However the Match must match the cursor node to be able to mark it as passed.
     *
     * Note that if the cursor is not found no error is returned, just an empty resultset.
     */
    cursorId1: Buffer,
};

/**
 * This struct is used in queries for the client to restrict which nodes are passed along as embedded nodes.
 * Typically a client would defined that is wants Licenses to be returned as embedded.
 */
export type AllowEmbed = {
    /** Up to six bytes, fewer bytes means wildcard match on node type. */
    nodeType: Buffer,

    /** For a Match to be valid all Filters (if any given) have to match. */
    filters: Filter[],
};

/**
 * Each FetchRequest has one fetch query.
 */
export type FetchQuery = {
    /** max depth of request. Default is -1 meaning max limit. Max allowed depth is 100000 nodes deep. */
    depth: number,

    /**
     * Maximum nr of nodes in total returned. Default is -1 meaning max limit.
     * Max allowed is 1_000_000 nodes (defined by MAX_QUERY_ROWS_LIMIT).
     *
     * Note that this limit includes all data and license nodes, all automatically included
     * license nodes and also all nodes to be embedded.
     *
     * This limit should be used as a maximum upper bound of nodes tolerated in the resultset and not
     * to be used for any dataset limit purposess as the mix of data and licenses nodes will vary
     * depending on how many licenses there are available which will effect how many data nodes fit
     * into the limit of the resultset which can yield confusing results.
     *
     * To use fine tuned limits use Match limit and/or CRDT.
     */
    limit: number,

    /**
     * The cutoff timestamp to use to discard nodes from the resultset.
     * This is used to limit the amount of data being sent again when no changes has
     * accoured in that resultset.
     * This value is compared to the node's storageTime and updatedTime.
     *
     * When fetching with CRDT this must be set to 0.
     */
    cutoffTime: bigint,

    /**
     * The ID1 of the root node which is the basis of this query (level 0).
     *
     * The root node will be checked for access permissions, even if discardRoot is set to true.
     *
     * The root node is not allowed to be licensed, to use hasRightsByAssociation or to be flagged as
     * beginRestrictiveWriterMode.
     *
     * While the root node itself is fetched on its ID1, its regular ID (ID2||ID1) is used as
     * parentId for the subsequent level 1 fetch.
     *
     * Unless discardRoot is set the root node will always be returned in the fetch result (regardless
     * of how cutoffTime is set) for every subsequent trigger fetch made.
     *
     * rootNodeId1 is mutually exclusive to parentId.
     */
    rootNodeId1: Buffer,

    /**
     * If set do not return root node in the result set.
     *
     * Only applicable if rootNodeId1 is set.
     */
    discardRoot: boolean,

    /**
     * The ID of the parent of level 1 fetching.
     *
     * This replaces the need of a root node as the fetching starts directly at level 1 using this propery as parentId.
     *
     * parentId is mutually exclusive to rootNodeId1.
     */
    parentId: Buffer,

    /**
     * Optional.
     *
     * For whom this read is performed. Permissions are applied to this public key.
     *
     * Upon arrival this is by default set to the public key of the peer sending the message.
     *
     * It can be set differently by the sender if the receiving P2PClient is configured with
     * allowUncheckedAccess.
     */
    targetPublicKey: Buffer,

    /**
     * Optional.
     *
     * Who is the source of the data we are fetching.
     *
     * Upon arrival this is by default set to the public key of the peer receiving this message.
     *
     * It can be set differently by the sender if the receiving P2PClient is configured with
     * allowUncheckedAccess.
     */
    sourcePublicKey: Buffer,

    /** At least one Match must match for a node to be added to result set. */
    match: Match[],

    /**
     * The node types and criterias which must match for the Database to send nodes-to-be-embedded back to the client.
     * The client requests for example a License from an Intermediary who is proxying the request to the Storage and also has allowEmbed for License set in its permissions
     * then Licenses will be embedded and subsequently returned in the result set.
     * Note that nodes which get embedded when fetching will not be returned in the first result set, it will take a second fetch or
     * that the first fetch also has a subscription for the embedded nodes to be returned.
     */
    embed: AllowEmbed[],

    /**
     * If set then the query will init a subscription which is run whenever a node is
     * added/changed below the triggerNodeId.
     * triggerNodeId is the parentId of the nodes to observe, it does not need to be related to
     * the parentId or the rootNodeId1 of the query.
     * The Storage is not required to support this feature and if it does not support this feature
     * then a malformed error is returned.
     */
    triggerNodeId: Buffer,

    /**
     * Set > 0 to init a subscription to rerun the query on an interval in seconds.
     * Smallest interval is 60 seconds.
     *
     * This can be set regardless if/not triggerNodeId is set and is unsubscribed in the same way.
     *
     * The Storage is not required to support this feature and if it does not support this feature
     * then an error with the status malformed is returned.
     *
     * If using a CRDT together with a subscription triggerNodeId, then the
     * triggerInterval must also be set to properly detect expired nodes.
     *
     * It can be set with triggerNodeId not set just to keep the model updated on regular intervals.
     */
    triggerInterval: number,

    /**
     * Set to true to only query on trigger, meaning do not perform an initial fetch,
     * but only fetch on triggerNodeId activation and/or triggerInterval.
     *
     * Cannot be set if fetching with CRDT, because we need the full dataset for the CRDTs.
     */
    onlyTrigger: boolean,

    /**
     * Nodes per level are by default sorted ascending (oldest first) on creationTime,
     * set this to true to reverse the order.
     * Note that the ordering is only applied per level of the fetch, not for the full fetch
     * and not per parent, but per all children per all parents on the same level.
     *
     * If orderByStorageTime is set then order by node storageTime instead of creationTime.
     */
    descending: boolean,

    /**
     * If set then order by storageTime instead of by creationTime.
     * This means that ordering is by when the node was first stored in the particular storage
     * instead of when it was created.
     * This will naturally yield different orderings between different storages since the storage
     * timestamp will most often differ.
     * This feature can be useful for presenting nodes in the order they were first seen instead
     * of the creationTime which the creator can set arbitrarely.
     */
    orderByStorageTime: boolean,

    /** Set to true to not include not valid online nodes in result. Default is to include not valid nodes in resultset. */
    ignoreInactive: boolean,

    /**
     * Set to true to ignore data which has owner targetPublicKey.
     *
     * Default is false.
     */
    ignoreOwn: boolean,

    /**
     * Set to true to preserve nodes transient values across serialization boundaries when fetching.
     *
     * This is useful when a client wants to piggy-back on the peer's knowledge of the online transient
     * properties of nodes, such as if it is validate and also for CRDT annotations.
     *
     * Only use this if trusting the peer, also transient values are not guaranteed to be provided by the peer.
     */
    preserveTransient: boolean,

    /**
     * If set then the query will be limited to a certain physical region.
     * A node can be configured for a certain region which must match this setting.
     *
     * The format is ISO 3166-1 "SE", "EU", etc.
     */
    region: string,

    /**
     * If set then the query will be limited to a certain jurisdiction.
     * A node can be configured for a certain jurisdiction which must match this setting.
     *
     * The format is ISO 3166-1 "SE", "EU", etc.
     */
    jurisdiction: string,

    /**
     * The includeLicenses feature is a way of bundling applicable licenses in the response.
     *
     * Compared to adding a Match for license and an Embed to be able to get new licenses,
     * the includeLicenses feature makes it even more to the point of only targeting licenses
     * needed for the particular nodes matched.
     *
     * Fetching licenses using a Match and Embed sweeps very broadly and might return
     * many licenses for nodes which are of no interest to the query request.
     *
     * If set to 0 this feature is not active.
     *
     * If set to 1 then include all valid existing licenses for each specific node matched,
     * including read and write licenses. Although only read licenses will result in the
     * node being returned in the query response.
     *
     * If set to 2 then automatically add proposed embeddings of licenses which will give
     * rights to nodes matched. This also includes write licenses, although those do not give
     * read access to the nodes.
     *
     * If set to 3 then do for 1 and 2.
     */
    includeLicenses: number,
};

/**
 * A fetchRequest can have a FetchCRDT to apply a CRDT the result from the FetchQuery.
 */
export type FetchCRDT = {
    /**
     * The ID of the CRDT algo requested.
     * The server might not allow certain or any algos.
     * A value of 0 means CRDT is not used.
     */
    algo: number,

    /**
     * Algos can take configuration parameters in JSON format, provided here.
     * Algo sorted and Algo refId both can handle annotations.
     * Annotations is a strategy of further specialising a CRDT algorithm.
     *
     * The below configuration works for the Algo Sorted and Algo RefId, to add
     * annotations to messages for reactions and nested conversations:
     * {
     *  "annotations": {
     *      "format": "messages"
     *  }
     * }
     *
     * Since this is arbitrary JSON data it can also be used to differentiate between
     * different fetch requests to force identical requests to have their own underlying
     * CRDT models, which might be useful in paging scenarios where models need to stay
     * static over some period of time.
     * Set a value like "{differentiator: 1}" to force uniqueness.
     */
    conf: string,

    /**
     * Set this property to the msgId of an active subscription request to update its properties.
     *
     * All properties of the fetchRequest must be set the same as the original request,
     * except triggerNodeId which is ignored.
     *
     * The properties of crdt.head, tail, cursorId1, cursorIndex and reverse
     * are allowed to be set differently to update the view of the model, also
     * query.triggerInterval can be set to be updated, if set to 0 then the current value is kept.
     *
     * The response on this request is an empty fetch response, but on the streaming request
     * there will be fresh output.
     */
    msgId: Buffer,

    /**
     * Fetch results in reverse order.
     * Reverse model then get view.
     *
     * For head fetches:
     * If the result without reverse is a,b,c,d,e then the result using reverse will be e,d,c,b,a.
     * Furthermore if cursor is "c", without reverse result is d,e and with reverse result is b,a.
     *
     * For tail fetches:
     * If the result without reverse is a,b,c,d,e then the result using reverse will be e,d,c,b,a,
     * furthermore if cursor is "c", without reverse result is a,b and with reverse result is e,d.
     *
     */
    reverse: boolean,

    /**
     * Read a number if nodes from the start of the sorted model,
     * -1 means until end (or maximum 100000 nodes).
     *
     * This value is mutually exclusive to tail. Set it to 0 if tail is set.
     *
     * This value can be changed for streaming requests to change the scope of the resultset.
     */
    head: number,

    /**
     * Read a number if nodes from the end of the sorted model,
     * -1 means until start (or maximum 100000 nodes).
     *
     * This value is mutually exclusive to head. Set it to 0 if head is set.
     *
     * This value can be changed for streaming requests to change the scope of the resultset.
     */
    tail: number,

    /**
     * This can be used to page the results when fetching.
     *
     * The index of the node with the id1 equal to cursorId1 is the previous element in the list
     * and the first returned element is the node after the cursor node.
     *
     * If a cursor is given but not found then the fetch response status is MISSING_CURSOR.
     *
     * This value can be changed for streaming requests to change the scope of the resultset.
     *
     * When fetching using head, the start index will be the index of cursorId1 + 1.
     *
     * When fetching using tail, the end index will be the index of cursorId1 (not including),
     * meaning the window will be moved upwards from the bottom of the list where the cursor
     * is the last node (not included).
     */
    cursorId1: Buffer,

    /**
     * This can be used to page the results when fetching.
     *
     * It is the index of the presumed cursor element.
     *
     * This value can be set on its own or as a fallback to cursorId1 in the case the cursor
     * element is not found on its id1.
     *
     * The first element retrieved is cursorOffset + 1, for head fetch.
     * The last element retrived is cursorOffset -1, for tail fetch.
     *
     * Note that a value of -1 indicates this property is not used, while a value of 0
     * means to use element at index 0 as cursor element.
     */
    cursorIndex: number,
};

/**
 * Each response has a Status property which states the completion status of the request.
 */
export enum Status {
    /** This means a result was returned. Which is a success. */
    RESULT              = 1,

    /** This is returned if the incoming request was malformed and could not be parsed properly. */
    MALFORMED           = 2,

    /** Some error occoured while processing the request. */
    ERROR               = 3,

    /** If a storeRequest or writeBlobRequest could not succeed. */
    STORE_FAILED        = 4,

    /** If a readBlobRequest fails because blob data is not available. */
    FETCH_FAILED        = 5,

    /**
     * If a fetchRequest refers to a real root ID but the root node
     * was not found then this error code is returned.
     */
    MISSING_ROOTNODE    = 6,

    /**
     * If a fetchRequest refers to a real root node but the root node is either licensed,
     * uses hasRightsByAssociation or is flagged as beginRestrictiveWriterMode then
     * the given root node cannot be used as a root node.
     */
    ROOTNODE_LICENSED   = 7,

    /**
     * If access to root node is denied, or
     * when writing/reading a blob whos node we are not allowed to access,
     */
    NOT_ALLOWED         = 8,

    /** If content hash does not match expected hash when writing a blob. */
    MISMATCH            = 9,

    /** When a blobWrite got finalized or if the blob already did exist when writing. */
    EXISTS              = 10,

    /**
     * When a CRDT fetch is done using a cursor but the cursor does not exist, this return
     * status is only for requests using CRDTs, and not applicable for query.cursordId1.
     *
     * Note that this is not regarded as an error message and if the request is a trigger subscription
     * then it will not be automatically removed (as when sending any other error replies).
     */
    MISSING_CURSOR      = 11,

    /**
     * Sent from the Storage when a trigger has been dropped.
     * Message is sent with seq=0 so that message is cleared out and onCancel()
     * is triggered on the GetResponse object.
     */
    DROPPED_TRIGGER     = 12,
}

/**
 *  A FetchResult is the result of a FetchQuery.
 */
export type FetchResult = {
    /** array of buffers where each buffer is a serialized node */
    nodes: Buffer[],

    /**
     * The Storage can send this array of serialized nodes which are to be signed and sent back to storage for storing.
     * The serialized node is a proposal from the extender of the embedding node to be signed.
     */
    embed: Buffer[],

    /** The next cutoff timestamp to use in any subsequent query to reduce the number of duplicate nodes in the result set. */
    cutoffTime: bigint,
};

export type CRDTResult = {
    /**
     * The delta used to patch old model to updated model.
     * All added nodes are passed in the query response and the delta is for patching
     * the order of the nodes.
     * The first byte of the delta tells us what diff algorithm has been used and how is
     * the patch formatted.
     * As for now we support one algo which is FossilDelta and the byte-prefix for that is a
     * single zero byte. The rest of the data is a buffer encoded JSON string, as: {
     *  patch: <fossilDelta patch>
     * }
     */
    delta: Buffer,

    /**
     * The index of the last node in the view, or -1 if no nodes are in the view.
     *
     * If using head and reverse == false, then index will always be equal to the
     * index of the last element in the returned.
     *
     * If using head and reverse == true then index will always be equal to the
     * index of the first element in the view.
     *
     * If using tail and reverse == false then index will always be equal to the index of
     * the first element in the returned view.
     *
     * If using tail and reverse == true then index will also always be equal to the index of
     * the first element in the returned view.
     *
     * When paging this returned value of cursorIndex can be fed into the next request,
     * unless it is -1 then no results were returned and paging has reached its end.
     */
    cursorIndex: number,

    /**
     * The total length of the model.
     * This can be useful when paging to show nr of pages.
     */
    length: number,
};

/** The struct used for performing fetch requests */
export type FetchRequest = {
    query: FetchQuery,
    crdt: FetchCRDT,
};

/** The struct used for responding to fetch requests */
export type FetchResponse = {
    /**
     * Expected status values:
     * Status.RESULT
     * Status.ERROR
     * Status.NOT_ALLOWED
     * Status.ROOTNODE_LICENSED
     * Status.MISSING_ROOTNODE
     * Status.MISSING_CURSOR
     * Status.MALFORMED
     */
    status: Status,

    result: FetchResult,

    crdtResult: CRDTResult,

    /**
     * Counter starting from 1 and will increase for each FetchResponse sent.
     * A batch is identified as having the same endSeq set.
     *
     * If seq == 0 then indicates an error or an unsubscription,
     * and the GetResponse will be cancelled.
     * The message will be removed from the pocket-messaging cache and no more data will flow.
     *
     * A trigger subscription is already removed from the Storage and it is not necessary
     * to explicitly unsubscribe from failed requests.
     */
    seq: number,

    /**
     * The seq nr of the last fetchResponse in the batch.
     * If endSeq == 0 then undetermined nr of responses will follow.
     * If endSeq == seq it means this is the last response in this batch, however more batches could
     * follow if the fetch request is a subscription.
     */
    endSeq: number,

    /**
     * If there was an error reported in Status an error message could be provided.
     */
    error: string,

    /**
     * The number of rows in the database processed so far to return this resultset.
     * If this number is much higher than the expected length of the resulset (or hits the max limit)
     * then it is a good indicator that the query is not specific enough.
     * The rowCount increases for each sequence of the total response returned for a query,
     * meaning it is the aggregated value of all sequences prior for the current query result.
     */
    rowCount: number,
};

/** The struct used when sending store requests. */
export type StoreRequest = {
    /** The serialized data of the nodes to be stored. */
    nodes: Buffer[],

    /**
     * Optional.
     *
     * Set who is storing data.
     *
     * Upon arrival this is by default set to the public key of the peer sending the message.
     *
     * It can be set differently by the sender if the receiving P2PClient is configured with
     * allowUncheckedAccess.
     *
     * P2PClientAutoFetchers set it to the public key from where they are fetching data
     * which is then getting stored. It is however reset to its default value upon arrival
     * unless allowUncheckedAccess is set in the receiving P2PClient.
     *
     */
    sourcePublicKey: Buffer,

    /**
     * Optional.
     *
     * Set who is the reason we are storing this data.
     *
     * P2PClientExtender set this when extending new licenses and storing them towards
     * the targetPublicKey.
     *
     * Upon arrival this is by default set to the public key of the peer sending the message.
     *
     * It can be set differently by the sender if the receiving P2PClient is configured with
     * allowUncheckedAccess.
     */
    targetPublicKey: Buffer,

    /**
     * Could be populated with msg IDs which were the msg IDs of the fetchRequest message sent when creating a subscription.
     * This is useful so that the same data is not bounced back to the peer which the data just was fetched from.
     * Peer clients are not expected to set this.
     */
    muteMsgIds: Buffer[],

    /**
     * Set to true to preserve nodes transient values across serialization boundaries when sending nodes to storage.
     * One usage of this is when a client fetches from a peer using fetchQuery.preserveTransient and then wanting to store the transient values in its storage,
     * because the client's storage might not be capable of looking up transient values it self.
     * The Storage must be configured to allow the preservation of transient values for them to be stored.
     */
    preserveTransient: boolean,

    /**
     * The peer sending the storage request can signal that it will send more data as part of a batch.
     * This can help the receiving peer postpone costly operations such as updating CRDT models.
     * This is an optional field which defaults to 0 meaning no batch in use.
     * batchId should be a unique uint32 number which is not to be reused by the client.
     * muteMsgIds is preserved only for the first request of the batch, then it is ignored.
     */
    batchId: number,

    /**
     * When using batchId this field should be set when more data will be sent in a subsequent request.
     * When the last request of the batch is sent this should be false.
     * If batchId is not > 0 then this field is ignored.
     * Default is false.
     */
    hasMore: boolean,
};

/** Struct used for responding to store requests. */
export type StoreResponse = {
    /**
     * Expected status values:
     * Status.RESULT
     * Status.STORE_FAILED
     * Status.MALFORMED
     * Status.ERROR
     */
    status: Status,

    /**
     * Node ID1s of all nodes which got stored.
     */
    storedId1s: Buffer[],

    /**
     * Node ID1s of all nodes in StoreRequest which are missing blobs.
     * Use this to know what blobs to download from the peer.
     */
    missingBlobId1s: Buffer[],

    /**
     * Corresponds to missingBlobId1s and gives the size of the blob in bytes.
     */
    missingBlobSizes: bigint[],

    /**
     * If there was an error reported in Status an error message could be provided.
     */
    error: string,
};

/** Struct used to send unsubscribe requests created on a prior fetch request. */
export type UnsubscribeRequest = {
    /**
     * The msg ID of the fetch request message sent prior, from which we want to unsubscribe.
     */
    originalMsgId: Buffer,

    /**
     * Optional.
     *
     * Who is the fetcher now unsubscribing from a prior fetch request.
     * This public key must match the targetPublicKey in the fetch query we are
     * now unsubscring from.
     *
     * Upon arrival this is by default set to the public key of the peer sending the message.
     *
     * It can be set differently by the sender if the receiving P2PClient is configured with
     * allowUncheckedAccess.
     */
    targetPublicKey: Buffer,
};

/** Struct used for responding to unsubscribe requests. */
export type UnsubscribeResponse = {
    /**
     * Expected status values:
     * Status.RESULT
     */
    status: Status,

    /**
     * If there was an error reported in Status an error message could be provided.
     */
    error: string,
};

/** Struct used for sending write blob requests. */
export type WriteBlobRequest = {
    /**
     * The node ID1 of the node we are writing blob data for.
     */
    nodeId1: Buffer,

    /**
     * The position in the blob to write at.
     */
    pos: bigint,

    /**
     * The data of the blob to write at the given positon.
     */
    data: Buffer,

    /**
     * Optional.
     *
     * Who is the sender. Permissions are applied to this public key and access is
     * needed to the blob node to be able to write blob data.
     *
     * Upon arrival this is by default set to the public key of the peer sending the message.
     *
     * It can be set differently by the sender if the receiving P2PClient is configured with
     * allowUncheckedAccess.
     */
    sourcePublicKey: Buffer,

    /**
     * Optional.
     *
     * Set for whom we are storing this blob data.
     *
     * Upon arrival this is by default set to the public key of the peer receiving this message.
     *
     * It can be set differently by the sender if the receiving P2PClient is configured with
     * allowUncheckedAccess.
     */
    targetPublicKey: Buffer,

    /**
     * Same as for StoreRequest.
     */
    muteMsgIds: Buffer[],
};

/** Struct used for responding to write blob requests. */
export type WriteBlobResponse = {
    /**
     * Expected status values:
     * Status.ERROR some error occurred
     * Status.NOT_ALLOWED if access to node is not allowed, node not found or if allowWriteBlob is set to false.
     * Status.MALFORMED if input values are wrong or if node is not configured for blob.
     * Status.EXISTS if the blob already exists or if the blob just got finalized to exist from this write or copy action
     * Status.STORE_FAILED if data could not be written or finalized. Database could be busy.
     * Status.MISMATCH if hash does not compute after all data is written.
     * Status.RESULT on successful write, currentLength is set to the size of the written data so far.
     *      The length is the continuous length from start til first gap.
     *      This info can be used for resuming writes.
     */
    status: Status,

    /**
     * The current length of the blob data written.
     * If Status.EXISTS is returned currentLength is set to the full length of the blob.
     * If Status.RESULT is returned currentLength is set to the current length of the total continuous blob data written.
     */
    currentLength: bigint,

    /**
     * If there was an error reported in Status an error message could be provided.
     */
    error: string,
};

/** Struct used for sending read blob requests. */
export type ReadBlobRequest = {
    /**
     * The node ID1 of the node we are reading blob data for.
     */
    nodeId1: Buffer,

    /**
     * The position in the blob to read from.
     */
    pos: bigint,

    /**
     * Number of bytes to read.
     * Reads are chopped up in sequences of smaller packages in the KiB range (as is fetching).
     * Length cannot be greater than 1 MiB, if blob is larger than a subsequent request must be made.
     */
    length: number,

    /**
     * Optional.
     *
     * For whom this blob read is performed. Permissions are applied to this public key.
     *
     * Upon arrival this is by default set to the public key of the peer sending the message.
     *
     * It can be set differently by the sender if the receiving P2PClient is configured with
     * allowUncheckedAccess.
     */
    targetPublicKey: Buffer,

    /**
     * Optional.
     *
     * Who is the source of the blob data we are fetching.
     *
     * Upon arrival this is by default set to the public key of the peer receiving this message.
     *
     * It can be set differently by the sender if the receiving P2PClient is configured with
     * allowUncheckedAccess.
     */
    sourcePublicKey: Buffer,
};

/** Struct used for responding to read blob requests. */
export type ReadBlobResponse = {
    /**
     * Expected status values:
     * Status.ERROR if some error or exception occurred.
     * Status.NOT_ALLOWED if read permissions to the node is not allowed for the client,target combo or
     *  if allowReadBlob is set to false, or if the node is not found.
     * Status.FETCH_FAILED if blob data is not (yet) available.
     * Status.MALFORMED if input values are wrong or if the node is fetched on id2, or if node is not configured for blob.
     * Status.RESULT on successful read.
     */
    status: Status,

    /** The read data. */
    data: Buffer,

    /**
     * Counter starting from 1 and will increase for each ReadBlobResponse sent for the same ReadBlobRequest.
     * If seq == 0 then indicates an error and the message will be removed.
     */
    seq: number,

    /**
     * States how many responses to expect.
     * If == 0 then undetermined nr of responses will follow.
     * If endSeq == seq it means this is the last response in this batch and the message will be removed.
     */
    endSeq: number,

    /**
     * When successfully reading blob data this property tells the full length in bytes of the blob.
     */
    blobLength: bigint,

    /**
     * If there was an error reported in Status an error message could be provided.
     */
    error: string,
};

/**
* Struct used for sending generic messages to peer
* This generic messaging gives two peers the possibility to exchange messages but which are not nodes in the tree.
*/
export type GenericMessageRequest = {
    /**
     * Arbitrary string which the peer might understand the meaning of.
     */
    action: string,

    /**
     * Optional.
     *
     * Upon arrival this is by default set to the public key of the peer sending the message.
     *
     * It can be set differently by the sender if the receiving P2PClient is configured with
     * allowUncheckedAccess.
     */
    sourcePublicKey: Buffer,

    /**
     * This can be JSON or whatever else serialized that the peer can understand.
     * Note that any request sent has a total envelope limit of 64 KiB,
     * meaning that any longer messages have to be split up.
     */
    data: Buffer,
};

/** Struct used for responding on generic message requests */
export type GenericMessageResponse = {
    /**
     * Expected status values is all dependant on how the peers implement their messaging protocol.
     */
    status: Status,

    /** Whatever the peer responded with. */
    data: Buffer,

    /**
     * If there was an error reported in Status an error message could be provided.
     */
    error: string,
};
