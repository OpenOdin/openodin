import {
    Model,
    ModelType,
    Fields,
    FieldType,
} from "../../model";

import {
    KeyPair,
    Signature,
} from "../../types";

import {
    Crypto,
} from "../../Crypto";

import {
    Hash,
} from "../../hash";

import {
    SPECIAL_NODES,
} from "../../node/secondary/data/types"

import {
    DataModelInterface,
} from "../../interface/DataModelInterface";

import {
    BaseCertInterface,
} from "./interface/BaseCertInterface";

import {
    BaseCertParams,
    BaseCertConfig,
    BaseCertTransientConfig,
} from "./types";

import {
    CopyBuffer,
} from "../../../util/common";


/**
 * The model fields for a certificate.
 */
const FIELDS: Fields = {
    /**
     * The public key of the owner of this cert.
     *
     * This key must be the same public key as the signing keypair.
     *
     * This field is not set when using a cert because then the embedded cert's
     * targetPublicKeys are the public keys allowed to sign and the owner is the issuer
     * public key of the cert (always the first cert in the stack of certs).
     */
    owner: {
        name: "owner",
        type: FieldType.BYTES,
        maxSize: 32,
        index: 0,
    },

    /**
     * A cert is meant to give authority to another public key, which are the targetPublicKeys.
     *
     * If this cert is embedded into another cert then the embedding cert's signer
     * public key must match one of these targetPublicKeys.
     *
     * If the cert is a "top cert" then one of the targetPublicKeys must match a specific key
     * in the target data model.
     *
     * Public keys are always prefixed with the length of the publicKey.
     */
    targetPublicKeys: {
        name: "targetPublicKeys",
        type: FieldType.BYTES,
        maxSize: 33*3,
        index: 1,
    },

    /**
     * These are config bits used by the certs.
     * If is a shared bit space and each cert type implementation can add bits of their own.
     */
    config: {
        name: "config",
        type: FieldType.UINT8,
        index: 2,
    },

    /**
     * These are config bits used by the certs to flag what properties are locked in constraints.
     * If is a shared bit space and each cert type implementation can add bits of their own.
     */
    lockedConfig: {
        name: "lockedConfig",
        type: FieldType.UINT24BE,
        index: 3,
    },

    /**
     * The UNIX creation time of this cert, from when it is valid.
     * When validating the target the creationTime of the target cannot be before this creationTime.
     * Note: stored in seconds not milliseconds.
     */
    creationTimeSeconds: {
        name: "creationTimeSeconds",
        type: FieldType.UINT32BE,
        index: 4,
    },

    /**
     * The UNIX expire time of this cert, after this it is not valid anymore.
     * When validating the target the creationTime of the target cannot be after this creationTime.
     *
     * Note that the interval creationTimeSeconds to expireTimeSeconds dictates when an embedding
     * cert must have its creationTime.
     * The expireTimeSeconds of an embedding cert is not restricted by the embedded cert's expireTimeSeconds,
     * restrictions in the embedding cert's expireTimeSeconds is instead restricted by the targetMaxExpireTimeSeconds field.
     *
     * Note: stored in seconds not milliseconds.
     */
    expireTimeSeconds: {
        name: "expireTimeSeconds",
        type: FieldType.UINT32BE,
        index: 5,
    },

    /** If this cert is embedding another cert then that exported cert is set here. */
    cert: {
        name: "cert",
        type: FieldType.BYTES,
        index: 6,
        maxSize: 1066,
    },

    /**
    * Constraints is a way for cert issuers to limit the validness of a cert
    * If constraints is set in a cert then the target must have the same constraints.
    * If the target is another cert then the target must have constraints set,
    * if the target is some other data (a node or something else) then the cert
    * will calculate constraints on the target and compare it with what it has set.
    *
    * Constraints are a hash over a specific set of locked on properties of the target.
    *
    * In short, the embedded cert calculates the constraints on the target (embedding) cert
    * and that must equal the constraints set on the embedded cert.
    */
    constraints: {
        name: "constraints",
        type: FieldType.BYTE32,
        index: 7,
    },

    /**
     * Force 0 to 6 bytes of next targets cert's or object's model type to match.
     * This is used for certs to limit which other certs can embedd them
     * or for certs to limit what node types can use them.
     */
    targetType: {
        name: "targetType",
        type: FieldType.BYTES,
        maxSize: 6,
        index: 8,
    },

    /**
     * The maximum count of certs allowed to be chained together.
     * If set any target cert must have it set to a lower value.
     * If set it cannot exceed the number of certs stacked together,
     * the value 1 means a single cert which cannot be embedded nor embed any cert it self.
     */
    maxChainLength: {
        name: "maxChainLength",
        type: FieldType.UINT8,
        index: 9,
    },

    /**
     * Cert must be signed by owner public key,
     * or by targetPublicKeys referenced in an embedded cert.
     * We allow 3 signatures for multisig certs.
     * Each signature is prefixed by a byte telling the index of the public key it matches.
     */
    signature: {
        name: "signature",
        type: FieldType.BYTES,
        maxSize: 3 * (Crypto.MAX_SIGNATURE_LENGTH + 1),
        index: 10,
        hash: false,
    },

    /**
     * If set then any target cert must have it set to the same or lower.
     * A target object (node or something else) will be limited on its expire time if this is set.
     */
    targetMaxExpireTimeSeconds: {
        name: "targetMaxExpireTimeSeconds",
        type: FieldType.UINT32BE,
        index: 11,
    },

    /** Transient values to keep track of online properties. */
    transientConfig: {
        name: "transientConfig",
        type: FieldType.UINT16BE,
        index: 19,
        transient: true,
    },

    multiSigThreshold: {
        name: "multiSigThreshold",
        type: FieldType.UINT8,
        index: 20,
    },
};

