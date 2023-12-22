// TODO add deletionTracking test
// test given cursorIndex
//
import { assert, expect } from "chai";

import {
    DataInterface,
    Crypto,
    NodeUtil,
    NodeValues,
    ExtractNodeValues,
    ExtractNodeValuesRefId,
    CRDTMessagesAnnotations,
} from "../../../src";

import {
    AlgoSorted,
    AlgoRefId,
    AlgoInterface,
} from "../../../src/storage/crdt";

async function testSorted(algoSorted: AlgoInterface) {
    const nodeUtil = new NodeUtil();

    const keyPair = Crypto.GenKeyPair();

    const node1 = await nodeUtil.createDataNode({creationTime: 10, parentId: Buffer.alloc(32).fill(1)}, keyPair.publicKey, keyPair.secretKey);
    const node1copy = await nodeUtil.createDataNode({creationTime: 10, parentId: Buffer.alloc(32).fill(1)}, keyPair.publicKey, keyPair.secretKey);

    assert(node1.getId1()?.equals(node1copy.getId1()!));

    node1copy.setDynamicSelfActive();

    let [addedNodes, transientNodes] = algoSorted.add([node1]);
    assert(addedNodes.length === 1);
    assert(transientNodes.length === 0);

    [addedNodes, transientNodes] = algoSorted.add([node1copy]);
    assert(addedNodes.length === 0);
    assert(transientNodes.length === 1);
    assert(transientNodes[0].equals(node1copy.getId1()!));

    let indexes = algoSorted.getIndexes([ExtractNodeValues(node1)]);
    assert(indexes.length === 1);
    assert(indexes[0] === 0);

    indexes = algoSorted.getIndexes([ExtractNodeValues(node1copy)]);
    assert(indexes.length === 1);
    assert(indexes[0] === 0);



    const node2 = await nodeUtil.createDataNode({creationTime: 11, parentId: Buffer.alloc(32).fill(1)}, keyPair.publicKey, keyPair.secretKey);

    [addedNodes, transientNodes] = algoSorted.add([node2]);
    assert(addedNodes.length === 1);
    assert(transientNodes.length === 0);

    indexes = algoSorted.getIndexes([node2, node1copy].map(ExtractNodeValues));
    assert(indexes.length === 2);
    assert(indexes[0] === 1);
    assert(indexes[1] === 0);

    algoSorted.delete([0]);

    assert.throws( () => algoSorted.getIndexes([node2, node1copy].map(ExtractNodeValues)) );

    const node3 = await nodeUtil.createDataNode({creationTime: 12, parentId: Buffer.alloc(32).fill(1)}, keyPair.publicKey, keyPair.secretKey);
    [addedNodes, transientNodes] = algoSorted.add([node3, node1]);
    assert(addedNodes.length === 2);
    assert(transientNodes.length === 0);

    indexes = algoSorted.getIndexes([node2, node1copy, node3].map(ExtractNodeValues));
    assert(indexes.length === 3);
    assert(indexes[0] === 1);
    assert(indexes[1] === 0);
    assert(indexes[2] === 2);

    let nodes: NodeValues[];
    //@ts-ignore
    [nodes, indexes] = algoSorted.get(undefined, -1, 0, 0);
    assert(nodes.length === 0);
    assert(indexes.length === 0);

    //@ts-ignore
    [nodes, indexes] = algoSorted.get(undefined, -1, 1, 0);
    assert(nodes.length === 1);
    assert(indexes.length === 1);
    assert(nodes[0].id1.equals(node1.getId1()!));

    //@ts-ignore
    [nodes, indexes] = algoSorted.get(undefined, -1, 3, 0);
    assert(nodes.length === 3);
    assert(indexes.length === 3);
    assert(nodes[0].id1.equals(node1.getId1()!));
    assert(nodes[1].id1.equals(node2.getId1()!));
    assert(nodes[2].id1.equals(node3.getId1()!));

    //@ts-ignore
    [nodes, indexes] = algoSorted.get(undefined, -1, 0, -1);
    assert(nodes.length === 3);
    assert(indexes.length === 3);
    assert(nodes[0].id1.equals(node1.getId1()!));
    assert(nodes[1].id1.equals(node2.getId1()!));
    assert(nodes[2].id1.equals(node3.getId1()!));

    //@ts-ignore
    [nodes, indexes] = algoSorted.get(node2.getId1(), -1, 3, 0);
    assert(nodes.length === 1);
    assert(indexes.length === 1);
    assert(nodes[0].id1.equals(node3.getId1()!));

    //@ts-ignore
    [nodes, indexes] = algoSorted.get(node2.getId1(), -1, 0, 1);
    assert(nodes.length === 1);
    assert(indexes.length === 1);
    assert(nodes[0].id1.equals(node1.getId1()!));
}

