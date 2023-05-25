import {
    KeyPair,
    Signature,
} from "../node/primary/node/types";

/**
 * This is the common interface for all nodes and all certs.
 */
export interface DataModelInterface {
    load(image: Buffer, preserveTransient: boolean): void;
    export(exportTransient?: boolean, exportTransientNonHashable?: boolean): Buffer;
    validate(deepValidate?: number, timeMS?: number): [boolean, string];
    sign(keyPair: KeyPair, deepValidate?: boolean): void;
    enforceSigningKey(publicKey: Buffer): void;
    hash(): Buffer;
    verify(): boolean;
    extractSignatures(): Signature[];
    getSignatures(): Signature[];
    getEligibleSigningPublicKeys(onlyNonUsed?: boolean): Buffer[];
    getType(length?: number): Buffer;
    getCrypto(): string;
    setOwner(owner: Buffer | undefined): void;
    getOwner(): Buffer | undefined;
    setCreationTime(creationTime: number | undefined): void;
    getCreationTime(): number | undefined;
    setExpireTime(expireTime: number | undefined): void;
    getExpireTime(): number | undefined;
    isDynamic(): boolean;
    isDynamicActive(): boolean;
    hasDynamicSelf(): boolean;
    setHasDynamicSelf(isDynamic?: boolean): void;
    isDynamicSelfActive(): boolean;
    setDynamicSelfActive(isActive?: boolean): void;
    isDynamicDestroyed(): boolean;
    setDynamicDestroyed(isDestroyed?: boolean): void;
    isCertTypeAccepted(certType: Buffer): boolean;
    setHasDynamicCert(hasDynamicCert?: boolean): void;
    hasDynamicCert(): boolean;
    isDynamicCertActive(): boolean;
    updateDynamicStatus(): void;
    getTransientConfig(): number | undefined;
    setTransientConfig(transientConfig: number | undefined): void;
    setCertObject(cert: unknown | undefined): void;
    getCertObject(): unknown;
    setCert(cert: Buffer | undefined): void;
    getCert(): Buffer | undefined;
    hasCert(): boolean;
    extractDynamicObjects(): DataModelInterface[];
    setSignature(packedSignature: Buffer | undefined): void;
    addSignature(signature: Buffer, publicKey: Buffer): void;
    getSignature(): Buffer | undefined;
    calcId1(): Buffer;
    getId1(): Buffer | undefined;
    setId1(id1: Buffer): void;
    getAchillesHashes(): Buffer[];
    isIndestructible(): boolean;
    setIndestructible(isIndestructible?: boolean): void;
    getParams(): object;
    setParams(params: object): void;
    toString(short?: boolean): string;
}
