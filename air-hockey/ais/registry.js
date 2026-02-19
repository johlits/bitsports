import * as human from "./humanAI.js";
import * as gpt53CodexXHigh from "./gpt53CodexXHighAI.js";
import * as gemini31ProHigh from "./gemini31ProHighAI.js";
import * as kimiK25 from "./kimiK25AI.js";
import * as claudeOpus46Thinking from "./claudeOpus46ThinkingAI.js";

export const allAIs = [
    claudeOpus46Thinking,
    gpt53CodexXHigh,
    gemini31ProHigh,
    kimiK25,
    human,
];
