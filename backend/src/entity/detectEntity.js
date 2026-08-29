import { entityDefinitions } from "../../constants/entityDictionary.js";

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const findLongestAliasMatch = (query, aliases) => {
    const sortedAliases = aliases.toSorted((a, b) => b.length - a.length);

    for (const alias of sortedAliases) {
        const aliasPattern = new RegExp(`\\b${escapeRegExp(alias)}\\b`, "i");
        const match = query.match(aliasPattern);

        if (match) return match[0];
    }

    return null;
};

export const detectEntity = (query) => {
    const detectedEntities = [];

    for (const definition of entityDefinitions) {
        const matchedText = findLongestAliasMatch(query, definition.aliases);

        if (!matchedText) continue;

        detectedEntities.push({
            entityType: definition.entityType,
            entityRole: definition.entityRole,
            normalizedValue: definition.normalizedValue,
            matchedText,
            confidence: 1,
        });
    }

    return {
        predictedEntity: detectedEntities[0] ?? null,
        detectedEntities,
    };
};
