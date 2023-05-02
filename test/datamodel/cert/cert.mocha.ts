import { assert, expect } from "chai";

// TODO add friendCert, licenseCert testing
//

import {
    SignatureOffloader,
    Node,
    DataCert,
    CertUtil,
} from "../../../src";

describe("certs", function() {
    const signatureOffloader = new SignatureOffloader();
    const keyPair1 = Node.GenKeyPair();
    const keyPair2 = Node.GenKeyPair();

    before( function() {
        signatureOffloader.init();
    });

    after( function() {
        signatureOffloader.close();
    });

    it("single cert should validate sync and async", async function() {
        const certUtil = new CertUtil();
        const creationTime = 10;
        const expireTime = 100;

        const certObject = await certUtil.createDataCert({creationTime, expireTime, targetPublicKeys: [keyPair1.publicKey]}, keyPair2);

        let val = certObject.validate();
        assert(val[0]);

        let status = certObject.verify();
        assert(status);

        let signatures = certObject.extractSignatures();
        assert(signatures.length === 1);

        let verified = await signatureOffloader.verify([certObject]);
        assert(verified.length === 1);

        // Also try export/load so see it survives serialization.
        let exported = certObject.export();

        let certObjectB = new DataCert();
        certObjectB.load(exported);

        val = certObjectB.validate();
        assert(val[0]);

        status = certObjectB.verify();
        assert(status);

        signatures = certObjectB.extractSignatures();
        assert(signatures.length === 1);

        verified = await signatureOffloader.verify([certObjectB]);
        assert(verified.length === 1);

        // Try signing using SignatureOffloader
        const certObject2 = await certUtil.createDataCert({creationTime, expireTime, owner: keyPair2.publicKey, targetPublicKeys: [keyPair1.publicKey]});

        val = certObject2.validate();
        assert(val[0] === false);

        val = certObject2.validate(2);
        assert(val[0]);

        status = certObject2.verify();
        assert(status === false);
    });

    it("double cert should validate sync and async", async function() {
        const certUtil = new CertUtil();
        const creationTime = 10;
        const expireTime = 100;

        const chainCert1 = await certUtil.createChainCert({creationTime, expireTime, targetPublicKeys: [keyPair1.publicKey], maxChainLength: 2}, keyPair2);

        const dataCert2 = await certUtil.createDataCert({creationTime, expireTime, targetPublicKeys: [keyPair1.publicKey], cert: chainCert1.export(), maxChainLength: 1}, keyPair1);

        let val = chainCert1.validate();
        assert(val[0]);

        val = dataCert2.validate();
        assert(val[0]);

        let status = chainCert1.verify();
        assert(status);

        status = dataCert2.verify();
        assert(status);

        let signatures = dataCert2.extractSignatures();
        assert(signatures.length === 2);

        let verified = await signatureOffloader.verify([dataCert2]);
        assert(verified.length === 1);

        // Also try export/load so see it survives serialization.
        let exported = dataCert2.export();

        let dataCertB = new DataCert();
        dataCertB.load(exported);

        const embeddedCert = dataCertB.getCertObject();
        val = embeddedCert.validate();
        assert(val[0]);
        status = embeddedCert.verify();
        assert(status);

        signatures = dataCertB.extractSignatures();

        val = dataCertB.validate();
        assert(val[0]);

        status = dataCertB.verify();
        assert(status);

        signatures = dataCertB.extractSignatures();
        assert(signatures.length === 2);

        verified = await signatureOffloader.verify([dataCertB]);
        assert(verified.length === 1);

        // Try signing using SignatureOffloader
        const dataCert3 = await certUtil.createDataCert({creationTime, expireTime, targetPublicKeys: [keyPair1.publicKey], cert: chainCert1.export(), maxChainLength: 1});

        val = dataCert3.validate();
        assert(val[0] === false);

        val = dataCert3.validate(2);
        assert(val[0]);

        status = dataCert3.verify();
        assert(status === false);
    });

    it("cert using multisig cert should validate when all signatures are placed", async function() {
        const certUtil = new CertUtil();
        const creationTime = 10;
        const expireTime = 100;

        const keyPair1b = Node.GenKeyPair();
        const keyPair1c = Node.GenKeyPair();

        const chainCert1 = await certUtil.createChainCert({creationTime, expireTime, targetPublicKeys: [keyPair1.publicKey, keyPair1b.publicKey, keyPair1c.publicKey], multiSigThreshold: 2, maxChainLength: 2}, keyPair2);

        let val = chainCert1.validate();
        assert(val[0]);

        let status = chainCert1.verify();
        assert(status);

        const dataCert2 = await certUtil.createDataCert({creationTime, expireTime, targetPublicKeys: [keyPair1.publicKey], cert: chainCert1.export(), maxChainLength: 1}, keyPair1);

        let publicKeys = dataCert2.getEligibleSigningPublicKeys();
        assert(publicKeys.length === 3);
        assert(publicKeys[0].equals(keyPair1.publicKey));
        assert(publicKeys[1].equals(keyPair1b.publicKey));
        assert(publicKeys[2].equals(keyPair1c.publicKey));

        val = dataCert2.validate();
        assert(val[0] === false);
        status = dataCert2.verify();
        assert(!status);

        publicKeys = dataCert2.getEligibleSigningPublicKeys(true);
        assert(publicKeys.length === 2);
        assert(publicKeys[0].equals(keyPair1b.publicKey));

        // Sign with already used key
        expect(() => dataCert2.sign(keyPair1)).to.throw()

        status = dataCert2.verify();
        assert(!status);

        dataCert2.sign(keyPair1b);

        status = dataCert2.verify();
        assert(status);

        publicKeys = dataCert2.getEligibleSigningPublicKeys(true);
        assert(publicKeys.length === 1);

        // Sign with one key too much, 2/3 signatures required.
        expect(() => dataCert2.sign(keyPair1c)).to.throw()
    });
});
