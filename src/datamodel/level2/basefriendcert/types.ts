import {
    SignCertProps,
    SignCertInterface,
} from "../../level3/signcert";

import {
    BaseCertProps,
    BaseCertFlags,
    BaseCertInterface,
} from "../../level1/basecert/types";

export const LICENSEMAXEXPIRETIME_INDEX = 48;
export const SALT_INDEX                 = 49;
export const FRIENDLEVEL_INDEX          = 50;

export type BaseFriendCertProps = BaseCertProps & {
    signCert?: Buffer | SignCertProps,
    licenseMaxExpireTime?: number,
    salt?: Buffer,
    friendLevel?: number,
};

export type BaseFriendCertFlags = BaseCertFlags;

export interface BaseFriendCertInterface extends BaseCertInterface {
    getProps(): BaseFriendCertProps;
    setProps(props: BaseFriendCertProps): void;
    mergeProps(props: BaseFriendCertProps): void;
    loadFlags(): BaseFriendCertFlags;
    storeFlags(basFriendeCertFlags: BaseFriendCertFlags): void;
    loadSignCert(): SignCertInterface;
}
