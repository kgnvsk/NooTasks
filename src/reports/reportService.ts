import { DateTime } from "luxon";
import { config } from "../config/config";
import {
  findDepartmentByListId,
  getDepartmentFilter,
  normalizeDepartmentKey,
} from "../config/departments";
import { ClickUpMcpClient } from "../mcp/clickupClient";
import { ClickUpAssignee, ClickUpTask, ReportQuery } from "./types";
import { logger } from "../utils/logger";

const MAX_TASKS = 2000;
const DEFAULT_TASK_LIMIT = 10;
const DEFAULT_STALE_DAYS = 7;
const DEFAULT_ASSIGNEE_TASK_LIMIT = 5;

const toMillis = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(parsed) ? parsed : null;
};

const getStatusName = (task: ClickUpTask): string => {
  if (typeof task.status === "string") {
    return task.status;
  }
  return task.status?.status ?? "Unknown";
};

const isActiveStatus = (status: string): boolean => {
  const lowered = status.toLowerCase();
  if (lowered.includes("done")) {
    return false;
  }
  if (lowered.includes("closed")) {
    return false;
  }
  return true;
};

const getAssigneeLabel = (assignee: ClickUpAssignee): string => {
  return (
    assignee.username ||
    assignee.name ||
    assignee.email ||
    (assignee.id !== undefined ? String(assignee.id) : "Unknown")
  );
};

const getTaskListId = (task: ClickUpTask): string | undefined => {
  return task.list?.id ?? task.list_id;
};

const extractTasks = (payload: unknown): ClickUpTask[] => {
  if (!payload) {
    return [];
  }
  if (Array.isArray(payload)) {
    return payload as ClickUpTask[];
  }
  if (typeof payload === "object") {
    const data = payload as { tasks?: ClickUpTask[]; data?: { tasks?: ClickUpTask[] } };
    if (Array.isArray(data.tasks)) {
      return data.tasks;
    }
    if (data.data && Array.isArray(data.data.tasks)) {
      return data.data.tasks;
    }
  }
  return [];
};

const shouldStopPaging = (payload: unknown, pageTasks: ClickUpTask[]): boolean => {
  if (pageTasks.length === 0) {
    return true;
  }
  if (payload && typeof payload === "object") {
    const data = payload as { last_page?: boolean; has_more?: boolean };
    if (data.last_page === true) {
      return true;
    }
    if (data.has_more === false) {
      return true;
    }
  }
  return false;
};

const formatDate = (timestamp: number | null, timezone: string): string => {
  if (!timestamp) {
    return "n/a";
  }
  return DateTime.fromMillis(timestamp, { zone: timezone }).toFormat("dd.MM");
};

