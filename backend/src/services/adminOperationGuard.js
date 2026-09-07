/**
 * In-process coordination for admin mutations.
 * Multiple source operations may run together, but a settings migration is exclusive because
 * it replaces embeddings and runtime configuration as one logical operation.
 */
let activeSourceOperations = 0;
let settingsUpdateInProgress = false;

/** Acquire a shared source-operation slot unless a settings update owns the guard. */
export const tryStartSourceOperation = () => {
    if (settingsUpdateInProgress) return false;
    activeSourceOperations += 1;
    return true;
};

/** Release one previously acquired source-operation slot. */
export const finishSourceOperation = () => {
    activeSourceOperations = Math.max(0, activeSourceOperations - 1);
};

/** Acquire the exclusive settings-update slot when no admin mutation is active. */
export const tryStartSettingsUpdate = () => {
    if (settingsUpdateInProgress || activeSourceOperations > 0) return false;
    settingsUpdateInProgress = true;
    return true;
};

/** Release the exclusive settings-update slot. */
export const finishSettingsUpdate = () => {
    settingsUpdateInProgress = false;
};
