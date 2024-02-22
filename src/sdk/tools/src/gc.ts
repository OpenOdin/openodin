/**
 * By default delete all expired nodes and their blobs.
 * Also delete all non finalized blob fragment data which is older than 7 days.
 * Deletes are batched 1000 at a time, with a 10 ms sleep then repeating until nothing left to delete.
 *
 * The database.conf file can look like this:
 *
 * {
 *     "driver": {
 *         "sqlite": "./data/nodes.sqlite"
 *     },
 *     "blobDriver": {
 *         "sqlite": "./data/blobs.sqlite"
 *     }
 * }
 */
import {
    Service,
    DatabaseConfig,
} from "../../../service";

import {
    JSONUtil,
} from "../../../util/JSONUtil";

import {
    ParseUtil,
} from "../../../util/ParseUtil";

import {
    sleep,
} from "../../../util/common";

import {
    PocketConsole,
} from "pocket-console";

const console = PocketConsole({module: "GC", format: "%c[%L%l]%C "});

async function main(databaseConfig: DatabaseConfig) {
    console.info("Connecting to database...");

    const [driver, blobDriver] = await Service.ConnectToDatabase(databaseConfig);

    if (!driver) {
        console.error("Could not connect to database");
        process.exit(1);
    }

    console.info("Connected to database");

    try {
        const now = Date.now();

        if (blobDriver) {
            while (true) {
                await sleep(10);

                const count = await blobDriver.deleteNonfinalizedBlobData(now - 7 * 24 * 3600 * 1000, 1000);

                console.info(`Deleted ${count} non finalized blob fragments`);

                if (count === 0) {
                    break;
                }
            }
        }

        while (true) {
            await sleep(10);

            const nodeId1s = await driver.getExpiredNodeId1s(now, 1000);

            if (nodeId1s.length > 0) {
                if (blobDriver) {
                    const count = await blobDriver.deleteBlobs(nodeId1s);

                    console.info(`Deleted ${count} blobs`);
                }

                await driver.deleteNodes(nodeId1s);
            }

            console.info(`Deleted ${nodeId1s.length} nodes`);

            if (nodeId1s.length === 0) {
                break;
            }
        }

        console.aced("Done");
    }
    catch(e) {
        console.error(e);
    }
    finally {
        driver.close();
        blobDriver?.close();
    }
}

if (process.argv.length < 3) {
    console.getConsole().error(`Usage: GC.ts database.json`);
    process.exit(1);
}

const databaseConfigPath = process.argv[2];

if (typeof(databaseConfigPath) !== "string") {
    console.getConsole().error(`Usage: GC.ts database.json`);
    process.exit(1);
}

let databaseConf: DatabaseConfig;

try {
    databaseConf = ParseUtil.ParseConfigDatabase(
        JSONUtil.LoadJSON(databaseConfigPath, ['.']));
}
catch(e) {
    console.error("Could not parse config file", (e as any as Error).message);
    process.exit(1);
}

main(databaseConf);
