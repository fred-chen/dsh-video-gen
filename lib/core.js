// dsh-video-gen — 纯逻辑核心（无宿主依赖，可单测）
//
// 负责：端点归一化、分辨率校验、请求体构造、错误格式化、文件名安全化。
// 具体生成流程（提交 → 轮询 → 下载 → 音频处理）在 lib/index.js 中。

const MODEL_SIZE_LIMITS = {
  minSide: 256,
  sideStep: 32,
  maxPixels: 1032192,
  maxAspect: 4,
};

export const SIZE_PRESETS = [
  { value: "1344x768", label: "1344×768 · 16:9（默认）" },
  { value: "768x1344", label: "768×1344 · 9:16" },
  { value: "1024x576", label: "1024×576 · 16:9" },
  { value: "576x1024", label: "576×1024 · 9:16" },
  { value: "832x480", label: "832×480 · 16:9" },
  { value: "480x832", label: "480×832 · 9:16" },
  { value: "512x512", label: "512×512 · 1:1" },
];

export const SAMPLERS = [
  { value: "res_multistep", label: "res_multistep（二阶，默认）" },
  { value: "euler", label: "euler（一阶）" },
];

export function normalizeEndpoint(raw) {
  const text = String(raw ?? "").trim();
  if (!text) throw new Error("API 端点不能为空");
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`API 端点不是合法 URL：${text}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("API 端点只支持 http/https");
  }
  let pathname = url.pathname.replace(/\/+$/u, "");
  if (pathname === "") {
    pathname = "/v1/videos";
  } else if (pathname.endsWith("/v1")) {
    pathname += "/videos";
  } else if (pathname.endsWith("/v1/videos") || pathname.endsWith("/videos")) {
    // already a videos endpoint
  } else if (pathname.endsWith("/v1/")) {
    pathname += "videos";
  } else {
    // 用户可能只填了 host:port 或一个 base path；补上标准视频路径。
    pathname += "/v1/videos";
  }
  url.pathname = pathname.replace(/\/{2,}/g, "/");
  return url.toString();
}

export function deriveModelsUrl(endpoint) {
  const url = new URL(normalizeEndpoint(endpoint));
  url.pathname = url.pathname.replace(/\/videos$/u, "/models");
  url.search = "";
  return url.toString();
}

export function deriveHealthUrl(endpoint) {
  const url = new URL(normalizeEndpoint(endpoint));
  url.pathname = "/health";
  url.search = "";
  return url.toString();
}

export function normalizeSize(raw, fallback = "") {
  const value = String(raw ?? fallback ?? "")
    .trim()
    .toLowerCase()
    .replace(/[×*]/gu, "x")
    .replace(/\s+/gu, "");
  const match = /^(\d+)x(\d+)$/u.exec(value);
  if (!match) {
    throw new Error(`分辨率必须是 WIDTHxHEIGHT，例如 1344x768；收到：${value || "空"}`);
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error("分辨率宽高必须是正整数");
  }
  if (width % MODEL_SIZE_LIMITS.sideStep !== 0 || height % MODEL_SIZE_LIMITS.sideStep !== 0) {
    throw new Error(`分辨率每边必须是 ${MODEL_SIZE_LIMITS.sideStep} 的倍数（例如 1344x768）`);
  }
  if (width < MODEL_SIZE_LIMITS.minSide || height < MODEL_SIZE_LIMITS.minSide) {
    throw new Error(`分辨率每边至少 ${MODEL_SIZE_LIMITS.minSide} 像素`);
  }
  if (width * height > MODEL_SIZE_LIMITS.maxPixels) {
    throw new Error(
      `分辨率总像素不能超过 ${MODEL_SIZE_LIMITS.maxPixels}（当前 ${width * height}）；1344x768 已是上限`
    );
  }
  const ratio = Math.max(width, height) / Math.min(width, height);
  if (ratio > MODEL_SIZE_LIMITS.maxAspect) {
    throw new Error(`宽高比不能超过 ${MODEL_SIZE_LIMITS.maxAspect}:1（当前约 ${ratio.toFixed(2)}:1）`);
  }
  return `${width}x${height}`;
}

export function normalizeSeconds(raw, fallback = 0) {
  const value = raw === undefined || raw === null || raw === "" ? Number(fallback ?? 0) : Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0 || value > 60) {
    throw new Error("时长必须是 0–60 的整数秒（0 = 使用服务端默认帧数）");
  }
  return value;
}

export function normalizeSeed(raw, fallback = null) {
  const source = raw === undefined || raw === null || raw === "" ? fallback : raw;
  if (source === undefined || source === null || source === "") return null;
  const value = Number(source);
  if (!Number.isSafeInteger(value)) {
    throw new Error("seed 必须是整数（或留空随机）");
  }
  return value;
}

export function normalizeSampler(raw, fallback = "res_multistep") {
  const value = String(raw ?? fallback ?? "").trim().toLowerCase();
  if (value !== "euler" && value !== "res_multistep") {
    throw new Error("sampler 只能为 euler 或 res_multistep");
  }
  return value;
}

export function buildVideoPayload({ prompt, model, size, seconds, sampler, seed }) {
  const payload = {
    prompt,
    size,
    sampler,
  };
  if (model) payload.model = model;
  if (seconds && seconds > 0) payload.seconds = seconds;
  if (seed !== null && seed !== undefined) payload.seed = seed;
  return payload;
}

export function formatApiError(status, body) {
  const error = body && typeof body === "object" ? body.error : undefined;
  const message =
    (error && (error.message || error.detail || error.code)) ||
    (body && typeof body === "object" && (body.detail || body.message)) ||
    (typeof body === "string" ? body : "") ||
    "";
  const supported =
    error && Array.isArray(error.supported) && error.supported.length > 0
      ? `；支持：${error.supported.join(", ")}`
      : "";
  const text = typeof message === "string" ? message : JSON.stringify(message);
  return `HTTP ${status}${text ? `：${text}` : ""}${supported}`;
}

export function sanitizeFileName(raw) {
  let value = String(raw ?? "").trim();
  if (!value) return "";
  value = value.replace(/^.*[\\/]/u, "");
  value = value.replace(/[<>:"|?*\u0000-\u001f]/gu, "-");
  value = value.replace(/[^\p{L}\p{N}._-]+/gu, "-");
  value = value.replace(/^-+|-+$/gu, "");
  if (value.length > 80) value = value.slice(0, 80);
  return value;
}

export function promptSlug(prompt, maxLength = 40) {
  const slug = String(prompt ?? "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return (slug || "clip").slice(0, maxLength);
}

export function outputFileName({ prompt, id, fileName }) {
  let base = sanitizeFileName(fileName);
  if (!base) base = `video-${promptSlug(prompt)}-${String(id ?? "").slice(-8)}`;
  if (!/\.mp4$/iu.test(base)) base += ".mp4";
  return base;
}

export function isTerminalJob(job) {
  return Boolean(job) && (job.status === "completed" || job.status === "failed");
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new Error("aborted"));
      return;
    }
    let timer = null;
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      reject(signal.reason || new Error("aborted"));
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, Number(ms) || 0));
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export { MODEL_SIZE_LIMITS };
