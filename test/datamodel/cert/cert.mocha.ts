import { assert, expect } from "chai";

// TODO add friendCert, licenseCert testing
//

import {
    SignatureOffloader,
    Crypto,
    DataCert,
    LicenseCert,
    CertUtil,
    ChainCert,
    FriendCert,
    AuthCert,
    License,
    Data,
} from "../../../src";

describe("certs", async function() {
    const signatureOffloader = new SignatureOffloader();

    const keyPair1 = Crypto.GenKeyPair();

    // Use ECDSA keypair intermixed.
    const keyPair2 = Crypto.GenEthereumKeyPair();

    const keyPair3 = Crypto.GenKeyPair();

    before( async function() {
        await signatureOffloader.init();
    });

    after( function() {
        signatureOffloader.close();
    });

    it("single cert should validate sync and async", async function() {
        const certUtil = new CertUtil();
        const creationTime = 10;
        const expireTime = 100;

        const certObject = await certUtil.createDataCert({creationTime, expireTime, targetPublicKeys: [keyPair1.publicKey]}, keyPair2.publicKey, keyPair2.secretKey);

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
        const certObject2 = await certUtil.createDataCert({creationTime, expireTime, owner: keyPair2.publicKey, targetPublicKeys: [keyPair1.publicKey]}, keyPair2.publicKey);

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

        const chainCert1 = await certUtil.createChainCert({creationTime, expireTime, targetPublicKeys: [keyPair1.publicKey], maxChainLength: 2}, keyPair2.publicKey, keyPair2.secretKey);

        const dataCert2 = await certUtil.createDataCert({creationTime, expireTime, targetPublicKeys: [keyPair1.publicKey], cert: chainCert1.export(), maxChainLength: 1}, keyPair1.publicKey, keyPair1.secretKey);

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
        const dataCert3 = await certUtil.createDataCert({creationTime, expireTime, targetPublicKeys: [keyPair1.publicKey], cert: chainCert1.export(), maxChainLength: 1}, keyPair2.publicKey);

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

        const keyPair1b = Crypto.GenKeyPair();
        const keyPair1c = Crypto.GenKeyPair();

        const chainCert1 = await certUtil.createChainCert({creationTime, expireTime, targetPublicKeys: [keyPair1.publicKey, keyPair1b.publicKey, keyPair1c.publicKey], multiSigThreshold: 2, maxChainLength: 2}, keyPair2.publicKey, keyPair2.secretKey);

        let val = chainCert1.validate();
        assert(val[0]);

        let status = chainCert1.verify();
        assert(status);

        const dataCert2 = await certUtil.createDataCert({creationTime, expireTime, targetPublicKeys: [keyPair1.publicKey], cert: chainCert1.export(), maxChainLength: 1}, keyPair1.publicKey, keyPair1.secretKey);

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

    it("cert should be exported to expected sizes", async function() {
        // Use Ed25519 key pairs here because they use more space,
        // and we want to find largest allocations.
        //
        const keyPair1 = Crypto.GenKeyPair();
        const keyPair2 = Crypto.GenKeyPair();
        const keyPair3 = Crypto.GenKeyPair();

        const certUtil = new CertUtil();
        const creationTime = 10;
        const expireTime = 100;

        // The simplest form of a chaincert.
        // This can be used with a datacert or licensecert for delegated signing of nodes.
        //
        let chainCert = await certUtil.createChainCert({creationTime, expireTime,
            targetPublicKeys: [keyPair1.publicKey],
            maxChainLength: 1},
            keyPair2.publicKey, keyPair2.secretKey);

        let exportedLength = chainCert.export().length;
        let expectedLength = 166;
        assert(exportedLength === expectedLength, `${exportedLength} !== ${expectedLength}`);

        let val = chainCert.validate();
        assert(val[0], val[1]);

        let status = chainCert.verify();
        assert(status);



        chainCert = await certUtil.createChainCert({creationTime, expireTime,
            targetPublicKeys: [keyPair1.publicKey, keyPair2.publicKey],
            multiSigThreshold: 1,
            maxChainLength: 1},
            keyPair2.publicKey, keyPair2.secretKey);

        expectedLength = 202;
        exportedLength = chainCert.export().length;
        assert(exportedLength === expectedLength, `${exportedLength} !== ${expectedLength}`);

        val = chainCert.validate();
        assert(val[0], val[1]);

        status = chainCert.verify();
        assert(status);



        chainCert = await certUtil.createChainCert({creationTime, expireTime,
            targetPublicKeys: [keyPair1.publicKey, keyPair2.publicKey],
            hasDynamicSelf: true,
            multiSigThreshold: 2,
            maxChainLength: 1,
            dynamicSelfSpec: Buffer.alloc(128)},
            keyPair2.publicKey, keyPair2.secretKey);

        expectedLength = 334;
        exportedLength = chainCert.export().length;
        assert(exportedLength === expectedLength, `${exportedLength} !== ${expectedLength}`);

        val = chainCert.validate();
        assert(val[0], val[1]);

        status = chainCert.verify();
        assert(status);




        chainCert = await certUtil.createChainCert({creationTime, expireTime,
            targetPublicKeys: [keyPair1.publicKey, keyPair2.publicKey, keyPair3.publicKey],
            hasDynamicSelf: true,
            multiSigThreshold: 3,
            maxChainLength: 1,
            dynamicSelfSpec: Buffer.alloc(128)},
            keyPair2.publicKey, keyPair2.secretKey);

        expectedLength = 367;
        exportedLength = chainCert.export().length;
        assert(exportedLength === expectedLength, `${exportedLength} !== ${expectedLength}`);

        val = chainCert.validate();
        assert(val[0], val[1]);

        status = chainCert.verify();
        assert(status);



        chainCert = await certUtil.createChainCert({creationTime, expireTime,
            targetPublicKeys: [keyPair1.publicKey, keyPair2.publicKey, keyPair3.publicKey],
            hasDynamicSelf: true,
            multiSigThreshold: 1,
            maxChainLength: 1,
            lockedConfig: 123,
            constraints: Buffer.alloc(32).fill(111),
            dynamicSelfSpec: Buffer.alloc(128)},
            keyPair2.publicKey, keyPair2.secretKey);

        expectedLength = 406;
        exportedLength = chainCert.export().length;
        assert(exportedLength === expectedLength, `${exportedLength} !== ${expectedLength}`);


        val = chainCert.validate();
        assert(val[0], val[1]);

        status = chainCert.verify();
        assert(status);



        chainCert = await certUtil.createChainCert({creationTime, expireTime,
            targetPublicKeys: [keyPair1.publicKey, keyPair2.publicKey, keyPair3.publicKey],
            hasDynamicSelf: true,
            multiSigThreshold: 1,
            maxChainLength: 1,
            lockedConfig: 123,
            targetType: Buffer.from([0,0,0,0,0,0]),
            constraints: Buffer.alloc(32).fill(111),
            dynamicSelfSpec: Buffer.alloc(128)},
            keyPair2.publicKey, keyPair2.secretKey);

        expectedLength = 416;
        exportedLength = chainCert.export().length;
        assert(exportedLength === expectedLength, `${exportedLength} !== ${expectedLength}`);


        val = chainCert.validate();
        assert(val[0], val[1]);

        status = chainCert.verify();
        assert(status);



        chainCert = await certUtil.createChainCert({creationTime, expireTime,
            targetPublicKeys: [keyPair1.publicKey, keyPair2.publicKey, keyPair3.publicKey],
            hasDynamicSelf: true,
            multiSigThreshold: 1,
            maxChainLength: 1,
            lockedConfig: 123,
            targetType: Buffer.from([0,0,0,0,0,0]),
            targetMaxExpireTime: 10101,
            constraints: Buffer.alloc(32).fill(111),
            dynamicSelfSpec: Buffer.alloc(128)},
            keyPair2.publicKey, keyPair2.secretKey);

        expectedLength = 422;
        exportedLength = chainCert.export().length;
        assert(exportedLength === expectedLength, `${exportedLength} !== ${expectedLength}`);


        val = chainCert.validate();
        assert(val[0], val[1]);

        status = chainCert.verify();
        assert(status);


        chainCert = await certUtil.createChainCert({creationTime, expireTime,
            targetPublicKeys: [keyPair1.publicKey, keyPair2.publicKey, keyPair3.publicKey],
            hasDynamicSelf: true,
            multiSigThreshold: 3,
            maxChainLength: 3,
            lockedConfig: 123,
            targetType: ChainCert.GetType(),
            targetMaxExpireTime: Date.now() + 3600000,
            transientConfig: 1,
            constraints: Buffer.alloc(32).fill(111),
            dynamicSelfSpec: Buffer.alloc(128)},
            keyPair2.publicKey, keyPair2.secretKey);

        expectedLength = 422;
        exportedLength = chainCert.export().length;
        assert(exportedLength === expectedLength, `${exportedLength} !== ${expectedLength}`);

        val = chainCert.validate();
        assert(val[0], val[1]);

        status = chainCert.verify();
        assert(status);


        // Export with transient config preserved
        //
        expectedLength = 426;
        exportedLength = chainCert.export(true).length;
        assert(exportedLength === expectedLength, `${exportedLength} !== ${expectedLength}`);

        //422 total length (without transient values preserved);
        //
        //add cert adds 4 byte overhead + cert length and - owner public key of 36 bytes
        //since owner is not set when using cert + two more signatures of 65 byte each.
        //
        //meaning 1 cert with embedded cert can be
        //
        //520 + 422
        //
        //meaning 2 cert with embedded certs can be
        //
        //520 + 520 + 422

        // Embed cert
        //
        let chainCert2 = await certUtil.createChainCert({creationTime, expireTime,
            targetPublicKeys: [keyPair1.publicKey, keyPair2.publicKey, keyPair3.publicKey],
            hasDynamicSelf: true,
            hasDynamicCert: true,
            multiSigThreshold: 3,
            maxChainLength: 2,
            lockedConfig: 123,
            targetType: ChainCert.GetType(),
            targetMaxExpireTime: Date.now() + 3600000,
            transientConfig: 1,
            cert: chainCert.export(),
            constraints: Buffer.alloc(32).fill(111),
            dynamicSelfSpec: Buffer.alloc(128)},
            keyPair1.publicKey, keyPair1.secretKey);


        chainCert2.sign(keyPair2);
        chainCert2.sign(keyPair3);

        val = chainCert2.validate();
        assert(val[0], val[1]);

        status = chainCert2.verify();
        assert(status);

        // Embedded cert and two extra signatures minus the owner public key which is not set
        // when using a cert.
        expectedLength = (422+4+65*2-36) + 422;  //=942
        exportedLength = chainCert2.export().length;
        assert(exportedLength === expectedLength, `${exportedLength} !== ${expectedLength}`);

        // Embed again
        //
        let chainCert3 = await certUtil.createChainCert({
            creationTime, expireTime,
            targetPublicKeys: [keyPair1.publicKey, keyPair2.publicKey, keyPair3.publicKey],
            hasDynamicSelf: true,
            hasDynamicCert: true,
            multiSigThreshold: 3,
            maxChainLength: 1,
            lockedConfig: 123,
            targetType: FriendCert.GetType(),
            targetMaxExpireTime: Date.now() + 3600000,
            transientConfig: 1,
            cert: chainCert2.export(),
            constraints: Buffer.alloc(32).fill(111),
            dynamicSelfSpec: Buffer.alloc(128)},
            keyPair1.publicKey, keyPair1.secretKey);


        chainCert3.sign(keyPair2);
        chainCert3.sign(keyPair3);

        val = chainCert3.validate();
        assert(val[0], val[1]);

        status = chainCert3.verify();
        assert(status);

        expectedLength = (422+4+65*2-36)*2 + 422;  //=1462
        exportedLength = chainCert3.export().length;
        assert(exportedLength === expectedLength, `${exportedLength} !== ${expectedLength}`);

        // Above we have maxed out a stack of three chain certs.
        // Now use this stack with the top certs to see the total maximum size.
        //

        // Friendcert
        //
        let key = Buffer.alloc(32);

        let friendCert = await certUtil.createFriendCert({key,
            isLockedOnIntermediary: true,
            isLockedOnLevel: true,
            creationTime, expireTime,
            targetPublicKeys: [keyPair1.publicKey, keyPair2.publicKey, keyPair3.publicKey],
            hasDynamicSelf: true,
            hasDynamicCert: true,
            multiSigThreshold: 3,
            maxChainLength: 0,
            lockedConfig: 123,
            targetType: License.GetType(),
            targetMaxExpireTime: Date.now() + 3600000,
            transientConfig: 1,
            constraints: Buffer.alloc(32).fill(111),
            dynamicSelfSpec: Buffer.alloc(128),
            cert: chainCert3.export(),
        }, keyPair1.publicKey, keyPair1.secretKey);

        friendCert.sign(keyPair2);
        friendCert.sign(keyPair3);

        val = friendCert.validate();
        assert(val[0], val[1]);

        status = friendCert.verify();
        assert(status);

        expectedLength = 1462 + 422 + 4 + 36 + 65*2 - 36; // 2018
        exportedLength = friendCert.export().length;
        assert(exportedLength === expectedLength, `${exportedLength} !== ${expectedLength}`);


        // Authcert
        //
        let chainCert3b = await certUtil.createChainCert({
            creationTime, expireTime,
            targetPublicKeys: [keyPair1.publicKey, keyPair2.publicKey, keyPair3.publicKey],
            hasDynamicSelf: true,
            hasDynamicCert: true,
            multiSigThreshold: 3,
            maxChainLength: 1,
            lockedConfig: 123,
            targetType: AuthCert.GetType(),  // This needed to change, that's why a new chaincert.
            targetMaxExpireTime: Date.now() + 3600000,
            transientConfig: 1,
            cert: chainCert2.export(),
            constraints: Buffer.alloc(32).fill(111),
            dynamicSelfSpec: Buffer.alloc(128)},
            keyPair1.publicKey, keyPair1.secretKey);


        chainCert3b.sign(keyPair2);
        chainCert3b.sign(keyPair3);

        val = chainCert3b.validate();
        assert(val[0], val[1]);

        status = chainCert3b.verify();
        assert(status);

        expectedLength = (422+4+65*2-36)*2 + 422;  //=1462
        exportedLength = chainCert3b.export().length;
        assert(exportedLength === expectedLength, `${exportedLength} !== ${expectedLength}`);

        let authCert = await certUtil.createAuthCert({
            isLockedOnPublicKey: true,
            isLockedOnRegion: true,
            isLockedOnJurisdiction: true,
            creationTime, expireTime,
            targetPublicKeys: [keyPair3.publicKey],
            hasDynamicSelf: true,
            hasDynamicCert: true,
            maxChainLength: 0,
            lockedConfig: 123,
            transientConfig: 1,
            constraints: Buffer.alloc(32).fill(111),
            dynamicSelfSpec: Buffer.alloc(128),
            cert: chainCert3b.export(),
        }, keyPair1.publicKey, keyPair1.secretKey);

        authCert.sign(keyPair2);
        authCert.sign(keyPair3);

        val = authCert.validate();
        assert(val[0], val[1]);

        status = authCert.verify();
        assert(status);

        expectedLength = 1462 + 4 + 422 + 65*2 - 36 - 3 - 10 - 33*2 - 6; // 1897
        exportedLength = authCert.export().length;
        assert(exportedLength === expectedLength, `${exportedLength} !== ${expectedLength}`);


        // DataCert
        //
        let chainCert3c = await certUtil.createChainCert({
            creationTime, expireTime,
            targetPublicKeys: [keyPair1.publicKey, keyPair2.publicKey, keyPair3.publicKey],
            hasDynamicSelf: true,
            hasDynamicCert: true,
            multiSigThreshold: 3,
            maxChainLength: 1,
            lockedConfig: 123,
            targetType: DataCert.GetType(),  // This needed to change, that's why a new chaincert.
            targetMaxExpireTime: Date.now() + 3600000,
            transientConfig: 1,
            cert: chainCert2.export(),
            constraints: Buffer.alloc(32).fill(111),
            dynamicSelfSpec: Buffer.alloc(128)},
            keyPair1.publicKey, keyPair1.secretKey);


        chainCert3c.sign(keyPair2);
        chainCert3c.sign(keyPair3);

        val = chainCert3c.validate();
        assert(val[0], val[1]);

        status = chainCert3c.verify();
        assert(status);

        expectedLength = (422+4+65*2-36)*2 + 422;  //=1462
        exportedLength = chainCert3c.export().length;
        assert(exportedLength === expectedLength, `${exportedLength} !== ${expectedLength}`);

        let dataCert = await certUtil.createDataCert({
            isLockedOnDataConfig: true,
            isLockedOnContentType: true,
            isLockedOnUserBits: true,
            creationTime, expireTime,
            targetPublicKeys: [keyPair1.publicKey, keyPair2.publicKey, keyPair3.publicKey],
            hasDynamicSelf: true,
            hasDynamicCert: true,
            multiSigThreshold: 3,
            maxChainLength: 0,
            lockedConfig: 123,
            targetType: Data.GetType(),
            targetMaxExpireTime: Date.now() + 3600000,
            transientConfig: 1,
            constraints: Buffer.alloc(32).fill(111),
            dynamicSelfSpec: Buffer.alloc(128),
            cert: chainCert3c.export(),
        }, keyPair1.publicKey, keyPair1.secretKey);

        dataCert.sign(keyPair2);
        dataCert.sign(keyPair3);

        val = dataCert.validate();
        assert(val[0], val[1]);

        status = dataCert.verify();
        assert(status);

        expectedLength = 1462 + 422 + 4 + 65*2 - 36; // 1982
        exportedLength = dataCert.export().length;
        assert(exportedLength === expectedLength, `${exportedLength} !== ${expectedLength}`);


        // LicenseCert
        //
        let chainCert3d = await certUtil.createChainCert({
            creationTime, expireTime,
            targetPublicKeys: [keyPair1.publicKey, keyPair2.publicKey, keyPair3.publicKey],
            hasDynamicSelf: true,
            hasDynamicCert: true,
            multiSigThreshold: 3,
            maxChainLength: 1,
            lockedConfig: 123,
            targetType: LicenseCert.GetType(),  // This needed to change, that's why a new chaincert.
            targetMaxExpireTime: Date.now() + 3600000,
            transientConfig: 1,
            cert: chainCert2.export(),
            constraints: Buffer.alloc(32).fill(111),
            dynamicSelfSpec: Buffer.alloc(128)},
            keyPair1.publicKey, keyPair1.secretKey);


        chainCert3d.sign(keyPair2);
        chainCert3d.sign(keyPair3);

        val = chainCert3d.validate();
        assert(val[0], val[1]);

        status = chainCert3d.verify();
        assert(status);

        expectedLength = (422+4+65*2-36)*2 + 422;  //=1462
        exportedLength = chainCert3d.export().length;
        assert(exportedLength === expectedLength, `${exportedLength} !== ${expectedLength}`);

        let licenseCert = await certUtil.createLicenseCert({
            maxExtensions: 10,
            isLockedOnLicenseTargetPublicKey: true,
            isLockedOnLicenseConfig: true,
            isLockedOnTerms: true,
            isLockedOnExtensions: true,
            isLockedOnFriendLevel: true,
            isLockedOnMaxExtensions: true,
            creationTime, expireTime,
            targetPublicKeys: [keyPair1.publicKey, keyPair2.publicKey, keyPair3.publicKey],
            hasDynamicSelf: true,
            hasDynamicCert: true,
            multiSigThreshold: 3,
            maxChainLength: 0,
            lockedConfig: 123,
            targetType: Data.GetType(),
            targetMaxExpireTime: Date.now() + 3600000,
            transientConfig: 1,
            constraints: Buffer.alloc(32).fill(111),
            dynamicSelfSpec: Buffer.alloc(128),
            cert: chainCert3d.export(),
        }, keyPair1.publicKey, keyPair1.secretKey);

        licenseCert.sign(keyPair2);
        licenseCert.sign(keyPair3);

        val = licenseCert.validate();
        assert(val[0], val[1]);

        status = licenseCert.verify();
        assert(status);

        expectedLength = 1462 + 422 + 4 + 65*2 - 36 + 3; // 1985
        exportedLength = licenseCert.export().length;
        assert(exportedLength === expectedLength, `${exportedLength} !== ${expectedLength}`);
    });

    it("countChainLength(): count the number of certs stacked together", async function() {
        const keyPair1 = Crypto.GenKeyPair();
        const keyPair2 = Crypto.GenKeyPair();
        const keyPair3 = Crypto.GenKeyPair();

        const certUtil = new CertUtil();
        const creationTime = 10;
        const expireTime = 100;

        let chainCert = await certUtil.createChainCert({creationTime, expireTime,
            targetPublicKeys: [keyPair1.publicKey, keyPair2.publicKey, keyPair3.publicKey],
            hasDynamicSelf: true,
            multiSigThreshold: 3,
            maxChainLength: 3,
            lockedConfig: 123,
            targetType: ChainCert.GetType(),
            targetMaxExpireTime: Date.now() + 3600000,
            transientConfig: 1,
            constraints: Buffer.alloc(32).fill(111),
            dynamicSelfSpec: Buffer.alloc(128)},
            keyPair2.publicKey, keyPair2.secretKey);

        assert(chainCert.countChainLength() == 1);
    });

    it("hash(): make sure cached cert object is properly set as cert image", async function() {
        const keyPair1 = Crypto.GenKeyPair();
        const keyPair2 = Crypto.GenKeyPair();
        const keyPair3 = Crypto.GenKeyPair();

        const certUtil = new CertUtil();
        const creationTime = 10;
        const expireTime = 100;

        const chainCert = await certUtil.createChainCert({creationTime, expireTime, targetPublicKeys: [keyPair1.publicKey, keyPair2.publicKey, keyPair3.publicKey], multiSigThreshold: 2, maxChainLength: 2}, keyPair2.publicKey, keyPair2.secretKey);
        const dataCert = await certUtil.createDataCert({creationTime, expireTime, targetPublicKeys: [keyPair1.publicKey], cert: chainCert.export(), maxChainLength: 1}, keyPair1.publicKey, keyPair1.secretKey);

        //@ts-ignore: direct access to protected data
        assert(!chainCert.cachedCertObject);
        assert(!chainCert.getCert());
        //@ts-ignore: direct access to protected data
        chainCert.cachedCertObject = dataCert;
        chainCert.hash();
        assert(chainCert.getCert());
    });

    it("setConfigBit(): bit toggling", async function() {
        const keyPair1 = Crypto.GenKeyPair();
        const keyPair2 = Crypto.GenKeyPair();
        const keyPair3 = Crypto.GenKeyPair();

        const certUtil = new CertUtil();
        const creationTime = 10;
        const expireTime = 100;

        const chainCert = await certUtil.createChainCert({creationTime, expireTime, targetPublicKeys: [keyPair1.publicKey, keyPair2.publicKey, keyPair3.publicKey], multiSigThreshold: 2, maxChainLength: 2}, keyPair2.publicKey, keyPair2.secretKey);

        chainCert.setConfig(3);
        assert(!chainCert.isConfigBitSet(3));
        //@ts-ignore: direct access to protected data
        chainCert.setConfigBit(3, true);
        assert(chainCert.isConfigBitSet(3));
        //@ts-ignore: direct access to protected data
        chainCert.setConfigBit(3, false);
        assert(!chainCert.isConfigBitSet(3));
    });

    it("setLockedConfigBit(): bit toggling", async function() {
        const keyPair1 = Crypto.GenKeyPair();
        const keyPair2 = Crypto.GenKeyPair();
        const keyPair3 = Crypto.GenKeyPair();

        const certUtil = new CertUtil();
        const creationTime = 10;
        const expireTime = 100;

        const chainCert = await certUtil.createChainCert({creationTime, expireTime, targetPublicKeys: [keyPair1.publicKey, keyPair2.publicKey, keyPair3.publicKey], multiSigThreshold: 2, maxChainLength: 2}, keyPair2.publicKey, keyPair2.secretKey);

        chainCert.setLockedConfig(5);
        assert(!chainCert.isLockedConfigBitSet(5));
        //@ts-ignore: direct access to protected data
        chainCert.setLockedConfigBit(5, true);
        assert(chainCert.isLockedConfigBitSet(5));
        //@ts-ignore: direct access to protected data
        chainCert.setLockedConfigBit(5, false);
        assert(!chainCert.isLockedConfigBitSet(5));
    });

    it("setTransientBit(): bit toggling", async function() {
        const keyPair1 = Crypto.GenKeyPair();
        const keyPair2 = Crypto.GenKeyPair();
        const keyPair3 = Crypto.GenKeyPair();

        const certUtil = new CertUtil();
        const creationTime = 10;
        const expireTime = 100;

        const chainCert = await certUtil.createChainCert({creationTime, expireTime, targetPublicKeys: [keyPair1.publicKey, keyPair2.publicKey, keyPair3.publicKey], multiSigThreshold: 2, maxChainLength: 2}, keyPair2.publicKey, keyPair2.secretKey);

        chainCert.setTransientConfig(7);
        //@ts-ignore: direct access to protected data
        assert(!chainCert.isTransientBitSet(7));
        //@ts-ignore: direct access to protected data
        chainCert.setTransientBit(7, true);
        //@ts-ignore: direct access to protected data
        assert(chainCert.isTransientBitSet(7));
        //@ts-ignore: direct access to protected data
        chainCert.setTransientBit(7, false);
        //@ts-ignore: direct access to protected data
        assert(!chainCert.isTransientBitSet(7));
    });


});
