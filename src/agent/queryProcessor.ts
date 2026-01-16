import { DateTime } from "luxon";
import { config } from "../config/config";
import { logger } from "../utils/logger";
import { QueryClassification, TaskData, FilterType } from "./queryTypes";
import members from "../config/members.json";
import departments from "../config/departments.json";

/**
 * Unified query processor - loads and filters tasks based on classification
 * Uses direct ClickUp REST API calls (no MCP dependency)
 */
export class QueryProcessor {
  constructor() {}

  /**
   * Fetch tasks directly from ClickUp REST API (bypassing MCP due to bugs)
   */
  private async fetchClickUpAPI(endpoint: string): Promise<any> {
    const url = `https://api.clickup.com/api/v2${endpoint}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': config.clickup.apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ClickUp API error ${response.status}: ${text}`);
    }

    return response.json();
  }

  /**
   * Helper: safely extract status string from task.status (which can be string or object)
   */
  private getStatusString(status: string | { status: string; [key: string]: any }): string {
    if (typeof status === 'string') {
      return status;
    }
    return status?.status || '';
  }

  /**
   * Main entry point - processes a classified query and returns filtered tasks
   */
  async processQuery(classification: QueryClassification): Promise<TaskData[]> {
    logger.info("query_processor_start", { classification });

    // Step 1: Load tasks based on entity type
    const tasks = await this.loadTasks(classification);

    logger.info("query_processor_loaded", { count: tasks.length });

    // Step 2: Apply filters
    const filtered = this.applyFilters(tasks, classification.filterType);

    logger.info("query_processor_filtered", { count: filtered.length, filter: classification.filterType });

    return filtered;
  }

  /**
   * Load tasks based on entity type
   */
  private async loadTasks(classification: QueryClassification): Promise<TaskData[]> {
    switch (classification.entityType) {
      case 'person':
        return this.loadPersonTasks(classification.entityId!);

      case 'department':
        return this.loadDepartmentTasks(classification.entityId!);

      case 'all':
        return this.loadAllTasks();

      default:
        throw new Error(`Unknown entity type: ${classification.entityType}`);
    }
  }

  /**
   * Load tasks for a specific person using REST API
   */
  private async loadPersonTasks(personId: string): Promise<TaskData[]> {
    const allTasks: TaskData[] = [];
    let page = 0;

    // Paginate through all tasks for the person using REST API
    while (page < 10) {
      try {
        const response = await this.fetchClickUpAPI(
          `/team/${config.clickup.teamId}/task?assignees[]=${personId}&subtasks=true&archived=false&page=${page}`
        );

        const tasks: TaskData[] = response.tasks || [];
        allTasks.push(...tasks);

        logger.info("person_tasks_page", { personId, page, count: tasks.length, total: allTasks.length });

        // If we got no tasks, we've reached the end
        if (tasks.length === 0) break;
        page++;
      } catch (error) {
        logger.error("person_tasks_page_failed", { personId, page, error: String(error) });
        break;
      }
    }

    logger.info("person_tasks_loaded", { personId, totalTasks: allTasks.length });

    return allTasks;
  }

  /**
   * Load tasks for a department
   */
  private async loadDepartmentTasks(departmentKey: string): Promise<TaskData[]> {
    const dept = (departments as any)[departmentKey];
    if (!dept || !dept.list_ids) {
      logger.warn("department_not_found", { departmentKey });
      return [];
    }

    const allTasks: TaskData[] = [];

    // Use ClickUp REST API directly - MCP has bugs and doesn't return all tasks
    for (const listId of dept.list_ids) {
      try {
        const response = await this.fetchClickUpAPI(
          `/list/${listId}/task?archived=false&subtasks=true`
        );

        const tasks: TaskData[] = response.tasks || [];
        allTasks.push(...tasks);

        logger.info("department_list_loaded", {
          departmentKey,
          listId,
          count: tasks.length,
          total: allTasks.length
        });
      } catch (error) {
        logger.error("department_list_failed", {
          departmentKey,
          listId,
          error: String(error)
        });
      }
    }

    logger.info("department_tasks_loaded", {
      departmentKey,
      totalTasks: allTasks.length
    });

    return allTasks;
  }

  /**
   * Load all tasks (from all people)
   */
  private async loadAllTasks(): Promise<TaskData[]> {
    const allTasks: TaskData[] = [];

    // Load tasks for each person
    for (const member of members) {
      try {
        const tasks = await this.loadPersonTasks(String(member.id));
        allTasks.push(...tasks);
      } catch (error) {
        logger.error("load_all_person_failed", { personId: member.id, error: String(error) });
      }
    }

    return allTasks;
  }

  /**
   * Apply filters to tasks
   */
  private applyFilters(tasks: TaskData[], filterType: FilterType): TaskData[] {
    switch (filterType) {
      case 'in_progress':
        return this.filterInProgress(tasks);
      case 'overdue':
        return this.filterOverdue(tasks);

      case 'stuck':
        return this.filterStuck(tasks);

      case 'due_today':
        return this.filterDueToday(tasks);

      case 'none':
        return tasks;

      default:
        return tasks;
    }
  }

  /**
   * Filter tasks that are in progress
   */
  private filterInProgress(tasks: TaskData[]): TaskData[] {
    const progressKeywords = [
      'in progress',
      'progress',
      'робот',
      'в роботі',
      'в процесі',
      'in work',
      'working',
    ];

    return tasks.filter(task => {
      const statusName = this.getStatusString(task.status).toLowerCase();
      return progressKeywords.some((kw) => statusName.includes(kw));
    });
  }

  /**
   * Filter overdue tasks
   */
  private filterOverdue(tasks: TaskData[]): TaskData[] {
    const now = DateTime.now().setZone(config.timezone);
    const todayStart = now.startOf('day');

    return tasks.filter(task => {
      if (!task.due_date) return false;
      const due = DateTime.fromMillis(Number(task.due_date)).setZone(config.timezone);
      return due.startOf('day') < todayStart;
    });
  }

  /**
   * Filter stuck tasks (no due date, in active status, old)
   */
  private filterStuck(tasks: TaskData[]): TaskData[] {
    const now = DateTime.now().setZone(config.timezone);
    const activeStatuses = [
      'сьогодні', 'today', 'urgent', 'в роботі', 'in progress',
      'задачі на сьогодні', 'на затвердження', 'допрацювати',
      'усі задачі', 'all tasks', 'to do', 'open', 'backlog'
    ];

    const debugInfo: any[] = [];

    const filtered = tasks.filter(task => {
      try {
        const reasons: string[] = [];

        // Check 1: Has due date?
        if (task.due_date) {
          reasons.push(`has_due_date:${task.due_date}`);
          debugInfo.push({ name: task.name, status: task.status, reason: reasons.join(', '), include: false });
          return false;
        }

        // Check 2: Status is active?
        const statusName = this.getStatusString(task.status).toLowerCase();

        const isActiveStatus = activeStatuses.some(s => statusName.includes(s));
        if (!isActiveStatus) {
          reasons.push(`inactive_status:${statusName}`);
          debugInfo.push({ name: task.name, status: statusName, reason: reasons.join(', '), include: false });
          return false;
        }

        // Check 3: Has valid creation date?
        const created = task.date_created
          ? DateTime.fromMillis(Number(task.date_created)).setZone(config.timezone)
          : null;

        if (!created || !created.isValid) {
          reasons.push('no_valid_date_created');
          debugInfo.push({ name: task.name, status: task.status, reason: reasons.join(', '), include: false });
          return false;
        }

        // Check 4: Old enough (>= 1 day)?
        const daysOld = Math.floor(now.diff(created, 'days').days);
        if (daysOld < 1) {
          reasons.push(`too_new:${daysOld}days (created:${created.toFormat('yyyy-MM-dd HH:mm')})`);
          debugInfo.push({ name: task.name, status: task.status, reason: reasons.join(', '), include: false });
          return false;
        }

        // Passed all checks
        debugInfo.push({
          name: task.name,
          status: task.status,
          daysOld,
          created: created.toFormat('yyyy-MM-dd HH:mm'),
          include: true
        });
        return true;

      } catch (error) {
        logger.error("filter_stuck_task_error", {
          taskId: task.id,
          taskName: task.name,
          status: task.status,
          date_created: task.date_created,
          error: String(error)
        });
        return false;
      }
    });

    logger.info("filter_stuck_result", {
      totalTasks: tasks.length,
      stuckTasks: filtered.length,
      passed: debugInfo.filter(d => d.include),
      rejected: debugInfo.filter(d => !d.include).slice(0, 10) // First 10 rejected
    });

    return filtered;
  }

  /**
   * Filter tasks due today
   */
  private filterDueToday(tasks: TaskData[]): TaskData[] {
    const now = DateTime.now().setZone(config.timezone);
    const todayStr = now.toFormat("yyyy-MM-dd");

    return tasks.filter(task => {
      if (!task.due_date) return false;
      const due = DateTime.fromMillis(Number(task.due_date)).setZone(config.timezone);
      const dueDateStr = due.toFormat("yyyy-MM-dd");
      return dueDateStr === todayStr;
    });
  }
}
