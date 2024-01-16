import {
    BaseTopCert,
} from "../../base/BaseTopCert";

import {
    PrimaryNodeCertLockedConfig,
    PrimaryNodeCertParams,
} from "./types";

import {
    PrimaryNodeCertInterface,
    PrimaryNodeCertConstraintValues,
} from "../interface/PrimaryNodeCertInterface";

import {
    Hash,
} from "../../../hash";


/**
 * A node cert is used to sign nodes using a other key than the owner.
 */
export abstract class PrimaryNodeCert extends BaseTopCert implements PrimaryNodeCertInterface {

    public validateAgainstTarget(target: PrimaryNodeCertConstraintValues): [boolean, string] {
        // Check that the issuer of the certificate is the same as the owner of our target.
        const nodeOwnerPublicKey = target.owner;
        if (!nodeOwnerPublicKey) {
            return [false, "Missing owner of node"];
        }
        if (!this.getIssuerPublicKey()?.equals(nodeOwnerPublicKey)) {
            return [false, "Node owner does not match cert issuer"];
        }

        // Note that the node will check it's signer public key against this certs targetPublicKeys.

        const targetType = this.getTargetType();
        if (targetType) {
            if (!target.modelType || !targetType.equals(target.modelType.slice(0, targetType.length))) {
                return [false, `Target type from cert does not match target's type: ${targetType.toString("hex")} compared to node type ${target.modelType?.toString("hex")}`];
            }
        }

        const certCreationTime = this.getCreationTime();
        const certExpireTime = this.getExpireTime();

        if (certCreationTime === undefined || certExpireTime === undefined) {
            return [false, "Missing time values in cert"];
        }

        const nodeExpireTime = target.expireTime;
        const nodeCreationTime = target.creationTime;

        if (nodeCreationTime === undefined) {
            return [false, "Missing node creation time"];
        }

        // Check so that the node is not created before the cert's fromTime.
        if (nodeCreationTime < certCreationTime) {
            return [false, "Node cannot be created before certificate's creation time"];
        }
        if (nodeCreationTime > certExpireTime) {
            return [false, "Node cannot be created after the certificate's expire time"];
        }

        // Check the maximum allowed expire time.
        const targetMaxExpireTime = this.getTargetMaxExpireTime();
        if (nodeExpireTime === undefined && targetMaxExpireTime !== undefined) {
            return [false, "expireTime expected on node since targetMaxExpireTime is set in cert"];
        }

        if (nodeExpireTime !== undefined && targetMaxExpireTime !== undefined) {
            if (nodeExpireTime > targetMaxExpireTime) {
                return [false, "Node cannot expire after certificate's targetMaxExpireTime time"];
            }
        }

        const constraints = this.getConstraints();
        if (constraints) {
            try {
                const calcConstraints = this.calcConstraintsOnTarget(target);
                if (!calcConstraints.equals(constraints)) {
                    return [false, "Constraints of node and cert do not match"];
                }
            }
            catch(e) {
                return [false, `Constraints of node could not be calculated: ${e}`];
            }
        }

        return [true, ""];
    }

