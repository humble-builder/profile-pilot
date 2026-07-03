import mammoth from 'mammoth';
import { PDFParse } from "pdf-parse";
import path from 'path';
import fs from 'fs';

export const loadDocument = async (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    
    if (ext === '.pdf') {
        const dataBuffer = fs.readFileSync(filePath);
        const pdfParser = new PDFParse({data: dataBuffer});
        const pdfData = await pdfParser.getText();
        await pdfParser.destroy();
        
        return [{
            pageContent: pdfData.text, 
            metadata: {
                source: filePath,
                type: 'pdf'
            }
        }];
    }

    if (ext === '.docx') {
        const result = await mammoth.extractRawText({ path: filePath });
        return [{
            pageContent: result.value, 
            metadata: {
                source: filePath,
                type: 'docx'
            }
        }];
    }

    if (ext === '.txt') {
        const text = fs.readFileSync(filePath, 'utf-8');
        return [{
            pageContent: text, 
            metadata: {
                source: filePath,
                type: 'txt'
            }
        }];
    }

    throw new Error(`Unsupported file type: ${ext}`);
};  