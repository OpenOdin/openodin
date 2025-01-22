import {
    DataNode,
    DataNodeInterface,
} from "../../datamodel";

import {
    FieldType,
    Fields,
    UnpackSchema,
    PackSchema,
} from "../../datamodel/PackSchema";

import {
    NodeValues,
} from "./types";

import {
    IsGreater,
} from "../../util/common";

/**
 * The details come from the node representing the reaction.
 */
type AggregatedReaction = {
    id1: Buffer,
    active: boolean,
    creationTime: number,
};

/**
 * Internally used datamodel to aggregate reactions grouped
 * by their name and the node owner.
 */
type AggregatedReactions = {
    [reactionName: string]: {
        [owner: string]: AggregatedReaction[],
    },
};

export type Reaction = {
    /** total count of reactions of given type. */
    count: number,

    /**
     * List of the first x public keys reacting.
     * Due to space limitation a full list might not be set.
     * Public keys are sorted in the order they were returned from the database, however
     * if the target fetcher has reacted then thir publickey will be be present as the first key.
     */
    publicKeys: string[],
};

/**
 * The condensed summary of the AggregatedReactions, stored in the model in JSON format.
 */
export type Reactions = {
    /**
     * If hasMore is set that is an indicator that not all reactions could
     * fit inside this model.
     */
    hasMore: boolean,

    /**
     * Reactions are added as many as there is space for, breadth first, depth second.
     * For every reaction there is at least one entry of who submitted the reaction,
     * if the target fetcher has reacted then their publickey will be present as the first key.
     */
    reactions: {
        [reactionName: string]: Reaction,
    },
};

type CRDTMessagesAnnotationsProps = {
    reactions?: string,
    editNode?: Buffer,
    reaction?: string,
    hasNestedConversation?: number,
};

const CRDTMessagesAnnotationsSchema: Fields = {
    editNode: {
        index: 10,
        type: FieldType.BYTES,
        maxSize: 8192,
    },
    reactions: {
        index: 11,
        type: FieldType.STRING,
        maxSize: 4096,
    },
    hasNestedConversation: {
        type: FieldType.UINT8,
        index: 12,
    },
} as const;

/**
 * This is a serializeable data holder of the CRDT annotations attached to data nodes
 * by the CRDT algorithms.
 */
export class CRDTMessagesAnnotations {
    protected readonly fields = CRDTMessagesAnnotationsSchema;
    protected props: CRDTMessagesAnnotationsProps = {};
    protected aggregatedReactions: AggregatedReactions = {};

    /**
     * @param targetPublicKey hex-encoded public key of the fetch target,
     * which is used when packing and exporting the data.
     */
    constructor(protected targetPublicKey: string = "") {}

    /**
     * Load model packed Buffer.
     *
     * @param packed - packed data to load
     *
     * @throws an error containing a message error when packed load fails to decode.
     */
    public load(packed: Buffer) {
        this.props =
            UnpackSchema(packed, this.fields) as CRDTMessagesAnnotationsProps;
    }

    /**
     * @returns exported data Buffer
     *
     * @throws an error containing a message error when unable to export the current data model.
     */
    public export(): Buffer {
        this.condenseReactionAggregations();

        const reactions = this.parseAggregatedReactions();

        this.limitReactionsSize(reactions);

        this.props.reactions = JSON.stringify(reactions);

        return PackSchema(this.fields, this.props);
    }

    /**
     * Condense the aggregated reactions in place.
     */
    protected condenseReactionAggregations() {
        // Sort all reactions to get the newest first so we can remove reactions who
        // have been unreacted.
        //
        for (const reactionName in this.aggregatedReactions) {
            const aggregated = this.aggregatedReactions[reactionName];

            const publicKeys = Object.keys(aggregated);

            for (const publicKey of publicKeys) {
                aggregated[publicKey].sort( (a, b) =>
                    IsGreater(a.creationTime, b.creationTime, a.id1, b.id1) ? -1 : 1 );

                aggregated[publicKey].length = 1;

                // If the newest reaction as an unreactiong then remove it all.
                //
                if (!aggregated[publicKey][0].active) {
                    delete aggregated[publicKey];
                }
            }

            if (Object.keys(aggregated).length === 0) {
                delete this.aggregatedReactions[reactionName];
            }
        }
    }

    protected parseAggregatedReactions(): Reactions {
        const reactions: Reactions = {
            hasMore: false,
            reactions: {},
        };

        for (const reactionName in this.aggregatedReactions) {
            const aggregated = this.aggregatedReactions[reactionName];

            let publicKeys = Object.keys(aggregated);

            const publicKeysSet = new Set<string>(publicKeys);

            // If the target public key is in the list we want to put it first.
            if (publicKeysSet.has(this.targetPublicKey)) {
                publicKeysSet.delete(this.targetPublicKey);

                publicKeys = Array.from(publicKeysSet);

                publicKeys.unshift(this.targetPublicKey);
            }

            reactions.reactions[reactionName] = {
                count: publicKeys.length,
                publicKeys,
            };
        }

        return reactions;
    }

