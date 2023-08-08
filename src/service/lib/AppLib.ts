import {
    StreamReaderInterface,
    BlobStreamReader,
    BlobStreamWriter,
} from "../../datastreamer";

import {
    P2PClient,
    AnyData,
} from "../../p2pclient";

import {
    AppConfig,
} from "../types";

import {
    Status,
    EventType,
    ReadBlobResponse,
} from "../../types";

import {
    MAX_READBLOB_LENGTH,
} from "../../storage/types";

import {
    DataInterface,
    NodeInterface,
    SignatureOffloaderInterface,
    PrimaryNodeCertInterface,
    LicenseInterface,
    CMP,
    DataParams,
    LicenseParams,
} from "../../datamodel";

import {
    StorageUtil,
    NodeUtil,
} from "../../util";

export class AppLib {
    protected nodeUtil: NodeUtil;

    constructor(
        protected storageClient: P2PClient,
        protected signatureOffloader: SignatureOffloaderInterface,
        protected publicKey: Buffer,
        protected signerPublicKey: Buffer,
        protected appConfig: AppConfig,
        protected nodeCerts: PrimaryNodeCertInterface[]) {

        this.nodeUtil = new NodeUtil(this.signatureOffloader);
    }

    public async createDataNode(params: DataParams): Promise<DataInterface> {
        const owner         = this.publicKey;
        const creationTime  = params.creationTime ?? Date.now();

        return this.nodeUtil.createDataNode({
            ...params,
            creationTime,
            owner,
        }, this.signerPublicKey, undefined, this.nodeCerts);
    }

    public async createLicenseNodes(params: LicenseParams): Promise<LicenseInterface[]> {
        const validSeconds  = this.appConfig.licenseValidSeconds ?? 3600;
        const targets       = this.appConfig.licenseTargets ?? [];
        const owner         = this.publicKey;
        const extensions    = params.extensions     ?? this.appConfig.licenseExtensions ?? 0;
        const creationTime  = params.creationTime   ?? Date.now();
        const expireTime    = params.expireTime     ?? creationTime + validSeconds * 1000;
        const jumpPeerPublicKey = params.jumpPeerPublicKey ?? this.appConfig.jumpPeerPublicKey;

        const licenses: LicenseInterface[] = [];

        for (let i=0; i<targets.length; i++) {
            const targetPublicKey = targets[i];

            const license = await this.nodeUtil.createLicenseNode({
                ...params,
                owner,
                extensions,
                creationTime,
                expireTime,
                jumpPeerPublicKey,
                targetPublicKey,
            }, this.signerPublicKey, undefined, this.nodeCerts);

            licenses.push(license);
        }

        return licenses;
    }