/**
 * A base abstract Certificate.
 */
export abstract class BaseCert implements BaseCertInterface {
    protected model: Model;
    protected cachedCertObject: BaseCertInterface | undefined;

    /**
     * Deriving classes have to provide this constructor with their data model type
     * as first argument.
     *
     * @param modelType identifies this model type
     * @param handshakeFields specifies model fields property
     */
    constructor(modelType: ModelType, extraFields?: Fields) {
        extraFields = extraFields ?? {};
        const fields = {...FIELDS, ...extraFields};
        this.model = new Model(modelType, fields);
        this.setConfig(0);
    }

    /**
     * @param length optional number of bytes of the cert type to return.
     * @returns the cert's model type.
     */
    public static GetType(length?: number): Buffer {  //eslint-disable-line @typescript-eslint/no-unused-vars
        throw new Error("Not implemented");
    }

    /**
     * @param length optional number of bytes of the cert type to return.
     * @returns the cert's model type.
     */
    public abstract getType(length?: number): Buffer;

    /**
     * Check if given cert type is accepted to be embedded.
     * @param certType as 2 to 4 byte buffer for primary+secondary interfaces.
     * @returns true if the provided cert type is accepted.
     */
    public abstract isCertTypeAccepted(certType: Buffer): boolean;

    /**
     * Load model image Buffer.
     *
     * @param image image data to load
     *
     * @throws a string containing a message error when image load fails to decode or access the decoded input Buffer.
     */
    public load(image: Buffer) {
        this.model.load(image);
    }

    /**
     * @param exportTransient if true then also export fields marked as transient.
     * @param exportTransientNonHashable if true then also export transient non hashable fields (requires exportTransient is true).
     * @returns exported data Buffer
     *
     * @throws a string containing a message error when unable to export the data model or any ambedded data model.
     */
    public export(exportTransient: boolean = false, exportTransientNonHashable: boolean = false): Buffer {
        if (this.cachedCertObject) {
            this.setCert(this.cachedCertObject.export());
        }
        return this.model.export(exportTransient, exportTransientNonHashable);
    }

    /**
     * Validate certificate.
     *
     * @param deepValidate if 1 (default) then also recursively deep validate embedded certs.
     * If the cert cannot unpack the stack it self then use the Decoder to unpack it prior to
     * running a deep validation.
     * If 2 then validate but skip anything which involves signatures (used if node is not fully signed yet).
     * if 0 do not deep validate.
     * @param timeMS if provided then the certificate is also checked to be valid at the time given by timeMS.
     * @returns a tuple specifying whether the Cert is valid or not, accompanied by an error message string when applicable.
     */
    public validate(deepValidate: number = 1, timeMS?: number): [boolean, string] {
        // Export the data to have the model check for basic issues
        try {
            this.model.export();
        }
        catch(e) {
            const msg = `Failure during model export in BaseCert: ${e}`;
            return [false, msg];
        }

        const creationTime = this.getCreationTime();
        const expireTime = this.getExpireTime();

        if (creationTime === undefined || expireTime === undefined) {
            return [false, "Both creationTime and expireTime must be set"];
        }

        if (expireTime < creationTime) {
            return [false, "expireTime cannot be smaller than creationTime"];
        }

        if (timeMS !== undefined && expireTime <= timeMS) {
            return [false, "Cert has expired"];
        }

        if (timeMS !== undefined && creationTime > timeMS) {
            return [false, "Cert is not yet valid in time"];
        }

        const config = this.model.getNumber("config");
        if (config === undefined) {
            return [false, "Missing config bits"];
        }

        const maxChainLength = this.getMaxChainLength();
        if (maxChainLength !== undefined) {
            if (maxChainLength < 0) {
                return [false, "maxChainLength cannot lesser than zero"];
            }
        }

        if (this.getOwner() === undefined) {
            // If owner is not set then there must be a cert.
            if (!this.hasCert()) {
                return [false, "owner must be set"];
            }
        }
        else {
            // Owner is set then no cert is allowed.
            if (this.hasCert()) {
                return [false, "owner cannot be set if using a cert (owner then is the cert's targetPublicKeys)"];
            }
        }

        const targetPublicKeys = this.getTargetPublicKeys();
        if (targetPublicKeys.length === 0) {
            return [false, "targetPublicKeys must be set"];
        }

        try {
            const publicKeys = this.getTargetPublicKeys();
            const multiSigThreshold = this.getMultiSigThreshold();
            if (multiSigThreshold === undefined) {
                if (publicKeys.length > 1) {
                    return [false, "When using multisig multiSigThreshold must be set"];
                }
            }
            else {
                if (multiSigThreshold <= 0) {
                    return [false, "multiSigThreshold cannot be set to zero or less"];
                }

                if (multiSigThreshold > publicKeys.length) {
                    return [false, "multiSigThreshold cannot be greater than total number of keys"];
                }

                if (multiSigThreshold === publicKeys.length && multiSigThreshold === 1) {
                    return [false, "multiSigThreshold should not be set when targetPublicKeys is of length 1"];
                }
            }
        }
        catch(e) {
            return [false, `Could not validate: ${(e as Error).message}`];
        }

        if (deepValidate > 0) {
            if (!this.hasCert()) {
                if (deepValidate === 1) {
                    try {
                        if (this.getSignatures().length !== 1) {
                            return [false, "Exactly one signature expected"];
                        }
                    }
                    catch(e) {
                        return [false, "Could not get signatures"];
                    }
                }
            }

            if (this.hasCert()) {
                let cert;
                try {
                    cert = this.getCertObject();
                }
                catch(e) {
                    return [false, "Cert cannot be decoded"];
                }
                const val = cert.validate(deepValidate, timeMS);
                // Return tuple as is in case of invalid certificate
                if (!val[0]) {
                    return val;
                }

                if (deepValidate === 1) {
                    const multiSigThreshold = cert.getMultiSigThreshold() ?? 1;
                    try {
                        if (this.getSignatures().length !== multiSigThreshold) {
                            return [false, "Wrong nr of signatures"];
                        }
                    }
                    catch(e) {
                        return [false, "Could not get signatures"];
                    }
                }

                // Check that this cert accepts the interface (or exact type) of the embedded certificate.
                if (!this.isCertTypeAccepted(cert.getType())) {
                    return [false, "Cert does not accept the embedded cert's type"];
                }

                // Check so online configurations match.
                //
                if (!this.hasOnlineCert()) {
                    if (cert.hasOnline()) {
                        return [false, "When an embedded cert is flagged as online the cert is required to have its hasOnlineCert flag set"];
                    }
                }

                const val2 = cert.validateAgainstTarget(this.getParams(), deepValidate);
                // Return tuple as is in case of invalid certificate
                if (!val2[0]) {
                    return val2;
                }
            }
        }

        return [true, ""];
    }

