import { SpawnOptions } from 'node:child_process';
import { Command } from 'commander';

interface CliUserProfile {
    displayId: string | null;
    email: string | null;
    id: string | null;
    nickname: string | null;
    userState: string | null;
}
interface TokenSession {
    accessToken: string;
    apiBaseUrl: string;
    deviceId: string;
    displayId: string | null;
    email: string | null;
    expiresAt: string;
    refreshToken?: string;
    savedAt: string;
    tokenType: string;
    uid: string | null;
    userState: string | null;
}
interface StoredAuthSession extends TokenSession {
    profile: CliUserProfile | null;
}
interface AuthLoginOptions {
    apiBaseUrl?: string;
    code: string;
    email: string;
    csrfToken?: string;
}
interface TokenLoginOptions {
    accessToken: string;
    apiBaseUrl?: string;
    refreshToken?: string;
    tokenType?: string;
}
interface AuthLoginChallenge {
    apiBaseUrl: string;
    csrfToken?: string;
    email: string;
}
interface BrowserLoginOptions {
    apiBaseUrl?: string;
    callbackPath?: string;
    noOpen?: boolean;
    onCallbackReceived?: (payload: {
        callbackUrl: string;
    }) => void | Promise<void>;
    onPending?: (payload: {
        apiBaseUrl: string;
        callbackUrl: string;
        loginUrl: string;
    }) => void | Promise<void>;
    onWaiting?: (payload: {
        elapsedSeconds: number;
    }) => void | Promise<void>;
    port?: number;
    timeoutSeconds?: number;
    trackPending?: boolean;
    webAppUrl?: string;
}
interface BrowserLoginResult {
    authenticated: true;
    callbackUrl: string;
    loginUrl: string;
    sessionFile: string;
    status: 'authenticated';
    user: CliUserProfile;
}
interface BrowserLoginPendingResult {
    callbackUrl: string;
    loginUrl: string;
    mode: 'background';
    nextAction: string;
    pid: number;
    sessionFile: string;
    status: 'pending';
}
interface AuthLoginResult {
    authenticated: true;
    sessionFile: string;
    status: 'authenticated';
    user: CliUserProfile;
}
type AuthStatusResult = {
    status: 'auth_required';
    authenticated: false;
    reason: 'invalid_session' | 'missing_session';
    nextAction: string;
    sessionFile: string;
} | {
    status: 'authenticated';
    authenticated: true;
    sessionFile: string | null;
    source: 'environment' | 'local';
    user: CliUserProfile;
};
interface LogoutResult {
    authenticated: false;
    clearedLocalSession: boolean;
    remoteSessionTerminated: boolean;
    sessionFile: string;
    status: 'logged_out';
}

declare function loginWithEmail({ apiBaseUrl, code, csrfToken, email, }: AuthLoginOptions): Promise<AuthLoginResult>;
declare function requestEmailLoginCode({ apiBaseUrl, email, }: {
    apiBaseUrl?: string;
    email: string;
}): Promise<AuthLoginChallenge>;
declare function completeEmailLogin({ apiBaseUrl, code, csrfToken, email, }: AuthLoginOptions): Promise<AuthLoginResult>;
declare function loginWithAccessToken({ accessToken, apiBaseUrl, refreshToken, tokenType, }: TokenLoginOptions): Promise<AuthLoginResult>;
declare function loginWithBrowser({ apiBaseUrl, callbackPath, noOpen, onCallbackReceived, onPending, onWaiting, port, timeoutSeconds, trackPending, webAppUrl, }: BrowserLoginOptions): Promise<BrowserLoginResult>;
declare function waitForAuthenticatedSession(options?: {
    apiBaseUrl?: string;
    onPoll?: (elapsedSeconds: number) => void;
    pollIntervalMs?: number;
    timeoutSeconds?: number;
}): Promise<Extract<AuthStatusResult, {
    authenticated: true;
}>>;
declare function startBrowserLoginInBackground(cliEntry: string, options: BrowserLoginOptions): Promise<BrowserLoginPendingResult>;
declare function getAuthStatus(apiBaseUrlOverride?: string): Promise<AuthStatusResult>;
declare function logout(apiBaseUrlOverride?: string): Promise<{
    authenticated: boolean;
    clearedLocalSession: boolean;
    remoteSessionTerminated: boolean;
    sessionFile: string;
    status: "logged_out";
}>;

interface CallbackPayload {
    accessToken?: string;
    grantType?: string;
    key?: string;
    refreshToken?: string;
    state?: string;
    token?: string;
    tokenType?: string;
}
interface CallbackResult {
    callbackUrl: string;
    payload: CallbackPayload;
}
declare function createAuthCallbackListener(options: {
    callbackPath: string;
    port?: number;
    state: string;
    timeoutMs: number;
}): Promise<{
    done: Promise<CallbackResult>;
    dispose(): void;
    ready: Promise<{
        callbackUrl: string;
        port: number;
    }>;
}>;

interface OpenBrowserSpawnSpec {
    args: string[];
    command: string;
    options: SpawnOptions;
}
/**
 * Build the platform-specific process spawn spec used to open a URL.
 *
 * On Windows, `cmd /c start` treats unquoted `&` as a command separator, so a
 * login URL like `...?cli_auth=1&from=cli&redirect=...` would open as only
 * `...?cli_auth=1`. Quote the URL and use `/s` + `windowsVerbatimArguments`.
 */
declare function getOpenBrowserSpawnSpec(url: string, platform?: NodeJS.Platform): OpenBrowserSpawnSpec;
declare function openBrowser(url: string): Promise<void>;

interface CliUpgradeSuggestion {
    currentVersion: string;
    level: 'suggest';
    message: string;
    recommendedVersion: string | null;
}
/**
 * Record a soft upgrade suggestion once per process. Returns true when newly
 * noted (caller may print stderr); false if already noted.
 */
declare function noteCliUpgradeSuggestion(suggestion: CliUpgradeSuggestion): boolean;
/**
 * Attach a pending soft-upgrade notice to a command JSON payload (once).
 * Non-object payloads are left unchanged and keep the pending notice.
 */
declare function attachCliUpgradeSuggestion(payload: unknown): unknown;
/** For tests: reset the one-time suggest notice guard. */
declare function resetCliUpgradeSuggestState(): void;

type CliUpgradeLevel = 'must' | 'suggest';
type CliNetworkErrorDetails = {
    address?: string;
    code?: string;
    errno?: number | string;
    hostname?: string;
    port?: number;
    syscall?: string;
};
/**
 * Rewrites opaque undici `TypeError: fetch failed` into an actionable network
 * error (system code + host + agent-oriented hint).
 */
