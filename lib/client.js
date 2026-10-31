window.__ModuleLoader__.load({
  id: "dsh-video-gen",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const React = require("react");
    const h = React.createElement;
    const { useState, useEffect, useCallback } = React;

    const BRIDGE_PREFIX = "/api/dsh-video-gen";
    const DEFAULT_ENDPOINT = "http://ai9700:8080/upstream/MiniMax-H3-Video/v1";
    const SIZE_PRESETS = [
      { value: "1344x768", label: "1344×768 · 16:9（默认）" },
      { value: "768x1344", label: "768×1344 · 9:16" },
      { value: "1024x576", label: "1024×576 · 16:9" },
      { value: "576x1024", label: "576×1024 · 9:16" },
      { value: "832x480", label: "832×480 · 16:9" },
      { value: "480x832", label: "480×832 · 9:16" },
      { value: "512x512", label: "512×512 · 1:1" },
    ];
    const SAMPLERS = [
      { value: "res_multistep", label: "res_multistep（二阶，默认）" },
      { value: "euler", label: "euler（一阶）" },
    ];

    //#region styles
    const css = [
      ".dvg-set-page{display:flex;flex-direction:column;gap:16px;color:inherit;font-size:14px;line-height:1.55}",
      ".dvg-set-card{border:1px solid rgba(0,0,0,.08);border-radius:12px;background:rgba(255,255,255,.72);padding:14px 16px;display:flex;flex-direction:column;gap:10px}",
      "@media (prefers-color-scheme: dark){.dvg-set-card{background:rgba(30,30,32,.7);border-color:rgba(255,255,255,.08)}}",
      ".dvg-set-title{font-weight:600;font-size:14px;margin:0}",
      ".dvg-set-hint{color:#6e6e73;font-size:12px;margin:0}",
      "@media (prefers-color-scheme: dark){.dvg-set-hint{color:#a1a1a6}}",
      ".dvg-set-warn{color:#b45309;font-size:12px;margin:0}",
      "@media (prefers-color-scheme: dark){.dvg-set-warn{color:#f59e0b}}",
      ".dvg-set-error{color:#dc2626;font-size:12px;margin:0;white-space:pre-wrap}",
      "@media (prefers-color-scheme: dark){.dvg-set-error{color:#f87171}}",
      ".dvg-set-ok{color:#16a34a;font-size:12px;margin:0}",
      "@media (prefers-color-scheme: dark){.dvg-set-ok{color:#4ade80}}",
      ".dvg-set-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}",
      ".dvg-set-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}",
      ".dvg-set-field{display:flex;flex-direction:column;gap:4px;min-width:0}",
      ".dvg-set-label{font-size:12px;font-weight:500;color:#3a3a3c;display:flex;align-items:center;gap:6px}",
      "@media (prefers-color-scheme: dark){.dvg-set-label{color:#d1d1d6}}",
      ".dvg-set-input,.dvg-set-select{width:100%;box-sizing:border-box;border:1px solid rgba(0,0,0,.12);border-radius:8px;padding:6px 10px;font:inherit;font-size:13px;color:inherit;background:rgba(0,0,0,.03)}",
      "@media (prefers-color-scheme: dark){.dvg-set-input,.dvg-set-select{border-color:rgba(255,255,255,.12);background:rgba(255,255,255,.05)}}",
      ".dvg-set-input:focus-visible,.dvg-set-select:focus-visible{outline:none;border-color:#0071e3}",
      ".dvg-set-btn{border:1px solid rgba(0,0,0,.14);border-radius:8px;padding:6px 14px;font:inherit;font-size:13px;cursor:pointer;background:transparent;color:inherit}",
      ".dvg-set-btn:hover:not(:disabled){background:rgba(0,0,0,.05)}",
      "@media (prefers-color-scheme: dark){.dvg-set-btn:hover:not(:disabled){background:rgba(255,255,255,.07)}}",
      ".dvg-set-btnPrimary{background:#0071e3;border-color:#0071e3;color:#fff}",
      ".dvg-set-btnPrimary:hover:not(:disabled){background:#0a84ff}",
      ".dvg-set-btn:disabled{opacity:.5;cursor:default}",
      ".dvg-set-toggle{display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer}",
      ".dvg-set-result{border:1px dashed rgba(0,0,0,.15);border-radius:10px;padding:10px 12px;font-size:12px;white-space:pre-wrap;word-break:break-word;color:inherit}",
      "@media (prefers-color-scheme: dark){.dvg-set-result{border-color:rgba(255,255,255,.18)}}",
      ".dvg-set-chip{font-size:11px;padding:2px 8px;border-radius:999px;background:rgba(0,113,227,.12);color:#0071e3}",
      "@media (prefers-color-scheme: dark){.dvg-set-chip{color:#60a5fa}}",
      ".dvg-pending{display:flex;flex-direction:column;gap:4px;padding:4px 0}",
      ".dvg-pending-title{font-weight:600;font-size:13px}",
      ".dvg-hint{color:#6e6e73;font-size:12px;white-space:pre-wrap}",
      "@media (prefers-color-scheme: dark){.dvg-hint{color:#a1a1a6}}",
      ".dvg-error{color:#dc2626;font-size:12px;white-space:pre-wrap}",
      "@media (prefers-color-scheme: dark){.dvg-error{color:#f87171}}",
      ".dvg-card{display:flex;flex-direction:column;gap:10px;padding:8px 0 4px;max-width:680px}",
      ".dvg-video{display:block;width:100%;max-height:380px;border-radius:10px;background:#000;border:1px solid rgba(0,0,0,.12)}",
      "@media (prefers-color-scheme: dark){.dvg-video{border-color:rgba(255,255,255,.12)}}",
      ".dvg-meta{display:flex;gap:6px;flex-wrap:wrap;align-items:center}",
      ".dvg-chip{font-size:11px;padding:2px 8px;border-radius:999px;background:rgba(0,0,0,.06);color:#3a3a3c}",
      "@media (prefers-color-scheme: dark){.dvg-chip{background:rgba(255,255,255,.08);color:#d1d1d6}}",
      ".dvg-chipOk{background:rgba(22,163,74,.12);color:#15803d}",
      "@media (prefers-color-scheme: dark){.dvg-chipOk{color:#4ade80}}",
      ".dvg-chipWarn{background:rgba(245,158,11,.14);color:#b45309}",
      "@media (prefers-color-scheme: dark){.dvg-chipWarn{color:#f59e0b}}",
      ".dvg-path{font-family:monospace;font-size:11px;color:#6e6e73;overflow-wrap:anywhere}",
      "@media (prefers-color-scheme: dark){.dvg-path{color:#a1a1a6}}",
      ".dvg-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}",
      ".dvg-link,.dvg-btn{font:inherit;font-size:12px;padding:4px 10px;border-radius:8px;cursor:pointer;text-decoration:none}",
      ".dvg-link{border:1px solid rgba(0,113,227,.35);color:#0071e3;background:rgba(0,113,227,.06)}",
      ".dvg-btn{border:1px solid rgba(0,0,0,.14);color:inherit;background:transparent}",
      "@media (prefers-color-scheme: dark){.dvg-btn{border-color:rgba(255,255,255,.14)}}",
    ];
    (function injectCss() {
      if (typeof document === "undefined") return;
      if (document.getElementById("dvg-styles")) return;
      const style = document.createElement("style");
      style.id = "dvg-styles";
      style.textContent = css.join("\n");
      document.head.appendChild(style);
    })();
    //#endregion

    //#region bridge
    async function bridgeCall(path, payload) {
      let response;
      try {
        response = await fetch(`${BRIDGE_PREFIX}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload ?? {}),
        });
      } catch (error) {
        return { ok: false, code: "network", message: "无法连接宿主接口：" + (error && error.message ? error.message : String(error)) };
      }
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (!response.ok) {
        const detail = body && (body.message || body.error);
        return { ok: false, code: "http-" + response.status, message: `接口返回 ${response.status}${detail ? "：" + detail : ""}` };
      }
      if (body === null || typeof body !== "object") {
        return { ok: false, code: "bad-response", message: "接口返回了无法解析的内容（宿主插件版本与页面不一致，请重载后重试）" };
      }
      return body;
    }
    const bridgeDescribe = () => bridgeCall("/describe", {});
    const bridgeSave = (payload) => bridgeCall("/save", payload);
    const bridgeTest = (payload) => bridgeCall("/test", payload);
    //#endregion

    function clone(value) {
      return JSON.parse(JSON.stringify(value));
    }

    function Field(props) {
      return h(
        "label",
        { className: "dvg-set-field" },
        h("span", { className: "dvg-set-label" }, props.label),
        props.children,
        props.hint ? h("span", { className: "dvg-set-hint" }, props.hint) : null
      );
    }
    function TextInput(props) {
      return h("input", {
        className: "dvg-set-input",
        type: props.type || "text",
        value: props.value ?? "",
        placeholder: props.placeholder || "",
        autoComplete: props.type === "password" ? "off" : undefined,
        onChange: (event) => props.onChange(event.target.value),
      });
    }
    function NumberInput(props) {
      return h("input", {
        className: "dvg-set-input",
        type: "number",
        min: props.min ?? 0,
        max: props.max ?? undefined,
        step: props.step ?? 1,
        value: props.value ?? "",
        onChange: (event) => props.onChange(event.target.value),
      });
    }
    function Select(props) {
      return h(
        "select",
        { className: "dvg-set-select", value: props.value ?? "", onChange: (event) => props.onChange(event.target.value) },
        (props.options || []).map((option) => h("option", { key: option.value, value: option.value }, option.label))
      );
    }
    function Toggle(props) {
      return h(
        "label",
        { className: "dvg-set-toggle" },
        h("input", { type: "checkbox", checked: props.checked === true, onChange: (event) => props.onChange(event.target.checked) }),
        props.label
      );
    }

    function sizePresetOf(size) {
      return SIZE_PRESETS.some((preset) => preset.value === size) ? size : "custom";
    }

    function SettingsCard() {
      const [data, setData] = useState(null);
      const [draft, setDraft] = useState(null);
      const [loading, setLoading] = useState(true);
      const [saving, setSaving] = useState(false);
      const [error, setError] = useState("");
      const [saved, setSaved] = useState(false);
      const [testResult, setTestResult] = useState(null);
      const [testing, setTesting] = useState(false);

      const load = useCallback(async () => {
        const result = await bridgeDescribe();
        if (result && result.ok) {
          const value = result.value;
          const config = clone(value.config || {});
          const apiKeySet = Array.isArray(value.secrets)
            ? value.secrets.some((secret) => Array.isArray(secret.path) && secret.path.join(".") === "apiKey" && secret.set)
            : false;
          config.apiKey = "";
          config.apiKeySet = apiKeySet;
          config.clearApiKey = false;
          config.seed = config.seed === undefined || config.seed === null ? "" : String(config.seed);
          setData(value);
          setDraft(config);
        } else {
          setError("无法读取插件配置：" + ((result && result.message) || "unknown"));
        }
        setLoading(false);
      }, []);

      useEffect(() => {
        void load();
      }, [load]);

      const save = useCallback(async () => {
        if (!draft) return;
        setSaving(true);
        setError("");
        setSaved(false);
        const result = await bridgeSave({
          enabled: draft.enabled,
          endpoint: draft.endpoint,
          apiKey: draft.apiKey,
          clearApiKey: draft.clearApiKey === true,
          model: draft.model,
          size: draft.size,
          seconds: Number(draft.seconds),
          audio: draft.audio,
          sampler: draft.sampler,
          seed: draft.seed === "" ? null : Number(draft.seed),
          outputDir: draft.outputDir,
          timeoutSec: Number(draft.timeoutSec),
          pollIntervalSec: Number(draft.pollIntervalSec),
          deleteRemote: draft.deleteRemote,
          expectedRevision: data && data.revision,
        });
        if (result && result.ok) {
          const value = result.value;
          const config = clone(value.config || {});
          const apiKeySet = Array.isArray(value.secrets)
            ? value.secrets.some((secret) => Array.isArray(secret.path) && secret.path.join(".") === "apiKey" && secret.set)
            : false;
          config.apiKey = "";
          config.apiKeySet = apiKeySet;
          config.clearApiKey = false;
          config.seed = config.seed === undefined || config.seed === null ? "" : String(config.seed);
          setData(value);
          setDraft(config);
          setSaved(true);
        } else {
          const code = result && result.code;
          if (code === "settings-conflict") {
            setError("配置已被其他窗口修改（revision 冲突），已重新加载最新值，请合并后再保存。");
            await load();
          } else {
            setError((result && result.message) || "保存失败");
          }
        }
        setSaving(false);
      }, [draft, data, load]);

      const runTest = useCallback(async () => {
        if (!draft) return;
        setTesting(true);
        setTestResult(null);
        const result = await bridgeTest({ endpoint: draft.endpoint, apiKey: draft.apiKey || undefined });
        setTestResult(result && result.ok ? result.value : { ok: false, message: (result && result.message) || "测试失败" });
        setTesting(false);
      }, [draft]);

      if (loading) {
        return h("div", { className: "dvg-set-page" }, h("p", { className: "dvg-set-hint" }, "加载中…"));
      }
      if (!draft) {
        return h("div", { className: "dvg-set-page" }, h("p", { className: "dvg-set-error" }, error || "配置不可用"));
      }

      const update = (patch) => setDraft((previous) => ({ ...previous, ...patch }));
      const preset = sizePresetOf(draft.size);

      return h(
        "div",
        { className: "dvg-set-page" },
        h(
          "div",
          { className: "dvg-set-card" },
          h(
            "div",
            { className: "dvg-set-row" },
            h(Toggle, { checked: draft.enabled, label: "启用 video_generate 工具", onChange: (value) => update({ enabled: value }) }),
            h("span", { style: { flex: 1 } }),
            h("span", { className: "dvg-set-hint" }, `v${data && data.version ? data.version : "0.1.0"}`)
          ),
          h("p", { className: "dvg-set-hint" },
            "调用 OpenAI/FastVideo 兼容的 /v1/videos 异步接口。默认端点 " + DEFAULT_ENDPOINT + "（插件自动补 /videos）；生成的 MP4 会保存到会话工作目录，并在对话卡片中直接预览。"
          )
        ),
        h(
          "div",
          { className: "dvg-set-card" },
          h("h3", { className: "dvg-set-title" }, "端点与模型"),
          h(
            "div",
            { className: "dvg-set-grid" },
            h(Field, { label: "API 端点", hint: "含端口；可填完整 /v1/videos、以 /v1 结尾的基础路径，或只填 host:port；插件会自动补 /videos" },
              h(TextInput, { value: draft.endpoint, placeholder: DEFAULT_ENDPOINT, onChange: (value) => update({ endpoint: value }) })),
            h(Field, { label: "模型 ID", hint: "可从下方「测试连接」读取服务端模型列表" },
              h(TextInput, { value: draft.model, placeholder: "fastvideo-fasth3-8-step-v2", onChange: (value) => update({ model: value }) })),
            h(Field, { label: "API Key（可选）", hint: draft.apiKeySet ? "已保存密钥；留空保持不变，勾选下方可清除" : "FastVideo 本地服务通常不需要；远程代理可填" },
              h(TextInput, { type: "password", value: draft.apiKey, placeholder: draft.apiKeySet ? "已保存（留空保持不变）" : "留空 = 无鉴权", onChange: (value) => update({ apiKey: value }) })),
            h(Field, { label: "输出目录", hint: "相对于会话工作目录；可写绝对路径" },
              h(TextInput, { value: draft.outputDir, placeholder: ".dsh-video-gen", onChange: (value) => update({ outputDir: value }) }))
          ),
          draft.apiKeySet
            ? h(Toggle, { checked: draft.clearApiKey === true, label: "清除已保存的 API Key", onChange: (value) => update({ clearApiKey: value }) })
            : null
        ),
        h(
          "div",
          { className: "dvg-set-card" },
          h("h3", { className: "dvg-set-title" }, "生成参数"),
          h(
            "div",
            { className: "dvg-set-grid" },
            h(Field, { label: "分辨率", hint: "每边 32 的倍数、≥256、总像素 ≤1,032,192、宽高比 ≤4:1" },
              h(Select, {
                value: preset === "custom" ? "custom" : preset,
                options: [...SIZE_PRESETS, { value: "custom", label: "自定义…" }],
                onChange: (value) => update({ size: value === "custom" ? draft.size : value }),
              }),
              preset === "custom" ? h(TextInput, { value: draft.size, placeholder: "例如 1344x768", onChange: (value) => update({ size: value }) }) : null),
            h(Field, { label: "时长（秒）", hint: "0 = 服务端默认帧数；服务端会按 legal frame grid 取整" },
              h(NumberInput, { value: draft.seconds, min: 0, max: 60, onChange: (value) => update({ seconds: value }) })),
            h(Field, { label: "音频", hint: "H3 默认随视频生成音频；移除会调用本机 ffmpeg" },
              h(Select, {
                value: draft.audio,
                options: [
                  { value: "keep", label: "保留音轨（默认）" },
                  { value: "strip", label: "移除音轨" },
                ],
                onChange: (value) => update({ audio: value }),
              })),
            h(Field, { label: "Sampler" },
              h(Select, {
                value: draft.sampler,
                options: SAMPLERS,
                onChange: (value) => update({ sampler: value }),
              })),
            h(Field, { label: "Seed", hint: "留空 = 随机；整数可复现" },
              h(TextInput, { value: draft.seed, placeholder: "随机", onChange: (value) => update({ seed: value }) }))
          )
        ),
        h(
          "div",
          { className: "dvg-set-card" },
          h("h3", { className: "dvg-set-title" }, "等待与清理"),
          h(
            "div",
            { className: "dvg-set-grid" },
            h(Field, { label: "轮询超时（秒）", hint: "仅限制 DSH 等待；超时不会取消服务端 GPU 任务" },
              h(NumberInput, { value: draft.timeoutSec, min: 30, max: 3600, onChange: (value) => update({ timeoutSec: value }) })),
            h(Field, { label: "轮询间隔（秒）" },
              h(NumberInput, { value: draft.pollIntervalSec, min: 1, max: 30, onChange: (value) => update({ pollIntervalSec: value }) }))
          ),
          h(Toggle, {
            checked: draft.deleteRemote,
            label: "下载完成后删除服务端任务与产物（推荐；本地 MP4 会保留）",
            onChange: (value) => update({ deleteRemote: value }),
          })
        ),
        h(
          "div",
          { className: "dvg-set-card" },
          h(
            "div",
            { className: "dvg-set-row" },
            h("h3", { className: "dvg-set-title" }, "连接测试"),
            h("span", { style: { flex: 1 } }),
            h("button", {
              className: "dvg-set-btn",
              type: "button",
              disabled: testing,
              onClick: () => void runTest(),
            }, testing ? "测试中…" : "测试连接")
          ),
          h("p", { className: "dvg-set-hint" },
            "读取 /v1/models 与 /health，确认端点、模型 ID 和鉴权是否可用；不会生成视频。"
          ),
          testResult
            ? h(
                "div",
                { className: "dvg-set-result" },
                testResult.ok === false
                  ? testResult.message || "测试失败"
                  : (() => {
                      const lines = [];
                      lines.push(`端点：${testResult.endpoint}`);
                      lines.push(`可达：${testResult.reachable ? "是" : "否"}`);
                      if (testResult.models && testResult.models.length > 0) {
                        lines.push("模型：");
                        for (const model of testResult.models) {
                          const caps = model.capabilities || {};
                          const bits = [
                            caps.video_generation ? "video" : null,
                            caps.video_audio_shift ? `audio_shift=${caps.video_audio_shift}` : null,
                            caps.video_samplers ? `samplers=${caps.video_samplers.join("/")}` : null,
                          ].filter(Boolean);
                          lines.push(`- ${model.id}${bits.length ? " · " + bits.join(" · ") : ""}`);
                        }
                      } else {
                        lines.push("模型：未读取到列表");
                      }
                      if (testResult.modelsError) lines.push(`模型错误：${testResult.modelsError}`);
                      if (testResult.health) lines.push(`health：${JSON.stringify(testResult.health)}`);
                      if (testResult.healthError) lines.push(`health 错误：${testResult.healthError}`);
                      return lines.join("\n");
                    })()
              )
            : null
        ),
        h(
          "div",
          { className: "dvg-set-card" },
          error ? h("p", { className: "dvg-set-error" }, error) : null,
          saved ? h("p", { className: "dvg-set-ok" }, "已保存。工具会立即使用新配置。") : null,
          h(
            "div",
            { className: "dvg-set-row" },
            h("button", {
              className: "dvg-set-btn dvg-set-btnPrimary",
              type: "button",
              disabled: saving,
              onClick: () => void save(),
            }, saving ? "保存中…" : "保存"),
            h("button", {
              className: "dvg-set-btn",
              type: "button",
              disabled: saving,
              onClick: () => void load(),
            }, "放弃修改并重新加载")
          )
        )
      );
    }

    function flattenText(block) {
      if (!block || !Array.isArray(block.content)) return "";
      return block.content
        .filter((part) => part && part.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("\n");
    }

    function VideoToolView(props) {
      const { phase, block, openFile } = props;
      if (phase !== "result") {
        const args = block && block.args && typeof block.args === "object" ? block.args : {};
        const prompt = typeof args.prompt === "string" ? args.prompt : "";
        return h(
          "div",
          { className: "dvg-pending" },
          h("div", { className: "dvg-pending-title" }, "生成视频"),
          prompt ? h("div", { className: "dvg-hint" }, prompt.slice(0, 200)) : null,
          h("div", { className: "dvg-hint" }, "已提交，正在等待服务端生成…")
        );
      }
      if (block && block.isError) {
        return h(
          "div",
          { className: "dvg-pending" },
          h("div", { className: "dvg-pending-title" }, "视频生成失败"),
          h("div", { className: "dvg-error" }, flattenText(block) || "unknown error")
        );
      }
      const meta = block && block.meta && typeof block.meta === "object" ? block.meta : null;
      if (!meta || typeof meta.url !== "string" || !meta.url) {
        return h(
          "div",
          { className: "dvg-pending" },
          h("div", { className: "dvg-pending-title" }, "生成视频"),
          h("div", { className: "dvg-hint" }, flattenText(block) || "结果不可用")
        );
      }

      const audioLabel = meta.withAudio
        ? "音频：保留"
        : meta.audioStripped
          ? "音频：已移除"
          : "音频：移除失败";
      const failed = meta.warning ? true : false;
      return h(
        "div",
        { className: "dvg-card" },
        h("video", {
          className: "dvg-video",
          src: meta.url,
          controls: true,
          preload: "metadata",
          playsInline: true,
        }),
        h(
          "div",
          { className: "dvg-meta" },
          meta.size ? h("span", { className: "dvg-chip" }, String(meta.size)) : null,
          Number.isFinite(Number(meta.seconds)) ? h("span", { className: "dvg-chip" }, `${Number(meta.seconds)}s`) : null,
          meta.model ? h("span", { className: "dvg-chip" }, String(meta.model)) : null,
          h("span", { className: "dvg-chip" }, audioLabel),
          failed ? h("span", { className: "dvg-chip dvg-chipWarn" }, "有警告") : h("span", { className: "dvg-chip dvg-chipOk" }, "完成")
        ),
        meta.filePath ? h("div", { className: "dvg-path" }, String(meta.filePath)) : null,
        meta.warning ? h("div", { className: "dvg-error" }, String(meta.warning)) : null,
        h(
          "div",
          { className: "dvg-actions" },
          h("a", { className: "dvg-link", href: meta.url, download: true }, "下载 MP4"),
          typeof openFile === "function" && meta.filePath
            ? h("button", { className: "dvg-btn", type: "button", onClick: () => openFile(meta.filePath) }, "打开文件")
            : null
        )
      );
    }

    function summaryText() {
      return "文本生成视频 · 端点、分辨率、音频可配置";
    }

    const inject = ["slots"];

    function apply(ctx) {
      ctx.slots.inject("plugins.row.config", () =>
        ctx.slots.register(
          {
            name: "plugins.row.config",
            key: "dsh-video-gen#video-gen",
          },
          (slotProps) =>
            slotProps && slotProps.view === "summary"
              ? summaryText()
              : h(SettingsCard, null)
        )
      );
      ctx.slots.inject("tool.call.toolview", () =>
        ctx.slots.register(
          {
            name: "tool.call.toolview",
            key: "video_generate",
            priority: -10,
          },
          VideoToolView
        )
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
