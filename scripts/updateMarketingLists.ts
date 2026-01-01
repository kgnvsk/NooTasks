import { ClickUpMcpClient } from "../src/mcp/clickupClient";
import { config } from "../src/config/config";
import * as fs from "fs";
import * as path from "path";

const MARKETING_SPACE_ID = "90124836149";

interface List {
  id: string;
  name: string;
  [key: string]: any;
}

interface Folder {
  id: string;
  name: string;
  lists?: List[];
  [key: string]: any;
}

interface Space {
  id: string;
  name: string;
  folders?: Folder[];
  lists?: List[];
  [key: string]: any;
}

const extractAllListIds = (data: any): string[] => {
  const listIds: string[] = [];

  const processSpace = (space: Space) => {
    // Lists directly in space
    if (space.lists && Array.isArray(space.lists)) {
      space.lists.forEach((list: List) => {
        if (list.id) listIds.push(list.id);
      });
    }

    // Lists in folders
    if (space.folders && Array.isArray(space.folders)) {
      space.folders.forEach((folder: Folder) => {
        if (folder.lists && Array.isArray(folder.lists)) {
          folder.lists.forEach((list: List) => {
            if (list.id) listIds.push(list.id);
          });
        }
      });
    }
  };

  // Handle if data is a space object
  if (data.id && data.id === MARKETING_SPACE_ID) {
    processSpace(data);
  }

  // Handle if data is an array of spaces
  if (Array.isArray(data)) {
    data.forEach((item: any) => {
      if (item.id === MARKETING_SPACE_ID) {
        processSpace(item);
      }
    });
  }

  // Handle if data has spaces property
  if (data.spaces && Array.isArray(data.spaces)) {
    data.spaces.forEach((space: Space) => {
      if (space.id === MARKETING_SPACE_ID) {
        processSpace(space);
      }
    });
  }

  return listIds;
};

const main = async () => {
  console.log("Connecting to ClickUp MCP...");
  const clickup = new ClickUpMcpClient();

  try {
    // First, list available tools
    console.log("Listing available MCP tools...");
    const tools = await clickup.listTools();
    console.log("Available tools:", tools.map((t: any) => t.name));

    // Get all tasks from marketing space and extract list IDs
    console.log(`\nQuerying all tasks from marketing space ${MARKETING_SPACE_ID}...`);

    const tasksData = await clickup.callTool("get_workspace_tasks", {
      space_ids: [MARKETING_SPACE_ID],
      include_closed: false
    });

    console.log(`Received ${Array.isArray(tasksData) ? tasksData.length : 0} tasks`);

    // Extract unique list IDs from tasks
    const uniqueLists = new Set<string>();
    const listNames = new Map<string, string>();

    if (tasksData && Array.isArray(tasksData)) {
      tasksData.forEach((task: any) => {
        if (task.list && task.list.id) {
          uniqueLists.add(task.list.id);
          if (task.list.name) {
            listNames.set(task.list.id, task.list.name);
          }
        }
      });
    }

    const listIds = Array.from(uniqueLists);

    console.log(`\nFound ${listIds.length} unique lists:`);
    listIds.forEach(id => {
      console.log(`  - ${id}: ${listNames.get(id) || 'Unknown'}`);
    });

    console.log(`\nFound ${listIds.length} lists:`, listIds);

    // Update departments.json
    const deptPath = path.join(__dirname, "../src/config/departments.json");
    const departments = JSON.parse(fs.readFileSync(deptPath, "utf-8"));

    console.log(`\nUpdating departments.json...`);
    console.log(`Old list_ids (${departments.marketing.list_ids.length}):`, departments.marketing.list_ids);

    departments.marketing.list_ids = listIds;

    fs.writeFileSync(deptPath, JSON.stringify(departments, null, 2) + "\n");

    console.log(`New list_ids (${departments.marketing.list_ids.length}):`, departments.marketing.list_ids);
    console.log("\n✅ Successfully updated departments.json");

  } catch (error) {
    console.error("Error:", error);
    throw error;
  } finally {
    await clickup.close();
  }
};

main().catch(console.error);