    /**
     * Count the number of certs stacked together (including this one).
     * @return nr of certs in total.
     */
    public countChainLength(): number {
        let count = 0;
        let cert: BaseCertInterface = this as BaseCertInterface;
        while (true) {
            count++;
            if (cert.hasCert()) {
                cert = cert.getCertObject();
            }
            else {
                break;
            }
        }
        return count;
    }

    /**
     * Sign the cert in place.
     *
     * The owner public key must match the signing public key,
     * if using cert then the signing key must match one of the targetPublicKeys in the cert.
     *
     * @param keyPair key pair used for signing.
     *
     * @throws if validation or signing fails.
     */
    public sign(keyPair: KeyPair, deepValidate: boolean = true) {
        const val = this.validate(deepValidate ? 2 : 0);

        if (!val[0]) {
            throw new Error(`Could not validate cert prior to signing: ${val[1]}`);
        }

        if (this.calcSignaturesNeeded() <= 0) {
            throw new Error("No more signatures expected");
        }

        // Will throw if mismatch is detected.
        this.enforceSigningKey(keyPair.publicKey);

        // Throws on badly formatted input.
        let message: Buffer = this.hash();

        // hash with existing signatures and their public keys
        const signatures: Signature[] = this.getSignatures();

        if (signatures.length > 0) {
            const signature = signatures[signatures.length - 1];

            message = Hash([signature.message, signature.publicKey, signature.signature,
                signature.index]);
        }

        const signature = Crypto.Sign(message, keyPair);

        this.addSignature(signature, keyPair.publicKey);
    }

    /**
     * Validate that the signing key matches the/an owner.
     *
     * @param publicKey The signing public key
     *
     * @returns the index of the targetPublicKey matching the signing publicKey
     * @throws if a mismatch is detected or targetPublicKeys cannot be retrieved from cert.
     */
    public enforceSigningKey(publicKey: Buffer): number {
        const index = this.getEligibleSigningPublicKeys().
            findIndex( targetPublicKey => targetPublicKey.equals(publicKey) );

        if (index === -1) {
            throw new Error("Signing key must match one of the eligible signing keys.");
        }

        return index;
    }

    /**
     * @returns hash of the model
     **/
    public hash(): Buffer {
        // Make sure cached cert object is properly set as cert image
        if (this.cachedCertObject && !this.getCert()) {
            this.setCert(this.cachedCertObject.export());
        }

        return this.model.hash();
    }

    /**
     * Verify the integrity of this cert and any embedded certs.
     * After a successful signature verification it also runs a deep validation.
     *
     * @returns true if cert cryptographically deep verifies and deep validates.
     * @throws on malformed input.
     */
    public verify(): boolean {
        if (this.hasCert()) {
            try {
                const cert = this.getCertObject();
                if (!cert.verify()) {
                    return false;
                }
            }
            catch(e) {
                return false;
            }
        }

        const signatures: Signature[] = this.getSignatures();

        for (let i=0; i<signatures.length; i++) {
            const signature = signatures[i];

            if (!Crypto.Verify(signature)) {
                return false;
            }
        }

        const val = this.validate();

        if (val[0]) {
            return true;
        }

        return false;
    }

    /**
     * Returns hash of the hash and the signature to produce an unique id for this cert.
     * Note that this id is not stored in the datamodel, but has to be computed if needed.
     * It is called calcId1 and not simply calcId() to conform with the general DataModel interface.
     *
     * @returns the cryptographic id of the cert.
     * @throws an error message when unable to retrieve signature
     **/
    public calcId1(): Buffer {
        const signature = this.getSignature();
        if (!signature) {
            throw new Error("Missing signature when calculating id");
        }
        return Hash([this.hash(), signature]);
    }

    /*
     * To save storage space certs do not store their id1, it is calculated when asked for.
     * @returns the cryptographic id of the cert.
     */
    public getId1(): Buffer | undefined {
        const signature = this.getSignature();
        if (!signature) {
            return undefined;
        }
        return this.calcId1();
    }

