import {
    SecondaryInterface,
    NodeClass,
    MajorVersion,
    MinorVersion,
    PatchVersion,
} from "../../primary/node";

import {
    SECONDARY_INTERFACE_LICENSE_ID,
} from "../interface/LicenseInterface";

/**
 * The primary node interface this License node inherits from.
 * 16 bit BE uint encoded into data model header.
 */
import {PRIMARY_INTERFACE_ID} from "../../primary/node/versionTypes";
export {PRIMARY_INTERFACE_ID} from "../../primary/node/versionTypes";

/**
 * The secondary interface which this License node implements.
 * 16 bit BE uint encoded into data model header.
 */
export const SECONDARY_INTERFACE_ID: SecondaryInterface = SECONDARY_INTERFACE_LICENSE_ID;

/**
 * The NODE_CLASS together with primary and secondary interfaces maps to this specific node module.
 * 8 bit int encoded into data structure.
 */
export const NODE_CLASS: NodeClass = 0;

/**
 * This class' major version.
 * Any change which makes the data model non compatible with a previous version is a change in major version.
 * If the abstract Node's major number gets bumped then we need to bump this node major also.
 * 8 bit int encoded into data structure.
 */
export const CLASS_MAJOR_VERSION: MajorVersion = 0;

/**
 * Feature addition or improvement in code which does not break anything.
 * A node of different minor version must be compatible with this and the data structures identical.
 * If the abstract Node minor number gets bumped then we need to bump this minor number also.
 * 8 bit int NOT encoded into data structure.
 */
export const CLASS_MINOR_VERSION: MinorVersion = 0;

/**
 * Minor fixes in code or updated documentation.
 * If the abstract Node patch number gets bumped then we need to bump this patch number also.
 * 8 bit int NOT encoded into data structure.
 */
export const CLASS_PATCH_VERSION: PatchVersion = 0;
