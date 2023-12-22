import {
    NodeInterface,
} from "../../primary/interface/NodeInterface";

import {
    DataCertInterface,
} from "../../../cert/secondary/interface/DataCertInterface";

import {
    DataParams,
} from "../data/types";

/** 16 bit BE encoded uint which identifies the secondary interface ID. */
export const SECONDARY_INTERFACE_DATA_ID = 1;

/**
 * A secondary interface for the Data node.
 */
export interface DataInterface extends NodeInterface {
    setUserConfig(userConfig: number | undefined): void;
    getUserConfig(): number | undefined;
    setContentType(contentType: string | undefined): void;
    getContentType(): string | undefined;
    setData(data: Buffer | undefined): void;
    getData(): Buffer | undefined;
    setAnnotations(annotations: Buffer | undefined): void;
    getAnnotations(): Buffer | undefined;
    setSpecial(special: boolean): void;
    isSpecial(): boolean;
    embed(targetPublicKey: Buffer): DataInterface | undefined;
    copy(parentId?: Buffer): DataInterface;
    getCopiedNode(): DataInterface | undefined;
    getDataConfig(): undefined | number;
    setDataConfig(dataConfig: number): void;
    setAnnotationEdit(): void;
    isAnnotationEdit(): boolean;
    setAnnotationReaction(): void;
    isAnnotationReaction(): boolean;
    setCertObject(cert: DataCertInterface | undefined): void;
    getCertObject(): DataCertInterface;
    setParams(params: DataParams): void;
    getParams(): DataParams;
}
