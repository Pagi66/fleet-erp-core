"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const path_1 = require("path");
function readNumber(value, fallback) {
    if (!value) {
        return fallback;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return fallback;
    }
    return parsed;
}
function readString(value, fallback) {
    if (!value) {
        return fallback;
    }
    const trimmed = value.trim();
    return trimmed === "" ? fallback : trimmed;
}
exports.config = {
    port: readNumber(process.env.PORT, 3000),
    persistenceFilePath: (0, path_1.resolve)(process.cwd(), readString(process.env.PERSISTENCE_FILE_PATH, "data/store-state.json")),
    eventDebounceWindowMs: readNumber(process.env.EVENT_DEBOUNCE_WINDOW_MS, 50),
    logLevel: readString(process.env.LOG_LEVEL, "info"),
};
//# sourceMappingURL=config.js.map