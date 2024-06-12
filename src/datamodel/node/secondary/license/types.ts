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
export const LICENSE0_NODE_TYPE: ModelType = Buffer.from([0, PRIMARY_INTERFACE_ID, 0, SECONDARY_INTERFACE_ID, NODE_CLASS, CLASS_MAJOR_VERSION]);

export const LICENSE0_NODE_TYPE_ALIAS = "License0";

export type LicenseParams = NodeParams & {
    licenseConfig?: number,
    targetPublicKey?: Buffer,
    terms?: string,
    extensions?: number,
    friendLevel?: number,
    friendCertA?: Buffer,
    friendCertB?: Buffer,
    licenseTransientConfig?: number,
    allowTargetSendPrivately?: boolean,
    disallowRetroLicensing?: boolean,
    isRestrictiveModeWriter?: boolean,
    isRestrictiveModeManager?: boolean,
    hasOnlineFriendCert?: boolean,
    isOnlineFriendCertsOnline?: boolean,
    nodeId1?: Buffer,  // Overwrites refId if set.
    jumpPeerPublicKey?: Buffer,
    parentPathHash?: Buffer,
    maxDistance?: number,
};

/**
 * The license config number bits.
 */
export enum LicenseConfig {
    /** Allow the target of the license to send the license to any peer. */
    ALLOW_TARGET_SEND_PRIVATELY     = 0,

    /**
     * Do not allow parent licenses to license nodes which were created prior to the license it self.
     * This is useful so that the history of a conversation in a group can be hidden
     * from new actors who join, who then only can see data from the point in time
     * when their license was created.
     *
     * Note that this is only enforced when licenses are inherited from a parent node, not for sibling licenses.
     * Because a sibling license references the node's id1 which cannot be known before the node is created,
     * meaning technically a sibling license cannot be created prior to the node it is licensing.
     */
    DISALLOW_RETRO_LICENSING        = 1,

    /**
     * This bit allows the target of the license to create nodes below a restrictiveWriter node.
     * If this bit is set the license is not applicable for fetching.
     * In a License stack this bit must be same on every license in the stack.
     */
    RESTRICTIVEMODE_WRITER          = 2,

    /**
     * This bit allows the target of the license to stop a restrictiveWriter mode or start a new restrictiveWriter
     * mode when already in restrictiveWriter mode.
     * If this bit is set the license is not applicable for fetching.
     * In a License stack this bit must be same on every license in the stack.
     */
    RESTRICTIVEMODE_MANAGER         = 3,

    /** Must be set if the License embeds any friend certs which are online. */
    HAS_ONLINE_FRIENDCERT          = 4,
}

/** The License transient config number. */
export enum LicenseTransientConfig {
    /**
     * Set to true on nodes who uses online friend certs when those certs are online.
     */
    ONLINE_FRIENDCERTS_ONLINE = 0,
}