    /**
     * Look at constraints flags and calculate hash on locked values in node object.
     * @throws
     */
    public calcConstraintsOnTarget(target: PrimaryNodeCertConstraintValues): Buffer {
        const values: (string | Buffer | number | undefined)[] = [];
        if (this.isLockedOnId2()) {
            values.push(target.id2);
        }
        else {
            values.push(undefined);
        }

        if (this.isLockedOnParentId()) {
            values.push(target.parentId);
        }
        else {
            values.push(undefined);
        }

        if (this.isLockedOnConfig()) {
            values.push(target.config);
        }
        else {
            values.push(undefined);
        }

        if (this.isLockedOnNetwork()) {
            values.push(target.onlineIdNetwork);
        }
        else {
            values.push(undefined);
        }

        if (this.isLockedOnDifficulty()) {
            values.push(target.difficulty);
        }
        else {
            values.push(undefined);
        }

        if (this.isLockedOnRefId()) {
            values.push(target.refId);
        }
        else {
            values.push(undefined);
        }

        if (this.isLockedOnEmbedded()) {
            values.push(target.embedded);
        }
        else {
            values.push(undefined);
        }

        if (this.isLockedOnLicenseMinDistance()) {
            values.push(target.licenseMinDistance);
        }
        else {
            values.push(undefined);
        }

        if (this.isLockedOnLicenseMaxDistance()) {
            values.push(target.licenseMaxDistance);
        }
        else {
            values.push(undefined);
        }

        if (this.isLockedOnRegion()) {
            values.push(target.region);
        }
        else {
            values.push(undefined);
        }

        if (this.isLockedOnJurisdiction()) {
            values.push(target.jurisdiction);
        }
        else {
            values.push(undefined);
        }

        if (this.isLockedOnChildMinDifficulty()) {
            values.push(target.childMinDifficulty);
        }
        else {
            values.push(undefined);
        }

        if (this.isLockedOnBlobHash()) {
            values.push(target.blobHash);
        }
        else {
            values.push(undefined);
        }

        if (this.isLockedOnCopiedParentId()) {
            values.push(target.copiedParentId);
        }
        else {
            values.push(undefined);
        }

        if (this.isLockedOnCopiedId1()) {
            values.push(target.copiedId1);
        }
        else {
            values.push(undefined);
        }

        return Hash(values);
    }

    public setLockedOnId2(isLocked: boolean) {
        this.setLockedConfigBit(PrimaryNodeCertLockedConfig.IS_LOCKED_ON_ID2, isLocked);
    }

    public isLockedOnId2(): boolean {
        return this.isLockedConfigBitSet(PrimaryNodeCertLockedConfig.IS_LOCKED_ON_ID2);
    }

    public setLockedOnParentId(isLocked: boolean) {
        this.setLockedConfigBit(PrimaryNodeCertLockedConfig.IS_LOCKED_ON_PARENT_ID, isLocked);
    }

    public isLockedOnParentId(): boolean {
        return this.isLockedConfigBitSet(PrimaryNodeCertLockedConfig.IS_LOCKED_ON_PARENT_ID);
    }

    public setLockedOnConfig(isLocked: boolean) {
        this.setLockedConfigBit(PrimaryNodeCertLockedConfig.IS_LOCKED_ON_CONFIG, isLocked);
    }

    public isLockedOnConfig(): boolean {
        return this.isLockedConfigBitSet(PrimaryNodeCertLockedConfig.IS_LOCKED_ON_CONFIG);
    }

    public setLockedOnNetwork(isLocked: boolean) {
        this.setLockedConfigBit(PrimaryNodeCertLockedConfig.IS_LOCKED_ON_NETWORK, isLocked);
    }

    public isLockedOnNetwork(): boolean {
        return this.isLockedConfigBitSet(PrimaryNodeCertLockedConfig.IS_LOCKED_ON_NETWORK);
    }

    public setLockedOnDifficulty(isLocked: boolean) {
        this.setLockedConfigBit(PrimaryNodeCertLockedConfig.IS_LOCKED_ON_DIFFICULTY, isLocked);
    }

    public isLockedOnDifficulty(): boolean {
        return this.isLockedConfigBitSet(PrimaryNodeCertLockedConfig.IS_LOCKED_ON_DIFFICULTY);
    }

    public setLockedOnRefId(isLocked: boolean) {
        this.setLockedConfigBit(PrimaryNodeCertLockedConfig.IS_LOCKED_ON_REFID, isLocked);
    }

    public isLockedOnRefId(): boolean {
        return this.isLockedConfigBitSet(PrimaryNodeCertLockedConfig.IS_LOCKED_ON_REFID);
    }

    public setLockedOnEmbedded(isLocked: boolean) {
        this.setLockedConfigBit(PrimaryNodeCertLockedConfig.IS_LOCKED_ON_EMBEDDED, isLocked);
    }

