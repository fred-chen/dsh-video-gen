# dsh-video-gen

GitHub：<https://github.com/fred-chen/dsh-video-gen>

DeepSeek Harness 插件：**文本 → 视频**。

调用 OpenAI/FastVideo 兼容的 `/v1/videos` 异步接口，轮询生成状态，把 MP4 下载到当前会话工作目录，并在对话卡片中直接播放。端点、端口、模型、分辨率、时长、音频、sampler、seed、超时等均可配置。

- **默认端点**：`http://ai9700:5840/v1/videos`
- **默认模型**：`fastvideo-fasth3-8-step-v2`
- **默认分辨率**：`1344x768`（该模型上限画布，约 1.03 MP）
- **工具名**：`video_generate`
- **设置页**：侧栏「插件」→「dsh-video-gen」→「video-gen」→ Configure

## 功能

1. **设置页**：端点、API Key（可选）、模型、分辨率、时长、音频、sampler、seed、输出目录、轮询超时/间隔、是否删除远端任务。
2. **`video_generate` 工具**：模型可按 prompt 生成视频；调用参数可临时覆盖设置（分辨率、时长、音频、seed、模型、sampler、文件名）。
3. **本地保存**：MP4 写入会话工作目录（默认 `.dsh-video-gen/`），返回绝对路径。
4. **浏览器预览**：插件注册 `/api/dsh-video-gen/artifacts/<token>` 流路由，支持 Range 请求，对话卡片中可直接播放、下载。
5. **音频控制**：H3 模型默认随视频生成 AAC 音轨；`withAudio:false` / 设置页「移除音轨」会在下载后调用本机 `ffmpeg -an` 移除。
6. **结构化结果**：模型可见的结果同时包含人类可读摘要和一行 `结果 JSON`（id/status/seconds/bytes/elapsedSeconds 等字段），便于后续引用。
7. **连接测试**：设置页读取 `/v1/models` 与 `/health`，不会生成视频。

## 实测 API 约定

本插件按 `http://ai9700:5840` 的 FastVideo/radiance 1.13.0 实测字段实现：

| 字段 | 说明 |
|---|---|
| `prompt` | 必填，≤8192 字符 |
| `model` | 模型 ID；默认 `fastvideo-fasth3-8-step-v2` |
| `size` | `WIDTHxHEIGHT`；每边 32 的倍数、≥256、总像素 ≤1,032,192、宽高比 ≤4:1 |
| `seconds` | 整数秒；服务端会按合法帧网格取整（例如请求 6 秒可能得到 6.58 秒） |
| `seed` | 整数；省略则随机 |
| `sampler` | `euler` 或 `res_multistep` |
| `task` | 服务端支持 `t2va`（文本→视频+音频），插件不显式发送 |

服务端**不接受** `generate_sound`、`audio`、`width`、`height`、`num_frames`、`quality`、`steps` 等字段（实测会返回 400）。因此音频关闭采用「本地移除音轨」而不是服务端开关。

响应流程：

```
POST /v1/videos        → { id, status: "queued" | "in_progress", ... }
GET  /v1/videos/{id}   → 轮询到 status: "completed" | "failed"
GET  /v1/videos/{id}/content → MP4
DELETE /v1/videos/{id} → 清理远端任务（默认下载后删除）
```

## 安装

### 从 GitHub 安装（推荐）

```bash
# 在目标 profile 目录执行
pnpm add github:fred-chen/dsh-video-gen
```

然后把 `dsh-video-gen` 加入该 profile `package.json` 的 `dsh.profile.bundles`。

### 从本地源码安装

```bash
cd ~/.dsh/profiles/desktop
mkdir -p node_modules
cp -R /path/to/dsh-video-gen node_modules/dsh-video-gen
```

然后编辑 `~/.dsh/profiles/desktop/package.json`：

```json
{
  "dependencies": {
    "dsh-video-gen": "file:/path/to/dsh-video-gen"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "...",
        "dsh-video-gen"
      ]
    }
  }
}
```

> 也可以使用插件的 `pnpm add file:/path/to/dsh-video-gen`，再把 `dsh-video-gen` 加入 `dsh.profile.bundles`。

### 重载 DSH

DSH 会通过 profile manifest / HMR 重新组装插件树；宿主插件代码需要重启 DSH（或在插件页把 `video-gen` 行临时关闭再启用）才会重新加载并注册 `video_generate` 工具。打开侧栏「插件」应看到 `dsh-video-gen`，其行 `video-gen` 有 **Configure** 按钮。