describe("Annotations", function() {
    it("CRDTMessagesAnnotations", function() {
        const id1 = Buffer.alloc(32).fill(0x01);
        const id1b = Buffer.alloc(32).fill(0x02);
        const id1c = Buffer.alloc(32).fill(0x03);
        const id1d = Buffer.alloc(32).fill(0x04);
        const id1e = Buffer.alloc(32).fill(0x05);
        const id1f = Buffer.alloc(32).fill(0x06);
        const owner = Buffer.alloc(32).fill(0xa1);
        const owner2 = Buffer.alloc(32).fill(0xa2);
        const targetPublicKey = owner2.toString("hex");
        const creationTime = 10;

        const annotations = new CRDTMessagesAnnotations(targetPublicKey);

        annotations.addReaction(id1, creationTime, owner, "react/thumbsup");

        annotations.addReaction(id1b, creationTime - 1, owner, "unreact/thumbsup");

        //@ts-ignore
        assert(annotations.aggregatedReactions["thumbsup"][owner.toString("hex")].length === 2);

        //@ts-ignore
        annotations.condenseReactionAggregations();

        //@ts-ignore
        assert(annotations.aggregatedReactions["thumbsup"][owner.toString("hex")].length === 1);

        annotations.addReaction(id1c, creationTime + 1, owner, "unreact/thumbsup");

        //@ts-ignore
        annotations.condenseReactionAggregations();

        //@ts-ignore
        assert(annotations.aggregatedReactions["thumbsup"] === undefined);


        annotations.addReaction(id1d, creationTime, owner, "react/smile");
        annotations.addReaction(id1e, creationTime + 1, owner2, "react/smile");
        annotations.addReaction(id1f, creationTime - 1, owner2, "react/smile");

        //@ts-ignore
        annotations.condenseReactionAggregations();

        //@ts-ignore
        const reactions = annotations.parseAggregatedReactions();

        //@ts-ignore
        assert(reactions.reactions.smile.count === 2);

        //@ts-ignore
        assert(reactions.reactions.smile.publicKeys[0] === targetPublicKey);
        //@ts-ignore
        assert(reactions.reactions.smile.publicKeys[1].length > 0);
        //@ts-ignore
        assert(reactions.reactions.smile.publicKeys[1] !== targetPublicKey);
        //@ts-ignore
        assert(reactions.hasMore === false);

        let l = JSON.stringify(reactions).length;

        //@ts-ignore
        annotations.limitReactionsSize(reactions, l - 1);

        //@ts-ignore
        assert(reactions.hasMore === true);
        //@ts-ignore
        assert(reactions.reactions.smile.count === 2);
        //@ts-ignore
        assert(reactions.reactions.smile.publicKeys.length === 1);
        //@ts-ignore
        assert(reactions.reactions.smile.publicKeys[0] === targetPublicKey);
    });
});

