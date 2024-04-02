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
    CRDTView,
} from "../crdt";

import {
    StorageUtil,
} from "../../util/StorageUtil";

import {
    CopyBuffer,
    DeepCopy,
} from "../../util/common";

import {
    DataParams,
    LicenseParams,
    LicenseInterface,
    NodeInterface,
    DataInterface,
    SPECIAL_NODES,
    Hash,
    Data,
    DataConfig,
} from "../../datamodel";

import {
    Status,
    FetchResponse,
    FetchRequest,
    FetchQuery,
    FetchCRDT,
} from "../../types";

import {
    ThreadTemplate,
    ThreadQueryParams,
    ThreadCRDTParams,
    ThreadFetchParams,
    ThreadDataParams,
    ThreadLicenseParams,
    ThreadDefaults,
    ThreadStreamResponseAPI,
    ThreadQueryResponseAPI,
    UpdateStreamParams,
} from "./types";

import {
    StreamReaderInterface,
    StreamWriterInterface,
    BlobStreamWriter,
    BlobStreamReader,
} from "../../datastreamer";

/**
 * Threads only work with Data nodes, furthermore nodes returned from the database
 * flagged as "special" are ignored.
 */
export class Thread {
    constructor(protected threadTemplate: ThreadTemplate,
        protected defaults: ThreadDefaults,
        protected storageClient: P2PClient,
        protected nodeUtil: NodeUtil,
        protected publicKey: Buffer,
        protected signerPublicKey: Buffer,
        protected signerSecretKey?: Buffer) {
    }

    public static GetFetchRequest(threadTemplate: ThreadTemplate,
        threadFetchParams: ThreadFetchParams, defaults: ThreadDefaults, stream: boolean = false): FetchRequest {

        const query = Thread.ParseQuery(threadTemplate, threadFetchParams.query ?? {}, defaults);
        const crdt = Thread.ParseCRDT(threadTemplate, threadFetchParams.crdt ?? {});

        if (stream) {
            if (query.triggerNodeId.length === 0 && query.triggerInterval === 0) {
                query.triggerNodeId = CopyBuffer(query.parentId);
            }

            if (query.triggerInterval === 0) {
                query.triggerInterval = 60;
            }

            if (query.triggerNodeId.length === 0 && query.triggerInterval === 0) {
                throw new Error("Missing triggerNodeId/triggerInterval for Thread streaming and parentId cannot be copied from template");
            }

            // This is not allowed when initiating a stream,
            // but is allowed when performing single queries.
            crdt.msgId = Buffer.alloc(0);
        }
        else {
            // We need to delete these to be sure not to stream.
            query.triggerNodeId     = Buffer.alloc(0);
            query.triggerInterval   = 0;
            query.onlyTrigger       = false;
        }

        return {
            query,
            crdt,
        };
    }

    public getFetchRequest(threadFetchParams: ThreadFetchParams = {}, stream: boolean = false): FetchRequest {
        return Thread.GetFetchRequest(this.threadTemplate, threadFetchParams, this.defaults, stream);
    }

    public setDefault(name: keyof ThreadDefaults, value: any) {
        this.defaults[name] = value;
    }

    public query(threadFetchParams: ThreadFetchParams = {}): ThreadQueryResponseAPI {
        const fetchRequest = this.getFetchRequest(threadFetchParams);

        const {getResponse} = this.storageClient.fetch(fetchRequest);

        if (!getResponse) {
            throw new Error("unexpectedly missing getResponse");
        }

        return this.threadQueryResponseAPI(getResponse, fetchRequest);
    }

    /**
     * triggerNodeId is by default set to the parentId of the query and
     *
     * triggerInterval is by default set to 60.
     *
     * If triggerInterval is set but not triggerNodeId then triggerNodeId will not be automatically set.
     */
    public stream(threadFetchParams: ThreadFetchParams = {}): ThreadStreamResponseAPI {
        let crdtView;

        if (this.threadTemplate.crdt?.algo ?? 0 > 0) {
            crdtView = new CRDTView();
        }

        const fetchRequest = this.getFetchRequest(threadFetchParams, true);

        const {getResponse} = this.storageClient.fetch(fetchRequest, /*timeout=*/0);

        if (!getResponse) {
            throw new Error("unexpectedly missing getResponse");
        }

        return this.threadStreamResponseAPI(getResponse, crdtView, fetchRequest);
    }

