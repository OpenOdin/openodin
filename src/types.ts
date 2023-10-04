export * from "./requestTypes";

import {
    MESSAGE_MAX_BYTES,
    EventType,
} from "pocket-messaging";

export {EventType};

/**
 * Define size of when messages are split into multiple messages.
 * MESSAGE_MAX_BYTES bytes is the max message size allowed in pocket-messaging,
 * the subtraction is to take our own serialization overhead into account.
 */
export const MESSAGE_SPLIT_BYTES = MESSAGE_MAX_BYTES - 3*1024;  // 67 KiB.

/**
 * How many parents up do we look for parent licenses.
 * A value of 0 would mean only accept sibling licenses.
 */
export const MAX_LICENSE_DISTANCE = 4;
