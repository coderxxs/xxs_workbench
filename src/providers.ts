import http from "http";
import https from "https";
import { ProviderConfig } from "./types";

export interface ChatRequest {
  prompt: string;
  model?: string;
  system?: string;
  timeoutMs?: number;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AgentRequest extends ChatRequest {
  tools: AgentTool[];
  execute: (name: string, argumentsValue: Record<string, unknown>) => Promise<unknown>;
  maxTurns?: number;
}

export async function chat(provider: ProviderConfig, request: ChatRequest): Promise<string> {
  const apiKey = process.env[provider.apiKeyEnv];
  if (!apiKey) {
    throw new Error(`Missing API key environment variable: ${provider.apiKeyEnv}`);
  }
  const model = request.model ?? provider.defaultModel;

  if (provider.type === "openai-responses") {
    const data = await postJson(
      joinUrl(provider.baseUrl, "responses"),
      apiKey,
      {
        model,
        instructions: request.system,
        input: request.prompt,
      },
      request.timeoutMs,
    );
    return extractResponsesText(data);
  }

  const messages: Array<{ role: string; content: string }> = [];
  if (request.system) messages.push({ role: "system", content: request.system });
  messages.push({ role: "user", content: request.prompt });
  const data = await postJson(
    joinUrl(provider.baseUrl, "chat/completions"),
    apiKey,
    { model, messages },
    request.timeoutMs,
  );
  return extractChatCompletionsText(data);
}

export async function runAgent(provider: ProviderConfig, request: AgentRequest): Promise<string> {
  if (request.tools.length === 0) return chat(provider, request);
  const apiKey = process.env[provider.apiKeyEnv];
  if (!apiKey) {
    throw new Error(`Missing API key environment variable: ${provider.apiKeyEnv}`);
  }
  return provider.type === "openai-responses"
    ? runResponsesAgent(provider, apiKey, request)
    : runCompatibleAgent(provider, apiKey, request);
}

async function runResponsesAgent(
  provider: ProviderConfig,
  apiKey: string,
  request: AgentRequest,
): Promise<string> {
  const model = request.model ?? provider.defaultModel;
  const tools = request.tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: true,
  }));
  let input: unknown = request.prompt;
  let previousResponseId: string | undefined;

  for (let turn = 0; turn < (request.maxTurns ?? 8); turn += 1) {
    const response = await postJson(
      joinUrl(provider.baseUrl, "responses"),
      apiKey,
      {
        model,
        instructions: request.system,
        input,
        previous_response_id: previousResponseId,
        tools,
        parallel_tool_calls: false,
      },
      request.timeoutMs,
    );
    if (!isRecord(response) || typeof response.id !== "string" || !Array.isArray(response.output)) {
      throw new Error("Unexpected Responses API agent payload.");
    }
    const calls = response.output.filter(
      (item): item is Record<string, any> => isRecord(item) && item.type === "function_call",
    );
    if (calls.length === 0) {
      const text = collectResponsesText(response);
      if (text) return text;
      throw new Error("Agent returned neither text nor a function call.");
    }

    const outputs: Array<Record<string, unknown>> = [];
    for (const call of calls) {
      const name = typeof call.name === "string" ? call.name : "";
      const callId = typeof call.call_id === "string" ? call.call_id : "";
      const argumentsValue = parseToolArguments(call.arguments);
      const result = await executeSafely(request, name, argumentsValue);
      outputs.push({
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(result),
      });
    }
    previousResponseId = response.id;
    input = outputs;
  }
  throw new Error(`Agent exceeded its ${request.maxTurns ?? 8}-turn tool limit.`);
}

