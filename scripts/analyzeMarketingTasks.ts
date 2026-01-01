import { config } from "../src/config/config";
import departments from "../src/config/departments.json";

const MARKETING_SPACE_ID = "90124836149";

interface Task {
  id: string;
  name: string;
  status: {
    status: string;
    type: string;
    color: string;
  };
  due_date: string | null;
  archived: boolean;
  list: { id: string; name: string };
  [key: string]: any;
}

const fetchClickUpAPI = async (endpoint: string): Promise<any> => {
  const url = `https://api.clickup.com/api/v2${endpoint}`;

  const response = await fetch(url, {
    headers: {
      Authorization: config.clickup.apiKey,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ClickUp API error ${response.status}: ${text}`);
  }

  return response.json();
};

const main = async () => {
  console.log("Analyzing all marketing tasks via ClickUp REST API...\n");

  try {
    const marketing = (departments as any).marketing;
    const listIds = marketing.list_ids;

    console.log(`Marketing space: ${MARKETING_SPACE_ID}`);
    console.log(`Configured lists (${listIds.length}): ${listIds.join(", ")}\n`);

    const allTasks: Task[] = [];
    const statusCounts = new Map<string, number>();
    const archivedCount = { archived: 0, active: 0 };

    // Fetch tasks from each list
    for (const listId of listIds) {
      console.log(`Fetching tasks from list ${listId}...`);

      const response = await fetchClickUpAPI(
        `/list/${listId}/task?archived=false&subtasks=true`
      );

      const tasks: Task[] = response.tasks || [];
      console.log(`  Found ${tasks.length} active tasks`);

      allTasks.push(...tasks);

      // Count statuses
      for (const task of tasks) {
        const statusName = task.status?.status || "Unknown";
        statusCounts.set(statusName, (statusCounts.get(statusName) || 0) + 1);
        if (task.archived) {
          archivedCount.archived++;
        } else {
          archivedCount.active++;
        }
      }

      // Also check archived tasks
      const archivedResponse = await fetchClickUpAPI(
        `/list/${listId}/task?archived=true&subtasks=true`
      );

      const archivedTasks: Task[] = archivedResponse.tasks || [];
      console.log(`  Found ${archivedTasks.length} archived tasks\n`);
    }

    console.log(`\n📊 Total Active Tasks: ${allTasks.length}\n`);

    console.log("Status breakdown:");
    const sortedStatuses = Array.from(statusCounts.entries()).sort((a, b) => b[1] - a[1]);
    for (const [status, count] of sortedStatuses) {
      console.log(`  ${status}: ${count}`);
    }

    console.log(`\nArchived: ${archivedCount.archived} | Active: ${archivedCount.active}`);

    // Look for specific tasks the user mentioned
    const searchTerms = [
      "опис посади",
      "подарункові сертифікати",
      "регламент партнерства",
      "Рутинні щоденні",
      "Перегляд запитів",
      "Публікація контенту",
    ];

    console.log(`\n🔍 Searching for specific tasks:`);
    for (const term of searchTerms) {
      const found = allTasks.filter((t) =>
        t.name.toLowerCase().includes(term.toLowerCase())
      );
      if (found.length > 0) {
        console.log(`\n  "${term}":`);
        found.forEach((t) => {
          console.log(
            `    ✅ ${t.name} [${t.status.status}] (due: ${t.due_date ? new Date(Number(t.due_date)).toISOString().split("T")[0] : "none"}) - List: ${t.list.name}`
          );
        });
      } else {
        console.log(`\n  "${term}": ❌ NOT FOUND`);
      }
    }

    // Find tasks without due dates
    const noDueDateTasks = allTasks.filter((t) => !t.due_date);
    console.log(`\n📌 Tasks without due date: ${noDueDateTasks.length} / ${allTasks.length}`);

    // Show first 10 tasks without due date
    console.log(`\nFirst 10 tasks without due date:`);
    noDueDateTasks.slice(0, 10).forEach((t) => {
      console.log(`  - ${t.name} [${t.status.status}]`);
    });

  } catch (error) {
    console.error("❌ Error:", error);
    throw error;
  }
};

main().catch(console.error);