describe("CRDT AlgoSorted", function() {
    it("should sort nodes as expected", async function() {
        await testSorted(new AlgoSorted());
    });

    it("should be able to sort on storageTime instead of creationTime", async function() {
        const nodeUtil = new NodeUtil();

        const keyPair = Crypto.GenKeyPair();

        const node1 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x01),
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 10,
            parentId: Buffer.alloc(32).fill(0xe1),
            transientStorageTime: 2,
        });

        const node2 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x02),
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 11,
            parentId: Buffer.alloc(32).fill(0xe2),
            transientStorageTime: 1,
        });

        const node3 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x03),
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 10,
            parentId: Buffer.alloc(32).fill(0xe0),
            transientStorageTime: 1,
        });

        const node4 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x04),
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 10,
            parentId: Buffer.alloc(32).fill(0xe0),
            transientStorageTime: 1,
        });

        let algoSorted = new AlgoSorted(false);
        algoSorted.add([node2, node1, node3]);
        let indexes = algoSorted.getIndexes([node1, node2, node3].map(ExtractNodeValues));
        assert(indexes.length === 3);
        assert(indexes[0] === 0);
        assert(indexes[1] === 2);
        assert(indexes[2] === 1);

        algoSorted = new AlgoSorted(false);
        //reverse
        algoSorted.add([node2, node1, node3]);
        let [nodes, revIndexes] = algoSorted.get(undefined, -1, 3, 0, true);
        assert(revIndexes.length === 3);
        assert(revIndexes[0] === 2);
        assert(revIndexes[1] === 1);
        assert(revIndexes[2] === 0);
        assert(nodes[0].id1.equals(node2.getId1()!));
        assert(nodes[1].id1.equals(node3.getId1()!));
        assert(nodes[2].id1.equals(node1.getId1()!));

        algoSorted = new AlgoSorted(true);
        algoSorted.add([node2, node1, node3, node4]);
        indexes = algoSorted.getIndexes([node1, node2, node3, node4].map(ExtractNodeValues));
        assert(indexes.length === 4);
        assert(indexes[0] === 3);
        assert(indexes[1] === 2);
        assert(indexes[2] === 0);
        assert(indexes[3] === 1);

        algoSorted = new AlgoSorted(true);
        //reverse
        algoSorted.add([node2, node1, node3, node4]);
        [nodes, revIndexes] = algoSorted.get(undefined, -1, 4, 0, true);
        assert(revIndexes.length === 4);
        assert(revIndexes[0] === 3);
        assert(revIndexes[1] === 2);
        assert(revIndexes[2] === 1);
        assert(revIndexes[3] === 0);
        assert(nodes[0].id1.equals(node1.getId1()!));
        assert(nodes[1].id1.equals(node2.getId1()!));
        assert(nodes[2].id1.equals(node4.getId1()!));
        assert(nodes[3].id1.equals(node3.getId1()!));
    });
});

