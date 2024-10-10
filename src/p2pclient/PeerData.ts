import {
    Model,
    Fields,
    FieldType,
} from "../datamodel";

/**
 */
const FIELDS: Fields = {
    version: {
        name: "version",
        type: FieldType.BYTE6,
        index: 100,
    },
    serializeFormat: {
        name: "serializeFormat",
        type: FieldType.UINT16BE,
        index: 101,
    },
    appVersion: {
        name: "peerAppVersion",
        type: FieldType.BYTE6,
        index: 102,
    },
    authCert: {
        name: "authCert",
        type: FieldType.BYTES,
        maxSize: 1897,
        index: 103,
    },
    region: {  // ISO 3166-1
        name: "region",
        type: FieldType.STRING,
        maxSize: 2,
        index: 104,
    },
    jurisdiction: {  // ISO 3166-1
        name: "jurisdiction",
        type: FieldType.STRING,
        maxSize: 2,
        index: 105,
    },
    clockDiff: {
        name: "clockDiff",
        type: FieldType.INT32BE,
        index: 106,
        transient: true,
    },
    handshakePublicKey: {
        name: "handshakePublicKey",
        type: FieldType.BYTE32,
        index: 107,
        transient: true,
    },
    authCertPublicKey: {
        name: "authCertPublicKey",
        type: FieldType.BYTES,
        maxSize: 32,
        index: 108,
        transient: true,
    },
    expireTime: {
        name: "expireTime",
        type: FieldType.INT32BE,
        index: 109,
    },
};

/**
 * This is a serializable data holder of the "peerData" field passed in the handshake process.
 * This model is packed and sent to the peer upon handshake.
 * This model is allowing for unknown fields being present in the image data (ignored),
 * so that handshaking works cross versions changing the PeerData model.
 */
export class PeerData {
    protected model: Model;

    constructor() {
        this.model = new Model(Buffer.from([0,0,0,0,0,0]), FIELDS);  // Note: giving this model an unknown model type since it is only used in a special scenario.
    }

    /**
     * Load model image Buffer.
     *
     * @param image - image data to load
     *
     * @throws an error containing a message error when image load fails to decode.
     */
    public load(image: Buffer, preserveTransient: boolean = false) {
        // Ignore unknown fields present in the image.
        // This is to allow for flexibility when loading peerData from different versions of P2PClient.
        this.model.load(image, preserveTransient, true);
    }

    /**
     * @returns exported data Buffer
     *
     * @throws an error containing a message error when unable to export the current data model.
     */
    public export(exportTransient: boolean = false): Buffer {
        return this.model.export(exportTransient);
    }

    /**
     * @returns hash of the model
     **/
    public hash(): Buffer {
        return this.model.hash();
    }

    public setVersion(version: Buffer | undefined) {
        this.model.setBuffer("version", version);
    }

    public setVersionFromString(version: string | undefined) {
        if (version === undefined) {
            this.model.setBuffer("version", version);
        }
        else {
            const [major, minor, patch] = version.split(".").map(n => parseInt(n));

            const versionBuf = Buffer.alloc(6);
            versionBuf.writeUInt16BE(major, 0);
            versionBuf.writeUInt16BE(minor, 2);
            versionBuf.writeUInt16BE(patch, 4);

            this.model.setBuffer("version", versionBuf);
        }
    }

    public getVersion(): Buffer | undefined {
        return this.model.getBuffer("version");
    }

    /**
     * Compare stored version with given.
     * @param version to compare with, semver format as "x.y.z"
     * @returns -1 if stored version is lesser, 0 if same, 1 if stored version is greater.
     */
    public cmpVersion(version: string): number {
        const [major, minor, patch] = version.split(".").map(n => parseInt(n));

        if (this.getMajorVersion() < major) {
            return -1;
        }
        else if (this.getMajorVersion() > major) {
            return 1;
        }

        if (this.getMinorVersion() < minor) {
            return -1;
        }
        else if (this.getMinorVersion() > minor) {
            return 1;
        }


        if (this.getPatchVersion() < patch) {
            return -1;
        }
        else if (this.getPatchVersion() > patch) {
            return 1;
        }

        return 0;
    }

