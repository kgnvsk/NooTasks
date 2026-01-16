import OpenAI from "openai";
import { DateTime } from "luxon";
import { departmentKeys, departments, normalizeDepartmentKey } from "../config/departments";
import { config } from "../config/config";
import { ConversationStore, StoredMessage } from "../storage/types";
import { logger } from "../utils/logger";
import { loadSystemPrompt } from "../utils/promptLoader";
import { generateOverdueStats } from "./statistics";
import { QueryProcessor } from "./queryProcessor";
import { EntityType, FilterType, OperationType } from "./queryTypes";
import members from "../config/members.json";

type AgentOptions = {
  model: string;
  temperature?: number;
};

type MemberConfig = {
  id: number;
  name: string;
  username?: string;
  email?: string;
  aliases?: string[];
  role?: string;
  exclude_from_counts?: boolean;
};

const buildSystemPrompt = (context: {
  lastDepartment?: string;
  lastReportType?: string;
  lastDays?: number;
  lastPersonId?: string;
  lastPersonName?: string;
}): string => {
  const safeDepartments = Array.isArray(departmentKeys) ? departmentKeys : [];
  const departmentsStr = safeDepartments.length > 0 ? safeDepartments.join(", ") : "none";
  const departmentsConfig = JSON.stringify(departments, null, 2);
  const membersConfig = JSON.stringify(members, null, 2);
  const now = DateTime.now().setZone(config.timezone);

  return loadSystemPrompt({
    departments: departmentsStr,
    departments_config: departmentsConfig,
    members_config: membersConfig,
    last_department: context.lastDepartment ?? "none",
    last_report_type: context.lastReportType ?? "none",
    last_days: context.lastDays !== undefined ? String(context.lastDays) : "none",
    last_person_id: context.lastPersonId ?? "none",
    last_person_name: context.lastPersonName ?? "none",
    current_time: now.toISO() ?? "",
    current_time_ms: String(now.toMillis()),
    current_date: now.toFormat("yyyy-MM-dd"),
    timezone: config.timezone,
  });
};

export class Agent {
  private queryProcessor: QueryProcessor;

  constructor(
    private openai: OpenAI,
    private store: ConversationStore,
    private options: AgentOptions
  ) {
    this.queryProcessor = new QueryProcessor();
  }

  private buildHistoryMessages(history: StoredMessage[]): Array<{ role: "user" | "assistant" | "system" | "tool"; content: string; tool_call_id?: string; name?: string }> {
    return history.map((message) => ({
      role: message.role as any,
      content: message.content,
    }));
  }

  private findMemberByText(textLower: string, membersList: MemberConfig[]): MemberConfig | null {
    for (const member of membersList) {
      const candidates = [member.name, member.username, ...(member.aliases || [])]
        .filter(Boolean) as string[];
      for (const candidate of candidates) {
        const candidateLower = candidate.toLowerCase();
        if (candidateLower && textLower.includes(candidateLower)) {
          return member;
        }
      }
    }
    return null;
  }

  private buildTeamInfoResponse(text: string): string | null {
    const textLower = text.toLowerCase();
    const hasTaskKeywords = /(таск|task|задач|задачи|завдан)/i.test(textLower);
    const isRoleQuery = /(\bроль|\bролі|\broles?\b|должност|посад|кто\s+за\s+что|хто\s+за\s+що|кто\s+чем|хто\s+чим)/i.test(textLower);
    const isCountQuery = /(сколько|скільки).*(людей|людина|человек|співробітник|сотрудник|працівник)/i.test(textLower)
      || /team\s+size|кількість\s+людей/i.test(textLower);
    const isListQuery = /(кто|хто)\s+(у\s+нас\s+)?(работает|працює)|співробітники|сотрудники|team\s+members|команда/i.test(textLower);

    if (!isRoleQuery && !isCountQuery && !isListQuery) {
      return null;
    }
    if (hasTaskKeywords && !isRoleQuery) {
      return null;
    }

    const membersList = members as MemberConfig[];
    const visibleMembers = membersList.filter((m) => !m.exclude_from_counts);
    const escapeHtml = (value: string) =>
      value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const matchedMember = this.findMemberByText(textLower, membersList);
    if (isRoleQuery && matchedMember) {
      const roleText = matchedMember.role || "роль не вказана";
      return `👤 <b>${escapeHtml(matchedMember.name)}</b>\n<b>Роль:</b> ${escapeHtml(roleText)}`;
    }

    if (isRoleQuery) {
      const lines = visibleMembers.map((m) => {
        const roleText = m.role || "роль не вказана";
        return `• <b>${escapeHtml(m.name)}</b> — ${escapeHtml(roleText)}`;
      });
      return `👥 <b>Ролі в команді</b>\n\n${lines.join("\n")}`;
    }

    if (isCountQuery && !isListQuery) {
      return `👥 <b>У команді: ${visibleMembers.length}</b>`;
    }

    if (isListQuery) {
      const lines = visibleMembers.map((m) => `• ${escapeHtml(m.name)}`);
      return `👥 <b>Команда</b>\n\n${lines.join("\n")}\n\n<b>Всього:</b> ${visibleMembers.length}`;
    }

    return null;
  }

