/**
 * Test the blob streamers in detail.
 */

import { assert } from "chai";

import {
    Hash,
} from "../../src";


const contentArray = [Buffer.from(`Hello World!

It is a nice day.
`, "utf-8"), BigInt("543212345678900987654321")];

describe("Hash", function() {

    it("content array contains bigint", async function() {
        let hash: any;
        assert.doesNotThrow(function() {
            hash = Hash(contentArray);
        });

        assert(hash);
        assert(Buffer.isBuffer(hash));
    });
});
