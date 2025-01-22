import {
    BaseModelInterface,
    KeyPair,
    SignatureVerification,
} from "../datamodel";

export interface SignatureOffloaderInterface {
    init(): Promise<void>;
    addKeyPair(keyPair: KeyPair): Promise<void>;
    getPublicKeys(): Promise<Buffer[]>;
    countWorkers(): Promise<number>;
    close(): Promise<void>;
    sign(baseModels: BaseModelInterface[], publicKey: Buffer, deepValidate?: boolean): Promise<void>;
    verify(baseModels: BaseModelInterface[]): Promise<BaseModelInterface[]>;
}

export type SignaturesCollection = {
    index: number,
    signatures: SignatureVerification[],
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
