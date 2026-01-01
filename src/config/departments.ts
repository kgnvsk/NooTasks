import { z } from "zod";
import departmentsData from "./departments.json";

const DepartmentSchema = z.object({
  list_ids: z.array(z.string()).optional(),
  space_ids: z.array(z.string()).optional(),
  aliases: z.array(z.string()).optional(),
});

const DepartmentsSchema = z.record(z.string(), DepartmentSchema);

export type Departments = z.infer<typeof DepartmentsSchema>;

export const departments: Departments = DepartmentsSchema.parse(departmentsData);
export const departmentKeys = Object.keys(departments);

const listIdIndex = new Map<string, string>();
const spaceIdIndex = new Map<string, string>();
const aliasIndex = new Map<string, string>();

for (const [department, config] of Object.entries(departments)) {
  for (const listId of config.list_ids ?? []) {
    listIdIndex.set(listId, department);
  }
  for (const spaceId of config.space_ids ?? []) {
    spaceIdIndex.set(spaceId, department);
  }
  for (const alias of config.aliases ?? []) {
    aliasIndex.set(alias.trim().toLowerCase(), department);
  }
}

export const normalizeDepartmentKey = (value?: string): string | undefined => {
  if (!value) {
    return undefined;
  }
  const lowered = value.trim().toLowerCase();
  if (!lowered) {
    return undefined;
  }
  const direct = departmentKeys.find((key) => key.toLowerCase() === lowered);
  if (direct) {
    return direct;
  }
  return aliasIndex.get(lowered);
};

export const getDepartmentFilter = (value?: string): {
  list_ids?: string[];
  space_ids?: string[];
} => {
  const key = normalizeDepartmentKey(value);
  if (!key) {
    return {};
  }
  const config = departments[key];
  return {
    list_ids: config.list_ids && config.list_ids.length > 0 ? config.list_ids : undefined,
    space_ids: config.space_ids && config.space_ids.length > 0 ? config.space_ids : undefined,
  };
};

export const getAllDepartmentFilter = (): { list_ids?: string[]; space_ids?: string[] } => {
  const listIds = new Set<string>();
  const spaceIds = new Set<string>();

  for (const config of Object.values(departments)) {
    for (const listId of config.list_ids ?? []) {
      listIds.add(listId);
    }
    for (const spaceId of config.space_ids ?? []) {
      spaceIds.add(spaceId);
    }
  }

  return {
    list_ids: listIds.size > 0 ? Array.from(listIds) : undefined,
    space_ids: spaceIds.size > 0 ? Array.from(spaceIds) : undefined,
  };
};

export const findDepartmentInText = (text?: string): string | undefined => {
  if (!text) {
    return undefined;
  }
  const lowered = text.toLowerCase();
  for (const key of departmentKeys) {
    if (lowered.includes(key.toLowerCase())) {
      return key;
    }
  }
  for (const [alias, key] of aliasIndex.entries()) {
    if (alias && lowered.includes(alias)) {
      return key;
    }
  }
  return undefined;
};

export const findDepartmentByListId = (listId?: string): string | undefined => {
  if (!listId) {
    return undefined;
  }
  return listIdIndex.get(String(listId));
};

export const findDepartmentBySpaceId = (spaceId?: string): string | undefined => {
  if (!spaceId) {
    return undefined;
  }
  return spaceIdIndex.get(String(spaceId));
};
