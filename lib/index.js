// dsh-video-gen — DeepSeek Harness 宿主插件
//
// 文本 → 视频：调用 OpenAI/FastVideo 兼容的 /v1/videos 异步任务接口，
// 轮询完成、下载 MP4 到会话工作目录，按需移除音轨，并通过宿主 HTTP 路由
// 提供浏览器内联播放地址。
//
// 默认端点：http://ai9700:8080/upstream/MiniMax-H3-Video/v1
// 插件会自动补 /videos，实际请求 .../v1/videos
// 模型默认：fastvideo-fasth3-8-step-v2
// 分辨率默认：1344x768（该模型的上限画布）
//
// 服务端只接受这些字段（实测 1.13.0 / radiance）：
//   prompt, model, seconds, size, seed, sampler
// 音频由 H3 模型随视频一起生成，服务端没有关闭音频的开关；
// 因此 withAudio=false 会在下载后用 ffmpeg 移除 AAC 音轨。

import { SettingsConflictError } from "@deepseek-ai/dsh-settings";
import { defineTool } from "@deepseek-ai/dsh-tools";
import z from "@deepseek-ai/schemastery";

import { createReadStream } from "node:fs";
import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";

import {
  MODEL_SIZE_LIMITS,
  SAMPLERS,
  SIZE_PRESETS,
  buildVideoPayload,
  composePrompt,
  deriveHealthUrl,
  deriveModelsUrl,
  formatApiError,
  isTerminalJob,
  normalizeEndpoint,
  normalizeSampler,
  normalizeSeconds,
  normalizeSeed,
  normalizeSize,
  outputFileName,
  sleep,
} from "./core.js";

const PLUGIN_VERSION = "0.2.0";
const NS = "video-gen";
const BRIDGE_PREFIX = "/api/dsh-video-gen";
const ARTIFACT_PREFIX = "/api/dsh-video-gen/artifacts";
const DEFAULT_ENDPOINT = "http://ai9700:8080/upstream/MiniMax-H3-Video/v1";
const DEFAULT_MODEL = "fastvideo-fasth3-8-step-v2";
const DEFAULT_OUTPUT_DIR = ".dsh-video-gen";
const MAX_PROMPT_CHARS = 8192;
const DEFAULT_POSITIVE_PROMPT =
  "shot on 35mm film, Kodak Portra 400, soft overcast daylight, matte skin with visible pores and fine facial hair, natural lip texture, small skin imperfections, muted earthy colour grade, low contrast, soft highlight roll-off, subtle film grain, documentary realism, no retouching";
const DEFAULT_NEGATIVE_PROMPT =
  "oil painting, ultra detailed, 8k, hyperrealistic, cinematic glow, rim light, glossy, flawless/beauty retouched skin, HDR, dramatic lighting";

//#region 配置

function resolveConfig(config) {
  if (config === null || typeof config !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(config)) {
    out[key] = value !== null && typeof value === "object" && typeof value.get === "function" ? value.get() : value;
  }
  return out;
}

function normalizeConfig(raw) {
  const cfg = raw && typeof raw === "object" ? raw : {};
  return {
    enabled: cfg.enabled !== false,
    endpoint: String(cfg.endpoint || DEFAULT_ENDPOINT).trim() || DEFAULT_ENDPOINT,
    apiKey: typeof cfg.apiKey === "string" ? cfg.apiKey : "",
    model: String(cfg.model ?? DEFAULT_MODEL).trim(),
    size: String(cfg.size || "1344x768").trim(),
    seconds: Number(cfg.seconds ?? 5),
    audio: cfg.audio === "strip" ? "strip" : "keep",
    sampler: cfg.sampler === "euler" ? "euler" : "res_multistep",
    positivePrompt: String(cfg.positivePrompt ?? DEFAULT_POSITIVE_PROMPT).trim(),
    negativePrompt: String(cfg.negativePrompt ?? DEFAULT_NEGATIVE_PROMPT).trim(),
    seed: cfg.seed === undefined || cfg.seed === null ? null : Number(cfg.seed),
    outputDir: String(cfg.outputDir || DEFAULT_OUTPUT_DIR).trim() || DEFAULT_OUTPUT_DIR,
    timeoutSec: Number(cfg.timeoutSec ?? 900),
    pollIntervalSec: Number(cfg.pollIntervalSec ?? 2),
    deleteRemote: cfg.deleteRemote !== false,
  };
}

function publicConfig(cfg) {
  const { apiKey, ...rest } = cfg;
  return rest;
}

