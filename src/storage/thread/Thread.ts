import { strict as assert } from "assert";

import {
    EventType,
} from "pocket-messaging";

import {
    NodeUtil,
} from "../../util/NodeUtil";

import {
    ParseUtil,
} from "../../util/ParseUtil";

import {
    P2PClient,
    GetResponse,
} from "../../p2pclient";

import {
    TransformerCache,
} from "../transformer";

import {
    StorageUtil,
} from "../../util/StorageUtil";

import {
    CopyBuffer,
} from "../../util/common";

import {
    DataParams,
    LicenseParams,
    LicenseInterface,
    NodeInterface,
    LICENSE_NODE_TYPE,
} from "../../datamodel";

import {
    Status,
    FetchResponse,
    FetchRequest,
    FetchQuery,
    FetchTransform,
} from "../../types";

import {
    ThreadTemplate,
    ThreadTemplates,
    ThreadQueryParams,
    ThreadTransformerParams,
    ThreadParams,
    ThreadDataParams,
    ThreadLicenseParams,
    ThreadQueryCallback,
    ThreadDefaults,
} from "./types";

export class Thread {
    protected transformerCache?: TransformerCache;
    protected streamResponse?: GetResponse<FetchResponse>;

    constructor(protected threadTemplate: ThreadTemplate,
        protected defaults: ThreadDefaults,
        protected storageClient: P2PClient,
        protected nodeUtil: NodeUtil,
        protected publicKey: Buffer,
        protected signerPublicKey: Buffer) {

        if (this.threadTemplate.transform?.algos.length > 0) {
            this.transformerCache = new TransformerCache();
        }
    }

    public static GetFetchRequest(threadTemplate: ThreadTemplate,
        threadParams: ThreadParams, defaults: ThreadDefaults, stream: boolean = false): FetchRequest {

        const query = Thread.ParseQuery(threadTemplate, threadParams.query ?? {}, defaults);
        const transform = Thread.ParseTransform(threadTemplate, threadParams.transform ?? {});

        if (stream) {
            if (query.triggerNodeId.length === 0 && query.triggerInterval === 0) {
                if (query.parentId.length > 0) {
                    query.triggerNodeId = CopyBuffer(query.parentId);
                }
                else if (threadTemplate.query?.triggerNodeId && threadTemplate.query?.triggerNodeId.length > 0) {
                    query.triggerNodeId = CopyBuffer(threadTemplate.query.triggerNodeId);
                }
            }

            if (query.triggerNodeId.length === 0 && query.triggerInterval === 0) {
                throw new Error("Missing triggerNodeId/triggerInterval for Thread streaming and parentId cannot be copied from template");
            }
        }
        else {
            // We need to delete these to be sure not to stream.
            query.triggerNodeId     = Buffer.alloc(0);
            query.triggerInterval   = 0;
            query.onlyTrigger       = false;
        }

        return {
            query,
            transform,
        };
    }

    public setDefault(name: keyof ThreadDefaults, value: any) {
        this.defaults[name] = value;
    }

    public query(threadParams: ThreadParams, callback: ThreadQueryCallback) {
        const fetchRequest = Thread.GetFetchRequest(this.threadTemplate, threadParams, this.defaults);

        // We need to delete these to be sure not to stream.
        fetchRequest.query.triggerNodeId     = Buffer.alloc(0);
        fetchRequest.query.triggerInterval   = 0;
        fetchRequest.query.onlyTrigger       = false;

        this.fetch(fetchRequest, callback);
    }

    public stream(threadParams: ThreadParams, callback: ThreadQueryCallback) {
        if (this.streamResponse) {
            throw new Error("Cannot stream twice on the same Thread instance. Please call stopStream() first or create another instance.");
        }

        const fetchRequest = Thread.GetFetchRequest(this.threadTemplate, threadParams,
            this.defaults, true);

        this.streamResponse = this.fetch(fetchRequest, callback);
    }

    public async post(threadDataParams: ThreadDataParams): Promise<NodeInterface[]> {
        const dataParams = this.parsePost(threadDataParams);

        const dataNode = await this.nodeUtil.createDataNode(dataParams, this.signerPublicKey);

        const storedId1s = await this.storeNodes([dataNode]);

        if (storedId1s.length > 0) {
            return [dataNode];
        }

        return [];
    }

    /**
     * @param node to create licenses for.
     * @param threadLicenseParams params to overwrite template values with.
     * @param targets if not set then targets taken from default object passed in constructor.
     */
    public async postLicense(node: NodeInterface, threadLicenseParams: ThreadLicenseParams = {}, targets?: Buffer[]): Promise<Buffer[]> {
        targets = targets ?? this.defaults.licenseTargets;

        if (!node.isLicensed() || node.getLicenseMinDistance() !== 0 || !targets) {
            return [];
        }

        const nodeId1   = node.getId1();
        const parentId  = node.getParentId();

        assert(nodeId1);
        assert(parentId);

        const licenseNodes: LicenseInterface[] = [];

        const targetsLength = targets.length;
        for (let i=0; i<targetsLength; i++) {
            const targetPublicKey = targets[i];

            const licenseParams = this.parsePostLicense({
                ...threadLicenseParams,
                nodeId1,
                parentId,
                targetPublicKey,
            });

            const licenseNode = await this.nodeUtil.createLicenseNode(licenseParams,
                this.signerPublicKey);

            licenseNodes.push(licenseNode);
        }

        return this.storeNodes(licenseNodes);
    }

