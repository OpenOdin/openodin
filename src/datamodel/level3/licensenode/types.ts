import {
    BaseLicenseNodeInterface,
    BaseLicenseNodeProps,
    BaseLicenseNodeFlags,
} from "../../level2/baselicensenode/types";

import {
    FriendCertProps,
    FriendCertInterface,
} from "../friendcert/types";

// in range for automatic verification
export const EMBEDDED_LICENSE_INDEX     =  9;
export const FRIENDCERT1_INDEX          = 10;
export const FRIENDCERT2_INDEX          = 11;

export const LICENSEFRIENDLEVEL_INDEX   = 65;

export type LicenseNodeProps = BaseLicenseNodeProps & {
    embedded?: Buffer | LicenseNodeProps,
    friendLevel?: number,
    friendCert1?: Buffer | FriendCertProps,
    friendCert2?: Buffer | FriendCertProps,
};

export type LicenseNodeFlags = BaseLicenseNodeFlags;

export interface LicenseNodeInterface extends BaseLicenseNodeInterface {
    getProps(): LicenseNodeProps;
    setProps(props: LicenseNodeProps): void;
    mergeProps(props: LicenseNodeProps): void;
    loadEmbedded(): LicenseNodeInterface;
    loadFlags(): LicenseNodeFlags;
    storeFlags(licenseNodeFlags: LicenseNodeFlags): void;
    embed(targetPublicKey: Buffer, creationTime?: number): LicenseNodeInterface | undefined;
    loadFriendCert1(): FriendCertInterface;
    loadFriendCert2(): FriendCertInterface;
    hashConstraints(lockedConfig: number): Buffer;
}

export enum LicenseNodeLockedConfig {
    ParentId                = 0,
    RefId                   = 1,
    Region                  = 2,
    Jurisdiction            = 3,
    TargetPublicKey         = 4,
    Terms                   = 5,
    Extensions              = 6,
    BaseNodeConfig          = 7,
    BaseLicenseNodeConfig   = 8,
    FriendLevel             = 9,
    FriendCert1             = 10,
    FriendCert2             = 11,
    Difficulty              = 12,

    // Lock on specific bits of config fields.
    // This is useful as we can lock on only specific bits in the config and
    // not the full config it self (although that can be done using above).
    //
    // BaseNode
    IsIndestructible            = 13,

    // BaseLicenseNode
    AllowTargetSendPrivately    = 14,
    DisallowRetroLicensing      = 15,
    RestrictiveModeWriter       = 16,
    RestrictiveModeManager      = 17,
}
