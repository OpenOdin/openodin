import {
    Filter,
} from "../../../model";

import {
    NodeVersion,
    NodeParams,
} from "../node/types";

import {
    PrimaryNodeCertInterface,
} from "../../../cert/primary/interface/PrimaryNodeCertInterface";

import {
    DataModelInterface,
} from "../../../interface/DataModelInterface";

/** 16 bit BE encoded uint which identifies this primary interface ID. */
export const PRIMARY_INTERFACE_NODE_ID = 4;

/**
 *  A primary interface for Node.
 */
export interface NodeInterface extends DataModelInterface {
    setHasOnlineEmbedding(isOnline?: boolean): void;
    hasOnlineEmbedding(): boolean;
    isOnlineEmbeddingOnline(): boolean;
    setOnlineIdValidated(isValidated?: boolean): void;
    isOnlineIdValidated(): boolean;
    getBaseVersion(): NodeVersion;
    getVersion(): NodeVersion;
    hashShared(): Buffer;
    getHashedValue(field: string): string | undefined;
    hash0(): Buffer;
    hash1(): Buffer;
    verifyWork(): boolean;
    solveWork(): void;
    getId(): Buffer | undefined;
    setParentId(parentId: Buffer | undefined): void;
    getParentId(): Buffer | undefined;
    setCopiedParentId(parentId: Buffer | undefined): void;
    getCopiedParentId(): Buffer | undefined;
    setCopiedId1(id1: Buffer | undefined): void;
    getCopiedId1(): Buffer | undefined;
    setCopiedSignature(signature: Buffer | undefined): void;
    getCopiedSignature(): Buffer | undefined;
    setConfig(config: number): void;
    getConfig(): number | undefined;
    isLeaf(): boolean;
    setLeaf(isLeaf?: boolean): void;
    setPublic(isPublic?: boolean): void;
    isPublic(): boolean;
    setLicensed(isLicensed?: boolean): void;
    isLicensed(): boolean;
    hasRightsByAssociation(): boolean;
    setHasRightsByAssociation(hasRightsByAssociation: boolean): void;
    isCopy(): boolean;
    copy(parentId?: Buffer): NodeInterface;
    getCopiedNode(): NodeInterface | undefined;
    isPrivate(): boolean;
    setAllowEmbed(allowEmbed?: boolean): void;
    allowEmbed(): boolean;
    setAllowEmbedMove(allowEmbedMove?: boolean): void;
    allowEmbedMove(): boolean;
    setUnique(isUnique?: boolean): void;
    isUnique(): boolean;
    setDifficulty(difficulty: number): void;
    getDifficulty(): number | undefined;
    setChildMinDifficulty(difficulty: number): void;
    getChildMinDifficulty(): number | undefined;
    setDisallowParentLicensing(disallow: boolean): void;
    disallowParentLicensing(): boolean;
    setOnlyOwnChildren(onlyOwn: boolean): void;
    onlyOwnChildren(): boolean;
    setDisallowPublicChildren(noPublicChildren: boolean): void;
    disallowPublicChildren(): boolean;
    setBubbleTrigger(bubbleTrigger: boolean): void;
    bubbleTrigger(): boolean;
    setNonce(nonce: Buffer | undefined): void;
    getNonce(): Buffer | undefined;
    setCertObject(cert: PrimaryNodeCertInterface | undefined): void;
    getCertObject(): PrimaryNodeCertInterface;
    isEmbeddedTypeAccepted(embeddedType: Buffer): boolean;
    hasEmbedded(): boolean;
    setEmbedded(embedded: Buffer | undefined): void;
    getEmbedded(): Buffer | undefined;
    getEmbeddedObject(): DataModelInterface;
    setEmbeddedObject(node: DataModelInterface | undefined): void;
    embed(targetPublicKey: Buffer, creationTime?: number): NodeInterface | undefined;
    hashTransient(): Buffer;
    hasTransient(): boolean;
    checkFilters(filters: Filter[]): boolean;
    canSendEmbedded(sourcePublicKey: Buffer, targetPublicKey: Buffer): boolean;
    canSendPrivately(sourcePublicKey: Buffer, targetPublicKey: Buffer): boolean;
    canReceivePrivately(sourcePublicKey: Buffer, targetPublicKey: Buffer): boolean;
    setRefId(refId: Buffer | undefined): void;
    getRefId(): Buffer | undefined;
    hasBlob(): boolean;
    setBlobLength(blobLength: bigint | undefined): void;
    getBlobLength(): bigint | undefined;
    setBlobHash(blobHash: Buffer | undefined): void;
    getBlobHash(): Buffer | undefined;
    calcId2(): Buffer;
    getId2(): Buffer | undefined;
    setId2(id2: Buffer | undefined): void;
    isId2Original(): boolean;
    setOnlineIdNetwork(onlineIdNetwork: Buffer | undefined): void;
    getOnlineIdNetwork(): Buffer | undefined;
    hasOnlineId(): boolean;
    setBeginRestrictiveWriteMode(restrictiveWriterMode?: boolean): void;
    isBeginRestrictiveWriteMode(): boolean;
    setEndRestrictiveWriteMode(endRestrictiveWriterMode?: boolean): void;
    isEndRestrictiveWriteMode(): boolean;
    usesParentLicense(): boolean;
    setLicenseMinDistance(distance: number): void;
    getLicenseMinDistance(): number;
    setLicenseMaxDistance(distance: number): void;
    getLicenseMaxDistance(): number;
    getLicensingHashes(ownerPublicKey?: Buffer, targetPublicKey?: Buffer, otherParentId?: Buffer): Buffer[];
    getLicenseTypes(): Buffer[];
    setParams(params: NodeParams): void;
    getParams(): NodeParams;
    checkJurisdiction(jurisdiction: string): boolean;
    checkRegion(jurisdiction: string): boolean;
    getRegion(): string | undefined;
    setRegion(region: string | undefined): void;
    getJurisdiction(): string | undefined;
    setJurisdiction(region: string | undefined): void;
    setTransientStorageTime(transientStorageTime: number | undefined): void;
    getTransientStorageTime(): number | undefined;
}
