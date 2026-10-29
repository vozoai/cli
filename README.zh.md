# vozo-cli

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

中文版 | [English](./README.md)

[Vozo](https://www.vozo.ai) 的命令行工具，面向人类与 AI Agent —— 把 Translate & Dub、Translate Subtitles、Visual Translate、Lip Sync 带进终端。支持从文件、文件夹或 URL 创建项目、跟踪处理并下载结果；精细编辑仍在 Vozo Web 编辑器中完成。

[什么是 Vozo](#什么是-vozo) · [安装](#安装) · [快速开始](#快速开始) · [AI Agent](#快速开始ai-agent) · [Skills](#agent-skills) · [认证](#认证) · [项目](#项目) · [进阶](#进阶用法) · [命令](#命令)

## 什么是 Vozo

**Vozo**（[vozo.ai](https://www.vozo.ai)）是一款 AI 视频平台，帮助你把一条视频带向每一种语言和每一类受众。**Vozo CLI** 把四款核心工具带进终端与 Agent 工作流：

1. **Translate & Dub** — 翻译视频（或音频），并用 AI 声音克隆重新配音，尽量保留原说话人的音色。
2. **Translate Subtitles** — 为视频生成翻译字幕。
3. **Visual Translate** — 翻译视频画面中烧录的屏幕文字。
4. **Lip Sync** — 让说话人的口型与新音频对齐（也可配合 Translate & Dub 的配音结果）。

通过 CLI，你可以从本地文件、文件夹或视频 URL 创建项目（支持批量），跟踪处理进度，并导出/下载结果（视频、音轨、字幕）。精细编辑——改译文、换音色、重新配音——在 Vozo Web 编辑器中完成：每个项目都带有随时可打开的链接。

## 安装

### 环境要求

- 已安装 Node.js 与 `npm` / `npx`

### 安装命令

**方式一 — 一键安装（推荐）：**

```bash
npx @vozoai/cli@latest install
```

会从 npm 全局安装 CLI（`@vozoai/cli`），再从 GitHub 安装 agent skills（`npx skills add vozoai/cli -g`）。

**方式二 — 手动安装：**

```bash
npm install -g @vozoai/cli
npx skills add vozoai/cli -g -y
```

验证安装：

```bash
vozo-cli --version
npx skills ls -g
```

Agent skills 发布在 [github.com/vozoai/cli](https://github.com/vozoai/cli)，通过 [Agent Skills](https://skills.sh/) CLI 安装到全局。若失败，一键安装会回退到 `vozo-cli skills install`。详见 [Agent Skills](#agent-skills)。

## 快速开始

> **给 AI 助手的说明：** 如果你是在帮用户安装或登录的 AI Agent，请直接按 [快速开始（AI Agent）](#快速开始ai-agent) 操作。

### 登录

```bash
vozo-cli auth login
vozo-cli auth status
vozo-cli auth points
```

`auth login` 会打开 Vozo Web 登录页，等待本地回调，并将会话保存到 `~/.vozo/cli/session.json`。

### 创建并下载项目

```bash
vozo-cli project languages translate_dub
vozo-cli project translate_dub create --from-file ./demo.mp4 --target-language en
vozo-cli project translate_dub get <project-id>
vozo-cli project translate_dub download <project-id> --artifact dubbed_video --output ./out/
```

## 快速开始（AI Agent）

> 以下步骤面向 AI Agent。登录需要用户在浏览器中完成。

**步骤 1 — 安装**

```bash
npx @vozoai/cli@latest install
vozo-cli --version
```

CLI 从 npm 安装；agent skills 从 GitHub 安装。

**步骤 2 — 登录**

```bash
vozo-cli auth login --timeout-seconds 600
```

请提示用户在浏览器中完成登录，然后验证：

```bash
vozo-cli auth status
```

**步骤 3 — 优先使用这些 skills**

- `vozo-auth` — 登录、点数、会员
- `vozo-project` — 列表、创建、导出、下载

## Agent Skills

| Skill          | 说明                       |
| -------------- | -------------------------- |
| `vozo-auth`    | 登录、登出、点数与会员查询 |
| `vozo-project` | 项目列表、创建、导出与下载 |

从 GitHub 安装（或更新）到全局 skills 作用域：

```bash
npx skills add vozoai/cli -g -y
npx skills ls -g
```

来源：[https://github.com/vozoai/cli](https://github.com/vozoai/cli)（仓库中的 `skills/`）。

### 本地 / 离线兜底

无法访问 GitHub 时，可把 npm 包内自带的 skills 安装到本机已检测到的 Agent skill 目录：

```bash
vozo-cli skills install
```

常用参数：`--dry-run`、`--path <dir>`、`--link`、`--target cursor|codex|claude-code|workbuddy`。

## 认证

| 命令              | 说明                               |
| ----------------- | ---------------------------------- |
| `auth login`      | 浏览器 OAuth 登录，保存本地会话    |
| `auth logout`     | 清除本地会话（并尽量结束远端会话） |
| `auth status`     | 查看当前是否已登录                 |
| `auth points`     | 查看剩余点数                       |
| `auth membership` | 查看会员 / 套餐状态                |

```bash
vozo-cli auth login
vozo-cli auth status
vozo-cli auth points
vozo-cli auth membership
```

`auth membership` 输出示例：

```text
Account: you@example.com
Membership: studio
Status: active
Expires at: 2026-12-01T00:00:00.000Z
```

`auth points` 输出示例：

```text
Account: you@example.com
Total available points: 120.00
Point buckets:
- subscription: available 100.00 / total 100.00, active, expires at 2026-12-01T00:00:00.000Z
- gift: available 20.00 / total 20.00, active
```

会话文件保存在 `~/.vozo/cli/`。请勿将 `session.json` 或相关 token 环境变量分享给他人。

## 项目

| 命令                    | 说明                                          |
| ----------------------- | --------------------------------------------- |
| `project languages`     | 查看某个产品 kind 支持的语言                  |
| `project list`          | 列出项目（可按 `--kind`、文件夹、语言等过滤） |
| `project search`        | 按关键词搜索项目                              |
| `project delete`        | 删除一个或多个项目                            |
| `project folder list`   | 列出工作台文件夹                              |
| `project folder create` | 创建工作台文件夹                              |
| `project folder search` | 按名称搜索工作台文件夹                        |

各产品工具使用 `project <kind> …`，`<kind>` 如下：

| 产品                | Kind                  | 常见创建来源                                                                        |
| ------------------- | --------------------- | ----------------------------------------------------------------------------------- |
| Translate & Dub     | `translate_dub`       | `--from-file` / `--from-files` / `--from-dir` / `--from-url`（视频或音频）          |
| Translate Subtitles | `translate_subtitles` | 同上（仅视频）                                                                      |
| Visual Translate    | `visual_translate`    | 同上（仅视频；必须指定原始语言）                                                    |
| Lip Sync            | `lipsync`             | `--from-file` / `--from-files` / `--from-dir` / `--from-url` / `--from-translation` |

每种 kind 均支持：

| 命令                           | 说明                                    |
| ------------------------------ | --------------------------------------- |
| `project <kind> create`        | 创建项目（部分产品支持批量）            |
| `project <kind> get <id>`      | 查询状态与项目详情                      |
| `project <kind> open <id>`     | 返回 / 打开 Web 编辑器预览链接          |
| `project <kind> export <id>`   | 需要时发起后端导出                      |
| `project <kind> download <id>` | 使用 `--artifact` / `--output` 下载产物 |

常见流程：`create` → 轮询 `get` 直至处理完成 → 按需 `export` → `download`。需要审阅或精修时使用 `open` 打开 Web 编辑器。

```bash
vozo-cli project languages translate_dub
vozo-cli project folder list
vozo-cli project list --kind translate_dub
vozo-cli project translate_dub create --from-file ./demo.mp4 --target-language en
vozo-cli project translate_dub get <project-id>
vozo-cli project translate_dub open <project-id>
vozo-cli project translate_dub download <project-id> --artifact dubbed_video --output ./out/
vozo-cli project translate_dub download <project-id> --artifact background_audio --output ./bgm.wav
vozo-cli project translate_subtitles download <project-id> --artifact original_subtitle_vtt --output ./original
```

### 将已有项目翻译到更多语言

Translate & Dub 可以基于已经编辑好的项目创建更多目标语言项目，不需要重新上传原始媒体：

```bash
vozo-cli project translate_dub more-languages <project-id> \
  --target-language de fr \
  --prompt "产品名保留英文" \
  --glossary <glossary-id-1> <glossary-id-2> \
  --auto-align-video \
  --proofread-before-dubbing \
  --estimate-only
```

不传 `--prompt` / `--glossary` 时继承源项目设置；使用 `--clear-prompt` /
`--clear-glossary` 可清空对应设置。先使用 `--estimate-only`，把接口返回的
`point` 告知用户；用户确认后，再去掉 `--estimate-only` 执行同一条命令。
项目资格和状态会在真正执行翻译时校验，因此执行请求仍可能返回错误。不传时会继承源
项目的变速设置。两步翻译默认关闭，只有用户明确指定
`--proofread-before-dubbing` 时才开启；可使用 `--auto-align-video` 明确开启变速。

该命令当前**仅支持 Translate & Dub 项目**。如果命令返回
`Project not found.`，请使用
`vozo-cli project search "<project-id>" --kind all` 搜索同一个项目 ID。
如果精确匹配的项目属于其他 kind（或搜索结果提示省略了不支持的 kind），应告知
用户：项目存在，但其项目类型不支持 More Languages。如果没有找到匹配项目，则继续
按项目不存在处理，不要自行推断项目类型。

每次 More Languages 请求最多可选择 **40 个目标语言**。如果超过 40 个，请先减少
选择数量或拆分成多次请求，再执行积分预估或翻译。

## 进阶用法

下面这些 create 能力对应常见生产场景，而不是「再多几个参数」。完整参数列表请用 `vozo-cli project <kind> create --help`。

### 保持产品名与语气一致

发布会、课程、品牌素材里常有固定译法或语气要求。用 `--prompt` 告诉模型必须遵守的规则（受套餐限制）：

```bash
vozo-cli project translate_dub create \
  --from-file ./demo.mp4 \
  --target-language en \
  --prompt "Keep product names in English; use a casual tone."
```

Translate Subtitles、Visual Translate 同样可用。若同一套术语要在多项目里复用，Studio+ 可再加 `--glossary`。

### 避开新旧字幕叠在一起

片源已有字幕时，再出译文字幕容易和旧字幕叠在一起。加上 `--remove-original-subtitle`，结果只保留新字幕：

```bash
vozo-cli project translate_dub create \
  --from-file ./demo.mp4 \
  --target-language en \
  --enable-subtitles \
  --remove-original-subtitle
```

Translate Subtitles 使用 `--remove-original-subtitle` 时不需要再加 `--enable-subtitles`。

### 使用已有字幕

如果手里已有校对好的 `.srt` / `.vtt` / `.txt`（来自人工修订、外包译稿或其它工具），可用 `--subtitle-file` 直接上传，而不必只依赖自动听写：

```bash
vozo-cli project translate_dub create \
  --from-file ./demo.mp4 \
  --target-language en \
  --subtitle-file ./script.srt \
  --subtitle-usage original
```

文件是源语言脚本时用 `--subtitle-usage original`；已是目标语言成稿时用 `translated`。Translate Subtitles 同样支持这两个选项。

### 配音时长变化后仍对齐画面

有些目标语言口播会比原片更长或更短。打开 `--auto-align-video` 后，画面会随之加快或放慢，避免对不上嘴：

```bash
vozo-cli project translate_dub create \
  --from-file ./demo.mp4 \
  --target-language en \
  --auto-align-video
```

### 按受众选择配音听感

- `--dub-preference real`（VoiceREAL）— 更保留原说话人的情绪与口音，适合希望观众仍能认出同一个人的场景
- `--dub-preference native`（VoiceNATIVE）— 更接近当地自然口播，适合本地广告、解说与课程

### 翻译画面文字时使用自定义字体（Visual Translate）

默认字体往往对不齐品牌规范。用 `--font-file` 上传本地 `.ttf` / `.otf`，让译后的画面文字沿用你指定的字体：

```bash
vozo-cli project visual_translate create \
  --from-file ./demo.mp4 \
  --original-language en-US \
  --target-language zh \
  --font-file ./BrandSans.otf
```

可用 `vozo-cli project visual_translate fonts` 查看字体列表。

## 命令

| 命令      | 说明                                          |
| --------- | --------------------------------------------- |
| `install` | 一键安装 CLI + skills（配合 `npx … install`） |
| `auth`    | 见 [认证](#认证)                              |
| `project` | 见 [项目](#项目)                              |
| `skills`  | 见 [Agent Skills](#agent-skills)              |

## License

本软件包采用 **MIT License**。
