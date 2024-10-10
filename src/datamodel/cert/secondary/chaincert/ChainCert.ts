import {
    ModelType,
    Fields,
} from "../../../model";

import {
    CHAINCERT_TYPE,
} from "./types";

import {
    ChainCertConstraintValues,
} from "../interface/ChainCertInterface";

import {
    PrimaryChainCert,
} from "../../primary/chaincert/PrimaryChainCert";

import {
    ChainCertInterface,
} from "../interface/ChainCertInterface";

import {
    ToJSONObject,
} from "../../../../util/SchemaUtil";


/**
 * A chain cert is embedded into other certs to prove a chain of delegations.
 * So that keyA delegates to keyB which delegates to keyC.
 */
export class ChainCert extends PrimaryChainCert implements ChainCertInterface {
    constructor(modelType?: ModelType, extraFields?: Fields) {
        const modelType2: Buffer = modelType ?? CHAINCERT_TYPE;
        super(modelType2, extraFields);
    }

    public static GetType(length?: number): Buffer {
        length = length ?? CHAINCERT_TYPE.length;
        return CHAINCERT_TYPE.slice(0, length);
    }

    public getType(length?: number): Buffer {
        length = length ?? CHAINCERT_TYPE.length;
        return CHAINCERT_TYPE.slice(0, length);
    }

    public isCertTypeAccepted(certType: Buffer): boolean {
        return certType.equals(ChainCert.GetType().slice(0, certType.length));
    }

    public validate(deepValidate: number = 1, timeMS?: number): [boolean, string] {
        const val = super.validate(deepValidate, timeMS);
        if (!val[0]) {
            return val;
        }

        const maxChainLength = this.getMaxChainLength();
        if (maxChainLength === undefined) {
            return [false, "maxChainLength must be set to integer"];
        }
        else if (maxChainLength < 1) {
            return [false, "maxChainLength must be at least 1 for ChainCert."];
        }

        return [true, ""];
    }

    /**
     * A cert who embeds this cert call this function to have this cert validate it self against the embedding cert.
     *
     * If a chain cert has constraints set, then the constraints of the target cert must match.
     * If chain cert does not have constraints set then no comparison of constraints is done with target cert.
     *
     */
    public validateAgainstTarget(target: ChainCertConstraintValues, deepValidate: number = 1): [boolean, string] {
        // Check so the target valid time matches the certs valid time.
        const certCreationTime = this.getCreationTime();
        const certExpireTime = this.getExpireTime();

        if (certCreationTime === undefined || certExpireTime === undefined) {
            return [false, "Missing time values in cert"];
        }

        const targetCreationTime = target.creationTime;
        const targetExpireTime = target.expireTime;

        if (targetCreationTime === undefined || targetExpireTime === undefined) {
            return [false, "Missing target creation/expire time"];
        }

        // Check so that the target is not created before the cert's fromTime.
        if (targetCreationTime < certCreationTime) {
            return [false, "Target cannot be created before certificate's creation time"];
        }
        if (targetCreationTime > certExpireTime) {
            return [false, "Target cannot be created after the certificate's expire time"];
        }

        // Check the maximum allowed expire time.
        const targetMaxExpireTime = this.getTargetMaxExpireTime();

        if (targetMaxExpireTime !== undefined) {
            if (targetExpireTime > targetMaxExpireTime) {
                return [false, "Target cannot expire after certificate's targetMaxExpireTime time"];
            }
        }

        if (deepValidate === 1) {
            // Verify so that the chain of delegation is correct.
            const signingPublicKeys = target.signingPublicKeys;
            const targetPublicKeys = this.getTargetPublicKeys();

            if (!signingPublicKeys || !targetPublicKeys) {
                return [false, "Missing signer and cert target public keys"];
            }

            const signerKeys: {[key: string]: boolean} = {};
            targetPublicKeys.forEach( (targetPublicKey: Buffer) => {
                signingPublicKeys.forEach( (signerPublicKey: Buffer) => {
                    if (signerPublicKey.equals(targetPublicKey)) {
                        signerKeys[signerPublicKey.toString("hex")] = true;
                    }
                });
            });

            if (Object.values(signerKeys).length !== (this.getMultiSigThreshold() ?? 1)) {
                return [false, `Signer public key(s) and target public key(s) mismatch or exact threshold of signatures not met (need ${(this.getMultiSigThreshold() ?? 1)})`];
            }
        }

        const targetMaxChainLength = target.maxChainLength;
        const maxChainLength = this.getMaxChainLength();
        if (targetMaxChainLength === undefined || maxChainLength === undefined) {
            return [false, "Missing maxChainLength values"];
        }
        if (targetMaxChainLength >= maxChainLength) {
            return [false, "Target maxChainLength must be lesser as the chain propagates"];
        }

        const targetType = this.getTargetType();
        if (targetType) {
            if (!target.modelType || !targetType.equals(target.modelType.slice(0, targetType.length))) {
                return [false, "Target type from cert does not match target"];
            }
        }

        // Check so the time intervals of both certs match
        if (targetCreationTime === undefined || targetExpireTime === undefined ||
            certCreationTime === undefined || certExpireTime === undefined) {
            return [false, "Missing time values in certs"];
        }
        // Check so that target cert is within the embedded certs time interval
        if (targetCreationTime < certCreationTime) {
            return [false, "Cert must be within embedded certs valid from time"];
        }
        if (targetExpireTime > certExpireTime) {
            return [false, "Cert must be within embedded certs valid until time"];
        }

        // Check so constraints match, if set
        //
        const certConstraints = this.getConstraints();
        if (certConstraints) {
            // If constraints is set in this cert then constraints must match in target (embedder) cert.
            // This means that once constraints have been set in the chain stack of certs it must
            // thereafter be set the same all the way up to the top cert.
            //
            const targetConstraints = this.calcConstraintsOnTarget(target);
            if (!targetConstraints || !certConstraints.equals(targetConstraints)) {
                return [false, "Chain cert constraints do not match target cert's constraints"];
            }
        }

        return [true, ""];
    }

    /**
     * Return the value of the target's constraints without doing any modding or hashing to it.
     * @return constraints of target cert or undefined if none is set.
     */
    public calcConstraintsOnTarget(target: ChainCertConstraintValues): Buffer | undefined {
        return target.constraints;
    }

    protected decodeCert(): ChainCertInterface | undefined {
        const image = this.getCert();
        if (image) {
            if (image.slice(0, ChainCert.GetType().length).equals(ChainCert.GetType())) {
                const chainCert = new ChainCert();
                chainCert.load(image);
                return chainCert;
            }
        }
        return undefined;
    }

    public toString(short: boolean = false): string {
        const shortFields = ["owner", "targetPublicKeys", "creationTimeSeconds",
            "expireTimeSeconds", "constraints", "targetType", "maxChainLength", "targetMaxExpireTimeSeconds",
            "multiSigThreshold"];

        const longFields = ["owner", "targetPublicKeys", "config", "lockedConfig", "creationTimeSeconds",
            "expireTimeSeconds", "constraints", "targetType", "maxChainLength", "targetMaxExpireTimeSeconds",
            "transientConfig", "multiSigThreshold"];

        const fields = short ? shortFields : longFields;

        const o: any = {
            name: "ChainCert",
            type: this.getType(),
            "id1": this.calcId1(),
        };
        fields.forEach( fieldName => {
            o[fieldName] = this.model.getAny(fieldName);
        });

        return JSON.stringify(ToJSONObject(o), null, 4);
    }
}