declare function buildNetworkRequestError(error: unknown, url: URL): CliNetworkError;
declare class CliApiError extends Error {
    code?: number;
    details?: unknown;
    status: number;
    constructor(message: string, status: number, code?: number, details?: unknown);
}
/** Thrown when the API requires a newer CLI (`upgrade: must`). */
declare class CliUpgradeRequiredError extends CliApiError {
    currentVersion: string;
    minimumVersion: string | null;
    constructor(message: string, status: number, options: {
        currentVersion: string;
        minimumVersion: string | null;
    });
}
/** Thrown when fetch cannot reach the API (DNS, TLS, timeout, reset, …). */
declare class CliNetworkError extends Error {
    details: CliNetworkErrorDetails;
    errorKind: 'network';
    url: string;
    constructor(message: string, options: {
        details?: CliNetworkErrorDetails;
        url: string;
    });
}
interface CliCommandErrorPayload {
    currentVersion?: string;
    errorKind?: 'network';
    message: string;
    minimumVersion?: string | null;
    network?: CliNetworkErrorDetails & {
        url?: string;
    };
    status: 'failed' | 'upgrade_required';
}
/** Shape printed to stdout when a top-level CLI command throws. */
declare function buildCliCommandErrorPayload(error: unknown): CliCommandErrorPayload;
declare function setCliClientRegion(apiBaseUrl: string | undefined, region: string | null | undefined): void;
declare function clearCliClientRegion(apiBaseUrl?: string): void;
declare function getCliClientRegion(apiBaseUrl?: string): string | undefined;
/** Mirrors web `navigator.language` via the host ICU locale. */
declare function resolveCliRequestLanguage(): string;
/** Mirrors web `Intl.DateTimeFormat().resolvedOptions().timeZone`. */
declare function resolveCliRequestTimezone(): string;
declare function buildDefaultApiRequestHeaders(extra?: Record<string, string>, apiBaseUrl?: string): {
    'X-Client-Type': string;
    'X-CLI-Version': string;
    'X-Product-Class': string;
    'X-Request-ID': string;
};
declare function prefetchCliClientRegion(options: {
    accessToken: string;
    apiBaseUrl: string;
    tokenType: string;
}): Promise<void>;
/** Auth completion paths must succeed on an outdated CLI so login can persist a session. */
declare function isCliUpgradeExemptRequest(path: string, method?: string): boolean;
/** Build an upgrade message for `upgrade: must` or `upgrade: suggest`. */
declare function resolveCliUpgradeHint(response: Response, level?: CliUpgradeLevel): string | null;
/** Build a blocking error when the API requires a newer CLI (any response status). */
declare function buildCliUpgradeRequiredError(response: Response): CliUpgradeRequiredError | null;
/** Print a one-time stderr reminder and queue stdout JSON notice for agents. */
declare function warnCliUpgradeIfSuggested(response: Response): void;
/**
 * Enforce `upgrade: must` and surface `upgrade: suggest` without blocking.
 * Call after response headers are available on every API response.
 */
declare function handleCliUpgradeHeaders(response: Response, options?: {
    skip?: boolean;
}): void;
/** Abort the current operation when `upgrade: must` is present in response headers. */
declare function assertNoCliUpgradeRequired(response: Response): void;

declare const CLI_VERSION: string;
/**
 * Format CLI semver for API request headers (e.g. `0.0.2` -> `v0.0.2`).
 * Strips prerelease/build metadata so backends can compare versions
 * (`0.0.2-dev.20260716150253` -> `v0.0.2`).
 */
declare function formatCliVersionForApiHeader(version: string): string;
declare const CLI_VERSION_API_HEADER: string;
declare function resolveUpgradeRepoUrl(override?: string): string;

declare function getSessionFilePath(): string;
declare function readStoredSession(): Promise<StoredAuthSession | null>;
declare function writeStoredSession(session: StoredAuthSession): Promise<void>;
declare function clearStoredSession(): Promise<void>;
declare function createDeviceId(): `${string}-${string}-${string}-${string}-${string}`;

interface CliUpgradeResult {
    fromVersion: string;
    installSpec: string;
    skills: 'installed' | 'skipped' | 'failed';
    status: 'upgraded';
    toVersion: string | null;
}
/**
 * Normalize a repository reference into an npm git install spec.
 * Accepts `org/repo` shorthand, https URLs, `git@host:path` SSH remotes, and
 * already-prefixed `git+...` / `github:` specs. `ref` pins a branch or tag.
 */
declare function buildUpgradeInstallSpec(repoUrl: string, ref?: string): string;
declare function runCliUpgrade(options: {
    ref?: string;
    repoUrl?: string;
    skipSkills?: boolean;
}): Promise<CliUpgradeResult>;

interface CliInstallResult {
    installSpec: string;
    skills: 'installed' | 'failed' | 'skipped';
    skillsMethod: 'skills_cli' | 'bundled' | 'skipped';
    status: 'installed';
    version: string | null;
}
/**
 * Resolve the CLI package install spec for `vozo-cli install`.
 * Default: npm registry (`@vozoai/cli`). Pass `github: true` for `github:vozoai/cli`.
 * Agent skills are always installed from GitHub separately.
 */
declare function resolveInstallSpec(options?: {
    github?: boolean;
    packageName?: string;
    ref?: string;
    repoUrl?: string;
}): string;
/**
 * One-shot bootstrap used by `npx @vozoai/cli install` (Lark-style):
 * 1. npm install -g the CLI (npm by default)
 * 2. install skills from GitHub via skills CLI, with bundled install as fallback
 */
declare function runCliInstall(options?: {
    github?: boolean;
    packageName?: string;
    ref?: string;
    repoUrl?: string;
    skipSkills?: boolean;
}): Promise<CliInstallResult>;

interface CliUserProfileResult {
    displayId: string | null;
    email: string | null;
    id: string | null;
    nickname: string | null;
    permissions: Record<string, string>;
    teamSpace: CliTeamSpaceResult | null;
    userState: string | null;
}
interface CliTeamSpaceResult {
    contact: string | null;
    teamId: string | null;
    teamName: string | null;
    teamRole: string | null;
    teamStatus: string | null;
}
interface CliMembershipResult {
    expiredAt: string | null;
    isExpired: boolean | null;
    packsQuantity: number | null;
    paymentType: string | null;
    planType: string | null;
    startedAt: string | null;
    upcomingPlanType: string | null;
    userType: string | null;
    vipStatus: string | null;
}
interface CliMembershipPointItem {
    availablePoint: number | null;
    expiredAt: string | null;
    isExpired: boolean | null;
    pointType: string | null;
    totalPoint: number | null;
}
interface CliMembershipStatusResult {
    membership: CliMembershipResult;
    user: CliUserProfileResult;
}
interface CliPointsStatusResult {
    points: CliMembershipPointItem[];
    totalAvailablePoints: number;
    totalPointBalance: number;
    user: CliUserProfileResult;
}
interface CliFeatureConfigResult {
    abTestUserTag: string[] | null;
    captionDurationQuota: number | null;
    creatorRewardsAccess: boolean | null;
    emailNotificationsEnabled: boolean | null;
    enableApiKeyCreation: boolean | null;
    existSuccessfulTranslation: boolean | null;
    exportWithWatermark: boolean | null;
    faceSwapCreated: boolean | null;
    featureConfig: unknown;
    firstFeature: string | null;
    freeProjectCount: number | null;
    freeTranslateCaptionCount: number | null;
    isVoiceUser: boolean | null;
    maxParallelQuantity: number | null;
    newUserOnboarded: boolean | null;
    parallelQuantity: number | null;
    precisionFreeLipSyncCount: number | null;
    translateCaptionDuration: number | null;
    translateFrameCount: number | null;
    translationLiteAvailableDuration: number | null;
    translationLiteDurationQuota: number | null;
    userIndustry: string | null;
    userRegion: string | null;
}
interface CliUserSummaryResult {
    features: CliFeatureConfigResult;
    membership: CliMembershipResult;
    points: CliMembershipPointItem[];
    profile: CliUserProfileResult;
}

declare function getUserProfile(apiBaseUrl?: string): Promise<CliUserProfileResult>;
declare function getUserMembership(apiBaseUrl?: string): Promise<CliMembershipResult>;
declare function getUserPoints(apiBaseUrl?: string): Promise<CliMembershipPointItem[]>;
declare function getUserMembershipStatus(apiBaseUrl?: string): Promise<CliMembershipStatusResult>;
declare function getUserPointsStatus(apiBaseUrl?: string): Promise<CliPointsStatusResult>;
declare function getUserFeatureConfig(apiBaseUrl?: string): Promise<CliFeatureConfigResult>;
declare function refreshCliClientRegion(apiBaseUrl?: string): Promise<void>;
declare function getUserSummary(apiBaseUrl?: string): Promise<CliUserSummaryResult>;

/**
 * Project status sets used by export guards and E2E wait helpers.
 * translate_dub statuses align with `TranslateProjectStatus` in shared-lib.
 */
