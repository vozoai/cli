# Scenario Playbook

Read this file to find a ready-made command sequence for a common request shape. Pick the scenario closest to the user's request instead of re-deriving the plan from scratch. See `SKILL.md` for the shared workflow, confirmation rules, and display rules that still apply on top of these scenarios.

**Note:** Language codes in examples (`zh`, `en`, `ja`, etc.) are placeholders only. If the user has not named a target language, ask first—**do not** copy a language from a scenario title or sample command (see `SKILL.md` §3.1).

**Note:** Scenarios that include `export` / `download` steps apply **only when the user explicitly asked for exported files**. If they only asked to create or check status, stop after create/poll and share `webUrl` — do not run export/download from a scenario template alone (see `SKILL.md` §3.2).

## Contents

- [A. Folder → dub all videos to English](#a-folder--dub-all-videos-to-english)
- [B. YouTube URL → Chinese](#b-youtube-url--chinese)
- [C. YouTube → English dub + audio tracks + subtitles](#c-youtube--english-dub--audio-tracks--subtitles)
- [D. Multi-step pipeline (user order or you plan)](#d-multi-step-pipeline-user-order-or-you-plan)
- [E. One-shot multi-language creation (not translate-more)](#e-one-shot-multi-language-creation-not-translate-more)
- [F. Folder → dub zh/ja/fr + lip sync each](#f-folder--dub-zhjafr--lip-sync-each)
- [G. Bulk download with filters (agent orchestrates)](#g-bulk-download-with-filters-agent-orchestrates)

## A. Folder → dub all videos to English

**One batch `create`** — use `--from-dir` or `--from-files`; **never** loop `--from-file` per file:

```text
vozo-cli project translate_dub create \
  --from-dir "/path/to/folder" \
  --target-language en
```

- Returns `ids[]` for batch. Poll each `get`. Download per id. Share each `webUrl`.
- Requires Studio+ for batch `--from-dir` / `--from-files`.

## B. YouTube URL → Chinese

Clarify **dub** vs **subtitles** if ambiguous:

- **Dub:** `translate_dub create --from-url "<url>" --target-language zh` (or `zh-CN`)
- **Translate subtitles:** `translate_subtitles create --from-url "<url>" --target-language zh`

Then poll → export if needed → download.

## C. YouTube → English dub + audio tracks + subtitles

```text
project translate_dub create --from-url "<url>" --target-language en [--enable-subtitles]
# after ready:
project translate_dub download <id> --artifact dubbed_audio --output ./out/<id>/
project translate_dub download <id> --artifact dubbed_audio_mp3 --output ./out/<id>/
project translate_dub download <id> --artifact translated_subtitle_srt --output ./out/<id>/
# Downloads: pass a directory (trailing `/`) as --output so files get the same
# product names as web downloads (e.g. `{title}_{language}_translated.mp4`,
# `{title}_{language}_subtitles.srt`); only pass a file path when the user
# explicitly asked for a custom name.
# optional: dubbed_video, background_audio, original/translated vtt/txt
```

## D. Multi-step pipeline (user order or you plan)

User may say steps explicitly, or only the end goal—**propose an ordered plan** and confirm. Before planning, resolve whether this is **D1 (independent)** or **D2 (chained)** per `SKILL.md` §3.6 — if the user's phrasing doesn't make it obvious, ask.

If the user does **not** specify tool order, use this default planning priority:

1. `translate_dub`
2. `translate_subtitles`
3. `visual_translate`
4. `lipsync`

Interpretation rules:

- Respect the user's explicit order when they give one.
- When the user only states the goal, start from the highest-priority applicable tool and append the rest in this order.
- `lipsync` should stay last unless the user explicitly asks for another order, because it is usually derived from the output of an earlier step.

### D1. Independent multi-tool (default when steps don't depend on each other)

Each tool creates its own project from the **same original source**. Outputs don't affect each other — the user combines them manually on the web if they want one final file.

Example: folder → English dub + on-screen text + lip sync:

1. `translate_dub create --from-dir ... --target-language en` → wait all `ids`
2. `visual_translate create --from-dir ... --target-language en --original-language <src>` → wait (same files, separate projects)
3. For each dub id: `lipsync create --from-translation <dub-id> --face-mode single|more` → wait → download `lipsync_video`

Rules:

- Lipsync from dub uses `--from-translation` (dub audio, not raw video audio) — this is the one native chain path the CLI supports.
- Visual translate does not chain from dub id in CLI—reuse same `--from-dir` / files unless user only wants lipsync on dub output (then dub → lipsync only).
- Run steps sequentially; do not download until each step's status is ready.

### D2. Chained multi-tool (pipeline via exported output)

Use this when the user wants one tool's _output_ to feed the next tool's _input_ — e.g. "dub it, then also translate the on-screen text on the dubbed video" or the reverse order. Neither `translate_dub create` nor `visual_translate create` accepts a project ID as a source (only `--from-url` / `--from-file` / `--from-files` / `--from-dir`), so chaining is done by hand:

1. `translate_dub create --from-file source.mp4 --target-language en` → wait → `export` → `download --artifact dubbed_video --output ./tmp/<id>/`
2. `visual_translate create --from-file ./tmp/dub_output.mp4 --target-language en --original-language <on-screen text's actual language, not `en`>` → wait → `export` → `download`

(Or run visual translate first, then feed its `visual_translation` output into `translate_dub --from-file`.)

Rules:

- `lipsync` still uses its native `--from-translation <dub-id>` instead of this download/re-upload pattern — never manually export/re-upload for a dub → lipsync chain.
- Each step in the chain is slower and costs more than D1: no parallelism, and each step reprocesses the full output of the previous one. Say this cost/time tradeoff in the plan so the user can confirm.
- Dub only changes the audio track; visual translate only changes burned-in on-screen text. When setting the next step's `--original-language`, use that step's own input channel language (on-screen text language for visual translate, spoken audio language for dub) — do not just copy the previous step's `--target-language`.

## E. One-shot multi-language creation (not translate-more)

**Not** `translate more` on one project. Repeat **create** per target language:

```text
for lang in en ja fr; do
  vozo-cli project translate_dub create --from-dir "/folder" --target-language "$lang"
done
```

Each call creates a full batch for that language. Track `ids` per language. Points and free-count multiply.

## F. Folder → dub zh/ja/fr + lip sync each

1. Three batch creates: `--target-language zh`, `ja`, `fr` on same `--from-dir`.
2. After each language's dub projects complete, `lipsync create --from-translation <dub-id> --face-mode single|more` per project (or per user scope).
3. Download `lipsync_video` (+ optional dub artifacts).

## G. Bulk download with filters (agent orchestrates)

CLI has no single "batch download" command. Pattern:

1. **List or search** with filters where possible:
   - Folder: `project list --folder <folderId>`
   - Kind: `project list --kind translate_subtitles`
   - Title: `project search "AAAA"`
   - All: `project list --kind all` + paginate `--cursor`
   - **Do not equate `totalCount` with listable rows.** The server total can include types this CLI omits (talking photo, voice studio, …). When that happens, the page includes `skippedUnsupportedCount` and a `notice`. Trust `items[]` + `nextCursor` for pagination; ignore the gap vs `totalCount`.
2. **Filter in agent** on `items[]`:
   - Last 7 days: `createdAt` within 7 days
   - Target English: `targetLanguage` matches `en` / English variants
   - Subtitle projects: `kind === translate_subtitles`
3. For each match, **download** requested artifacts into a structured tree, e.g.:

```text
./downloads/<folderName>/<kind>/<projectId>/
  dubbed_video.mp4
  dubbed_audio.wav
  translated_subtitle.srt
```

4. Confirm before overwriting paths. Use `export` when download fails for media.

**Example intents → approach:**

| User request                                           | Approach                                                                                 |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Create a new dashboard folder, then add projects there | `folder create "<name>"` → use `folder.folderId` on `create --folder <id>`               |
| Download all videos/audio/subs in folder X             | `folder list` or `folder search` → `list --folder <id>` → download artifacts per project |
| Download all subtitle translation projects             | `list --kind translate_subtitles` → download each                                        |
| Download projects from last 7 days                     | `list --kind all` (+ pages) → filter `createdAt` → download                              |
| Download all projects translated to English            | list + filter `targetLanguage` → download                                                |
| Download projects whose name contains "AAAA"           | `search AAAA` → download                                                                 |
