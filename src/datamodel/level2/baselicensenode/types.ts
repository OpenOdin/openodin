import {
    BaseNodeProps,
    BaseNodeFlags,
    BaseNodeInterface,
} from "../../level1/basenode/types";

export const PARENTPATHHASH_INDEX       = 48;
export const JUMPPEERPUBLICKEY_INDEX    = 49;
export const EXTENSIONS_INDEX           = 50;
export const TERMS_INDEX                = 51;
export const TARGETPUBLICKEY_INDEX      = 52;
export const BASELICENSENODECONFIG_INDEX = 53;
export const MAXDISTANCE_INDEX          = 54;

export type BaseLicenseNodeProps = BaseNodeProps & {
    embedded?: Buffer | BaseLicenseNodeProps,
    baseLicenseNodeConfig?: number,
    targetPublicKey?: Buffer,
    terms?: string,
    extensions?: number,
    jumpPeerPublicKey?: Buffer,
    parentPathHash?: Buffer,
    maxDistance?: number,
};

export type BaseLicenseNodeFlags = BaseNodeFlags & {
    allowTargetSendPrivately?: boolean,
    disallowRetroLicensing?: boolean,
    restrictiveModeWriter?: boolean,
    restrictiveModeManager?: boolean,
};

export interface BaseLicenseNodeInterface extends BaseNodeInterface {
    getProps(): BaseLicenseNodeProps;
    setProps(props: BaseLicenseNodeProps): void;
    mergeProps(props: BaseLicenseNodeProps): void;
    loadEmbedded(): BaseLicenseNodeInterface;
    loadFlags(): BaseLicenseNodeFlags;
    storeFlags(baseLicenseNodeFlags: BaseLicenseNodeFlags): void;
    getLicensingHashes(): Buffer[];
    getRootOwner(): Buffer | undefined;
}

/**
 * The license config number bits.
 */
export enum BaseLicenseNodeConfig {
    /**
     * Allow the target of the license to send the license to any peer.
     * As a proof they hold the license.
     * If an extended license has this set then the previous license must also
     * have it set. If it is unset then if cannot be set again in the chain of licenses.
     */
    AllowTargetSendPrivately        = 0,

    /**
     * Do not allow parent licenses to license nodes which were created prior to
     * the license it self.
     * This is useful so that the history of a conversation in a group can be hidden
     * from new actors who join, who then only can see data from the point in time
     * when their license was created.
     *
     * Note that this is only enforced when licenses are inherited from a parent node,
     * not for sibling licenses.
     * Because a sibling license references the node's id1 which cannot be known before
     * the node is created, meaning technically a sibling license cannot be created
     * prior to the node it is licensing.
     */
    DisallowRetroLicensing          = 1,

    /**
     * This bit allows the target of the license to create nodes below a
     * restrictiveWriter node.
     * If this bit is set the license is not applicable for fetching.
     * In a License stack this bit must be same on every license in the stack.
     */
    RestrictiveModeWriter           = 2,

    /**
     * This bit allows the target of the license to stop a restrictiveWriter mode
     * or start a new restrictiveWriter mode when already in restrictiveWriter mode.
     * If this bit is set the license is not applicable for fetching.
     * In a License stack this bit must be same on every license in the stack.
     */
    RestrictiveModeManager          = 3,
}