/** translate_dub — in-flight statuses from TranslateProjectStatus */
declare const TRANSLATE_DUB_PROCESSING_STATUSES: readonly ["aligning_video", "created", "detecting", "dubbing", "processing", "proofreading", "redubbing", "regenerating", "retranslating"];
/** translate_subtitles — caption project processing statuses */
declare const TRANSLATE_SUBTITLES_PROCESSING_STATUSES: readonly ["in_queue", "preprocessing", "processing"];
/** lipsync — in-flight statuses from LipsyncProjectStatus */
declare const LIPSYNC_PROCESSING_STATUSES: readonly ["face_detecting", "in_queue", "preprocessing", "processing", "resync_in_queue", "resyncing"];
/** translate_dub — stash block in-flight statuses from BlockStatus */
declare const BLOCK_PROCESSING_STATUSES: readonly ["translating", "cloning", "dubbing", "reverting"];
declare function isBlockProcessingStatus(status: string | null | undefined): boolean;
declare function hasTranslationBlocksInProcessing(rawProject: unknown): boolean;
/** translate_subtitles — segment in-flight statuses from SubtitleSegmentStatus */
declare const SUBTITLE_SEGMENT_PROCESSING_STATUSES: readonly ["retranslating", "splitting"];
declare function isSubtitleSegmentProcessingStatus(status: string | null | undefined): boolean;
declare function hasSubtitleSegmentsInProcessing(rawProject: unknown): boolean;
/** True when a translate_subtitles project has segments with text but no timed subtitles yet. */
declare function hasCaptionSegmentsMissingSubtitles(rawProject: unknown): boolean;
/** Whether CLI should call `POST /v1/translate_captions/:pid/init_subtitles`. */
declare function shouldInitCaptionSubtitles(rawProject: unknown): boolean;
declare function isAsrProcessingStatus(status: string | null | undefined): boolean;
declare function hasAsrInProcessing(rawProject: unknown): boolean;
/** visual_translate — callout text in-flight statuses from CalloutText.status */
declare const CALLOUT_TEXT_EXPORT_BLOCKED_STATUSES: readonly ["retranslating"];
declare function isCalloutTextExportBlockedStatus(status: string | null | undefined): boolean;
declare function hasCalloutTextsInProcessing(rawProject: unknown): boolean;
/** Latest lipsync variant — matches Web editor default (`last(project.variants)`). */
declare function getLatestLipsyncVariant(rawProject: unknown): Record<string, unknown> | null;
declare function resolveLipsyncEffectiveStatus(rawProject: unknown, projectStatus: string | null | undefined): string | null;
declare function resolveProjectExportGuardStatus(kind: string, rawProject: unknown, projectStatus: string | null | undefined): string | null;
declare const EXPORT_BLOCKED_PROCESSING_STATUSES: Set<string>;
declare function normalizeProjectStatus(status: string | null | undefined): string;
declare function isExportBlockedProcessingStatus(status: string | null | undefined): boolean;
declare function isProjectCurrentlyExporting(status: string | null | undefined): boolean;
declare function isExportBlockedFailedStatus(status: string | null | undefined): boolean;
declare function assertProjectNotFailedForArtifactAccess(options: {
    id: string;
    kind: string;
    rawProject: unknown;
    status: string | null | undefined;
}): void;
/**
 * Proofreading dubs have translated script + voice picks but no finished dub
 * yet. Match the web editor (export/download hidden) and block CLI download,
 * including locally generated subtitle artifacts.
 */
declare function assertProjectNotAwaitingProofreadingForDownload(options: {
    id: string;
    kind: string;
    rawProject: unknown;
    status: string | null | undefined;
}): void;
declare function assertProjectNotCurrentlyExporting(options: {
    id: string;
    status: string | null | undefined;
}): void;

type CreateLimitKind = 'translate_dub' | 'translate_subtitles' | 'visual_translate' | 'lipsync';
/**
 * Local file size caps (bytes), aligned with the web `FileLimits` constants.
 */
declare const FILE_SIZE_LIMIT_BYTES: Record<CreateLimitKind, number>;
/**
 * Max files per batch create (`--from-files` / `--from-dir`), aligned with the
 * web `FileChooseDragger` default `maxCount`.
 */
declare const BATCH_CREATE_MAX_FILES = 40;
declare function assertBatchFileCountAllowed(filePaths: string[]): void;
/**
 * Default video resolution cap, aligned with the web `FileChooseDragger` defaults
 * (`long` 4096, `short` 2304, total pixels <= 4096 * 2304).
 */
declare const DEFAULT_VIDEO_RESOLUTION_LIMIT: {
    readonly long: 4096;
    readonly short: 2304;
};
type VideoResolutionLimit = {
    long: number;
    short: number;
};
/** Pixel count threshold for 1080p in lipsync duration rules. */
declare const LIPSYNC_1080P_PIXEL_LIMIT: number;
/** Max duration (seconds) for lipsync videos above 1080p, from web `duration4K`. */
declare const LIPSYNC_DURATION_4K_MAX_SECONDS: number;
declare function exceedsVideoResolutionLimit(width: number, height: number, limit?: VideoResolutionLimit): boolean;
declare function assertVideoResolutionAllowed(options: {
    filePath?: string;
    height: number;
    limit?: VideoResolutionLimit;
    width: number;
}): void;
declare function assertLipsyncVideoConstraints(options: {
    durationSeconds: number;
    filePath?: string;
    height: number;
    width: number;
}): void;
declare function assertCreateVideoResolutionAllowed(options: {
    durationSeconds?: number | null;
    filePath?: string;
    height: number;
    kind: CreateLimitKind;
    width: number;
}): void;
/**
 * Hard duration caps (seconds) `[min, max]`, aligned with the web `FileLimits`.
 * These apply to every membership tier.
 */
declare const DURATION_HARD_LIMIT_SECONDS: Record<CreateLimitKind, [
    number,
    number
]>;
/**
 * Map legacy API `userType` / `planType` values to the canonical plan names
 * used in the current product (free, pro, creator, studio, enterprise, etc.).
 */
declare function normalizeMembershipUserType(userType: string | null | undefined): string | null;
interface MembershipFlags {
    isBusiness: boolean;
    isMember: boolean;
    isPremium: boolean;
    isPro: boolean;
}
/**
 * Derive membership tier booleans from `membership.userType`, matching the web
 * `useAccount` logic (only `userType` participates in tier calculation).
 */
declare function deriveMembershipFlags(userType: string | null | undefined): MembershipFlags;
/**
 * Tier-based single-upload duration cap (seconds) for translate dub / subtitles,
 * matching the web `fileValidator` and `UploadDurationLimitModal` rules:
 * non-member or Pro -> 20min, Creator -> 60min, Business/Studio -> 120min.
 */
declare function tierMaxUploadSeconds(userType: string | null | undefined): number;
/**
 * Max `--prompt` length, aligned with the web `PromptInput` `MAX_PROMPT_LENGTH`.
 */
declare const MAX_USER_PROMPT_LENGTH = 1000;
/**
 * Validate `--prompt` length before create. Empty / omitted prompts are allowed.
 */
declare function assertUserPromptLength(userPrompt?: string | null): void;
/**
 * Commander option parser for `--prompt`. Rejects values longer than
 * {@link MAX_USER_PROMPT_LENGTH} before any network call.
 */
declare function parseUserPrompt(value: string): string;
interface CreateMembershipOptionCheck {
    batchItemCount?: number;
    glossaryIdList?: string[];
    hasCustomFont?: boolean;
    hasSubtitleFile?: boolean;
    proofreadBeforeDubbing?: boolean;
    userPrompt?: string;
}
/**
 * Validate create flags that the web UI gates by membership tier. Mirrors
 * `isBusiness` (Studio+) and `isMember && !isPro` (Creator prompt) checks.
 */
declare function assertMembershipForCreateOptions(userType: string | null | undefined, options: CreateMembershipOptionCheck): void;
declare const SPEAKER_NUMBER_VALUES: readonly ["1", "2", "3+", "Auto"];
type SpeakerNumber = (typeof SPEAKER_NUMBER_VALUES)[number];
declare function parseSpeakerNumber(value: string): SpeakerNumber;
/**
 * Dub voice mode (`dub_preference`), matching the web `LanguageSelection`
 * options: `auto` (smart), `real` (clone), `native` (native speaker).
 */
