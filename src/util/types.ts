import {
    BaseCertInterface,
} from "../datamodel/cert";

export type UnpackedCert = {
    params: any,
    image: Buffer,
    stackIndex?: number,
    validates?: boolean,
    verifies?: boolean,
    issuerPublicKey?: Buffer,
    modelClassName?: string,
    certObject?: BaseCertInterface,
    error?: string,

};

export type CertStack = UnpackedCert[];
