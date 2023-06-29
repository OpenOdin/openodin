import blake2b from "blake2b"

export class BrowserUtil {
    /**
     * Hash web File contents streaming using blake2b.
     *
     * @throws
     */
    public static HashFileBrowser(file: File): Promise<Buffer> {
        const readStream = file.stream().getReader();
        const hash = blake2b(32);

        return new Promise( (resolve, reject) => {
            readStream.read().then(function hashFn({done, value }): Promise<void> {
                if(done) {
                    resolve(Buffer.from(hash.digest()));
                    return Promise.resolve();
                }
                hash.update(value);
                return readStream.read().then(hashFn);
            }).catch((err) => reject(err));
        });
    }
}