    /**
     * This does nothing on certs, the id1 is recalculated on each getId1() call.
     * Function implented here to conform to the general data model structure.
     * To save storage space certs do not store their id1, it is calculated when asked for.
     */
    public setId1(id1: Buffer) {  //eslint-disable-line @typescript-eslint/no-unused-vars
        // Do nothing
    }

    /**
     * Recursively extract all signatures from this cert and all embedded certs.
     * @returns list of signatures to be verified.
     * @throws on unexpected missing or malformed data,
     * such as the cert object not being cached and if it cannot be decoded locally.
     */
    public extractSignatures(): Signature[] {
        const signatures: Signature[] = [];

        if (this.hasCert()) {
            const cert = this.getCertObject();
            signatures.push(...cert.extractSignatures());
        }

        signatures.push(...this.getSignatures());

        return signatures;
    }

    /**
     * @returns config integer.
     */
    public getConfig(): number | undefined {
        return this.model.getNumber("config");
    }

    /**
     * Set the config integer, these are however best set using the setter functions provided.
     * @param config integer.
     */
    public setConfig(config: number | undefined) {
        this.model.setNumber("config", config);
    }

    public setMultiSigThreshold(multiSigThreshold: number | undefined) {
        this.model.setNumber("multiSigThreshold", multiSigThreshold);
    }

    public getMultiSigThreshold(): number | undefined {
        return this.model.getNumber("multiSigThreshold");
    }

    /**
     * Set a bit in the config integer.
     *
     * @param index the bit index in the integer.
     * @param isSet state to set the bit to.
     */
    protected setConfigBit(index: number, isSet: boolean) {
        const mask = 1 << index;
        const config = this.model.getNumber("config") || 0;
        if (isSet) {
            this.model.setNumber("config", config | mask);
        }
        else {
            this.model.setNumber("config", config & ~mask);
        }
    }

    /**
     * @param index the bit index to read in the configuration integer.
     * @returns the state of the configuration bit.
     */
    public isConfigBitSet(index: number): boolean {
        const config = this.model.getNumber("config") || 0;
        return Boolean(config & (2**index));
    }

    /**
     * @returns locked config integer.
     */
    public getLockedConfig(): number | undefined {
        return this.model.getNumber("lockedConfig");
    }

    /**
     * Set the locked config integer, these are however best set using the setter functions provided.
     * @param locked config integer.
     */
    public setLockedConfig(lockedConfig: number | undefined) {
        this.model.setNumber("lockedConfig", lockedConfig);
    }

    /**
     * Set a bit in the locked config integer.
     *
     * @param index the bit index in the integer.
     * @param isSet state to set the bit to.
     */
    protected setLockedConfigBit(index: number, isSet: boolean) {
        const mask = 1 << index;
        const config = this.model.getNumber("lockedConfig") || 0;
        if (isSet) {
            this.model.setNumber("lockedConfig", config | mask);
        }
        else {
            this.model.setNumber("lockedConfig", config & ~mask);
        }
    }

    /**
     * @param index the bit index to read in the locked configuration integer.
     * @returns the state of the locked configuration bit.
     */
    public isLockedConfigBitSet(index: number): boolean {
        const config = this.model.getNumber("lockedConfig") || 0;
        return Boolean(config & (2**index));
    }

    /**
     * @returns transient config integer.
     */
    public getTransientConfig(): number | undefined {
        return this.model.getNumber("transientConfig");
    }

    /**
     * Set the transient config integer, these are however best set using the setter functions provided.
     * @param transient config integer.
     */
    public setTransientConfig(transientConfig: number | undefined) {
        this.model.setNumber("transientConfig", transientConfig);
    }

    /**
     * Set a bit in the transient state integer.
     *
     * @param index the bit index in the integer.
     * @param isSet state to set the bit to.
     */
    protected setTransientBit(index: number, isSet: boolean) {
        const mask = 1 << index;
        const config = this.model.getNumber("transientConfig") || 0;
        if (isSet) {
            this.model.setNumber("transientConfig", config | mask);
        }
        else {
            this.model.setNumber("transientConfig", config & ~mask);
        }
    }

    /**
     * @param index the bit index to read in the transient integer.
     * @returns the state of the configuration bit.
     */
    protected isTransientBitSet(index: number): boolean {
        const config = this.model.getNumber("transientConfig") || 0;
        return Boolean(config & (2**index));
    }

    /**
     * Set to have the cert being validated online.
     *
     * @param hasOnlineValidation
     */
    public setHasOnlineValidation(hasOnlineValidation: boolean = true) {
        this.setConfigBit(BaseCertConfig.HAS_ONLINE_VALIDATION, hasOnlineValidation);
    }

    /**
     * Return true if this cert used online validation.
     *
     * @returns true if using online validation.
     */
    public hasOnlineValidation(): boolean {
        return this.isConfigBitSet(BaseCertConfig.HAS_ONLINE_VALIDATION);
    }

    /**
     * If this cert is embedding any online cert then this property must be set to true.
     * @param hasOnlineCert
     */
    public setHasOnlineCert(hasOnlineCert: boolean = true) {
        this.setConfigBit(BaseCertConfig.HAS_ONLINE_CERT, hasOnlineCert);
    }

    /**
     * Returns true if this cert is set to having embedded any online cert
     * (could be anywhere in the stack).
     *
     * @returns true if cert uses any online cert.
     */
    public hasOnlineCert(): boolean {
        return this.isConfigBitSet(BaseCertConfig.HAS_ONLINE_CERT);
    }

