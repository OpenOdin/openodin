import {
    assert,
} from "chai";

import {
    CRDTView,
    NodeUtil,
    Krypto,
} from "../../../src";

import * as fossilDelta from "fossil-delta";

describe("CRDTView", function() {
    it("should handle incoming nodes", async function() {
        const crdtView = new CRDTView();
        const keyPair = Krypto.GenKeyPair();

        const nodeUtil = new NodeUtil();

        const node1 = await nodeUtil.createDataNode({
            parentId: Buffer.alloc(32).fill(3),
            expireTime: 10000,
            creationTime: 1,
        }, keyPair.publicKey, keyPair.secretKey);

        const node2 = await nodeUtil.createDataNode({
            parentId: Buffer.alloc(32).fill(3),
            expireTime: 10000,
            creationTime: 1,
        }, keyPair.publicKey, keyPair.secretKey);

        let currentList = Buffer.alloc(0);
        let newList = Buffer.concat([node1.getId1() as Buffer]);

        //@ts-ignore
        let patch = fossilDelta.create(currentList, newList);
        let delta = Buffer.concat([Buffer.from([0]), Buffer.from(JSON.stringify({patch}))]);

        crdtView.handleResponse({
            //@ts-ignore
            result: {
                nodes: [node1.pack()],
            },
            //@ts-ignore
            crdtResult: {
                delta,
            },
            seq: 1,
            endSeq: 1,
        });

        //@ts-ignore
        assert(crdtView.model.list.length === 1);
        //@ts-ignore
        assert(crdtView.model.list[0].equals(node1.getId1()));

        currentList = newList;
        newList = Buffer.concat([node2.getId1() as Buffer, node1.getId1() as Buffer]);
        patch = fossilDelta.create(currentList, newList);
        delta = Buffer.concat([Buffer.from([0]), Buffer.from(JSON.stringify({patch}))]);

        crdtView.handleResponse({
            //@ts-ignore
            result: {
                nodes: [node2.pack()],
            },
            //@ts-ignore
            crdtResult: {
                delta,
            },
            seq: 1,
            endSeq: 1,
        });

        //@ts-ignore
        assert(crdtView.model.list.length === 2);
        //@ts-ignore
        assert(crdtView.model.list[0].equals(node2.getId1()));
        //@ts-ignore
        assert(crdtView.model.list[1].equals(node1.getId1()));


        currentList = newList;
        newList = Buffer.concat([node2.getId1() as Buffer]);

        patch = fossilDelta.create(currentList, newList);
        delta = Buffer.concat([Buffer.from([0]), Buffer.from(JSON.stringify({patch}))]);

        crdtView.handleResponse({
            //@ts-ignore
            result: {
                nodes: [node2.pack()],
            },
            //@ts-ignore
            crdtResult: {
                delta,
            },
            seq: 1,
            endSeq: 1,
        });

        //@ts-ignore
        assert(crdtView.model.list.length === 1);
        //@ts-ignore
        assert(crdtView.model.list[0].equals(node2.getId1()));
    });
});
