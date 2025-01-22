import {
    BaseFriendCertProps,
    BaseFriendCertFlags,
    BaseFriendCertInterface,
} from "../../level2/basefriendcert/types";

export const FRIENDCERT_REGION_INDEX              = 65;
export const FRIENDCERT_JURISDICTION_INDEX        = 66;
export const FRIENDCERTCONFIG_INDEX               = 67;

export type FriendCertProps = BaseFriendCertProps & {
    region?: string,
    jurisdiction?: string,
    friendCertConfig?: number,
};

export type FriendCertFlags = BaseFriendCertFlags & {
    hashExtenderPublicKey?: boolean,
};

export interface FriendCertInterface extends BaseFriendCertInterface {
    getProps(): FriendCertProps;
    setProps(props: FriendCertProps): void;
    mergeProps(props: FriendCertProps): void;
    loadFlags(): FriendCertFlags;
    storeFlags(friendCertFlags: FriendCertFlags): void;
    hashConstraints(lockedConfig: number): Buffer;
    hashFriendConstraints(friendCert: FriendCertProps): Buffer;
}

export enum FriendCertConfig {
    /**
     * If set then include public key of the license extender into
     * the friend hash constraints. Meaning that only that key
     * can extend licenses using the friend cert pair.
     */
    HashExtenderPublicKey = 0,
}

export enum FriendCertLockedConfig {
    // Lock on specific fields
    //
    LicenseMaxExpireTime = 0,
    FriendLevel          = 1,
    Region               = 2,
    Jurisdiction         = 3,
}
