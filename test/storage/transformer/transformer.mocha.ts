import { assert, expect } from "chai";

import {
    NodeInterface,
    Node,
    NodeUtil,
} from "../../../src";

import {
    Transformer,
    AlgoSorted,
    AlgoRefId,
    AlgoInterface,
} from "../../../src/storage/transformer";

async function testSorted(algoSorted: AlgoInterface) {
    const nodeUtil = new NodeUtil();

    const keyPair = Node.GenKeyPair();

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
    assert(transientNodes[0] === node1copy);

    let indexes = algoSorted.getIndexes([node1]);
    assert(indexes.length === 1);
    assert(indexes[0] === 0);

    indexes = algoSorted.getIndexes([node1copy]);
    assert(indexes.length === 1);
    assert(indexes[0] === 0);



    const node2 = await nodeUtil.createDataNode({creationTime: 11, parentId: Buffer.alloc(32).fill(1)}, keyPair.publicKey, keyPair.secretKey);

    [addedNodes, transientNodes] = algoSorted.add([node2]);
    assert(addedNodes.length === 1);
    assert(transientNodes.length === 0);

    indexes = algoSorted.getIndexes([node2, node1copy]);
    assert(indexes.length === 2);
    assert(indexes[0] === 1);
    assert(indexes[1] === 0);

    algoSorted.delete([0]);

    assert.throws( () => algoSorted.getIndexes([node2, node1copy]) );

    const node3 = await nodeUtil.createDataNode({creationTime: 12, parentId: Buffer.alloc(32).fill(1)}, keyPair.publicKey, keyPair.secretKey);
    [addedNodes, transientNodes] = algoSorted.add([node3, node1]);
    assert(addedNodes.length === 2);
    assert(transientNodes.length === 0);

    indexes = algoSorted.getIndexes([node2, node1copy, node3]);
    assert(indexes.length === 3);
    assert(indexes[0] === 1);
    assert(indexes[1] === 0);
    assert(indexes[2] === 2);

    let nodes: NodeInterface[];
    //@ts-ignore
    [nodes, indexes] = algoSorted.get(undefined, 0, 0);
    assert(nodes.length === 0);
    assert(indexes.length === 0);

    //@ts-ignore
    [nodes, indexes] = algoSorted.get(undefined, 1, 0);
    assert(nodes.length === 1);
    assert(indexes.length === 1);
    assert(nodes[0] === node1);

    //@ts-ignore
    [nodes, indexes] = algoSorted.get(undefined, 3, 0);
    assert(nodes.length === 3);
    assert(indexes.length === 3);
    assert(nodes[0] === node1);
    assert(nodes[1] === node2);
    assert(nodes[2] === node3);

    //@ts-ignore
    [nodes, indexes] = algoSorted.get(undefined, 0, -1);
    assert(nodes.length === 3);
    assert(indexes.length === 3);
    assert(nodes[0] === node1);
    assert(nodes[1] === node2);
    assert(nodes[2] === node3);

    //@ts-ignore
    [nodes, indexes] = algoSorted.get(node2.getId1(), 3, 0);
    assert(nodes.length === 1);
    assert(indexes.length === 1);
    assert(nodes[0] === node3);

    //@ts-ignore
    [nodes, indexes] = algoSorted.get(node2.getId1(), 0, 1);
    assert(nodes.length === 1);
    assert(indexes.length === 1);
    assert(nodes[0] === node1);
}

describe("Transformer AlgoSorted", function() {
    it("should sort nodes as expected", async function() {
        await testSorted(new AlgoSorted());
    });

    it("should be able to sort on storageTime instead of creationTime", async function() {
        const nodeUtil = new NodeUtil();

        const keyPair = Node.GenKeyPair();

        const node1 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x01),
            creationTime: 10,
            parentId: Buffer.alloc(32).fill(0x01),
            transientStorageTime: 2,
        });

        const node2 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x02),
            creationTime: 11,
            parentId: Buffer.alloc(32).fill(0x02),
            transientStorageTime: 1,
        });

        const node3 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x03),
            creationTime: 10,
            parentId: Buffer.alloc(32).fill(0x00),
            transientStorageTime: 1,
        });

        const node4 = await nodeUtil.createDataNode({
            id1: Buffer.alloc(32).fill(0x04),
            creationTime: 10,
            parentId: Buffer.alloc(32).fill(0x00),
            transientStorageTime: 1,
        });

        let algoSorted = new AlgoSorted(undefined, false);
        algoSorted.add([node2, node1, node3]);
        let indexes = algoSorted.getIndexes([node1, node2, node3]);
        assert(indexes.length === 3);
        assert(indexes[0] === 0);
        assert(indexes[1] === 2);
        assert(indexes[2] === 1);

        algoSorted = new AlgoSorted(undefined, false);
        //reverse
        algoSorted.add([node2, node1, node3]);
        let [nodes, revIndexes] = algoSorted.get(undefined, 3, 0, true);
        assert(revIndexes.length === 3);
        assert(revIndexes[0] === 2);
        assert(revIndexes[1] === 1);
        assert(revIndexes[2] === 0);
        assert(nodes[0] === node2);
        assert(nodes[1] === node3);
        assert(nodes[2] === node1);

        algoSorted = new AlgoSorted(undefined, true);
        algoSorted.add([node2, node1, node3, node4]);
        indexes = algoSorted.getIndexes([node1, node2, node3, node4]);
        assert(indexes.length === 4);
        assert(indexes[0] === 3);
        assert(indexes[1] === 2);
        assert(indexes[2] === 0);
        assert(indexes[3] === 1);

        algoSorted = new AlgoSorted(undefined, true);
        //reverse
        algoSorted.add([node2, node1, node3, node4]);
        [nodes, revIndexes] = algoSorted.get(undefined, 4, 0, true);
        assert(revIndexes.length === 4);
        assert(revIndexes[0] === 3);
        assert(revIndexes[1] === 2);
        assert(revIndexes[2] === 1);
        assert(revIndexes[3] === 0);
        assert(nodes[0] === node1);
        assert(nodes[1] === node2);
        assert(nodes[2] === node4);
        assert(nodes[3] === node3);
    });
});

