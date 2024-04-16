import {
    RPC,
} from "../util/RPC";

export class SettingsManagerRPCClient {
    constructor(protected rpc: RPC) {}

    /**
     * Store application specific settings.
     * These settings are persisted with the DataWallet
     * and can be retrieved only by the same application (same url).
     *
     * User of the DataWallet can access to settings and copy them to other applications.
     *
     * It is cheaper setting values in a batch due to encryption being used.
     *
     * @param namespace namespace within app (bound to url), no whitespace allowed in name
     * @param values object of key-value to be stored in namespace
     * @throws on failure to set data
     */
    public async set(namespace: string, values: Record<string, any>[]) {
        return this.rpc.call("storeSetting", [namespace, values]);
    }

    /**
     * Get a number of values from a specific namespace for this application (bound by url).
     * It is cheaper getting values in a batch due to encryption being used.
     *
     * @param namespace to look in within app (bound to url), no whitespace allowed in name.
     * @param keys array of keys for which to get values
     * @returns values array in same order as given in keys
     * @throws on error
     */
    public async get(namespace: string, keys: string[]): Promise<any[]> {
        return this.rpc.call("fetchSetting", [namespace, keys]);
    }

    public async close(): Promise<void> {
        return this.rpc.call("close");
    }
}