const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  endpoint: z.string().default(DEFAULT_ENDPOINT).volatile(),
  apiKey: z.string().role("secret").volatile(),
  model: z.string().default(DEFAULT_MODEL).volatile(),
  size: z.string().default("1344x768").volatile(),
  seconds: z.number().default(5).volatile(),
  audio: z.string().default("keep").volatile(), // keep | strip
  sampler: z.string().default("res_multistep").volatile(), // euler | res_multistep
  positivePrompt: z.string().default(DEFAULT_POSITIVE_PROMPT).volatile(),
  negativePrompt: z.string().default(DEFAULT_NEGATIVE_PROMPT).volatile(),
  seed: z.number().volatile(), // 留空 = 随机
  outputDir: z.string().default(DEFAULT_OUTPUT_DIR).volatile(),
  timeoutSec: z.number().default(900).volatile(),
  pollIntervalSec: z.number().default(2).volatile(),
  deleteRemote: z.boolean().default(true).volatile(),
});

//#endregion
//#region HTTP helpers

function writeJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
  });
  res.end(text);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) return undefined;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return undefined;
  }
}

function requestHeaders(apiKey, json) {
  const headers = {};
  if (json) headers["content-type"] = "application/json";
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
    headers["x-api-key"] = apiKey;
  }
  return headers;
}

async function readJsonResponse(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function fetchWithTimeout(url, options, timeoutMs, signal) {
  if (signal?.aborted) throw signal.reason || new Error("aborted");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  const onAbort = () => controller.abort(signal.reason || new Error("aborted"));
  if (signal) signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (signal?.aborted) throw signal.reason || new Error("aborted");
    if (controller.signal.aborted) throw new Error(`请求超时（${timeoutMs}ms）：${url}`);
    throw error;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

function videoJobUrl(endpoint, id) {
  const url = new URL(endpoint);
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/${encodeURIComponent(id)}`;
  return url.toString();
}

function videoContentUrl(endpoint, id) {
  const url = new URL(videoJobUrl(endpoint, id));
  url.pathname = `${url.pathname}/content`;
  return url.toString();
}

//#endregion
//#region 生成流程

async function createVideoJob({ endpoint, apiKey, payload, signal }) {
  const res = await fetchWithTimeout(
    endpoint,
    { method: "POST", headers: requestHeaders(apiKey, true), body: JSON.stringify(payload) },
    60_000,
    signal
  );
  const body = await readJsonResponse(res);
  if (!res.ok) throw new Error(`提交视频任务失败：${formatApiError(res.status, body)}`);
  if (!body || typeof body !== "object" || typeof body.id !== "string") {
    throw new Error("提交视频任务失败：服务端未返回 video id");
  }
  return body;
}

async function getVideoJob({ endpoint, apiKey, id, signal }) {
  const res = await fetchWithTimeout(videoJobUrl(endpoint, id), { method: "GET", headers: requestHeaders(apiKey, false) }, 30_000, signal);
  const body = await readJsonResponse(res);
  if (!res.ok) throw new Error(`读取视频任务失败：${formatApiError(res.status, body)}`);
  if (!body || typeof body !== "object") throw new Error("读取视频任务失败：服务端返回内容不是对象");
  return body;
}

async function pollVideoJob({ endpoint, apiKey, id, signal, timeoutSec, pollIntervalSec, logger }) {
  const deadline = Date.now() + Math.max(1, timeoutSec) * 1000;
  let job = null;
  while (true) {
    job = await getVideoJob({ endpoint, apiKey, id, signal });
    if (isTerminalJob(job)) return job;
    if (Date.now() >= deadline) {
      throw new Error(
        `等待视频生成超时（${timeoutSec}s）。任务 ${id} 可能仍在服务端运行；可稍后用 GET ${videoJobUrl(endpoint, id)} 查看进度`
      );
    }
    logger?.info?.(`video-gen: job ${id} ${job.status} ${job.progress ?? 0}%`);
    await sleep(Math.max(1, pollIntervalSec) * 1000, signal);
  }
}

async function downloadVideoFile({ endpoint, apiKey, id, destPath, signal }) {
  const res = await fetchWithTimeout(videoContentUrl(endpoint, id), { method: "GET", headers: requestHeaders(apiKey, false) }, 120_000, signal);
  if (!res.ok) {
    const body = await readJsonResponse(res);
    throw new Error(`下载视频失败：${formatApiError(res.status, body)}`);
  }
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length === 0) throw new Error("下载视频失败：服务端返回空文件");
  await writeFile(destPath, data);
  return data.length;
}

async function deleteRemoteJob({ endpoint, apiKey, id, signal }) {
  const res = await fetchWithTimeout(videoJobUrl(endpoint, id), { method: "DELETE", headers: requestHeaders(apiKey, false) }, 20_000, signal);
  if (!res.ok) {
    const body = await readJsonResponse(res);
    throw new Error(`删除远端任务失败：${formatApiError(res.status, body)}`);
  }
}

function runFfmpeg(args, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    const onAbort = () => {
      child.kill("SIGTERM");
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    child.on("error", (error) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.on("close", (code) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      if (signal?.aborted) {
        reject(signal.reason || new Error("aborted"));
        return;
      }
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg 退出码 ${code}：${stderr.slice(-500)}`));
    });
  });
}