    /**
     * Post a new node.
     *
     * @param name of the post template to use.
     * @param threadDataParams fields on the Data node.
     * @throws if data node could not be created or stored.
     */
    public async post(name: string, threadDataParams: ThreadDataParams = {}): Promise<DataInterface> {
        const dataParams = this.parsePost(name, threadDataParams);

        const dataNode = await this.nodeUtil.createDataNode(dataParams, this.signerPublicKey, this.signerSecretKey);

        const storedId1s = await this.storeNodes([dataNode]);

        if (storedId1s.length > 0) {
            return dataNode;
        }

        throw new Error("Thred could not store data node");
    }

    /**
     * Post a node which is an annotation node meant to edit the given node.
     *
     * @param name of the post template to use.
     * @param nodeToEdit the node we want to annotate with an edited node.
     * @param threadDataParams should contain same data as for post() but where the data field is changed.
     * Note that it is application specific if the blobHash, etc values are relevant for the new edit node.
     *
     * @returns the edit node.
     * @throws if edit node cannot be stored.
     */
    public async postEdit(name: string, nodeToEdit: NodeInterface, threadDataParams: ThreadDataParams = {}): Promise<DataInterface> {
        const dataParams = this.parsePost(name, threadDataParams);

        dataParams.parentId = nodeToEdit.getId();
        dataParams.expireTime = nodeToEdit.getExpireTime();
        dataParams.dataConfig = (dataParams.dataConfig ?? 0) | (1 << DataConfig.ANNOTATION_EDIT);

        const dataNode = await this.nodeUtil.createDataNode(dataParams, this.signerPublicKey, this.signerSecretKey);

        const storedId1s = await this.storeNodes([dataNode]);

        if (storedId1s.length > 0) {
            return dataNode;
        }

        throw new Error("Thread could not store edit node");
    }

    /**
     * Post a node which is an annotation node meant as a reaction to a node.
     *
     * @param name of the post template to use.
     * @param node the node we are reaction to.
     * @param threadDataParams should contain same data as for post() but where the data field is
     * Buffer.from("react/thumbsup") or Buffer.from("unreact/thumbsup"), where "thumbsup" is the reaction name.
     */
    public async postReaction(name: string, node: NodeInterface, threadDataParams: ThreadDataParams = {}): Promise<DataInterface> {
        const dataParams = this.parsePost(name, threadDataParams);

        dataParams.parentId = node.getId();
        dataParams.expireTime = node.getExpireTime();
        dataParams.dataConfig = (dataParams.dataConfig ?? 0) | (1 << DataConfig.ANNOTATION_REACTION);

        const dataNode = await this.nodeUtil.createDataNode(dataParams, this.signerPublicKey, this.signerSecretKey);

        const storedId1s = await this.storeNodes([dataNode]);

        if (storedId1s.length > 0) {
            return dataNode;
        }

        throw new Error("Thread could not store rection node");
    }

