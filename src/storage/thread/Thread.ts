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
    AutoFetch,
} from "../../p2pclient";

import {
    ParseSchema,
} from "../../util/SchemaUtil";

import {
    StoreRequestSchema,
} from "../../request/jsonSchema";

import {
    CopyBuffer,
    DeepCopy,
} from "../../util/common";

import {
    TemplateSubstitute,
} from "../../util/TemplateUtil";

import {
    DataParams,
    LicenseParams,
    LicenseInterface,
    NodeInterface,
    DataInterface,
    SPECIAL_NODES,
    Hash,
    DataConfig,
} from "../../datamodel";

import {
    Status,
    FetchRequest,
} from "../../types";

import {
    ThreadTemplate,
    ThreadVariables,
} from "./types";

import {
    StreamReaderInterface,
    StreamWriterInterface,
    BlobStreamWriter,
    BlobStreamReader,
} from "../../datastreamer";

import {
    SetDataFn,
    UnsetDataFn,
    CRDTOnChangeCallback,
} from "../crdt/types";

import {
    StreamCRDT,
} from "../crdt/StreamCRDT";

import {
    Service,
} from "../../service/Service";

/**
 * The Thread is a convenient way of working with data in applications.
 *
 * The model of a Thread can in many cases be mapped directly to the application's UI.
 *
 * The Thread works in the intersection of the Service, CRDT and streaming queries.
 *
 * A Thread's definition include both query and post actions.
 *
 * Only Data (not License) nodes are kept in the model and nodes flagged as isSpecial are ignored.
 * This is because the underlying fetch request might need to includes License nodes and special
 * nodes (which are used for deleting nodes), but those nodes are not interesting for making up
 * the model provided by Thread (license still apply and are handled automatically).
 *
 * A Thread's FetchRequest is not required to use CRDT in which case the model will be append only
 * and is a cheap way of building a model without the CRDT heavy lifting, but the then the order
 * of nodes is not guaranteed.
 *
 * The model is managed by the StreamCRDT class.
 *
 * The Thread is defined with a ThreadTemplate often loaded from a JSON.
 * The template can define variables to be substituted as "${parentId}", for example.
 * These variables can then be passed in a ThreadVariables map to each function.
 *
 * the "owner" field is allowed to be set in the post templates but it must then match the
 * publicKey which the Thread is constructed with.
 *
 * For license post templates the field "targetPublicKey" is not allowed to be set as this is done
 * programmatically at runtime.
 *
 * If parentId is not provided for post() it is attempted to be copied from the fetch request.
 */
export class Thread {
    protected handlers: {[name: string]: ( (...args: any) => void)[]} = {};

    protected autoFetchers: AutoFetch[] = [];

    protected _isClosed: boolean = false;

    protected threadTemplate: ThreadTemplate;

    protected threadVariables: ThreadVariables;

    protected publicKey: Buffer;

    protected signerPublicKey: Buffer;

    protected secretKey?: Buffer;

    /* Keep track of all streaming requests so we can close them properly */
    protected streamCRDT?: StreamCRDT;

    /**
     * Factory to create a Thread using a Service object.
     *
     * @param threadTemplate the template most often parsed from a JSON.
     * @param threadVariables parameters to substitute values in the threadTemplate with for queries and streaming.
     * Note that parentId set here is used as default parentId for posting data if not explicitly set in the post template or threadVariables passed to post actions.
     * @param service the Service object to be used for storage and peer communication and to extract public key, etc.
     * @param autoStart if true then calls start() to start the streaming immediately. Default is true.
     * @param autoSync if true then calls setAutoSync() to start syncing with peer(s). Default is false.
     * Note that auto sync for Threads can also be inited from the app.json configuration, but in case creating
     * Thread configurations in runtime autoSync should generally be enabled when instantiating the Thread.
     * @param setDataFn passed to CRDTView
     * @param unsetDataFn passed to CRDTView
     * @param purgeInterval passed to StreamCRDT
     *
     * @returns new Thread object.
     */
    public static fromService(
        threadTemplate: ThreadTemplate,
        threadVariables: ThreadVariables,
        service: Service,
        autoStart: boolean = true,
        autoSync: boolean = false,
        setDataFn?: SetDataFn,
        unsetDataFn?: UnsetDataFn,
        purgeInterval: number = 60_000)
    {
        const storageClient = service.getStorageClient();
        assert(storageClient);

        const nodeUtil = service.getNodeUtil();

        const publicKey = service.getPublicKey();

        const signerPublicKey = service.getSignerPublicKey();

        return new Thread(threadTemplate, threadVariables, storageClient, nodeUtil, publicKey,
            signerPublicKey, undefined, setDataFn, unsetDataFn, autoStart, autoSync, purgeInterval,
            service);
    }

