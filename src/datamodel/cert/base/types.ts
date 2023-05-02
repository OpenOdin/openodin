/** Base params of a cert. */
export type BaseCertParams = {
    modelType?: Buffer,
    id1?: Buffer,
    owner?: Buffer,
    targetPublicKeys?: Buffer[],
    config?: number,
    lockedConfig?: number,
    creationTime?: number,
    expireTime?: number,
    cert?: Buffer
    constraints?: Buffer,
    targetType?: Buffer,
    maxChainLength?: number,
    signature?: Buffer,
    signingPublicKeys?: Buffer[],  // Only set on getParams. Used internally between certs.
    multiSigThreshold?: number,
    targetMaxExpireTime?: number,
    dynamicSelfSpec?: Buffer,
    transientConfig?: number,
    hasDynamicSelf?: boolean,
    hasDynamicCert?: boolean,
    isIndestructible?: boolean,
    isDynamicSelfActive?: boolean,
    isDynamicCertActive?: boolean,
    isDynamicDestroyed?: boolean,
};

/**
 * Config bits for base cert class.
 */
export enum BaseCertConfig {
    /**
     * The cert it self needs to be validated externally (online).
     */
    HAS_DYNAMIC_SELF    = 0,

    /**
     * If a cert is embedding a cert which is dynamic then this bit must be set.
     */
    HAS_DYNAMIC_CERT    = 1,

    /**
     * If set then the cert cannot be destroyed by destruction nodes.
     */
    IS_INDESTRUCTIBLE   = 2,
}

export enum BaseCertLockedConfig {}

/**
 * Transient bits set by the outside on base cert level.
 */
export enum BaseCertTransientConfig {
    /** Set if this cert is dynamic and active. */
    DYNAMIC_SELF_ACTIVE = 0,

    /**
     * Set to true on certs who uses a dynamic Cert when the
     * dynamic cert is active (transient value not stored).
     */
    DYNAMIC_CERT_ACTIVE  = 1,

    /** Set if this cert is dynamic and destroyed. */
    DYNAMIC_DESTROYED   = 2,
}