async function stripAudioTrack(filePath, signal) {
  const tempPath = `${filePath}.${randomBytes(4).toString("hex")}.tmp.mp4`;
  try {
    await runFfmpeg(
      ["-y", "-i", filePath, "-map", "0:v:0", "-c:v", "copy", "-an", "-movflags", "+faststart", tempPath],
      signal
    );
    await rename(tempPath, filePath);
    return { ok: true, warning: "" };
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    if (signal?.aborted) throw signal.reason || new Error("aborted");
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      warning: `音频移除失败（文件仍含音轨）：${message}。请确认 ffmpeg 已安装并在 PATH 中。`,
    };
  }
}

async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function uniqueOutputPath(dir, fileName) {
  const candidate = path.join(dir, fileName);
  if (!(await pathExists(candidate))) return candidate;
  const ext = path.extname(fileName);
  const stem = fileName.slice(0, fileName.length - ext.length);
  for (let index = 1; index < 1000; index += 1) {
    const next = path.join(dir, `${stem}-${index}${ext}`);
    if (!(await pathExists(next))) return next;
  }
  return path.join(dir, `${stem}-${Date.now()}${ext}`);
}

//#endregion
//#region 视频流路由

function handleArtifactRequest(req, res, artifacts) {
  (async () => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        writeJson(res, 405, { ok: false, code: "method-not-allowed", message: "use GET or HEAD" });
        return;
      }
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (!url.pathname.startsWith(`${ARTIFACT_PREFIX}/`)) {
        writeJson(res, 404, { ok: false, code: "not-found", message: "artifact not found" });
        return;
      }
      const token = url.pathname.slice(ARTIFACT_PREFIX.length + 1);
      if (!token || token.includes("/")) {
        writeJson(res, 404, { ok: false, code: "not-found", message: "artifact not found" });
        return;
      }
      const entry = artifacts.get(token);
      if (!entry) {
        writeJson(res, 404, { ok: false, code: "not-found", message: "artifact not found" });
        return;
      }
      const info = await stat(entry.path);
      if (!info.isFile()) {
        writeJson(res, 404, { ok: false, code: "not-found", message: "artifact file not found" });
        return;
      }
      const total = info.size;
      const range = req.headers.range;
      let start = 0;
      let end = total - 1;
      let status = 200;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/u.exec(String(range).trim());
        if (!match) {
          res.writeHead(416, { "content-type": "application/json", "content-range": `bytes */${total}` });
          res.end(JSON.stringify({ ok: false, code: "invalid-range", message: "invalid Range header" }));
          return;
        }
        if (match[1] === "") {
          const suffix = Number(match[2]);
          if (!Number.isInteger(suffix) || suffix <= 0) {
            res.writeHead(416, { "content-type": "application/json", "content-range": `bytes */${total}` });
            res.end(JSON.stringify({ ok: false, code: "invalid-range", message: "invalid suffix Range" }));
            return;
          }
          start = Math.max(0, total - suffix);
          end = total - 1;
        } else {
          start = Number(match[1]);
          end = match[2] === "" ? total - 1 : Number(match[2]);
        }
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
          res.writeHead(416, { "content-type": "application/json", "content-range": `bytes */${total}` });
          res.end(JSON.stringify({ ok: false, code: "invalid-range", message: "invalid Range header" }));
          return;
        }
        if (start >= total) {
          res.writeHead(416, { "content-type": "application/json", "content-range": `bytes */${total}` });
          res.end(JSON.stringify({ ok: false, code: "invalid-range", message: "range starts past end" }));
          return;
        }
        end = Math.min(end, total - 1);
        status = 206;
      }
      const headers = {
        "content-type": entry.mime || "video/mp4",
        "content-length": String(end - start + 1),
        "accept-ranges": "bytes",
        "cache-control": "private, max-age=86400",
        "content-disposition": `inline; filename="${String(entry.name || "video.mp4").replace(/["\\]/gu, "-")}"`,
      };
      if (status === 206) headers["content-range"] = `bytes ${start}-${end}/${total}`;
      res.writeHead(status, headers);
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      createReadStream(entry.path, { start, end }).pipe(res);
    } catch (error) {
      if (!res.headersSent) {
        writeJson(res, 500, { ok: false, code: "internal", message: error instanceof Error ? error.message : String(error) });
      } else {
        res.destroy();
      }
    }
  })().catch(() => {});
}