    /**
     *
     * @param threadTemplate the template most often parsed from a JSON.
     * @param threadVariables parameters to substitute values in the threadTemplate with for queries and streaming.
     * Note that parentId set here is used as default parentId for posting data if not explicitly set in the post template or threadVariables passed to post actions.
     * @param nodeUtil instantiated NodeUtil, if no SignatureOffloader inited then secretKey must also be passed as parameter
     * @param publicKey the public key to use as owner for new nodes
     * @param signerPublicKey the signing public key, could be same as public key
     * @param secretKey set to sign without SignatureOffloader
     * @param setDataFn passed to CRDTView
     * @param unsetDataFn passed to CRDTView
     * @param autoStart if true then calls start() to start the streaming immediately. Default is true.
     * @param autoSync if true then calls setAutoSync() to start syncing with peer(s). Default is false.
     * Note that auto sync for Threads can also be inited from the app.json configuration, but in case creating
     * Thread configurations in runtime autoSync should generally be enabled when instatiating the Thread.
     * @param purgeInterval passed to StreamCRDT
     * @param service the Service object to be used for syncing with peers, must be set if autoSync is set
     */
    constructor(
        threadTemplate: ThreadTemplate,
        threadVariables: ThreadVariables,
        protected storageClient: P2PClient,
        protected nodeUtil: NodeUtil,
        publicKey: Buffer,
        signerPublicKey: Buffer,
        secretKey?: Buffer,
        protected setDataFn?: SetDataFn,
        protected unsetDataFn?: UnsetDataFn,
        autoStart: boolean = true,
        autoSync: boolean = false,
        protected purgeInterval: number = 60_000,
        protected service?: Service)
    {
        this.threadTemplate = DeepCopy(threadTemplate) as ThreadTemplate;

        this.threadVariables = DeepCopy(threadVariables) as ThreadVariables;

        this.publicKey = DeepCopy(publicKey) as Buffer;

        this.signerPublicKey = DeepCopy(signerPublicKey) as Buffer;

        this.secretKey = DeepCopy(secretKey) as Buffer;

        storageClient.onClose(this.close);

        if (autoSync) {
            if (!service) {
                throw new Error("autoSync cannot be set in Thread if no Service object provided");
            }

            this.setAutoSync();
        }

        if (autoStart) {
            this.start();
        }
    }

    /**
     * Close down the Thread.
     *
     * This empties the model and makes the thread non functional.
     *
     * If wanting to only stop the streaming but keep the model call getStream().stopStream() instead.
     */
    public close = () => {
        if (this._isClosed) {
            return;
        }

        this.storageClient.offClose(this.close);

        this._isClosed = true;

        this.removeAutoSync();

        this.streamCRDT?.close();

        delete this.streamCRDT;

        this.triggerEvent("close");
    }

    public isClosed(): boolean {
        return this._isClosed;
    }

    public getStream(): StreamCRDT {
        if (!this.streamCRDT) {
            throw new Error("Not streaming");
        }

        return this.streamCRDT;
    }

    public isStreaming(): boolean {
        return this.streamCRDT !== undefined;
    }

