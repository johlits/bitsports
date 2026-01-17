import * as human from "./humanAI.js";
import * as claudeOpus45 from "./claudeOpus45AI.js";
import * as gpt52HighReasoning from "./gpt52HighReasoningAI.js";
import * as gpt52CodexXHigh from "./gpt52CodexXHighAI.js";
import * as gemini3ProHigh from "./gemini3ProHighAI.js";

export const allAIs = [
    claudeOpus45,
    gpt52CodexXHigh,
    gemini3ProHigh,
    gpt52HighReasoning,
    human,
];
