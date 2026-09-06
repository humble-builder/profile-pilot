import { MongoClient } from "mongodb";

const client = new MongoClient(process.env.MONGO_URI);

export let documentsCollection;
export let sessionsCollection;
export let ingestionManifestCollection;
export let applicationSettingsCollection;

export const runInTransaction = async (operation) => {
    const session = client.startSession();

    try {
        return await session.withTransaction(() => operation(session));
    } finally {
        await session.endSession();
    }
};

export const connectDB = async () => {
    try {
        await client.connect();
        console.log("MongoDB connected");

        const db = client.db("profile_pilot");
        documentsCollection = db.collection("documents");
        sessionsCollection = db.collection("sessions");
        ingestionManifestCollection = db.collection("ingestion_manifest");
        applicationSettingsCollection = db.collection("application_settings");

    } catch (err) {
        console.error("MongoDB connection failed", err);
        throw err;
    }

};
