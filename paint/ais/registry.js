import * as human from "./humanAI.js";
import * as gpt53CodexHigh from "./gpt53CodexHighAI.js";
import * as gemini3ProHigh from "./gemini3ProHighAI.js";
import * as kimiK25 from "./kimiK25AI.js";
import * as claudeOpus46Thinking from "./claudeOpus46ThinkingAI.js";

export const allAIs = [
  claudeOpus46Thinking,
  gpt53CodexHigh,
  gemini3ProHigh,
  kimiK25,
  human,
];
