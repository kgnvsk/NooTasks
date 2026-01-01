export type ReportType = "overdue" | "not_updated_today" | "stale_n_days" | "active_tasks";

export type ReportQuery = {
  type: ReportType;
  department?: string;
  days?: number;
  limit?: number;
};

export type ClickUpAssignee = {
  id?: number;
  username?: string;
  email?: string;
  name?: string;
};

export type ClickUpTask = {
  id?: string;
  name?: string;
  url?: string;
  status?: { status?: string } | string;
  assignees?: ClickUpAssignee[];
  due_date?: string | number | null;
  date_updated?: string | number | null;
  priority?: { priority?: string } | number | null;
  list?: { id?: string; name?: string };
  list_id?: string;
};