declare const DUB_PREFERENCE_VALUES: readonly ["auto", "real", "native"];
type DubPreference = (typeof DUB_PREFERENCE_VALUES)[number];
declare function parseDubPreference(value: string): DubPreference;
/**
 * Subtitle display mode (`subtitle_display_type`). Values match the web
 * subtitle-translation creation UI.
 */
declare const SUBTITLE_DISPLAY_VALUES: readonly ["translated_only", "original_translated"];
type SubtitleDisplayType = (typeof SUBTITLE_DISPLAY_VALUES)[number];
declare function parseSubtitleDisplayType(value: string): SubtitleDisplayType;
declare const FACE_MODE_VALUES: readonly ["single", "more"];
type FaceMode = (typeof FACE_MODE_VALUES)[number];
declare function parseFaceMode(value: string): FaceMode;
declare const SUBTITLE_USAGE_VALUES: readonly ["original", "translated"];
type SubtitleUsage = (typeof SUBTITLE_USAGE_VALUES)[number];
declare function parseSubtitleUsage(value: string): SubtitleUsage;
/**
 * Validate a language code / locale tag input. The backend is the authoritative
 * source for supported languages; this only catches obviously malformed values
 * (empty, whitespace, or non BCP-47-like strings) before any network call.
 */
declare function parseLanguageInput(value: string, flag: string): string;
/**
 * Sum available points the same way the web `UserStore` does: scale is already
 * applied by `getUserPoints`, keep only positive entries.
 */
declare function calcTotalPoints(points: {
    availablePoint: number | null;
}[]): number;
/**
 * Estimate points consumed by creating one project, mirroring the web cost
 * formulas. Returns 0 when the flow is free.
 */
declare function estimateConsumedPoints(options: {
    durationSeconds: number;
    enableSubtitles?: boolean;
    kind: CreateLimitKind;
    removeOriginalSubtitle?: boolean;
}): number;

interface CreateGuardItem {
    durationSeconds?: number | null;
    filePath?: string;
    height?: number | null;
    width?: number | null;
}
/** Effective upload duration cap for batch filtering (hard cap + tier cap). */
declare function resolveEffectiveDurationMaxSeconds(options: {
    kind: CreateLimitKind;
    membershipUserType: string | null | undefined;
    skipTierDuration: boolean;
}): {
    effectiveMaxSeconds: number;
    hardMinSeconds: number;
};
/**
 * Web's caption create flow caps members by their *remaining* caption duration
 * (`translateCaptionDuration`) and only uses `captionDurationQuota` — the plan's
 * total allowance — to render the limit in the error text. Non-members get no
 * pre-check here; the backend rejects them with code 1501 instead. The check is
 * skipped when the field is absent, matching the web uploader's
 * `maxDuration != undefined` guard.
 */
declare function assertCaptionDurationQuotaAllowed(options: {
    captionDurationQuota: number | null;
    isMember: boolean;
    totalDurationSeconds: number;
    translateCaptionDuration: number | null;
}): void;
interface PointsAllowanceInput {
    consumedPoints: number;
    itemCount: number;
    kind: CreateLimitKind;
    totalPoints: number;
    translateDubFirstUser: boolean;
    visualTranslateFirstUser: boolean;
}
type CreatePointsAllowance = 'ok' | 'partial_clip' | 'insufficient';
/**
 * Decide whether create may proceed given total available vs estimated consumption.
 * Batch creates never allow partial-clip fallbacks — insufficient total points
 * must reject the whole batch before upload.
 */
declare function evaluatePointsAllowanceForCreate(options: PointsAllowanceInput): CreatePointsAllowance;
interface CreateGuardEntitlements {
    features: Awaited<ReturnType<typeof getUserFeatureConfig>>;
    membership: Awaited<ReturnType<typeof getUserMembership>>;
    points: Awaited<ReturnType<typeof getUserPoints>>;
    profile: Awaited<ReturnType<typeof getUserProfile>>;
}
/**
 * Pre-creation entitlement and media guard. Mirrors the web creation checks so
 * the CLI fails fast (before any create API call) instead of relying solely on
 * backend error codes. Checks run in the same order the web app applies them:
 * membership expiry -> free project count -> duration caps -> caption duration
 * quota -> file size -> video resolution -> points.
 *
 * Returns the entitlement snapshot it fetched so callers (e.g. first-time clip
 * resolution) can reuse it instead of re-requesting points/features.
 */
declare function assertCreateAllowed(options: {
    apiBaseUrl?: string;
    enableSubtitles?: boolean;
    glossaryIdList?: string[];
    hasCustomFont?: boolean;
    hasSubtitleFile?: boolean;
    items: CreateGuardItem[];
    kind: CreateLimitKind;
    proofreadBeforeDubbing?: boolean;
    removeOriginalSubtitle?: boolean;
    userPrompt?: string;
}): Promise<CreateGuardEntitlements>;

/**
 * Mirrors `snakeToCamel` key conversion in `@clipp/shared-lib/http`.
 */
declare function snakeToCamelKey(key: string): string;
declare function normalizePermissionMap(permissions: Record<string, string>): Record<string, string>;

declare function resolveOriginalLanguageLabel(code: string | null | undefined): string | null;
declare function resolveTargetLanguageLabel(code: string | null | undefined): string | null;
declare function resolveTargetLocaleLabel(targetLanguage: string | null | undefined, targetLocale: string | null | undefined): string | null;
/**
 * Label for a value from `project languages` (base code or combined tag).
 * Prefer this when answering users about supported languages.
 */
declare function resolveLanguageCapabilityLabel(field: 'original-language' | 'target-language', value: string): string;
declare function enrichProjectLanguageLabels<T extends {
    originalLanguage: string | null;
    targetLanguage: string | null;
    targetLocale: string | null;
}>(project: T): T & {
    originalLanguageLabel: string | null;
    targetLanguageLabel: string | null;
    targetLocaleLabel: string | null;
};

declare function buildUndetectableMediaDurationError(filePath: string): string;

/** Mirrors `UserPermissions` in `@clipp/shared-lib/constants/user`. */
declare const USER_PERMISSIONS: {
    readonly accessShorts: "accessShorts";
    readonly copyProject: "copyProject";
    readonly createProject: "createProject";
    readonly deleteProject: "deleteProject";
    readonly editAudioTranslation: "editAudioTranslation";
    readonly editLipSync: "editLipsync";
    readonly editRewrite: "editRewrite";
    readonly editTranslateSubtitle: "editTranslateSubtitle";
    readonly editTranslation: "editTranslation";
    readonly manageFont: "manageFont";
    readonly manageSeat: "manageSeat";
    readonly manageSubtitleStyle: "manageSubtitleStyle";
    readonly manageSubscription: "manageSubscription";
    readonly moveProject: "moveProject";
    readonly purchaseSubscription: "purchaseSubscription";
    readonly renameProject: "renameProject";
    readonly shareProject: "shareProject";
    readonly showPoints: "showPoints";
};
declare function isTeamAccessSuspended(profile: CliUserProfileResult): boolean;
/**
 * Mirrors `usePermission().checkPermission` in the web app.
 */
declare function hasUserPermission(profile: CliUserProfileResult, required: string[]): boolean;
declare function buildPermissionDeniedError(options: {
    action: string;
    permissionKeys: string[];
    profile?: CliUserProfileResult;
}): string;
declare function assertUserPermission(options: {
    action: string;
    permissionKeys: string[];
    profile: CliUserProfileResult;
}): void;
declare function requireUserPermission(options: {
    action: string;
    apiBaseUrl?: string;
    permissionKeys: string[];
}): Promise<CliUserProfileResult>;