    /**
     * Create destroy node(s) and post them.
     * 
     * If the given node is destructible then create a destroy node for it specifically.
     *
     * Also/if the given node is licensed then create a destroy node which targets all licenses
     * of the node.
     *
     * If destroy nodes them selves are licensed then a postLicense() call must be made to properly post
     * applicable licenses which should have the same properties as the licenses posted for
     * the node getting deleted.
     * This is not done automatically because all the details about what the licenses need are not known
     * by the delete function.
     *
     * Note that if licenses for destroy nodes are not posted, the targeted node will still be destroyed
     * but the destroy nodes cannot be synced (missing licenses) and also will eventually be garbage collected
     * since they are missing licenses.
     *
     * @param node node to be destroyed
     *
     * @returns the destroy nodes. If any returned node is licensed the caller must create licenses and
     * post them. This should be done exactly in the same way as how the destroyed node's license
     * was created.
     *
     * @throws if given node cannot be destructed.
     */
    public async delete(node: DataInterface): Promise<DataInterface[]> {
        const destroyNodes: DataInterface[] = [];

        // If the node is destructible we destroy it.
        //
        if (!node.isIndestructible()) {
            const innerHash = Hash([SPECIAL_NODES.DESTROY_NODE,
                this.publicKey, node.getId1()]);

            const dataParams = {
                parentId: node.getParentId(),
                owner: this.publicKey,
                isLicensed: node.isLicensed(),
                licenseMinDistance: node.getLicenseMinDistance(),
                licenseMaxDistance: node.getLicenseMaxDistance(),
                isPublic: node.isPublic(),
                isSpecial: true,
                contentType: node.getContentType(),
                refId: innerHash,
                data: Buffer.from(SPECIAL_NODES.DESTROY_NODE),
                expireTime: node.getExpireTime(),
            };

            const dataNode = await this.nodeUtil.createDataNode(dataParams, this.signerPublicKey,
                this.signerSecretKey);

            destroyNodes.push(dataNode);
        }

        // Also/or if the node is licensed we destroy all its licenses,
        // if license min distance is 0.
        //
        if (node.isLicensed() && node.getLicenseMinDistance() === 0) {
            const innerHash = Hash([SPECIAL_NODES.DESTROY_LICENSES_FOR_NODE,
                this.publicKey, node.getId1()]);

            const dataParams = {
                parentId: node.getParentId(),
                owner: this.publicKey,
                isLicensed: true,
                licenseMinDistance: 0,
                licenseMaxDistance: node.getLicenseMaxDistance(),
                isSpecial: true,
                contentType: node.getContentType(),
                refId: innerHash,
                data: Buffer.from(SPECIAL_NODES.DESTROY_LICENSES_FOR_NODE),
                expireTime: node.getExpireTime(),
            };

            const dataNode = await this.nodeUtil.createDataNode(dataParams, this.signerPublicKey,
                this.signerSecretKey);

            destroyNodes.push(dataNode);
        }

        if (destroyNodes.length === 0) {
            throw new Error("Cannot delete node");
        }

        const storedId1s = await this.storeNodes(destroyNodes);

        return destroyNodes.filter( node =>
            storedId1s.findIndex( id1 => node.getId1()?.equals(id1) ) > -1 );
    }

    protected threadQueryResponseAPI(getResponse: GetResponse<FetchResponse>,
        fetchRequest: FetchRequest): ThreadQueryResponseAPI
    {
        const onDataCBs: Array<(nodes: DataInterface[]) => void> = [];

        getResponse.onReply( (fetchResponse: FetchResponse) => {
            if (fetchResponse.status === Status.RESULT) {
                const nodes = (StorageUtil.ExtractFetchResponseNodes(fetchResponse, fetchRequest.query.preserveTransient,
                    Data.GetType(4)) as DataInterface[]).filter( node => !node.isSpecial() );

                onDataCBs.forEach( cb => cb(nodes) );
            }
        });

        const threadResponse: ThreadQueryResponseAPI = {
            onData: (cb: (nodes: DataInterface[]) => void): ThreadQueryResponseAPI => {
                onDataCBs.push(cb)

                return threadResponse;
            },

            onCancel: (cb: () => void): ThreadQueryResponseAPI => {
                getResponse.onCancel(cb);

                return threadResponse;
            },

            getResponse: (): GetResponse<FetchResponse> => {
                return getResponse;
            },
        };

        return threadResponse;
    }

