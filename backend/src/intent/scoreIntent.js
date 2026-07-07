import { intentKeywords } from "../../constants/intentDictionary.js";

const matchIntent = (input, keyword) => {
    const normalize = (text) =>
    text
        .toLowerCase()
        .replace(/[^\w\s-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const userInput = normalize(input);
    const words = userInput.split(" ");


    return (() => {
        const normalizedKeyword = normalize(keyword);

        if (!normalizedKeyword.includes(" ")) {
            return words.includes(normalizedKeyword);
        }

        return userInput.includes(normalizedKeyword);
    })();
};

export const scoreIntent = (userInput) => {
    const input = userInput.toLowerCase();
    const scores = {};

    for (const intent in intentKeywords) {
        scores[intent] = 0;
        for (const keyword in intentKeywords[intent]) {
            if (matchIntent(input, keyword)) {
                scores[intent] += intentKeywords[intent][keyword];
            }
        }
    }

    return scores;
};