type CliProjectKind = 'all' | 'translate_dub' | 'lipsync' | 'audio-translation' | 'translate_subtitles' | 'visual_translate' | 'talking-photo';
type CliProjectArtifactType = 'dubbed_video' | 'dubbed_audio' | 'dubbed_audio_mp3' | 'background_audio' | 'translation_subtitle' | 'original_subtitle_srt' | 'original_subtitle_vtt' | 'original_subtitle_txt' | 'translated_subtitle_srt' | 'translated_subtitle_vtt' | 'translated_subtitle_txt' | 'visual_translation' | 'lipsync_video';
type CliProjectResolvedKind = Exclude<CliProjectKind, 'all'> | 'unknown';
interface CliProjectSummary {
    createdAt: string | null;
    duration: number | null;
    errorCode: string | null;
    /** User/agent-facing explanation aligned with web processing error copy. */
    errorMessage: string | null;
    folderId: string | null;
    id: string;
    kind: CliProjectResolvedKind;
    originalLanguage: string | null;
    originalLanguageLabel: string | null;
    /** True while the project (or any of its sub-tasks/exports) is still working. */
    processing: boolean;
    status: string | null;
    targetLanguage: string | null;
    targetLanguageLabel: string | null;
    targetLocale: string | null;
    targetLocaleLabel: string | null;
    title: string | null;
    updatedAt: string | null;
    webUrl: string | null;
}
interface CliProjectListResult {
    folderId: string | null;
    items: CliProjectSummary[];
    kind: CliProjectKind;
    nextCursor: string | null;
    /**
     * Present when this page omitted unsupported project types. Explains that
     * `totalCount` is the server total and may not match listable `items`.
     */
    notice: string | null;
    pageSize: number | null;
    searchKey: string;
    /** How many fetched items on this page were omitted (CLI-unsupported kinds). */
    skippedUnsupportedCount: number;
    /**
     * Server-reported total across all project types matching the query.
     * May exceed the sum of listable `items` across pages when unsupported
     * kinds (talking photo, voice studio, …) are filtered client-side.
     */
    totalCount: number | null;
}
interface CliProjectDetailResult {
    project: CliProjectSummary & {
        raw: unknown;
    };
}
interface CliProjectExportResult {
    artifact: CliProjectArtifactType;
    downloadUrl: string | null;
    id: string;
    kind: Exclude<CliProjectKind, 'all'>;
    project: CliProjectSummary & {
        raw: unknown;
    };
    status: 'started' | 'already_exported';
}
interface CliProjectArtifactDownloadResult {
    artifact: CliProjectArtifactType;
    contentLength?: number | null;
    contentType: string | null;
    downloadedUrl: string;
    id: string;
    kind: Exclude<CliProjectKind, 'all'>;
    outputPath: string | null;
    sourceUrl: string;
    verified?: boolean;
}
interface CliProjectOpenResult {
    id: string;
    kind: Exclude<CliProjectKind, 'all'>;
    url: string;
}
interface CliProjectDeleteResult {
    /** The ids the caller asked to delete — not a confirmation they were. */
    requestedIds: string[];
    /**
     * Whatever `batch_delete` returned. The API answers 200 with an empty body
     * today, so this is `null`; it carries the response verbatim if that changes.
     */
    result: unknown;
    status: 'ok';
}
interface CliProjectFolderSummary {
    folderId: string;
    folderName: string;
    projectCount: number | null;
    thumbUrls: string[];
}
interface CliProjectFolderListResult {
    folders: CliProjectFolderSummary[];
}
interface CliProjectFolderSearchResult {
    folders: CliProjectFolderSummary[];
    query: string;
}
interface CliProjectFolderCreateResult {
    folder: CliProjectFolderSummary;
    status: 'created';
}
interface CliProjectLanguageCapabilityOption {
    /** Human-readable label for agents/users (e.g. `English`, `Chinese (Hong Kong)`). */
    label: string;
    /** CLI / API language or locale tag (e.g. `en`, `zh-HK`). */
    value: string;
}
interface CliProjectLanguageFieldCapabilities {
    allowAuto: boolean;
    required: boolean;
    /** Prefer `supportedOptions` when presenting languages to users. */
    supportedOptions: CliProjectLanguageCapabilityOption[];
    supportedValues: string[];
}
interface CliVisualTranslateFontItem {
    fontFamily: string;
    fontFullName: string;
    fontID: string;
    fontURL: string;
    source: 'preset' | 'user';
}
interface CliVisualTranslateFontsResult {
    authenticated: boolean;
    presetFonts: CliVisualTranslateFontItem[];
    usage: {
        listCommand: string;
        localFile: string;
        presetOrRemote: string;
    };
    userFonts: CliVisualTranslateFontItem[];
}
interface CliProjectLanguageCapabilitiesResult {
    kind: 'lipsync' | 'translate_dub' | 'translate_subtitles' | 'visual_translate';
    originalLanguage: CliProjectLanguageFieldCapabilities;
    targetLanguage: CliProjectLanguageFieldCapabilities;
}
interface CliCreateTranslationProjectResult {
    id: string;
    kind: 'audio-translation' | 'translate_dub';
    status: 'started';
    title: string;
    webUrl: string;
    clip?: {
        originalDurationSeconds: number;
        durationSeconds: number;
        clipInterval: [number, number];
        reason: 'insufficient_points_first_time';
    } | null;
    warnings?: string[];
}
interface CliCreateCaptionProjectResult {
    id: string;
    kind: 'translate_subtitles';
    status: 'started';
    title: string;
    webUrl: string;
}
interface CliCreateFrameTranslationProjectResult {
    id: string;
    kind: 'visual_translate';
    status: 'started';
    title: string;
    webUrl: string;
    clip?: {
        originalDurationSeconds: number;
        durationSeconds: number;
        clipInterval: [number, number];
        reason: 'insufficient_points_first_time';
    } | null;
    warnings?: string[];
}
interface CliCreateLipsyncProjectResult {
    id: string;
    kind: 'lipsync';
    status: 'started';
    title: string;
    webUrl: string;
}
interface CliBatchCreateSkippedFile {
    durationSeconds?: number;
    filePath: string;
    reason: string;
    sizeBytes?: number;
}
interface CliBatchCreateProjectResult {
    ids: string[];
    kind: 'audio-translation' | 'translate_subtitles' | 'translate_dub' | 'visual_translate' | 'lipsync';
    skippedFiles?: CliBatchCreateSkippedFile[];
    status: 'started';
    warnings?: string[];
}

type LanguageToolKind = 'lipsync' | 'translate_dub' | 'translate_subtitles' | 'visual_translate';
type CapabilityField = 'original-language' | 'target-language';
declare function getProjectLanguageCapabilities(kind: LanguageToolKind): CliProjectLanguageCapabilitiesResult;
declare function assertSupportedProjectLanguage(options: {
    field: CapabilityField;
    kind: LanguageToolKind;
    value?: string | null;
}): string | undefined;
declare function requireProjectLanguage(options: {
    field: CapabilityField;
    kind: LanguageToolKind;
    value?: string | null;
}): string;
/**
 * Resolve create-time target language and locale for API payloads. Locale is
 * derived only from `--target-language` when the value is a combined tag
 * (e.g. `zh-HK` → `target_language: "zh"`, `target_locale: "HK"`). There is
 * no public `--target-locale` flag.
 */
declare function resolveCreateTargetLanguageAndLocale(options: {
    kind: 'translate_dub' | 'translate_subtitles' | 'visual_translate';
    targetLanguage: string;
}): {
    targetLanguage: string;
    targetLocale: string | undefined;
};

declare function getVisualTranslateFonts(options?: {
    apiBaseUrl?: string;
}): Promise<CliVisualTranslateFontsResult>;