    protected threadStreamResponseAPI(getResponse: GetResponse<FetchResponse>,
        crdtView: CRDTView | undefined,
        fetchRequest: FetchRequest): ThreadStreamResponseAPI
    {
        fetchRequest = DeepCopy(fetchRequest);

        const onDataCBs: Array<(nodes: DataInterface[]) => void> = [];

        // These variables are used to collect the response.
        //
        let delta: Buffer = Buffer.alloc(0);
        let addedNodesId1s: Buffer[]   = [];
        let updatedNodesId1s: Buffer[] = [];
        let deletedNodesId1s: Buffer[] = [];

        getResponse.onReply( (fetchResponse: FetchResponse) => {
            if (fetchResponse.status === Status.MISSING_CURSOR) {
                // cursordId1 is missing for crdtView.
                // Clear out cache, but keep alive and wait for more data.

                crdtView?.empty();
            }
            else if (fetchResponse.status !== Status.RESULT) {
                console.debug(`Error code (${fetchResponse.status}) returned on fetch, error message: ${fetchResponse.error}`);

            }
            else {
                const nodes = (StorageUtil.ExtractFetchResponseNodes(fetchResponse, fetchRequest.query.preserveTransient,
                    Data.GetType(4)) as DataInterface[]).filter( node => !node.isSpecial() ) as DataInterface[];

                if (nodes.length > 0) {
                    onDataCBs.forEach( cb => cb(nodes) );
                }

                if (crdtView) {
                    delta = Buffer.concat([delta, fetchResponse.crdtResult.delta]);

                    const isLast = fetchResponse.seq === fetchResponse.endSeq;

                    const [a, b, c] = crdtView.handleResponse(nodes, isLast ? delta : undefined);

                    addedNodesId1s.push(...a);
                    updatedNodesId1s.push(...b);
                    deletedNodesId1s.push(...c);

                    if (isLast) {
                        delta = Buffer.alloc(0);

                        crdtView.triggerOnChange(addedNodesId1s, updatedNodesId1s, deletedNodesId1s);

                        addedNodesId1s = [];
                        updatedNodesId1s = [];
                        deletedNodesId1s = [];
                    }
                }
            }
        });

        const threadResponse: ThreadStreamResponseAPI = {
            onChange: (...parameters: Parameters<CRDTView["onChange"]>): ThreadStreamResponseAPI => {
                if (!crdtView) {
                    throw new Error("Thread not using CRDT, cannot call onChange()");
                }

                crdtView.onChange(...parameters);

                return threadResponse;
            },

            onData: (cb: (nodes: DataInterface[]) => void): ThreadStreamResponseAPI => {
                onDataCBs.push(cb)

                return threadResponse;
            },

            onCancel: (cb: () => void): ThreadStreamResponseAPI => {
                getResponse.onCancel(cb);

                return threadResponse;
            },

            stopStream: () => {
                this.storageClient.unsubscribe({
                    originalMsgId: getResponse.getMsgId(),
                    targetPublicKey: Buffer.alloc(0),
                });
            },

            updateStream: (updateStreamParams: UpdateStreamParams) => {
                // Replace with our new

                fetchRequest.crdt.msgId = getResponse.getMsgId();

                if (updateStreamParams.triggerInterval !== undefined) {
                    fetchRequest.query.triggerInterval = updateStreamParams.triggerInterval;
                }

                if (updateStreamParams.head !== undefined) {
                    fetchRequest.crdt.head         = updateStreamParams.head;
                }

                if (updateStreamParams.tail !== undefined) {
                    fetchRequest.crdt.tail         = updateStreamParams.tail;
                }

                if (updateStreamParams.cursorId1 !== undefined) {
                    fetchRequest.crdt.cursorId1    = updateStreamParams.cursorId1;
                }

                if (updateStreamParams.cursorIndex !== undefined) {
                    fetchRequest.crdt.cursorIndex  = updateStreamParams.cursorIndex;
                }

                if (updateStreamParams.reverse !== undefined) {
                    fetchRequest.crdt.reverse      = updateStreamParams.reverse;
                }

                this.storageClient.fetch(fetchRequest);
            },

            getResponse: (): GetResponse<FetchResponse> => {
                return getResponse;
            },

            getCRDTView: (): CRDTView => {
                if (!crdtView) {
                    throw new Error("Thread not using CRDT");
                }

                return crdtView;
            },

            getFetchRequest(): FetchRequest {
                return DeepCopy(fetchRequest);
            },
        };

        return threadResponse;
    }

