let activeSourceOperations = 0;
let settingsUpdateInProgress = false;

export const tryStartSourceOperation = () => {
    if (settingsUpdateInProgress) return false;
    activeSourceOperations += 1;
    return true;
};

export const finishSourceOperation = () => {
    activeSourceOperations = Math.max(0, activeSourceOperations - 1);
};

export const tryStartSettingsUpdate = () => {
    if (settingsUpdateInProgress || activeSourceOperations > 0) return false;
    settingsUpdateInProgress = true;
    return true;
};

export const finishSettingsUpdate = () => {
    settingsUpdateInProgress = false;
};
