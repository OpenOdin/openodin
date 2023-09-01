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
 *  These content types have special meaning in the Database.
 */
export const SPECIAL_NODES = {
    /** A part of a paired friend connection. */
    FRIENDCERT: "special/friendCert",

    /** An indicator to destroy a private node by the refId referenced, which has the same owner. This also works on embedded private nodes. */
    DESTROYNODE: "special/destroy",

    /** A wrapper over an auth cert. */
    AUTHCERT: "special/authCert",
};

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
}
