export const logger = {
    info: (logType, message, data) => {
        if (process.env[logType] === "true") {
            console.log(`\n[INFO] ${message}`, data || '');
        }
    },
    error: (message, data) => {
        console.error(`\n[ERROR] ${message}`, data || '');
    },
    warn: (message, data) => {
        console.warn(`\n[WARN] ${message}`, data || '');
    }
}