//#endregion
//#region 设置桥

function makeBridgeRoutes({ describe, save, test }) {
  const wrap = (handler) => async (req, res) => {
    if (req.method !== "POST") {
      writeJson(res, 405, { ok: false, code: "method-not-allowed", message: "use POST" });
      return;
    }
    try {
      const body = await readJsonBody(req);
      if (body === undefined) {
        writeJson(res, 400, { ok: false, code: "bad-request", message: "malformed JSON body" });
        return;
      }
      writeJson(res, 200, await handler(body));
    } catch (error) {
      writeJson(res, 500, { ok: false, code: "internal", message: error instanceof Error ? error.message : String(error) });
    }
  };
  return [
    { kind: "exact", path: `${BRIDGE_PREFIX}/describe`, handler: wrap(describe) },
    { kind: "exact", path: `${BRIDGE_PREFIX}/save`, handler: wrap(save) },
    { kind: "exact", path: `${BRIDGE_PREFIX}/test`, handler: wrap(test) },
  ];
}

//#endregion
//#region 工具

function buildVideoTool({ current, publicBase, registerArtifact, logger }) {
  return defineTool({
    name: "video_generate",
    description:
      "Generate a video from a text prompt with the configured OpenAI/FastVideo-compatible /v1/videos endpoint (default http://ai9700:8080/upstream/MiniMax-H3-Video/v1; the plugin appends /videos). Submits an async job, polls until completion, downloads the MP4 into the session workspace, optionally removes the audio track, and returns the local file path plus a browser-playable URL. H3 generates video and audio together; withAudio=false removes audio locally with ffmpeg. Resolution is WIDTHxHEIGHT, sides multiples of 32, each side at least 256, total pixels at most 1,032,192, and aspect ratio at most 4:1 (default 1344x768). The effective prompt is composed as positivePrompt + prompt + 'Avoid: negativePrompt'; H3 accepts only a single prompt field, so the negative list is a text constraint rather than separate guidance.",
    parameters: {
      prompt: {
        type: "string",
        required: true,
        description: "Video prompt: subject, motion, camera, lighting and style. The plugin prepends its positive prompt and appends the negative constraints.",
      },
      positivePrompt: {
        type: "string",
        description: "Optional positive style/system prompt for this call; overrides the plugin setting. Prepended to prompt. Empty string disables it.",
      },
      negativePrompt: {
        type: "string",
        description: "Optional negative constraints for this call; overrides the plugin setting. Appended as 'Avoid: ...'. Empty string disables it.",
      },
      size: {
        type: "string",
        description: "Resolution WIDTHxHEIGHT, e.g. 1344x768 or 768x1344. Defaults to the plugin setting.",
      },
      seconds: {
        type: "integer",
        description: "Requested duration in seconds (0 = model default). The server snaps to its legal frame grid.",
      },
      withAudio: {
        type: "boolean",
        description: "Keep the generated audio track (true) or remove it with ffmpeg after download (false). Defaults to the plugin setting.",
      },
      seed: {
        type: "integer",
        description: "Random seed for reproducibility. Omit for a random seed.",
      },
      model: {
        type: "string",
        description: "Model id advertised by the endpoint. Defaults to the plugin setting.",
      },
      sampler: {
        type: "string",
        enum: ["euler", "res_multistep"],
        description: "Sampler; res_multistep is the default two-step sampler.",
      },
      fileName: {
        type: "string",
        description: "Optional output file name (basename only; .mp4 is added automatically).",
      },
    },
    output: {
      schema: {
        type: "object",
        properties: {
          id: { type: "string" },
          status: { type: "string" },
          model: { type: "string" },
          prompt: { type: "string" },
          effectivePrompt: { type: "string" },
          positivePrompt: { type: "string" },
          negativePrompt: { type: "string" },
          size: { type: "string" },
          seconds: { type: "number" },
          withAudio: { type: "boolean" },
          audioStripped: { type: "boolean" },
          filePath: { type: "string" },
          videoUrl: { type: "string" },
          seed: { type: "number" },
          elapsedSeconds: { type: "number" },
          bytes: { type: "number" },
          warning: { type: "string" },
        },
        additionalProperties: false,
      },
      render(args, value) {
        const audioLine = value.withAudio
          ? "保留"
          : value.audioStripped
            ? "已移除"
            : "移除失败（文件仍含音轨）";
        const lines = [
          `视频生成完成：${value.filePath}`,
          `任务 ${value.id} · 状态 ${value.status}`,
          `分辨率 ${value.size} · 时长 ${value.seconds}s · 模型 ${value.model}`,
          `音频：${audioLine}`,
          `浏览器预览：${value.videoUrl}`,
        ];
        if (value.effectivePrompt && value.effectivePrompt !== value.prompt) {
          lines.push("系统提示词：已合成（正向提示词 + 负向约束）");
        }
        if (value.warning) lines.push(`注意：${value.warning}`);
        const meta = {
          id: value.id,
          status: value.status,
          model: value.model,
          prompt: value.prompt,
          effectivePrompt: value.effectivePrompt,
          size: value.size,
          seconds: value.seconds,
          withAudio: value.withAudio,
          audioStripped: value.audioStripped,
          filePath: value.filePath,
          videoUrl: value.videoUrl,
          elapsedSeconds: value.elapsedSeconds,
          bytes: value.bytes,
        };
        if (value.positivePrompt) meta.positivePrompt = value.positivePrompt;
        if (value.negativePrompt) meta.negativePrompt = value.negativePrompt;
        if (Number.isFinite(value.seed)) meta.seed = value.seed;
        if (value.warning) meta.warning = value.warning;
        lines.push(`结果 JSON：${JSON.stringify(meta)}`);
        return [{ type: "text", text: lines.join("\n") }];
      },
      presentationMeta(args, value) {
        return {
          url: value.videoUrl,
          filePath: value.filePath,
          prompt: value.prompt,
          effectivePrompt: value.effectivePrompt,
          size: value.size,
          seconds: value.seconds,
          model: value.model,
          withAudio: value.withAudio,
          audioStripped: value.audioStripped,
          warning: value.warning || "",
        };
      },
    },
    presentCall(args) {
      return {
        card: "generic",
        kind: "other",
        title: "生成视频",
        rawInput: {
          prompt: args.prompt,
          size: args.size,
          seconds: args.seconds,
          withAudio: args.withAudio,
        },
      };
    },
    async execute(args, exec) {
      const cfg = current();
      if (!cfg.enabled) throw new Error("video_generate 已在插件设置中禁用");

      const prompt = String(args.prompt ?? "").trim();
      if (!prompt) throw new Error("prompt 不能为空");
      if (prompt.length > MAX_PROMPT_CHARS) {
        throw new Error(`prompt 不能超过 ${MAX_PROMPT_CHARS} 个字符（当前 ${prompt.length}）`);
      }
      const positivePrompt = String(args.positivePrompt ?? cfg.positivePrompt ?? "").trim();
      const negativePrompt = String(args.negativePrompt ?? cfg.negativePrompt ?? "").trim();
      const effectivePrompt = composePrompt({ prompt, positivePrompt, negativePrompt });
      if (!effectivePrompt) throw new Error("合成后的 prompt 不能为空");
      if (effectivePrompt.length > MAX_PROMPT_CHARS) {
        throw new Error(
          `合成后的 prompt 不能超过 ${MAX_PROMPT_CHARS} 个字符（当前 ${effectivePrompt.length}；可缩短正向/负向提示词）`
        );
      }

      const endpoint = normalizeEndpoint(cfg.endpoint);
      const size = normalizeSize(args.size ?? cfg.size, cfg.size);
      const seconds = normalizeSeconds(args.seconds ?? cfg.seconds, cfg.seconds);
      const sampler = normalizeSampler(args.sampler ?? cfg.sampler, cfg.sampler);
      const seed = normalizeSeed(args.seed, cfg.seed);
      const model = String(args.model ?? cfg.model ?? "").trim();
      const withAudio = args.withAudio === undefined ? cfg.audio !== "strip" : args.withAudio === true;
      const timeoutSec = Number.isFinite(cfg.timeoutSec) ? Math.max(1, Math.floor(cfg.timeoutSec)) : 900;
      const pollIntervalSec = Number.isFinite(cfg.pollIntervalSec) ? Math.max(1, Math.floor(cfg.pollIntervalSec)) : 2;

      const payload = buildVideoPayload({ prompt: effectivePrompt, model, size, seconds, sampler, seed });
      logger?.info?.(`video-gen: submit prompt chars=${effectivePrompt.length} size=${size} seconds=${seconds} sampler=${sampler}`);

      const started = Date.now();
      const job = await createVideoJob({ endpoint, apiKey: cfg.apiKey, payload, signal: exec.signal });
      logger?.info?.(`video-gen: submitted ${job.id}`);

      const finalJob = await pollVideoJob({
        endpoint,
        apiKey: cfg.apiKey,
        id: job.id,
        signal: exec.signal,
        timeoutSec,
        pollIntervalSec,
        logger,
      });

      if (finalJob.status === "failed") {
        const detail =
          finalJob.error && typeof finalJob.error === "object"
            ? finalJob.error.message || finalJob.error.code || "unknown"
            : "unknown";
        throw new Error(`视频生成失败：${detail}（job ${job.id}）`);
      }
      if (finalJob.status !== "completed") {
        throw new Error(`视频任务未完成：status=${finalJob.status}（job ${job.id}）`);
      }

      const cwd = exec.agent?.session?.header?.cwd || process.cwd();
      const outputDir = path.resolve(cwd, cfg.outputDir || DEFAULT_OUTPUT_DIR);
      await mkdir(outputDir, { recursive: true });

      const fileName = outputFileName({ prompt, id: finalJob.id ?? job.id, fileName: args.fileName });
      const filePath = await uniqueOutputPath(outputDir, fileName);
      await downloadVideoFile({
        endpoint,
        apiKey: cfg.apiKey,
        id: finalJob.id ?? job.id,
        destPath: filePath,
        signal: exec.signal,
      });

      let audioStripped = false;
      let warning = "";
      if (!withAudio) {
        const stripResult = await stripAudioTrack(filePath, exec.signal);
        audioStripped = stripResult.ok;
        warning = stripResult.warning;
      }

      if (cfg.deleteRemote) {
        try {
          await deleteRemoteJob({ endpoint, apiKey: cfg.apiKey, id: finalJob.id ?? job.id, signal: exec.signal });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          warning = warning ? `${warning}\n${message}` : message;
        }
      }

      const actualSeconds = Number(finalJob.seconds);
      if (seconds > 0 && Number.isFinite(actualSeconds) && Math.abs(actualSeconds - seconds) > 0.5) {
        const note = `服务端将请求时长 ${seconds}s 调整为 ${actualSeconds}s（合法帧网格取整）`;
        warning = warning ? `${warning}\n${note}` : note;
      }

      const token = registerArtifact(filePath, path.basename(filePath));
      const videoUrl = `${publicBase}${ARTIFACT_PREFIX}/${token}`;
      const actualSize = finalJob.size || size;
      const elapsedSeconds = Math.round((Date.now() - started) / 100) / 10;
      const finalBytes = (await stat(filePath)).size;

      const result = {
        id: String(finalJob.id ?? job.id),
        status: String(finalJob.status),
        model: String(finalJob.model || model),
        prompt,
        effectivePrompt,
        ...(positivePrompt ? { positivePrompt } : {}),
        ...(negativePrompt ? { negativePrompt } : {}),
        size: String(actualSize),
        seconds: Number.isFinite(actualSeconds) ? actualSeconds : seconds,
        withAudio,
        audioStripped,
        filePath,
        videoUrl,
        elapsedSeconds,
        bytes: finalBytes,
        ...(warning ? { warning } : {}),
      };
      const actualSeed = seed === null ? finalJob.seed : seed;
      if (Number.isFinite(actualSeed)) result.seed = actualSeed;
      return result;
    },
  });
}

