/**
 * This class is used to manage timestamps, so that readers can
 * have a confident timestamp from where no further data can enter the system prior to.
 * This timestamp is reused by the reader to cutoff data which the reader already has.
 */
export class TimeFreeze {
    protected frozenTime: number[];

    constructor() {
        this.frozenTime = [];
    }

    /**
     * A writer takes a timestamp which is used to timestamp new incoming data with.
     * @returns timestamp in milliseconds to use as storing time for data.
     */
    public freeze(): number {
        const timestamp = Date.now();
        this.frozenTime.push(timestamp);
        return timestamp;
    }

    /**
     * When a writer is done with the timestamp it must be released.
     * @param timestamp a timestamp which was frozen earlier.
     */
    public unfreeze(timestamp: number) {
        this.frozenTime.splice(this.frozenTime.indexOf(timestamp), 1);
    }

    /**
     * Get a timestamp from which it is safe to read from without risking missing anything.
     * No data can come in *prior* to this timestamp,* however new data can come in on exactly this timestamp.
     *
     * If there is one or many writes ongoing, return the oldest time, this guarantees that the reader does not miss any data.
     * If there are no freezes right now just return the now().
     * @returns timestamp in milliseconds from where it is safe to read without risking missing any data.
     */
    public read(): number {
        if (this.frozenTime.length > 0) {
            return this.frozenTime[0];
        }
        return Date.now();
    }

    /**
     * Suger function to return now(). Has nothing to do with freezing timestamps.
     * @returns now in milliseconds.
     */
    public now(): number {
        return Date.now();
    }
}