    public isLockedOnEmbedded(): boolean {
        return this.isLockedConfigBitSet(PrimaryNodeCertLockedConfig.IS_LOCKED_ON_EMBEDDED);
    }

    public setLockedOnLicenseMinDistance(isLocked: boolean) {
        this.setLockedConfigBit(PrimaryNodeCertLockedConfig.IS_LOCKED_ON_LICENSEMINDISTANCE, isLocked);
    }

    public isLockedOnLicenseMinDistance(): boolean {
        return this.isLockedConfigBitSet(PrimaryNodeCertLockedConfig.IS_LOCKED_ON_LICENSEMINDISTANCE);
    }

    public setLockedOnLicenseMaxDistance(isLocked: boolean) {
        this.setLockedConfigBit(PrimaryNodeCertLockedConfig.IS_LOCKED_ON_LICENSEMAXDISTANCE, isLocked);
    }

    public isLockedOnLicenseMaxDistance(): boolean {
        return this.isLockedConfigBitSet(PrimaryNodeCertLockedConfig.IS_LOCKED_ON_LICENSEMAXDISTANCE);
    }

    public setLockedOnRegion(isLocked: boolean) {
        this.setLockedConfigBit(PrimaryNodeCertLockedConfig.IS_LOCKED_ON_REGION, isLocked);
    }

    public isLockedOnRegion(): boolean {
        return this.isLockedConfigBitSet(PrimaryNodeCertLockedConfig.IS_LOCKED_ON_REGION);
    }

    public setLockedOnJurisdiction(isLocked: boolean) {
        this.setLockedConfigBit(PrimaryNodeCertLockedConfig.IS_LOCKED_ON_JURISDICTION, isLocked);
    }

    public isLockedOnJurisdiction(): boolean {
        return this.isLockedConfigBitSet(PrimaryNodeCertLockedConfig.IS_LOCKED_ON_JURISDICTION);
    }

    public setLockedOnChildMinDifficulty(isLocked: boolean) {
        this.setLockedConfigBit(PrimaryNodeCertLockedConfig.IS_LOCKED_ON_CHILDMINDIFFICULTY, isLocked);
    }

    public isLockedOnChildMinDifficulty(): boolean {
        return this.isLockedConfigBitSet(PrimaryNodeCertLockedConfig.IS_LOCKED_ON_CHILDMINDIFFICULTY);
    }

    public setLockedOnBlobHash(isLocked: boolean) {
        this.setLockedConfigBit(PrimaryNodeCertLockedConfig.IS_LOCKED_ON_BLOBHASH, isLocked);
    }

    public isLockedOnBlobHash(): boolean {
        return this.isLockedConfigBitSet(PrimaryNodeCertLockedConfig.IS_LOCKED_ON_BLOBHASH);
    }

    public setLockedOnCopiedParentId(isLocked: boolean) {
        this.setLockedConfigBit(PrimaryNodeCertLockedConfig.IS_LOCKED_ON_COPIEDPARENTID, isLocked);
    }

    public isLockedOnCopiedParentId(): boolean {
        return this.isLockedConfigBitSet(PrimaryNodeCertLockedConfig.IS_LOCKED_ON_COPIEDPARENTID);
    }

    public setLockedOnCopiedId1(isLocked: boolean) {
        this.setLockedConfigBit(PrimaryNodeCertLockedConfig.IS_LOCKED_ON_COPIEDID1, isLocked);
    }

    public isLockedOnCopiedId1(): boolean {
        return this.isLockedConfigBitSet(PrimaryNodeCertLockedConfig.IS_LOCKED_ON_COPIEDID1);
    }

