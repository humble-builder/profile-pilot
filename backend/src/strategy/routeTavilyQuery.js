import {
  researchBoundKeywords,
  freshnessKeywords,
  quickLookupKeywords,
} from "../../constants/tavilyQueryKeywords.js";

import { queryConfigs } from "../../constants/tavilyQueryConfig.js";

/**
 * Determines the appropriate Tavily search configuration based on the user's query.
 * @param {*} query Incoming user query
 * @returns config values for the Tavily search
 */
export const routeTavilyConfig = (query) => {
  const q = query.toLowerCase();
  const isShortQuery = q.length < 40;
  const isNewsBasedQuery = matchIfAny(q, freshnessKeywords);
  const isResearchBasedQuery = matchIfAny(q, researchBoundKeywords);
  const isLookupBasedQuery = isShortQuery && matchIfAny(q, quickLookupKeywords) && !isResearchBasedQuery;

  if (isNewsBasedQuery) return {...queryConfigs["news"]};
  if (isResearchBasedQuery) return {...queryConfigs["research"]};
  if (isLookupBasedQuery) return {...queryConfigs["definition"]};
  return {...queryConfigs["facts"]};

};

const matchIfAny = (query, keywords) => keywords.some((keyword) => query.includes(keyword));