    /**
     * @param name of the post template to use.
     * @param node to create licenses for.
     * @param threadLicenseParams params to overwrite template values with.
     * @returns Promise containing an array with all successfully stored licenses.
     *
     * Order of precedence for properties:
     * targets property has precendce in threadLicenseParams, then defaults, then template.
     * threadLicenseParams, defaults, template.
     * Where expireTime has precedence over validSeconds,
     * expireTime defaults to 30 days, if not set,
     * further more it will be set to same as node.getExpireTime() if that is set and smaller.
     * creationTime defaults to node.getCreationTime(), if not set.
     * nodeId1 and parentId are taken from the node.
     * owner is always set to current publicKey.
     */
    public async postLicense(name: string, node: DataInterface, threadLicenseParams: ThreadLicenseParams = {}): Promise<LicenseInterface[]> {
        const template = this.threadTemplate.postLicense[name] ?? {};

        const targets: Buffer[] | undefined =
            Thread.PickFirstProperty([threadLicenseParams, this.defaults,
                template], "targets") as (Buffer[] | undefined);

        if (!node.isLicensed() || node.getLicenseMinDistance() !== 0 || !targets) {
            return [];
        }

        const licenseNodes: LicenseInterface[] = [];

        const targetsLength = targets.length;
        for (let i=0; i<targetsLength; i++) {
            const targetPublicKey = targets[i];

            const licenseParams = this.parsePostLicense(name, node, {
                ...threadLicenseParams,
                targetPublicKey,
            });

            const licenseNode = await this.nodeUtil.createLicenseNode(licenseParams,
                this.signerPublicKey, this.signerSecretKey);

            licenseNodes.push(licenseNode);
        }

        const storedId1s = await this.storeNodes(licenseNodes);

        return licenseNodes.filter( license => {
            const id1 = license.getId1()!;
            return storedId1s.findIndex( id1b => id1b.equals(id1) ) > -1;
        });
    }

    /**
     * @returns StreamWriterInterface for writing blob data.
     */
    public getBlobStreamWriter(nodeId1: Buffer, streamReader: StreamReaderInterface): StreamWriterInterface {
        return new BlobStreamWriter(nodeId1, streamReader, this.storageClient);
    }

    /**
     * @returns StreamReaderInterface for reading blob data.
     */
    public getBlobStreamReader(nodeId1: Buffer): StreamReaderInterface {
        return new BlobStreamReader(nodeId1, [this.storageClient]);
    }

    /**
     * @param name of the post template to use
     * @param node to create license for
     * @param threadLicenseParams
     * @returns LicenseParams
     *
     * Order of precedence for properties:
     * threadLicenseParams, defaults, template.
     * Where expireTime has precedence over validSeconds,
     * expireTime defaults to 30 days, if not set,
     * further more it will be set to same as node.getExpireTime() if that is set and smaller.
     * creationTime defaults to node.getCreationTime(), if not set.
     * nodeId1 and parentId are taken from the node.
     * owner is always set to current publicKey.
     */
    protected parsePostLicense(name: string, node: DataInterface, threadLicenseParams: ThreadLicenseParams): LicenseParams {
        const nodeId1   = node.getId1();
        const parentId  = node.getParentId();

        assert(nodeId1);
        assert(parentId);

        const template = this.threadTemplate.postLicense[name] ?? {};

        let creationTime: number | undefined =
            Thread.PickFirstProperty([threadLicenseParams, template],
                "creationTime") as (number | undefined);

        if (creationTime === undefined) {
            creationTime = node.getCreationTime();
        }

        let expireTime: number | undefined =
            Thread.PickFirstProperty([threadLicenseParams, this.defaults, template],
                "expireTime") as (number | undefined);

        if (expireTime === undefined) {
            const validSeconds: number | undefined =
                Thread.PickFirstProperty([threadLicenseParams, this.defaults, template],
                    "validSeconds") as (number | undefined);

            if (validSeconds !== undefined) {
                expireTime = (creationTime ?? Date.now()) + validSeconds * 1000;
            }
        }

        if (expireTime === undefined) {
            expireTime = Date.now() + 30 * 24 * 3600 * 1000;
        }

        const nodeExpireTime = node.getExpireTime();

        if (nodeExpireTime !== undefined) {
            expireTime = Math.min(expireTime, nodeExpireTime);
        }

        const owner = this.publicKey;

        return ParseUtil.ParseLicenseParams(
            Thread.MergeProperties([{nodeId1, parentId, creationTime, expireTime, owner},
                threadLicenseParams, template]));
    }