    /**
     * Helper function to store nodes to configured storage of underlaying Service.
     * @param nodes list of node objects to store.
     * @returns list of stored ID1s
     * @throws on error
     */
    public async storeNodes(nodes: NodeInterface[]): Promise<Buffer[]> {
        const storeRequest = StorageUtil.CreateStoreRequest({nodes: nodes.map( node => node.export() )});

        const {getResponse} = this.storageClient.store(storeRequest);

        if (!getResponse) {
            throw new Error("Could not communicate as expected.");
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

    /**
     * Helper function to create and store a blob using a StreamReader,
     *
     * The given streamReader is automatically closed when finished (also on error).
     *
     * @param nodeId1
     * @param streamReader a ready to go stream reader to read data from.
     * @throws on error
     */
    public async streamStoreBlob(nodeId1: Buffer, streamReader: StreamReaderInterface) {
        const streamWriter = new BlobStreamWriter(nodeId1, streamReader, this.storageClient);

        try {
            await streamWriter.run();
        }
        catch(e) {
            console.error(e);
            throw e;
        }
        finally {
            streamWriter.close();
            streamReader.close();
        }
    }

    /**
     * Helper function to stream a blob from storage.
     *
     * @param nodeId1
     * @returns streamReader
     * @throws on error
     */
    public getBlobStreamReader(nodeId1: Buffer): StreamReaderInterface {
        const streamReader = new BlobStreamReader(nodeId1, [this.storageClient]);
        return streamReader;
    }

    /**
     * Fetch a single data node. Permissions apply.
     * @param nodeId1 the nodes id1.
     * @param parentId the nodes parentId.
     */
    public async fetchDataNode(nodeId1: Buffer, parentId: Buffer): Promise<DataInterface | undefined> {
        const fetchRequest = StorageUtil.CreateFetchRequest({
            query: {
                parentId,
                match: [
                    {
                        nodeType: "00040001",
                        filters: [
                            {
                                field: "id1",
                                cmp: CMP.EQ,
                                value: nodeId1,
                            }
                        ],
                    },
                ],
                limit: 1,
            },
        });

        const {getResponse} = this.storageClient.fetch(fetchRequest);

        if (!getResponse) {
            return undefined;
        }

        const anyDataPromise = getResponse.onceAny();

        const anyData = await anyDataPromise;

        if (anyData.type === EventType.REPLY) {
            const fetchResponse = anyData.response;

            if (fetchResponse && fetchResponse.status === Status.RESULT) {
                const nodes = StorageUtil.ExtractFetchResponseNodes(fetchResponse);
                if (nodes.length > 0) {
                    return nodes[0] as DataInterface;
                }
            }
        }

        return undefined;
    }

    /**
     * Helper function to create and store a small blob.
     * Maximum size allowed is 60 KiB, for larger blobs use the stream upload function.
     *
     * @param nodeId1
     * @param data the full data of the blob, maximum size allowed is 60 KiB.
     * @throws on error
     */
    public async storeBlob(nodeId1: Buffer, data: Buffer) {
        if (data.length > 1024 * 60) {
            throw new Error("Maximum blob size allowed is 60 KiB. For larger blobs use the stream uploder");
        }

        const writeBlobRequest = StorageUtil.CreateWriteBlobRequest({nodeId1, data});

        const {getResponse} = this.storageClient.writeBlob(writeBlobRequest);

        if (!getResponse) {
            throw new Error("Could not communicate as expected.");
        }

        const anyData = await getResponse.onceAny();

        if (anyData.type === EventType.REPLY) {
            const writeBlobResponse = anyData.response;

            if (!writeBlobResponse || writeBlobResponse.status !== Status.EXISTS) {
                throw new Error(`Could not store blob: ${writeBlobResponse?.error}`);
            }
        }
        else {
            throw new Error(`Could not store blob: ${anyData.error}`);
        }
    }

    /**
     * Read blob contents, maximum MAX_READBLOB_LENGTH (1 MiB) at a time.
     */
    public readBlob(nodeId1: Buffer, length?: number, pos?: bigint): Promise<Buffer> {
        length = length ?? MAX_READBLOB_LENGTH;

        if (length > MAX_READBLOB_LENGTH) {
            throw new Error(`Maximum blob read length is ${MAX_READBLOB_LENGTH}. For larger requests call readBlob multiple times or use the streamBlob function.`);
        }

        pos = pos ?? 0n;

        const readBlobRequest = StorageUtil.CreateReadBlobRequest({
            nodeId1,
            length,
            pos,
        });

        const {getResponse} = this.storageClient.readBlob(readBlobRequest);

        if (!getResponse) {
            throw new Error("Could not communicate as expected.");
        }

        return new Promise( (resolve, reject) => {
            const buffers: Buffer[] = [];

            getResponse.onAny( (anyData: AnyData<ReadBlobResponse>) => {
                if (anyData.type === EventType.REPLY) {
                    const readBlobResponse = anyData.response;

                    if (readBlobResponse?.status === Status.RESULT) {
                        buffers.push(readBlobResponse.data);

                        if (readBlobResponse.seq === readBlobResponse.endSeq) {
                            resolve(Buffer.concat(buffers));
                        }

                        return;
                    }
                }

                console.debug("Unexpected reply in readBlob()", anyData);

                reject("Unexpected reply in readblob()");
            });
        });
    }
}