interface SubtitleSection {
    end: number;
    start: number;
    text: string;
}
type SubtitleLanguage = 'original' | 'translated';
type SubtitleFileFormat = 'srt' | 'vtt' | 'txt';
declare function generateSubtitleContent(sections: SubtitleSection[], fileType: SubtitleFileFormat): string;
declare function isSubtitleArtifact(artifact: CliProjectArtifactType): boolean;
declare function parseSubtitleArtifact(artifact: CliProjectArtifactType): {
    format: SubtitleFileFormat;
    language: SubtitleLanguage;
};
declare function extractSubtitleSections(kind: 'translate_dub' | 'audio-translation' | 'translate_subtitles' | 'visual_translate' | 'lipsync' | 'talking-photo', rawProject: unknown, language: SubtitleLanguage): SubtitleSection[];
declare function inferSubtitleOutputPath(outputPath: string, format: SubtitleFileFormat): string;
/**
 * Default subtitle file name matching the web download rule:
 * `{title}_{original | target language name}_subtitles.{ext}`.
 */
declare function buildSubtitleFileName(options: {
    format: SubtitleFileFormat;
    language: SubtitleLanguage;
    targetLanguage?: string | null;
    title?: string | null;
}): string;

/**
 * Project titles/filenames sent on create must stay within the web limit
 * (videoInfo.name.slice(0, 100) on dashboard create flows).
 * CLI create does not expose `--title`; titles are always auto-derived.
 */
declare const MAX_PROJECT_TITLE_LENGTH = 100;
/** Soft-truncate auto-derived titles/filenames to the create limit. */
declare function truncateProjectTitle(title: string): string;
/** Resolve the auto-derived title that will be sent on create. */
declare function resolveProjectTitle(title: string): string;

/**
 * Subtitle upload size cap (bytes), aligned with web `FileLimits.translation.subtitleSize`.
 */
declare const SUBTITLE_FILE_SIZE_LIMIT_BYTES: number;
/**
 * Validate subtitle file content, mirroring web `validateSubtitles` in shared-lib.
 */
declare function validateSubtitleFileContent(content: string, maxEndTimeInSeconds: number): {
    valid: false;
    error: "no timestamp";
} | {
    valid: false;
    error: "timestamp invalid";
} | {
    valid: false;
    error: "timestamp overlap";
} | {
    valid: false;
    error: "timestamp overflow";
} | {
    valid: true;
    error?: undefined;
};
declare function assertSubtitleFileForTranslation(options: {
    subtitleFilePath: string;
    videoDurationSeconds: number;
}): Promise<void>;

/** Matches web `FontSelect` upload limit (30 MB). */
declare const FONT_FILE_SIZE_LIMIT_BYTES: number;
interface CliUserFont {
    fontFamily: string;
    fontFullName: string;
    fontID: string;
    fontPath: string;
    fontSubfamily: string;
    fontURL: string;
}
declare function listUserFonts(options?: {
    apiBaseUrl?: string;
}): Promise<CliUserFont[]>;
declare function assertFontFileForUpload(fontFilePath: string): Promise<void>;
declare function uploadUserFontFromFile(options: {
    apiBaseUrl?: string;
    filePath: string;
}): Promise<CliUserFont>;
declare function parseVisualTranslateFontOptions(options: {
    fontFamily?: string;
    fontFilePath?: string;
    fontSrc?: string;
}): {
    fontFilePath: string;
    fontKind: "uploaded_file";
    hasCustomFont: boolean;
    fontFamily?: undefined;
    fontSrc?: undefined;
} | {
    fontFamily: string;
    fontSrc: undefined;
    fontKind: "preset";
    hasCustomFont: boolean;
    fontFilePath?: undefined;
} | {
    fontFamily: string | undefined;
    fontSrc: string | undefined;
    fontKind: "custom_url" | "none";
    hasCustomFont: boolean;
    fontFilePath?: undefined;
};
declare function materializeVisualTranslateFont(options: {
    apiBaseUrl?: string;
    fontFamily?: string;
    fontFilePath?: string;
    fontSrc?: string;
}): Promise<{
    fontFamily?: string;
    fontSrc?: string;
}>;

type DetailKind = Exclude<CliProjectKind, 'all'>;
declare function buildProjectWebUrl(kind: DetailKind, id: string): string;
declare function buildProjectOpenUrl(kind: DetailKind, id: string): string;
declare function resolveProjectArtifactType(kind: DetailKind, artifactInput: string): CliProjectArtifactType;
declare function resolveProjectArtifactSourceUrl(kind: DetailKind, artifact: CliProjectArtifactType, rawProject: unknown): string | null;
/**
 * Match web `isRenderedWatermarkSame`: if the stored export has no watermark
 * flag, treat it as compatible; otherwise require an exact boolean match.
 */
declare function isRenderedWatermarkSame(rawProject: unknown, showWatermark: boolean): boolean;
/**
 * Audio projects created via translate_dub use /v1/audio_translations for detail,
 * export, and download. When the caller passes kind translate_dub, probe
 * /v1/translations first and fall back when the id belongs to audio-only work.
 */
declare const PROJECT_NOT_FOUND_MESSAGE = "Project not found.";
declare function isProjectNotFoundError(error: unknown): boolean;
declare function buildProjectNotFoundError(): Error;
declare function shouldFallbackToAudioTranslationDetail(error: unknown): boolean;
declare function parseProjectKind(kind: string): "translate_dub" | "translate_subtitles" | "visual_translate" | "lipsync" | "all" | "audio-translation";
/**
 * Derive the next list cursor from a page of results. The voice_projects API
 * expects the last item's project id as cursor (same as the web dashboard),
 * not the numeric nextPage field returned alongside the response.
 */
declare function resolveProjectListNextCursor(options: {
    hasCursor: boolean;
    items: Array<{
        id: string;
    }>;
    pageSize: number | null;
    totalCount: number | null;
}): string | null;
/**
 * Filter a fetched voice_projects page down to CLI-managed kinds and attach
 * pagination + agent-facing notice fields. Cursor advances over the
 * unfiltered page so omitted items are not re-fetched.
 */
declare function buildCliProjectListPage(options: {
    folderId: string | null;
    hasCursor: boolean;
    kind: CliProjectKind;
    pageItems: CliProjectSummary[];
    pageSize: number | null;
    searchKey: string;
    totalCount: number | null;
}): CliProjectListResult;
declare function listProjects(options: {
    apiBaseUrl?: string;
    cursor?: string;
    folderId?: string;
    kind: CliProjectKind;
    limit?: number;
    searchKey?: string;
}): Promise<CliProjectListResult>;
declare function getProject(options: {
    apiBaseUrl?: string;
    id: string;
    kind: DetailKind;
}): Promise<CliProjectDetailResult>;
declare function exportProject(options: {
    apiBaseUrl?: string;
    artifact?: string;
    id: string;
    kind: DetailKind;
}): Promise<CliProjectExportResult>;
/**
 * Fallback media file name matching the web download rule
 * `{title}_{target language name}_translated` for translated outputs. Only
 * used when the server response carries no Content-Disposition filename.
 */
declare function buildMediaArtifactFileNameBase(artifact: CliProjectArtifactType, project: {
    targetLanguageLabel: string | null;
    title: string | null;
}): string;
declare function downloadProjectArtifact(options: {
    apiBaseUrl?: string;
    artifact: string;
    checkOnly?: boolean;
    id: string;
    kind: DetailKind;
    outputPath?: string;
}): Promise<CliProjectArtifactDownloadResult>;
declare function openProject(options: {
    id: string;
    kind: DetailKind;
}): Promise<CliProjectOpenResult>;
declare function deleteProjects(options: {
    apiBaseUrl?: string;
    ids: string[];
}): Promise<CliProjectDeleteResult>;
/**
 * List folders the same way the web dashboard does: read `folders` from
 * `GET /v1/voice_projects` (not `/v1/voice_project_folders`). `page_size: 1`
 * is enough — the folders array is returned with the list payload.
 */
