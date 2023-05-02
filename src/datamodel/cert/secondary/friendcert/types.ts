import {
    ModelType,
} from "../../../model";

import {
    PRIMARY_INTERFACE_DEFAULTCERT_ID,
} from "../../primary/interface/PrimaryDefaultCertInterface";

import {
    SECONDARY_INTERFACE_FRIENDCERT_ID,
} from "../interface/FriendCertInterface";

import {
    BaseCertParams,
} from "../../base/types";

export const FRIENDCERT_TYPE: ModelType = Buffer.from([0, PRIMARY_INTERFACE_DEFAULTCERT_ID, 0, SECONDARY_INTERFACE_FRIENDCERT_ID, 0, 0]);

export type FriendCertParams = BaseCertParams & {
    key?: Buffer,
    isLockedOnIntermediary?: boolean,
    isLockedOnLevel?: boolean,
};

/**
 * Extends the general cert config.
 * Bit numbers must not conflict with bits in PrimaryDefaultCertConfig.
 */
export enum FriendCertLockedConfig {
    /**
     * If set then this cert is only valid for a specific intermediary public key
     * (the target of the first license who is signing the second license).
     * This means that only the specific intermediary can extend the license
     * using this friend cert.
     */
    IS_LOCKED_ON_INTERMEDIARY   = 0,

    /**
     * If set then this cert is only valid for a specific friendLevel of the license
     * getting extended.
     */
    IS_LOCKED_ON_LEVEL          = 1,
}