async function runCompatibleAgent(
  provider: ProviderConfig,
  apiKey: string,
  request: AgentRequest,
): Promise<string> {
  const model = request.model ?? provider.defaultModel;
  const tools = request.tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      strict: true,
    },
  }));
  const messages: Array<Record<string, unknown>> = [];
  if (request.system) messages.push({ role: "system", content: request.system });
  messages.push({ role: "user", content: request.prompt });

  for (let turn = 0; turn < (request.maxTurns ?? 8); turn += 1) {
    const response = await postJson(
      joinUrl(provider.baseUrl, "chat/completions"),
      apiKey,
      { model, messages, tools, parallel_tool_calls: false },
      request.timeoutMs,
    );
    if (!isRecord(response) || !Array.isArray(response.choices) || response.choices.length === 0) {
      throw new Error("Unexpected Chat Completions agent payload.");
    }
    const choice = response.choices[0];
    if (!isRecord(choice) || !isRecord(choice.message)) {
      throw new Error("Chat Completions agent returned no message.");
    }
    const message = choice.message;
    messages.push(message);
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (calls.length === 0) {
      if (typeof message.content === "string" && message.content) return message.content;
      throw new Error("Agent returned neither text nor a function call.");
    }

    for (const call of calls) {
      if (!isRecord(call) || !isRecord(call.function)) continue;
      const name = typeof call.function.name === "string" ? call.function.name : "";
      const argumentsValue = parseToolArguments(call.function.arguments);
      const result = await executeSafely(request, name, argumentsValue);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }
  throw new Error(`Agent exceeded its ${request.maxTurns ?? 8}-turn tool limit.`);
}

async function executeSafely(
  request: AgentRequest,
  name: string,
  argumentsValue: Record<string, unknown>,
): Promise<unknown> {
  try {
    return await request.execute(name, argumentsValue);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function parseToolArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function joinUrl(baseUrl: string, suffix: string): string {
  return `${baseUrl.replace(/\/$/, "")}/${suffix.replace(/^\//, "")}`;
}

function postJson(
  urlText: string,
  apiKey: string,
  payload: Record<string, unknown>,
  timeoutMs = 120_000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const target = new URL(urlText);
    const body = JSON.stringify(payload);
    const transport = target.protocol === "http:" ? http : https;
    const request = transport.request(
      target,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          let parsed: unknown;
          try {
            parsed = responseBody ? JSON.parse(responseBody) : {};
          } catch {
            reject(new Error(`Provider returned invalid JSON (HTTP ${response.statusCode ?? 0}).`));
            return;
          }
          if ((response.statusCode ?? 500) >= 400) {
            reject(new Error(`Provider request failed (HTTP ${response.statusCode}): ${providerError(parsed)}`));
            return;
          }
          resolve(parsed);
        });
      },
    );
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`Provider request timed out after ${timeoutMs}ms.`)));
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

function extractResponsesText(data: unknown): string {
  if (!isRecord(data)) throw new Error("Unexpected Responses API payload.");
  const text = collectResponsesText(data);
  if (text) return text;
  throw new Error("Responses API returned no text output.");
}

function collectResponsesText(data: Record<string, any>): string {
  if (typeof data.output_text === "string") return data.output_text;
  if (Array.isArray(data.output)) {
    const texts: string[] = [];
    for (const item of data.output) {
      if (!isRecord(item) || !Array.isArray(item.content)) continue;
      for (const content of item.content) {
        if (isRecord(content) && typeof content.text === "string") texts.push(content.text);
      }
    }
    if (texts.length) return texts.join("\n");
  }
  return "";
}

function extractChatCompletionsText(data: unknown): string {
  if (!isRecord(data) || !Array.isArray(data.choices) || data.choices.length === 0) {
    throw new Error("Unexpected Chat Completions payload.");
  }
  const choice = data.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message) || typeof choice.message.content !== "string") {
    throw new Error("Chat Completions API returned no text output.");
  }
  return choice.message.content;
}

function providerError(data: unknown): string {
  if (isRecord(data) && isRecord(data.error) && typeof data.error.message === "string") {
    return data.error.message;
  }
  return JSON.stringify(data).slice(0, 500);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}