declare function listProjectFolders(options?: {
    apiBaseUrl?: string;
}): Promise<CliProjectFolderListResult>;
declare function findProjectFolderByExactName(folders: CliProjectFolderSummary[], folderName: string): CliProjectFolderSummary | null;
declare function assertReviewerCannotCreateProjectFolder(profile: CliUserProfileResult): void;
declare function createProjectFolder(options: {
    apiBaseUrl?: string;
    folderName: string;
}): Promise<CliProjectFolderCreateResult>;
declare function filterProjectFolders(folders: CliProjectFolderSummary[], query: string): CliProjectFolderSummary[];
declare function searchProjectFolders(options: {
    apiBaseUrl?: string;
    query: string;
}): Promise<CliProjectFolderSearchResult>;
declare function findProjectFolderById(folders: CliProjectFolderSummary[], folderId: string): CliProjectFolderSummary | null;
declare function resolveProjectFolderId(options: {
    apiBaseUrl?: string;
    folderId?: string;
    folderName?: string;
}): Promise<string | undefined>;
declare function createTranslationProjectFromUrl(options: {
    autoAlignVideo?: boolean;
    apiBaseUrl?: string;
    dubPreference?: 'auto' | 'real' | 'native';
    enableSubtitles?: boolean;
    folderId?: string;
    glossaryIdList?: string[];
    originalLanguage?: string;
    proofreadBeforeDubbing?: boolean;
    removeOriginalSubtitle?: boolean;
    sourceUrl: string;
    speakerNumber?: '1' | '2' | '3+' | 'Auto';
    targetLanguage: string;
    title?: string;
    userPrompt?: string;
}): Promise<CliCreateTranslationProjectResult>;
declare function createTranslationProjectFromFile(options: {
    autoAlignVideo?: boolean;
    apiBaseUrl?: string;
    dubPreference?: 'auto' | 'real' | 'native';
    enableSubtitles?: boolean;
    filePath: string;
    folderId?: string;
    glossaryIdList?: string[];
    originalLanguage?: string;
    proofreadBeforeDubbing?: boolean;
    removeOriginalSubtitle?: boolean;
    speakerNumber?: '1' | '2' | '3+' | 'Auto';
    subtitleFilePath?: string;
    subtitleUsage?: 'original' | 'translated';
    targetLanguage: string;
    title?: string;
    userPrompt?: string;
}): Promise<CliCreateTranslationProjectResult>;
declare function batchCreateTranslationProjectsFromFiles(options: {
    autoAlignVideo?: boolean;
    apiBaseUrl?: string;
    dubPreference?: 'auto' | 'real' | 'native';
    enableSubtitles?: boolean;
    filePaths: string[];
    folderId?: string;
    glossaryIdList?: string[];
    originalLanguage?: string;
    proofreadBeforeDubbing?: boolean;
    removeOriginalSubtitle?: boolean;
    targetLanguage: string;
    userPrompt?: string;
}): Promise<CliBatchCreateProjectResult>;
declare function createCaptionProjectFromUrl(options: {
    apiBaseUrl?: string;
    folderId?: string;
    glossaryIdList?: string[];
    originalLanguage?: string;
    removeOriginalSubtitle?: boolean;
    sourceUrl: string;
    subtitleDisplayType?: 'translated_only' | 'original_translated';
    targetLanguage: string;
    title?: string;
    userPrompt?: string;
}): Promise<CliCreateCaptionProjectResult>;
declare function createCaptionProjectFromFile(options: {
    apiBaseUrl?: string;
    filePath: string;
    folderId?: string;
    glossaryIdList?: string[];
    originalLanguage?: string;
    removeOriginalSubtitle?: boolean;
    subtitleDisplayType?: 'translated_only' | 'original_translated';
    subtitleFilePath?: string;
    subtitleUsage?: 'original' | 'translated';
    targetLanguage: string;
    title?: string;
    userPrompt?: string;
}): Promise<CliCreateCaptionProjectResult>;
declare function batchCreateCaptionProjectsFromFiles(options: {
    apiBaseUrl?: string;
    filePaths: string[];
    folderId?: string;
    glossaryIdList?: string[];
    originalLanguage?: string;
    removeOriginalSubtitle?: boolean;
    subtitleDisplayType?: 'translated_only' | 'original_translated';
    targetLanguage: string;
    userPrompt?: string;
}): Promise<CliBatchCreateProjectResult>;
declare function createFrameTranslationProjectFromUrl(options: {
    apiBaseUrl?: string;
    folderId?: string;
    fontFamily?: string;
    fontFilePath?: string;
    fontSrc?: string;
    glossaryIdList?: string[];
    originalLanguage?: string;
    sourceUrl: string;
    targetLanguage: string;
    title?: string;
    userPrompt?: string;
}): Promise<CliCreateFrameTranslationProjectResult>;
declare function createFrameTranslationProjectFromFile(options: {
    apiBaseUrl?: string;
    filePath: string;
    folderId?: string;
    fontFamily?: string;
    fontFilePath?: string;
    fontSrc?: string;
    glossaryIdList?: string[];
    originalLanguage?: string;
    /** Batch-internal: guard and folder validation already ran for all files. */
    skipCreateGuard?: boolean;
    targetLanguage: string;
    title?: string;
    userPrompt?: string;
}): Promise<CliCreateFrameTranslationProjectResult>;
declare function batchCreateFrameTranslationProjectsFromFiles(options: {
    apiBaseUrl?: string;
    filePaths: string[];
    folderId?: string;
    fontFamily?: string;
    fontFilePath?: string;
    fontSrc?: string;
    glossaryIdList?: string[];
    originalLanguage?: string;
    targetLanguage: string;
    userPrompt?: string;
}): Promise<CliBatchCreateProjectResult>;
declare function createLipsyncProjectFromUrl(options: {
    apiBaseUrl?: string;
    folderId?: string;
    faceMode: 'single' | 'more';
    sourceUrl: string;
    title?: string;
}): Promise<CliCreateLipsyncProjectResult>;
declare function createLipsyncProjectFromFile(options: {
    apiBaseUrl?: string;
    faceMode: 'single' | 'more';
    filePath: string;
    folderId?: string;
    /** Batch-internal: guard and folder validation already ran for all files. */
    skipCreateGuard?: boolean;
    title?: string;
}): Promise<CliCreateLipsyncProjectResult>;
/**
 * Sequential multi-file lipsync create (no backend batch API). Same shape as
 * visual_translate batch: one command returns `ids[]`, per-file failures go to
 * `skippedFiles` / `warnings` without discarding already-created projects.
 */
declare function batchCreateLipsyncProjectsFromFiles(options: {
    apiBaseUrl?: string;
    faceMode: 'single' | 'more';
    filePaths: string[];
    folderId?: string;
}): Promise<CliBatchCreateProjectResult>;
declare function createLipsyncProjectFromTranslation(options: {
    apiBaseUrl?: string;
    faceMode: 'single' | 'more';
    folderId?: string;
    title?: string;
    translationId: string;
}): Promise<CliCreateLipsyncProjectResult>;

type SkillTarget = 'cursor' | 'codex' | 'claude-code' | 'workbuddy' | 'agents' | 'all';
declare function resolveWorkbuddySkillsDir(homeDir?: string): string;
interface BundledSkill {
    name: string;
    dir: string;
    description?: string;
}
interface InstallSkillsResult {
    dryRun: boolean;
    installed: Array<{
        skill: string;
        targetDir: string;
        mode: 'copy' | 'symlink';
    }>;
    skills: string[];
    /** Agents skipped because their config directory does not exist. */
    skipped: Array<{
        target: string;
        agentRootDir: string;
        reason: string;
    }>;
    targets: string[];
}
declare function getBundledSkillsDir(): string;
declare function listBundledSkills(): BundledSkill[];
declare function installBundledSkills(options?: {
    target?: SkillTarget;
    skillNames?: string[];
    link?: boolean;
    /** Install into this directory instead of auto-detected agent directories. */
    path?: string;
    dryRun?: boolean;
}): InstallSkillsResult;

/**
 * Project processing failure codes aligned with web
 * `ErrCodeFailMsgMap` in `@clipp/shared-lib/constants/common`.
 *
 * CLI keeps English copy (no i18n runtime). Unknown codes still surface a
 * generic message that includes the raw `errorCode`.
 */
