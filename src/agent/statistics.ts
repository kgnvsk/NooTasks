import { DateTime } from "luxon";
import { config } from "../config/config";
import { logger } from "../utils/logger";

/**
 * Generate overdue statistics by assignee
 */
export function generateOverdueStats(allTasks: any[]): string {
  logger.info("stats_generation_start", { totalTasks: allTasks.length });
  const now = DateTime.now().setZone(config.timezone);
  const todayStart = now.startOf('day');
  
  const activeStatuses = [
    'сьогодні', 'today', 'urgent', 'в роботі', 'in progress', 
    'задачі на сьогодні', 'на затвердження', 'допрацювати',
    'усі задачі', 'all tasks', 'to do', 'open', 'backlog'
  ];
  
  // Group by assignee
  const statsByAssignee = new Map<string, { 
    hardOverdue: number; 
    stuck: number; 
    dueToday: number;
    departments: Set<string>;
  }>();
  
  for (const task of allTasks) {
    // API already returns only open tasks (include_closed: false)
    const statusName = (task.status?.status || '').toLowerCase();
    
    const assignees = task.assignees || [];
    if (assignees.length === 0) continue; // Skip unassigned
    
    const due = task.due_date ? DateTime.fromMillis(Number(task.due_date)).setZone(config.timezone) : null;
    const created = task.date_created ? DateTime.fromMillis(Number(task.date_created)).setZone(config.timezone) : null;
    const daysOld = created ? Math.floor(now.diff(created, 'days').days) : 0;
    
    const dueDateStr = due ? due.toFormat("yyyy-MM-dd") : null;
    const todayStr = now.toFormat("yyyy-MM-dd");
    const isDueToday = dueDateStr === todayStr;
    const isHardOverdue = due ? due.startOf('day') < todayStart : false;
    
    const statusLower = statusName;
    const isActiveStatus = activeStatuses.some(s => statusLower.includes(s));
    const isStuck = !due && isActiveStatus && daysOld >= 1;
    
    const department = task.list?.name || task.folder?.name || task.space?.name || 'Без відділу';
    
    for (const assignee of assignees) {
      // Extract name from assignee (might be string or object)
      const name = typeof assignee === 'string' ? assignee : (assignee.username || assignee.email || String(assignee.id || 'Unknown'));
      if (!name || name === 'Unknown') continue;
      
      if (!statsByAssignee.has(name)) {
        statsByAssignee.set(name, { hardOverdue: 0, stuck: 0, dueToday: 0, departments: new Set() });
      }
      const stats = statsByAssignee.get(name)!;
      stats.departments.add(department);
      if (isHardOverdue) stats.hardOverdue++;
      if (isStuck) stats.stuck++;
      if (isDueToday) stats.dueToday++;
    }
  }
  
  // Sort by total problems
  const sorted = Array.from(statsByAssignee.entries())
    .map(([name, stats]) => ({
      name,
      total: stats.hardOverdue + stats.stuck + stats.dueToday,
      hardOverdue: stats.hardOverdue,
      stuck: stats.stuck,
      dueToday: stats.dueToday,
      departments: Array.from(stats.departments)
    }))
    .filter(s => s.total > 0)
    .sort((a, b) => b.total - a.total);
  
  logger.info("stats_generation_done", { 
    totalPeople: sorted.length,
    topPerson: sorted[0]?.name,
    topTotal: sorted[0]?.total
  });
  
  if (sorted.length === 0) {
    return "✅ Проблемних задач ні у кого немає!";
  }
  
  const lines: string[] = [];
  lines.push(`📊 <b>Топ-${Math.min(sorted.length, 5)} за проблемними задачами:</b>\n`);

  // Show top 5 only
  for (let i = 0; i < Math.min(sorted.length, 5); i++) {
    const s = sorted[i];
    const parts: string[] = [];
    if (s.hardOverdue > 0) parts.push(`🔴${s.hardOverdue}`);
    if (s.stuck > 0) parts.push(`🟠${s.stuck}`);
    if (s.dueToday > 0) parts.push(`🟡${s.dueToday}`);

    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    lines.push(`${medal} <b>${s.name}</b> — ${s.total} (${parts.join(' + ')})`);
  }

  if (sorted.length > 5) {
    lines.push(`\n<i>...та ще ${sorted.length - 5} співробітників</i>`);
  }

  return lines.join('\n');
}

