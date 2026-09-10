# Per-Tool Create → Download

Read this file when the user's request is scoped to a specific tool and you need exact flags, required fields, or download artifacts. See `SKILL.md` for the shared create → poll → export → download workflow and confirmation rules.

**Agent rules (full text in SKILL.md — do not act on the tables below without these):**

- **`--target-language`** is required by every tool here and must come from an **explicit user choice** — never infer or default it (SKILL.md §3.1). For region/accent, pass a locale tag in the same flag (e.g. `zh-HK`, `en-AU`).
- **`export` / `download`** only when the user explicitly asks, and never via `webUrl` / `open` / playback URLs (SKILL.md §3.2).
- **Create plans** must list every flag with its resolved value, including defaults (`references/create-plan-checklist.md`).

## Contents

- [Create plan checklist](#create-plan-checklist) → see `references/create-plan-checklist.md` before user confirmation
- [Dashboard folders](#dashboard-folders-account-workspace)
- [Translate dub](#translate-dub-translate_dub)
- [Translate subtitles](#translate-subtitles-translate_subtitles)
- [Visual translate](#visual-translate-visual_translate)
- [Lipsync](#lipsync-lipsync)

## Dashboard folders (account workspace)

These are **server-side project folders** in the user's Vozo dashboard — not local directories on disk.

| Action                       | Command                                             |
| ---------------------------- | --------------------------------------------------- |
| List folders                 | `vozo-cli project folder list`                      |
| Search by name               | `vozo-cli project folder search "<query>"`          |
| Create folder                | `vozo-cli project folder create "<name>"`           |
| Create project inside folder | any `project <tool> create ... --folder <folderId>` |

Resolve a folder id with `folder search` when the user names a folder; use `folder create` only when they want a **new** dashboard folder. Folder names must be unique (exact match after trim), and **reviewer** team members cannot create folders.

## Translate dub (`translate_dub`)

**Create source (one of):** `--from-url` | `--from-file` | `--from-files` | `--from-dir`

**Batch (2+ files or a folder):** use **one** `--from-files` / `--from-dir` create (never loop `--from-file`). Requires **Studio+**. Not compatible with `--subtitle-file` or `--speaker-number`.

**Single file / URL:** `--from-url` or `--from-file` only.

Video: `.avi`, `.webm`, `.wmv`, `.mp4`, `.mov`. Audio: `.mp3`, `.wav`, `.m4a` → `kind: audio-translation`. Raw `.aac` is web-only; CLI rejects it and asks users to upload on the web app.

**Required:** `--target-language`.

**Expose product options when user cares (CLI flags):**

| Setting              | Flag                                                                                                                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original language    | `--original-language` (default `auto`)                                                                                                                                                                                                                              |
| Voice cloning model  | `--dub-preference auto\|real\|native` — `real` = VoiceREAL (keeps original voice's emotion/accent), `native` = VoiceNATIVE (natural target-language accent). **Never silently leave `auto` when the user voiced any accent/voice preference** — see SKILL.md §3.1.2 |
| Speakers             | `--speaker-number Auto\|1\|2\|3+`                                                                                                                                                                                                                                   |
| Subtitles on output  | `--enable-subtitles`                                                                                                                                                                                                                                                |
| Remove original subs | `--remove-original-subtitle` (needs enable-subtitles)                                                                                                                                                                                                               |
| Auto align video     | `--auto-align-video` (video only)                                                                                                                                                                                                                                   |
| Proofread before dub | `--proofread-before-dubbing` (Studio+)                                                                                                                                                                                                                              |
| Prompt               | `--prompt` (Creator+)                                                                                                                                                                                                                                               |
| Glossary             | `--glossary <ids...>` (Studio+)                                                                                                                                                                                                                                     |
| Folder               | `--folder`                                                                                                                                                                                                                                                          |

**Translate an existing project to more languages (Studio+):**

Currently supports **Translate & Dub projects only**.

```text
project translate_dub more-languages <id> --target-language <languages...>
  [--prompt <text> | --clear-prompt]
  [--glossary <ids...> | --clear-glossary]
  [--auto-align-video]
  [--proofread-before-dubbing]
  [--estimate-only]
```

- One request can include up to 40 unique target language/locale tags. If the
  user selects more than 40, ask them to reduce or split the selection before
  estimation; do not silently start multiple requests.
- Prompt and glossary inherit from the source project when omitted; explicit
  flags replace or clear them.
- Video speed adjustment (`autoAlignVideo`) inherits when omitted. Two-step
  translation (`proofreadBeforeDubbing`) defaults to off and is enabled only
  when the user explicitly requests `--proofread-before-dubbing`; it does not
  inherit from the source project.
- This uses the edited source project through `translate_to_more_language`; it
  is not equivalent to repeating `create` from the original media.
- Run with `--estimate-only` first, confirm the full target/settings plan and
  backend-returned `point`, then rerun without that flag. Membership and project
  status eligibility are validated only by the execution endpoint. The estimate
  endpoint only calculates points; success does not mean an execution precheck
  passed, and execution may still return a status/eligibility error. State this
  explicitly when presenting the estimate. If the API requires a library Voice
  replacement, hand off to the Web editor.
- If execution fails with `code: 1710`, run `auth membership` to fetch and
  report the current subscription state with the existing error message. Do not
  infer the plan from the error or retry automatically.
- If the command returns `Project not found.`, search the exact id with
  `project search "<id>" --kind all`. If another or omitted kind is identified,
  tell the user that this project type is not supported by More Languages; do
  not relabel an unmatched id as an unsupported type.

**Download artifacts (download as many as the user wants):**

| Artifact                  | Format |
| ------------------------- | ------ |
| `dubbed_video`            | mp4    |
| `dubbed_audio`            | wav    |
| `dubbed_audio_mp3`        | mp3    |
| `background_audio`        | wav    |
| `original_subtitle_srt`   | srt    |
| `original_subtitle_vtt`   | vtt    |
| `original_subtitle_txt`   | txt    |
| `translated_subtitle_srt` | srt    |
| `translated_subtitle_vtt` | vtt    |
| `translated_subtitle_txt` | txt    |

Subtitles are generated locally (no export). Video/audio often need `export` first. Background audio uses `bgmDownloadURL` after processing.

## Translate subtitles (`translate_subtitles`)

**Source:** same as dub but **video only**.

**Batch (2+ videos or a folder):** use **one** `--from-files` / `--from-dir` create (never loop `--from-file`). Requires **Studio+**. Not compatible with `--subtitle-file`.

**Single file / URL:** `--from-url` or `--from-file` only.

**Required:** `--target-language`.

| Setting              | Flag                                                      |
| -------------------- | --------------------------------------------------------- |
| Subtitle display     | `--subtitle-display translated_only\|original_translated` |
| Remove original subs | `--remove-original-subtitle`                              |
| Prompt / glossary    | `--prompt` (Creator+), `--glossary` (Studio+)             |
| Folder               | `--folder`                                                |

**Download:**

| Artifact                                        | Notes                           |
| ----------------------------------------------- | ------------------------------- |
| `translation_subtitle`                          | mp4, server; often needs export |
| `original_subtitle_*` / `translated_subtitle_*` | local from `segments`           |

## Visual translate (`visual_translate`)

**Source:** video only (`--from-url` | `--from-file` | `--from-files` | `--from-dir`). **Required:** `--target-language`, and `--original-language` — **this tool has no `auto` original language; the user must state it explicitly.**

| Setting                              | Flag                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------ |
| Prompt / glossary                    | `--prompt`, `--glossary`                                                 |
| List fonts                           | `project visual_translate fonts` (preset + your uploads when logged in)  |
| Custom font (local file)             | **`--font-file` only** — do not also pass `--font-family` / `--font-src` |
| Preset font (free ok)                | `--font-family <fontFullName>` (no `--font-src` needed)                  |
| Uploaded font / custom URL (Studio+) | `--font-family <fontFullName>` + `--font-src <fontURL>` (both, Studio+)  |
| Folder                               | `--folder`                                                               |

**Download:** `visual_translation` (mp4). No subtitle/tsv via CLI.

## Lipsync (`lipsync`)

**Source (exactly one):**

| Flag                          | Audio                                   |
| ----------------------------- | --------------------------------------- |
| `--from-url`                  | `from_this_video` (embedded in video)   |
| `--from-file`                 | `from_this_video`                       |
| `--from-files` / `--from-dir` | `from_this_video`                       |
| `--from-translation <dub-id>` | Dubbed track from translate dub project |

| Setting   | Flag                                                  |
| --------- | ----------------------------------------------------- |
| Face mode | `--face-mode single\|more` (**required**, no default) |
| Folder    | `--folder`                                            |

**Download:** `lipsync_video` (mp4).
