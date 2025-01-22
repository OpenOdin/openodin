/**
 * At this level (1), the BaseCert is the smallest deviation away from
 * the BaseModel setting it on the path of being a certificate.
 */

import {
    Fields,
    FieldType,
} from "../../PackSchema";

import {
    ParseSchemaType,
} from "../../../util/SchemaUtil";

import {
    BaseModel,
    BaseModelSchema,
    ParseBaseModelSchema,
    HashList,
} from "../../BaseModel";

import {
    MODELTYPE_INDEX,
    EXPIRETIME_INDEX,
} from "../../types";

import {
    BaseCertInterface,
    BaseCertProps,
    BaseCertFlags,
    CONSTRAINTS_INDEX,
} from "./types";

function assert<T>(value: T, error: string): asserts value is NonNullable<T> {
    if (!value) {
        throw new Error(`Assertion error: ${error}`);
    }
}

export const BaseCertType = [2] as const;

export const BaseCertSchema: Fields = {
    ...BaseModelSchema,
    modelType: {
        index: MODELTYPE_INDEX,
        type: FieldType.BYTE3,
        static: Buffer.from(BaseCertType),
        staticPrefix: true,
    },
    // Override here to make it required
    expireTime: {
        index: EXPIRETIME_INDEX,
        type: FieldType.UINT48BE,
        required: true,
    },
    // constraints is the hash which binds a cert to a model in such a way
    // that specific fields and flags must be set to specific values in the
    // model (could be no value) for the constraints hash of the cert to match
    // the model given the lockedConfig.
    // It is a space saving technique instead of having multiple fields
    // in the cert which should map to corresponding fields in the model we
    // just hash all fields together to bind model and cert.
    constraints: {
        index: CONSTRAINTS_INDEX,
        type: FieldType.BYTE32,
    },
} as const;

export const ParseBaseCertSchema: ParseSchemaType = {
    ...ParseBaseModelSchema,
    "constraints??": new Uint8Array(0),
} as const;

export class BaseCert extends BaseModel implements BaseCertInterface {
    protected readonly fields = BaseCertSchema;
    protected props?: BaseCertProps;

    /**
     * @param packed
     */
    constructor(packed?: Buffer) {
        super(packed);
    }

    public getProps(): BaseCertProps {
        return super.getProps();
    }

    public setProps(props: BaseCertProps) {
        super.setProps(props);
    }

    public mergeProps(props: BaseCertProps) {
        super.mergeProps(props);

        const props1 = this.getProps();

        for (const p in props) {
            // The keys of BaseCertProps
            if (["constraints"].includes(p)) {
                //@ts-expect-error
                if (props[p] !== undefined) {
                    //@ts-expect-error
                    props1[p] = props[p];
                }
            }
        }
    }

    public getAchillesHashes(): Buffer[] {
        assert(this.props, "Expected props to have been set");

        const hashes: Buffer[] = [];

        const id1 = this.props.id1;

        assert(id1, "Expected id1 to have been set");

        const owner = this.props.owner;

        assert(owner, "Expected owner to have been set");

        // This hash allows node to be destroyed on its id1.
        //
        hashes.push(HashList([Buffer.from("destroy"), owner, id1]));

        return hashes;
    }

    public validate(deepValidate: boolean = false,
        time?: number): [boolean, string]
    {
        assert(this.props, "Expected props to have been set");

        // Assert this prior to calling super.validate()
        //
        if (this.props.creationTime === undefined) {
            return [false, "creationTime must be set in cert"];
        }

        if (this.props.expireTime === undefined) {
            return [false, "expireTime must be set in cert"];
        }

        const validated = super.validate(deepValidate, time);

        if (!validated[0]) {
            return validated;
        }

        return [true, ""];
    }

    /**
     * Load config flags from config numbers and return.
     */
    public loadFlags(): BaseCertFlags {
        assert(this.props, "Expected props to have been set");

        const flags = super.loadFlags();

        return flags;
    }

    /**
     * Store back modified flags.
     */
    public storeFlags(baseNodeFlags: BaseCertFlags) {
        assert(this.props, "Expected props to have been set");

        super.storeFlags(baseNodeFlags);
    }
}
