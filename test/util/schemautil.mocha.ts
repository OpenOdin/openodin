import {assert} from "chai";

import {
    ParseSchema,
    ToJSONObject,
    FetchRequestSchema,
    LICENSE0_NODE_TYPE,
    DeepEquals,
    ApplicationConfSchema,
    WalletConfSchema,
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

        const parsed = ParseSchema(FetchRequestSchema, obj);

        assert(parsed.query.match[0].nodeType.equals(LICENSE0_NODE_TYPE));

        const obj2 = ToJSONObject(parsed);

        const parsed2 = ParseSchema(FetchRequestSchema, obj);

        assert(DeepEquals(parsed, parsed2));

        const bin = BopFetchRequest.encode(parsed);

        const parsed3 = BopFetchRequest.decode(bin);

        const obj3 = ToJSONObject(parsed3);

        const parsed4 = ParseSchema(FetchRequestSchema, obj3);

        assert(DeepEquals(parsed, parsed4));
    });

    it("should apply ApplicationConfSchema", function() {
        const obj = {
            name: "Testing",
            version: "1.2.3",
            peers: [
                {
                    connection: {
                        handshake: {
                            client: {
                                socketType: "WebSocket",
                                port: 1010,
                                serverPublicKey: Buffer.alloc(32),
                            },
                        }
                    }
                },
            ],
        };

        const parsed = ParseSchema(ApplicationConfSchema, obj);

        //console.log(JSON.stringify(ToJSONObject(parsed), null, 4));
    });

    it("should apply WalletConfSchema", function() {
        const walletConf = ParseSchema(WalletConfSchema, {});

        //console.log(walletConf);
    });
});
