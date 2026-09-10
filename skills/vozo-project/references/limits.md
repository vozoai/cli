# Creation Limits (CLI pre-check)

Read this file before `create` if the user's media may be near a duration/size/tier cap, or if they ask for a points estimate. See `SKILL.md` §3 for when to report points deltas to the user.

Fails **before** upload/API if violated:

- Membership expired; free project count exhausted; insufficient points.
- Duration hard caps: dub/subtitles 2h; visual 20min; lipsync 1h.
- Tier upload caps (dub/subtitles only): free or Pro 20min; Creator 60min; Studio+ 120min per file.
  - **First Translate & Dub create green channel:** if the account has never completed a successful translation (`existSuccessfulTranslation === false`), the **tier** upload cap is skipped for `translate_dub` only (hard caps still apply). This matches the web upload validator. After the first successful dub, free/Pro users are again limited to 20 minutes per upload. `translate_subtitles` always applies the tier cap (no green channel).
- File size: 4.5 GB (dub), 2.5 GB (subtitles/lipsync), 2 GB (visual).
- Studio+ for batch `--from-dir` / `--from-files` (never substitute N× `--from-file`); Studio+ for glossary, proofread, custom font; Creator+ for `--prompt`.
- Batch create (`--from-files` / `--from-dir`): at most **40 files** per command (same as the web uploader). Split larger sets into multiple batches.
- Project title / upload filename: max **100 characters** (auto from source filename or page title; truncated to match the web create flow).

**Estimated points per project** (CLI pre-check; 0 = free):

| Tool                  | Formula                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------ |
| `translate_dub`       | `duration / 20`; with `--enable-subtitles` + `--remove-original-subtitle`: `duration / 15` |
| `translate_subtitles` | `0`; with `--remove-original-subtitle`: `duration / 60`                                    |
| `visual_translate`    | `duration / 6`                                                                             |
| `lipsync`             | `5 + ceil(duration / 12)`                                                                  |

`duration` is media length in seconds. Batch create multiplies by item count and target languages. **If total estimated points exceed available balance, the entire batch is rejected before any upload** (no partial batch, no per-file clip fallback).

For `translate_dub more-languages`, do not use a local formula. Run the resolved
command with `--estimate-only` and use the backend-returned `point` value in the
confirmation plan. After confirmation, rerun the same command without
`--estimate-only`.

Rounding: **points estimates should be rounded to 2 decimal places (half-up)**, matching the CLI `round2` / `estimateConsumedPoints` behavior.

**These formulas are estimates for the create plan only — they are not what the backend charged** (SKILL.md §3). Use them _before_ a create so the user can weigh the cost against their balance, and label them as estimates. **After a create succeeds, do not report consumption at all**: a failed project is charged nothing, an auto-clipped run bills the clipped length, and the CLI has no access to the actual charge. Do not infer the cost by diffing `auth points` either — the balance is account-wide, so concurrent projects from the web app or another terminal land in the same number.

Report the specific CLI error; suggest shorter media, upgrade, or top up points.
