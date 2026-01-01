/**
 * Query classification types for the task management assistant
 */

export type EntityType =
  | 'person'      // Specific person's tasks
  | 'department'  // Department's tasks
  | 'all';        // All tasks

export type FilterType =
  | 'overdue'     // Tasks past due date
  | 'stuck'       // Tasks without due date and old
  | 'due_today'   // Tasks due today
  | 'none';       // No filter

export type OperationType =
  | 'show'        // Show tasks
  | 'count'       // Count tasks
  | 'stats';      // Statistics/analytics

export interface QueryClassification {
  entityType: EntityType;
  entityId?: string;      // person ID or department key
  entityName?: string;    // person name or department name
  filterType: FilterType;
  operation: OperationType;
}

export interface TaskData {
  id: string;
  name: string;
  status: string | { status: string; id: string; color: string; type: string; orderindex: number };
  due_date: string | null;
  assignees: Array<{ id: string; username: string }>;
  list: { id: string; name: string } | null;
  folder: { id: string; name: string } | null;
  space: { id: string; name: string } | null;
  url: string;
  date_created: string;
}