interface ProjectErrorInfo {
    errorCode: string | null;
    /** User/agent-facing explanation aligned with web processing copy. */
    errorMessage: string | null;
}
declare function resolveProjectErrorInfo(errorCode: string | null | undefined): ProjectErrorInfo;

declare function buildCli(): Command;

export { type AuthLoginChallenge, type AuthLoginOptions, type AuthLoginResult, type AuthStatusResult, BATCH_CREATE_MAX_FILES, BLOCK_PROCESSING_STATUSES, type BrowserLoginOptions, type BrowserLoginResult, CALLOUT_TEXT_EXPORT_BLOCKED_STATUSES, CLI_VERSION, CLI_VERSION_API_HEADER, CliApiError, type CliBatchCreateProjectResult, type CliCommandErrorPayload, type CliCreateCaptionProjectResult, type CliCreateFrameTranslationProjectResult, type CliCreateLipsyncProjectResult, type CliCreateTranslationProjectResult, type CliFeatureConfigResult, type CliMembershipPointItem, type CliMembershipResult, type CliMembershipStatusResult, CliNetworkError, type CliNetworkErrorDetails, type CliPointsStatusResult, type CliProjectArtifactDownloadResult, type CliProjectArtifactType, type CliProjectDeleteResult, type CliProjectDetailResult, type CliProjectExportResult, type CliProjectFolderCreateResult, type CliProjectFolderListResult, type CliProjectFolderSummary, type CliProjectKind, type CliProjectLanguageCapabilitiesResult, type CliProjectLanguageFieldCapabilities, type CliProjectListResult, type CliProjectOpenResult, type CliProjectResolvedKind, type CliProjectSummary, CliUpgradeRequiredError, type CliUpgradeSuggestion, type CliUserProfile, type CliUserProfileResult, type CliUserSummaryResult, DEFAULT_VIDEO_RESOLUTION_LIMIT, DURATION_HARD_LIMIT_SECONDS, EXPORT_BLOCKED_PROCESSING_STATUSES, FILE_SIZE_LIMIT_BYTES, FONT_FILE_SIZE_LIMIT_BYTES, LIPSYNC_1080P_PIXEL_LIMIT, LIPSYNC_DURATION_4K_MAX_SECONDS, LIPSYNC_PROCESSING_STATUSES, type LogoutResult, MAX_PROJECT_TITLE_LENGTH, MAX_USER_PROMPT_LENGTH, type OpenBrowserSpawnSpec, PROJECT_NOT_FOUND_MESSAGE, type ProjectErrorInfo, SUBTITLE_FILE_SIZE_LIMIT_BYTES, SUBTITLE_SEGMENT_PROCESSING_STATUSES, type StoredAuthSession, TRANSLATE_DUB_PROCESSING_STATUSES, TRANSLATE_SUBTITLES_PROCESSING_STATUSES, USER_PERMISSIONS, assertBatchFileCountAllowed, assertCaptionDurationQuotaAllowed, assertCreateAllowed, assertCreateVideoResolutionAllowed, assertFontFileForUpload, assertLipsyncVideoConstraints, assertMembershipForCreateOptions, assertNoCliUpgradeRequired, assertProjectNotAwaitingProofreadingForDownload, assertProjectNotCurrentlyExporting, assertProjectNotFailedForArtifactAccess, assertReviewerCannotCreateProjectFolder, assertSubtitleFileForTranslation, assertSupportedProjectLanguage, assertUserPermission, assertUserPromptLength, assertVideoResolutionAllowed, attachCliUpgradeSuggestion, batchCreateCaptionProjectsFromFiles, batchCreateFrameTranslationProjectsFromFiles, batchCreateLipsyncProjectsFromFiles, batchCreateTranslationProjectsFromFiles, buildCli, buildCliCommandErrorPayload, buildCliProjectListPage, buildCliUpgradeRequiredError, buildDefaultApiRequestHeaders, buildMediaArtifactFileNameBase, buildNetworkRequestError, buildPermissionDeniedError, buildProjectNotFoundError, buildProjectOpenUrl, buildProjectWebUrl, buildSubtitleFileName, buildUndetectableMediaDurationError, buildUpgradeInstallSpec, calcTotalPoints, clearCliClientRegion, clearStoredSession, completeEmailLogin, createAuthCallbackListener, createCaptionProjectFromFile, createCaptionProjectFromUrl, createDeviceId, createFrameTranslationProjectFromFile, createFrameTranslationProjectFromUrl, createLipsyncProjectFromFile, createLipsyncProjectFromTranslation, createLipsyncProjectFromUrl, createProjectFolder, createTranslationProjectFromFile, createTranslationProjectFromUrl, deleteProjects, deriveMembershipFlags, downloadProjectArtifact, enrichProjectLanguageLabels, estimateConsumedPoints, evaluatePointsAllowanceForCreate, exceedsVideoResolutionLimit, exportProject, extractSubtitleSections, filterProjectFolders, findProjectFolderByExactName, findProjectFolderById, formatCliVersionForApiHeader, generateSubtitleContent, getAuthStatus, getBundledSkillsDir, getCliClientRegion, getLatestLipsyncVariant, getOpenBrowserSpawnSpec, getProject, getProjectLanguageCapabilities, getSessionFilePath, getUserFeatureConfig, getUserMembership, getUserMembershipStatus, getUserPoints, getUserPointsStatus, getUserProfile, getUserSummary, getVisualTranslateFonts, handleCliUpgradeHeaders, hasAsrInProcessing, hasCalloutTextsInProcessing, hasCaptionSegmentsMissingSubtitles, hasSubtitleSegmentsInProcessing, hasTranslationBlocksInProcessing, hasUserPermission, inferSubtitleOutputPath, installBundledSkills, isAsrProcessingStatus, isBlockProcessingStatus, isCalloutTextExportBlockedStatus, isCliUpgradeExemptRequest, isExportBlockedFailedStatus, isExportBlockedProcessingStatus, isProjectCurrentlyExporting, isProjectNotFoundError, isRenderedWatermarkSame, isSubtitleArtifact, isSubtitleSegmentProcessingStatus, isTeamAccessSuspended, listBundledSkills, listProjectFolders, listProjects, listUserFonts, loginWithAccessToken, loginWithBrowser, loginWithEmail, logout, materializeVisualTranslateFont, normalizeMembershipUserType, normalizePermissionMap, normalizeProjectStatus, noteCliUpgradeSuggestion, openBrowser, openProject, parseDubPreference, parseFaceMode, parseLanguageInput, parseProjectKind, parseSpeakerNumber, parseSubtitleArtifact, parseSubtitleDisplayType, parseSubtitleUsage, parseUserPrompt, parseVisualTranslateFontOptions, prefetchCliClientRegion, readStoredSession, refreshCliClientRegion, requestEmailLoginCode, requireProjectLanguage, requireUserPermission, resetCliUpgradeSuggestState, resolveCliRequestLanguage, resolveCliRequestTimezone, resolveCliUpgradeHint, resolveCreateTargetLanguageAndLocale, resolveEffectiveDurationMaxSeconds, resolveInstallSpec, resolveLanguageCapabilityLabel, resolveLipsyncEffectiveStatus, resolveOriginalLanguageLabel, resolveProjectArtifactSourceUrl, resolveProjectArtifactType, resolveProjectErrorInfo, resolveProjectExportGuardStatus, resolveProjectFolderId, resolveProjectListNextCursor, resolveProjectTitle, resolveTargetLanguageLabel, resolveTargetLocaleLabel, resolveUpgradeRepoUrl, resolveWorkbuddySkillsDir, runCliInstall, runCliUpgrade, searchProjectFolders, setCliClientRegion, shouldFallbackToAudioTranslationDetail, shouldInitCaptionSubtitles, snakeToCamelKey, startBrowserLoginInBackground, tierMaxUploadSeconds, truncateProjectTitle, uploadUserFontFromFile, validateSubtitleFileContent, waitForAuthenticatedSession, warnCliUpgradeIfSuggested, writeStoredSession };
