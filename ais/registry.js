import * as gemini from "./geminiAI.js";
import * as geminiHigh from "./geminiHighAI.js";
import * as gpt51Low from "./gpt51LowAI.js";
import * as gpt51High from "./gpt51HighAI.js";
import * as claudeSonnet45 from "./claudeSonnet45AI.js";
import * as claudeOpus45 from "./claudeOpus45AI.js";
import * as human from "./humanAI.js";

export const allAIs = [ 
    human,
    claudeOpus45,
    geminiHigh,
    gpt51High,
];