    /**
     * Create auto sync configurations and pass them to the Service object.
     *
     * The FetchRequest will be modified to fit the purposes of the Thread which is to auto include
     * licenses and remove any CRDT configuration.
     *
     * If passing in arguments to modify the fetch request the thread template must support those
     * configuration changes in the thread template.
     *
     * @param threadVariables optionally set this to override the threads own threadVariables for
     * the fetch request.
     * This can be useful in cases wanting to change the underlying sync request to broaden
     * the data uptake for the model, for example by extending the limit.
     *
     * @param fetchRequestReverse optionally set this to override the thread
     * template fetch request for the reverse-fetch, that is the data pushed to remote peer(s),
     * this should in general be set the same as fetchRequest.
     */
    public setAutoSync(threadVariables?: ThreadVariables, reverseThreadVariables?: ThreadVariables) {
        if (this._isClosed || !this.service) {
            return;
        }

        this.removeAutoSync();

        const fetchRequest = Thread.GetFetchRequest(this.threadTemplate, {...this.threadVariables,
            ...threadVariables}, true);

        // Note that when we set includeLicenses="IncludeExtend" the Storage will automatically
        // add relevent licenses to the response and also automatically request licenses
        // to be extended for data matched.
        // This is a more fine grained approach in requesting licenses than using
        // query.embed and query.match on licenses.
        //
        fetchRequest.query.includeLicenses = "IncludeExtend";

        // We cancel any discard because we need the whole structure when syncing.
        //
        fetchRequest.query.match.forEach( match => match.discard = false );

        // Not relevant/allowed for auto fetch.
        //
        fetchRequest.query.preserveTransient = false;
        fetchRequest.crdt.algo = "";

        const autoFetch: AutoFetch = {
            fetchRequest,
            remotePublicKey: Buffer.alloc(0),
            blobSizeMaxLimit: -1,
            reverse: false,
        };

        this.service.addAutoFetch(autoFetch);

        this.autoFetchers.push(autoFetch);

        // Default limit on reverse is unlimited (-1).
        //
        const reverseFetchRequest = Thread.GetFetchRequest(this.threadTemplate, {...this.threadVariables,
            ...{limit: -1}, ...reverseThreadVariables}, true);

        // We cancel any "discard" flag because we need the whole structure when syncing.
        //
        reverseFetchRequest.query.match.forEach( match => match.discard = false );

        reverseFetchRequest.query.includeLicenses = "IncludeExtend";
        reverseFetchRequest.query.preserveTransient = false;
        reverseFetchRequest.crdt.algo = "";

        const autoFetchReverse: AutoFetch = {
            fetchRequest: reverseFetchRequest,
            remotePublicKey: Buffer.alloc(0),
            blobSizeMaxLimit: -1,
            reverse: true,
        };

        this.service.addAutoFetch(autoFetchReverse);

        this.autoFetchers.push(autoFetchReverse);
    }

    /**
     * @returns true if there is a sync requested.
     */
    public isAutoSyncing(): boolean {
        return this.autoFetchers.length > 0;
    }

    /**
     * Remove any sync added.
     */
    public removeAutoSync() {
        if (!this.service) {
            return;
        }

        this.autoFetchers.forEach( autoFetch => this.service!.removeAutoFetch(autoFetch) );
        this.autoFetchers = [];
    }

    /**
     * Issue the streaming query. Returned data is available in the CRDTView
     * and changes are notified on the onChange handler.
     *
     * @see GetFetchRequest() for details on defaults.
     */
    public start() {
        if (this.streamCRDT || this._isClosed) {
            return;
        }

        this.streamCRDT = new StreamCRDT(this.getFetchRequest(true), this.storageClient,
            this.setDataFn, this.unsetDataFn, this.purgeInterval);

        this.streamCRDT.getView().onChange( event => {
            this.triggerEvent("change", event);
        });

        this.streamCRDT.onStop( () => {
            this.triggerEvent("stop");
        });
    }

    /**
     * Cancel the streaming and updating but keep the model available.
     * Suger over getStream().stop().
     */
    public stop() {
        if (!this.streamCRDT || this._isClosed) {
            return;
        }

        this.streamCRDT.stop();
    }

    /**
     * Event triggered when a change in the CRDT model happens.
     * Suger over getStream().getView().onChange().
     */
    public onChange(cb: CRDTOnChangeCallback) {
        this.hookEvent("change", cb);
    }

    public offChange(cb: CRDTOnChangeCallback) {
        this.unhookEvent("change", cb);
    }

    /**
     * Event triggered when calling close() or when the storage client closes.
     */
    public onClose(cb: () => void) {
        this.hookEvent("close", cb);
    }

    public offClose(cb: () => void) {
        this.unhookEvent("close", cb);
    }

    /**
     * Event triggerd when the streaming stops, either by calling stop(), by some error,
     * by calling close() or when the storage client closes.
     * Suger over getStream().onStop().
     */
    public onStop(cb: () => void) {
        this.hookEvent("stop", cb);
    }