    public getMajorVersion(): number {
        const version = this.getVersion();

        if (!version) {
            return 0;
        }

        return version.readUInt16BE(0);
    }

    public getMinorVersion(): number {
        const version = this.getVersion();

        if (!version) {
            return 0;
        }

        return version.readUInt16BE(2);
    }

    public getPatchVersion(): number {
        const version = this.getVersion();

        if (!version) {
            return 0;
        }

        return version.readUInt16BE(4);
    }

    public setSerializeFormat(format: number | undefined) {
        this.model.setNumber("serializeFormat", format);
    }

    public getSerializeFormat(): number | undefined {
        return this.model.getNumber("serializeFormat");
    }

    public setAppVersion(appVersion: Buffer | undefined) {
        this.model.setBuffer("appVersion", appVersion);
    }

    public setAppVersionFromString(appVersion: string | undefined) {
        if (appVersion === undefined) {
            this.model.setBuffer("appVersion", appVersion);
        }
        else {
            const [major, minor, patch] = appVersion.split(".").map(n => parseInt(n));

            const versionBuf = Buffer.alloc(6);
            versionBuf.writeUInt16BE(major, 0);
            versionBuf.writeUInt16BE(minor, 2);
            versionBuf.writeUInt16BE(patch, 4);

            this.model.setBuffer("appVersion", versionBuf);
        }
    }

    public getAppVersion(): Buffer | undefined {
        return this.model.getBuffer("appVersion");
    }

    public setAuthCert(authCert: Buffer | undefined) {
        this.model.setBuffer("authCert", authCert);
    }

    public getAuthCert(): Buffer | undefined {
        return this.model.getBuffer("authCert");
    }

    /**
     * A peer can state its jurisdiction for this connection.
     * @param jurisdiction ISO 3166-1
     */
    public setJurisdiction(jurisdiction: string | undefined) {
        this.model.setString("jurisdiction", jurisdiction);
    }

    public getJurisdiction(): string | undefined {
        return this.model.getString("jurisdiction");
    }

    /**
     * A peer can state its region for this connection.
     * @param region ISO 3166-1
     */
    public setRegion(region: string | undefined) {
        this.model.setString("region", region);
    }

    public getRegion(): string | undefined {
        return this.model.getString("region");
    }

    public setClockDiff(clockDiff: number) {
        if (clockDiff < -2147483648) {
            clockDiff = -2147483648;
        }
        else if (clockDiff > 2147483647) {
            clockDiff = 2147483647;
        }

        this.model.setNumber("clockDiff", clockDiff);
    }

    public getClockDiff(): number {
        return this.model.getNumber("clockDiff") ?? 0;
    }

    /**
     * The maximum expire time in seconds for the session from when it started.
     * Each peer is responsible to shutdown the socket when it reaches
     * its own expireTime.
     * This property is announced as information to the other peer.
     * A value of 0 means no expiration.
     */
    public setExpireTime(expireTime: number | undefined) {
        this.model.setNumber("expireTime", expireTime);
    }

    public getExpireTime(): number {
        return this.model.getNumber("expireTime") ?? 0;
    }

    public setHandshakePublicKey(publicKey: Buffer) {
        this.model.setBuffer("handshakePublicKey", publicKey);
    }

    public getHandshakePublicKey(): Buffer {
        const publicKey = this.model.getBuffer("handshakePublicKey");

        if (!publicKey) {
            throw new Error("handshakePublicKey not set");
        }

        return publicKey;
    }

    public setAuthCertPublicKey(publicKey: Buffer | undefined) {
        this.model.setBuffer("authCertPublicKey", publicKey);
    }

    public getAuthCertPublicKey(): Buffer | undefined {
        return this.model.getBuffer("authCertPublicKey");
    }
}
