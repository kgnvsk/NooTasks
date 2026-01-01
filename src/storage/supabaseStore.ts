import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config/config";
import { ReportType } from "../reports/types";
import { ConversationStore, SessionState, StoredMessage } from "./types";
import { logger } from "../utils/logger";

type MessageRow = {
  id: number;
  user_id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

type StateRow = {
  user_id: number;
  department: string | null;
  last_report_type: string | null;
  last_days: number | null;
  last_person_id: string | null;
  last_person_name: string | null;
  updated_at: string;
};

export class SupabaseStore implements ConversationStore {
  private client: SupabaseClient;

  constructor() {
    this.client = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: { persistSession: false },
    });
  }

  async getRecentMessages(userId: number, limit: number): Promise<StoredMessage[]> {
    logger.info("store_get_recent_messages", { userId, limit });
    const { data, error } = await this.client
      .from("chat_messages")
      .select("role, content, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      logger.error("store_get_recent_messages_failed", { userId, message: error.message });
      throw new Error(`Supabase getRecentMessages error: ${error.message}`);
    }

    const rows = (data ?? []) as Array<{ role: "user" | "assistant"; content: string; created_at: string }>;
    logger.info("store_get_recent_messages_done", { userId, count: rows.length });

    return rows
      .slice()
      .reverse()
      .map((row) => ({ role: row.role, content: row.content, createdAt: row.created_at }));
  }

  async saveMessage(userId: number, role: StoredMessage["role"], content: string): Promise<void> {
    logger.info("store_save_message", { userId, role, length: content.length });
    const { error } = await this.client
      .from("chat_messages")
      .insert({ user_id: userId, role, content });

    if (error) {
      logger.error("store_save_message_failed", { userId, message: error.message });
      throw new Error(`Supabase saveMessage error: ${error.message}`);
    }

    await this.trimMessages(userId, 100);
  }

  async getState(userId: number): Promise<SessionState> {
    logger.info("store_get_state", { userId });
    const { data, error } = await this.client
      .from("user_state")
      .select("user_id, department, last_report_type, last_days, last_person_id, last_person_name")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      logger.error("store_get_state_failed", { userId, message: error.message });
      throw new Error(`Supabase getState error: ${error.message}`);
    }

    const row = data as StateRow | null;
    if (!row) {
      return {};
    }

    const lastReportType = this.parseReportType(row.last_report_type);

    return {
      department: row.department ?? undefined,
      lastReportType,
      lastDays: row.last_days ?? undefined,
      lastPersonId: row.last_person_id ?? undefined,
      lastPersonName: row.last_person_name ?? undefined,
    };
  }

  async updateState(userId: number, next: SessionState): Promise<SessionState> {
    logger.info("store_update_state", { userId, next });
    const payload = {
      user_id: userId,
      department: next.department ?? null,
      last_report_type: next.lastReportType ?? null,
      last_days: next.lastDays ?? null,
      last_person_id: next.lastPersonId ?? null,
      last_person_name: next.lastPersonName ?? null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await this.client
      .from("user_state")
      .upsert(payload)
      .select("user_id, department, last_report_type, last_days, last_person_id, last_person_name")
      .maybeSingle();

    if (error) {
      logger.error("store_update_state_failed", { userId, message: error.message });
      throw new Error(`Supabase updateState error: ${error.message}`);
    }

    const row = data as StateRow | null;
    if (!row) {
      return next;
    }

    const lastReportType = this.parseReportType(row.last_report_type);

    return {
      department: row.department ?? undefined,
      lastReportType,
      lastDays: row.last_days ?? undefined,
      lastPersonId: row.last_person_id ?? undefined,
      lastPersonName: row.last_person_name ?? undefined,
    };
  }

  private async trimMessages(userId: number, limit: number): Promise<void> {
    const { data, error } = await this.client
      .from("chat_messages")
      .select("id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(limit, limit + 500);

    if (error) {
      logger.error("store_trim_messages_failed", { userId, message: error.message });
      throw new Error(`Supabase trimMessages error: ${error.message}`);
    }

    const rows = (data ?? []) as Array<{ id: number }>;
    if (rows.length === 0) {
      return;
    }

    const { error: deleteError } = await this.client
      .from("chat_messages")
      .delete()
      .in(
        "id",
        rows.map((row) => row.id)
      );

    if (deleteError) {
      logger.error("store_trim_messages_delete_failed", { userId, message: deleteError.message });
      throw new Error(`Supabase trimMessages delete error: ${deleteError.message}`);
    }
  }

  private parseReportType(value: string | null): ReportType | undefined {
    if (!value) {
      return undefined;
    }
    if (value === "overdue" || value === "not_updated_today" || value === "stale_n_days") {
      return value;
    }
    return undefined;
  }
}
