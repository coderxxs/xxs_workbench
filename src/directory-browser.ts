import fs from "fs";
import path from "path";

export interface DirectoryEntry {
  name: string;
  path: string;
}

export interface DirectoryListing {
  current?: string;
  parent?: string;
  entries: DirectoryEntry[];
}

export function listLocalDirectories(requestedPath?: string): DirectoryListing {
  if (!requestedPath) return { entries: listRoots() };

  const current = path.resolve(requestedPath);
  if (!fs.existsSync(current) || !fs.statSync(current).isDirectory()) {
    throw new Error("目录不存在或无法访问。");
  }

  const parentPath = path.dirname(current);
  const entries = fs
    .readdirSync(current, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, path: path.join(current, entry.name) }))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN", { numeric: true }));

  return {
    current,
    parent: parentPath === current ? undefined : parentPath,
    entries,
  };
}

export function suggestRepositoryId(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "")
    .toLowerCase();
}

function listRoots(): DirectoryEntry[] {
  if (process.platform !== "win32") return [{ name: "/", path: "/" }];
  const roots: DirectoryEntry[] = [];
  for (let code = 65; code <= 90; code += 1) {
    const root = `${String.fromCharCode(code)}:\\`;
    if (fs.existsSync(root)) roots.push({ name: root, path: root });
  }
  return roots;
}
