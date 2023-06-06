import blake2b from "blake2b"

import fs from "fs";

export class FileUtil {
    /**
     * Hash file contents streaming using blake2b.
     *
     * @throws
     */
    public static HashFile(file: string): Promise<Buffer> {
        const readStream = fs.createReadStream(file);

        const hash = blake2b(32);

        return new Promise( (resolve, reject) => {
            readStream.on("data", (data) => hash.update(data as Buffer) );

            readStream.on("error", reject);

            readStream.on("end", () => resolve(Buffer.from(hash.digest())) );
        });
    }
}
