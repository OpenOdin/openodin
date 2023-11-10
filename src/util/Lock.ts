export type Mutex = {
    name: string,
    p: Promise<void> | undefined,
};

type InnerMutex = {
    lock: Mutex,
    resolve: (() => void) | undefined,
};

export class Lock {
    protected mutexes: {[name: string]: InnerMutex[]} = {};

    protected locks: {[name: string]: InnerMutex[]} = {};

    public acquire(name: string): Mutex {
        const lock: Mutex = {
            name,
            p: undefined,
        };

        const innerMutex: InnerMutex = {
            lock,
            resolve: undefined
        };

        const locks = this.locks[name] ?? [];
        this.locks[name] = locks;

        locks.push(innerMutex);

        if (locks.length > 1) {
            lock.p = new Promise( resolve => {
                innerMutex.resolve = resolve;
            });
        }

        return lock;
    }

    public release(lock: Mutex) {
        const locks = this.locks[lock.name] ?? [];

        if (locks.length > 0) {
            if (locks[0].lock === lock) {
                locks.shift();
                if (locks.length > 0) {
                    if (locks[0].resolve) {
                        locks[0].resolve();
                    }
                }
            }
        }
    }
}
