import OpenAI from "openai";
import { Agent } from "./agent/agent";
import { createBot } from "./bot/bot";
import { config } from "./config/config";
import { SupabaseStore } from "./storage/supabaseStore";
import { VoiceTranscriber } from "./utils/voiceTranscriber";
import { logger } from "./utils/logger";

const main = async () => {
  console.log("=== NooClickUp Bot Starting ===");
  logger.info("bot_starting");

  console.log("Creating OpenAI client...");
  const openai = new OpenAI({ apiKey: config.openai.apiKey });
  logger.info("openai_created");

  console.log("Creating Supabase store...");
  const store = new SupabaseStore();
  logger.info("store_created");

  console.log("Creating agent (using REST API, no MCP)...");
  const agent = new Agent(openai, store, {
    model: config.openai.model,
    temperature: config.openai.temperature,
  });
  logger.info("agent_created");

  console.log("Creating transcriber...");
  const transcriber = new VoiceTranscriber(openai);
  logger.info("transcriber_created");

  console.log("Creating bot...");
  const bot = createBot(agent, transcriber, config.telegram);
  logger.info("bot_created");

  console.log("Launching bot...");
  await bot.launch();
  console.log("Bot launched successfully!");
  logger.info("bot_started");

  const shutdown = async () => {
    logger.info("bot_shutdown");
    bot.stop();
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
};

main().catch((error) => {
  logger.error("bot_start_failed", {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  console.error("Failed to start bot:", error);
  process.exit(1);
});