    public offStop(cb: () => void) {
        this.unhookEvent("stop", cb);
    }

    /**
     * Generate a FetchRequest based on a thread template and thread variables,
     * streaming or not streaming.
     *
     * For streaming, in the case none of triggerNodeId nor triggerInterval are set,
     * then triggerNodeId will be copied from query.parentId,
     * and in the case rootNodeId1 is used over parentId then there will be no
     * triggerNodeId automatically set but only triggerInterval set.
     *
     * Also, for streaming, triggerInterval will always be set to 60 if not already set.
     *
     * @param threadTemplate the template to use
     * @param threadVariables the params to override the template with
     * @param stream set to true to make a streaming fetch request.
     */
    public static GetFetchRequest(threadTemplate: ThreadTemplate,
        threadVariables: ThreadVariables = {}, stream: boolean = false): FetchRequest 
    {
        if (!threadTemplate.query) {
            throw new Error("Missing query template in Thread");
        }

        const queryParams = TemplateSubstitute(threadTemplate.query, threadVariables);

        if (queryParams.rootNodeId1?.length) {
            delete queryParams.parentId;
        }

        if (!queryParams.parentId && !queryParams.rootNodeId1) {
            throw new Error("parentId/rootNodeId1 is missing in thread query");
        }

        const query = ParseUtil.ParseQuery(queryParams);

        const crdtParams = TemplateSubstitute(threadTemplate.crdt ?? {}, threadVariables);

        const crdt = ParseUtil.ParseCRDT(crdtParams);

        if (stream) {
            if (query.triggerNodeId.length === 0 && query.triggerInterval === 0) {
                query.triggerNodeId = CopyBuffer(query.parentId);
            }

            if (query.triggerInterval === 0) {
                query.triggerInterval = 60;
            }

            // At this point we are quaranteed that at least triggerInterval is set.
            //

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

    /**
     * Generate the FetchRequest for this thread based on the template and threadVariables
     * provided in the constructor.
     * @see GetFetchRequest() for details.
     *
     * @param stream set to true to create a FetchRequest for streaming
     * @returns FetchRequest
     */
    public getFetchRequest(stream: boolean = false): FetchRequest {
        return Thread.GetFetchRequest(this.threadTemplate, this.threadVariables, stream);
    }

    /**
     * Post a new node.
     *
     * If parentId is not set then it is copied form the fetch request if it is availabe.
     *
     * Note that the post template must provide substitution and threadVariables
     * need to provide the data to be substituted with.
     *
     * @param name of the post template to use
     * @param threadVariables values to substitute with in the post template
     * @returns the node created
     * @throws if data node could not be created or stored, or if parentId is not set
     */
    public async post(name: string,
        threadVariables: ThreadVariables = {}): Promise<DataInterface>
    {
        const dataParams = this.parsePost(name, threadVariables);

        if (!dataParams.parentId || dataParams.parentId.length === 0) {
            throw new Error("missing parentId in thread post");
        }

        const dataNode = await this.nodeUtil.createDataNode(dataParams, this.signerPublicKey,
            this.secretKey);

        const storedId1List = await this.storeNodes([dataNode]);

        if (storedId1List.length > 0) {
            return dataNode;
        }

        throw new Error("Thread could not store data node");
    }

    /**
     * Post a node which is an annotation node meant to edit the given node.
     *
     * Note that the post template must provide substitution and threadVariables
     * need to provide the data to be substituted with.
     *
     * @param name of the post template to use.
     * @param nodeToEdit the node we want to annotate with an edited node.
     * @param threadVariables values to substitute with in the post template
     * Note that it is application specific if the blobHash and other values are relevant for
     * the new edit node.
     *
     * @returns the edit node.
     * @throws if edit node cannot be stored.
     */
    public async postEdit(name: string, nodeToEdit: NodeInterface,
        threadVariables: ThreadVariables = {}): Promise<DataInterface>
    {
        const dataParams = this.parsePost(name, threadVariables);

        dataParams.parentId = nodeToEdit.getId();
        dataParams.expireTime = nodeToEdit.getExpireTime();
        dataParams.dataConfig = (dataParams.dataConfig ?? 0) | (1 << DataConfig.IS_ANNOTATION_EDIT);

        const dataNode = await this.nodeUtil.createDataNode(dataParams, this.signerPublicKey,
            this.secretKey);

        const storedId1List = await this.storeNodes([dataNode]);

        if (storedId1List.length > 0) {
            return dataNode;
        }

        throw new Error("Thread could not store edit node");
    }

    /**
     * Post a node which is an annotation node meant as a reaction to a node.
     *
     * Note that the post template must provide substitution and threadVariables
     * need to provide the data to be substituted with.
     *
     * @param name of the post template to use.
     * @param node the node we are reaction to.
     * @param threadVariables should contain same data as for post() but where the data field is
     * Buffer.from("react/thumbsup") or Buffer.from("unreact/thumbsup"),
     * where "thumbsup" is the reaction name.
     */
    public async postReaction(name: string, node: NodeInterface,
        threadVariables: ThreadVariables = {}): Promise<DataInterface>
    {
        const dataParams = this.parsePost(name, threadVariables);

        dataParams.parentId = node.getId();
        dataParams.expireTime = node.getExpireTime();
        dataParams.dataConfig = (dataParams.dataConfig ?? 0) | (1 << DataConfig.IS_ANNOTATION_REACTION);

        const dataNode = await this.nodeUtil.createDataNode(dataParams, this.signerPublicKey,
            this.secretKey);

        const storedId1List = await this.storeNodes([dataNode]);

        if (storedId1List.length > 0) {
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
                this.secretKey);

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
                this.secretKey);

            destroyNodes.push(dataNode);
        }

        if (destroyNodes.length === 0) {
            throw new Error("Cannot delete node");
        }

        const storedId1List = await this.storeNodes(destroyNodes);

        return destroyNodes.filter( node =>
            storedId1List.findIndex( id1 => node.getId1()?.equals(id1) ) > -1 );
    }

