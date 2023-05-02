import {
    Filter,
} from "../../datamodel";

export function PackFilters(filters: Filter[]): any[] {
    return filters.map( filter => {
        const wrapper: any = {  // We need a wrapper to handle undefined values
            value: undefined,
        };
        let value: any;
        if (Buffer.isBuffer(filter.value)) {
            value = [];
            filter.value.forEach( (v: number) => value.push(v) );
        }
        else {
            value = filter.value;
        }
        wrapper.value = value;

        return {
            field: filter.field,
            operator: filter.operator,
            cmp: filter.cmp,
            value: Buffer.from(JSON.stringify(wrapper)),
        };
    });
}

export function UnpackFilters(filters: any[]): any[] {
    return filters.map( (filter: any) => {
        const wrapper = JSON.parse(filter.value);
        let value = wrapper.value;
        if (Array.isArray(value)) {
            value = Buffer.from(value);
        }
        return {
            field: filter.field,
            operator: filter.operator,
            cmp: filter.cmp,
            value,
        };
    });
}

export function CopyToBuffer(inArray: Uint8Array): Buffer {
    const out = Buffer.alloc(inArray.byteLength);
    for (let i=0; i<inArray.byteLength; i++) {
        out[i] = inArray[i];
    }
    return out;
}

export function MakeIntoBuffer(data: Uint8Array | undefined): Buffer {
    if (data && Buffer.isBuffer(data)) {
        return CopyToBuffer(data);
    }
    return Buffer.alloc(0);
}
