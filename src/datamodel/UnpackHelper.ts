import {
    BaseModelInterface,
} from "./types";

import {
    GetModelType,
} from "./BaseModel";

import {
    BaseNodeInterface,
} from "./level1/basenode/types";

import {
    BaseCertInterface,
} from "./level1/basecert/types";

import {
    AuthCertType,
    AuthCert,
} from "./level3/authcert";

import {
    SignCertType,
    SignCert,
} from "./level3/signcert";

import {
    FriendCertType,
    FriendCert,
} from "./level3/friendcert";

import {
    DataNodeType,
    DataNode,
} from "./level3/datanode";

import {
    LicenseNodeType,
    LicenseNode,
} from "./level3/licensenode";

import {
    CarrierNodeType,
    CarrierNode,
} from "./level3/carriernode";

/**
 * Attempt to unpack any known model.
 * @param packed
 * @returns unpacked model as BaseModeInterface
 * @throws if unknown modelType
 */
export function UnpackModel(packed: Buffer, preserveTransient: boolean = false,
    deepUnpack: boolean = false): BaseModelInterface
{
    try {
        return UnpackNode(packed, preserveTransient, deepUnpack);
    }
    catch(e) {
        // Do nothing
    }

    try {
        return UnpackCert(packed, preserveTransient, deepUnpack);
    }
    catch(e) {
        // Do nothing
    }

    throw new Error("Could not unpack model");
}

export function UnpackNode(packed: Buffer, preserveTransient: boolean = false,
    deepUnpack: boolean = false): BaseNodeInterface
{
    const modelType = GetModelType(packed);

    if (modelType.equals(Buffer.from(DataNodeType))) {
        const node = new DataNode(packed);

        node.unpack(preserveTransient, deepUnpack);

        return node;
    }
    else if (modelType.equals(Buffer.from(LicenseNodeType))) {
        const node = new LicenseNode(packed);

        node.unpack(preserveTransient, deepUnpack);

        return node;
    }
    else if (modelType.equals(Buffer.from(CarrierNodeType))) {
        const node = new CarrierNode(packed);

        node.unpack(preserveTransient, deepUnpack);

        return node;
    }
    else {
        throw new Error("Could not decode node model");
    }
}

export function UnpackCert(packed: Buffer, preserveTransient: boolean = false,
    deepUnpack: boolean = false): BaseCertInterface
{
    const modelType = GetModelType(packed);

    if (modelType.equals(Buffer.from(AuthCertType))) {
        const cert = new AuthCert(packed);

        cert.unpack(preserveTransient, deepUnpack);

        return cert;
    }
    else if (modelType.equals(Buffer.from(FriendCertType))) {
        const cert = new FriendCert(packed);

        cert.unpack(preserveTransient, deepUnpack);

        return cert;
    }
    else if (modelType.equals(Buffer.from(SignCertType))) {
        const cert = new SignCert(packed);

        cert.unpack(preserveTransient, deepUnpack);

        return cert;
    }
    else {
        throw new Error("Could not decode cert model");
    }
}