//#endregion
//#region 插件

function apply(ctx, config) {
  const logger = ctx.logger;
  const current = () => normalizeConfig(resolveConfig(config));
  const artifacts = new Map();

  const registerArtifact = (filePath, name) => {
    const token = randomBytes(18).toString("base64url");
    artifacts.set(token, {
      path: path.resolve(filePath),
      name,
      mime: "video/mp4",
    });
    // 只保留最近 200 条映射；磁盘文件不自动删除。
    while (artifacts.size > 200) {
      const oldest = artifacts.keys().next().value;
      artifacts.delete(oldest);
    }
    return token;
  };

  const getDescriptor = () => {
    let settings;
    try {
      settings = ctx.get("settings");
    } catch {
      settings = undefined;
    }
    if (!settings || typeof settings.describe !== "function") return undefined;
    try {
      return settings.describe({ redactSecrets: true }).find((candidate) => String(candidate.ns) === NS);
    } catch {
      return undefined;
    }
  };

  const describe = async () => {
    const descriptor = getDescriptor();
    let toolNames = [];
    let toolError = "";
    try {
      const toolRuntime = ctx.get("tools");
      toolNames = toolRuntime && typeof toolRuntime.schemas === "function"
        ? toolRuntime.schemas().map((schema) => schema.name)
        : [];
    } catch (error) {
      toolError = error instanceof Error ? error.message : String(error);
    }
    return {
      ok: true,
      value: {
        ns: NS,
        version: PLUGIN_VERSION,
        revision: descriptor ? descriptor.revision : 0,
        config: descriptor ? descriptor.value : publicConfig(current()),
        secrets: descriptor && Array.isArray(descriptor.secrets) ? descriptor.secrets : [],
        presets: SIZE_PRESETS,
        samplers: SAMPLERS,
        limits: MODEL_SIZE_LIMITS,
        defaultEndpoint: DEFAULT_ENDPOINT,
        defaultModel: DEFAULT_MODEL,
        toolRegistered: toolNames.includes("video_generate"),
        toolNames,
        toolError,
      },
    };
  };

  const save = async (body) => {
    if (body === null || typeof body !== "object") {
      return { ok: false, code: "bad-request", message: "malformed save request" };
    }
    let endpoint;
    let size;
    let seconds;
    let sampler;
    let seed;
    try {
      endpoint = normalizeEndpoint(body.endpoint ?? current().endpoint);
      size = normalizeSize(body.size ?? current().size, current().size);
      seconds = normalizeSeconds(body.seconds ?? current().seconds, current().seconds);
      sampler = normalizeSampler(body.sampler ?? current().sampler, current().sampler);
      seed = normalizeSeed(body.seed, null);
    } catch (error) {
      return { ok: false, code: "invalid-config", message: error instanceof Error ? error.message : String(error) };
    }

    const timeoutSec = Number(body.timeoutSec ?? current().timeoutSec);
    const pollIntervalSec = Number(body.pollIntervalSec ?? current().pollIntervalSec);
    if (!Number.isInteger(timeoutSec) || timeoutSec < 30 || timeoutSec > 3600) {
      return { ok: false, code: "invalid-config", message: "timeoutSec 必须是 30–3600 的整数" };
    }
    if (!Number.isInteger(pollIntervalSec) || pollIntervalSec < 1 || pollIntervalSec > 30) {
      return { ok: false, code: "invalid-config", message: "pollIntervalSec 必须是 1–30 的整数" };
    }
    const outputDir = String(body.outputDir ?? current().outputDir).trim();
    if (!outputDir) return { ok: false, code: "invalid-config", message: "outputDir 不能为空" };
    const model = String(body.model ?? current().model).trim();
    const audio = body.audio === "strip" ? "strip" : "keep";
    const positivePrompt = String(body.positivePrompt ?? current().positivePrompt ?? "").trim();
    const negativePrompt = String(body.negativePrompt ?? current().negativePrompt ?? "").trim();

    const ops = [
      { op: "set", path: ["enabled"], value: body.enabled !== false },
      { op: "set", path: ["endpoint"], value: endpoint },
      { op: "set", path: ["model"], value: model },
      { op: "set", path: ["size"], value: size },
      { op: "set", path: ["seconds"], value: seconds },
      { op: "set", path: ["audio"], value: audio },
      { op: "set", path: ["sampler"], value: sampler },
      { op: "set", path: ["positivePrompt"], value: positivePrompt },
      { op: "set", path: ["negativePrompt"], value: negativePrompt },
      { op: "set", path: ["outputDir"], value: outputDir },
      { op: "set", path: ["timeoutSec"], value: timeoutSec },
      { op: "set", path: ["pollIntervalSec"], value: pollIntervalSec },
      { op: "set", path: ["deleteRemote"], value: body.deleteRemote !== false },
    ];
    if (seed === null) ops.push({ op: "unset", path: ["seed"] });
    else ops.push({ op: "set", path: ["seed"], value: seed });

    if (typeof body.apiKey === "string" && body.apiKey.trim()) {
      ops.push({ op: "set", path: ["apiKey"], value: body.apiKey.trim() });
    } else if (body.clearApiKey === true) {
      ops.push({ op: "unset", path: ["apiKey"] });
    }

    const expectedRevision = typeof body.expectedRevision === "number" ? body.expectedRevision : undefined;
    try {
      await ctx.get("settings").mutate(NS, ops, expectedRevision);
    } catch (error) {
      if (error instanceof SettingsConflictError) {
        return { ok: false, code: "settings-conflict", message: error.message };
      }
      return { ok: false, code: "internal", message: error instanceof Error ? error.message : String(error) };
    }
    return describe();
  };

  const test = async (body) => {
    const cfg = current();
    let endpoint;
    try {
      endpoint = normalizeEndpoint(body.endpoint ?? cfg.endpoint);
    } catch (error) {
      return { ok: false, code: "invalid-endpoint", message: error instanceof Error ? error.message : String(error) };
    }
    const apiKey = typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : cfg.apiKey;
    const modelsUrl = deriveModelsUrl(endpoint);
    const healthUrl = deriveHealthUrl(endpoint);
    const headers = requestHeaders(apiKey, false);
    const TEST_TIMEOUT_MS = 5_000;

    let models = [];
    let modelsError = "";
    try {
      const res = await fetchWithTimeout(modelsUrl, { headers }, TEST_TIMEOUT_MS);
      const payload = await readJsonResponse(res);
      if (res.ok && payload && Array.isArray(payload.data)) models = payload.data;
      else modelsError = formatApiError(res.status, payload);
    } catch (error) {
      modelsError = error instanceof Error ? error.message : String(error);
    }

    let health = null;
    let healthError = "";
    try {
      const res = await fetchWithTimeout(healthUrl, { headers }, TEST_TIMEOUT_MS);
      const payload = await readJsonResponse(res);
      if (res.ok) health = payload;
      else healthError = formatApiError(res.status, payload);
    } catch (error) {
      healthError = error instanceof Error ? error.message : String(error);
    }

    if (models.length === 0 && modelsError) {
      // 某些部署不暴露 /v1/models；用视频列表兜底验证端点是否可达。
      try {
        const res = await fetchWithTimeout(endpoint, { headers }, TEST_TIMEOUT_MS);
        const payload = await readJsonResponse(res);
        if (!res.ok) modelsError = formatApiError(res.status, payload);
        else modelsError = "";
      } catch (error) {
        modelsError = error instanceof Error ? error.message : String(error);
      }
    }

    return {
      ok: true,
      value: {
        endpoint,
        modelsUrl,
        healthUrl,
        reachable: models.length > 0 || health !== null || modelsError === "",
        models,
        modelsError,
        health,
        healthError,
      },
    };
  };

  // 设置桥 + 视频流路由
  ctx.inject(["webServer", "settings"], (sctx) => {
    sctx.effect(() => sctx.settings.configure({ auto: false }, ctx.fiber), "video-gen: settings page policy");

    sctx.effect(() => {
      const disposers = makeBridgeRoutes({ describe, save, test }).map((route) => sctx.webServer.register(route));
      disposers.push(
        sctx.webServer.register({
          kind: "prefix",
          path: ARTIFACT_PREFIX,
          handler: (req, res) => handleArtifactRequest(req, res, artifacts),
        })
      );
      return () => {
        for (const dispose of disposers) dispose();
      };
    }, "video-gen: settings and artifact routes");

    logger.info(`video-gen: bridge ready at ${BRIDGE_PREFIX} (${PLUGIN_VERSION})`);
  });

  // 工具注册
  ctx.inject(["tools", "webServer", "settings"], (sctx) => {
    let disposeTool = null;
    const refresh = () => {
      if (disposeTool) {
        disposeTool();
        disposeTool = null;
      }
      if (!current().enabled) return;
      const publicBase = `http://127.0.0.1:${sctx.webServer.port}`;
      disposeTool = sctx.tools.register(
        buildVideoTool({ current, publicBase, registerArtifact, logger })
      );
    };

    sctx.effect(() => {
      refresh();
      return () => {
        if (disposeTool) {
          disposeTool();
          disposeTool = null;
        }
      };
    }, "video-gen: video_generate tool");

    sctx.on("settings/document-updated", (ns) => {
      if (String(ns) === NS) refresh();
    });
  });

  logger.info(
    `video-gen: ready (${PLUGIN_VERSION}) — configure at Plugins → dsh-video-gen → video-gen; tool: video_generate`
  );
}

export { Config, apply, buildVideoTool, PLUGIN_VERSION, NS, BRIDGE_PREFIX, ARTIFACT_PREFIX };
