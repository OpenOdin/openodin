import {
    PrimaryInterface,
    MajorVersion,
    MinorVersion,
    PatchVersion,
} from "./types";

import {
    PRIMARY_INTERFACE_NODE_ID,
} from "../interface/NodeInterface";

/**
 * The ID of which this base node's defines.
 * Other nodes deriving the Node class must state this primary interface ID as their primary interface.
 */
export const PRIMARY_INTERFACE_ID: PrimaryInterface = PRIMARY_INTERFACE_NODE_ID;

/**
 * This class' major version.
 * Any change which makes the data model non compatible is a change in major version (unless it is a new primary interface ID).
 * 8 bit value encoded into data structure.
 */
export const CLASS_MAJOR_VERSION: MajorVersion = 0;

/**
 * Feature addition or improvement in code which does not break anything.
 * A node of different minor version must be compatible with this and the data structures identical.
 * 8 bit value NOT encoded into data structure.
 */
export const CLASS_MINOR_VERSION: MinorVersion = 0;

/**
 * Minor fixes in code or updated documentation.
 * 8 bit value NOT encoded into data structure.
 */
export const CLASS_PATCH_VERSION: PatchVersion = 0;
