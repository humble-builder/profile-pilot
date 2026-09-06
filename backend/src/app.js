import "./config/env.js";
import cors from "cors";
import express from "express";
import chatRoutes from "./routes/chatRoutes.js";
import serviceRoutes from "./routes/serviceRoutes.js";
import { ingestDocuments } from "./retrieval/ingestDocuments.js";
import { connectDB } from "./config/db.js";
import { initializeRuntimeSettings } from "./config/runtimeSettings.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
});

app.use("/chat", chatRoutes);
app.use("/service", serviceRoutes);

app.use((error, _req, res, next) => {
    if (error?.type === "entity.too.large") {
        return res.status(413).json({ error: "Uploaded file exceeds the 10 MB limit" });
    }

    next(error);
});

const startServer = async () => {
    await connectDB();
    await initializeRuntimeSettings();
    await ingestDocuments();
    app.listen(process.env.PORT, () => {
        console.log(`Server running on port ${process.env.PORT}`);
    });
  };
  
startServer();
