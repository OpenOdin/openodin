import {
    ModelType,
} from "../../../model";

import {
    PRIMARY_INTERFACE_CHAINCERT_ID,
} from "../../primary/interface/PrimaryChainCertInterface";

import {
    SECONDARY_INTERFACE_CHAINCERT_ID,
} from "../interface/ChainCertInterface";

import {
    BaseCertParams,
} from "../../base/types";

export type ChainCertParams = BaseCertParams;

export const CHAINCERT_TYPE: ModelType = Buffer.from([0, PRIMARY_INTERFACE_CHAINCERT_ID, 0, SECONDARY_INTERFACE_CHAINCERT_ID, 0, 0]);
