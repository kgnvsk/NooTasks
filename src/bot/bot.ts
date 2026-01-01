import { Context, Telegraf } from "telegraf";
import { Agent } from "../agent/agent";
import { VoiceTranscriber } from "../utils/voiceTranscriber";
import { logger } from "../utils/logger";

type BotConfig = {
  token: string;
  adminIds: number[];
};

// Split long messages into chunks for Telegram (max 4096 chars)
const splitMessage = (text: string, maxLength: number = 4000): string[] => {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  const lines = text.split('\n');
  let currentChunk = '';

  for (const line of lines) {
    if ((currentChunk + '\n' + line).length > maxLength) {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = line;
    } else {
      currentChunk += (currentChunk ? '\n' : '') + line;
    }
  }

  if (currentChunk) chunks.push(currentChunk.trim());
  return chunks;
};

export const createBot = (
  agent: Agent,
  transcriber: VoiceTranscriber,
  config: BotConfig
): Telegraf => {
  const bot = new Telegraf(config.token);

  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId || !config.adminIds.includes(userId)) {
      logger.warn("telegram_access_denied", { userId });
      await ctx.reply("Доступ заборонено.");
      return;
    }
    await next();
  });

  bot.start(async (ctx) => {
    logger.info("telegram_start", { userId: ctx.from?.id });
    await ctx.reply("Бот аналітики ClickUp готовий. Задайте питання або введіть /help.");
  });

  bot.command("help", async (ctx) => {
    logger.info("telegram_help", { userId: ctx.from?.id });
    await ctx.reply(
      [
        "📋 <b>NooLogic ClickUp Bot</b>",
        "",
        "Приклади запитів:",
        "- <b>Покажи прострочені задачі проекту Botox</b>",
        "- <b>Які задачі у Іллі?</b>",
        "- <b>Завислі задачі по всіх клієнтах</b>",
        "- <b>Що на сьогодні у voice_agents?</b>",
        "",
        "Можна надіслати голосове повідомлення.",
      ].join("\n"),
      { parse_mode: "HTML" }
    );
  });

  bot.on("text", async (ctx) => {
    try {
      const userId = ctx.from?.id ?? 0;
      const text = ctx.message.text;
      logger.info("telegram_text", { userId, text });
      const response = await agent.handleMessage(userId, text);
      
      // Split into multiple messages if needed
      const chunks = splitMessage(response);
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const prefix = chunks.length > 1 && i > 0 ? `<i>(частина ${i + 1}/${chunks.length})</i>\n\n` : '';
        await ctx.reply(prefix + chunk, { parse_mode: "HTML" });
      }
    } catch (error) {
      logger.error("telegram_text_failed", {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      await ctx.reply("Не вдалося обробити запит. Будь ласка, спробуйте ще раз.");
    }
  });

  const handleAudio = async (ctx: Context, fileId: string, kind: "voice" | "audio") => {
    try {
      logger.info("telegram_audio_received", { userId: ctx.from?.id, fileId, kind });
      const link = await ctx.telegram.getFileLink(fileId);
      const url = typeof link === "string" ? link : link.href;
      const transcript = await transcriber.transcribeFromUrl(url);
      logger.info("telegram_audio_transcript", {
        userId: ctx.from?.id,
        kind,
        transcript,
      });
      const userId = ctx.from?.id ?? 0;
      const response = await agent.handleMessage(userId, transcript);
      
      // Split into multiple messages if needed
      const chunks = splitMessage(response);
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const prefix = chunks.length > 1 && i > 0 ? `<i>(частина ${i + 1}/${chunks.length})</i>\n\n` : '';
        await ctx.reply(prefix + chunk, { parse_mode: "HTML" });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      logger.error("telegram_audio_failed", {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      if (message.includes("FFMPEG_NOT_FOUND")) {
        await ctx.reply("Для транскрипції голосу необхідно встановити ffmpeg на сервері.");
        return;
      }
      await ctx.reply("Не вдалося обробити голосове повідомлення. Будь ласка, спробуйте ще раз.");
    }
  };

  bot.on("voice", async (ctx) => {
    const fileId = ctx.message.voice?.file_id;
    if (!fileId) {
      await ctx.reply("Голосове повідомлення не знайдено.");
      return;
    }
    await handleAudio(ctx, fileId, "voice");
  });

  bot.on("audio", async (ctx) => {
    const fileId = ctx.message.audio?.file_id;
    if (!fileId) {
      await ctx.reply("Аудіоповідомлення не знайдено.");
      return;
    }
    await handleAudio(ctx, fileId, "audio");
  });

  return bot;
};
