import {
    Signature,
    KeyPair,
} from "../datamodel/types";

import {
    DataModelInterface,
} from "../datamodel/interface";

export interface SignatureOffloaderInterface {
    init(): Promise<void>;
    addKeyPair(keyPair: KeyPair): Promise<void>;
    getPublicKeys(): Promise<Buffer[]>;
    countWorkers(): Promise<number>;
    close(): Promise<void>;
    sign(datamodels: DataModelInterface[], publicKey: Buffer, deepValidate?: boolean): Promise<void>;
    verify(datamodels: DataModelInterface[]): Promise<DataModelInterface[]>;
}

export type SignaturesCollection = {
    index: number,
    signatures: Signature[],
};

export type ToBeSigned = {
    index: number,
    message: Buffer,
    publicKey: Buffer,
};

export type SignedResult = {
    index: number,
    signature: Buffer,
};
