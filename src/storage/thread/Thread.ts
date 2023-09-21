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
    ThreadFetchParams,
    ThreadDataParams,
    ThreadLicenseParams,
    ThreadDefaults,
    ThreadResponseAPI,
} from "./types";

import {
    StreamReaderInterface,
    StreamWriterInterface,
} from "../../datastreamer";

export class Thread {
    protected transformerCache?: TransformerCache;
    protected streamGetResponse?: GetResponse<FetchResponse>;

    constructor(protected threadTemplate: ThreadTemplate,
        protected defaults: ThreadDefaults,
        protected storageClient: P2PClient,
        protected nodeUtil: NodeUtil,
        protected publicKey: Buffer,
        protected signerPublicKey: Buffer) {

        if (this.threadTemplate.transform?.algos.length) {
            this.transformerCache = new TransformerCache();
        }
    }

    public static GetFetchRequest(threadTemplate: ThreadTemplate,
        threadFetchParams: ThreadFetchParams, defaults: ThreadDefaults, stream: boolean = false): FetchRequest {

        const query = Thread.ParseQuery(threadTemplate, threadFetchParams.query ?? {}, defaults);
        const transform = Thread.ParseTransform(threadTemplate, threadFetchParams.transform ?? {});

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

    public getFetchRequest(threadFetchParams: ThreadFetchParams, stream: boolean = false): FetchRequest {
        return Thread.GetFetchRequest(this.threadTemplate, threadFetchParams, this.defaults, stream);
    }

    public setDefault(name: keyof ThreadDefaults, value: any) {
        this.defaults[name] = value;
    }

    public query(threadFetchParams: ThreadFetchParams = {}): ThreadResponseAPI {
        const fetchRequest = this.getFetchRequest(threadFetchParams);

        // We need to delete these to be sure not to stream.
        fetchRequest.query.triggerNodeId     = Buffer.alloc(0);
        fetchRequest.query.triggerInterval   = 0;
        fetchRequest.query.onlyTrigger       = false;

        const getResponse = this.fetch(fetchRequest);

        return this.threadResponseAPI(getResponse);
    }

    public stream(threadFetchParams: ThreadFetchParams = {}): ThreadResponseAPI {
        if (this.streamGetResponse) {
            throw new Error("Cannot stream twice on the same Thread instance. Please call stopStream() first or create another instance.");
        }

        const fetchRequest = this.getFetchRequest(threadFetchParams, true);

        this.streamGetResponse = this.fetch(fetchRequest);

        return this.threadResponseAPI(this.streamGetResponse);
    }

    public async post(threadDataParams: ThreadDataParams = {}): Promise<NodeInterface[]> {
        const dataParams = this.parsePost(threadDataParams);

        const dataNode = await this.nodeUtil.createDataNode(dataParams, this.signerPublicKey);

        const storedId1s = await this.storeNodes([dataNode]);

        if (storedId1s.length > 0) {
            return [dataNode];
        }

        return [];
    }

    protected threadResponseAPI(getResponse: GetResponse<FetchResponse>): ThreadResponseAPI {
        const transformerCache = this.transformerCache;

        return {
            onAdd: (...parameters: Parameters<TransformerCache["onAdd"]>) => {
                if (!transformerCache) {
                    throw new Error("Thread not using transformer, cannot call onAdd()");
                }

                transformerCache.onAdd(...parameters);
            },
            onUpdate: (...parameters: Parameters<TransformerCache["onUpdate"]>) => {
                if (!transformerCache) {
                    throw new Error("Thread not using transformer, cannot call onUpdate()");
                }

                transformerCache.onUpdate(...parameters);
            },
            onInsert: (...parameters: Parameters<TransformerCache["onInsert"]>) => {
                if (!transformerCache) {
                    throw new Error("Thread not using transformer, cannot call onInsert()");
                }

                transformerCache.onInsert(...parameters);
            },
            onDelete: (...parameters: Parameters<TransformerCache["onDelete"]>) => {
                if (!transformerCache) {
                    throw new Error("Thread not using transformer, cannot call onDelete()");
                }

                transformerCache.onDelete(...parameters);
            },
            onChange: (...parameters: Parameters<TransformerCache["onChange"]>) => {
                if (!transformerCache) {
                    throw new Error("Thread not using transformer, cannot call onChange()");
                }

                transformerCache.onChange(...parameters);
            },
            onClose: (...parameters: Parameters<TransformerCache["onClose"]>) => {
                if (!transformerCache) {
                    throw new Error("Thread not using transformer, cannot call onClose()");
                }

                transformerCache.onClose(...parameters);
            },
            getResponse: (): GetResponse<FetchResponse> => {
                return getResponse;
            },
            getTransformer: (): TransformerCache | undefined => {
                return this.transformerCache;
            },
        }
    }

    /**
     * @param node to create licenses for.
     * @param threadLicenseParams params to overwrite template values with.
     * Note that properties set to `undefined` will still overwrite template values.
     */
    public async postLicense(node: NodeInterface, threadLicenseParams: ThreadLicenseParams = {}): Promise<Buffer[]> {
        const targets: Buffer[] | undefined =
            Thread.CollapseProperty([threadLicenseParams, this.defaults,
                this.threadTemplate.postLicense ?? {}], "targets") as (Buffer[] | undefined);

        if (!node.isLicensed() || node.getLicenseMinDistance() !== 0 || !targets) {
            return [];
        }

        const licenseNodes: LicenseInterface[] = [];

        const targetsLength = targets.length;
        for (let i=0; i<targetsLength; i++) {
            const targetPublicKey = targets[i];

            const licenseParams = this.parsePostLicense(node, {
                ...threadLicenseParams,
                targetPublicKey,
            });

            const licenseNode = await this.nodeUtil.createLicenseNode(licenseParams,
                this.signerPublicKey);

            licenseNodes.push(licenseNode);
        }

        return this.storeNodes(licenseNodes);
    }

    public stopStream() {
        if (this.streamGetResponse) {
            // TODO unsubsribe from storage
            this.streamGetResponse.cancel();
            delete this.streamGetResponse;
        }
    }

    public getTransformer(): TransformerCache | undefined {
        return this.transformerCache;
    }

    /**
     * Store a blob into storage by using a StreamReaderInterface.
     *
     */
    public upload(nodeId1: Buffer, streamReader: StreamReaderInterface): StreamWriterInterface {
        const storageUtil = new StorageUtil(this.storageClient);

        return storageUtil.streamStoreBlob(nodeId1, streamReader);
    }

    /**
     * @returns a StreamReaderInterface for blob
     */
    public download(nodeId1: Buffer): StreamReaderInterface {
        const storageUtil   = new StorageUtil(this.storageClient);

        const streamReader  = storageUtil.getBlobStreamReader(nodeId1);

        return streamReader;
    }

    /**
     * Download the full blob and then return it as a Buffer.
     * Note that this should be used with care for larger blobs.
     *
     * Data is returned as array of Buffers since that is how it is read
     * and joining that buffer might put unnecessary strain on memory so we don't do it automatically.
     *
     * @returns the complete data for a blob.
     * @throws on error
     */
    public downloadFull(node: NodeInterface): {blobDataPromise: Promise<Buffer[]>, streamReader: StreamReaderInterface} {
        const storageUtil = new StorageUtil(this.storageClient);
        const streamReader = storageUtil.getBlobStreamReader(node.getId1()!);

        const blobLength = node.getBlobLength();

        if (blobLength === undefined) {
            throw new Error("Missing blob length");
        }

        const blobDataPromise = new Promise<Buffer[]>( async (resolve) => {

            const blobData: Buffer[] = [];

            let readLength = 0;

            try {
                while (readLength < blobLength) {
                    const readData = await streamReader.next();

                    if (!readData) {
                        throw new Error("Could not read from blob stream");
                    }

                    blobData.push(readData.data);

                    readLength += readData.data.length;
                }
            }
            catch(e) {
                throw e;
            }
            finally {
                streamReader.close();
            }

            resolve(blobData);
        });

        return {blobDataPromise, streamReader};
    }

    protected parsePostLicense(node: NodeInterface, threadLicenseParams: ThreadLicenseParams): LicenseParams {
        const nodeId1   = node.getId1();
        const parentId  = node.getParentId();

        assert(nodeId1);
        assert(parentId);

        const template = this.threadTemplate.postLicense ?? {};

        let creationTime: number | undefined =
            Thread.CollapseProperty([threadLicenseParams, template],
                "creationTime") as (number | undefined);

        if (creationTime === undefined) {
            creationTime = node.getCreationTime();
        }

        let expireTime: number | undefined =
            Thread.CollapseProperty([threadLicenseParams, this.defaults, template],
                "expireTime") as (number | undefined);

        const nodeExpireTime = node.getExpireTime();

        if (expireTime === undefined) {
            expireTime = nodeExpireTime;
        }

        if (expireTime === undefined) {
            const validSeconds: number | undefined =
                Thread.CollapseProperty([threadLicenseParams, this.defaults, template],
                    "validSeconds") as (number | undefined);

            if (validSeconds !== undefined) {
                expireTime = (creationTime ?? Date.now()) + validSeconds * 1000;
            }
        }

        if (expireTime !== undefined && nodeExpireTime !== undefined) {
            expireTime = Math.min(expireTime, nodeExpireTime);
        }

        const owner         = this.publicKey;

        return ParseUtil.ParseLicenseParams(
            Thread.MergeParams([threadLicenseParams, this.threadTemplate.postLicense ?? {},
                {nodeId1, parentId, creationTime, expireTime, owner}]));
    }

    protected parsePost(threadDataParams: ThreadDataParams): DataParams {
        const template = this.threadTemplate.post ?? {};

        const creationTime: number | undefined =
            Thread.CollapseProperty([threadDataParams, template],
                "creationTime") as (number | undefined);

        let expireTime: number | undefined =
            Thread.CollapseProperty([threadDataParams, this.defaults, template],
                "expireTime") as (number | undefined);

        if (expireTime === undefined) {
            const validSeconds: number | undefined =
                Thread.CollapseProperty([threadDataParams, this.defaults, template],
                    "validSeconds") as (number | undefined);

            if (validSeconds !== undefined) {
                expireTime = (creationTime ?? Date.now()) + validSeconds * 1000;
            }
        }

        const owner = this.publicKey;

        const dataParams: DataParams = Thread.MergeParams([{creationTime, expireTime, owner},
            threadDataParams, {parentId: this.defaults.parentId}, template]) as DataParams;

        if (!dataParams.parentId) {
            throw new Error("missing parentId in thread post");
        }

        return ParseUtil.ParseDataParams(dataParams);
    }

    protected static ParseQuery(threadTemplate: ThreadTemplate,
        threadQueryParams: ThreadQueryParams, defaults: ThreadDefaults): FetchQuery {

        if (!threadTemplate.query) {
            throw new Error("Missing query template in Thread");
        }

        const queryParams = Thread.MergeParams([threadQueryParams,
            {parentId: defaults.parentId}, threadTemplate.query]);

        if (queryParams.includeLicenses) {
            queryParams.match = queryParams.match ?? [];
            queryParams.match.push({
                nodeType: LICENSE_NODE_TYPE,
            } as any);

            queryParams.embed = queryParams.embed ?? [];
            queryParams.embed.push({
                nodeType: LICENSE_NODE_TYPE,
            } as any);
        }

        if (queryParams.rootNodeId1) {
            delete queryParams.parentId;
        }

        if (!queryParams.parentId && !queryParams.rootNodeId1) {
            if (!defaults.parentId) {
                throw new Error("parentId is missing in thread query");
            }
        }

        return ParseUtil.ParseQuery(queryParams);
    }

    protected static ParseTransform(threadTemplate: ThreadTemplate,
        threadTransformerParams: ThreadTransformerParams): FetchTransform {

        return ParseUtil.ParseTransform(
            Thread.MergeParams([threadTransformerParams, (threadTemplate.transform ?? {})]));
    }

    protected fetch(fetchRequest: FetchRequest) {
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
                this.streamGetResponse?.cancel();
                delete this.transformerCache;
                delete this.streamGetResponse;
                return;
            }
            else if (fetchResponse.status === Status.MISSING_CURSOR) {
                // TODO: do what?
                // cursordId1 is missing for transformer.
                //this.transformerCache?.close();
                //this.streamGetResponse?.cancel();
                //delete this.transformerCache;
                //delete this.streamGetResponse;
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

    protected static MergeParams(objects: any): any {
        const merged: any = {};

        const objectsLength = objects.length;
        for (let i=0; i<objectsLength; i++) {
            const object = objects[i];

            const keys = Object.keys(object);
            const keysLength = keys.length;
            for (let i=0; i<keysLength; i++) {
                const key = keys[i];

                if (merged[key] !== undefined) {
                    continue;
                }

                const value = object[key];

                if (value !== undefined) {
                    if (Buffer.isBuffer(value) && value.length === 0) {
                        continue;
                    }

                    merged[key] = value;
                }
            }
        }

        return merged;
    }

    protected static CollapseProperty(objects: any, propertyName: string): any {
        const objectsLength = objects.length;
        for (let i=0; i<objectsLength; i++) {
            const object = objects[i];
            if (object[propertyName] !== undefined) {
                return object[propertyName];
            }
        }

        return undefined;
    }
}
