import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { OpenAIEmbeddings } from "@langchain/openai";
import { v4 as uuidv4 } from "uuid";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import { getAllFiles } from "../data/getFilePaths.js";
import { hashContent } from "../utils/hashContent.js";
import { generateBatches } from "../data/generateBatches.js";
import { documentsCollection } from "../config/db.js";
import { loadDocument } from "../data/loadDataFiles.js";
import { startCursor, stopCursor } from "../utils/taskProgressCursor.js";

const embeddings = new OpenAIEmbeddings({
    apiKey: process.env.OPENAI_API_KEY,
});

const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 100
});


/**
 * Ingest documents from the specified directory and split them into chunks
 */
const DATA_DIR = process.env.DATA_DIR || "../documents/ingestables";
const filePaths = getAllFiles(DATA_DIR);
const allDocuments = [];

for (const filePath of filePaths) { // Read each document, split it into chunks
    
    const source = path.basename(filePath);
    const category = path.basename(path.dirname(filePath)); // Use the parent directory name as the category
    
    const loadedDocs = await loadDocument(filePath);
    const splittedDocs = await splitter.splitDocuments(loadedDocs);
    const documents = splittedDocs.map((doc, index) => ({
        content: doc.pageContent,
        metadata: {
            source,
            category
        }
    }));

    allDocuments.push(...documents);
};

/**
 * Generate embeddings for each document chunk and store them in the vector store with metadata
 */

export const ingestDocuments = async () => {
    const cursorInterval = startCursor("Ingesting documents...");
    try {
        await documentsCollection.deleteMany({ "metadata.sourceType": "vector" });
        /**
         * Generate embeddings for document chunks in batches
         * to optimize API calls and handle large datasets efficiently
         */
        const chunks = allDocuments.map((doc) => doc.content);
        const chunkBatches = generateBatches(chunks, 100);
        const embeddingsArray = (await Promise.all(chunkBatches
            .map((batch) => embeddings.embedDocuments(batch))
        )).flat();

        if (embeddingsArray.length !== allDocuments.length) {
            throw new Error("Embedding count does not match document chunk count !!")
        }

        /**
         * Store each document chunk in mongoDB with its embedding and metadata,
         * including a unique ID, chunk number, and content hash for deduplication
         */
        const chunkTracker = new Map();
        for (const [i, document] of allDocuments.entries()) {
            const source = document.metadata.source;
            const chunkCount = chunkTracker.get(source) || 0;
            chunkTracker.set(source, chunkCount + 1);
            const chunkHash = hashContent(document.content);
            const currentDateTime = Date.now();

            await documentsCollection.updateOne(
            { "metadata.hash": chunkHash }, // Filter by chunk hash
            {
                $set: {
                    content: document.content,
                    "metadata.sourceType": "vector",
                    "metadata.source": document.metadata.source,
                    "metadata.category": document.metadata.category,
                    "metadata.chunk": chunkTracker.get(source),
                    "metadata.hash": chunkHash,
                    "metadata.lastUpdatedAt": currentDateTime,
                    embedding: embeddingsArray[i]
                },
                $setOnInsert: {
                    id: uuidv4(),
                    "metadata.uploadedAt": currentDateTime
                }
            },
            { upsert: true });  // Update entry if hash found
        };
    } catch (error) {
        stopCursor(cursorInterval, "Ingestion failed !!");
        throw error;
    }

    stopCursor(cursorInterval, "Ingestion completed !!");
};