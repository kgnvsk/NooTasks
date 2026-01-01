import { config } from "../src/config/config";
import * as fs from "fs";
import * as path from "path";

const MARKETING_SPACE_ID = "90124836149";

interface ClickUpList {
  id: string;
  name: string;
  [key: string]: any;
}

interface ClickUpFolder {
  id: string;
  name: string;
  lists: ClickUpList[];
  [key: string]: any;
}

interface ClickUpSpace {
  id: string;
  name: string;
  features: {
    [key: string]: { enabled: boolean };
  };
  [key: string]: any;
}

const fetchClickUpAPI = async (endpoint: string): Promise<any> => {
  const url = `https://api.clickup.com/api/v2${endpoint}`;
  console.log(`Fetching: ${url}`);

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
  console.log("Fetching space details from ClickUp API...");

  try {
    // Get space details
    const space: ClickUpSpace = await fetchClickUpAPI(`/space/${MARKETING_SPACE_ID}`);
    console.log(`\nSpace: ${space.name} (${space.id})`);

    // Get folders in the space
    console.log("\nFetching folders...");
    const foldersData = await fetchClickUpAPI(`/space/${MARKETING_SPACE_ID}/folder`);
    const folders: ClickUpFolder[] = foldersData.folders || [];

    // Get folderless lists (lists directly in space)
    console.log("Fetching folderless lists...");
    const folderlessData = await fetchClickUpAPI(`/space/${MARKETING_SPACE_ID}/list`);
    const folderlessLists: ClickUpList[] = folderlessData.lists || [];

    // Collect all list IDs
    const allLists: ClickUpList[] = [...folderlessLists];
    const listsByLocation = new Map<string, string[]>();

    // Add folderless lists
    if (folderlessLists.length > 0) {
      listsByLocation.set("Space (no folder)", folderlessLists.map(l => `${l.name} (${l.id})`));
    }

    // Add lists from folders
    for (const folder of folders) {
      if (folder.lists && folder.lists.length > 0) {
        allLists.push(...folder.lists);
        listsByLocation.set(
          `Folder: ${folder.name}`,
          folder.lists.map(l => `${l.name} (${l.id})`)
        );
      }
    }

    console.log(`\n📊 Marketing Space Structure:`);
    console.log(`Total folders: ${folders.length}`);
    console.log(`Total lists: ${allLists.length}`);
    console.log(`\nLists by location:`);
    for (const [location, lists] of listsByLocation) {
      console.log(`\n  ${location}:`);
      lists.forEach(list => console.log(`    - ${list}`));
    }

    const listIds = allLists.map(l => l.id);

    // Update departments.json
    const deptPath = path.join(__dirname, "../src/config/departments.json");
    const departments = JSON.parse(fs.readFileSync(deptPath, "utf-8"));

    console.log(`\n📝 Updating departments.json...`);
    console.log(`Old list_ids (${departments.marketing.list_ids.length}): ${departments.marketing.list_ids.join(", ")}`);

    departments.marketing.list_ids = listIds;

    fs.writeFileSync(deptPath, JSON.stringify(departments, null, 2) + "\n");

    console.log(`New list_ids (${departments.marketing.list_ids.length}): ${departments.marketing.list_ids.join(", ")}`);
    console.log("\n✅ Successfully updated departments.json");
    console.log(`\n🔍 Added ${listIds.length - departments.marketing.list_ids.length} new lists`);

  } catch (error) {
    console.error("❌ Error:", error);
    throw error;
  }
};

main().catch(console.error);
