export const entityDefinitions = [
    {
        entityType: "person",
        entityRole: "primary",
        normalizedValue: "profile_owner",
        aliases: [
            "vishal",
            "vishal singh",
        ],
    },
    {
        entityType: "pronoun",
        entityRole: "contextual",
        normalizedValue: "contextual_person",
        aliases: [
            "he",
            "him",
            "his",
            "himself",
            "she",
            "her",
            "hers",
            "herself",
            "they",
            "them",
            "their",
            "theirs",
            "themselves",
        ],
    },
    {
        entityType: "person",
        entityRole: "reference",
        normalizedValue: "unknown_person",
        aliases: [
            "another person",
            "unknown person",
            "someone",
            "somebody",
        ],
    },
];