    /**
     * Limit in place the size of the Reactions result.
     * @throws if limit threshold cannot be reached.
     */
    protected limitReactionsSize(reactions: Reactions, maxSize: number = 4096) {

        let json = JSON.stringify(reactions);

        while (json.length > maxSize) {
            const reactionNames = Object.keys(reactions.reactions);

            let maxPublicKeys: string[] = [];
            let reactionName2 = "";

            reactionNames.forEach( reactionName => {
                const publicKeys = reactions.reactions[reactionName].publicKeys;

                if (publicKeys.length >= maxPublicKeys.length) {
                    maxPublicKeys = publicKeys;
                    reactionName2 = reactionName;
                }
            });

            maxPublicKeys.length = Math.floor(maxPublicKeys.length / 2);

            if (maxPublicKeys.length === 0) {
                delete reactions.reactions[reactionName2];
            }

            reactions.hasMore = true;

            const json2 = JSON.stringify(reactions);

            if (json2.length === json.length) {
                throw new Error("Cannot limit Reactions in size any further");
            }

            json = json2;
        }
    }

    /**
     * Set the edited node.
     * A node with a newer creationTime will replace an old node.
     */
    public setEditNode(node: DataNodeInterface | undefined): boolean {
        if (!node) {
            this.props.editNode = undefined;

            return false;
        }

        const currentNode = this.getEditNode();

        if (currentNode) {
            // We need to diff creation times.

            const creationTimeA = currentNode.getProps().creationTime ?? 0;
            const id1A = currentNode.getProps().id1 as Buffer;

            const creationTimeB = node.getProps().creationTime ?? 0;
            const id1B = node.getProps().id1 as Buffer;

            if (IsGreater(creationTimeB, creationTimeA, id1B, id1A)) {

                this.props.editNode = node.pack();

                return true;
            }
        }
        else {
            this.props.editNode = node.pack();

            return true;
        }

        return false;
    }

    public getEditNode(): DataNodeInterface | undefined {
        const data = this.props.editNode;

        if (data) {
            const node = new DataNode(data);

            // Edit nodes do not preserve transient values as these are ignored.
            //
            node.unpack();

            return node;
        }

        return undefined;
    }

    /**
     * Idempotent function to add a reaction.
     *
     * Added reactions are parsed in export().
     */
    public addReaction(id1: Buffer, creationTime: number, owner: Buffer, reaction: string): boolean {
        const [onOff, reactionName] = reaction.split("/");

        if ((onOff !== "react" && onOff !== "unreact") || !reactionName) {
            return false;
        }

        const active = onOff === "react";

        const reactionsObject = this.aggregatedReactions[reactionName] ?? {};
        this.aggregatedReactions[reactionName] = reactionsObject;

        const ownerStr = owner.toString("hex");

        const list = reactionsObject[ownerStr] ?? [];
        reactionsObject[ownerStr] = list;

        list.push({id1, creationTime, active});

        return true;
    }

    public getReactions(): Reactions {
        const data = this.props.reactions;

        if (data) {
            return JSON.parse(data) as Reactions;
        }

        return {
            hasMore: false,
            reactions: {},
        };
    }

    public setHasNestedConversation(): boolean {
        const hasNestedConversation = this.hasNestedConversation();

        this.props.hasNestedConversation = 1;

        return !hasNestedConversation;
    }

    public hasNestedConversation(): boolean {
        return this.props.hasNestedConversation ? true : false;
    }

    /**
     * Modify all parent nodes in place with annotations.
     */
    public static Factory(node: DataNodeInterface, parentNodes: NodeValues[],
        targetPublicKey: string): Buffer[]
    {
        const updatedNodes: Buffer[] = [];

        const owner = node.getProps().owner;
        const id1 = node.getProps().id1;
        const creationTime = node.getProps().creationTime ?? 0;
        const data = node.getProps().data;

        if (!id1 || !owner) {
            return [];
        }

        const parentNodesLength = parentNodes.length;

        for (let i=0; i<parentNodesLength; i++) {
            const parentNode = parentNodes[i];

            let isUpdated = false;

            const flags = node.loadFlags();

            if (flags.isAnnotationEdit) {
                // An edit node to replace the main node's content.
                //
                if (owner.equals(parentNode.owner)) {
                    parentNode.annotations = parentNode.annotations ?? new CRDTMessagesAnnotations(targetPublicKey);

                    isUpdated =
                        parentNode.annotations.setEditNode(node);
                }
                else {
                    // Ignore this node since owner is different.
                }
            }
            else if (flags.isAnnotationReaction) {
                // Reactions
                //
                parentNode.annotations = parentNode.annotations ?? new CRDTMessagesAnnotations(targetPublicKey);

                if (data) {
                    isUpdated =
                        parentNode.annotations.addReaction(id1, creationTime, owner,
                            data.toString());
                }
            }
            else {
                // A child node which is not an annotation node is a nested
                // conversation below the main node.
                //
                parentNode.annotations = parentNode.annotations ?? new CRDTMessagesAnnotations(targetPublicKey);

                isUpdated =
                    parentNode.annotations.setHasNestedConversation();
            }

            if (isUpdated) {
                updatedNodes.push(parentNode.id1);
            }
        }

        return updatedNodes;
    }
}
