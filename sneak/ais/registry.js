import * as randomInfiltrator from "./randomInfiltratorAI.js";
import * as greedyInfiltrator from "./greedyInfiltratorAI.js";
import * as patrolGuard from "./patrolGuardAI.js";
import * as seekerGuard from "./seekerGuardAI.js";
import * as claudeOpusGuard from "./claudeOpusGuardAI.js";
import * as claudeOpusInfiltrator from "./claudeOpusInfiltratorAI.js";
import * as human from "./humanAI.js";

export const allAIs = [
  claudeOpusGuard,
  claudeOpusInfiltrator,
  greedyInfiltrator,
  seekerGuard,
  patrolGuard,
  randomInfiltrator,
  human,
];