    public stopStream() {
        if (this.streamResponse) {
            // TODO unsubsribe from storage
            this.streamResponse.cancel();
            delete this.streamResponse;
        }
    }

    public getTransformer(): TransformerCache | undefined {
        return this.transformerCache;
    }

    protected parsePostLicense(threadLicenseParams: ThreadLicenseParams): LicenseParams {
        const creationTime  = threadLicenseParams.creationTime ?? Date.now();
        const expireTime    = threadLicenseParams.expireTime ?? creationTime + 3600 * 1000;
        const owner         = this.publicKey;

        return ParseUtil.ParseLicenseParams({
            ...this.threadTemplate.postLicense ?? {},
            ...threadLicenseParams,
            creationTime,
            expireTime,
            owner,
        });
    }

    protected parsePost(threadDataParams: ThreadDataParams): DataParams {
        const creationTime  = threadDataParams.creationTime ?? Date.now();
        const expireTime    = threadDataParams.hasOwnProperty("expireTime") ?
            threadDataParams.expireTime : creationTime + 3600 * 1000;
        const owner = this.publicKey;

        const dataParams: DataParams = {
            ...this.threadTemplate.post ?? {},
            ...threadDataParams,
            creationTime,
            expireTime,
            owner,
        };

        if (!dataParams.parentId) {
            dataParams.parentId = this.defaults.parentId;
        }

        return ParseUtil.ParseDataParams(dataParams);
    }

    protected static ParseQuery(threadTemplate: ThreadTemplate,
        threadQueryParams: ThreadQueryParams, defaults: ThreadDefaults): FetchQuery {

        if (!threadTemplate.query) {
            throw new Error("Missing query template in Thread");
        }

        const queryParams = {
            ...threadTemplate.query,
            ...threadQueryParams,
        };

        if (queryParams.includeLicenses) {
            queryParams.match = queryParams.match ?? [];
            queryParams.match.push({
                nodeType: LICENSE_NODE_TYPE,
            });

            queryParams.embed = queryParams.embed ?? [];
            queryParams.embed.push({
                nodeType: LICENSE_NODE_TYPE,
            });
        }

        if (!queryParams.parentId && !queryParams.rootNodeId1) {
            queryParams.parentId = defaults.parentId;
        }

        return ParseUtil.ParseQuery(queryParams);
    }

    protected static ParseTransform(threadTemplate: ThreadTemplate,
        threadTransformerParams: ThreadTransformerParams): FetchTransform {

        return ParseUtil.ParseTransform({
            ...(threadTemplate.transform ?? {}),
            ...threadTransformerParams,
        });
    }

    protected fetch(fetchRequest: FetchRequest, callback: ThreadQueryCallback) {
        const {getResponse} = this.storageClient.fetch(fetchRequest, /*timeout=*/0);

        if (!getResponse) {
            throw new Error("unexpectedly missing getResponse");
        }

        getResponse.onTimeout( () => {
            this.stopStream();
        });

        getResponse.onClose( (hadError: boolean) => {
            this.transformerCache?.close();
        });

        getResponse.onReply( (fetchResponse: FetchResponse, peer: P2PClient) => {
            if (fetchResponse.status === Status.TRY_AGAIN) {
                // Transformer cache got invalidated.
                this.transformerCache?.close();
                this.streamResponse?.cancel();
                delete this.transformerCache;
                delete this.streamResponse;
                return;
            }
            else if (fetchResponse.status === Status.MISSING_CURSOR) {
                // TODO: do what?
                // cursordId1 is missing for transformer.
                //this.transformerCache?.close();
                //this.streamResponse?.cancel();
                //delete this.transformerCache;
                //delete this.streamResponse;
                console.debug("cursordId1 not found for Thread with transformer");
                return;
            }
            else if (fetchResponse.status !== Status.RESULT) {
                console.error(`Error code (${fetchResponse.status}) returned on fetch, error message: ${fetchResponse.error}`);
                return;
            }

            if (fetchResponse.transformResult.deletedNodesId1.length > 0) {
                this.transformerCache?.delete(fetchResponse.transformResult.indexes);
            }

            if (this.transformerCache) {
                const nodes = StorageUtil.ExtractFetchResponseNodes(fetchResponse);
                const indexes = fetchResponse.transformResult.indexes;
                this.transformerCache.handleResponse(nodes, indexes, getResponse.getBatchCount() === 1);
            }
        });

        callback(getResponse, this.transformerCache);

        return getResponse;
    }

    /**
     * @param nodes list of node objects to store.
     * @returns list of stored ID1s
     * @throws on error
     */
    protected async storeNodes(nodes: NodeInterface[]): Promise<Buffer[]> {
        const storeRequest = StorageUtil.CreateStoreRequest({nodes: nodes.map( node => node.export() )});

        const {getResponse} = this.storageClient.store(storeRequest);

        if (!getResponse) {
            throw new Error("Could not communicate with storage as expected when storing nodes.");
        }

        const anyData = await getResponse.onceAny();

        if (anyData.type === EventType.REPLY) {
            const storeResponse = anyData.response;

            if (!storeResponse || storeResponse.status !== Status.RESULT) {
                throw new Error(`Could not store nodes: ${storeResponse?.error}`);
            }

            return storeResponse.storedId1s;
        }
        else {
            throw new Error(`Could not store nodes: ${anyData.error}`);
        }
    }
}
