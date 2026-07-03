import { MongoClient } from "mongodb";

const client = new MongoClient(process.env.MONGO_URI);

export let documentsCollection;
export let sessionsCollection;

export const connectDB = async () => {
    try {
        await client.connect();
        console.log("MongoDB connected");

        const db = client.db("profile_pilot");
        documentsCollection = db.collection("documents");
        sessionsCollection = db.collection("sessions");

    } catch (err) {
        console.error("MongoDB connection failed", err);
    }

};
