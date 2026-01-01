import { ReportType } from "../reports/types";

export type SessionState = {
  department?: string;
  lastReportType?: ReportType;
  lastDays?: number;
  lastPersonId?: string;
  lastPersonName?: string;
};

export type StoredMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
};

export interface ConversationStore {
  getRecentMessages(userId: number, limit: number): Promise<StoredMessage[]>;
  saveMessage(userId: number, role: StoredMessage["role"], content: string): Promise<void>;
  getState(userId: number): Promise<SessionState>;
  updateState(userId: number, next: SessionState): Promise<SessionState>;
}