    /**
     * Set to true to make the cert in it self indestructable in regards
     * to offline destruction nodes.
     * @params isIndestructible
     */
    public setIndestructible(isIndestructible: boolean = true) {
        this.setConfigBit(BaseCertConfig.IS_INDESTRUCTIBLE, isIndestructible);
    }

    /**
     * Check if this cert is marked as being indestructible by offline destruction nodes.
     * An indestructible cert might still be destructed if any embedded cert is destroyed.
     * @returns true if cert is flagged as indestructible.
     */
    public isIndestructible(): boolean {
        return this.isConfigBitSet(BaseCertConfig.IS_INDESTRUCTIBLE);
    }

    /**
     * @returns true if this cert it self or any embedded cert is validated online.
     */
    public hasOnline(): boolean {
        return this.hasOnlineValidation() || this.hasOnlineCert();
    }


    /**
     * Check for online features and returns false if any of the fetures are not online.
     * @returns true if the cert is online.
     */
    public isOnline(): boolean {
        if (this.hasOnlineValidation() && !this.isOnlineValidated()) {
            return false;
        }
        if (this.hasOnlineCert() && !this.isOnlineCertOnline()) {
            return false;
        }
        return true;
    }

    /**
     * If this cert uses an online cert and that cert is valid then this function returns true.
     *
     * This is a transient value set by the environment by calling updateOnlineStatus().
     *
     * @returns whether or not the cert has valid online certs.
     */
    public isOnlineCertOnline(): boolean {
        return this.isTransientBitSet(BaseCertTransientConfig.ONLINE_CERT_ONLINE);
    }

    protected setOnlineCertOnline(isOnline: boolean = true) {
        this.setTransientBit(BaseCertTransientConfig.ONLINE_CERT_ONLINE, isOnline);
    }

    public updateOnlineStatus() {
        if (this.hasOnlineCert()) {
            const cert = this.getCertObject();
            cert.updateOnlineStatus();

            if (cert.isOnlineRevoked()) {
                // Non reversibly set.
                this.setOnlineRevoked();  // Revoke this cert if embedded cert is revoked.
                this.setOnlineCertOnline(false);
            }
            else {
                const status = cert.isOnline();
                this.setOnlineCertOnline(status);
            }
        }
    }

    /**
     * Set the online validation transient bit for this cert.
     *
     * The environment is responsible for setting this.
     *
     * @param onlineValidated state to be set
     */
    public setOnlineValidated(onlineValidated: boolean = true) {
        this.setTransientBit(BaseCertTransientConfig.ONLINE_VALIDATED, onlineValidated);
    }

    /**
     * Check if transient online validated bit is set, unless the revoked bit is set.
     *
     * The environment is responsible for setting this.
     *
     * @returns true if this cert has been validated online (and not revoked online).
     */
    public isOnlineValidated(): boolean {
        if (this.isOnlineRevoked()) {
            return false;
        }

        return this.isTransientBitSet(BaseCertTransientConfig.ONLINE_VALIDATED);
    }

    /**
     * Set the online revoked transient bit for this cert.
     *
     * The environment is responsible for setting this.
     *
     * @param onlineRevoked state to be set
     */
    public setOnlineRevoked(onlineRevoked: boolean = true) {
        this.setTransientBit(BaseCertTransientConfig.ONLINE_REVOKED, onlineRevoked);
    }

    /**
     * Check if transient online revoked bit is set.
     *
     * The environment is responsible for setting this.
     *
     * @returns true if this cert has been revoked online.
     */
    public isOnlineRevoked(): boolean {
        return this.isTransientBitSet(BaseCertTransientConfig.ONLINE_REVOKED);
    }

    /**
     * Extract all online objects in this cert, recursively.
     * This is used by the environment to assess if this cert is valid/revoked.
     * @returns list of online objects.
     */
    public extractOnlineObjects(): DataModelInterface[] {
        const objects: DataModelInterface[] = [];
        if (this.hasOnlineValidation()) {
            objects.push(this);
        }
        if (this.hasOnlineCert()) {
            try {
                const cert = this.getCertObject();
                objects.push(...cert.extractOnlineObjects());
            }
            catch(e) {
                return [];
            }
        }
        return objects;
    }

    /**
     * Set the owner of this cert (the one also signing).
     * Only set this is not using a cert. If using cert the signer must match
     * one of the public keys in the cert's targetPublicKeys array.
     * @param owner public key of cert owner.
     */
    public setOwner(owner: Buffer | undefined) {
        this.model.setBuffer("owner", owner);
    }

    /**
     * The the owner of this certificate which is also the signer.
     * This is the public key of the signing key pair.
     * This can only be set when not using a cert.
     * If using a cert get the owners as getEligibleSigningPublicKeys().
     *
     * @returns owner public key (when not using cert).
     */
    public getOwner(): Buffer | undefined {
        return this.model.getBuffer("owner");
    }

    /**
     * Signature can be set from the outside if using a signature offloader,
     * otherwise call sign() to sign.
     * @param signature the cryptographic signature.
     */
    public setSignature(signature: Buffer | undefined) {
        this.model.setBuffer("signature", signature);
    }

    /**
     * @returns the signature
     */
    public getSignature(): Buffer | undefined {
        return this.model.getBuffer("signature");
    }

