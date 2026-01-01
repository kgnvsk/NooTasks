import { writeFileSync } from "fs";
import { join } from "path";
import { logger } from "../utils/logger";
import { ClickUpMcpClient } from "../mcp/clickupClient";

/**
 * Auto-update departments.json and members.json from ClickUp API
 */
export async function updateConfigs(mcp: ClickUpMcpClient): Promise<void> {
  try {
    logger.info("config_update_start");
    
    // Update members (callTool will ensure connection automatically)
    const membersResult: any = await mcp.callTool("get_workspace_members", {});
    const members = membersResult?.members || [];
    const membersPath = join(__dirname, "members.json");
    writeFileSync(membersPath, JSON.stringify(members, null, 2));
    logger.info("config_members_updated", { count: members.length });
    
    // Update departments from hierarchy
    const hierarchyResult: any = await mcp.callTool("get_workspace_hierarchy", {});
    const spaces = Array.isArray(hierarchyResult) ? hierarchyResult : [hierarchyResult];
    
    const departments: any = {};
    
    for (const space of spaces) {
      const spaceName = space.name?.toLowerCase() || '';
      let deptKey: string | null = null;
      
      // Map space names to department keys
      if (spaceName.includes('маркетинг') || spaceName.includes('marketing')) deptKey = 'marketing';
      else if (spaceName.includes('адмін') || spaceName.includes('admin')) deptKey = 'admin';
      else if (spaceName.includes('фінанс') || spaceName.includes('finance')) deptKey = 'finance';
      else if (spaceName.includes('hr') || spaceName.includes('найм')) deptKey = 'hr';
      else if (spaceName.includes('продаж') || spaceName.includes('sales')) deptKey = 'sales';
      else if (spaceName.includes('склад') || spaceName.includes('warehouse')) deptKey = 'warehouse';
      else if (spaceName.includes('виробництв') || spaceName.includes('production')) deptKey = 'production';
      else if (spaceName.includes('проєкт') || spaceName.includes('projects')) deptKey = 'projects';
      
      if (deptKey) {
        const listIds: string[] = [];
        
        // Extract list IDs from folders
        const folders = space.folders || [];
        for (const folder of folders) {
          const lists = folder.lists || [];
          for (const list of lists) {
            if (list.id) listIds.push(list.id);
          }
        }
        
        // Extract list IDs from space-level lists
        const spaceLists = space.lists || [];
        for (const list of spaceLists) {
          if (list.id) listIds.push(list.id);
        }
        
        departments[deptKey] = {
          space_id: space.id,
          list_ids: listIds
        };
      }
    }
    
    const deptPath = join(__dirname, "departments.json");
    writeFileSync(deptPath, JSON.stringify(departments, null, 2));
    logger.info("config_departments_updated", { departments: Object.keys(departments) });
    
  } catch (error) {
    logger.error("config_update_failed", { error: String(error) });
  }
}

