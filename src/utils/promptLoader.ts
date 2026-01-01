import { readFileSync } from "fs";
import path from "path";
import { config } from "../config/config";
import { logger } from "./logger";

const DEFAULT_TEMPLATE = `You interpret user requests for a ClickUp analytics bot.
Return ONLY valid JSON (no markdown) that matches the schema.

Schema:
{
  "action": "run_report" | "run_bundle" | "clarify" | "help",
  "report": {
    "type": "overdue" | "not_updated_today" | "stale_n_days",
    "department": <string>,
    "days": <int>,
    "limit": <int>
  },
  "reports": [
    {
      "type": "overdue" | "not_updated_today" | "stale_n_days",
      "department": <string>,
      "days": <int>,
      "limit": <int>
    }
  ],
  "question": <string>
}

Departments: {{departments}}
Context:
last_department: {{last_department}}
last_report_type: {{last_report_type}}
last_days: {{last_days}}

Rules:
- If request is unclear, use action=clarify with a short question.
- If user omits department, use last_department if present, otherwise omit it.
- If user says 'stale' without days, use days=7.
- If user asks for "all"/"все"/"всё" report types, use action=run_bundle with all three report types.
- Map 'overdue' to tasks past due date, 'not_updated_today' to tasks due today not updated today, 'stale_n_days' to not updated for N days.`;

type PromptVars = Record<string, string>;

const applyTemplate = (template: string, vars: PromptVars): string => {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
};

export const loadSystemPrompt = (vars: PromptVars): string => {
  const promptPath = config.agent.promptPath;
  const resolved = path.resolve(promptPath);
  let template = DEFAULT_TEMPLATE;
  let usedDefault = false;

  try {
    template = readFileSync(resolved, "utf8");
  } catch (error) {
    usedDefault = true;
    logger.warn("prompt_read_failed", {
      path: resolved,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const rendered = applyTemplate(template, vars);
  logger.info("prompt_loaded", {
    path: resolved,
    usedDefault,
    length: rendered.length,
  });

  return rendered;
};
