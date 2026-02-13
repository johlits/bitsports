import * as human from "./humanAI.js";
import * as gpt53CodexXHigh from "./gpt53CodexXHighAI.js";
import * as gemini3ProHigh from "./gemini3ProHighAI.js";
import * as kimiK25 from "./kimiK25AI.js";
import * as claudeOpus46Thinking from "./claudeOpus46ThinkingAI.js";

export const allAIs = [
    claudeOpus46Thinking,
    gpt53CodexXHigh,
    gemini3ProHigh,
    kimiK25,
    human,
];
