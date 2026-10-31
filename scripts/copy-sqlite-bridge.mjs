import fs from "node:fs";
import path from "node:path";

const source = path.resolve("src", "sqlite_bridge.py");
const target = path.resolve("dist", "src", "sqlite_bridge.py");
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(source, target);