    /**
     * @throws on malformed data
     */
    public getSignatures(): Signature[] {
        const signature = this.getSignature();

        if (signature === undefined) {
            return [];
        }

        const targetPublicKeys = this.getEligibleSigningPublicKeys();

        // Throws on badly formatted input.
        let message: Buffer = this.hash();

        const signatures: Signature[] = [];

        let rest = CopyBuffer(signature);

        while (rest.length > 0) {
            const index = rest.readUInt8(0);

            const publicKey = targetPublicKeys[index];

            if (publicKey === undefined) {
                throw new Error("Cannot match signature index to targetPublicKey");
            }

            const signatureLength = Crypto.GetSignatureLength(publicKey);

            const signature = rest.slice(1, 1 + signatureLength);

            if (signature.length !== signatureLength) {
                throw new Error("Malformed signature");
            }

            const signatureObject: Signature = {
                message,
                signature,
                publicKey,
                index,
            };

            signatures.push(signatureObject);

            // Hash for the next iteration.
            //
            message = Hash([signatureObject.message, signatureObject.publicKey,
                signatureObject.signature, signatureObject.index]);

            rest = CopyBuffer(rest.slice(signatureLength + 1));
        }

        return signatures;
    }

    public calcSignaturesNeeded(): number {
        let threshold = 1;

        if (this.hasCert()) {
            const certObject = this.getCertObject();
            threshold = certObject.getMultiSigThreshold() ?? 1;
        }

        return threshold - this.getSignatures().length;
    }

    /**
     * @param onlyNonUsed if set to true then only return those who have not signed.
     *
     * @returns all public keys eligible for signing.
     */
    public getEligibleSigningPublicKeys(onlyNonUsed: boolean = false): Buffer[] {
        const targetPublicKeys: Buffer[] = [];

        if (!this.hasCert()) {
            const owner = this.getOwner();

            if (!owner) {
                throw new Error("Expecting owner to be set");
            }

            targetPublicKeys.push(owner);
        }
        else {
            const certObject = this.getCertObject();
            targetPublicKeys.push(...certObject.getTargetPublicKeys());
        }

        if (onlyNonUsed) {
            const signingPublicKeys = this.getSignatures().map( signature => signature.publicKey );
            return targetPublicKeys.filter( publicKey => {
                return signingPublicKeys.findIndex( publicKey2 => publicKey.equals(publicKey2) ) === -1;
            });
        }

        return targetPublicKeys;
    }

    public addSignature(signature: Buffer, publicKey: Buffer) {
        const index = this.getEligibleSigningPublicKeys().findIndex( targetPublicKey => targetPublicKey.equals(publicKey) );

        if (index === -1) {
            throw new Error("Public key not found in targetPublicKeys (or is already used to sign)");
        }

        if (this.getEligibleSigningPublicKeys(true).findIndex( targetPublicKey => targetPublicKey.equals(publicKey) ) === -1) {
            throw new Error("Public key already used to sign with");
        }

        const prefix = Buffer.alloc(1);
        prefix.writeUInt8(index, 0);
        const packed = Buffer.concat([prefix, signature]);
        this.setSignature(Buffer.concat([this.getSignature() ?? Buffer.alloc(0), packed]));
    }

    /**
     * Set the target public keys of this cert.
     * Each public key will be prefixed with its length in the packed data model.
     * @param targetPublicKeys
     */
    public setTargetPublicKeys(targetPublicKeys: Buffer[] | undefined) {
        if (targetPublicKeys === undefined) {
            this.model.setBuffer("targetPublicKeys", undefined);
        }
        else {
            const packed: Buffer[] = [];

            targetPublicKeys.forEach( publicKey => {
                const length = Buffer.alloc(1);
                length.writeUInt8(publicKey.length, 0);
                packed.push(length);
                packed.push(publicKey);
            });

            this.model.setBuffer("targetPublicKeys", Buffer.concat(packed));
        }
    }

    /**
     * Get array of target public keys.
     * For non multisig cert this has one entry,
     * for multisig certs this is an array of multiple public keys allowed to sign.
     * @returns array of target public keys allowed to sign the next cert/node.
     * @throws if targetPublicKey is not set or if 
     */
    public getTargetPublicKeys(): Buffer[] {
        const targetPublicKeys: Buffer[] = [];

        let packed = this.model.getBuffer("targetPublicKeys");

        if (packed === undefined) {
            return [];
        }

        while (packed.length > 0) {
            const length: number = packed.readUInt8(0);

            if (length > packed.length - 1) {
                throw new Error("Badly packed data in targetPublicKeys");
            }

            const targetPublicKey = packed.slice(1, 1 + length);
            targetPublicKeys.push(targetPublicKey);
            packed = packed.slice(1 + length);
        }

        return targetPublicKeys;
    }

    /**
     * @param creationTime UNIX time in milliseconds from when in time this cert is valid valid to use.
     * Note that creationTime is set in milliseconds but stored as seconds meaning
     * that when fetching it back it will be rounded down to the closest second.
     */
    public setCreationTime(creationTime: number) {
        this.model.setNumber("creationTimeSeconds", Math.floor(creationTime/1000));
    }

    /**
     * @returns milliseconds UNIX time from when this cert is valid.
     * Note that the value is rounded down to the second compared to how it was set.
     */
    public getCreationTime(): number | undefined {
        const seconds = this.model.getNumber("creationTimeSeconds");
        if (seconds !== undefined) {
            return seconds * 1000;
        }
        return undefined;
    }

    /**
     * @param expireTime When in UNIX time milliseconds the cert is no longer valid to use.
     * Note that expireTime is set in milliseconds but stored as seconds meaning
     * that when fetching it back the last three digits will be zeroes.
     */
    public setExpireTime(expireTime: number) {
        this.model.setNumber("expireTimeSeconds", Math.floor(expireTime/1000));
    }

