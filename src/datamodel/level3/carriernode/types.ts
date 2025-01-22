import {
    BaseCarrierNodeInterface,
    BaseCarrierNodeProps,
    BaseCarrierNodeFlags,
} from "../../level2/basecarriernode/types";

import {
    AuthCertInterface,
    AuthCertProps,
} from "../authcert/types";

import {
    FriendCertInterface,
    FriendCertProps,
} from "../friendcert/types";

// in range for automatic verification
export const EMBEDDED_AUTHCERT_INDEX        =  9;
export const EMBEDDED_FRIENDCERT_INDEX      =  10;

export type CarrierNodeFlags = BaseCarrierNodeFlags;

export type CarrierNodeProps = BaseCarrierNodeProps & {
    authCert?: Buffer | AuthCertProps,
    friendCert?: Buffer | FriendCertProps,
};

export interface CarrierNodeInterface extends BaseCarrierNodeInterface {
    getProps(): CarrierNodeProps;
    setProps(props: CarrierNodeProps): void;
    mergeProps(props: CarrierNodeProps): void;
    loadAuthCert(): AuthCertInterface;
    loadFriendCert(): FriendCertInterface;
    hashConstraints(lockedConfig: number): Buffer;
}

export enum CarrierNodeLockedConfig {
    // Lock on specific fields
    //
    ParentId            = 0,
    RefId               = 1,
    Region              = 2,
    Jurisdiction        = 3,
    LicenseMinDistance  = 4,
    LicenseMaxDistance  = 5,
    Difficulty          = 6,
    Info                = 7,
    AuthCert            = 8,
    FriendCert          = 9,
    BaseNodeConfig      = 10,

    // Lock on specific bits of config fields.
    // This is useful as we can lock on only specific bits in the config and
    // not the full config it self (although that can be done using above).
    //
    // As example to lock a node to be private, we need to lock IsPublic
    // and IsLicensed (both flags as being not set).
    //
    // BaseNode
    IsPublic                        = 11,
    IsLicensed                      = 12,
    IsUnique                        = 13,
    IsIndestructible                = 14,
    HasRightsByAssociation          = 15,
    DisallowParentLicensing         = 16,
}