describe("CRDT AlgoSorted with annotations", function() {
    it("should not treat annotation nodes differently if not configured to do so", async function() {
        const nodeUtil = new NodeUtil();

        const keyPair = Crypto.GenKeyPair();

        const node1 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x01),
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 10,
            parentId: Buffer.alloc(32).fill(0xe1),
            transientStorageTime: 2,
        });

        const node2 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x02),
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 11,
            parentId: Buffer.alloc(32).fill(0xe1),
            transientStorageTime: 1,
        });

        const annotationNode1 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x03),
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 10,
            parentId: node1.getId(),
            transientStorageTime: 1,
        });

        annotationNode1.setAnnotationEdit()

        const targetPublicKey = Buffer.alloc(32);

        const conf = "";

        let algoSorted = new AlgoSorted(false, conf, targetPublicKey.toString("hex"));
        algoSorted.add([node1, node2, annotationNode1]);
        let ret = algoSorted.get(undefined, -1, -1, 0, false);
        assert(ret);
        assert(ret[0].length === 3);
    });

    it("should detect edit annotations", async function() {
        const nodeUtil = new NodeUtil();

        const keyPair = Crypto.GenKeyPair();

        const node1 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x01),
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 10,
            parentId: Buffer.alloc(32).fill(0xe1),
            transientStorageTime: 2,
        });

        const node2 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x02),
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 11,
            parentId: Buffer.alloc(32).fill(0xe1),
            transientStorageTime: 1,
        });

        const annotationNode1 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x03),
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 13,
            parentId: node1.getId(),
            transientStorageTime: 1,
        });

        annotationNode1.setAnnotationEdit()

        const targetPublicKey = Buffer.alloc(32);

        const conf = JSON.stringify({
            annotations: {
                format: "messages",
            },
        });

        let algoSorted = new AlgoSorted(false, conf, targetPublicKey.toString("hex"));
        algoSorted.add([node1, node2, annotationNode1]);
        let ret = algoSorted.get(undefined, -1, -1, 0, false);
        assert(ret);
        assert(ret[0].length === 2);  // only 2 nodes returned since one is consumed for annotations.

        assert(ret[0][0].annotations?.getEditNode()?.getId1()?.equals(annotationNode1.getId1()!));

        const annotationNode2 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x04),
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 10,
            parentId: node1.getId(),
            transientStorageTime: 1,
        });

        annotationNode2.setAnnotationEdit()

        algoSorted.add([annotationNode2]);
        ret = algoSorted.get(undefined, -1, -1, 0, false);
        assert(ret);
        assert(ret[0].length === 2);

        // No change since creaionTime is older
        assert(ret[0][0].annotations?.getEditNode()?.getId1()?.equals(annotationNode1.getId1()!));

        const annotationNode3 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x06),
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 14,
            parentId: node1.getId(),
            transientStorageTime: 1,
        });

        annotationNode3.setAnnotationEdit()

        algoSorted.add([annotationNode3]);
        ret = algoSorted.get(undefined, -1, -1, 0, false);
        assert(ret);
        assert(ret[0].length === 2);

        assert(ret[0][0].annotations?.getEditNode()?.getId1()?.equals(annotationNode3.getId1()!));

        const annotationNode4 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x05), // lesser id1 than annotationNode3
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 14,
            parentId: node1.getId(),
            transientStorageTime: 1,
        });

        annotationNode4.setAnnotationEdit()

        algoSorted.add([annotationNode4]);
        ret = algoSorted.get(undefined, -1, -1, 0, false);
        assert(ret);
        assert(ret[0].length === 2);

        assert(ret[0][0].annotations?.getEditNode()?.getId1()?.equals(annotationNode3.getId1()!));
    });

    it("should detect reaction annotations", async function() {
        const nodeUtil = new NodeUtil();

        const keyPair = Crypto.GenKeyPair();

        const node1 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x01),
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 10,
            parentId: Buffer.alloc(32).fill(0xe1),
            transientStorageTime: 2,
        });

        const node2 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x02),
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 11,
            parentId: Buffer.alloc(32).fill(0xe1),
            transientStorageTime: 1,
        });

        const annotationNode1 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x03),
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 13,
            parentId: node1.getId(),
            transientStorageTime: 1,
            data: Buffer.from("react/thumbsup"),
        });

        annotationNode1.setAnnotationReaction();

        const targetPublicKey = Buffer.alloc(32).fill(0xa1);

        const conf = JSON.stringify({
            annotations: {
                format: "messages",
            },
        });

        let algoSorted = new AlgoSorted(false, conf, targetPublicKey.toString("hex"));
        algoSorted.add([node1, node2, annotationNode1]);
        let ret = algoSorted.get(undefined, -1, -1, 0, false);
        assert(ret);
        assert(ret[0].length === 2);  // only 2 nodes returned since one is consumed for annotations.

        assert(ret[0][0].annotations?.getEditNode() === undefined);
    });

    it("should detect nested conversations annotations", async function() {
        const nodeUtil = new NodeUtil();

        const keyPair = Crypto.GenKeyPair();

        const node1 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x01),
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 10,
            parentId: Buffer.alloc(32).fill(0xe1),
            transientStorageTime: 2,
        });

        const node2 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x02),
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 11,
            parentId: Buffer.alloc(32).fill(0xe1),
            transientStorageTime: 1,
        });

        const annotationNode1 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x03),
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 13,
            parentId: node1.getId(),
            transientStorageTime: 1,
            data: Buffer.from("react/thumbsup"),
        });

        const targetPublicKey = Buffer.alloc(32).fill(0xa1);

        const conf = JSON.stringify({
            annotations: {
                format: "messages",
            },
        });

        let algoSorted = new AlgoSorted(false, conf, targetPublicKey.toString("hex"));
        algoSorted.add([node1, node2, annotationNode1]);
        let ret = algoSorted.get(undefined, -1, -1, 0, false);
        assert(ret);
        assert(ret[0].length === 2);  // only 2 nodes returned since one is consumed for annotations.

        assert(ret[0][0].annotations?.getEditNode() === undefined);
        assert(ret[0][0].annotations?.hasNestedConversation());
    });
});