    /**
     * @returns milliseconds UNIX time until when this cert is valid
     * Note that the value is rounded down to the second compared to how it was set.
     */
    public getExpireTime(): number | undefined {
        const seconds = this.model.getNumber("expireTimeSeconds");
        if (seconds !== undefined) {
            return seconds * 1000;
        }
        return undefined;
    }

    /**
     * Set the constraints hash of this cert for under which conditions it is valid.
     * @param constraints hash of constraints
     */
    public setConstraints(constraints: Buffer | undefined) {
        this.model.setBuffer("constraints", constraints);
    }

    /**
     * Get the constraints hash of this cert for under which conditions it is valid.
     * @returns constraints
     */
    public getConstraints(): Buffer | undefined {
        return this.model.getBuffer("constraints");
    }

    /**
     * Set the target type of the next cert or object embedding/leveraging this cert.
     * @param targetType type of the next cert or object.
     */
    public setTargetType(targetType: Buffer | undefined) {
        this.model.setBuffer("targetType", targetType);
    }

    /**
     * Get the target type of the next cert.
     * @returns targetType type of the next cert.
     */
    public getTargetType(): Buffer | undefined {
        return this.model.getBuffer("targetType");
    }

    /**
     * Get the cert embedded image.
     * @returns image
     */
    public getCert(): Buffer | undefined {
        return this.model.getBuffer("cert");
    }

    /**
     * Set the cert embedded image.
     * @param image
     */
    public setCert(image: Buffer | undefined) {
        this.model.setBuffer("cert", image);
    }

    /**
     * Set the cached cert object.
     * This is either set when creating this cert to have the cert exported
     * together with this cert, or it is set by the outside when loading up the cert.
     */
    public setCertObject(cert: BaseCertInterface | undefined) {
        if (cert) {
            const certType = cert.getType();
            if (!this.isCertTypeAccepted(certType)) {
                throw new Error(`Cert type not accepted: ${certType}`);
            }
        }
        this.cachedCertObject = cert;
    }

    /**
     * Helper function to detect if a cert is present either as raw image or as cached object.
     * @returns true if this cert does use certificate.
     */
    public hasCert(): boolean {
        if (this.getCert()) {
            return true;
        }
        if (this.cachedCertObject) {
            return true;
        }
        return false;
    }

    /**
     * @returns the cached cert object or attempt to decode the cert.
     * @throws if cert is not cached and cannot be decoded.
     */
    public getCertObject(): BaseCertInterface {
        if (this.cachedCertObject) {
            return this.cachedCertObject;
        }
        if (!this.getCert()) {
            throw new Error("Cert image expected");
        }
        // Attempt to decode the cert
        try {
            this.cachedCertObject = this.decodeCert();
        }
        catch(e) {
            // Fall through.
        }
        if (!this.cachedCertObject) {
            throw new Error("Could not decode cert locally, it might need to be set from the outside");
        }
        return this.cachedCertObject;
    }

    /**
     * The issuer public key is the owner of the first (innermost) cert in the stack.
     * @returns the issuer public key.
     * @throws if embedded cert is not cached and cannot be decoded locally
     */
    public getIssuerPublicKey(): Buffer | undefined {
        let cert: BaseCertInterface | undefined = this as BaseCertInterface;
        let ownerPublicKey = cert.getOwner();
        while (cert.hasCert()) {
            cert = cert.getCertObject();
            ownerPublicKey = cert.getOwner();
        }
        return ownerPublicKey;
    }

    /**
     * @returns the max chain length allowed.
     */
    public getMaxChainLength(): number | undefined {
        return this.model.getNumber("maxChainLength");
    }

    /**
     * @params maxLength the max chain length allowed.
     */
    public setMaxChainLength(maxLength: number | undefined) {
        this.model.setNumber("maxChainLength", maxLength);
    }

    /**
     * Collect and return all destroy hashes within this cert stack.
     * Indestructible certs do not return destroy hashes but they
     * might embed destructible certs which do return hashes.
     * @throws if any cert cannot be decoded
     */
    public getAchillesHashes(): Buffer[] {
        const hashes: Buffer[] = [];

        if (!this.isIndestructible()) {
            // This hash lets the owner of the cert destroy all their certs.
            //
            let innerHash = Hash([SPECIAL_NODES.DESTROY_SELF_TOTAL_DESTRUCT,
                this.getOwner()]);

            hashes.push(Hash([SPECIAL_NODES.DESTROY_SELF_TOTAL_DESTRUCT,
                this.getOwner(), innerHash]));

            // This hash lets the owner of the cert destroy the specific cert.
            //
            innerHash = Hash([SPECIAL_NODES.DESTROY_CERT,
                this.getOwner(), this.calcId1()]);

            hashes.push(Hash([SPECIAL_NODES.DESTROY_CERT,
                this.getOwner(), innerHash]));
        }

        if (this.hasCert()) {
            const cert = this.getCertObject();
            hashes.push(...cert.getAchillesHashes());
        }

        return hashes;
    }

    /**
     * Get the maximum expire time the target is allowed.
     * @returns UNIX time in milliseconds rounded off to nearest second, or undefined if not set.
     */
    public getTargetMaxExpireTime(): number | undefined {
        const seconds = this.model.getNumber("targetMaxExpireTimeSeconds");
        if (seconds !== undefined) {
            return seconds * 1000;
        }
        return undefined;
    }

    /**
     * Set the maximum expire time the target is allowed.
     * @param expireTime UNIX time in milliseconds or undefined to unset.
     */
    public setTargetMaxExpireTime(expireTime: number | undefined) {
        if (expireTime === undefined) {
            this.model.setNumber("targetMaxExpireTimeSeconds", undefined);
        }
        else {
            this.model.setNumber("targetMaxExpireTimeSeconds", Math.floor(expireTime/1000));
        }
    }

