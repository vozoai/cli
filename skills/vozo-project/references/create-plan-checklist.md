# Create Plan Checklist (mandatory before `create`)

Use this file **every time** you present a create plan to the user. The plan is not complete until **every row for the chosen tool** is filled with the **resolved value** that will be sent to the CLI — including settings that use defaults.

**This checklist gates `create`.** Running `create` without the user having replied to a message that showed all applicable rows below is a protocol violation — regardless of any popup the user answered earlier. A choice prompt that collected missing fields (e.g. target language) is a data question, not a create confirmation (see SKILL.md §3).

**Presentation rules (important):**

- **Lead with product meaning, not CLI flags.** Show semantic labels the user can read (e.g. “Original language”, “Target language”, “Voice model”). Put the CLI code in parentheses only when helpful — e.g. `English (en)`, not `--original-language: en`.
- Do **not** present the plan as a bare list of `--flag` names. Users are confirming the job outcome, not the CLI syntax.
- Write `none` / `default` / `auto` explicitly when a setting is omitted from the command but the CLI will apply a default.
- Do **not** summarize with “other defaults” or “standard settings” — list each field.
- If a setting is unsupported for the chosen source mode (e.g. custom title on batch), write `not supported (batch)` — do not silently omit.
- Show human-readable language labels **and** the language/locale codes (`English (en)`, `Chinese (Hong Kong) (zh-HK)`, …).
- Resolve dashboard folder to `folderName (folderId: …)` when known.
- Prefer product names in the plan: **Translate & Dub**, **Translate Subtitles**, **Visual Translate**, **Lip Sync**.

---

## Shared fields (all tools)

| Show as (user-facing) | Resolved value |
| --- | --- |
| Product / tool | Translate & Dub / Translate Subtitles / Visual Translate / Lip Sync |
| Source | URL / local file / multiple files / local folder / from translated project + exact path(s) or id |
| Project count | `1` or estimated `N` |
| Dashboard folder | `none` or `Name (folderId: …)` |
| Project title | explicit title or `auto from filename` |
| Auto-download when done? | `yes` / `no` (§3.2) |
| Points / plan note | none or brief note |

---

## Translate & Dub (`translate_dub`)

| Show as (user-facing) | Resolved value |
| --- | --- |
| Target language | required label + code — use locale tags like `zh-HK` / `en-AU` when accent/region is needed |
| Original language | default `Auto-detect` unless overridden |
| Voice model | `Auto` / `VoiceREAL` / `VoiceNATIVE` — **always show** |
| Speakers | `Auto` / `1` / `2` / `3+` — single/url only; batch → `Auto (batch)` |
| Burn-in subtitles on output | `yes` / `no` |
| Remove original subtitles | `yes` / `no` (only if burn-in enabled) |
| Auto-align video | `yes` / `no` (video only) |
| Proofread before dubbing | `yes` / `no` |
| Translation prompt | `none` or text |
| Glossary | `none` or id list |
| Custom subtitle file | `none` or path (single only) |
| Subtitle file usage | `as original script` / `as translated script` (only if subtitle file set) |

---

## Translate Subtitles (`translate_subtitles`)

| Show as (user-facing) | Resolved value |
| --- | --- |
| Target language | required label + code — use locale tags like `zh-HK` / `en-AU` when accent/region is needed |
| Original language | default `Auto-detect` unless overridden |
| Subtitle display | `translated only` / `original + translated` |
| Remove original subtitles | `yes` / `no` |
| Translation prompt | `none` or text |
| Glossary | `none` or id list |
| Custom subtitle file | `none` or path (single only) |

---

## Visual Translate (`visual_translate`)

| Show as (user-facing) | Resolved value |
| --- | --- |
| Target language | required label + code — use locale tags like `zh-HK` / `en-AU` when accent/region is needed |
| Original language | required (no auto-detect) |
| Translation prompt | `none` or text |
| Glossary | `none` or id list |
| Font | `default` / uploaded file / preset family name |

---

## Lip Sync (`lipsync`)

| Show as (user-facing) | Resolved value |
| --- | --- |
| Source | video URL / local video / audio from a Translate & Dub project |
| Face mode | `single face` / `multiple faces` — **always show** |

---

## Example plan (Translate & Dub, single file)

```text
Create plan — please confirm:

Product: Translate & Dub
Source: local file — /Users/me/demo.mp4 (1 project)
Dashboard folder: Client A (folderId: 05896935)
Project title: auto from filename

Languages:
- Original language: Auto-detect
- Target language: English (en)

Voice & speakers:
- Voice model: VoiceNATIVE (natural target-language accent)
- Speakers: Auto

Subtitles & video:
- Burn-in subtitles on output: no
- Remove original subtitles: no
- Auto-align video: no
- Proofread before dubbing: no
- Custom subtitle file: none

Advanced:
- Translation prompt: none
- Glossary: none

After create: share web editor link; auto-download when finished: no
Points note: none
```

Wait for explicit user confirmation before running `create`.