describe("CRDT AlgoRefId with annotations", function() {
    it("should not treat annotation nodes differently if not configured to do so", async function() {
        const nodeUtil = new NodeUtil();

        const keyPair = Crypto.GenKeyPair();

        const node1 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x01),
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 10,
            parentId: Buffer.alloc(32).fill(0xe1),
            transientStorageTime: 2,
        });

        const node2 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x02),
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 11,
            parentId: Buffer.alloc(32).fill(0xe1),
            transientStorageTime: 1,
        });

        const annotationNode1 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x03),
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 10,
            parentId: node1.getId(),
            transientStorageTime: 1,
        });

        annotationNode1.setAnnotationEdit()

        const targetPublicKey = Buffer.alloc(32);

        const conf = "";

        let algoSorted = new AlgoRefId(false, conf, targetPublicKey.toString("hex"));
        algoSorted.add([node1, node2, annotationNode1]);
        let ret = algoSorted.get(undefined, -1, -1, 0, false);
        assert(ret);
        assert(ret[0].length === 3);
    });

    it("should detect edit annotations", async function() {
        const nodeUtil = new NodeUtil();

        const keyPair = Crypto.GenKeyPair();

        const node1 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x01),
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 10,
            parentId: Buffer.alloc(32).fill(0xe1),
            transientStorageTime: 2,
        });

        const node2 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x02),
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 11,
            parentId: Buffer.alloc(32).fill(0xe1),
            transientStorageTime: 1,
        });

        const annotationNode1 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x03),
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 13,
            parentId: node1.getId(),
            transientStorageTime: 1,
        });

        annotationNode1.setAnnotationEdit()

        const targetPublicKey = Buffer.alloc(32);

        const conf = JSON.stringify({
            annotations: {
                format: "messages",
            },
        });

        let algoSorted = new AlgoRefId(false, conf, targetPublicKey.toString("hex"));
        algoSorted.add([node1, node2, annotationNode1]);
        let ret = algoSorted.get(undefined, -1, -1, 0, false);
        assert(ret);
        assert(ret[0].length === 2);  // only 2 nodes returned since one is consumed for annotations.

        assert(ret[0][0].annotations?.getEditNode()?.getId1()?.equals(annotationNode1.getId1()!));

        const annotationNode2 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x04),
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 10,
            parentId: node1.getId(),
            transientStorageTime: 1,
        });

        annotationNode2.setAnnotationEdit()

        algoSorted.add([annotationNode2]);
        ret = algoSorted.get(undefined, -1, -1, 0, false);
        assert(ret);
        assert(ret[0].length === 2);

        // No change since creaionTime is older
        assert(ret[0][0].annotations?.getEditNode()?.getId1()?.equals(annotationNode1.getId1()!));

        const annotationNode3 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x06),
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 14,
            parentId: node1.getId(),
            transientStorageTime: 1,
        });

        annotationNode3.setAnnotationEdit()

        algoSorted.add([annotationNode3]);
        ret = algoSorted.get(undefined, -1, -1, 0, false);
        assert(ret);
        assert(ret[0].length === 2);

        assert(ret[0][0].annotations?.getEditNode()?.getId1()?.equals(annotationNode3.getId1()!));

        const annotationNode4 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x05), // lesser id1 than annotationNode3
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 14,
            parentId: node1.getId(),
            transientStorageTime: 1,
        });

        annotationNode4.setAnnotationEdit()

        algoSorted.add([annotationNode4]);
        ret = algoSorted.get(undefined, -1, -1, 0, false);
        assert(ret);
        assert(ret[0].length === 2);

        assert(ret[0][0].annotations?.getEditNode()?.getId1()?.equals(annotationNode3.getId1()!));
    });

    it("should detect reaction annotations", async function() {
        const nodeUtil = new NodeUtil();

        const keyPair = Crypto.GenKeyPair();

        const node1 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x01),
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 10,
            parentId: Buffer.alloc(32).fill(0xe1),
            transientStorageTime: 2,
        });

        const node2 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x02),
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 11,
            parentId: Buffer.alloc(32).fill(0xe1),
            transientStorageTime: 1,
        });

        const annotationNode1 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x03),
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 13,
            parentId: node1.getId(),
            transientStorageTime: 1,
            data: Buffer.from("react/thumbsup"),
        });

        annotationNode1.setAnnotationReaction();

        const targetPublicKey = Buffer.alloc(32).fill(0xa1);

        const conf = JSON.stringify({
            annotations: {
                format: "messages",
            },
        });

        let algoSorted = new AlgoRefId(false, conf, targetPublicKey.toString("hex"));
        algoSorted.add([node1, node2, annotationNode1]);
        let ret = algoSorted.get(undefined, -1, -1, 0, false);
        assert(ret);
        assert(ret[0].length === 2);  // only 2 nodes returned since one is consumed for annotations.

        assert(ret[0][0].annotations?.getEditNode() === undefined);
    });

    it("should detect nested conversations annotations", async function() {
        const nodeUtil = new NodeUtil();

        const keyPair = Crypto.GenKeyPair();

        const node1 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x01),
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 10,
            parentId: Buffer.alloc(32).fill(0xe1),
            transientStorageTime: 2,
        });

        const node2 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x02),
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 11,
            parentId: Buffer.alloc(32).fill(0xe1),
            transientStorageTime: 1,
        });

        const annotationNode1 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x03),
            owner: Buffer.alloc(32).fill(0xa1),
            creationTime: 13,
            parentId: node1.getId(),
            transientStorageTime: 1,
            data: Buffer.from("react/thumbsup"),
        });

        const targetPublicKey = Buffer.alloc(32).fill(0xa1);

        const conf = JSON.stringify({
            annotations: {
                format: "messages",
            },
        });

        let algoSorted = new AlgoRefId(false, conf, targetPublicKey.toString("hex"));
        algoSorted.add([node1, node2, annotationNode1]);
        let ret = algoSorted.get(undefined, -1, -1, 0, false);
        assert(ret);
        assert(ret[0].length === 2);  // only 2 nodes returned since one is consumed for annotations.

        assert(ret[0][0].annotations?.getEditNode() === undefined);
        assert(ret[0][0].annotations?.hasNestedConversation());
    });
});

