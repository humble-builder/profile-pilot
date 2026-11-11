import express from "express";
import { getFile } from "../controllers/serviceController.js"
import {
    activateSource,
    listSources,
    uploadSource,
} from "../controllers/sourceAdminController.js";
import { requireAdminToken } from "../middleware/requireAdminToken.js";
import {
    readRuntimeSettings,
    updateRuntimeSettings,
} from "../controllers/runtimeSettingsController.js";
import { readObservabilityDashboard } from "../controllers/observabilityController.js";

const router = express.Router();

router.get("/files/:filename", getFile);
router.get("/admin/sources", requireAdminToken, listSources);
router.get("/admin/settings", requireAdminToken, readRuntimeSettings);
router.get("/admin/observability", requireAdminToken, readObservabilityDashboard);
router.put(
    "/admin/settings",
    requireAdminToken,
    express.json(),
    updateRuntimeSettings
);
router.post(
    "/admin/sources/upload",
    requireAdminToken,
    express.raw({ type: () => true, limit: "10mb" }),
    uploadSource
);
router.post(
    "/admin/sources/activate",
    requireAdminToken,
    express.json(),
    activateSource
);

export default router;
