import {
    ModelType,
} from "../../../model";

import {
    PRIMARY_INTERFACE_ID,
    SECONDARY_INTERFACE_ID,
    NODE_CLASS,
    CLASS_MAJOR_VERSION,
} from "./versionTypes";

import {
    NodeParams,
} from "../../primary/node/types";

/**
 * The node type of the Data node.
 * Six bytes of:
 * 16 bit BE primary interface ID.
 * 16 bit BE secondary interface ID.
 * 8 bit node class id.
 * 8 bit node class major version.
 */
export const DATA_NODE_TYPE: ModelType = Buffer.from([0, PRIMARY_INTERFACE_ID, 0, SECONDARY_INTERFACE_ID, NODE_CLASS, CLASS_MAJOR_VERSION]);

export type DataParams = NodeParams & {
    dataConfig?: number,
    userConfig?: number,
    contentType?: string,
    data?: Buffer,
    isSpecial?: boolean,
};

/**
 * A data node which is flagged as isSpecial is expected to have its
 * data set to one of the following topics below.
 */
export const SPECIAL_NODES = {
    /**
     * A part of a paired friend connection.
     *
     * A special data node has this topic and the friend cert as an embedded data object.
     * The friend cert will be extracted and stored to storage for later use.
     *
     * If the node carrying the friendcert is destroyed then the cert is not available
     * to be used in new nodes but it will not effect current use of the cert.
     */
    FRIENDCERT: "special/friendCert",

    /**
     * All nodes which are not flagged as indestructible and also all certs which are not
     * flagged as indestructible can be destroyed.
     *
     * All nodes and certs which are not flagged as indestructible emit so called "achilles hashes"
     * for themselves and also for any embedded nodes or certs which they carry.
     *
     * These achilles hashes are matched against so called "destroy hashes" and when matched
     * the node or cert is destroyed.
     *
     * If a node embeds a node or cert which does allow for destruction then the embedding
     * node also gets destroyed.
     *
     * A so called "destroy node" is data node flagged as isSpecial. Its data field begins
     * with "special/destroy".
     *
     * The data node is referred to as a "destroy node", because it contains the "destroy hash"
     * which will match against other nodes achilles hashes to destroy them.
     *
     * An incoming destroy node is detected when stored and its destroy hash is calculated as:
     *
     * topic = data.toString()
     * destroyHash = Hash([topic, ownerPublicKey, refId]);
     *
     * Whenever this hash matches any other nodes achilles hash that node is then deleted.
     *
     * All non indestructible nodes and certs emit achilles hashes on the general formula as:
     *
     * hash = Hash([topic, ownerPublicKey, Hash([x, y, z])).
     *
     * Where "x", "y", "z" are fields in the node which make up the Achilles Heel for the specific
     * node or cert type.
     *
     * Each node and cert will typically emit more than one achilles heel hash.
     *
     * These hashes are calculated when the node is stored and its achilles hashes are
     * stored alongside and will refer to the node's id1 of the node which just got stored,
     * so it can be deleted upon match.
     *
     * An example:
     *
     * Since all nodes and certs can be destroyed by their owner,
     * each node and cert emit this achilles heel hash:
     *
     * innerHash = Hash(["special/destroy/selfTotalDestruct", ownerPublicKey]]);
     * emitHash = Hash(["special/destroy/selfTotalDestruct", ownerPublicKey, innerHash]);
     *
     * The user can then create a destroy node as:
     *
     * data = "special/destroy/selfTotalDestruct";
     * isSpecial = true;
     * //innerHash is stored as refId
     * refId = Hash(["special/destroy/selfTotalDestruct", ownerPublicKey]);
     *
     * The storage upon storing the destroy node will calculate the destroy hash as:
     *
     * innerHash = refId
     * topic = data.toString()
     * destroyHash = Hash([topic, ownerPublicKey, innerHash]);
     *
     * If the destroyHash matches the emitHash then the node emitting the hash will get destroyed.
     *
     * Nodes and certs can be destroyed also when they are embedded.
     *
     * Note that when destroying nodes this does not effect online ID ownership transfer(s).
     *
     * But it will however affect the "copy node" functionality in the sense that
     * a copy of a node will also get destroyed if the original id1 node gets destroyed.
     * All copied nodes will inherit the isIndestructible flag from the original.
     *
     * Every destroy data node's data field must begin with "special/destroy" then contain the
     * specific topic the destroy node refers to. See further constants below.
     */
    DESTROY: "special/destroy",

    /**
     * All destroyable nodes and all certs emits this achilles hash:
     *
     * innerHash = Hash(["special/destroy/selfTotalDestruct",
     *      ownerPublicKey]);
     *
     * hash = Hash(["special/destroy/selfTotalDestruct",
     *      ownerPublicKey, innerHash]);
     *
     * This hash has the power of deleting all and every node and cert the user owns.
     * This is a total destruction of all current data and future data for the publicKey of the owner.
     *
     * For this destroy node to be valid it must come with a difficulty level of
     * MIN_DIFFICULTY_TOTAL_DESTRUCTION. This is to add extra friction in creating this type of node.
     */
    DESTROY_SELF_TOTAL_DESTRUCT: "special/destroy/selfTotalDestruct",

    /**
     * All destroyable nodes emit this achilles hash:
     *
     * innerHash = Hash(["special/destroy/destroyNode",
     *      ownerPublicKey, id1]);
     *
     * hash = Hash(["special/destroy/destroyNode",
     *      ownerPublicKey, innerHash]);
     *
     * The owner of a node can destroy a specific destroyable node which they own.
     */
    DESTROY_NODE: "special/destroy/destroyNode",

    /**
     * All destroyable license nodes also emit this achilles hash:
     *
     * innerHash = Hash(["special/destroy/destroyLicensesForTargetPublicKeyAndNode",
     *      ownerPublicKey, targetPublicKey, targetNodeId1]);
     *
     * hash = Hash(["special/destroy/destroyLicensesForTargetPublicKeyAndNode",
     *      ownerPublicKey, innerHash]);
     *
     * The license could be within a stack of licenses.
     *
     * This hash destroys all licenses towards a user public key for a specific node.
     * The license could be within a stack of licenses.
     *
     * This effectively blocks the target user off from ever getting a license targeted to them
     * for a specific node id1.
     *
     * Since it also destroys licenses within stacks it will tear down any license extensions too.
     */
    DESTROY_LICENSES_FOR_TARGET_PUBLICKEY_AND_NODE:
        "special/destroy/destroyLicensesForTargetPublicKeyAndNode",

    /**
     * All destroyable license nodes also emit this achilles hash:
     *
     * innerHash = Hash(["special/destroy/destroyLicensesForTargetPublicKey",
     *      ownerPublicKey, targetPublicKey]);
     *
     * hash = Hash(["special/destroy/destroyLicensesForTargetPublicKey",
     *      ownerPublicKey, innerHash]);
     *
     * This hash destroys all licenses towards a user public key for all nodes.
     * The license could be within a stack of licenses.
     *
     * This effectively blocks the target user from ever getting licenses targeted at them
     * from the specific owner at all.
     *
     * Since it also destroys licenses within stacks it will tear down any license extensions too.
     */
    DESTROY_LICENSES_FOR_TARGET_PUBLICKEY:
        "special/destroy/destroyLicensesForTargetPublicKey",

    /**
     * All destroyable license nodes also emit this achilles hash:
     *
     * innerHash = Hash(["special/destroy/destroyLicensesForNode",
     *      ownerPublicKey, targetNodeId1]);
     *
     * hash = Hash(["special/destroy/destroyLicensesForNode",
     *      ownerPublicKey, innerHash]);
     *
     * This hash destroys all licenses towards a specific node id1.
     * The license could be within a stack of licenses.
     *
     * This is how indestructible licensed nodes are deleted, by destroying all possible licenses,
     * as long as the licenses are not indestructible.
     *
     * Since it also destroys licenses within stacks it will tear down any license extensions too.
     */
    DESTROY_LICENSES_FOR_NODE: "special/destroy/destroyLicensesForNode",

    /**
     * All nodes (indestructible or not) using destroyable certs also emit this achilles hashes:
     *
     * innerHash = Hash(["special/destroy/destroyCert",
     *      ownerPublicKey, id1]);
     *
     * hash = Hash(["special/destroy/destroyCert",
     *      ownerPublicKey, innerHash]);
     *
     * This hash destroys a specific cert the user owns.
     *
     * This includes certs within stacks and embedded into nodes.
     */
    DESTROY_CERT: "special/destroy/destroyCert",

    /**
     * All license nodes (indestructible or not) who use friend certs
     * (and any node carrying a friend cert) also emit this achilles hashes:
     *
     * innerHash = Hash(["special/destroy/destroyFriendCert",
     *      ownerPublicKey, key]);
     *
     * hash = Hash(["special/destroy/destroyFriendCert",
     *      ownerPublicKey, innerHash]);
     *
     * This hash destroys a specific friend cert the user owns which invalidates
     * all prior and future usage of the friendcert, meaning the user cancels
     * the friendship for this particular cert and the carrier node for the cert
     * will also get destroyed.
     *
     * This includes certs within stacks and embedded into nodes.
     */
    DESTROY_FRIEND_CERT: "special/destroy/destroyFriendCert",
};

/**
 * The minimum difficulty required for destroy nodes targeting ALL of the owners nodes.
 *
 */
export const MIN_DIFFICULTY_TOTAL_DESTRUCTION = 2;

/**
 * The data config number bits.
 */
export enum DataConfig {
     /**
      * This bit set indicates to the Database that this node packs something which should be attended to.
      * The contentType of the node states exactly in what way this node is special.
      * An embedded special node is not treated in any special way by the Database.
      */
    SPECIAL         = 0,

    /**
     * This bit is set to indicate that this node is an annotation node to its parent.
     * What annotation means is application dependant where one example is that 
     * if represents a "like" on a message.
     * The CRDT models can handle annotations and bundle them up with their parent node.
     */
    ANNOTATION_EDIT = 1,

    /**
     * If this flag is set then the node is meant to be the edited version of its parent node.
     * This can be handled by the CRDT models if configured to do so, otherwise this node
     * is just handled as any other node.
     *
     * The CRDT models require that the owner of the edit node is the same as its parent.
     * If there are many edit nodes then the one with the newest creationTime is selected.
     */
    ANNOTATION_REACTION = 2,
}