describe("Transformer AlgoRefId", function() {
    it("should sort nodes on creationTime as expected", async function() {
        testSorted(new AlgoRefId());
    });

    it("should sort on refIf as expected", async function() {
        const nodeUtil = new NodeUtil();

        const algo = new AlgoRefId();

        const keyPair = Node.GenKeyPair();

        const node1 = await nodeUtil.createDataNode({data: Buffer.from("node1"), creationTime: 10, parentId: Buffer.alloc(32).fill(1)}, keyPair.publicKey, keyPair.secretKey);
        const node1_1 = await nodeUtil.createDataNode({data: Buffer.from("node1_1"), creationTime: 9, refId: node1.getId1(), parentId: Buffer.alloc(32).fill(1)}, keyPair.publicKey, keyPair.secretKey);
        const node1_1_1 = await nodeUtil.createDataNode({data: Buffer.from("node1_1_1"), creationTime: 0, refId: node1_1.getId1(), parentId: Buffer.alloc(32).fill(1)}, keyPair.publicKey, keyPair.secretKey);

        let [addedNodes, transientNodes] = algo.add([node1, node1_1, node1_1_1]);
        assert(addedNodes.length === 3);
        assert(transientNodes.length === 0);

        let indexes = algo.getIndexes([node1, node1_1, node1_1_1]);
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

        indexes = algo.getIndexes([node1, node1_1, node1_1_1, node0_1]);
        assert(indexes.length === 4);
        assert(indexes[0] === 0);
        assert(indexes[1] === 2);
        assert(indexes[2] === 3);
        assert(indexes[3] === 1);


        // Insert orphan missing parent.
        [addedNodes, transientNodes] = algo.add([node0]);
        assert(addedNodes.length === 1);
        assert(transientNodes.length === 0);

        indexes = algo.getIndexes([node0, node1, node0_1, node1_1, node1_1_1]);
        assert(indexes.length === 5);
        assert(indexes[0] === 0);
        assert(indexes[1] === 1);
        assert(indexes[2] === 3);
        assert(indexes[3] === 2);
        assert(indexes[4] === 4);

        let nodes;

        /// head
        [nodes, indexes] = algo.get(undefined, 1, 0, false);
        assert(indexes.length === 1);
        assert(nodes[0] === node0);

        [nodes, indexes] = algo.get(undefined, -1, 0, false);
        assert(indexes.length === 5);
        assert(nodes[0] === node0);
        assert(nodes[1] === node1);
        assert(nodes[2] === node1_1);
        assert(nodes[3] === node0_1);
        assert(nodes[4] === node1_1_1);

        [nodes, indexes] = algo.get(undefined, 4, 0, true);
        assert(indexes.length === 4);
        assert(nodes[0] === node1_1_1);
        assert(nodes[1] === node0_1);
        assert(nodes[2] === node1_1);
        assert(nodes[3] === node1);

        [nodes, indexes] = algo.get(node0_1.getId1(), -1, 0, true);
        assert(indexes.length === 3);
        assert(nodes[0] === node1_1);
        assert(nodes[1] === node1);
        assert(nodes[2] === node0);

        /// tail
        [nodes, indexes] = algo.get(undefined, 0, 1, false);
        assert(indexes.length === 1);
        assert(nodes[0] === node1_1_1);

        [nodes, indexes] = algo.get(undefined, 0, -1, false);
        assert(indexes.length === 5);
        assert(nodes[0] === node0);
        assert(nodes[1] === node1);
        assert(nodes[2] === node1_1);
        assert(nodes[3] === node0_1);
        assert(nodes[4] === node1_1_1);

        [nodes, indexes] = algo.get(node0_1.getId1(), 0, -1, false);
        assert(indexes.length === 3);
        assert(nodes[0] === node0);
        assert(nodes[1] === node1);
        assert(nodes[2] === node1_1);

        [nodes, indexes] = algo.get(undefined, 0, 4, true);
        assert(indexes.length === 4);
        assert(nodes[3] === node0);
        assert(nodes[2] === node1);
        assert(nodes[1] === node1_1);
        assert(nodes[0] === node0_1);

        [nodes, indexes] = algo.get(undefined, 0, -1, true);
        assert(indexes.length === 5);
        assert(nodes[4] === node0);
        assert(nodes[3] === node1);
        assert(nodes[2] === node1_1);
        assert(nodes[1] === node0_1);
        assert(nodes[0] === node1_1_1);

        [nodes, indexes] = algo.get(node1_1.getId1(), 0, -1, true);
        assert(indexes.length === 2);
        assert(nodes[1] === node0_1);
        assert(nodes[0] === node1_1_1);
    });
});
