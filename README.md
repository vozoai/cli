# vozo-cli

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[中文版](./README.zh.md) | [English](./README.md)

The [Vozo](https://www.vozo.ai) CLI for humans and AI Agents — bring Translate & Dub, Translate Subtitles, Visual Translate, and Lip Sync into the terminal. Create projects from files, folders, or URLs, track processing, and download results; fine-tuned editing stays in the Vozo web editor.

[What is Vozo](#what-is-vozo) · [Install](#installation) · [Quick Start](#quick-start) · [AI Agent](#quick-start-ai-agent) · [Skills](#agent-skills) · [Auth](#authentication) · [Project](#project) · [Advanced](#advanced-usage) · [Commands](#commands)

## What is Vozo

**Vozo** ([vozo.ai](https://www.vozo.ai)) is an AI video platform for taking one video to every language and audience. **Vozo CLI** brings its four core tools into your terminal and agent workflows:

1. **Translate & Dub** — translate a video (or audio) and re-voice it with AI voice cloning that keeps the original speakers' voices.
2. **Translate Subtitles** — generate translated subtitles for a video.
3. **Visual Translate** — translate the on-screen text burned into the video frames.
4. **Lip Sync** — re-sync the speakers' lips to match new audio (including dubbed audio from Translate & Dub).

From the CLI you can create projects from local files, folders, or video URLs (batch supported), track processing, and export/download the results (videos, audio tracks, subtitles). Fine-grained editing — fixing translations, changing voices, redubbing — happens in the Vozo web editor: every project comes with a link you can open anytime.

## Installation

### Requirements

- Node.js with `npm` / `npx`

### Install

**Option 1 — One-shot bootstrap (recommended):**

```bash
npx @vozoai/cli@latest install
```

This globally installs the CLI from npm (`@vozoai/cli`), then installs agent skills from GitHub (`npx skills add vozoai/cli -g`).

**Option 2 — Manual install:**

```bash
npm install -g @vozoai/cli
npx skills add vozoai/cli -g -y
```

Verify:

```bash
vozo-cli --version
npx skills ls -g
```

Agent skills are published on [github.com/vozoai/cli](https://github.com/vozoai/cli) and installed globally via the [Agent Skills](https://skills.sh/) CLI. If that fails, the bootstrap falls back to `vozo-cli skills install`. See [Agent Skills](#agent-skills).

## Quick Start

> **Note for AI assistants:** If you are an AI Agent helping the user install or sign in, use [Quick Start (AI Agent)](#quick-start-ai-agent).

### Sign in

```bash
vozo-cli auth login
vozo-cli auth status
vozo-cli auth points
```

`auth login` opens the Vozo web login page, waits for a local callback, and saves the session to `~/.vozo/cli/session.json`.

### Create and download a project

```bash
vozo-cli project languages translate_dub
vozo-cli project translate_dub create --from-file ./demo.mp4 --target-language en
vozo-cli project translate_dub get <project-id>
vozo-cli project translate_dub download <project-id> --artifact dubbed_video --output ./out/
```

## Quick Start (AI Agent)

> Steps for AI Agents. Sign-in requires the user to complete login in a browser.

**Step 1 — Install**

```bash
npx @vozoai/cli@latest install
vozo-cli --version
```

The CLI comes from npm; agent skills are installed from GitHub.

**Step 2 — Sign in**

```bash
vozo-cli auth login --timeout-seconds 600
```

Ask the user to complete login in the browser, then verify:

```bash
vozo-cli auth status
```

**Step 3 — Prefer these skills**

- `vozo-auth` — authentication, points, membership
- `vozo-project` — list, create, export, download

## Agent Skills

| Skill          | Description                                |
| -------------- | ------------------------------------------ |
| `vozo-auth`    | Sign-in, logout, points, and membership    |
| `vozo-project` | Project list, create, export, and download |

Install (or refresh) skills from GitHub into the global skills scope:

```bash
npx skills add vozoai/cli -g -y
npx skills ls -g
```

Source: [https://github.com/vozoai/cli](https://github.com/vozoai/cli) (`skills/` in the repository).

### Local / offline fallback

When GitHub is unavailable, install the skills bundled with the npm package into detected agent skill directories:

```bash
vozo-cli skills install
```

Useful flags: `--dry-run`, `--path <dir>`, `--link`, `--target cursor|codex|claude-code|workbuddy`.

## Authentication

| Command            | Description                                      |
| ------------------ | ------------------------------------------------ |
| `auth login`       | Browser OAuth login; stores a local session      |
| `auth logout`      | Clear the local session (and remote if possible) |
| `auth status`      | Show whether the current session is signed in    |
| `auth points`      | Show remaining point balances                    |
| `auth membership`  | Show plan / membership status                    |

```bash
vozo-cli auth login
vozo-cli auth status
vozo-cli auth points
vozo-cli auth membership
```

Example `auth membership` output:

```text
Account: you@example.com
Membership: studio
Status: active
Expires at: 2026-12-01T00:00:00.000Z
```

Example `auth points` output:

```text
Account: you@example.com
Total available points: 120.00
Point buckets:
- subscription: available 100.00 / total 100.00, active, expires at 2026-12-01T00:00:00.000Z
- gift: available 20.00 / total 20.00, active
```

Session files are stored under `~/.vozo/cli/`. Do not share `session.json` or token environment overrides with others.

## Project

| Command                 | Description                                                    |
| ----------------------- | -------------------------------------------------------------- |
| `project languages`     | List supported languages for a product kind                    |
| `project list`          | List projects (filter by `--kind`, folder, language, and more) |
| `project search`        | Search projects by keyword                                     |
| `project delete`        | Delete one or more projects                                    |
| `project folder list`   | List dashboard folders                                         |
| `project folder create` | Create a dashboard folder                                      |
| `project folder search` | Search dashboard folders by name                               |

Product tools use `project <kind> …`, where `<kind>` is one of:

| Product             | Kind                  | Typical create sources                                                 |
| ------------------- | --------------------- | ---------------------------------------------------------------------- |
| Translate & Dub     | `translate_dub`       | `--from-file` / `--from-files` / `--from-dir` / `--from-url` (video or audio) |
| Translate Subtitles | `translate_subtitles` | Same as above (video only)                                             |
| Visual Translate    | `visual_translate`    | Same as above (video only; original language required)                 |
| Lip Sync            | `lipsync`             | `--from-file` / `--from-url`                                           |

Each kind supports:

| Command                        | Description                                        |
| ------------------------------ | -------------------------------------------------- |
| `project <kind> create`        | Create a project (batch supported where noted)     |
| `project <kind> get <id>`      | Fetch status and project details                   |
| `project <kind> open <id>`     | Return / open the web editor preview URL           |
| `project <kind> export <id>`   | Start a backend export when needed                 |
| `project <kind> download <id>` | Download an artifact with `--artifact` / `--output` |

Common flow: `create` → poll `get` until processing finishes → `export` (if needed) → `download`. Use `open` when the user should review or edit in the web editor.

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

## Advanced Usage

These create options solve common production problems beyond a basic `--from-file` + `--target-language` run. Use `vozo-cli project <kind> create --help` for the full flag list.

### Keep product terms and tone consistent

Launch videos, courses, and brand content often need fixed names and a specific voice. Pass `--prompt` so the model follows your rules (plan limits apply):

```bash
vozo-cli project translate_dub create \
  --from-file ./demo.mp4 \
  --target-language en \
  --prompt "Keep product names in English; use a casual tone."
```

Also works for Translate Subtitles and Visual Translate. On Studio+, add `--glossary` when the same glossary must be reused across many projects.

### Clear hard-coded subtitles from the frame

When the source already has burned-in or embedded subtitles, new translated captions can overlap the old ones. Use `--remove-original-subtitle` so the result only shows the new track:

```bash
vozo-cli project translate_dub create \
  --from-file ./demo.mp4 \
  --target-language en \
  --enable-subtitles \
  --remove-original-subtitle
```

Translate Subtitles can use `--remove-original-subtitle` without `--enable-subtitles`.

### Reuse an existing subtitle script

If you already have a clean `.srt` / `.vtt` / `.txt` (from a previous edit, a freelance translator, or another tool), upload it with `--subtitle-file` instead of relying only on auto transcription:

```bash
vozo-cli project translate_dub create \
  --from-file ./demo.mp4 \
  --target-language en \
  --subtitle-file ./script.srt \
  --subtitle-usage original
```

Use `--subtitle-usage original` when the file is the source-language script, or `translated` when it is already the final target-language dialogue. Translate Subtitles supports the same flags.

### Fix lip-sync drift after dubbing

Some languages produce longer or shorter speech than the original. With `--auto-align-video`, the picture speeds up or slows down so it stays in sync with the dubbed audio:

```bash
vozo-cli project translate_dub create \
  --from-file ./demo.mp4 \
  --target-language en \
  --auto-align-video
```

### Match the speaker’s voice to your audience

- `--dub-preference real` (VoiceREAL) — keep the original speaker’s emotion and accent; useful when you want viewers to recognize the same person
- `--dub-preference native` (VoiceNATIVE) — more natural target-language delivery; useful for local ads, explainers, and courses

### Use a custom font for on-screen text (Visual Translate)

Default fonts often miss your brand look. Upload a local `.ttf` / `.otf` with `--font-file` so translated on-screen text keeps the typeface you chose:

```bash
vozo-cli project visual_translate create \
  --from-file ./demo.mp4 \
  --original-language en \
  --target-language zh \
  --font-file ./BrandSans.otf
```

List available fonts with `vozo-cli project visual_translate fonts`.

## Commands

| Command   | Description                           |
| --------- | ------------------------------------- |
| `install` | Bootstrap CLI + skills (`npx … install`) |
| `auth`    | See [Authentication](#authentication) |
| `project` | See [Project](#project)               |
| `skills`  | See [Agent Skills](#agent-skills)     |

## License

This package is licensed under the **MIT License**.
