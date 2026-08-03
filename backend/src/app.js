import "./config/env.js";
import cors from "cors";
import express from "express";
import chatRoutes from "./routes/chatRoutes.js";
import serviceRoutes from "./routes/serviceRoutes.js";
import { ingestDocuments } from "./retrieval/ingestDocuments.js";
import { connectDB } from "./config/db.js";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/chat", chatRoutes);
app.use("/service", serviceRoutes);

const startServer = async () => {
    await connectDB();
    await ingestDocuments();
    app.listen(process.env.PORT, () => {
        console.log(`Server running on port ${process.env.PORT}`);
    });
  };
  
startServer();