    /**
     *
     * @param name of the post template to use.
     * @param nodes to create licenses for. Either single node or array of nodes
     * nodeId1 and parentId are taken from each node
     * @param targetPublicKeys array of public keys for each to create a license for
     * @param threadVariables values to substitute with in the post license template
     * expireTime defaults to 30 days, if not set, but will be adjusted down if node's expireTime is
     * smaller. expireTime can be set negative to be Date.now() + abs(expireTime).
     * @returns Promise containing an array with all successfully stored licenses
     * @throws if targetPublicKey is set in the template or if owner is set but mismatch,
     * or if nodes cannot be created
     */
    public async postLicense(name: string, nodes: DataInterface | DataInterface[],
        targetPublicKeys: Buffer[],
        threadVariables: ThreadVariables = {}): Promise<LicenseInterface[]>
    {
        if (!Array.isArray(nodes)) {
            nodes = [nodes];
        }

        const licenseNodes: LicenseInterface[] = [];

        const nodesLength = nodes.length;
        for (let i=0; i<nodesLength; i++) {
            const node = nodes[i];

            if (!node.isLicensed() || node.getLicenseMinDistance() !== 0) {
                continue;
            }

            const targetsLength = targetPublicKeys.length;
            for (let i=0; i<targetsLength; i++) {
                const targetPublicKey = targetPublicKeys[i];

                const licenseParams = this.parsePostLicense(name, node, targetPublicKey,
                    threadVariables);

                const licenseNode = await this.nodeUtil.createLicenseNode(licenseParams,
                    this.signerPublicKey, this.secretKey);

                licenseNodes.push(licenseNode);
            }
        }

        const storedId1List = await this.storeNodes(licenseNodes);

        return licenseNodes.filter( license => {
            const id1 = license.getId1()!;
            return storedId1List.findIndex( id1b => id1b.equals(id1) ) > -1;
        });
    }

    /**
     * @returns StreamWriterInterface for writing blob data.
     */
    public getBlobStreamWriter(nodeId1: Buffer, streamReader: StreamReaderInterface): StreamWriterInterface {
        return new BlobStreamWriter(nodeId1, streamReader, this.storageClient);
    }

    /**
     * Helper function to get a StreamReader to stream a blob from storage.
     *
     * @param nodeId1
     * @param expectedLength optionally set this to the lenght of the blob to protected
     * against overflow.
     * @returns StreamReaderInterface for reading blob data.
     * @throws on error
     */
    public getBlobStreamReader(nodeId1: Buffer, expectedLength: bigint = -1n): StreamReaderInterface {
        return new BlobStreamReader(nodeId1, [this.storageClient], expectedLength);
    }