## 配置项

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 是否注册 `video_generate` 工具 |
| `endpoint` | `http://ai9700:5840/v1/videos` | 完整 API 端点（含端口）。也可只填 `http://host:port`，插件自动补 `/v1/videos` |
| `apiKey` | 空 | 可选；secret 字段，保存后只显示「已保存」，不回传明文。FastVideo 本地通常不需要 |
| `model` | `fastvideo-fasth3-8-step-v2` | 服务端 `/v1/models` 公布的模型 ID |
| `size` | `1344x768` | 分辨率 |
| `seconds` | `5` | 请求时长；0 = 服务端默认帧数 |
| `audio` | `keep` | `keep` 保留音轨 / `strip` 下载后用 ffmpeg 移除 |
| `sampler` | `res_multistep` | `euler` 或 `res_multistep` |
| `seed` | 空（随机） | 整数可复现 |
| `outputDir` | `.dsh-video-gen` | 相对会话工作目录；可写绝对路径 |
| `timeoutSec` | `900` | 轮询超时；超时不取消服务端 GPU 任务 |
| `pollIntervalSec` | `2` | 轮询间隔 |
| `deleteRemote` | `true` | 下载成功后删除服务端任务与产物 |

## 工具调用

```json
{
  "name": "video_generate",
  "arguments": {
    "prompt": "黄昏海边灯塔，三艘帆船缓慢移动，电影感广角镜头",
    "size": "768x1344",
    "seconds": 8,
    "withAudio": false,
    "seed": 42,
    "sampler": "res_multistep",
    "fileName": "lighthouse"
  }
}
```

返回：

```json
{
  "id": "video_...",
  "status": "completed",
  "model": "fastvideo-fasth3-8-step-v2",
  "prompt": "...",
  "size": "768x1344",
  "seconds": 5.17,
  "withAudio": false,
  "audioStripped": true,
  "filePath": "/path/to/workspace/.dsh-video-gen/video-...mp4",
  "videoUrl": "http://127.0.0.1:62211/api/dsh-video-gen/artifacts/<token>",
  "elapsedSeconds": 36.2,
  "bytes": 1234567
}
```

## 音频说明

FastH3 的 V2 模型实测输出是 **视频 + AAC 音频**，服务端没有 `generate_sound`/`audio` 字段可关闭。插件策略：

- `audio: keep`：原样保留。
- `audio: strip`：下载后运行 `ffmpeg -y -i in.mp4 -map 0:v:0 -c:v copy -an -movflags +faststart out.mp4`，替换原文件。
- 如果 `ffmpeg` 不在 PATH，返回 `audioStripped:false` 并在 `warning` 中说明；文件仍含音轨。

## 分辨率限制

服务端拒绝不合法尺寸时返回 400，例如：

```
size: 720x1280 is not a size this model makes:
sides are multiples of 32 from 256, at most 1032192 pixels and 4:1;
its canvas at that ratio is 768x1344
```

插件在提交前也做同样校验：每边 32 的倍数、≥256、总像素 ≤1,032,192、宽高比 ≤4:1。

## 常见问题

- **404 / 端点错误**：检查 `endpoint` 是否包含 `/v1/videos`，端口是否为 `5840`。设置页点「测试连接」查看 `/v1/models`。
- **模型 ID 不匹配**：在设置页「测试连接」读取 `models` 列表，把 `model` 改成列表中的 `id`（本机为 `fastvideo-fasth3-8-step-v2`）。
- **时长被服务端取整**：例如请求 1 秒，H3 会按合法帧网格输出 5.17 秒；结果里会给出 `warning`，说明实际时长。
- **轮询超时**：生成 14 秒视频可能需要更久；把 `timeoutSec` 调大。超时不会取消服务端 GPU 任务，返回的 job id 仍可查询。
- **音频移除失败**：确认 `ffmpeg` 已安装：`ffmpeg -version`。
- **卡片里视频不播放**：视频 URL 固定为 `http://127.0.0.1:<宿主端口>`；若通过其他主机名访问 GUI，请用返回的 `filePath` 打开本地文件。
- **重启后旧卡片的预览链接 404**：artifact token 是插件进程内的短期映射；重启后旧 token 失效，但本地 MP4 文件仍在 `outputDir` 中。新生成的视频不受影响。

## 开发与测试

```bash
cd dsh-video-gen
node test/core.test.mjs
```

核心逻辑在 `lib/core.js`（端点、尺寸、payload、文件名、错误格式化）；宿主流程在 `lib/index.js`；设置页和视频卡片在 `lib/client.js`。
