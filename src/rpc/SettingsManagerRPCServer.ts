import {
    RPC,
} from "../util/RPC";

declare const browser: any;
declare const chrome: any;

export class SettingsManagerRPCServer {
    protected browserHandle: typeof browser | typeof chrome;

    constructor(protected rpc: RPC, protected url: string) {
        if (url.indexOf(" ") > -1) {
            throw new Error("URL contains space, not valid");
        }

        this.browserHandle = typeof(browser) !== "undefined" ? browser : chrome;

        this.rpc.onCall("storeSetting", this.storeSetting);

        this.rpc.onCall("fetchSetting", this.fetchSetting);

        this.rpc.onCall("close", this.close);
    }

    /**
     * Get a number of values from a specific namespace.
     *
     * @param namespace namespace within app (bound to url), no whitespace allowed in name
     * @param keys array of keys for which to get values
     * @returns values array in same order as given in keys
     */
    protected fetchSetting = async (namespace: string, keys: string[]):
        Promise<any[]> =>
    {
        if (namespace.indexOf(" ") > -1) {
            throw new Error("namespace contains space, not valid");
        }

        const fullNamespace = this.url + " " + namespace;

        const namespaceObj = await this.getNamespace(fullNamespace);

        return keys.map( key => namespaceObj[key] );
    }

    /**
     * Set a number of values to a specific namespace.
     *
     * @param namespace namespace within app (bound to url), no whitespace allowed in name
     * @param values object of key-value to be stored in namespace
     */
    protected storeSetting = async (namespace: string, values: Record<string, any>) => {
        if (namespace.indexOf(" ") > -1) {
            throw new Error("namespace contains space, not valid");
        }

        const fullNamespace = this.url + " " + namespace;

        const namespaceObj = await this.getNamespace(fullNamespace);

        Object.keys(values).forEach( key => {
            namespaceObj[key] = values[key];
        });

        return this.setNamespace(fullNamespace, namespaceObj);
    };

    protected async getNamespace(fullNamespace: string): Promise<Record<string, any>> {
        const json =
            (await this.browserHandle.storage.local.get([fullNamespace]))[fullNamespace];

        const namespaceObj = JSON.parse(json ?? "{}");

        return namespaceObj;
    }

    protected async setNamespace(fullNamespace: string, namespaceObj: Record<string, any>) {
        const json = JSON.stringify(namespaceObj);

        await this.browserHandle.storage.local.set({[fullNamespace]: json});
    }

    public close = async () => {
        return this.rpc.close();
    }
}
