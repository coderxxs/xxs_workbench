import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { findAgentHome } from "./config";
import { loadRecords, replaceRecords } from "./database";
import { ContentItem, ContentMedia, ContentStatus, ContentType } from "./types";

const CONTENT_TYPES: ContentType[] = ["official_account", "short_video", "general"];
const CONTENT_STATUSES: ContentStatus[] = ["draft", "review", "published"];
const IMAGE_TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface ContentUploadInput {
  name: string;
  mimeType: string;
  dataBase64: string;
}

export interface ContentItemInput {
  id?: string;
  title: string;
  type: ContentType;
  status: ContentStatus;
  body: string;
  authorPersonId?: string;
  mediaIds: string[];
  uploads: ContentUploadInput[];
}

export function contentMediaRoot(home = findAgentHome()): string {
  return path.join(home, "media");
}

export function loadContentItems(home = findAgentHome()): ContentItem[] {
  const items = loadRecords<ContentItem>(home, "content_items");
  items.forEach(validateContentItem);
  return items;
}

export function saveContentItem(input: ContentItemInput, home = findAgentHome()): ContentItem {
  const items = loadContentItems(home);
  const existing = input.id ? items.find((item) => item.id === input.id) : undefined;
  if (input.id && !existing) throw new Error(`Unknown content item: ${input.id}`);
  if (!CONTENT_TYPES.includes(input.type)) throw new Error(`Unsupported content type: ${input.type}`);
  if (!CONTENT_STATUSES.includes(input.status)) throw new Error(`Unsupported content status: ${input.status}`);
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title) throw new Error("Content title is required.");
  if (!body) throw new Error("Content body is required.");
  const retained = existing?.media.filter((media) => input.mediaIds.includes(media.id)) ?? [];
  const removed = existing?.media.filter((media) => !input.mediaIds.includes(media.id)) ?? [];
  if (retained.length + input.uploads.length > 8) throw new Error("A content item may contain at most 8 images.");
  const createdFiles: string[] = [];
  const uploaded: ContentMedia[] = [];
  const now = new Date().toISOString();
  try {
    for (const upload of input.uploads) {
      const extension = IMAGE_TYPES[upload.mimeType];
      if (!extension) throw new Error(`Unsupported image type: ${upload.mimeType}`);
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(upload.dataBase64)) throw new Error("Invalid image encoding.");
      const bytes = Buffer.from(upload.dataBase64, "base64");
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("Each image must be between 1 byte and 5 MB.");
      if (!matchesImageSignature(bytes, upload.mimeType)) throw new Error(`Image data does not match ${upload.mimeType}.`);
      const mediaId = `media-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
      const storedName = `${mediaId}${extension}`;
      const root = contentMediaRoot(home);
      fs.mkdirSync(root, { recursive: true });
      const target = path.join(root, storedName);
      const temporary = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, bytes);
      fs.renameSync(temporary, target);
      createdFiles.push(target);
      uploaded.push({
        id: mediaId,
        name: path.basename(upload.name || storedName).slice(0, 160),
        mimeType: upload.mimeType,
        size: bytes.length,
        storedName,
        createdAt: now,
      });
    }

    const item: ContentItem = {
      id: existing?.id ?? `content-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`,
      title,
      type: input.type,
      status: input.status,
      body,
      authorPersonId: input.authorPersonId || undefined,
      media: [...retained, ...uploaded],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const next = existing
      ? items.map((value) => value.id === item.id ? item : value)
      : [item, ...items];
    replaceRecords(home, "content_items", next);
    removed.forEach((media) => removeMediaFile(media, home));
    return item;
  } catch (error) {
    createdFiles.forEach((file) => { try { fs.unlinkSync(file); } catch (_error) { /* best effort cleanup */ } });
    throw error;
  }
}

function matchesImageSignature(bytes: Buffer, mimeType: string): boolean {
  if (mimeType === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/gif") return bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"));
  if (mimeType === "image/webp") return bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}

export function deleteContentItem(id: string, home = findAgentHome()): ContentItem {
  const items = loadContentItems(home);
  const item = items.find((value) => value.id === id);
  if (!item) throw new Error(`Unknown content item: ${id}`);
  replaceRecords(home, "content_items", items.filter((value) => value.id !== id));
  item.media.forEach((media) => removeMediaFile(media, home));
  return item;
}

export function findContentMedia(mediaId: string, home = findAgentHome()): { media: ContentMedia; file: string } | undefined {
  for (const item of loadContentItems(home)) {
    const media = item.media.find((value) => value.id === mediaId);
    if (!media) continue;
    const root = path.resolve(contentMediaRoot(home));
    const file = path.resolve(root, media.storedName);
    if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file)) return undefined;
    return { media, file };
  }
  return undefined;
}

function removeMediaFile(media: ContentMedia, home: string): void {
  const root = path.resolve(contentMediaRoot(home));
  const file = path.resolve(root, media.storedName);
  if (file.startsWith(`${root}${path.sep}`) && fs.existsSync(file)) fs.unlinkSync(file);
}

function validateContentItem(value: ContentItem): void {
  if (
    !value || typeof value.id !== "string" || typeof value.title !== "string" ||
    !CONTENT_TYPES.includes(value.type) || !CONTENT_STATUSES.includes(value.status) ||
    typeof value.body !== "string" || !Array.isArray(value.media) ||
    typeof value.createdAt !== "string" || typeof value.updatedAt !== "string"
  ) throw new Error(`Invalid content item: ${String(value?.id || "unknown")}`);
}
