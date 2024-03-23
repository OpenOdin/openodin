import {
    Model,
    Fields,
    FieldType,
    ModelType,
    DataInterface,
    Data,
} from "../../datamodel";

import {
    NodeValues,
} from "./types";

import {
    IsGreater,
} from "../../util/common";

/**
 */
const FIELDS: Fields = {
    editNode: {
        name: "editNode",
        type: FieldType.BYTES,
        index: 100,
        maxSize: 8192,
    },
    reactions: {
        name: "reactions",
        type: FieldType.STRING,
        index: 101,
        maxSize: 4096,
    },
    hasNestedConversation: {
        name: "hasNestedConversation",
        type: FieldType.UINT8,
        index: 102,
    },
};

// Primary interface ID 0 is an undefined namespace which can only be used in known contexts.
// We use this undefined namespace for models which do not need to clutter the global namespace.
const PRIMARY_INTERFACE_ID   = 0;
const SECONDARY_INTERFACE_ID = 1;
const NODE_CLASS             = 0;
const CLASS_MAJOR_VERSION    = 0;
//eslint-disable-next-line @typescript-eslint/no-unused-vars
const CLASS_MINOR_VERSION    = 0;

export const CRDT_MESSAGES_ANNOTATIONS_TYPE: ModelType = Buffer.from([0, PRIMARY_INTERFACE_ID, 0,
    SECONDARY_INTERFACE_ID, NODE_CLASS, CLASS_MAJOR_VERSION]);

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

/**
 * This is a serializeable data holder of the CRDT annotations attached to data nodes
 * by the CRDT algorithms.
 */
export class CRDTMessagesAnnotations {
    protected model: Model;
    protected aggregatedReactions: AggregatedReactions = {};

    /**
     * @param targetPublicKey hex-encoded public key of the fetch target,
     * which is used when packing and exporting the data.
     */
    constructor(protected targetPublicKey: string = "") {
        this.model = new Model(CRDT_MESSAGES_ANNOTATIONS_TYPE, FIELDS);
    }

    /**
     * Load model image Buffer.
     *
     * @param image - image data to load
     *
     * @throws an error containing a message error when image load fails to decode.
     */
    public load(image: Buffer) {
        this.model.load(image);
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

        this.model.setString("reactions", JSON.stringify(reactions));

        return this.model.export();
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
     * @returns hash of the model
     **/
    //public hash(): Buffer {
        //return this.model.hash();
    //}

    /**
     * Set the edited node.
     * A node with a newer creationTime will replace an old node.
     */
    public setEditNode(node: DataInterface | undefined): boolean {
        if (!node) {
            this.model.setBuffer("editNode", undefined);
            return false;
        }

        const currentNode = this.getEditNode();

        if (currentNode) {
            // We need to diff creation times.

            const creationTimeA = currentNode.getCreationTime() ?? 0;
            const id1A = currentNode.getId1() as Buffer;

            const creationTimeB = node.getCreationTime() ?? 0;
            const id1B = node.getId1() as Buffer;

            if (IsGreater(creationTimeB, creationTimeA, id1B, id1A)) {
                this.model.setBuffer("editNode", node.export());

                return true;
            }
        }
        else {
            this.model.setBuffer("editNode", node.export());

            return true;
        }

        return false;
    }

    public getEditNode(): DataInterface | undefined {
        const data = this.model.getBuffer("editNode");

        if (data) {
            const node = new Data();

            // Edit nodes do not preserve transient values as these are ignored.
            //
            node.load(data);

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
        const data = this.model.getString("reactions");

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

        this.model.setNumber("hasNestedConversation", 1);

        return !hasNestedConversation;
    }

    public hasNestedConversation(): boolean {
        return this.model.getNumber("hasNestedConversation") ? true : false;
    }

    /**
     * Modify all parent nodes in place with annotations.
     */
    public static Factory(node: DataInterface, parentNodes: NodeValues[], targetPublicKey: string): Buffer[] {
        const updatedNodes: Buffer[] = [];

        const owner = node.getOwner();
        const id1 = node.getId1();
        const creationTime = node.getCreationTime() ?? 0;
        const data = node.getData();

        if (!id1 || !owner) {
            return [];
        }

        const parentNodesLength = parentNodes.length;

        for (let i=0; i<parentNodesLength; i++) {
            const parentNode = parentNodes[i];

            let isUpdated = false;

            if (node.isAnnotationEdit()) {
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
            else if (node.isAnnotationReaction()) {
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
