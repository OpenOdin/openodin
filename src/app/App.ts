import {
    Service,
    ServiceConfig,
} from "../service/Service";

import {
    StorageUtil,
} from "../util/StorageUtil";

import {
    SignatureOffloader,
    DataInterface,
    Data,
    CMP,
} from "../datamodel";

import {
    Status,
} from "../types";

import {
    EventType,
} from "pocket-messaging";

export class App extends Service {
    protected appNodeId1: Buffer | undefined;

    constructor(signatureOffloader: SignatureOffloader, config?: ServiceConfig, appNodeId1?: Buffer) {
        super(signatureOffloader, config);
        this.appNodeId1 = appNodeId1;
    }

    public setAppNodeId(appNodeId1: Buffer | undefined) {
        this.appNodeId1 = appNodeId1;
    }

    /**
     * Run a discovery of app-func-nodes below the root node.
     * @param parentId Optionally set from where below to start the discovery.
     * Default is the appNodeId1 passed into the constructor used as rootNodeId1.
     * A parentId is is required to be set if the app is not configured for an app root node.
     */
    public async discover(parentId?: Buffer): Promise<DataInterface[]> {
        const nodes: DataInterface[] = [];

        const fetchRequest = StorageUtil.CreateFetchRequest({query: {
            parentId,
            rootNodeId1: parentId ? undefined : this.appNodeId1,
            depth: 2,
            cutoffTime: 0n,
            preserveTransient: false,
            discardRoot: true,
            descending: true,

            match: [
                {
                    nodeType: Data.GetType(),
                    filters: [
                        {
                            field: "contentType",
                            operator: ":0,4",
                            cmp: CMP.EQ,
                            value: "app/",
                        },
                        {
                            field: "contentType",
                            cmp: CMP.NE,
                            value: "app/profiles",
                        },
                    ],
                    level: [1],
                },
                {
                    nodeType: Data.GetType(),
                    filters: [
                        {
                            field: "contentType",
                            cmp: CMP.EQ,
                            value: "app/profiles",
                        },
                    ],
                    limit: 1,
                    level: [1],
                },
                {
                    nodeType: Data.GetType(),
                    filters: [
                        {
                            field: "contentType",
                            operator: ":0,4",
                            cmp: CMP.NE,
                            value: "app/",
                        },
                    ],
                    level: [1],
                    path: 1,
                },
                {
                    nodeType: Data.GetType(),
                    filters: [
                        {
                            field: "contentType",
                            operator: ":0,4",
                            cmp: CMP.EQ,
                            value: "app/",
                        },
                    ],
                    level: [2],
                    parentPath: 1,
                },
            ]
        }});

        const storageClient = this.getStorageClient();
        if (!storageClient) {
            throw new Error("Expecting storage client existing.");
        }

        const {getResponse} = storageClient.fetch(fetchRequest);
        if (!getResponse) {
            throw new Error("Could not query for discovery.");
        }
        const anyDataPromise = getResponse.onceAny();

        const anyData = await anyDataPromise;

        if (anyData.type === EventType.REPLY) {
            const fetchResponse = anyData.response;
            if (fetchResponse && fetchResponse.status === Status.RESULT) {
                nodes.push(...StorageUtil.ExtractFetchResponseNodes(fetchResponse) as DataInterface[]);
            }
        }
        else {
            throw new Error("Unexpected reply in discovery");
        }

        return nodes;
    }
}
