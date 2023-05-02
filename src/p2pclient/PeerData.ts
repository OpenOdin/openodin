import {
    Model,
    Fields,
    FieldType,
    Hash,
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
    clock: {
        name: "clock",
        type: FieldType.UINT48BE,
        index: 102,
    },
    appVersion: {
        name: "peerAppVersion",
        type: FieldType.BYTE6,
        index: 103,
    },
    authCert: {
        name: "authCert",
        type: FieldType.BYTES,
        maxSize: 1024,
        index: 104,
    },
    region: {  // ISO 3166-1
        name: "region",
        type: FieldType.STRING,
        maxSize: 2,
        index: 105,
    },
    jurisdiction: {  // ISO 3166-1
        name: "jurisdiction",
        type: FieldType.STRING,
        maxSize: 2,
        index: 106,
    },
    connectionType: {
        name: "connectionType",
        type: FieldType.UINT8,
        index: 107,
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
     * @throws a string containing a message error when image load fails to decode or access the decoded input Buffer.
     */
    public load(image: Buffer) {
        // Ignore unknown fields present in the image.
        // This is to allow for flexibility when loading peerData from different versions of P2PClient.
        this.model.load(image);
    }

    /**
     * @returns exported data Buffer
     *
     * @throws a string containing a message error when unable to export the current data model.
     */
    public export(): Buffer {
        return this.model.export();
    }

    /**
     * @returns hash of the model
     **/
    public hash(): Buffer {
        return Hash(this.model.getHashable());
    }

    public setVersion(version: Buffer | undefined) {
        this.model.setBuffer("version", version);
    }

    public getVersion(): Buffer | undefined {
        return this.model.getBuffer("version");
    }

    public setSerializeFormat(format: number | undefined) {
        this.model.setNumber("serializeFormat", format);
    }

    public getSerializeFormat(): number | undefined {
        return this.model.getNumber("serializeFormat");
    }

    public setClock(clock: number | undefined) {
        this.model.setNumber("clock", clock);
    }

    public getClock(): number | undefined {
        return this.model.getNumber("clock");
    }

    public setAppVersion(appVersion: Buffer | undefined) {
        this.model.setBuffer("appVersion", appVersion);
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

    /**
     * A peer's supported connection type.
     */
    public setConnectionType(connectionType: number | undefined) {
        this.model.setNumber("connectionType", connectionType);
    }

    public getConnectionType(): number | undefined {
        return this.model.getNumber("connectionType");
    }
}
