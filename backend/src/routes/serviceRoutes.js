import express from "express";
import { getFile } from "../controllers/serviceController.js"

const router = express.Router();

router.get("/files/:filename", getFile);

export default router;