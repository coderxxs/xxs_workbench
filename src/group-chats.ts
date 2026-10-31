import path from "path";
import { randomBytes } from "crypto";
import { findAgentHome } from "./config";
import { loadRecords, replaceRecords } from "./database";
import { DevelopmentPerson, GroupChat, GroupChatActivity, GroupChatMessage, GroupChatSenderType } from "./types";

const GROUP_CHATS_FILE = "group-chats.json";
const ACTIVITIES: GroupChatActivity[] = ["message", "started", "completed", "confirmation"];

export interface NewGroupChat {
  name: string;
  memberIds: string[];
}

export interface NewGroupChatMessage {
  senderPersonId: string;
  senderName: string;
  senderType?: GroupChatSenderType;
  activity: GroupChatActivity;
  text: string;
  workflowId?: string;
  workflowTitle?: string;
  taskId?: string;
  taskTitle?: string;
}

export function groupChatsPath(home = findAgentHome()): string {
  return path.join(home, GROUP_CHATS_FILE);
}

export function loadGroupChats(home = findAgentHome()): GroupChat[] {
  const parsed = loadRecords<GroupChat>(home, "group_chats");
  parsed.forEach(validateGroupChat);
  return parsed;
}

export function createGroupChat(input: NewGroupChat, home = findAgentHome()): GroupChat {
  const chats = loadGroupChats(home);
  const now = new Date().toISOString();
  const chat: GroupChat = {
    id: `chat-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
    name: input.name,
    memberIds: unique(input.memberIds),
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  validateGroupChat(chat);
  chats.unshift(chat);
  writeGroupChats(chats, home);
  return chat;
}

export function postGroupChatMessage(groupChatId: string, input: NewGroupChatMessage, home = findAgentHome()): GroupChat {
  const chats = loadGroupChats(home);
  const chat = chats.find((item) => item.id === groupChatId);
  if (!chat) throw new Error(`Unknown group chat: ${groupChatId}`);
  const now = new Date().toISOString();
  const message: GroupChatMessage = {
    id: `msg-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
    senderPersonId: input.senderPersonId,
    senderName: input.senderName,
    senderType: input.senderType,
    activity: input.activity,
    text: input.text,
    workflowId: input.workflowId,
    workflowTitle: input.workflowTitle,
    taskId: input.taskId,
    taskTitle: input.taskTitle,
    createdAt: now,
  };
  validateMessage(message);
  chat.messages.push(message);
  chat.updatedAt = now;
  writeGroupChats(chats, home);
  return chat;
}

export function writeGroupChats(chats: GroupChat[], home = findAgentHome()): void {
  chats.forEach(validateGroupChat);
  replaceRecords(home, "group_chats", chats);
}

export function mentionedGroupChatMemberIds(
  text: string,
  memberIds: string[],
  people: Array<Pick<DevelopmentPerson, "id" | "name">>,
): string[] {
  const members = new Set(memberIds);
  return people
    .filter((person) => members.has(person.id) && containsMention(text, person.name))
    .map((person) => person.id);
}

function validateGroupChat(value: unknown): void {
  if (!isRecord(value)) throw new Error("Invalid group chat record.");
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    !isStringArray(value.memberIds) ||
    value.memberIds.length < 2 ||
    !Array.isArray(value.messages) ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    throw new Error(`Invalid group chat: ${String(value.id || "unknown")}`);
  }
  value.messages.forEach(validateMessage);
}

function validateMessage(value: unknown): void {
  if (!isRecord(value)) throw new Error("Invalid group chat message.");
  if (
    typeof value.id !== "string" ||
    typeof value.senderPersonId !== "string" ||
    typeof value.senderName !== "string" ||
    (value.senderType !== undefined && !["administrator", "person", "agent"].includes(value.senderType)) ||
    !ACTIVITIES.includes(value.activity as GroupChatActivity) ||
    typeof value.text !== "string" ||
    !value.text.trim() ||
    typeof value.createdAt !== "string" ||
    (value.workflowId !== undefined && typeof value.workflowId !== "string") ||
    (value.workflowTitle !== undefined && typeof value.workflowTitle !== "string") ||
    (value.taskId !== undefined && typeof value.taskId !== "string") ||
    (value.taskTitle !== undefined && typeof value.taskTitle !== "string")
  ) {
    throw new Error(`Invalid group chat message: ${String(value.id || "unknown")}`);
  }
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function containsMention(text: string, name: string): boolean {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[\\s，,。！？!?、；;：:（(])@${escapedName}(?=$|[\\s，,。！？!?、；;：:）)])`).test(text);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}