  private getTools() {
    // Only custom tools - no MCP dependency
    return [
      {
        type: "function" as const,
        function: {
          name: "load_and_filter_tasks",
          description: "Universal tool to load and filter tasks. Use this for ALL task queries.",
          parameters: {
            type: "object",
            properties: {
              entityType: {
                type: "string",
                enum: ["person", "department", "all"],
                description: "What to query: 'person' for specific person, 'department' for project/department, 'all' for all tasks"
              },
              entityId: {
                type: "string",
                description: "Person ID (e.g. '100636815') or project key (e.g. 'botox', 'kyt_group', 'all_clients'). Required for person/department queries."
              },
              entityName: {
                type: "string",
                description: "Person name (e.g. 'Ilya Senchuk') or project name (e.g. 'Botox', 'KYT Group')"
              },
              filterType: {
                type: "string",
                enum: ["none", "overdue", "stuck", "due_today", "in_progress"],
                description: "Filter to apply: 'none' (all tasks), 'overdue' (past due), 'stuck' (no due date, old), 'due_today' (due today), 'in_progress' (currently in work)"
              }
            },
            required: ["entityType", "filterType"]
          }
        }
      },
      {
        type: "function" as const,
        function: {
          name: "update_context",
          description: "Save context about the person being discussed. MUST be called after querying tasks for a specific person to enable follow-up questions.",
          parameters: {
            type: "object",
            properties: {
              personId: {
                type: "string",
                description: "The user ID of the person (e.g. '100636815')"
              },
              personName: {
                type: "string",
                description: "The name of the person (e.g. 'Ilya Senchuk')"
              }
            },
            required: ["personId", "personName"]
          }
        }
      },
      {
        type: "function" as const,
        function: {
          name: "get_time_tracked",
          description: "Get time tracking data for a person. Use for questions like 'how much time did X track', 'скільки годин затрекав'",
          parameters: {
            type: "object",
            properties: {
              personId: {
                type: "string",
                description: "The ClickUp user ID of the person"
              },
              personName: {
                type: "string",
                description: "Name of the person for display"
              },
              period: {
                type: "string",
                enum: ["today", "yesterday", "this_week", "last_week", "this_month", "last_month"],
                description: "Time period to query"
              }
            },
            required: ["personId", "personName", "period"]
          }
        }
      }
    ];
  }

