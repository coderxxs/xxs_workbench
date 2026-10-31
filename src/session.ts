export type AdministratorPermission =
  | "manage_products"
  | "manage_people"
  | "manage_workflows"
  | "manage_group_chats"
  | "run_agents"
  | "view_audit";

export interface CurrentUser {
  id: string;
  name: string;
  role: "administrator";
  roleLabel: string;
  local: true;
  permissions: AdministratorPermission[];
}

const ADMINISTRATOR_PERMISSIONS: AdministratorPermission[] = [
  "manage_products",
  "manage_people",
  "manage_workflows",
  "manage_group_chats",
  "run_agents",
  "view_audit",
];

export function currentUser(): CurrentUser {
  return {
    id: "local-administrator",
    name: process.env.DEV_AGENT_USER_NAME?.trim() || "管理员",
    role: "administrator",
    roleLabel: "本地管理员",
    local: true,
    permissions: [...ADMINISTRATOR_PERMISSIONS],
  };
}
