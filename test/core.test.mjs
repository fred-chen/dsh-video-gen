import assert from "node:assert/strict";
import {
  buildVideoPayload,
  deriveModelsUrl,
  deriveHealthUrl,
  formatApiError,
  normalizeEndpoint,
  normalizeSampler,
  normalizeSeconds,
  normalizeSeed,
  normalizeSize,
  outputFileName,
  sanitizeFileName,
} from "../lib/core.js";

function test(name, fn) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("endpoint: full /v1/videos stays", () => {
  assert.equal(normalizeEndpoint("http://ai9700:5840/v1/videos"), "http://ai9700:5840/v1/videos");
});

test("endpoint: host:port gets /v1/videos", () => {
  assert.equal(normalizeEndpoint("http://ai9700:5840"), "http://ai9700:5840/v1/videos");
});

test("endpoint: /v1 gets /videos", () => {
  assert.equal(normalizeEndpoint("http://ai9700:5840/v1"), "http://ai9700:5840/v1/videos");
});

test("endpoint: base path gets /v1/videos", () => {
  assert.equal(normalizeEndpoint("http://host:5840/api"), "http://host:5840/api/v1/videos");
});

test("endpoint: invalid protocol rejected", () => {
  assert.throws(() => normalizeEndpoint("ftp://host/v1/videos"), /http\/https/);
});

test("models/health URL derivation", () => {
  assert.equal(deriveModelsUrl("http://ai9700:5840/v1/videos"), "http://ai9700:5840/v1/models");
  assert.equal(deriveHealthUrl("http://ai9700:5840/v1/videos"), "http://ai9700:5840/health");
});

test("size: default canvas accepted", () => {
  assert.equal(normalizeSize("1344x768"), "1344x768");
});

test("size: full-width x and spaces accepted", () => {
  assert.equal(normalizeSize(" 768 × 1344 "), "768x1344");
});

test("size: sides must be multiples of 32", () => {
  assert.throws(() => normalizeSize("1000x768"), /32/);
});

test("size: min side", () => {
  assert.throws(() => normalizeSize("224x768"), /256/);
});

test("size: max pixels", () => {
  assert.throws(() => normalizeSize("1024x1024"), /1,032,192|1032192/);
});

test("size: aspect ratio", () => {
  assert.throws(() => normalizeSize("2048x256"), /像素|4:1/);
});

test("seconds: integer bounds", () => {
  assert.equal(normalizeSeconds(8), 8);
  assert.equal(normalizeSeconds(0), 0);
  assert.throws(() => normalizeSeconds(3.5), /整数/);
  assert.throws(() => normalizeSeconds(61), /0–60/);
});

test("seed: null / integer", () => {
  assert.equal(normalizeSeed(""), null);
  assert.equal(normalizeSeed(null), null);
  assert.equal(normalizeSeed(42), 42);
  assert.throws(() => normalizeSeed(1.5), /整数/);
});

test("sampler aliases", () => {
  assert.equal(normalizeSampler("RES_MULTISTEP"), "res_multistep");
  assert.throws(() => normalizeSampler("dpm"), /euler/);
});

test("payload omits absent optional fields", () => {
  const payload = buildVideoPayload({
    prompt: "a fox",
    model: "fasth3",
    size: "1344x768",
    seconds: 0,
    sampler: "euler",
    seed: null,
  });
  assert.deepEqual(payload, {
    prompt: "a fox",
    model: "fasth3",
    size: "1344x768",
    sampler: "euler",
  });
});

test("payload includes seed and seconds", () => {
  const payload = buildVideoPayload({
    prompt: "a fox",
    model: "fasth3",
    size: "1344x768",
    seconds: 8,
    sampler: "euler",
    seed: 42,
  });
  assert.deepEqual(payload, {
    prompt: "a fox",
    model: "fasth3",
    size: "1344x768",
    sampler: "euler",
    seconds: 8,
    seed: 42,
  });
});

test("output filename", () => {
  assert.equal(outputFileName({ prompt: "海边灯塔 / sunset", id: "video_abcd1234", fileName: "" }), "video-海边灯塔-sunset-abcd1234.mp4");
  assert.equal(outputFileName({ prompt: "x", id: "video_abcd1234", fileName: "../../evil" }), "evil.mp4");
  assert.equal(outputFileName({ prompt: "x", id: "video_abcd1234", fileName: "my clip" }), "my-clip.mp4");
});

test("sanitize filename", () => {
  assert.equal(sanitizeFileName("a/b/../c?.mp4"), "c-.mp4");
});

test("API error formatting", () => {
  assert.equal(
    formatApiError(400, { error: { message: "size invalid", supported: ["a", "b"] } }),
    "HTTP 400：size invalid；支持：a, b"
  );
  assert.equal(formatApiError(500, "boom"), "HTTP 500：boom");
});

console.log("core tests passed");