    /**
     * When a cert is validated it first check that all its properties are valid,
     * then it checks its embedded cert (if any) that the relationship between them
     * is valid from the embedders perspective.
     * The cert (embedder) then calls the embedded cert's validateAgainstTarget function
     * and passes it self as parameter for the embedded cert to validate its relationship
     * with the embedder.
     *
     * @param target provided by target.
     * @returns tuple [boolean, errorMsg]. If first arg is true then target is valid against cert.
     */
    public abstract validateAgainstTarget(target: unknown): [boolean, string];

    /**
     * This function is used from the validateAgainstTarget function.
     * This function should be implemented in a cert class to take the target parameter
     * of the type its embedder, and it should examine its embedder to calculate
     * the constraints hash of the embedder.
     *
     * Take a target object and calculate a constraints hash from its values.
     * @param target the object to calculate constraints for.
     * @returns constraints hash.
     */
    public abstract calcConstraintsOnTarget(target: unknown): Buffer | undefined;

    /**
     * Decode the embedded cert.
     * @returns cert interface
     * @throws on decode error
     */
    protected abstract decodeCert(): BaseCertInterface | undefined;

    /**
     * Populate the cert.
     * @param params all properties of the cert.
     * @throws if modelType mismatches
     */
    public setParams(params: BaseCertParams) {
        if (params.modelType && !params.modelType.equals(this.getType(params.modelType.length))) {
            throw new Error("modelType in setParams does not match type of model.");
        }
        if (params.owner !== undefined) {
            this.setOwner(params.owner);
        }
        if (params.targetPublicKeys !== undefined) {
            this.setTargetPublicKeys(params.targetPublicKeys);
        }
        if (params.config !== undefined) {
            this.setConfig(params.config);
        }
        if (params.lockedConfig !== undefined) {
            this.setLockedConfig(params.lockedConfig);
        }
        if (params.creationTime !== undefined) {
            this.setCreationTime(params.creationTime);
        }
        if (params.expireTime !== undefined) {
            this.setExpireTime(params.expireTime);
        }
        if (params.cert !== undefined) {
            this.setCert(params.cert);
        }
        if (params.constraints !== undefined) {
            this.setConstraints(params.constraints);
        }
        if (params.targetType !== undefined) {
            this.setTargetType(params.targetType);
        }
        if (params.maxChainLength !== undefined) {
            this.setMaxChainLength(params.maxChainLength);
        }
        if (params.signature !== undefined) {
            this.setSignature(params.signature);
        }
        if (params.multiSigThreshold !== undefined) {
            this.setMultiSigThreshold(params.multiSigThreshold);
        }
        if (params.targetMaxExpireTime !== undefined) {
            this.setTargetMaxExpireTime(params.targetMaxExpireTime);
        }
        if (params.transientConfig !== undefined) {
            this.setTransientConfig(params.transientConfig);
        }
        if (params.hasOnlineValidation !== undefined) {
            this.setHasOnlineValidation(params.hasOnlineValidation);
        }
        if (params.hasOnlineCert !== undefined) {
            this.setHasOnlineCert(params.hasOnlineCert);
        }
        if (params.isIndestructible !== undefined) {
            this.setIndestructible(params.isIndestructible);
        }
        if (params.isOnlineValidated !== undefined) {
            this.setOnlineValidated(params.isOnlineValidated);
        }
        if (params.isOnlineRevoked !== undefined) {
            this.setOnlineRevoked(params.isOnlineRevoked);
        }
        if (params.isOnlineCertOnline !== undefined) {
            this.setOnlineCertOnline(params.isOnlineCertOnline);
        }
    }

    /**
     * Get all properties of the cert.
     * @returns all properties of the cert.
     */
    public getParams(): BaseCertParams {
        const modelType = this.getType();
        const id1 = this.getId1();
        const owner = this.getOwner();
        const targetPublicKeys = this.getTargetPublicKeys();
        const config = this.getConfig();
        const lockedConfig = this.getLockedConfig();
        const creationTime = this.getCreationTime();
        const expireTime = this.getExpireTime();
        const cert = this.getCert();
        const constraints = this.getConstraints();
        const targetType = this.getTargetType();
        const maxChainLength = this.getMaxChainLength();
        const signature = this.getSignature();
        const signingPublicKeys = this.getSignatures().map( signature => signature.publicKey );
        const multiSigThreshold = this.getMultiSigThreshold();
        const targetMaxExpireTime = this.getTargetMaxExpireTime();
        const transientConfig = this.getTransientConfig();
        const hasOnlineValidation = this.hasOnlineValidation();
        const hasOnlineCert = this.hasOnlineCert();
        const isIndestructible = this.isIndestructible();
        const isOnlineValidated = this.isOnlineValidated();
        const isOnlineRevoked = this.isOnlineRevoked();
        const isOnlineCertOnline = this.isOnlineCertOnline();

        return {
            modelType,
            id1,
            owner,
            targetPublicKeys,
            config,
            lockedConfig,
            creationTime,
            expireTime,
            cert,
            constraints,
            targetType,
            maxChainLength,
            signature,
            signingPublicKeys,
            multiSigThreshold,
            targetMaxExpireTime,
            transientConfig,
            hasOnlineValidation,
            hasOnlineCert,
            isIndestructible,
            isOnlineValidated,
            isOnlineRevoked,
            isOnlineCertOnline,
        };
    }
}
