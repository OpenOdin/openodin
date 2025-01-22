import {
    BaseNodeProps,
    BaseNodeFlags,
    BaseNodeInterface,
} from "../../level1/basenode/types";

export const INFOFIELD_INDEX    = 48;

export type BaseCarrierNodeFlags = BaseNodeFlags;

export type BaseCarrierNodeProps = BaseNodeProps & {
    info?: string,
};

export interface BaseCarrierNodeInterface extends BaseNodeInterface {
    setProps(props: BaseCarrierNodeProps): void;
    getProps(): BaseCarrierNodeProps;
    mergeProps(props: BaseCarrierNodeProps): void;
}