  private truncateToolResult(name: string, result: any): string {
    const json = JSON.stringify(result);
    if (json.length < 5000) return json;

    if (name === "get_workspace_hierarchy") {
      const simplifyHierarchy = (items: any[]): any[] => {
        return items.map(item => ({
          id: item.id,
          name: item.name,
          type: item.type || (item.lists ? 'folder' : item.tasks ? 'list' : 'space'),
          children: item.spaces ? simplifyHierarchy(item.spaces) : 
                    item.folders ? simplifyHierarchy(item.folders) :
                    item.lists ? simplifyHierarchy(item.lists) : undefined
        }));
      };
      return JSON.stringify(simplifyHierarchy(Array.isArray(result) ? result : [result])).substring(0, 15000);
    }

    if (name === "get_workspace_members") {
      const members = result?.members || result;
      if (Array.isArray(members)) {
        const simplified = members.map((m: any) => ({
          id: m.user?.id || m.id,
          full_name: m.user?.username || m.name,
          email: m.user?.email || m.email,
        }));
        return JSON.stringify({ members: simplified });
      }
    }

    if (name === "get_workspace_tasks" && result?.tasks) {
      const now = DateTime.now().setZone(config.timezone);
      const todayStr = now.toFormat("yyyy-MM-dd");
      const todayStart = now.startOf('day');
      
      // Statuses that should be monitored for "stuck" detection
      const activeStatuses = [
        'сьогодні', 'today', 'urgent', 'в роботі', 'in progress', 
        'задачі на сьогодні', 'на затвердження', 'допрацювати',
        'усі задачі', 'all tasks', 'to do', 'open', 'backlog'
      ];
      
      // Filter out truly completed tasks (status name contains "complete")
      const activeTasks = result.tasks.filter((t: any) => {
        const statusName = (t.status?.status || '').toLowerCase();
        // Exclude ONLY if status name explicitly says "complete" or "done"
        return !statusName.includes('complete') && !statusName.includes('done');
      });
      
      logger.info("agent_tasks_received", { total: result.tasks.length, active: activeTasks.length });
      
      const simplified = activeTasks.map((t: any) => {
        const due = t.due_date ? DateTime.fromMillis(Number(t.due_date)).setZone(config.timezone) : null;
        const created = t.date_created ? DateTime.fromMillis(Number(t.date_created)).setZone(config.timezone) : null;
        
        const daysOld = created ? Math.floor(now.diff(created, 'days').days) : 0;
        const dueDateStr = due ? due.toFormat("yyyy-MM-dd") : null;
        const isDueToday = dueDateStr === todayStr;
        const isHardOverdue = due ? due.startOf('day') < todayStart : false;
        const overdueDays = isHardOverdue ? Math.floor(todayStart.diff(due!.startOf('day'), 'days').days) : 0;
        
        const statusLower = (t.status?.status || '').toLowerCase();
        const isActiveStatus = activeStatuses.some(s => statusLower.includes(s));
        // STUCK: No due date, in any active status, and older than 1 day
        const isStuck = !due && isActiveStatus && daysOld >= 1;

        // Pre-build the problem label for the agent
        let problem_type: string | null = null;
        let problem_priority = 0;
        if (isHardOverdue) {
          problem_type = `🔴 Прострочено на ${overdueDays} днів`;
          problem_priority = 1;
        } else if (isStuck) {
          problem_type = `🟠 Зависла ${daysOld} днів без руху`;
          problem_priority = 2;
        } else if (isDueToday) {
          problem_type = `🟡 Дедлайн сьогодні`;
          problem_priority = 3;
        }

        return {
          id: t.id,
          name: t.name,
          status: t.status?.status,
          assignees: t.assignees?.map((a: any) => a.username),
          due_date_human: dueDateStr,
          list_name: t.list?.name,
          url: t.url,
          problem_type,
          problem_priority,
        };
      });
      
      // Filter to only problematic tasks and sort by priority
      const problematic = simplified
        .filter((t: any) => t.problem_type !== null)
        .sort((a: any, b: any) => a.problem_priority - b.problem_priority);
      
      const overdueCount = simplified.filter((t: any) => t.problem_priority === 1).length;
      const stuckCount = simplified.filter((t: any) => t.problem_priority === 2).length;
      const dueTodayCount = simplified.filter((t: any) => t.problem_priority === 3).length;
      
      logger.info("agent_tasks_processed", { 
        total: result.tasks.length, 
        overdue: overdueCount,
        stuck: stuckCount,
        dueToday: dueTodayCount,
        problematic: problematic.length
      });
      
      // Generate statistics by assignee
      const statsReport = generateOverdueStats(result.tasks);
      
      // Build clean, user-friendly report
      const reportLines: string[] = [];
      
      if (problematic.length === 0) {
        reportLines.push(`✅ Проблемних задач не знайдено!`);
      } else {
        // Summary line
        const parts: string[] = [];
        if (overdueCount > 0) parts.push(`${overdueCount} прострочен${overdueCount === 1 ? 'а' : 'і'}`);
        if (stuckCount > 0) parts.push(`${stuckCount} завис${stuckCount === 1 ? 'ла' : 'ли'}`);
        if (dueTodayCount > 0) parts.push(`${dueTodayCount} на сьогодні`);
        
        reportLines.push(`⚠️ <b>Знайдено ${problematic.length} проблемних задач:</b> ${parts.join(', ')}\n`);
        
        // Output all problematic tasks - compact format
        for (const task of problematic) {
          const dueInfo = task.due_date_human ? ` • до ${task.due_date_human}` : '';

          // Compact single-line format with emoji from problem_type
          reportLines.push(`${task.problem_type} <b>${task.name}</b>`);
          reportLines.push(`   📂 ${task.list_name || '—'}${dueInfo} • <a href="${task.url}">відкрити</a>\n`);
        }
      }
      
      return JSON.stringify({ 
        READY_REPORT: reportLines.join('\n'),
        STATISTICS_BY_ASSIGNEE: statsReport,
        problematic_tasks: problematic.slice(0, 50),
        summary: { 
          total_problems: problematic.length,
          overdue: overdueCount, 
          stuck: stuckCount,
          dueToday: dueTodayCount 
        }
      });
    }

    return json.substring(0, 10000);
  }

