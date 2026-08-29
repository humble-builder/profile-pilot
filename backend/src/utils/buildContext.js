export const buildContext = ({ mode, results = [] }) => {
    if (mode === "vector") {
        return results
            .map((doc, i) => `Document ${i+1}:\n${doc.content}`)
            .join("\n\n");
    }

    if (mode === "web") {
        return results
            .map((result, i) => `Web ${i+1}:\n${result.content}`)
            .join("\n\n");
    }

    if (mode === "hybrid") {
        return results
            .map((item, i) => {
                const sourceType = item.retrievalType === "vector"
                    ? "Document"
                    : "Web";

                return `${sourceType} ${i+1}:\n${item.content}`;
            })
            .join("\n\n");
    }

    return "";
};
