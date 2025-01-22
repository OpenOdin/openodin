import {
    BaseCertProps,
    BaseCertFlags,
    BaseCertInterface,
} from "../../level1/basecert/types";

export const TARGETMAXEXPIRETIME_INDEX  = 48;
export const COUNTDOWN_INDEX            = 49;
export const TARGETTYPE_INDEX           = 50;
export const BASESIGNCERTCONFIG_INDEX   = 51;

export type BaseSignCertProps = BaseCertProps & {
    signCert?: Buffer | BaseSignCertProps,
    targetMaxExpireTime?: number,
    targetType?: Buffer,
    baseSignCertConfig?: number,
};

export type BaseSignCertFlags = BaseCertFlags & {
    /** If set then cert cannot be destroyed by offline destruction nodes. */
    isIndestructible?: boolean,
};

export interface BaseSignCertInterface extends BaseCertInterface {
    getProps(): BaseSignCertProps;
    setProps(props: BaseSignCertProps): void;
    mergeProps(props: BaseSignCertProps): void;
    loadFlags(): BaseSignCertFlags;
    storeFlags(basSigneCertFlags: BaseSignCertFlags): void;
    loadSignCert(): BaseSignCertInterface;
}

export enum BaseSignCertConfig {
    /** If set then cert cannot be destroyed by offline destruction nodes. */
    IsIndestructible                = 0,
}