    /**
     * @param name of the post template to use
     * @param threadDataParams
     * @returns DataParams
     *
     * Order of precedence for properties:
     * threadDataParams, defaults, template.
     * Where expireTime has precedence over validSeconds.
     * Note that expireTime has no default value for nodes and if not set
     * will be able to exist indefinitely.
     * owner is always set to current publicKey.
     */
    protected parsePost(name: string, threadDataParams: ThreadDataParams): DataParams {
        const template = this.threadTemplate.post[name] ?? {};

        const creationTime: number | undefined =
            Thread.PickFirstProperty([threadDataParams, template],
                "creationTime") as (number | undefined);

        let expireTime: number | undefined =
            Thread.PickFirstProperty([threadDataParams, this.defaults, template],
                "expireTime") as (number | undefined);

        if (expireTime === undefined) {
            const validSeconds: number | undefined =
                Thread.PickFirstProperty([threadDataParams, this.defaults, template],
                    "validSeconds") as (number | undefined);

            if (validSeconds !== undefined) {
                expireTime = (creationTime ?? Date.now()) + validSeconds * 1000;
            }
        }

        const owner = this.publicKey;

        const dataParams: DataParams = Thread.MergeProperties([{creationTime, expireTime, owner},
            threadDataParams, {parentId: this.defaults.parentId}, template]) as DataParams;

        if (!dataParams.parentId) {
            throw new Error("missing parentId in thread post");
        }

        return ParseUtil.ParseDataParams(dataParams);
    }

    /**
     * @param threadTemplate default properties coming from template.
     *  default value parentId have precedence over threadTemplate.
     * @param threadQueryParams have precedence over threadTemplate properties and default parentId.
     * @returns FetchQuery
     *
     */
    protected static ParseQuery(threadTemplate: ThreadTemplate,
        threadQueryParams: ThreadQueryParams, defaults: ThreadDefaults): FetchQuery {

        if (!threadTemplate.query) {
            throw new Error("Missing query template in Thread");
        }

        const queryParams = Thread.MergeProperties([threadQueryParams,
            {parentId: defaults.parentId}, threadTemplate.query]);


        if (queryParams.rootNodeId1?.length) {
            delete queryParams.parentId;
        }

        if (!queryParams.parentId && !queryParams.rootNodeId1) {
            if (!defaults.parentId) {
                throw new Error("parentId is missing in thread query");
            }
        }

        return ParseUtil.ParseQuery(queryParams);
    }

    /**
     * @params threadTemplate parameters have precedence over the crdt template properties.
     * @returns FetchCRDT
     */
    protected static ParseCRDT(threadTemplate: ThreadTemplate,
        threadCRDTParams: ThreadCRDTParams): FetchCRDT {

        return ParseUtil.ParseCRDT(
            Thread.MergeProperties([threadCRDTParams, (threadTemplate.crdt ?? {})]));
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
                throw new Error(`Could not store nodes, status=${storeResponse?.status} error=${storeResponse?.error}`);
            }

            return storeResponse.storedId1s;
        }
        else {
            throw new Error(`Could not store nodes, type=${anyData.type}, error=${anyData.error}`);
        }
    }

    /**
     * Merge a given list of property objects into a new object.
     * Keep the first value encountered in the list of objects (in order given).
     * undefined values are ignored.
     * Empty buffers are allowed to be overwritten by a non empty buffer.
     */
    protected static MergeProperties(objects: any[]): any {
        const merged: any = {};

        const objectsLength = objects.length;
        for (let i=0; i<objectsLength; i++) {
            const object = objects[i];

            const keys = Object.keys(object);
            const keysLength = keys.length;
            for (let i=0; i<keysLength; i++) {
                const key = keys[i];

                const value = object[key];

                if (value === undefined) {
                    continue;
                }

                const setValue = merged[key];

                if (Buffer.isBuffer(setValue) && setValue.length === 0 &&
                    Buffer.isBuffer(value) && value.length > 0)
                {
                    merged[key] = value;
                    continue;
                }

                if (setValue !== undefined) {
                    continue;
                }

                merged[key] = value;
            }
        }

        return merged;
    }

    protected static PickFirstProperty(objects: any[], propertyName: string): any {
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
