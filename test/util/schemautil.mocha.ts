import {assert} from "chai";

import {
    ParseSchema,
    ToJSONObject,
    FetchRequestSchema,
    LICENSE0_NODE_TYPE,
    DeepEquals,
} from "../../src";

import {
    BopFetchRequest,
} from "../../src/bebop";

describe("SchemaUtil", function() {
    it("should apply FetchRequestSchema", function() {
        const obj = {
            query: {
                match: [
                    {
                        nodeType: "LicenseNode",
                        cursorId1: "abbaabba",
                    },
                ],
                embed: [{nodeType: "DataNode"}],
            },
        };

        const parsed = ParseSchema(obj, FetchRequestSchema);

        assert(parsed.query.match[0].nodeType.equals(LICENSE0_NODE_TYPE));

        const obj2 = ToJSONObject(parsed);

        const parsed2 = ParseSchema(obj, FetchRequestSchema);

        assert(DeepEquals(parsed, parsed2));

        const bin = BopFetchRequest.encode(parsed);

        const parsed3 = BopFetchRequest.decode(bin);

        const obj3 = ToJSONObject(parsed3);

        const parsed4 = ParseSchema(obj3, FetchRequestSchema);

        assert(DeepEquals(parsed, parsed4));
    });
});
