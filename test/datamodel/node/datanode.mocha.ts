import { assert, expect } from "chai";

import {
    SignatureOffloader,
    License,
    Crypto,
    Hash,
    sleep,
    CertUtil,
    NodeUtil,
} from "../../../src";

describe("nodes", async function() {
    const signatureOffloader = new SignatureOffloader();
    const keyPair1 = Crypto.GenEthereumKeyPair();
    const keyPair2 = Crypto.GenKeyPair();

    before( async function() {
        await signatureOffloader.init();
    });

    after( function() {
        signatureOffloader.close();
    });

    it("node with cert should validate sync and async", async function() {
        const certUtil = new CertUtil();
        const nodeUtil = new NodeUtil();
        const creationTime = Date.now();
        const expireTime = creationTime + 1000;

        const certObject = await certUtil.createDataCert({creationTime, expireTime, targetPublicKeys: [keyPair1.publicKey]}, keyPair2.publicKey, keyPair2.secretKey);

        let val = certObject.validate();
        assert(val[0]);

        let status = certObject.verify();
        assert(status);

        let signatures = certObject.extractSignatures();
        assert(signatures.length === 1);

        let verified = await signatureOffloader.verify([certObject]);
        assert(verified.length === 1);

        nodeUtil.setNodeCerts([certObject]);
        const parentId = Buffer.alloc(32);
        const dataNode = await nodeUtil.createDataNode({creationTime, expireTime, parentId, data: Buffer.from("Hello"), owner: keyPair2.publicKey, cert: certObject.export()}, keyPair1.publicKey, keyPair1.secretKey);

        val = dataNode.validate();
        assert(val[0]);

        status = dataNode.verify();
        assert(status);

        signatures = dataNode.extractSignatures();
        assert(signatures.length === 2);

        verified = await signatureOffloader.verify([dataNode]);
        assert(verified.length === 1);
    });

    it("node with double cert should validate sync and async", async function() {
        const certUtil = new CertUtil();
        const nodeUtil = new NodeUtil();
        const creationTime = Date.now();
        const expireTime = creationTime + 1000;

        const chainCert1 = await certUtil.createChainCert({creationTime, expireTime, targetPublicKeys: [keyPair1.publicKey], maxChainLength: 2}, keyPair2.publicKey, keyPair2.secretKey);

        const dataCert2 = await certUtil.createDataCert({creationTime, expireTime, targetPublicKeys: [keyPair1.publicKey], cert: chainCert1.export(), maxChainLength: 1}, keyPair1.publicKey, keyPair1.secretKey);

        let val = chainCert1.validate();
        assert(val[0]);

        let status = chainCert1.verify();
        assert(status);

        val = dataCert2.validate();
        assert(val[0]);

        status = dataCert2.verify();
        assert(status);

        let signatures = chainCert1.extractSignatures();
        assert(signatures.length === 1);

        let verified = await signatureOffloader.verify([chainCert1]);
        assert(verified.length === 1);

        signatures = dataCert2.extractSignatures();
        assert(signatures.length === 2);

        verified = await signatureOffloader.verify([dataCert2]);
        assert(verified.length === 1);

        nodeUtil.setNodeCerts([dataCert2]);
        const parentId = Buffer.alloc(32);
        const dataNode = await nodeUtil.createDataNode({creationTime, expireTime, parentId, data: Buffer.from("Hello"), cert: dataCert2.export(), owner: keyPair2.publicKey}, keyPair1.publicKey, keyPair1.secretKey);

        val = dataNode.validate();
        assert(val[0]);

        signatures = dataNode.extractSignatures();
        assert(signatures.length === 3);

        status = dataNode.verify();
        assert(status);

        verified = await signatureOffloader.verify([dataNode]);
        assert(verified.length === 1);
    });

    it("node using multisig cert should validate when all signatures are placed", async function() {
        const certUtil = new CertUtil();
        const nodeUtil = new NodeUtil();
        const creationTime = Date.now();
        const expireTime = creationTime + 1000;

        const keyPair1b = Crypto.GenEthereumKeyPair();
        const keyPair1c = Crypto.GenKeyPair();

        const chainCert1 = await certUtil.createChainCert({creationTime, expireTime, targetPublicKeys: [keyPair1.publicKey], maxChainLength: 2}, keyPair2.publicKey, keyPair2.secretKey);

        let val = chainCert1.validate();
        assert(val[0]);

        let status = chainCert1.verify();
        assert(status);

        const dataCert2 = await certUtil.createDataCert({creationTime, expireTime, targetPublicKeys: [keyPair1b.publicKey, keyPair1c.publicKey], cert: chainCert1.export(), maxChainLength: 1, multiSigThreshold: 2}, keyPair1.publicKey, keyPair1.secretKey);

        const parentId = Buffer.alloc(32);
        const dataNode = await nodeUtil.createDataNode({creationTime, expireTime, parentId, data: Buffer.from("Hello"), cert: dataCert2.export(), owner: keyPair2.publicKey}, keyPair2.publicKey);

        let publicKeys = dataNode.getEligibleSigningPublicKeys(true);
        assert(publicKeys.length === 2);
        assert(publicKeys[0].equals(keyPair1b.publicKey));
        assert(publicKeys[1].equals(keyPair1c.publicKey));

        // Sign with wrong key
        expect(() => dataNode.sign(keyPair1)).to.throw()

        dataNode.sign(keyPair1b);

        val = dataNode.validate();
        assert(val[0] === false);
        status = dataNode.verify();
        assert(!status);

        // Sign with wrong key
        expect(() => dataNode.sign(keyPair1)).to.throw()

        // Sign with already used key
        expect(() => dataNode.sign(keyPair1b)).to.throw()

        dataNode.sign(keyPair1c);

        val = dataNode.validate();
        assert(val[0] === true);
        status = dataNode.verify();
        assert(status);

        // Sign with wrong key
        expect(() => dataNode.sign(keyPair1)).to.throw()
    });
});
