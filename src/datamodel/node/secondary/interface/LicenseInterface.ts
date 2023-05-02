import {
    NodeInterface,
} from "../../primary/interface/NodeInterface";

import {
    LicenseCertInterface,
    FriendCertInterface,
} from "../../../cert/secondary/interface";

import {
    LicenseParams,
} from "../license/types";

/** 16 bit BE encoded uint which identifies the secondary interface ID. */
export const SECONDARY_INTERFACE_LICENSE_ID = 2;

/**
 * A secondary interface for the License node.
 */
export interface LicenseInterface extends NodeInterface {
    setTargetPublicKey(targetPublicKey: Buffer | undefined): void;
    getTargetPublicKey(): Buffer | undefined;
    setNodeId1(nodeId1: Buffer | undefined): void;
    getNodeId1(): Buffer | undefined;
    setExtensions(extensions: number | undefined): void;
    getExtensions(): number | undefined;
    setFriendLevel(friendLevel: number | undefined): void;
    getFriendLevel(): number | undefined;
    isFriendCertTypeAccepted(certType: Buffer): boolean;
    setFriendACert(friendConnection: Buffer | undefined): void;
    getFriendACert(): Buffer | undefined;
    setFriendBCert(friendConnection: Buffer | undefined): void;
    getFriendBCert(): Buffer | undefined;
    getFriendACertObject(): FriendCertInterface;
    getFriendBCertObject(): FriendCertInterface;
    setFriendACertObject(cert: FriendCertInterface | undefined): void;
    setFriendBCertObject(cert: FriendCertInterface | undefined): void;
    setTerms(terms: string | undefined): void;
    getTerms(): string | undefined;
    getOriginalTerms(): string | undefined;
    getParentPathHash(): Buffer | undefined;
    setParentPathHash(parentPathHash: Buffer | undefined): void;
    getMaxDistance(): number | undefined;
    setMaxDistance(maxDistance: number | undefined): void;
    getCurrentTerms(): string | undefined;
    countLicenses(): number;
    getEmbeddedObject(): LicenseInterface;
    setEmbeddedObject(license: LicenseInterface | undefined): void;
    embed(targetPublicKey: Buffer): LicenseInterface | undefined;
    getLicenseeHashes(): Buffer[];
    getIssuer(): Buffer | undefined;
    isLicenseTo(nodeToLicense: NodeInterface, clientPublicKey?: Buffer, targetPublicKey?: Buffer): boolean;
    hashShared(): Buffer;
    canSendEmbedded(clientPublicKey: Buffer, targetPublicKey: Buffer): boolean;
    canSendPrivately(clientPublicKey: Buffer, targetPublicKey: Buffer): boolean;
    canHoldPrivately(clientPublicKey: Buffer): boolean;
    setAllowTargetSendPrivately(allowSend: boolean): void;
    allowTargetSendPrivately(): boolean;
    setDisallowRetroLicensing(disallow: boolean): void;
    disallowRetroLicensing(): boolean;
    setRestrictiveModeWriter(isWriter: boolean): void;
    isRestrictiveModeWriter(): boolean;
    setRestrictiveModeManager(isManager: boolean): void;
    isRestrictiveModeManager(): boolean;
    setLicenseConfig(config: number | undefined): void;
    getLicenseConfig(): number | undefined;
    getLicenseTransientConfig(): number | undefined;
    setLicenseTransientConfig(licenseTransientConfig: number | undefined): void;
    setCertObject(cert: LicenseCertInterface | undefined): void;
    getCertObject(): LicenseCertInterface;
    setHasDynamicFriendCert(isDynamic: boolean): void;
    hasDynamicFriendCert(): boolean;
    isDynamicFriendCertsActive(): boolean;
    setDynamicFriendCertsActive(isActive: boolean): void;
    setParams(params: LicenseParams): void;
    getParams(): LicenseParams;
}