    protected parsePostLicense(name: string, node: DataInterface, targetPublicKey: Buffer,
        threadVariables: ThreadVariables): LicenseParams
    {
        const nodeId1   = node.getId1();
        const parentId  = node.getParentId();

        assert(nodeId1);
        assert(parentId);

        const obj = TemplateSubstitute(this.threadTemplate, threadVariables);

        assert(obj.postLicense[name], `Missing thread.postLicense template for ${name}`);

        const licenseParams = DeepCopy(obj.postLicense[name]);

        if (licenseParams.targetPublicKey?.length > 0) {
            throw new Error("targetPublicKey must not be set in thread postLicense template");
        }

        if (licenseParams.owner?.length > 0 &&
            // Note: Buffer.from takes both Buffer and string even if second argument is
            // given in the Buffer case.
            !Buffer.from(licenseParams.owner, "hex").equals(this.publicKey))
        {
            throw new Error("Owner set to different public key than expected");
        }

        licenseParams.targetPublicKey = targetPublicKey;

        licenseParams.owner = this.publicKey;

        licenseParams.parentId = parentId;

        licenseParams.nodeId1 = nodeId1;

        const licenseParams2 = ParseUtil.ParseLicenseParams(licenseParams);

        if (licenseParams2.expireTime === undefined) {
            licenseParams2.expireTime = Date.now() + 30 * 24 * 3600 * 1000;
        }

        const nodeExpireTime = node.getExpireTime();

        if (nodeExpireTime !== undefined) {
            licenseParams2.expireTime = Math.min(licenseParams2.expireTime, nodeExpireTime);
        }

        return licenseParams2;
    }

    protected parsePost(name: string, threadVariables: ThreadVariables): DataParams {
        const obj = TemplateSubstitute(this.threadTemplate, threadVariables);

        assert(obj.post[name], `Missing thread.post template for ${name}`);

        const dataParams = DeepCopy(obj.post[name]);

        if (dataParams.owner?.length > 0 &&
            // Note: Buffer.from takes both Buffer and string even if second argument is
            // given in the Buffer case.
            !Buffer.from(dataParams.owner, "hex").equals(this.publicKey))
        {
            throw new Error("Owner set to different public key than expected");
        }

        dataParams.owner = this.publicKey;

        // Set default parentId same as query template
        //
        if (!dataParams.parentId?.length) {
            const fetchRequest = this.getFetchRequest();
            dataParams.parentId = fetchRequest.query.parentId;
        }

        return ParseUtil.ParseDataParams(dataParams);
    }

    /**
     * @param nodes list of node objects to store.
     * @returns list of stored ID1s
     * @throws on error
     */
    protected async storeNodes(nodes: NodeInterface[]): Promise<Buffer[]> {
        const storeRequest = ParseSchema(StoreRequestSchema,
            {nodes: nodes.map( node => node.export())});

        const {getResponse} = this.storageClient.store(storeRequest);

        if (!getResponse) {
            throw new Error("Could not communicate with storage as expected when storing nodes.");
        }

        const anyData = await getResponse.onceAny();

        if (anyData.type === EventType.REPLY) {
            const storeResponse = anyData.response;

            if (!storeResponse || storeResponse.status !== Status.Result) {
                throw new Error(`Could not store nodes, status=${storeResponse?.status} error=${storeResponse?.error}`);
            }

            return storeResponse.storedId1List;
        }
        else {
            throw new Error(`Could not store nodes, type=${anyData.type}, error=${anyData.error}`);
        }
    }

    protected hookEvent(name: string, callback: ( (...args: any) => void)) {
        const cbs = this.handlers[name] || [];
        this.handlers[name] = cbs;
        cbs.push(callback);
    }

    protected unhookEvent(name: string, callback: ( (...args: any) => void)) {
        const cbs = (this.handlers[name] || []).filter( (cb: ( (...args: any) => void)) => callback !== cb );
        this.handlers[name] = cbs;
    }

    protected triggerEvent(name: string, ...args: any) {
        const cbs = this.handlers[name] || [];
        cbs.forEach( (callback: ( (...args: any) => void)) => {
            setImmediate( () => callback(...args) );
        });
    }
}