  async handleMessage(userId: number, text: string): Promise<string> {
    const teamInfoResponse = this.buildTeamInfoResponse(text);
    if (teamInfoResponse) {
      await this.store.saveMessage(userId, "user", text);
      await this.store.saveMessage(userId, "assistant", teamInfoResponse);
      return teamInfoResponse;
    }

    const state = await this.store.getState(userId);
    const history = await this.store.getRecentMessages(userId, 10).catch(() => []);
    const messages: any[] = [
      { role: "system", content: buildSystemPrompt(state) },
      ...this.buildHistoryMessages(history),
      { role: "user", content: text },
    ];

    const tools = await this.getTools();
    let iterations = 0;

    while (iterations < 6) {
      iterations++;
      try {
        // For first iteration, force tool usage for task queries
        const taskKeywords = ['таск', 'task', 'задач', 'просроч', 'overdue', 'завис', 'stuck', 'дедлайн', 'deadline'];
        const isTaskQuery = taskKeywords.some(kw => text.toLowerCase().includes(kw));
        const forceTools = iterations === 1 && isTaskQuery;
        
        const completion = await this.openai.chat.completions.create({
          model: this.options.model,
          temperature: 0,
          messages,
          tools,
          tool_choice: forceTools ? "required" : "auto",
        });

        const message = completion.choices[0]?.message;
        if (!message) break;
        messages.push(message);

        if (!message.tool_calls || message.tool_calls.length === 0) {
          // Check if this is first iteration - agent MUST call tools for task-related queries
          if (iterations === 1) {
            const taskKeywords = ['таск', 'task', 'задач', 'просроч', 'overdue', 'завис', 'stuck', 'дедлайн', 'deadline'];
            const isTaskQuery = taskKeywords.some(kw => text.toLowerCase().includes(kw));
            
            if (isTaskQuery) {
              const errorMsg = "⚠️ Помилка: неможливо відповісти без завантаження даних. Спробуйте ще раз.";
              await this.store.saveMessage(userId, "user", text);
              await this.store.saveMessage(userId, "assistant", errorMsg);
              return errorMsg;
            }
          }
          
          const responseText = message.content || "Я не зміг знайти відповідь.";
          await this.store.saveMessage(userId, "user", text);
          await this.store.saveMessage(userId, "assistant", responseText);
          return responseText;
        }

        for (const toolCall of message.tool_calls) {
          if (toolCall.type !== "function") continue;
          const functionName = toolCall.function.name;
          const functionArgs = JSON.parse(toolCall.function.arguments);

          try {
            let result: any;
            if (functionName === "load_and_filter_tasks") {
              // Custom tool: unified task loading and filtering via REST API
              const { entityType, entityId, entityName, filterType } = functionArgs;

              logger.info("load_and_filter_tasks_start", { entityType, entityId, filterType });

              const tasks = await this.queryProcessor.processQuery({
                entityType: entityType as EntityType,
                entityId,
                entityName,
                filterType: filterType as FilterType,
                operation: 'show' as OperationType
              });

              logger.info("load_and_filter_tasks_done", { count: tasks.length });

              // Format tasks - two-level grouping (person -> project) with compact meta
              const displayLimit = 25;
              const tasksToShow = tasks.slice(0, displayLimit);
              const remaining = tasks.length - displayLimit;

              const filterTitles: Record<string, string> = {
                'stuck': '⏳ Зависли без руху',
                'overdue': '🔴 Прострочені',
                'due_today': '📅 На сьогодні',
                'in_progress': '🟢 В роботі',
                'none': '📋 Всі задачі'
              };

              const title = filterTitles[filterType] || '📋 Задачі';
              let formattedText = '';
              const escapeHtml = (value: string) =>
                value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
              const escapeAttr = (value: string) =>
                value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

              if (tasks.length === 0) {
                formattedText = `${title}\n\n✅ Задач не знайдено!`;
              } else {
                const headerName = entityName || entityId || '—';
                const peopleUrl = `https://app.clickup.com/${config.clickup.teamId}/teams-pulse/people`;
                const headerLabel = `<a href="${escapeAttr(peopleUrl)}">${escapeHtml(headerName)}</a>`;

                formattedText = `<b>${title}</b> — ${headerLabel} (${tasks.length})\n\n`;

                const groupedByProject = new Map<string, any[]>();
                for (const task of tasksToShow) {
                  const projectName = task.space?.name || task.list?.name || task.folder?.name || 'Без проєкту';
                  if (!groupedByProject.has(projectName)) {
                    groupedByProject.set(projectName, []);
                  }
                  groupedByProject.get(projectName)!.push(task);
                }

                for (const [projectName, projectTasks] of groupedByProject.entries()) {
                  formattedText += `<b>Проект:</b> ${escapeHtml(projectName)}\n`;

                  for (const task of projectTasks) {
                    const status = typeof task.status === 'string' ? task.status : task.status?.status || '—';
                    const dueDate = task.due_date
                      ? new Date(Number(task.due_date)).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' })
                      : '—';
                    const taskUrlRaw = task.url || task.short_url || (task.id ? `https://app.clickup.com/t/${task.id}` : '');
                    const taskUrl = taskUrlRaw ? escapeAttr(taskUrlRaw) : '';

                    formattedText += `<b>Таска:</b> ${escapeHtml(task.name)}\n`;
                    formattedText += `<b>Статус:</b> ${escapeHtml(status || '—')}\n`;
                    formattedText += `<b>Дедлайн:</b> ${escapeHtml(dueDate)}\n`;
                    formattedText += taskUrl
                      ? `<a href="${taskUrl}">🔗 Відкрити</a>\n\n`
                      : `🔗 Відкрити\n\n`;
                  }
                }

                if (remaining > 0) {
                  formattedText += `<i>+ ще ${remaining}</i>`;
                }
              }

              if (entityType === "person" && entityId && entityName) {
                await this.store.updateState(userId, {
                  lastPersonId: entityId,
                  lastPersonName: entityName
                });
                logger.info("agent_context_updated", { userId, personId: entityId, personName: entityName });
              }

              // Return directly to preserve HTML formatting without LLM reformatting.
              await this.store.saveMessage(userId, "user", text);
              await this.store.saveMessage(userId, "assistant", formattedText);
              return formattedText;
            } else if (functionName === "update_context") {
              // Custom tool: update context state
              const { personId, personName } = functionArgs;
              await this.store.updateState(userId, {
                lastPersonId: personId,
                lastPersonName: personName
              });
              logger.info("agent_context_updated", { userId, personId, personName });
              result = { success: true, message: `Context updated: ${personName} (${personId})` };
            } else if (functionName === "get_time_tracked") {
              // Time tracking tool
              const { personId, personName, period } = functionArgs;
              logger.info("get_time_tracked_start", { personId, period });

              // Calculate date range based on period
              const now = DateTime.now().setZone(config.timezone);
              let startDate: DateTime;
              let endDate: DateTime = now;
              let periodLabel = '';

              switch (period) {
                case 'today':
                  startDate = now.startOf('day');
                  periodLabel = 'сьогодні';
                  break;
                case 'yesterday':
                  startDate = now.minus({ days: 1 }).startOf('day');
                  endDate = now.minus({ days: 1 }).endOf('day');
                  periodLabel = 'вчора';
                  break;
                case 'this_week':
                  startDate = now.startOf('week');
                  periodLabel = 'цього тижня';
                  break;
                case 'last_week':
                  startDate = now.minus({ weeks: 1 }).startOf('week');
                  endDate = now.minus({ weeks: 1 }).endOf('week');
                  periodLabel = 'минулого тижня';
                  break;
                case 'this_month':
                  startDate = now.startOf('month');
                  periodLabel = 'цього місяця';
                  break;
                case 'last_month':
                  startDate = now.minus({ months: 1 }).startOf('month');
                  endDate = now.minus({ months: 1 }).endOf('month');
                  periodLabel = 'минулого місяця';
                  break;
                default:
                  startDate = now.startOf('month');
                  periodLabel = 'цього місяця';
              }

              // Fetch time entries from ClickUp API
              const startMs = startDate.toMillis();
              const endMs = endDate.toMillis();
              const url = `https://api.clickup.com/api/v2/team/${config.clickup.teamId}/time_entries?start_date=${startMs}&end_date=${endMs}&assignee=${personId}`;

              try {
                const response = await fetch(url, {
                  headers: {
                    'Authorization': config.clickup.apiKey,
                    'Content-Type': 'application/json',
                  },
                });

                if (!response.ok) {
                  throw new Error(`ClickUp API error ${response.status}`);
                }

                const data = await response.json();
                const entries = data.data || [];

                // Calculate total time
                let totalMs = 0;
                const taskBreakdown: Record<string, { name: string; duration: number }> = {};

                for (const entry of entries) {
                  const duration = Number(entry.duration) || 0;
                  totalMs += duration;

                  const taskId = entry.task?.id || 'no_task';
                  const taskName = entry.task?.name || 'Без задачі';

                  if (!taskBreakdown[taskId]) {
                    taskBreakdown[taskId] = { name: taskName, duration: 0 };
                  }
                  taskBreakdown[taskId].duration += duration;
                }

                // Format output
                const totalHours = Math.floor(totalMs / 3600000);
                const totalMinutes = Math.floor((totalMs % 3600000) / 60000);

                let formattedText = `⏱ <b>Time tracking: ${personName}</b>\n`;
                formattedText += `📅 Період: ${periodLabel}\n\n`;

                if (totalMs === 0) {
                  formattedText += `❌ Немає записів за цей період`;
                } else {
                  formattedText += `<b>Всього: ${totalHours}г ${totalMinutes}хв</b>\n\n`;

                  // Top tasks by time
                  const sortedTasks = Object.entries(taskBreakdown)
                    .sort((a, b) => b[1].duration - a[1].duration)
                    .slice(0, 10);

                  if (sortedTasks.length > 0) {
                    formattedText += `📋 По задачах:\n`;
                    for (const [, task] of sortedTasks) {
                      const h = Math.floor(task.duration / 3600000);
                      const m = Math.floor((task.duration % 3600000) / 60000);
                      formattedText += `• ${task.name}: ${h}г ${m}хв\n`;
                    }
                  }
                }

                result = { formattedText, totalHours, totalMinutes, entries: entries.length };
                logger.info("get_time_tracked_done", { personId, entries: entries.length, totalMs });
              } catch (error) {
                logger.error("get_time_tracked_failed", { personId, error: String(error) });
                result = { formattedText: `❌ Помилка отримання time tracking даних: ${error}`, error: true };
              }
            } else {
              // Unknown tool
              result = { error: `Unknown tool: ${functionName}` };
            }

            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: this.truncateToolResult(functionName, result),
            });
          } catch (error) {
            messages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify({ error: String(error) }) });
          }
        }
      } catch (error: any) {
        // Handle OpenAI API errors
        const errorCode = error?.error?.code || error?.code;
        const errorType = error?.error?.type || error?.type;
        const errorMessage = error?.error?.message || error?.message || String(error);

        logger.error("openai_api_error", {
          status: error?.status,
          code: errorCode,
          type: errorType,
          message: errorMessage
        });

        // Insufficient quota - out of credits
        if (errorCode === 'insufficient_quota' || errorType === 'insufficient_quota') {
          logger.error("openai_credits_depleted", { message: errorMessage });
          return "❌ <b>КРИТИЧНА ПОМИЛКА:</b> Закінчились кошти на OpenAI API!\n\nПотрібно поповнити баланс на https://platform.openai.com/account/billing";
        }

        // Rate limit exceeded
        if (error?.status === 429 || errorCode === 'rate_limit_exceeded') {
          logger.warn("openai_rate_limit", { message: errorMessage });
          return "⚠️ Забагато запитів до OpenAI. Почекайте хвилину і спробуйте знову.";
        }

        // Invalid API key
        if (error?.status === 401 || errorCode === 'invalid_api_key') {
          logger.error("openai_invalid_key", { message: errorMessage });
          return "❌ Помилка авторизації OpenAI API. Перевірте OPENAI_API_KEY.";
        }

        // Model not found or deprecated
        if (error?.status === 404 || errorCode === 'model_not_found') {
          logger.error("openai_model_not_found", { message: errorMessage });
          return "❌ Модель OpenAI не знайдена. Перевірте налаштування OPENAI_MODEL.";
        }

        // Generic OpenAI error
        logger.error("openai_unknown_error", { error: errorMessage });
        throw error;
      }
    }
    return "Забагато кроків. Спробуйте уточнити запит.";
  }
}