describe("CRDT AlgoRefId", function() {
    it("should sort nodes on creationTime as expected", async function() {
        testSorted(new AlgoRefId());
    });

    it("should sort on refId as expected", async function() {
        const nodeUtil = new NodeUtil();

        const algo = new AlgoRefId();

        const keyPair = Crypto.GenKeyPair();

        const node1 = await nodeUtil.createDataNode({data: Buffer.from("node1"), creationTime: 10, parentId: Buffer.alloc(32).fill(1)}, keyPair.publicKey, keyPair.secretKey);
        const node1_1 = await nodeUtil.createDataNode({data: Buffer.from("node1_1"), creationTime: 9, refId: node1.getId1(), parentId: Buffer.alloc(32).fill(1)}, keyPair.publicKey, keyPair.secretKey);
        const node1_1_1 = await nodeUtil.createDataNode({data: Buffer.from("node1_1_1"), creationTime: 0, refId: node1_1.getId1(), parentId: Buffer.alloc(32).fill(1)}, keyPair.publicKey, keyPair.secretKey);

        let [addedNodes, transientNodes] = algo.add([node1, node1_1, node1_1_1]);
        assert(addedNodes.length === 3);
        assert(transientNodes.length === 0);

        let indexes = algo.getIndexes([node1, node1_1, node1_1_1].map(ExtractNodeValuesRefId));
        assert(indexes.length === 3);
        assert(indexes[0] === 0);
        assert(indexes[1] === 1);
        assert(indexes[2] === 2);


        const node0 = await nodeUtil.createDataNode({data: Buffer.from("node0"), creationTime: 9, parentId: Buffer.alloc(32).fill(1)}, keyPair.publicKey, keyPair.secretKey);
        const node0_1 = await nodeUtil.createDataNode({data: Buffer.from("node0_1"), creationTime: 120, refId: node0.getId1(), parentId: Buffer.alloc(32).fill(1)}, keyPair.publicKey, keyPair.secretKey);


        // Insert orphan
        [addedNodes, transientNodes] = algo.add([node0_1]);
        assert(addedNodes.length === 1);
        assert(transientNodes.length === 0);

        indexes = algo.getIndexes([node1, node1_1, node1_1_1, node0_1].map(ExtractNodeValuesRefId));
        assert(indexes.length === 4);
        assert(indexes[0] === 0);
        assert(indexes[1] === 2);
        assert(indexes[2] === 3);
        assert(indexes[3] === 1);


        // Insert orphan missing parent.
        [addedNodes, transientNodes] = algo.add([node0]);
        assert(addedNodes.length === 1);
        assert(transientNodes.length === 0);

        indexes = algo.getIndexes([node0, node1, node0_1, node1_1, node1_1_1].map(ExtractNodeValuesRefId));
        assert(indexes.length === 5);
        assert(indexes[0] === 0);
        assert(indexes[1] === 1);
        assert(indexes[2] === 3);
        assert(indexes[3] === 2);
        assert(indexes[4] === 4);

        let nodes;

        /// head
        let ret = algo.get(undefined, -1, 1, 0, false);
        assert(ret);
        [nodes, indexes] = ret;
        assert(indexes.length === 1);
        assert(nodes[0].id1.equals(node0.getId1()!));

        ret = algo.get(undefined, -1, -1, 0, false);
        assert(ret);
        [nodes, indexes] = ret;

        assert(indexes.length === 5);
        assert(nodes[0].id1.equals(node0.getId1()!));
        assert(nodes[1].id1.equals(node1.getId1()!));
        assert(nodes[2].id1.equals(node1_1.getId1()!));
        assert(nodes[3].id1.equals(node0_1.getId1()!));
        assert(nodes[4].id1.equals(node1_1_1.getId1()!));

        ret = algo.get(undefined, -1, 4, 0, true);
        assert(ret);
        [nodes, indexes] = ret;

        assert(indexes.length === 4);
        assert(nodes[0].id1.equals(node1_1_1.getId1()!));
        assert(nodes[1].id1.equals(node0_1.getId1()!));
        assert(nodes[2].id1.equals(node1_1.getId1()!));
        assert(nodes[3].id1.equals(node1.getId1()!));

        ret = algo.get(node0_1.getId1(), -1, -1, 0, true);
        assert(ret);
        [nodes, indexes] = ret;

        assert(indexes.length === 3);
        assert(nodes[0].id1.equals(node1_1.getId1()!));
        assert(nodes[1].id1.equals(node1.getId1()!));
        assert(nodes[2].id1.equals(node0.getId1()!));

        /// tail
        ret = algo.get(undefined, -1, 0, 1, false);
        assert(ret);
        [nodes, indexes] = ret;

        assert(indexes.length === 1);
        assert(nodes[0].id1.equals(node1_1_1.getId1()!));

        ret = algo.get(undefined, -1, 0, -1, false);
        assert(ret);
        [nodes, indexes] = ret;

        assert(indexes.length === 5);
        assert(nodes[0].id1.equals(node0.getId1()!));
        assert(nodes[1].id1.equals(node1.getId1()!));
        assert(nodes[2].id1.equals(node1_1.getId1()!));
        assert(nodes[3].id1.equals(node0_1.getId1()!));
        assert(nodes[4].id1.equals(node1_1_1.getId1()!));

        ret = algo.get(node0_1.getId1(), -1, 0, -1, false);
        assert(ret);
        [nodes, indexes] = ret;

        assert(indexes.length === 3);
        assert(nodes[0].id1.equals(node0.getId1()!));
        assert(nodes[1].id1.equals(node1.getId1()!));
        assert(nodes[2].id1.equals(node1_1.getId1()!));

        ret = algo.get(undefined, -1, 0, 4, true);
        assert(ret);
        [nodes, indexes] = ret;

        assert(indexes.length === 4);
        assert(nodes[3].id1.equals(node0.getId1()!));
        assert(nodes[2].id1.equals(node1.getId1()!));
        assert(nodes[1].id1.equals(node1_1.getId1()!));
        assert(nodes[0].id1.equals(node0_1.getId1()!));

        ret = algo.get(undefined, -1, 0, -1, true);
        assert(ret);
        [nodes, indexes] = ret;

        assert(indexes.length === 5);
        assert(nodes[4].id1.equals(node0.getId1()!));
        assert(nodes[3].id1.equals(node1.getId1()!));
        assert(nodes[2].id1.equals(node1_1.getId1()!));
        assert(nodes[1].id1.equals(node0_1.getId1()!));
        assert(nodes[0].id1.equals(node1_1_1.getId1()!));

        ret = algo.get(node1_1.getId1(), -1, 0, -1, true);
        assert(ret);
        [nodes, indexes] = ret;

        assert(indexes.length === 2);
        assert(nodes[1].id1.equals(node0_1.getId1()!));
        assert(nodes[0].id1.equals(node1_1_1.getId1()!));
    });
});
