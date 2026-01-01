import dotenv from "dotenv";
dotenv.config();

console.log("1. dotenv loaded");

import { config } from "./src/config/config";
console.log("2. config loaded");

import { logger } from "./src/utils/logger";
console.log("3. logger loaded");

import { ClickUpMcpClient } from "./src/mcp/clickupClient";
console.log("4. ClickUpMcpClient loaded");

import { SupabaseStore } from "./src/storage/supabaseStore";
console.log("5. SupabaseStore loaded");

import { Agent } from "./src/agent/agent";
console.log("6. Agent loaded");

import { VoiceTranscriber } from "./src/utils/voiceTranscriber";
console.log("7. VoiceTranscriber loaded");

import { createBot } from "./src/bot/bot";
console.log("8. createBot loaded");

console.log("All imports successful!");
