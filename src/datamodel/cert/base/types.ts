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
    transientConfig?: number,
    hasOnlineValidation?: boolean,
    hasOnlineCert?: boolean,
    isIndestructible?: boolean,
    isOnlineValidated?: boolean,
    isOnlineRevoked?: boolean,
    isOnlineCertOnline?: boolean,
};

export const BaseCertSchema = {
    "modelType??": new Uint8Array(0),
    "id1??": new Uint8Array(0),
    "owner??": new Uint8Array(0),
    "targetPublicKeys??": [new Uint8Array(0)],
    "config??": 0,
    "lockedConfig??": 0,
    "creationTime??": 0,
    "expireTime??": 0,
    "cert??": new Uint8Array(0),
    "constraints??": new Uint8Array(0),
    "targetType??": new Uint8Array(0),
    "maxChainLength??": 0,
    "signature??": new Uint8Array(0),
    "signingPublicKeys??": [new Uint8Array(0)],
    "multiSigThreshold??": 0,
    "targetMaxExpireTime??": 0,
    "transientConfig??": 0,
    "hasOnlineValidation??": false,
    "hasOnlineCert??": false,
    "isIndestructible??": false,
    "isOnlineValidated??": false,
    "isOnlineRevoked??": false,
    "isOnlineCertOnline??": false,
    _postFn: function(baseCertParams: BaseCertParams): BaseCertParams {
        if (typeof baseCertParams.expireTime === "number" && baseCertParams.expireTime < 0) {
            baseCertParams.expireTime = Date.now() -baseCertParams.expireTime;
        }

        return baseCertParams;
    }
} as const;

/**
 * Config bits for base cert class.
 */
export enum BaseCertConfig {
    /**
     * The cert itself needs to be validated online.
     *
     * The validator process will examine the properties of the cert to determine
     * how and where the validation takes place.
     *
     * This property also opens up for having certs being revoked online.
     *
     * A cert can have three states:
     * 1. not validated or revoked (unknown),
     * 2. validated (allowed to be toggled on/off),
     * 3. revoked (overrides validated, and not allowed to return to the validated state).
     */
    HAS_ONLINE_VALIDATION   = 0,

    /**
     * If a cert is embedding a cert which is online then this bit must be set.
     */
    HAS_ONLINE_CERT         = 1,

    /**
     * If set then the cert cannot be destroyed by destruction nodes.
     */
    IS_INDESTRUCTIBLE       = 2,
}

//eslint-disable-next-line @typescript-eslint/no-unused-vars
enum BaseCertLockedConfig {}

/**
 * Transient bits set by the outside on base cert level.
 */
export enum BaseCertTransientConfig {
    ONLINE_VALIDATED    = 0,

    ONLINE_REVOKED      = 1,

    /**
     * Set to true on certs who uses an online cert when the
     * online cert is online.
     */
    ONLINE_CERT_ONLINE  = 2,
}
