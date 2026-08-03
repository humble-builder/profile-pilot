import { getAllFiles } from "../data/getFilePaths.js";
import path from "path";

export const getFile = async (req,res) => {
    const { filename } =  req.params;

    if (!filename || filename.trim() === "") {
        return res.status(400).json({ error: "File name is required"});
    }

    try {
        const UPLOAD_DIR = process.env.UPLOAD_DIR || "../documents/downloadables";
        const downloadableFilePaths = getAllFiles(UPLOAD_DIR);
        const requestedFilePath = downloadableFilePaths
            .find((filePath) => path.basename(filePath) === filename);

        if (!requestedFilePath) {
            return res.status(404).json({ error: "File not found"});
        }

        return res.download(requestedFilePath,path.basename(requestedFilePath));

    } catch (err) {
        console.error("Error while fetching file:", err);
        res.status(err.status ?? 500).json({
            error: err.message,
            reply: "Something went wrong. Please try again later."
        });
    }
}