const formatTask = (task: ClickUpTask, timezone: string): string => {
  const status = getStatusName(task);
  const listId = getTaskListId(task);
  const department = listId ? findDepartmentByListId(listId) : undefined;
  const departmentLabel = department ? `[${department}] ` : "";
  const assignees = task.assignees && task.assignees.length > 0
    ? task.assignees.map(getAssigneeLabel).join(", ")
    : "Unassigned";
  const due = formatDate(toMillis(task.due_date), timezone);
  const updated = formatDate(toMillis(task.date_updated), timezone);
  const link = task.url ?? "";

  return [
    `- ${departmentLabel}${status}`,
    `  ${task.name ?? "Untitled"}`,
    `  assignee: ${assignees} | due: ${due} | upd: ${updated}`,
    link ? `  ${link}` : "",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
};

export class ReportService {
  constructor(private clickup: ClickUpMcpClient, private timezone = config.timezone) {}

  private async fetchTasks(filters: Record<string, unknown>): Promise<ClickUpTask[]> {
    const tasks: ClickUpTask[] = [];
    let page = 0;

    logger.info("report_fetch_start", { filters });
    while (tasks.length < MAX_TASKS) {
      const payload = await this.clickup.getWorkspaceTasks({ ...filters, page });
      const pageTasks = extractTasks(payload);
      tasks.push(...pageTasks);
      logger.info("report_fetch_page", { page, count: pageTasks.length, total: tasks.length });

      if (shouldStopPaging(payload, pageTasks)) {
        break;
      }

      page += 1;
    }

    logger.info("report_fetch_done", { total: tasks.length });
    return tasks.slice(0, MAX_TASKS);
  }

  async getOverdueReport(query: ReportQuery): Promise<string> {
    const now = DateTime.now().setZone(this.timezone);
    const nowMillis = now.toMillis();
    const departmentFilter = getDepartmentFilter(query.department);

    const tasks = await this.fetchTasks({
      ...departmentFilter,
      due_date_lt: nowMillis,
      include_closed: false,
      order_by: "due_date",
    });

    const overdueTasks = tasks
      .filter((task) => {
        const due = toMillis(task.due_date);
        if (!due || due >= nowMillis) {
          return false;
        }
        return isActiveStatus(getStatusName(task));
      })
      .sort((a, b) => (toMillis(a.due_date) ?? 0) - (toMillis(b.due_date) ?? 0));

    if (overdueTasks.length === 0) {
      return "No overdue tasks found.";
    }

    const assigneeCounts = new Map<string, number>();
    for (const task of overdueTasks) {
      const assignees = task.assignees && task.assignees.length > 0
        ? task.assignees
        : [{ name: "Unassigned" }];
      for (const assignee of assignees) {
        const label = getAssigneeLabel(assignee);
        assigneeCounts.set(label, (assigneeCounts.get(label) ?? 0) + 1);
      }
    }

    const topAssignees = Array.from(assigneeCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count], index) => `${index + 1}) ${name} - ${count}`)
      .join("\n");

    const limit = query.limit ?? DEFAULT_TASK_LIMIT;
    const taskLines = overdueTasks.slice(0, limit).map((task) => formatTask(task, this.timezone));

    return [
      `Overdue tasks: ${overdueTasks.length}`,
      "Top assignees:",
      topAssignees,
      `Tasks (first ${Math.min(limit, overdueTasks.length)}):`,
      ...taskLines,
    ]
      .filter((line) => line.length > 0)
      .join("\n");
  }

  async getNotUpdatedTodayReport(query: ReportQuery): Promise<string> {
    const now = DateTime.now().setZone(this.timezone);
    const startOfDay = now.startOf("day");
    const endOfDay = now.endOf("day");
    const departmentFilter = getDepartmentFilter(query.department);

    const tasks = await this.fetchTasks({
      ...departmentFilter,
      due_date_gt: startOfDay.toMillis() - 1,
      due_date_lt: endOfDay.toMillis() + 1,
      date_updated_lt: startOfDay.toMillis(),
      include_closed: false,
      order_by: "due_date",
    });

    const filteredTasks = tasks.filter((task) => {
      const due = toMillis(task.due_date);
      if (!due || due < startOfDay.toMillis() || due > endOfDay.toMillis()) {
        return false;
      }
      const updated = toMillis(task.date_updated);
      if (!updated || updated >= startOfDay.toMillis()) {
        return false;
      }
      return isActiveStatus(getStatusName(task));
    });

    if (filteredTasks.length === 0) {
      return "No tasks found that were due today and not updated.";
    }

    const assigneeMap = new Map<string, ClickUpTask[]>();
    for (const task of filteredTasks) {
      const assignees = task.assignees && task.assignees.length > 0
        ? task.assignees
        : [{ name: "Unassigned" }];
      for (const assignee of assignees) {
        const label = getAssigneeLabel(assignee);
        if (!assigneeMap.has(label)) {
          assigneeMap.set(label, []);
        }
        assigneeMap.get(label)?.push(task);
      }
    }

    const assigneeEntries = Array.from(assigneeMap.entries()).sort(
      (a, b) => b[1].length - a[1].length
    );

    const sections: string[] = [
      `Not updated today (due today): ${filteredTasks.length} tasks`,
    ];

    for (const [assignee, tasksForAssignee] of assigneeEntries) {
      const header = `${assignee} - ${tasksForAssignee.length}`;
      const taskLines = tasksForAssignee
        .slice(0, DEFAULT_ASSIGNEE_TASK_LIMIT)
        .map((task) => `  - ${task.name ?? "Untitled"}`);
      sections.push(header, ...taskLines);
    }

    return sections.join("\n");
  }

  async getStaleReport(query: ReportQuery): Promise<string> {
    const now = DateTime.now().setZone(this.timezone);
    const days = query.days ?? DEFAULT_STALE_DAYS;
    const cutoff = now.minus({ days }).toMillis();
    const departmentFilter = getDepartmentFilter(query.department);

    const tasks = await this.fetchTasks({
      ...departmentFilter,
      date_updated_lt: cutoff,
      include_closed: false,
      order_by: "updated",
    });

    const staleTasks = tasks
      .filter((task) => {
        const updated = toMillis(task.date_updated);
        if (!updated || updated >= cutoff) {
          return false;
        }
        return isActiveStatus(getStatusName(task));
      })
      .sort((a, b) => (toMillis(a.date_updated) ?? 0) - (toMillis(b.date_updated) ?? 0));

    if (staleTasks.length === 0) {
      return `No tasks stale for ${days} days.`;
    }

    const limit = query.limit ?? DEFAULT_TASK_LIMIT;
    const taskLines = staleTasks.slice(0, limit).map((task) => formatTask(task, this.timezone));

    return [
      `Stale tasks (${days}+ days): ${staleTasks.length}`,
      `Tasks (first ${Math.min(limit, staleTasks.length)}):`,
      ...taskLines,
    ]
      .filter((line) => line.length > 0)
      .join("\n");
  }

  async getActiveTasksReport(query: ReportQuery): Promise<string> {
    const now = DateTime.now().setZone(this.timezone);
    const departmentFilter = getDepartmentFilter(query.department);
    const hasDepartmentFilter =
      (departmentFilter.list_ids && departmentFilter.list_ids.length > 0) ||
      (departmentFilter.space_ids && departmentFilter.space_ids.length > 0);

    if (!hasDepartmentFilter) {
      return "Department filter is required for active tasks. Please configure departments.";
    }

    const tasks = await this.fetchTasks({
      ...departmentFilter,
      include_closed: false,
      order_by: "updated",
      reverse: true,
    });

    const activeTasks = tasks.filter((task) => isActiveStatus(getStatusName(task)));
    if (activeTasks.length === 0) {
      return "No active tasks found.";
    }

    const limit = query.limit ?? DEFAULT_TASK_LIMIT;
    const taskLines = activeTasks.slice(0, limit).map((task) => formatTask(task, this.timezone));

    return [
      `Active tasks (${now.toFormat("dd.MM")}): ${activeTasks.length}`,
      `Tasks (first ${Math.min(limit, activeTasks.length)}):`,
      ...taskLines,
    ]
      .filter((line) => line.length > 0)
      .join("\n");
  }

  async runReport(query: ReportQuery): Promise<string> {
    const department = normalizeDepartmentKey(query.department) ?? query.department;
    const normalized: ReportQuery = { ...query, department };

    switch (query.type) {
      case "overdue":
        return this.getOverdueReport(normalized);
      case "not_updated_today":
        return this.getNotUpdatedTodayReport(normalized);
      case "stale_n_days":
        return this.getStaleReport(normalized);
      case "active_tasks":
        return this.getActiveTasksReport(normalized);
      default:
        return "Unsupported report type.";
    }
  }
}