    /**
     * Populate the cert.
     * @param params all properties of the cert.
     */
    public setParams(params: PrimaryNodeCertParams) {
        super.setParams(params);
        if (params.isLockedOnId2 !== undefined) {
            this.setLockedOnId2(params.isLockedOnId2);
        }
        if (params.isLockedOnParentId !== undefined) {
            this.setLockedOnParentId(params.isLockedOnParentId);
        }
        if (params.isLockedOnConfig !== undefined) {
            this.setLockedOnConfig(params.isLockedOnConfig);
        }
        if (params.isLockedOnNetwork !== undefined) {
            this.setLockedOnNetwork(params.isLockedOnNetwork);
        }
        if (params.isLockedOnDifficulty !== undefined) {
            this.setLockedOnDifficulty(params.isLockedOnDifficulty);
        }
        if (params.isLockedOnRefId !== undefined) {
            this.setLockedOnRefId(params.isLockedOnRefId);
        }
        if (params.isLockedOnEmbedded !== undefined) {
            this.setLockedOnEmbedded(params.isLockedOnEmbedded);
        }
        if (params.isLockedOnLicenseMinDistance !== undefined) {
            this.setLockedOnLicenseMinDistance(params.isLockedOnLicenseMinDistance);
        }
        if (params.isLockedOnLicenseMaxDistance !== undefined) {
            this.setLockedOnLicenseMaxDistance(params.isLockedOnLicenseMaxDistance);
        }
        if (params.isLockedOnRegion !== undefined) {
            this.setLockedOnRegion(params.isLockedOnRegion);
        }
        if (params.isLockedOnJurisdiction !== undefined) {
            this.setLockedOnJurisdiction(params.isLockedOnJurisdiction);
        }
        if (params.isLockedOnChildMinDifficulty !== undefined) {
            this.setLockedOnChildMinDifficulty(params.isLockedOnChildMinDifficulty);
        }
        if (params.isLockedOnBlobHash !== undefined) {
            this.setLockedOnBlobHash(params.isLockedOnBlobHash);
        }
        if (params.isLockedOnCopiedParentId !== undefined) {
            this.setLockedOnCopiedParentId(params.isLockedOnCopiedParentId);
        }
        if (params.isLockedOnCopiedId1 !== undefined) {
            this.setLockedOnCopiedId1(params.isLockedOnCopiedId1);
        }
    }

    /**
     * Get all properties of the cert.
     * @returns all properties of the cert.
     */
    public getParams(): PrimaryNodeCertParams {
        const isLockedOnId2 = this.isLockedOnId2();
        const isLockedOnParentId = this.isLockedOnParentId();
        const isLockedOnConfig = this.isLockedOnConfig();
        const isLockedOnNetwork = this.isLockedOnNetwork();
        const isLockedOnDifficulty = this.isLockedOnDifficulty();
        const isLockedOnRefId = this.isLockedOnRefId();
        const isLockedOnEmbedded = this.isLockedOnEmbedded();
        const isLockedOnLicenseMinDistance = this.isLockedOnLicenseMinDistance();
        const isLockedOnLicenseMaxDistance = this.isLockedOnLicenseMaxDistance();
        const isLockedOnRegion = this.isLockedOnRegion();
        const isLockedOnJurisdiction = this.isLockedOnJurisdiction();
        const isLockedOnChildMinDifficulty = this.isLockedOnChildMinDifficulty();
        const isLockedOnBlobHash = this.isLockedOnBlobHash();
        const isLockedOnCopiedParentId = this.isLockedOnCopiedParentId();
        const isLockedOnCopiedId1 = this.isLockedOnCopiedId1();

        return {
            ...super.getParams(),
            isLockedOnId2,
            isLockedOnParentId,
            isLockedOnConfig,
            isLockedOnNetwork,
            isLockedOnDifficulty,
            isLockedOnRefId,
            isLockedOnEmbedded,
            isLockedOnLicenseMinDistance,
            isLockedOnLicenseMaxDistance,
            isLockedOnRegion,
            isLockedOnJurisdiction,
            isLockedOnChildMinDifficulty,
            isLockedOnBlobHash,
            isLockedOnCopiedParentId,
            isLockedOnCopiedId1,
        };
    }
}
