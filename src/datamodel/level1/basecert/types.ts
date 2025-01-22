import {
    BaseModelProps,
    BaseModelFlags,
    BaseModelInterface,
} from "../../types";

export const CONSTRAINTS_INDEX          = 32;

export type BaseCertProps = BaseModelProps & {
    constraints?: Buffer,
};

export type BaseCertFlags = BaseModelFlags;

export interface BaseCertInterface extends BaseModelInterface {
    getProps(): BaseCertProps;
    setProps(props: BaseCertProps): void;
    mergeProps(props: BaseCertProps): void;
    loadFlags(): BaseCertFlags;
    storeFlags(baseCertFlags: BaseCertFlags): void;
    getAchillesHashes(): Buffer[];
}
