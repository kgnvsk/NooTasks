import OpenAI from "openai";
import { Agent } from "./src/agent/agent";
import { createBot } from "./src/bot/bot";
import { config } from "./src/config/config";
import { ClickUpMcpClient } from "./src/mcp/clickupClient";
import { SupabaseStore } from "./src/storage/supabaseStore";
import { VoiceTranscriber } from "./src/utils/voiceTranscriber";
import { logger } from "./src/utils/logger";

const main = async () => {
  console.log("Step 1: Creating OpenAI client...");
  const openai = new OpenAI({ apiKey: config.openai.apiKey });
  console.log("Step 1: OpenAI client created");

  console.log("Step 2: Creating ClickUp MCP client...");
  const clickup = new ClickUpMcpClient();
  console.log("Step 2: ClickUp MCP client created");

  console.log("Step 3: Creating Supabase store...");
  const store = new SupabaseStore();
  console.log("Step 3: Supabase store created");

  console.log("Step 4: Creating agent...");
  const agent = new Agent(openai, clickup, store, {
    model: config.openai.model,
    temperature: config.openai.temperature,
  });
  console.log("Step 4: Agent created");

  console.log("Step 5: Creating transcriber...");
  const transcriber = new VoiceTranscriber(openai);
  console.log("Step 5: Transcriber created");

  console.log("Step 6: Creating bot...");
  const bot = createBot(agent, transcriber, clickup, config.telegram);
  console.log("Step 6: Bot created");

  console.log("Step 7: Launching bot...");
  await bot.launch();
  console.log("Step 7: Bot launched!");

  console.log("All initialization successful!");
};

main().catch((error) => {
  console.error("Error during initialization:", error);
  process.exit(1);
});
