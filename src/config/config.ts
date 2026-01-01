import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const OptionalNumberSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}, z.number().optional());

const EnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default("gpt-4.1"),
  OPENAI_TEMPERATURE: OptionalNumberSchema,
  OPENAI_WHISPER_MODEL: z.string().default("whisper-1"),
  OPENAI_WHISPER_PROMPT: z.string().default("Ukrainian language"),
  AGENT_PROMPT_PATH: z.string().default("prompts/agent_system_prompt.txt"),
  CLICKUP_API_KEY: z.string().min(1),
  CLICKUP_TEAM_ID: z.string().min(1),
  CLICKUP_MCP_LICENSE_KEY: z.string().optional(),
  TIMEZONE: z.string().default("Europe/Lisbon"),
  ADMIN_TELEGRAM_IDS: z.string().min(1),
  SUPABASE_URL: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  MCP_CLICKUP_COMMAND: z.string().default("npx"),
  MCP_CLICKUP_ARGS: z.string().default("-y @taazkareem/clickup-mcp-server@latest"),
  MCP_CLICKUP_PATH: z.string().optional(),
});

const rawEnv = {
  ...process.env,
  CLICKUP_API_KEY: process.env.CLICKUP_API_KEY ?? process.env.CLICKUP_API_TOKEN,
};

const env = EnvSchema.parse(rawEnv);

const adminIds = env.ADMIN_TELEGRAM_IDS.split(",")
  .map((value) => value.trim())
  .filter((value) => value.length > 0)
  .map((value) => Number(value))
  .filter((value) => Number.isFinite(value));

if (adminIds.length === 0) {
  throw new Error("ADMIN_TELEGRAM_IDS must contain at least one valid ID.");
}

const parseArgs = (raw: string): string[] => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error("MCP_CLICKUP_ARGS must be a JSON array or a space-delimited string.");
    }
    return parsed.map((item) => String(item));
  }
  return trimmed.split(/\s+/).filter((value) => value.length > 0);
};

export const config = {
  telegram: {
    token: env.TELEGRAM_BOT_TOKEN,
    adminIds,
  },
  openai: {
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
    temperature: env.OPENAI_TEMPERATURE,
    whisperModel: env.OPENAI_WHISPER_MODEL,
    whisperPrompt: env.OPENAI_WHISPER_PROMPT,
  },
  agent: {
    promptPath: env.AGENT_PROMPT_PATH,
  },
  clickup: {
    apiKey: env.CLICKUP_API_KEY,
    teamId: env.CLICKUP_TEAM_ID,
    licenseKey: env.CLICKUP_MCP_LICENSE_KEY,
  },
  mcp: {
    command: env.MCP_CLICKUP_COMMAND,
    args: parseArgs(env.MCP_CLICKUP_ARGS),
    path: env.MCP_CLICKUP_PATH,
  },
  supabase: {
    url: env.SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  },
  timezone: env.TIMEZONE,
};
