import {
    assert,
} from "chai";

import {
    BebopSerialize,
    BebopDeserialize,
    FetchRequest,
} from "../src";

import {
    BopStoreRequest,
    BopFetchResponse,
    BopFetchRequest,
} from "../src/p2pclient/bebop/bebop";

import {
    expectAsyncException,
} from "./util";

// bebop encode
// number, string -> number
// number[] -> uint8array
//  jag vill kunna transformera string ascii, hex, utf8, base64 till uin8array oxo

// string -> bigint
// number gar inte till bigint

// jag maste konvertera 
// number: accepterar number och string
// bigint: accepterar string men number maste konverteras
// array: maste vara satt om i en strukt
// uin8arr: maste vara satt om i en strukt

// i strukt
// byte[] maste vara satt
// array maste finnas
// int/uint defaultar till 0

type ObjectSchema = Record<string, any>;

const Filter = {
    field: "",
    "operator?": "",
    cmp: "",
};
    //value: Symbol(0),

const FetchRequestSchema: ObjectSchema = {
    query: {
        "depth?": -1,
        "limit?": -1,
        "cutoffTime?": 0n,
        "rootNodeId?": Buffer.alloc(0),
        "discardRoot?": false,
        "parentId?": Buffer.alloc(0),
        "targetPublicKey?": Buffer.alloc(0),
        "sourcetPublicKey?": Buffer.alloc(0),
        "match": [
            {
                nodeType: Buffer.alloc(0),
                "filters?": [
                    Filter,
                ],
                "limit?": -1,
                "limitField?": {
                    name: "",
                    limit: 0,
                },
                level: [0],
            }
        ],
        "embed?": [
            {
                nodeType: Buffer.alloc(0),
                filters: [
                    Filter,
                ],
            }
        ],
        "triggerNodeId?": Buffer.alloc(0),
        "triggerInterval?": 0,
        "onlyTrigger?": false,
        "descending?": false,
        "orderByStorageTime?": false,
        "ignoreInactive?": false,
        "ignoreOwn?": false,
        "preserveTransient?": false,
        "region?": "",
        "jurisdiction?": "",
        "includeLicenses?": 0,
    },
    "crdt?": {
        algo: "",
        conf: "",
        msgId: Buffer.alloc(0),
        reverse: false,
        head: 0,
        tail: 0,
        cursorId1: Buffer.alloc(0),
    }
};

/**
 * Transform object in place to match given schema.
 */
function TransformPOJO(pojo: any, schema: any) {
    //if (typeof defaultValue === "object" && defaultValue.constructor === Object) {
    //}


    const keys = Object.keys(schema);

    keys.forEach( key1 => {
        const value = pojo[key1];
        const defaultValue = schema[key1];

        const [key2, q] = key1.split("?");

        const optional = q === "";

        if (!optional) {
            if (value === undefined || value === null) {
                throw new Error(`field ${key2} is not set and is not optional`);
            }
        }

        if (value !== undefined && value !== null) {
            if (typeof defaultValue === "object" && defaultValue.constructor === Object) {
                if (typeof value !== "object" || value.constructor !== Object) {
                    throw new Error(`field ${key2} expected to be object`);
                }

                TransformPOJO(value, defaultValue);
            }
            else if (typeof defaultValue === "number") {
                pojo[key1] = Number(value);
            }
            else if (typeof defaultValue === "bigint") {
                pojo[key1] = BigInt(value);
            }
            else if (typeof defaultValue === "boolean") {
                pojo[key1] = Boolean(value);
            }
            else if (typeof defaultValue === "string") {
                pojo[key1] = String(value);
            }
            else if (Buffer.isBuffer(defaultValue)) {
                // TODO array, osv
                pojo[key1] = Buffer.from(value, "hex");
            }
        }
    });
}

class FetchRequestWrapper {
    public static fromBinary(binary: Uint8Array): FetchRequest {
        const fetchRequest = BopFetchRequest.decode(binary);

        //assert(fetchRequest.query, "Expected query field to be set on FetchRequest");

        return fetchRequest as unknown as FetchRequest;
    }

    public static toBinary(fetchRequest: FetchRequest): Uint8Array {
        return BopFetchRequest.encode(BopFetchRequest.unsafeCast(fetchRequest));
    }

    //public static fromJSON(json: string): FetchRequest {
        //return FetchRequestWrapper.decode(
            //BopFetchRequest.encode(
                //TransformPOJO(JSON.parse(json), FetchRequestSchema)));
    //}

    //public static toJSON(fetchRequest: FetchRequest): string {
        //return JSON.stringify(StripObject(fetchRequest));
    //}
}

describe.skip("", function() {
    it("FetchResponse", function() {
        //const pojo: any = {
            //result: {
                //nodes: [
                    //[1,2,3],
                //],
                //embed: [],
                //cutoffTime: "1",
            //},
            //crdtResult: {
                //delta: [],
            //},
        //};

        const pojo: any = {
            query: {
                cutoffTime: 0n,
                match: [],
                embed: [],
                rootNodeId1: Buffer.alloc(0),
                parentId: Buffer.alloc(0),
                sourcePublicKey: Buffer.alloc(0),
                targetPublicKey: Buffer.alloc(0),
                triggerNodeId: Buffer.alloc(0),
                region: "",
                jurisdiction: "",
            },
            crdt: {
                conf: "",
                msgId: Buffer.alloc(0),
                cursorId1: Buffer.alloc(0),
            }
        };

        const bin = FetchRequestWrapper.toBinary(pojo);

        console.log(bin);

        //const fr = FetchRequestWrapper.fromBinary(bin);
        const b = new Uint8Array([  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 0
        ]);

        const fr = FetchRequestWrapper.fromBinary(b);

        console.log(fr);

        //const fetchRequest = BopFetchRequest.fromJSON(JSON.stringify(pojo));

        //const fetchRequest = FetchRequestWrapper.fromJSON(pojo);

        //const json = JSON.stringify({
            //query: { },
        //});

        //const fetchRequest = FetchRequestWrapper.decodeJSON(json);

        //console.log(fetchRequest);
    });

    it.skip("StoreRequest", function() {
        const pojo: any = {
            batchId: 111,
            sourcePublicKey: [1,2,3],
        };

        //const serialize = new BebopSerialize();
        //const obj = serialize.StoreRequest(pojo);

        const bin1 = BopStoreRequest.encode(pojo);

        assert(bin1);

        console.log(bin1);

        //const deserialize = new BebopDeserialize();

        const storeRequest = BopStoreRequest.decode(bin1);
        //const storeRequest = deserialize.StoreRequest(obj);

        console.log(storeRequest);
    });
});
