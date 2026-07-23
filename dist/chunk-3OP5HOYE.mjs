#!/usr/bin/env node

// src/core/config.ts
var CLI_VERSION = "0.0.3";
function formatCliVersionForApiHeader(version) {
  const withoutPrefix = version.trim().replace(/^v/i, "");
  const coreMatch = withoutPrefix.match(/^(\d+\.\d+\.\d+)/);
  const core = coreMatch?.[1] ?? withoutPrefix;
  return `v${core}`;
}
var CLI_VERSION_API_HEADER = formatCliVersionForApiHeader(CLI_VERSION);
var DEFAULT_API_BASE_URL = "https://api-kea.vozo.ai";
var DEFAULT_WEB_APP_URL = "https://app.vozo.ai";
var DEFAULT_SESSION_DIR_NAME = "cli";
var CLI_BUILD_CHANNEL = "prod";
var DEFAULT_UPGRADE_REPO_URL = "https://github.com/vozoai/cli.git";
function resolveUpgradeRepoUrl(override) {
  return override?.trim() || process.env.VOZO_CLI_UPGRADE_REPO?.trim() || DEFAULT_UPGRADE_REPO_URL;
}
function resolveApiBaseUrl(override) {
  return override ?? process.env.VOZO_CLI_API_URL ?? DEFAULT_API_BASE_URL;
}
function resolveWebAppUrl(override) {
  if (override) {
    return override;
  }
  const fromEnv = process.env.NEXT_WEBAPP_HOST?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return DEFAULT_WEB_APP_URL;
}
function isDevRequestDebugEnabled() {
  if (process.env.VOZO_CLI_DEBUG === "1") {
    return true;
  }
  return CLI_BUILD_CHANNEL === "dev";
}

// src/core/cli-upgrade-notice.ts
var pendingUpgradeSuggestion = null;
var upgradeSuggestionNoted = false;
function noteCliUpgradeSuggestion(suggestion) {
  if (upgradeSuggestionNoted) {
    return false;
  }
  upgradeSuggestionNoted = true;
  pendingUpgradeSuggestion = suggestion;
  return true;
}
function attachCliUpgradeSuggestion(payload) {
  if (!pendingUpgradeSuggestion) {
    return payload;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || "upgradeSuggestion" in payload) {
    return payload;
  }
  const upgradeSuggestion = pendingUpgradeSuggestion;
  pendingUpgradeSuggestion = null;
  return {
    ...payload,
    upgradeSuggestion
  };
}
function resetCliUpgradeSuggestState() {
  pendingUpgradeSuggestion = null;
  upgradeSuggestionNoted = false;
}

// src/utils/output.ts
function printJson(payload) {
  const enriched = attachCliUpgradeSuggestion(payload);
  process.stdout.write(`${JSON.stringify(enriched, null, 2)}
`);
}
function printStdout(message) {
  process.stdout.write(`${message}
`);
}
function printStderr(message) {
  process.stderr.write(`${message}
`);
}
function printCliEvent(event) {
  printStderr(`VOZO_CLI_EVENT ${JSON.stringify(event)}`);
}

// src/core/api.ts
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// src/core/entitlements.ts
function getWebAppUrl() {
  return resolveWebAppUrl();
}
function getPricingPageUrl() {
  return new URL("/pricing", getWebAppUrl()).toString();
}
var PRICING_HINTS = {
  permission: "Visit the pricing page to upgrade your plan and unlock this feature.",
  plan: "Visit the pricing page to see plans and upgrade your benefits.",
  points: "Visit the pricing page to upgrade your plan or purchase more points.",
  renew: "Visit the pricing page to renew or upgrade your membership."
};
function formatPricingUpgradeHint(kind) {
  return `${PRICING_HINTS[kind]} ${getPricingPageUrl()}`;
}
function buildEntitlementError(message, kind) {
  return `${message}
${formatPricingUpgradeHint(kind)}`;
}
var API_ENTITLEMENT_ERROR_CODES = {
  freeTrialLimit: 620,
  insufficientPoints: 104,
  membershipExpired: 622,
  parallelTaskLimit: 621,
  upgradeRequired: 623
};
function resolveApiEntitlementHint(errorPayload, baseMessage) {
  const payload = errorPayload && typeof errorPayload === "object" ? errorPayload : null;
  const code = payload?.code;
  const normalizedMessage = baseMessage.toLowerCase();
  if (code === API_ENTITLEMENT_ERROR_CODES.insufficientPoints || /insufficient point|not enough point|lack.*point|points?.*not enough/i.test(
    baseMessage
  )) {
    return formatPricingUpgradeHint("points");
  }
  if (code === API_ENTITLEMENT_ERROR_CODES.membershipExpired || /membership.*expired|subscription.*expired|vip.*expired/i.test(baseMessage)) {
    return formatPricingUpgradeHint("renew");
  }
  if (code === API_ENTITLEMENT_ERROR_CODES.upgradeRequired || /upgrade to access|permission denied|not authorized|requires.*membership|membership required/i.test(
    baseMessage
  )) {
    return formatPricingUpgradeHint("permission");
  }
  if (code === API_ENTITLEMENT_ERROR_CODES.freeTrialLimit || /free trial|free project.*limit|trial limit/i.test(normalizedMessage)) {
    return formatPricingUpgradeHint("plan");
  }
  if (/upgrade your plan|upgrade.*plan|higher plan/i.test(baseMessage)) {
    return formatPricingUpgradeHint("plan");
  }
  return null;
}

// src/core/api.ts
var CLI_CLIENT_TYPE_HEADER = "cli";
var CLI_UPGRADE_HEADER = "upgrade";
var CLI_MIN_VERSION_HEADER = "x-cli-min-version";
var REQUEST_TIMEOUT_MS = 12e4;
function isAbortOrTimeoutError(error) {
  return typeof error === "object" && error !== null && "name" in error && (error.name === "TimeoutError" || error.name === "AbortError");
}
function buildRequestTimeoutError(url) {
  return new Error(
    `Request to ${url.pathname} timed out after ${REQUEST_TIMEOUT_MS / 1e3}s. Check your network connection and try again.`
  );
}
function asErrorLike(value) {
  return typeof value === "object" && value !== null ? value : null;
}
function readOptionalString(value) {
  return typeof value === "string" && value.length > 0 ? value : void 0;
}
function readOptionalNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function collectErrorChain(error) {
  const chain = [];
  const queue = [error];
  const seen = /* @__PURE__ */ new Set();
  while (queue.length > 0) {
    const current = queue.shift();
    if (current == null || seen.has(current)) {
      continue;
    }
    seen.add(current);
    const like = asErrorLike(current);
    if (!like) {
      continue;
    }
    chain.push(like);
    if (like.cause !== void 0) {
      queue.push(like.cause);
    }
    if (Array.isArray(like.errors)) {
      for (const nested of like.errors) {
        queue.push(nested);
      }
    }
  }
  return chain;
}
function extractNetworkErrorDetails(error) {
  const chain = collectErrorChain(error);
  if (chain.length === 0) {
    return null;
  }
  const details = {};
  for (const item of chain) {
    details.code ??= readOptionalString(item.code);
    details.syscall ??= readOptionalString(item.syscall);
    details.hostname ??= readOptionalString(item.hostname);
    details.address ??= readOptionalString(item.address);
    details.port ??= readOptionalNumber(item.port);
    if (details.errno === void 0) {
      if (typeof item.errno === "number" || typeof item.errno === "string") {
        details.errno = item.errno;
      }
    }
  }
  return details.code || details.syscall || details.hostname || details.address || details.port !== void 0 || details.errno !== void 0 ? details : null;
}
function hintForNetworkCode(code) {
  switch (code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "DNS lookup failed \u2014 the API host could not be resolved. Check DNS, VPN, offline mode, or VOZO_CLI_API_URL.";
    case "ECONNREFUSED":
      return "Connection refused \u2014 nothing accepted the TCP connection. Check that the API host/port is reachable and VOZO_CLI_API_URL is correct.";
    case "ECONNRESET":
    case "EPIPE":
      return "Connection was reset mid-request. Often transient \u2014 retry; if it persists, check proxy/firewall stability.";
    case "ETIMEDOUT":
    case "UND_ERR_CONNECT_TIMEOUT":
    case "UND_ERR_HEADERS_TIMEOUT":
    case "UND_ERR_BODY_TIMEOUT":
      return "Network timed out while connecting or waiting for headers. Check latency, firewall, proxy, or try again.";
    case "ENETUNREACH":
    case "EHOSTUNREACH":
      return "Host/network unreachable. Check internet connectivity, VPN, or routing.";
    case "CERT_HAS_EXPIRED":
    case "CERT_NOT_YET_VALID":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      return "TLS/certificate verification failed. Check system time, corporate SSL inspection, or custom CA trust.";
    default:
      return "Unable to reach the Vozo API. Check internet connectivity, proxy/firewall, DNS, and VOZO_CLI_API_URL, then retry.";
  }
}
function summarizeNetworkCause(error) {
  const chain = collectErrorChain(error);
  const details = extractNetworkErrorDetails(error);
  const parts = [];
  if (details?.code) {
    parts.push(details.code);
  }
  if (details?.syscall) {
    parts.push(details.syscall);
  }
  const location = details?.hostname || (details?.address ? details.port !== void 0 ? `${details.address}:${details.port}` : details.address : void 0);
  if (location) {
    parts.push(location);
  }
  if (parts.length > 0) {
    return parts.join(" ");
  }
  for (const item of chain) {
    const message = readOptionalString(item.message);
    if (message && message !== "fetch failed") {
      return message;
    }
  }
  const top = asErrorLike(error);
  return readOptionalString(top?.message) ?? String(error);
}
function buildNetworkRequestError(error, url) {
  const details = extractNetworkErrorDetails(error) ?? {};
  if (!details.hostname) {
    details.hostname = url.hostname;
  }
  const causeSummary = summarizeNetworkCause(error);
  const hint = hintForNetworkCode(details.code);
  const message = `Network request to ${url.origin}${url.pathname} failed: ${causeSummary}. ${hint}`;
  return new CliNetworkError(message, {
    details,
    url: `${url.origin}${url.pathname}`
  });
}
function rethrowFetchFailure(error, url) {
  if (isAbortOrTimeoutError(error)) {
    throw buildRequestTimeoutError(url);
  }
  throw buildNetworkRequestError(error, url);
}
var CliApiError = class extends Error {
  code;
  details;
  status;
  constructor(message, status, code, details) {
    super(message);
    this.name = "CliApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
};
var CliUpgradeRequiredError = class extends CliApiError {
  currentVersion;
  minimumVersion;
  constructor(message, status, options) {
    super(message, status);
    this.name = "CliUpgradeRequiredError";
    this.currentVersion = options.currentVersion;
    this.minimumVersion = options.minimumVersion;
  }
};
var CliNetworkError = class extends Error {
  details;
  errorKind;
  url;
  constructor(message, options) {
    super(message);
    this.name = "CliNetworkError";
    this.errorKind = "network";
    this.url = options.url;
    this.details = options.details ?? {};
  }
};
function buildCliCommandErrorPayload(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof CliUpgradeRequiredError) {
    return {
      currentVersion: error.currentVersion,
      message,
      minimumVersion: error.minimumVersion,
      status: "upgrade_required"
    };
  }
  if (error instanceof CliNetworkError) {
    return {
      errorKind: "network",
      message,
      network: {
        ...error.details,
        url: error.url
      },
      status: "failed"
    };
  }
  return {
    message,
    status: "failed"
  };
}
function getApiBaseUrl(override) {
  return resolveApiBaseUrl(override);
}
function parseJsonBodySafely(rawText) {
  try {
    return JSON.parse(rawText);
  } catch {
    return rawText;
  }
}
function buildUrl(apiBaseUrl, path6) {
  return new URL(
    path6,
    apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`
  );
}
function getRequestId() {
  return randomUUID().replaceAll("-", "");
}
var clientRegionByApiBaseUrl = /* @__PURE__ */ new Map();
function getClientRegionCacheKey(apiBaseUrl) {
  return getApiBaseUrl(apiBaseUrl);
}
function setCliClientRegion(apiBaseUrl, region) {
  const cacheKey = getClientRegionCacheKey(apiBaseUrl);
  const normalized = region?.trim();
  if (normalized) {
    clientRegionByApiBaseUrl.set(cacheKey, normalized);
    return;
  }
  clientRegionByApiBaseUrl.delete(cacheKey);
}
function clearCliClientRegion(apiBaseUrl) {
  if (apiBaseUrl) {
    clientRegionByApiBaseUrl.delete(getClientRegionCacheKey(apiBaseUrl));
    return;
  }
  clientRegionByApiBaseUrl.clear();
}
function getCliClientRegion(apiBaseUrl) {
  if (!apiBaseUrl) {
    return void 0;
  }
  return clientRegionByApiBaseUrl.get(getClientRegionCacheKey(apiBaseUrl));
}
function resolveCliRequestLanguage() {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale?.trim();
    if (locale) {
      return locale;
    }
  } catch {
  }
  const lang = process.env.LANG?.split(".")[0]?.trim().replaceAll("_", "-");
  return lang || "en-US";
}
function resolveCliRequestTimezone() {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone?.trim();
    if (timeZone) {
      return timeZone;
    }
  } catch {
  }
  return "UTC";
}
function buildClientLocaleHeaders(apiBaseUrl) {
  const region = getCliClientRegion(apiBaseUrl);
  if (region) {
    return {
      "X-Client-Region": region
    };
  }
  return {
    "X-Language": resolveCliRequestLanguage(),
    "X-Timezone": resolveCliRequestTimezone()
  };
}
function buildDefaultApiRequestHeaders(extra = {}, apiBaseUrl) {
  return {
    "X-Client-Type": CLI_CLIENT_TYPE_HEADER,
    "X-CLI-Version": CLI_VERSION_API_HEADER,
    "X-Product-Class": "vozo_web",
    "X-Request-ID": getRequestId(),
    ...buildClientLocaleHeaders(apiBaseUrl),
    ...extra
  };
}
async function prefetchCliClientRegion(options) {
  try {
    const response = await requestJson({
      apiBaseUrl: options.apiBaseUrl,
      headers: {
        Authorization: `${options.tokenType} ${options.accessToken}`
      },
      path: "/v1/user_benefits/-/feature_configs"
    });
    setCliClientRegion(
      options.apiBaseUrl,
      response.data.userRegion ?? response.data.user_region ?? null
    );
  } catch {
  }
}
function normalizeRequestPath(path6) {
  const withoutQuery = path6.split("?")[0] ?? path6;
  return withoutQuery.replace(/\/+$/, "") || "/";
}
function isCliUpgradeExemptRequest(path6, method = "GET") {
  const normalizedPath = normalizeRequestPath(path6);
  const upperMethod = method.toUpperCase();
  if (upperMethod === "DELETE" && normalizedPath === "/v1/auth/session") {
    return true;
  }
  if (upperMethod === "GET" && /^\/v1\/auth\/[^/]+\/oauth2_status$/.test(normalizedPath)) {
    return true;
  }
  return false;
}
function getCliUpgradeLevel(response) {
  const upgrade = response.headers.get(CLI_UPGRADE_HEADER)?.trim().toLowerCase();
  if (upgrade === "must" || upgrade === "suggest") {
    return upgrade;
  }
  return null;
}
function getCliMinVersionHeader(response) {
  return response.headers.get(CLI_MIN_VERSION_HEADER)?.trim() || null;
}
function resolveCliUpgradeHint(response, level = "must") {
  const upgradeLevel = getCliUpgradeLevel(response);
  if (upgradeLevel !== level) {
    return null;
  }
  const minVersion = getCliMinVersionHeader(response);
  if (level === "must") {
    const targetText2 = minVersion ? `Upgrade vozo-cli to version ${minVersion} or newer.` : "Upgrade vozo-cli to the latest version and try again.";
    const versionDetails2 = [
      `Current CLI version: ${CLI_VERSION_API_HEADER}.`,
      minVersion ? `Minimum supported version: ${minVersion}.` : null
    ].filter(Boolean).join(" ");
    return `${targetText2} ${versionDetails2}`.trim();
  }
  const targetText = minVersion ? `A newer version of vozo-cli is available (${minVersion} or newer).` : "A newer version of vozo-cli is available.";
  const versionDetails = [
    `Current CLI version: ${CLI_VERSION_API_HEADER}.`,
    minVersion ? `Recommended version: ${minVersion}.` : null,
    "Consider upgrading when convenient."
  ].filter(Boolean).join(" ");
  return `${targetText} ${versionDetails}`.trim();
}
function buildCliUpgradeRequiredError(response) {
  const hint = resolveCliUpgradeHint(response, "must");
  if (!hint) {
    return null;
  }
  return new CliUpgradeRequiredError(hint, response.status, {
    currentVersion: CLI_VERSION_API_HEADER,
    minimumVersion: getCliMinVersionHeader(response)
  });
}
function warnCliUpgradeIfSuggested(response) {
  const hint = resolveCliUpgradeHint(response, "suggest");
  if (!hint) {
    return;
  }
  const noted = noteCliUpgradeSuggestion({
    currentVersion: CLI_VERSION_API_HEADER,
    level: "suggest",
    message: hint,
    recommendedVersion: getCliMinVersionHeader(response)
  });
  if (!noted) {
    return;
  }
  printStderr(hint);
}
function handleCliUpgradeHeaders(response, options) {
  if (options?.skip) {
    return;
  }
  const upgradeError = buildCliUpgradeRequiredError(response);
  if (upgradeError) {
    throw upgradeError;
  }
  warnCliUpgradeIfSuggested(response);
}
function assertNoCliUpgradeRequired(response) {
  const error = buildCliUpgradeRequiredError(response);
  if (error) {
    throw error;
  }
}
function resolveParallelTaskLimitHint(errorPayload, baseMessage) {
  const payload = errorPayload && typeof errorPayload === "object" ? errorPayload : null;
  const messageMatches = /parallel task limit/i.test(baseMessage);
  if (payload?.code !== API_ENTITLEMENT_ERROR_CODES.parallelTaskLimit && !messageMatches) {
    return null;
  }
  return [
    "You've reached your plan's concurrent task limit.",
    "Please wait for one or more in-progress projects to finish, then try again.",
    "Check project status with `vozo-cli project list`."
  ].join(" ");
}
function buildApiError(response, parsedBody, fallbackMessage, options) {
  const errorPayload = parsedBody && typeof parsedBody === "object" ? parsedBody : void 0;
  const message = errorPayload && "message" in errorPayload && typeof errorPayload.message === "string" ? errorPayload.message : fallbackMessage;
  const code = errorPayload && "code" in errorPayload && typeof errorPayload.code === "number" ? errorPayload.code : void 0;
  if (!options?.skipCliUpgradeCheck) {
    const upgradeError = buildCliUpgradeRequiredError(response);
    if (upgradeError) {
      return upgradeError;
    }
    warnCliUpgradeIfSuggested(response);
  }
  const parallelTaskLimitHint = resolveParallelTaskLimitHint(
    parsedBody,
    message
  );
  const entitlementHint = resolveApiEntitlementHint(parsedBody, message);
  const hints = [parallelTaskLimitHint, entitlementHint].filter(Boolean);
  const finalMessage = hints.length > 0 ? `${message}
${hints.join("\n")}` : message;
  return new CliApiError(finalMessage, response.status, code, parsedBody);
}
function sanitizeRequestHeaders(headers) {
  const sanitized = {};
  for (const [key, value] of Object.entries(headers)) {
    sanitized[key] = key.toLowerCase() === "authorization" ? "[redacted]" : value;
  }
  return sanitized;
}
function logOutgoingRequest(options) {
  if (!isDevRequestDebugEnabled()) {
    return;
  }
  printStderr(
    `VOZO_CLI_REQUEST ${JSON.stringify({
      body: options.body ?? null,
      headers: sanitizeRequestHeaders(options.headers),
      method: options.method,
      url: options.url.toString()
    })}`
  );
}
async function requestJson({
  apiBaseUrl,
  body,
  headers = {},
  method = "GET",
  path: path6
}) {
  const resolvedApiBaseUrl = getApiBaseUrl(apiBaseUrl);
  const url = buildUrl(resolvedApiBaseUrl, path6);
  const skipCliUpgradeCheck = isCliUpgradeExemptRequest(path6, method);
  const requestHeaders = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...buildDefaultApiRequestHeaders(headers, resolvedApiBaseUrl)
  };
  logOutgoingRequest({
    body,
    headers: requestHeaders,
    method,
    url
  });
  let response;
  let rawText;
  try {
    response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body === void 0 ? void 0 : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    rawText = await response.text();
  } catch (error) {
    rethrowFetchFailure(error, url);
  }
  const contentType = response.headers.get("content-type") ?? "";
  const hasJsonBody = contentType.includes("application/json");
  const parsedBody = rawText ? hasJsonBody ? parseJsonBodySafely(rawText) : rawText : void 0;
  if (!response.ok) {
    throw buildApiError(
      response,
      parsedBody,
      `Request failed with status ${response.status}`,
      { skipCliUpgradeCheck }
    );
  }
  handleCliUpgradeHeaders(response, { skip: skipCliUpgradeCheck });
  return {
    data: parsedBody,
    headers: response.headers,
    status: response.status
  };
}
async function requestDownload({
  apiBaseUrl,
  headers = {},
  method = "GET",
  path: path6
}) {
  const resolvedApiBaseUrl = getApiBaseUrl(apiBaseUrl);
  const url = buildUrl(resolvedApiBaseUrl, path6);
  const requestHeaders = {
    Accept: "*/*",
    ...buildDefaultApiRequestHeaders(headers, resolvedApiBaseUrl)
  };
  logOutgoingRequest({
    headers: requestHeaders,
    method,
    url
  });
  const headerController = new AbortController();
  const headerTimer = setTimeout(
    () => headerController.abort(),
    REQUEST_TIMEOUT_MS
  );
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: requestHeaders,
      signal: headerController.signal
    });
  } catch (error) {
    rethrowFetchFailure(error, url);
  } finally {
    clearTimeout(headerTimer);
  }
  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    const rawText = await response.text();
    const parsedBody = contentType.includes("application/json") && rawText ? parseJsonBodySafely(rawText) : rawText;
    throw buildApiError(
      response,
      parsedBody,
      `Request failed with status ${response.status}`
    );
  }
  handleCliUpgradeHeaders(response);
  return {
    headers: response.headers,
    status: response.status,
    url: response.url,
    async saveToFile(outputPath) {
      if (!response.body) {
        await writeFile(outputPath, Buffer.alloc(0));
        return;
      }
      await pipeline(
        Readable.fromWeb(
          response.body
        ),
        createWriteStream(outputPath)
      );
    },
    text: () => response.text()
  };
}
async function requestDownloadProbe({
  apiBaseUrl,
  headers = {},
  method = "GET",
  path: path6
}) {
  const resolvedApiBaseUrl = getApiBaseUrl(apiBaseUrl);
  const url = buildUrl(resolvedApiBaseUrl, path6);
  const requestHeaders = {
    Accept: "*/*",
    Range: "bytes=0-0",
    ...buildDefaultApiRequestHeaders(headers, resolvedApiBaseUrl)
  };
  logOutgoingRequest({
    headers: requestHeaders,
    method,
    url
  });
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: requestHeaders,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    rethrowFetchFailure(error, url);
  }
  const contentType = response.headers.get("content-type");
  if (!response.ok && response.status !== 206) {
    const rawText = await response.text();
    const parsedBody = (contentType ?? "").includes("application/json") && rawText ? parseJsonBodySafely(rawText) : rawText;
    throw buildApiError(
      response,
      parsedBody,
      `Request failed with status ${response.status}`
    );
  }
  handleCliUpgradeHeaders(response);
  const contentRange = response.headers.get("content-range");
  const totalFromRange = contentRange?.includes("/") ? Number(contentRange.split("/").pop()) : NaN;
  const contentLengthHeader = Number(
    response.headers.get("content-length") ?? ""
  );
  const contentLength = Number.isFinite(totalFromRange) ? totalFromRange : Number.isFinite(contentLengthHeader) ? contentLengthHeader : null;
  if ((contentType ?? "").includes("application/json")) {
    const rawText = await response.text();
    return {
      contentLength,
      contentType,
      json: rawText ? parseJsonBodySafely(rawText) : null,
      status: response.status,
      url: response.url
    };
  }
  await response.body?.cancel().catch(() => {
  });
  return {
    contentLength,
    contentType,
    json: null,
    status: response.status,
    url: response.url
  };
}

// src/core/session.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile as writeFile2 } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
var DEFAULT_SESSION_FILE = path.join(
  homedir(),
  ".vozo",
  DEFAULT_SESSION_DIR_NAME,
  "session.json"
);
var LEGACY_SESSION_FILE = path.join(
  homedir(),
  ".clipp",
  "cli",
  "session.json"
);
function getSessionFilePath() {
  return process.env.VOZO_CLI_SESSION_FILE ?? process.env.CLIPP_CLI_SESSION_FILE ?? DEFAULT_SESSION_FILE;
}
function getSessionDirPath() {
  return path.dirname(getSessionFilePath());
}
async function readStoredSession() {
  try {
    const content = await readFile(getSessionFilePath(), "utf8");
    return JSON.parse(content);
  } catch (error) {
    const typedError = error;
    if (typedError.code === "ENOENT") {
      if (getSessionFilePath() !== DEFAULT_SESSION_FILE) {
        return null;
      }
      try {
        const legacyContent = await readFile(LEGACY_SESSION_FILE, "utf8");
        return JSON.parse(legacyContent);
      } catch (legacyError) {
        const typedLegacyError = legacyError;
        if (typedLegacyError.code === "ENOENT") {
          return null;
        }
        throw legacyError;
      }
    }
    throw error;
  }
}
async function writeStoredSession(session) {
  const dir = getSessionDirPath();
  await mkdir(dir, { recursive: true, mode: 448 });
  const target = getSessionFilePath();
  const tempPath = path.join(dir, `.session.${randomUUID2()}.tmp`);
  try {
    await writeFile2(tempPath, JSON.stringify(session, null, 2), {
      encoding: "utf8",
      mode: 384
    });
    await rename(tempPath, target);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}
async function removeSessionFile(filePath) {
  try {
    await rm(filePath, { force: true });
  } catch (error) {
    const typedError = error;
    if (typedError.code !== "ENOENT") {
      throw error;
    }
  }
}
async function clearStoredSession() {
  const sessionFiles = [getSessionFilePath()];
  if (getSessionFilePath() === DEFAULT_SESSION_FILE) {
    sessionFiles.push(LEGACY_SESSION_FILE);
  }
  await Promise.all(sessionFiles.map((filePath) => removeSessionFile(filePath)));
}
function createDeviceId() {
  return randomUUID2();
}

// src/core/callback.ts
import { createServer } from "node:http";
var LAUNCH_PATH = "/__vozo_cli_launch";
var AUTH_WINDOW_NAME = "vozo-cli-auth";
var AUTH_WINDOW_FEATURES = "width=520,height=720,menubar=no,toolbar=no,location=yes,status=no";
function renderHtml(title, body, options) {
  const autoCloseScript = options?.autoClose ? `<script>
      (function () {
        var origin = window.location.origin;
        var statusEl = document.getElementById('status');

        function notifyOpener() {
          if (!window.opener || window.opener.closed) {
            return;
          }

          try {
            window.opener.postMessage('vozo-cli-auth-complete', origin);
          } catch (_error) {}
        }

        function tryClose() {
          notifyOpener();
          try {
            window.close();
          } catch (_error) {}

          // Some browsers only allow closing the tab when it is blank.
          if (!window.closed) {
            try {
              window.open('', '_self');
              window.close();
            } catch (_error) {}
          }
        }

        function showManualCloseHint() {
          if (!statusEl || window.closed) {
            return;
          }

          statusEl.textContent =
            'Sign-in is complete. You can close this tab and return to the terminal.';
        }

        notifyOpener();
        setTimeout(tryClose, 100);
        setTimeout(tryClose, 500);
        setTimeout(function () {
          tryClose();
          setTimeout(showManualCloseHint, 100);
        }, 1500);
      })();
    </script>` : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
  </head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 40px; color: #111827;">
    <div style="max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
      <h1 style="font-size: 24px; margin-bottom: 12px;">${title}</h1>
      <p id="status" style="line-height: 1.6;">${body}</p>
    </div>
    ${autoCloseScript}
  </body>
</html>`;
}
function renderLaunchHtml(loginUrl, callbackPath) {
  const serializedLoginUrl = JSON.stringify(loginUrl);
  const serializedWindowName = JSON.stringify(AUTH_WINDOW_NAME);
  const serializedWindowFeatures = JSON.stringify(AUTH_WINDOW_FEATURES);
  const serializedCallbackPath = JSON.stringify(callbackPath);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sign in to Vozo CLI</title>
  </head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 40px; color: #111827;">
    <div style="max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
      <h1 style="font-size: 24px; margin-bottom: 12px;">Opening sign-in window</h1>
      <p id="status" style="line-height: 1.6;">Launching the browser sign-in window...</p>
    </div>
    <script>
      (function () {
        var loginUrl = ${serializedLoginUrl};
        var callbackPath = ${serializedCallbackPath};
        var origin = window.location.origin;
        var authWindow = window.open(
          loginUrl,
          ${serializedWindowName},
          ${serializedWindowFeatures},
        );

        function closeLauncher() {
          try {
            window.close();
          } catch (_error) {}
        }

        function closeAuthWindow() {
          if (!authWindow || authWindow.closed) {
            return;
          }

          try {
            authWindow.close();
          } catch (_error) {}
        }

        function finishAuthFlow() {
          closeAuthWindow();
          closeLauncher();
        }

        if (!authWindow) {
          document.getElementById('status').innerHTML =
            'Popup blocked. <a href="' + loginUrl + '" target="' +
            ${serializedWindowName} +
            '" rel="noopener">Click here to sign in</a>, then return to the terminal.';
          return;
        }

        authWindow.focus();

        window.addEventListener('message', function (event) {
          if (event.origin !== origin) {
            return;
          }

          if (event.data === 'vozo-cli-auth-complete') {
            finishAuthFlow();
          }
        });

        var pollTimer = window.setInterval(function () {
          if (!authWindow || authWindow.closed) {
            window.clearInterval(pollTimer);
            closeLauncher();
            return;
          }

          try {
            var href = authWindow.location.href;
            if (
              href.indexOf(callbackPath) !== -1 &&
              (href.indexOf('accessToken=') !== -1 || href.indexOf('key=') !== -1)
            ) {
              window.clearInterval(pollTimer);
              finishAuthFlow();
            }
          } catch (_error) {
            // Ignore cross-origin access while the popup is on the web app domain.
          }
        }, 250);
      })();
    </script>
  </body>
</html>`;
}
async function createAuthCallbackListener(options) {
  let resolveReady;
  let resolveDone;
  let rejectDone;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const done = new Promise((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  let settled = false;
  function closeServer() {
    clearTimeout(timeoutHandle);
    if (typeof server.closeAllConnections === "function") {
      server.closeAllConnections();
    }
    server.close();
  }
  function finishWithResult(result) {
    if (settled) {
      return;
    }
    settled = true;
    closeServer();
    resolveDone(result);
  }
  function finishWithError(error) {
    if (settled) {
      return;
    }
    settled = true;
    closeServer();
    rejectDone(error);
  }
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (requestUrl.pathname === LAUNCH_PATH) {
      const loginUrl = requestUrl.searchParams.get("loginUrl");
      if (!loginUrl) {
        response.statusCode = 400;
        response.end(
          renderHtml(
            "Missing login URL",
            "This launch page requires a login URL query parameter."
          )
        );
        return;
      }
      response.statusCode = 200;
      response.end(renderLaunchHtml(loginUrl, options.callbackPath));
      return;
    }
    if (requestUrl.pathname !== options.callbackPath) {
      response.statusCode = 404;
      response.end(
        renderHtml("Not found", "This callback path is not recognized.")
      );
      return;
    }
    const payload = {
      accessToken: requestUrl.searchParams.get("accessToken") ?? void 0,
      grantType: requestUrl.searchParams.get("grant_type") ?? void 0,
      key: requestUrl.searchParams.get("key") ?? void 0,
      refreshToken: requestUrl.searchParams.get("refreshToken") ?? void 0,
      state: requestUrl.searchParams.get("state") ?? void 0,
      token: requestUrl.searchParams.get("token") ?? void 0,
      tokenType: requestUrl.searchParams.get("tokenType") ?? void 0
    };
    if (payload.state !== options.state) {
      response.statusCode = 400;
      response.end(
        renderHtml(
          "Authentication failed",
          "The callback state did not match this CLI login request. You can close this window and try again."
        )
      );
      return;
    }
    response.statusCode = 200;
    response.end(
      renderHtml(
        "Authorization received",
        "Sign-in is complete. This window will close automatically. You can return to the terminal.",
        { autoClose: true }
      )
    );
    finishWithResult({
      callbackUrl: requestUrl.toString(),
      payload
    });
  });
  server.on("error", (error) => {
    finishWithError(error);
  });
  const timeoutHandle = setTimeout(() => {
    finishWithError(
      new Error("Timed out waiting for the browser login callback.")
    );
  }, options.timeoutMs);
  server.listen(options.port ?? 0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") {
      closeServer();
      rejectDone(new Error("Failed to start the local callback server."));
      return;
    }
    resolveReady({
      callbackUrl: `http://127.0.0.1:${address.port}${options.callbackPath}?state=${encodeURIComponent(options.state)}`,
      port: address.port
    });
  });
  return {
    done,
    dispose() {
      if (!settled) {
        settled = true;
      }
      closeServer();
    },
    ready
  };
}

// src/core/auth.ts
import { randomUUID as randomUUID3 } from "node:crypto";
import { spawn as spawn2 } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import dayjs from "dayjs";

// src/core/auth-login-pending.ts
import fs from "node:fs";
import path2 from "node:path";
function getLoginPendingFilePath() {
  return path2.join(path2.dirname(getSessionFilePath()), "login-pending.json");
}
function getLoginWorkerLogFilePath() {
  return path2.join(path2.dirname(getSessionFilePath()), "login-worker.log");
}
function readLoginWorkerLog() {
  const filePath = getLoginWorkerLogFilePath();
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(filePath, "utf8").trim();
    return content || null;
  } catch {
    return null;
  }
}
function readLoginPending() {
  const filePath = getLoginPendingFilePath();
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}
function writeLoginPending(state) {
  const filePath = getLoginPendingFilePath();
  fs.mkdirSync(path2.dirname(filePath), { recursive: true, mode: 448 });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), {
    encoding: "utf8",
    mode: 384
  });
}
async function clearLoginPending() {
  try {
    await fs.promises.rm(getLoginPendingFilePath(), { force: true });
  } catch (error) {
    const typedError = error;
    if (typedError.code !== "ENOENT") {
      throw error;
    }
  }
}
async function waitForLoginPendingFile(options) {
  const intervalMs = options.intervalMs ?? 100;
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    const pending = readLoginPending();
    if (pending?.status === "pending") {
      return pending;
    }
    if (pending?.status === "failed") {
      throw new Error(pending.error);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

// src/core/browser.ts
import { spawn } from "node:child_process";
async function openBrowser(url) {
  const platform = process.platform;
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore"
    });
    child.on("error", reject);
    child.on("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

// src/core/auth.ts
var ENV_ACCESS_TOKEN_KEYS = ["VOZO_CLI_TOKEN", "CLIPP_CLI_TOKEN"];
var ENV_REFRESH_TOKEN_KEYS = [
  "VOZO_CLI_REFRESH_TOKEN",
  "CLIPP_CLI_REFRESH_TOKEN"
];
var ENV_TOKEN_TYPE_KEYS = [
  "VOZO_CLI_TOKEN_TYPE",
  "CLIPP_CLI_TOKEN_TYPE"
];
var DEFAULT_CALLBACK_PATH = "/callback";
var DEFAULT_TIMEOUT_SECONDS = 300;
function readFirstEnv(keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value) {
      return value;
    }
  }
  return void 0;
}
function normalizeUserProfile(profile) {
  return {
    displayId: profile.displayID ?? null,
    email: profile.email ?? null,
    id: profile.uid ? String(profile.uid) : null,
    nickname: profile.nickname ?? null,
    userState: profile.userState ?? null
  };
}
function parseJwtExpiry(token) {
  const [, payload] = token.split(".");
  if (!payload) {
    return dayjs().add(1, "hour").toISOString();
  }
  try {
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    );
    if (decoded.exp) {
      return new Date(decoded.exp * 1e3).toISOString();
    }
  } catch (_error) {
  }
  return dayjs().add(1, "hour").toISOString();
}
function normalizeTokenSession(payload, fallback) {
  if (!payload.accessToken) {
    payload.accessToken = payload.access_token;
  }
  if (!payload.displayID) {
    payload.displayID = payload.display_id;
  }
  if (!payload.expiredAt) {
    payload.expiredAt = payload.expired_at;
  }
  if (!payload.refreshToken) {
    payload.refreshToken = payload.refresh_token;
  }
  if (!payload.tokenType) {
    payload.tokenType = payload.token_type;
  }
  if (!payload.userState) {
    payload.userState = payload.user_state;
  }
  if (!payload.accessToken) {
    throw new Error("Login response did not include accessToken.");
  }
  if (!payload.expiredAt) {
    throw new Error("Login response did not include expiredAt.");
  }
  const refreshToken = payload.refreshToken ?? fallback.refreshToken;
  if (!refreshToken) {
    throw new Error("Login response did not include refreshToken.");
  }
  return {
    accessToken: payload.accessToken,
    apiBaseUrl: fallback.apiBaseUrl,
    deviceId: fallback.deviceId,
    displayId: payload.displayID ?? null,
    email: fallback.email ?? null,
    expiresAt: payload.expiredAt,
    refreshToken,
    savedAt: (/* @__PURE__ */ new Date()).toISOString(),
    tokenType: payload.tokenType ?? fallback.tokenType ?? "Bearer",
    uid: payload.uid ? String(payload.uid) : null,
    userState: payload.userState ?? null
  };
}
function buildStoredSession(session, user) {
  return {
    ...session,
    email: user.email ?? session.email ?? null,
    profile: user
  };
}
function getEnvironmentSession(apiBaseUrlOverride) {
  const accessToken = readFirstEnv(ENV_ACCESS_TOKEN_KEYS);
  if (!accessToken) {
    return null;
  }
  const refreshToken = readFirstEnv(ENV_REFRESH_TOKEN_KEYS);
  const tokenType = readFirstEnv(ENV_TOKEN_TYPE_KEYS) ?? "Bearer";
  return {
    accessToken,
    apiBaseUrl: getApiBaseUrl(apiBaseUrlOverride),
    deviceId: "env-session",
    displayId: null,
    email: null,
    expiresAt: dayjs().add(1, "year").toISOString(),
    refreshToken,
    savedAt: (/* @__PURE__ */ new Date()).toISOString(),
    tokenType,
    uid: null,
    userState: null
  };
}
async function fetchUserProfile(session) {
  const response = await requestJson({
    apiBaseUrl: session.apiBaseUrl,
    headers: {
      Authorization: `${session.tokenType} ${session.accessToken}`
    },
    path: "/v1/auth/users"
  });
  return normalizeUserProfile(response.data);
}
async function fetchMembershipPoints(session) {
  const response = await requestJson({
    apiBaseUrl: session.apiBaseUrl,
    headers: {
      Authorization: `${session.tokenType} ${session.accessToken}`
    },
    path: "/v1/user_benefits/point?product_class=vozo_web&unit=cpt"
  });
  return response.data ?? [];
}
function userHasAvailablePoints(points) {
  return points.some((point) => {
    if (point.isExpired ?? point.is_expired) {
      return false;
    }
    const available = point.availablePoint ?? point.available_point ?? 0;
    return available > 0;
  });
}
async function requestNewUserGiftPointsIfNeeded(session) {
  try {
    const points = await fetchMembershipPoints(session);
    if (userHasAvailablePoints(points)) {
      return;
    }
    await requestJson({
      apiBaseUrl: session.apiBaseUrl,
      body: {
        deviceID: session.deviceId
      },
      headers: {
        Authorization: `${session.tokenType} ${session.accessToken}`
      },
      method: "PUT",
      path: "/v1/user_benefits/gift_point"
    });
  } catch {
  }
}
async function persistAuthenticatedSession(tokenSession) {
  await writeStoredSession({ ...tokenSession, profile: null });
  let user;
  try {
    user = await fetchUserProfile(tokenSession);
    await writeStoredSession(buildStoredSession(tokenSession, user));
  } catch {
    user = {
      displayId: tokenSession.displayId,
      email: tokenSession.email,
      id: tokenSession.uid,
      nickname: null,
      userState: tokenSession.userState
    };
  }
  await requestNewUserGiftPointsIfNeeded(tokenSession);
  return user;
}
function profileFromStoredSession(storedSession) {
  return storedSession.profile ?? {
    displayId: storedSession.displayId,
    email: storedSession.email,
    id: storedSession.uid,
    nickname: null,
    userState: storedSession.userState
  };
}
function buildAuthenticatedStatusFromStored(storedSession, source) {
  return {
    authenticated: true,
    sessionFile: source === "local" ? getSessionFilePath() : null,
    source,
    status: "authenticated",
    user: profileFromStoredSession(storedSession)
  };
}
function buildAuthRequiredResult(reason) {
  const nextAction = reason === "missing_session" ? "You are not signed in. Run `vozo-cli auth login` to sign in." : "Your CLI session has expired or is invalid. Run `vozo-cli auth login` to sign in again.";
  return {
    authenticated: false,
    nextAction,
    reason,
    sessionFile: getSessionFilePath(),
    status: "auth_required"
  };
}
async function refreshStoredSession(session) {
  if (!session.refreshToken) {
    throw new Error("Stored session is missing refreshToken.");
  }
  const response = await requestJson({
    apiBaseUrl: session.apiBaseUrl,
    body: {},
    headers: {
      Authorization: `${session.tokenType} ${session.refreshToken}`
    },
    method: "PUT",
    path: "/v1/auth/session"
  });
  return normalizeTokenSession(response.data, {
    apiBaseUrl: session.apiBaseUrl,
    deviceId: session.deviceId,
    email: session.email,
    refreshToken: session.refreshToken,
    tokenType: session.tokenType
  });
}
async function resolveStoredSession(apiBaseUrlOverride) {
  const storedSession = await readStoredSession();
  if (!storedSession) {
    return null;
  }
  const expectedApiBaseUrl = getApiBaseUrl(apiBaseUrlOverride);
  if (storedSession.apiBaseUrl !== expectedApiBaseUrl) {
    if (!apiBaseUrlOverride) {
      await clearStoredSession();
    }
    return null;
  }
  if (dayjs().isAfter(dayjs(storedSession.expiresAt).subtract(1, "minute"))) {
    let refreshedSession;
    try {
      refreshedSession = await refreshStoredSession(storedSession);
    } catch (error) {
      if (error instanceof CliApiError && [401, 403].includes(error.status)) {
        await clearStoredSession();
        return null;
      }
      throw error;
    }
    const refreshedStored = { ...refreshedSession, profile: null };
    await writeStoredSession(refreshedStored);
    try {
      const user = await fetchUserProfile(refreshedSession);
      const nextStoredSession = buildStoredSession(refreshedSession, user);
      await writeStoredSession(nextStoredSession);
      return nextStoredSession;
    } catch {
      return refreshedStored;
    }
  }
  return storedSession;
}
async function resolveSession(apiBaseUrlOverride) {
  const environmentSession = getEnvironmentSession(apiBaseUrlOverride);
  if (environmentSession) {
    return {
      session: environmentSession,
      source: "environment",
      storedSession: null
    };
  }
  const storedSession = await resolveStoredSession(apiBaseUrlOverride);
  if (!storedSession) {
    return null;
  }
  return {
    session: storedSession,
    source: "local",
    storedSession
  };
}
async function requireAuthenticatedSession(apiBaseUrlOverride) {
  const resolved = await resolveSession(apiBaseUrlOverride);
  if (!resolved) {
    throw new Error(
      "Authentication required. Run `vozo-cli auth login` to create a local CLI session."
    );
  }
  return resolved.session;
}
async function sendVerificationCode(email, apiBaseUrl) {
  const response = await requestJson({
    apiBaseUrl,
    body: { email },
    method: "POST",
    path: "/v1/auth/send_verification_code"
  });
  const responsePayload = response.data;
  const headerToken = response.headers.get("x-csrf-token");
  const bodyToken = responsePayload && typeof responsePayload === "object" && "csrfToken" in responsePayload && typeof responsePayload.csrfToken === "string" ? responsePayload.csrfToken : void 0;
  return bodyToken ?? headerToken ?? void 0;
}
async function exchangeOAuthKey(params) {
  const response = await requestJson({
    apiBaseUrl: params.apiBaseUrl,
    path: `/v1/auth/${params.grantType}/oauth2_status?key=${encodeURIComponent(
      params.key
    )}`
  });
  return normalizeTokenSession(response.data, {
    apiBaseUrl: params.apiBaseUrl,
    deviceId: createDeviceId()
  });
}
function normalizeCallbackTokenSession(params) {
  return {
    accessToken: params.accessToken,
    apiBaseUrl: params.apiBaseUrl,
    deviceId: createDeviceId(),
    displayId: null,
    email: null,
    expiresAt: parseJwtExpiry(params.accessToken),
    refreshToken: params.refreshToken,
    savedAt: (/* @__PURE__ */ new Date()).toISOString(),
    tokenType: params.tokenType ?? "Bearer",
    uid: null,
    userState: null
  };
}
function isRecentStoredSession(session, options) {
  if (session.apiBaseUrl !== options.apiBaseUrl) {
    return false;
  }
  const savedAt = Date.parse(session.savedAt);
  if (Number.isNaN(savedAt)) {
    return false;
  }
  return savedAt >= options.startedAt - 1e3;
}
async function waitForRecentStoredSession(options) {
  const deadline = options.startedAt + options.timeoutMs;
  const intervalMs = options.intervalMs ?? 200;
  while (Date.now() < deadline) {
    if (options.signal?.aborted) {
      return null;
    }
    const storedSession = await readStoredSession();
    if (storedSession && isRecentStoredSession(storedSession, {
      apiBaseUrl: options.apiBaseUrl,
      startedAt: options.startedAt
    })) {
      return storedSession;
    }
    await sleep(intervalMs, options.signal);
  }
  return null;
}
async function loginWithEmailCode(params) {
  const response = await requestJson({
    apiBaseUrl: params.apiBaseUrl,
    body: {
      code: params.code,
      device_id: params.deviceId,
      email: params.email,
      from: "cli",
      platform: "web"
    },
    headers: params.csrfToken ? {
      "X-CSRF-Token": params.csrfToken
    } : void 0,
    method: "POST",
    path: "/v1/auth/email/login"
  });
  return normalizeTokenSession(response.data, {
    apiBaseUrl: params.apiBaseUrl,
    deviceId: params.deviceId,
    email: params.email
  });
}
async function loginWithEmail({
  apiBaseUrl,
  code,
  csrfToken,
  email
}) {
  const challenge = await requestEmailLoginCode({ apiBaseUrl, email });
  return completeEmailLogin({
    apiBaseUrl: challenge.apiBaseUrl,
    code,
    csrfToken: csrfToken ?? challenge.csrfToken,
    email
  });
}
async function requestEmailLoginCode({
  apiBaseUrl,
  email
}) {
  const resolvedApiBaseUrl = getApiBaseUrl(apiBaseUrl);
  const csrfToken = await sendVerificationCode(email, resolvedApiBaseUrl);
  return {
    apiBaseUrl: resolvedApiBaseUrl,
    csrfToken,
    email
  };
}
async function completeEmailLogin({
  apiBaseUrl,
  code,
  csrfToken,
  email
}) {
  const resolvedApiBaseUrl = getApiBaseUrl(apiBaseUrl);
  const deviceId = createDeviceId();
  const tokenSession = await loginWithEmailCode({
    apiBaseUrl: resolvedApiBaseUrl,
    code,
    csrfToken,
    deviceId,
    email
  });
  const user = await persistAuthenticatedSession(tokenSession);
  return {
    authenticated: true,
    sessionFile: getSessionFilePath(),
    status: "authenticated",
    user
  };
}
async function loginWithAccessToken({
  accessToken,
  apiBaseUrl,
  refreshToken,
  tokenType
}) {
  const trimmedAccessToken = accessToken.trim();
  if (!trimmedAccessToken) {
    throw new Error(
      "Access token is required. Run `vozo-cli auth login-token --access-token <token>`."
    );
  }
  const resolvedApiBaseUrl = getApiBaseUrl(apiBaseUrl);
  const tokenSession = normalizeCallbackTokenSession({
    accessToken: trimmedAccessToken,
    apiBaseUrl: resolvedApiBaseUrl,
    refreshToken: refreshToken?.trim() || void 0,
    tokenType: tokenType?.trim() || void 0
  });
  let user;
  try {
    user = await fetchUserProfile(tokenSession);
  } catch (error) {
    if (error instanceof CliApiError && [401, 403].includes(error.status)) {
      throw new Error(
        "The access token is invalid or expired. Provide a valid token and try again."
      );
    }
    throw error;
  }
  await writeStoredSession(buildStoredSession(tokenSession, user));
  return {
    authenticated: true,
    sessionFile: getSessionFilePath(),
    status: "authenticated",
    user
  };
}
async function loginWithBrowser({
  apiBaseUrl,
  callbackPath = DEFAULT_CALLBACK_PATH,
  noOpen = false,
  onCallbackReceived,
  onPending,
  onWaiting,
  port,
  timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
  trackPending = false,
  webAppUrl
}) {
  const startedAt = Date.now();
  const state = randomUUID3();
  const resolvedApiBaseUrl = getApiBaseUrl(apiBaseUrl);
  if (trackPending) {
    await clearLoginPending();
  }
  const listener = await createAuthCallbackListener({
    callbackPath,
    port,
    state,
    timeoutMs: timeoutSeconds * 1e3
  });
  const { callbackUrl } = await listener.ready;
  const loginUrl = new URL("/users/login", resolveWebAppUrl(webAppUrl));
  loginUrl.searchParams.set("cli_auth", "1");
  loginUrl.searchParams.set("from", "cli");
  loginUrl.searchParams.set("redirect", callbackUrl);
  const loginUrlString = loginUrl.toString();
  await onPending?.({
    apiBaseUrl: resolvedApiBaseUrl,
    callbackUrl,
    loginUrl: loginUrlString
  });
  if (trackPending) {
    writeLoginPending({
      apiBaseUrl: resolvedApiBaseUrl,
      callbackUrl,
      loginUrl: loginUrlString,
      startedAt,
      status: "pending"
    });
  }
  if (!noOpen) {
    try {
      await openBrowser(loginUrlString);
    } catch (_error) {
    }
  }
  const storedSessionAbort = new AbortController();
  const waitingIntervalMs = 2e3;
  const waitingInterval = onWaiting ? setInterval(() => {
    void onWaiting({
      elapsedSeconds: Math.floor((Date.now() - startedAt) / 1e3)
    });
  }, waitingIntervalMs) : void 0;
  const completionPromise = Promise.race([
    listener.done.then((callbackSession) => ({
      callbackSession,
      kind: "callback"
    })),
    waitForRecentStoredSession({
      apiBaseUrl: resolvedApiBaseUrl,
      signal: storedSessionAbort.signal,
      startedAt,
      timeoutMs: timeoutSeconds * 1e3
    }).then((storedSession) => ({
      kind: "stored_session",
      storedSession
    }))
  ]);
  let completion;
  try {
    completion = await completionPromise;
  } catch (error) {
    if (trackPending) {
      writeLoginPending({
        error: error instanceof Error ? error.message : "Browser login failed before completion.",
        failedAt: Date.now(),
        status: "failed"
      });
    }
    throw error;
  } finally {
    storedSessionAbort.abort();
    if (waitingInterval) {
      clearInterval(waitingInterval);
    }
  }
  let user;
  try {
    if (completion.kind === "stored_session" && completion.storedSession) {
      if (completion.storedSession.profile) {
        user = completion.storedSession.profile;
      } else {
        user = await fetchUserProfile(completion.storedSession);
      }
    } else {
      const callbackSession = completion.kind === "callback" ? completion.callbackSession : await listener.done;
      await onCallbackReceived?.({
        callbackUrl: callbackSession.callbackUrl
      });
      if (trackPending) {
        writeLoginPending({
          callbackUrl: callbackSession.callbackUrl,
          receivedAt: Date.now(),
          status: "callback_received"
        });
      }
      let tokenSession;
      if (callbackSession.payload.key && callbackSession.payload.grantType) {
        tokenSession = await exchangeOAuthKey({
          apiBaseUrl: resolvedApiBaseUrl,
          grantType: callbackSession.payload.grantType,
          key: callbackSession.payload.key
        });
      } else {
        const accessToken = callbackSession.payload.accessToken ?? callbackSession.payload.token;
        if (!accessToken) {
          throw new Error(
            `Browser login callback did not include a usable token or oauth key. Callback URL: ${callbackSession.callbackUrl}`
          );
        }
        tokenSession = normalizeCallbackTokenSession({
          accessToken,
          apiBaseUrl: resolvedApiBaseUrl,
          refreshToken: callbackSession.payload.refreshToken,
          tokenType: callbackSession.payload.tokenType
        });
      }
      user = await persistAuthenticatedSession(tokenSession);
    }
    await clearLoginPending();
    listener.dispose();
    return {
      authenticated: true,
      callbackUrl,
      loginUrl: loginUrlString,
      sessionFile: getSessionFilePath(),
      status: "authenticated",
      user
    };
  } catch (error) {
    listener.dispose();
    if (trackPending) {
      writeLoginPending({
        error: error instanceof Error ? error.message : "Browser login failed while finalizing the session.",
        failedAt: Date.now(),
        status: "failed"
      });
    }
    throw error;
  }
}
function sleep(ms, signal) {
  if (signal?.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
async function waitForAuthenticatedSession(options) {
  const timeoutSeconds = options?.timeoutSeconds ?? 300;
  const pollIntervalMs = options?.pollIntervalMs ?? 500;
  const onPollThrottleMs = 2e3;
  const startedAt = Date.now();
  const deadline = startedAt + timeoutSeconds * 1e3;
  let lastOnPollAt = 0;
  while (Date.now() < deadline) {
    const pending = readLoginPending();
    if (pending?.status === "failed" && Date.now() - pending.failedAt <= timeoutSeconds * 1e3) {
      throw new Error(pending.error);
    }
    const status = await getAuthStatus(options?.apiBaseUrl);
    if (status.authenticated) {
      await clearLoginPending();
      return status;
    }
    const now = Date.now();
    if (options?.onPoll && now - lastOnPollAt >= onPollThrottleMs) {
      lastOnPollAt = now;
      options.onPoll(Math.floor((now - startedAt) / 1e3));
    }
    await sleep(pollIntervalMs);
  }
  const finalStatus = await getAuthStatus(options?.apiBaseUrl);
  if (finalStatus.authenticated) {
    await clearLoginPending();
    return finalStatus;
  }
  throw new Error(
    `Timed out waiting for browser sign-in after ${timeoutSeconds}s. Run \`vozo-cli auth status\` to verify whether sign-in completed.`
  );
}
function spawnBrowserLoginWorker(cliEntry, options) {
  const args = ["auth", "login-worker"];
  if (options.callbackPath && options.callbackPath !== DEFAULT_CALLBACK_PATH) {
    args.push("--callback-path", options.callbackPath);
  }
  if (options.noOpen) {
    args.push("--no-open");
  }
  if (options.port) {
    args.push("--port", String(options.port));
  }
  if (options.timeoutSeconds) {
    args.push("--timeout-seconds", String(options.timeoutSeconds));
  }
  if (options.webAppUrl) {
    args.push("--web-app-url", options.webAppUrl);
  }
  if (!existsSync(cliEntry)) {
    throw new Error(
      `Cannot start the background browser login worker: CLI entry file not found at \`${cliEntry}\`.`
    );
  }
  const logFilePath = getLoginWorkerLogFilePath();
  mkdirSync(dirname(logFilePath), { mode: 448, recursive: true });
  const logFd = openSync(logFilePath, "w");
  const child = spawn2(process.execPath, [cliEntry, ...args], {
    detached: true,
    env: process.env,
    stdio: ["ignore", "ignore", logFd]
  });
  child.unref();
  if (!child.pid) {
    throw new Error("Failed to start the background browser login worker.");
  }
  return child.pid;
}
async function startBrowserLoginInBackground(cliEntry, options) {
  await clearLoginPending();
  const pid = spawnBrowserLoginWorker(cliEntry, options);
  const pending = await waitForLoginPendingFile({
    intervalMs: 100,
    timeoutMs: 1e4
  });
  if (!pending) {
    const workerLog = readLoginWorkerLog();
    const detail = workerLog ? ` Worker output:
${workerLog}` : " The worker produced no output; it may still be starting slowly.";
    throw new Error(
      `Background browser login did not become ready in time. Retry \`vozo-cli auth login --background\`.${detail}`
    );
  }
  return {
    callbackUrl: pending.callbackUrl,
    loginUrl: pending.loginUrl,
    mode: "background",
    nextAction: "Complete sign-in in the browser, then run `vozo-cli auth wait` (or `vozo-cli auth status`).",
    pid,
    sessionFile: getSessionFilePath(),
    status: "pending"
  };
}
async function getAuthStatus(apiBaseUrlOverride) {
  try {
    const resolved = await resolveSession(apiBaseUrlOverride);
    if (!resolved) {
      return buildAuthRequiredResult("missing_session");
    }
    try {
      const user = await fetchUserProfile(resolved.session);
      if (resolved.source === "local" && resolved.storedSession) {
        const nextStoredSession = buildStoredSession(
          resolved.storedSession,
          user
        );
        await writeStoredSession(nextStoredSession);
      }
      return {
        authenticated: true,
        sessionFile: resolved.source === "local" ? getSessionFilePath() : null,
        source: resolved.source,
        status: "authenticated",
        user
      };
    } catch (profileError) {
      if (profileError instanceof CliApiError && [401, 403].includes(profileError.status)) {
        await clearStoredSession();
        return buildAuthRequiredResult("invalid_session");
      }
      if (resolved.source === "local" && resolved.storedSession) {
        return buildAuthenticatedStatusFromStored(
          resolved.storedSession,
          resolved.source
        );
      }
      throw profileError;
    }
  } catch (error) {
    if (error instanceof CliApiError && [401, 403].includes(error.status)) {
      await clearStoredSession();
      return buildAuthRequiredResult("invalid_session");
    }
    throw error;
  }
}
async function logout(apiBaseUrlOverride) {
  const resolved = await resolveSession(apiBaseUrlOverride);
  if (!resolved) {
    return {
      authenticated: false,
      clearedLocalSession: true,
      remoteSessionTerminated: false,
      sessionFile: getSessionFilePath(),
      status: "logged_out"
    };
  }
  let remoteSessionTerminated = false;
  try {
    await requestJson({
      apiBaseUrl: resolved.session.apiBaseUrl,
      headers: {
        Authorization: `${resolved.session.tokenType} ${resolved.session.accessToken}`
      },
      method: "DELETE",
      path: "/v1/auth/session"
    });
    remoteSessionTerminated = true;
  } catch (error) {
    if (!(error instanceof CliApiError) || ![401, 403].includes(error.status)) {
      throw error;
    }
  }
  await clearStoredSession();
  clearCliClientRegion(resolved.session.apiBaseUrl);
  return {
    authenticated: false,
    clearedLocalSession: true,
    remoteSessionTerminated,
    sessionFile: getSessionFilePath(),
    status: "logged_out"
  };
}

// src/core/create-limits.ts
import { InvalidArgumentError } from "commander";
var GB = 1024 * 1024 * 1024;
var FILE_SIZE_LIMIT_BYTES = {
  lipsync: 2.5 * GB,
  translate_subtitles: 2.5 * GB,
  visual_translate: 2 * GB,
  translate_dub: 2.5 * GB
};
var BATCH_CREATE_MAX_FILES = 40;
function assertBatchFileCountAllowed(filePaths) {
  if (filePaths.length <= BATCH_CREATE_MAX_FILES) {
    return;
  }
  throw new Error(
    `Batch create supports at most ${BATCH_CREATE_MAX_FILES} files at a time (got ${filePaths.length}). Split into smaller batches and try again.`
  );
}
var DEFAULT_VIDEO_RESOLUTION_LIMIT = {
  long: 4096,
  short: 2304
};
var LIPSYNC_1080P_PIXEL_LIMIT = 1080 * 1920;
var LIPSYNC_DURATION_4K_MAX_SECONDS = 60 * 40;
function exceedsVideoResolutionLimit(width, height, limit = DEFAULT_VIDEO_RESOLUTION_LIMIT) {
  return width > limit.long || height > limit.long || width * height > limit.long * limit.short;
}
function assertVideoResolutionAllowed(options) {
  const limit = options.limit ?? DEFAULT_VIDEO_RESOLUTION_LIMIT;
  if (!exceedsVideoResolutionLimit(options.width, options.height, limit)) {
    return;
  }
  const target = options.filePath ? ` for ${options.filePath}` : "";
  throw new Error(
    `Video resolution ${options.width}\xD7${options.height}${target} exceeds the maximum supported resolution (up to 4K: ${limit.long}px per side, ${limit.long}\xD7${limit.short} total pixels).`
  );
}
function assertLipsyncVideoConstraints(options) {
  const target = options.filePath ? ` (${options.filePath})` : "";
  if (options.durationSeconds < 1) {
    throw new Error(
      `Lipsync requires a video duration of at least 1 second${target}.`
    );
  }
  assertVideoResolutionAllowed({
    filePath: options.filePath,
    height: options.height,
    width: options.width
  });
  if (options.durationSeconds >= LIPSYNC_DURATION_4K_MAX_SECONDS + 1 && options.width * options.height > LIPSYNC_1080P_PIXEL_LIMIT) {
    throw new Error(
      `Videos over 40 minutes can only support up to 1080p resolution${target}.`
    );
  }
}
function assertCreateVideoResolutionAllowed(options) {
  if (options.kind === "lipsync") {
    assertLipsyncVideoConstraints({
      durationSeconds: options.durationSeconds ?? 0,
      filePath: options.filePath,
      height: options.height,
      width: options.width
    });
    return;
  }
  assertVideoResolutionAllowed({
    filePath: options.filePath,
    height: options.height,
    width: options.width
  });
}
var DURATION_HARD_LIMIT_SECONDS = {
  lipsync: [0, 3600],
  translate_subtitles: [0, 7200],
  visual_translate: [1, 1200],
  translate_dub: [0, 7200]
};
var BUSINESS_USER_TYPES = /* @__PURE__ */ new Set([
  "business",
  "business_xl",
  "business_xxl",
  "enterprise",
  "professional",
  "studio",
  "studio_xl",
  "studio_xxl"
]);
function normalizeMembershipUserType(userType) {
  if (!userType) {
    return null;
  }
  const type = userType.trim().toLowerCase();
  if (type === "free") {
    return "free";
  }
  if (type === "blink_pro" || type === "vozo_pro" || type === "basic") {
    return "pro";
  }
  if (type === "standard" || type === "creator" || type === "premium") {
    return "creator";
  }
  if (type === "business_xl") {
    return "studio_xl";
  }
  if (type === "business_xxl") {
    return "studio_xxl";
  }
  if (type === "professional" || type === "business") {
    return "studio";
  }
  if (type === "enterprise") {
    return "enterprise";
  }
  if (type.includes("premium")) {
    return "creator";
  }
  if (type.includes("business_xxl")) {
    return "studio_xxl";
  }
  if (type.includes("business_xl")) {
    return "studio_xl";
  }
  if (type.includes("business") || type === "professional") {
    return "studio";
  }
  return type;
}
var PRO_USER_TYPES = /* @__PURE__ */ new Set(["basic", "blink_pro", "vozo_pro", "pro"]);
var PREMIUM_USER_TYPES = /* @__PURE__ */ new Set(["creator", "premium", "standard"]);
function deriveMembershipFlags(userType) {
  const type = userType ?? "free";
  return {
    isBusiness: BUSINESS_USER_TYPES.has(type),
    isMember: type !== "free",
    isPremium: PREMIUM_USER_TYPES.has(type),
    isPro: PRO_USER_TYPES.has(type)
  };
}
function tierMaxUploadSeconds(userType) {
  const { isMember, isPro, isPremium } = deriveMembershipFlags(userType);
  if (!isMember || isPro) {
    return 20 * 60;
  }
  if (isPremium) {
    return 60 * 60;
  }
  return 120 * 60;
}
var STUDIO_PLAN_LABEL = "Studio / Studio XL / Studio XXL / Enterprise";
var CREATOR_PROMPT_PLAN_LABEL = "Creator or Studio plan";
var MAX_USER_PROMPT_LENGTH = 1e3;
function assertUserPromptLength(userPrompt) {
  if (userPrompt == null || userPrompt === "") {
    return;
  }
  if (userPrompt.length > MAX_USER_PROMPT_LENGTH) {
    throw new Error(
      `\`--prompt\` must be at most ${MAX_USER_PROMPT_LENGTH} characters (got ${userPrompt.length}).`
    );
  }
}
function parseUserPrompt(value) {
  const normalized = String(value ?? "");
  try {
    assertUserPromptLength(normalized);
  } catch (error) {
    throw new InvalidArgumentError(
      error instanceof Error ? error.message : String(error)
    );
  }
  return normalized;
}
function assertMembershipForCreateOptions(userType, options) {
  const { isBusiness, isMember, isPro } = deriveMembershipFlags(userType);
  if ((options.batchItemCount ?? 0) > 1 && !isBusiness) {
    throw new Error(
      buildEntitlementError(
        `Batch creation (--from-files with multiple videos or --from-dir) requires a ${STUDIO_PLAN_LABEL} membership. Use \`--from-file\` for a single project.`,
        "permission"
      )
    );
  }
  if (options.glossaryIdList?.length && !isBusiness) {
    throw new Error(
      buildEntitlementError(
        `--glossary requires a ${STUDIO_PLAN_LABEL} membership. Remove the glossary option.`,
        "permission"
      )
    );
  }
  if (options.proofreadBeforeDubbing && !isBusiness) {
    throw new Error(
      buildEntitlementError(
        `--proofread-before-dubbing requires a ${STUDIO_PLAN_LABEL} membership. Remove this option.`,
        "permission"
      )
    );
  }
  assertUserPromptLength(options.userPrompt);
  if (options.userPrompt?.trim() && (!isMember || isPro)) {
    throw new Error(
      buildEntitlementError(
        `--prompt requires a ${CREATOR_PROMPT_PLAN_LABEL} membership (Pro and free plans are not supported). Remove the prompt.`,
        "permission"
      )
    );
  }
  if (options.hasCustomFont && !isBusiness) {
    throw new Error(
      buildEntitlementError(
        `Custom font (--font-file or --font-family / --font-src) requires a ${STUDIO_PLAN_LABEL} membership. Remove the font options.`,
        "permission"
      )
    );
  }
  if (options.hasSubtitleFile && !isBusiness) {
    throw new Error(
      buildEntitlementError(
        `--subtitle-file requires a ${STUDIO_PLAN_LABEL} membership. Remove the subtitle file option.`,
        "permission"
      )
    );
  }
}
var SPEAKER_NUMBER_VALUES = ["1", "2", "3+", "Auto"];
function parseSpeakerNumber(value) {
  const normalized = String(value ?? "").trim();
  const match = SPEAKER_NUMBER_VALUES.find((option) => option === normalized);
  if (!match) {
    throw new InvalidArgumentError(
      `\`--speaker-number\` must be one of: ${SPEAKER_NUMBER_VALUES.join(
        ", "
      )}.`
    );
  }
  return match;
}
function parseEnumOption(value, flag, allowed) {
  const normalized = String(value ?? "").trim();
  const match = allowed.find((option) => option === normalized);
  if (!match) {
    throw new InvalidArgumentError(
      `\`${flag}\` must be one of: ${allowed.join(", ")}.`
    );
  }
  return match;
}
var DUB_PREFERENCE_VALUES = ["auto", "real", "native"];
function parseDubPreference(value) {
  return parseEnumOption(value, "--dub-preference", DUB_PREFERENCE_VALUES);
}
var SUBTITLE_DISPLAY_VALUES = [
  "translated_only",
  "original_translated"
];
function parseSubtitleDisplayType(value) {
  return parseEnumOption(value, "--subtitle-display", SUBTITLE_DISPLAY_VALUES);
}
var FACE_MODE_VALUES = ["single", "more"];
function parseFaceMode(value) {
  return parseEnumOption(value, "--face-mode", FACE_MODE_VALUES);
}
var SUBTITLE_USAGE_VALUES = ["original", "translated"];
function parseSubtitleUsage(value) {
  return parseEnumOption(value, "--subtitle-usage", SUBTITLE_USAGE_VALUES);
}
var LANGUAGE_CODE_PATTERN = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;
function parseLanguageInput(value, flag) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new InvalidArgumentError(`\`${flag}\` must not be empty.`);
  }
  if (normalized.toLowerCase() !== "auto" && !LANGUAGE_CODE_PATTERN.test(normalized)) {
    throw new InvalidArgumentError(
      `\`${flag}\` value \`${normalized}\` is not a valid language code or locale tag (for example \`ja\`, \`fr\`, or \`pt-BR\`).`
    );
  }
  return normalized;
}
function round2(value) {
  return Number.parseFloat(value.toFixed(2));
}
function calcTotalPoints(points) {
  return points.map((point) => point.availablePoint ?? 0).filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
}
function estimateConsumedPoints(options) {
  const duration = Math.max(0, options.durationSeconds);
  switch (options.kind) {
    case "translate_dub":
      return options.enableSubtitles && options.removeOriginalSubtitle ? round2(duration / 15) : round2(duration / 20);
    case "translate_subtitles":
      return options.removeOriginalSubtitle ? round2(duration / 60) : 0;
    case "visual_translate":
      return round2(duration / 6);
    case "lipsync":
      return 5 + Math.ceil(duration / 12);
    default:
      return 0;
  }
}

// src/core/case.ts
var SNAKE_KEY_SPECIAL_WORDS = {
  id: "ID",
  url: "URL",
  os: "OS",
  srt: "SRT"
};
function snakeToCamelKey(key) {
  const words = key.split("_");
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (index > 0 && SNAKE_KEY_SPECIAL_WORDS[word]) {
      words[index] = SNAKE_KEY_SPECIAL_WORDS[word];
    } else if (index > 0 && word) {
      words[index] = word[0].toUpperCase() + word.slice(1);
    }
  }
  return words.join("");
}
function normalizePermissionMap(permissions) {
  const normalized = {};
  for (const [key, value] of Object.entries(permissions)) {
    normalized[snakeToCamelKey(key)] = value;
  }
  return normalized;
}

// src/core/user.ts
var userStorageRegionCache = /* @__PURE__ */ new Map();
async function authorizedRequest(options) {
  const session = await requireAuthenticatedSession(options.apiBaseUrl);
  return requestJson({
    apiBaseUrl: session.apiBaseUrl,
    headers: {
      Authorization: `${session.tokenType} ${session.accessToken}`
    },
    path: options.path
  });
}
function normalizeTeamSpace(teamSpace) {
  if (!teamSpace) {
    return null;
  }
  return {
    contact: teamSpace.contact ?? null,
    teamId: teamSpace.teamID ?? teamSpace.team_id ?? null,
    teamName: teamSpace.teamName ?? teamSpace.team_name ?? null,
    teamRole: teamSpace.teamRole ?? teamSpace.team_role ?? null,
    teamStatus: teamSpace.teamStatus ?? teamSpace.team_status ?? null
  };
}
function normalizeUserProfile2(profile) {
  return {
    displayId: profile.displayID ?? profile.display_id ?? null,
    email: profile.email ?? null,
    id: profile.uid ? String(profile.uid) : null,
    nickname: profile.nickname ?? null,
    permissions: normalizePermissionMap(profile.permissions ?? {}),
    teamSpace: normalizeTeamSpace(profile.teamSpace ?? profile.team_space),
    userState: profile.userState ?? profile.user_state ?? null
  };
}
function normalizeMembership(membership) {
  const rawUserType = membership.userType ?? membership.user_type ?? null;
  const rawPlanType = membership.planType ?? membership.plan_type ?? null;
  const rawUpcomingPlanType = membership.upcomingPlanType ?? membership.upcoming_plan_type ?? null;
  return {
    expiredAt: membership.expiredAt ?? membership.expired_at ?? null,
    isExpired: membership.isExpired ?? membership.is_expired ?? null,
    packsQuantity: membership.packsQuantity ?? membership.packs_quantity ?? null,
    paymentType: membership.paymentType ?? membership.payment_type ?? null,
    planType: normalizeMembershipUserType(rawPlanType),
    startedAt: membership.startedAt ?? membership.started_at ?? null,
    upcomingPlanType: normalizeMembershipUserType(rawUpcomingPlanType),
    userType: normalizeMembershipUserType(rawUserType),
    vipStatus: membership.vipStatus ?? membership.vip_status ?? null
  };
}
function normalizeMembershipPoint(point) {
  const scalePoint = (value) => {
    if (value === null || value === void 0) {
      return null;
    }
    return value / 100;
  };
  return {
    availablePoint: scalePoint(
      point.availablePoint ?? point.available_point ?? null
    ),
    expiredAt: point.expiredAt ?? point.expired_at ?? null,
    isExpired: point.isExpired ?? point.is_expired ?? null,
    pointType: point.pointType ?? point.point_type ?? null,
    totalPoint: scalePoint(point.totalPoint ?? point.total_point ?? null)
  };
}
function normalizeFeatureConfig(featureConfig) {
  return {
    abTestUserTag: featureConfig.abTestUserTag ?? featureConfig.ab_test_user_tag ?? null,
    captionDurationQuota: featureConfig.captionDurationQuota ?? featureConfig.caption_duration_quota ?? null,
    creatorRewardsAccess: featureConfig.creatorRewardsAccess ?? featureConfig.creator_rewards_access ?? null,
    emailNotificationsEnabled: featureConfig.emailNotificationsEnabled ?? featureConfig.email_notifications_enabled ?? null,
    enableApiKeyCreation: featureConfig.enableApiKeyCreation ?? featureConfig.enable_api_key_creation ?? null,
    existSuccessfulTranslation: featureConfig.existSuccessfulTranslation ?? featureConfig.exist_successful_translation ?? null,
    exportWithWatermark: featureConfig.exportWithWatermark ?? featureConfig.export_with_watermark ?? null,
    faceSwapCreated: featureConfig.faceSwapCreated ?? featureConfig.face_swap_created ?? null,
    featureConfig,
    firstFeature: featureConfig.firstFeature ?? featureConfig.first_feature ?? null,
    freeProjectCount: featureConfig.freeProjectCount ?? featureConfig.free_project_count ?? null,
    freeTranslateCaptionCount: featureConfig.freeTranslateCaptionCount ?? featureConfig.free_translate_caption_count ?? null,
    isVoiceUser: featureConfig.isVoiceUser ?? featureConfig.is_voice_user ?? null,
    maxParallelQuantity: featureConfig.maxParallelQuantity ?? featureConfig.max_parallel_quantity ?? null,
    newUserOnboarded: featureConfig.newUserOnboarded ?? featureConfig.new_user_onboarded ?? null,
    parallelQuantity: featureConfig.parallelQuantity ?? featureConfig.parallel_quantity ?? null,
    precisionFreeLipSyncCount: featureConfig.precisionFreeLipSyncCount ?? featureConfig.precision_free_lip_sync_count ?? null,
    translateCaptionDuration: featureConfig.translateCaptionDuration ?? featureConfig.translate_caption_duration ?? null,
    translateFrameCount: featureConfig.translateFrameCount ?? featureConfig.translate_frame_count ?? null,
    translationLiteAvailableDuration: featureConfig.translationLiteAvailableDuration ?? featureConfig.translation_lite_available_duration ?? null,
    translationLiteDurationQuota: featureConfig.translationLiteDurationQuota ?? featureConfig.translation_lite_duration_quota ?? null,
    userIndustry: featureConfig.userIndustry ?? featureConfig.user_industry ?? null,
    userRegion: featureConfig.userRegion ?? featureConfig.user_region ?? null
  };
}
async function getUserStorageRegion(apiBaseUrl) {
  const session = await requireAuthenticatedSession(apiBaseUrl);
  const cached = userStorageRegionCache.get(session.apiBaseUrl);
  if (cached !== void 0) {
    return cached;
  }
  const features = await getUserFeatureConfig(session.apiBaseUrl);
  const region = features.userRegion ?? "global";
  userStorageRegionCache.set(session.apiBaseUrl, region);
  return region;
}
async function getUserProfile(apiBaseUrl) {
  const response = await authorizedRequest({
    apiBaseUrl,
    path: "/v1/auth/users"
  });
  return normalizeUserProfile2(response.data);
}
async function getUserMembership(apiBaseUrl) {
  const response = await authorizedRequest({
    apiBaseUrl,
    path: "/v1/user_benefits/membership?product_class=vozo_web"
  });
  return normalizeMembership(response.data);
}
async function getUserPoints(apiBaseUrl) {
  const response = await authorizedRequest({
    apiBaseUrl,
    path: "/v1/user_benefits/point?product_class=vozo_web&unit=cpt"
  });
  return (response.data ?? []).map(normalizeMembershipPoint);
}
async function getUserMembershipStatus(apiBaseUrl) {
  const [user, membership] = await Promise.all([
    getUserProfile(apiBaseUrl),
    getUserMembership(apiBaseUrl)
  ]);
  return {
    membership,
    user
  };
}
async function getUserPointsStatus(apiBaseUrl) {
  const [user, points] = await Promise.all([
    getUserProfile(apiBaseUrl),
    getUserPoints(apiBaseUrl)
  ]);
  const round22 = (value) => Math.round(value * 100) / 100;
  const totalAvailablePoints = round22(
    points.reduce(
      (sum, point) => sum + Math.max(point.availablePoint ?? 0, 0),
      0
    )
  );
  const totalPointBalance = round22(
    points.reduce((sum, point) => sum + Math.max(point.totalPoint ?? 0, 0), 0)
  );
  return {
    points,
    totalAvailablePoints,
    totalPointBalance,
    user
  };
}
async function getUserFeatureConfig(apiBaseUrl) {
  const session = await requireAuthenticatedSession(apiBaseUrl);
  const response = await requestJson({
    apiBaseUrl: session.apiBaseUrl,
    headers: {
      Authorization: `${session.tokenType} ${session.accessToken}`
    },
    path: "/v1/user_benefits/-/feature_configs"
  });
  const normalized = normalizeFeatureConfig(response.data);
  setCliClientRegion(session.apiBaseUrl, normalized.userRegion);
  return normalized;
}
async function refreshCliClientRegion(apiBaseUrl) {
  try {
    await getUserFeatureConfig(apiBaseUrl);
  } catch {
  }
}
async function getUserSummary(apiBaseUrl) {
  const [profile, membership, points, features] = await Promise.all([
    getUserProfile(apiBaseUrl),
    getUserMembership(apiBaseUrl),
    getUserPoints(apiBaseUrl),
    getUserFeatureConfig(apiBaseUrl)
  ]);
  return {
    features,
    membership,
    points,
    profile
  };
}

// src/core/user-permissions.ts
var USER_PERMISSIONS = {
  accessShorts: "accessShorts",
  copyProject: "copyProject",
  createProject: "createProject",
  deleteProject: "deleteProject",
  editAudioTranslation: "editAudioTranslation",
  editLipSync: "editLipsync",
  editRewrite: "editRewrite",
  editTranslateSubtitle: "editTranslateSubtitle",
  editTranslation: "editTranslation",
  manageFont: "manageFont",
  manageSeat: "manageSeat",
  manageSubtitleStyle: "manageSubtitleStyle",
  manageSubscription: "manageSubscription",
  moveProject: "moveProject",
  purchaseSubscription: "purchaseSubscription",
  renameProject: "renameProject",
  shareProject: "shareProject",
  showPoints: "showPoints"
};
function isTeamAccessSuspended(profile) {
  return profile.teamSpace?.teamRole !== "owner" && profile.teamSpace?.teamStatus === "suspended";
}
function hasUserPermission(profile, required) {
  if (isTeamAccessSuspended(profile)) {
    return false;
  }
  const permissions = profile.permissions ?? {};
  if (Object.keys(permissions).length === 0) {
    return false;
  }
  const normalizedPermissions = new Map(
    Object.entries(permissions).map(([key, value]) => [
      key.toLowerCase(),
      value
    ])
  );
  return required.every(
    (key) => normalizedPermissions.get(key.toLowerCase()) === "allow"
  );
}
function buildPermissionDeniedError(options) {
  const required = options.permissionKeys.join(", ");
  if (options.profile && isTeamAccessSuspended(options.profile)) {
    const contact = options.profile?.teamSpace?.contact?.trim();
    const suffix = contact ? ` Contact your team admin (${contact}).` : " Contact your team admin.";
    return `Team access is suspended. You cannot ${options.action}.${suffix}`;
  }
  return `Your account does not have permission to ${options.action}. Required permission(s): ${required}. Contact your team admin if you need access.`;
}
function assertUserPermission(options) {
  if (hasUserPermission(options.profile, options.permissionKeys)) {
    return;
  }
  throw new Error(
    buildPermissionDeniedError({
      action: options.action,
      permissionKeys: options.permissionKeys,
      profile: options.profile
    })
  );
}
async function requireUserPermission(options) {
  const profile = await getUserProfile(options.apiBaseUrl);
  assertUserPermission({
    action: options.action,
    permissionKeys: options.permissionKeys,
    profile
  });
  return profile;
}

// src/core/upgrade.ts
import { spawnSync } from "node:child_process";
var GITHUB_SHORTHAND_PATTERN = /^[\w.-]+\/[\w.-]+$/;
function buildUpgradeInstallSpec(repoUrl, ref) {
  const trimmed = repoUrl.trim();
  if (!trimmed) {
    throw new Error(
      "No upgrade repository configured. Pass --repo <git-url>, set VOZO_CLI_UPGRADE_REPO, or add `repository.url` to package.json before building."
    );
  }
  let spec;
  if (trimmed.startsWith("git+") || trimmed.startsWith("github:")) {
    spec = trimmed;
  } else if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    spec = `git+${trimmed}`;
  } else if (/^git@[^:]+:/.test(trimmed)) {
    spec = `git+ssh://${trimmed.replace(":", "/")}`;
  } else if (GITHUB_SHORTHAND_PATTERN.test(trimmed)) {
    spec = `github:${trimmed}`;
  } else {
    throw new Error(
      `Unrecognized upgrade repository format: ${trimmed}. Use org/repo, an https URL, or a git+ spec.`
    );
  }
  const normalizedRef = ref?.trim();
  return normalizedRef ? `${spec}#${normalizedRef}` : spec;
}
function runCommand(command, args, captureOutput = false) {
  return spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: captureOutput ? "pipe" : ["ignore", "inherit", "inherit"]
  });
}
function readInstalledCliVersion() {
  const result = runCommand("vozo-cli", ["--version"], true);
  if (result.status !== 0) {
    return null;
  }
  return result.stdout?.trim() || null;
}
async function runCliUpgrade(options) {
  const repoUrl = resolveUpgradeRepoUrl(options.repoUrl);
  const installSpec = buildUpgradeInstallSpec(repoUrl, options.ref);
  printStderr(`Upgrading vozo-cli from ${CLI_VERSION} via ${installSpec} ...`);
  const install = runCommand("npm", ["install", "-g", installSpec]);
  if (install.status !== 0) {
    throw new Error(
      `npm install -g ${installSpec} failed with exit code ${install.status ?? "unknown"}. If this is a permissions issue, retry with a Node version manager or configure a user-level npm prefix.`
    );
  }
  const toVersion = readInstalledCliVersion();
  if (toVersion) {
    printStderr(`vozo-cli upgraded: ${CLI_VERSION} -> ${toVersion}`);
  } else {
    printStderr(
      "vozo-cli was installed, but reading the new version failed; open a new shell and run `vozo-cli --version` to verify."
    );
  }
  let skills = "skipped";
  if (!options.skipSkills) {
    printStderr("Installing bundled skills from the new version ...");
    const skillsInstall = runCommand("vozo-cli", ["skills", "install"]);
    skills = skillsInstall.status === 0 ? "installed" : "failed";
    if (skills === "failed") {
      printStderr(
        "Warning: `vozo-cli skills install` failed after the upgrade. Run it manually to refresh the bundled skills."
      );
    }
  }
  return {
    fromVersion: CLI_VERSION,
    installSpec,
    skills,
    status: "upgraded",
    toVersion
  };
}

// src/core/install.ts
import { spawnSync as spawnSync2 } from "node:child_process";
var DEFAULT_NPM_PACKAGE = "@vozoai/cli";
var DEFAULT_GITHUB_REPO = "vozoai/cli";
var DEFAULT_SKILLS_GITHUB = "vozoai/cli";
function runCommand2(command, args, captureOutput = false) {
  return spawnSync2(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: captureOutput ? "pipe" : ["ignore", "inherit", "inherit"]
  });
}
function readInstalledCliVersion2() {
  const result = runCommand2("vozo-cli", ["--version"], true);
  if (result.status !== 0) {
    return null;
  }
  return result.stdout?.trim() || null;
}
function resolveInstallSpec(options) {
  if (options?.github) {
    const repoUrl = options.repoUrl?.trim() || process.env.VOZO_CLI_UPGRADE_REPO?.trim() || DEFAULT_GITHUB_REPO;
    return buildUpgradeInstallSpec(repoUrl, options?.ref);
  }
  const packageName = options?.packageName?.trim() || process.env.VOZO_CLI_NPM_PACKAGE?.trim() || DEFAULT_NPM_PACKAGE;
  const ref = options?.ref?.trim();
  return ref ? `${packageName}@${ref}` : packageName;
}
function installSkillsFromGithub() {
  printStderr(
    `Installing agent skills from GitHub via \`npx skills add ${DEFAULT_SKILLS_GITHUB} -g -y\` ...`
  );
  const result = runCommand2("npx", [
    "--yes",
    "skills",
    "add",
    DEFAULT_SKILLS_GITHUB,
    "-g",
    "-y"
  ]);
  return result.status === 0;
}
function installSkillsFromBundledPackage() {
  printStderr(
    "Falling back to bundled `vozo-cli skills install` (local/offline) ..."
  );
  const result = runCommand2("vozo-cli", ["skills", "install"]);
  return result.status === 0;
}
async function runCliInstall(options) {
  const installSpec = resolveInstallSpec(options);
  printStderr(
    `Installing vozo-cli ${CLI_VERSION ? `(bootstrap ${CLI_VERSION}) ` : ""}via ${installSpec} ...`
  );
  const install = runCommand2("npm", ["install", "-g", installSpec]);
  if (install.status !== 0) {
    throw new Error(
      `npm install -g ${installSpec} failed with exit code ${install.status ?? "unknown"}. If this is a permissions issue, retry with a Node version manager or configure a user-level npm prefix.`
    );
  }
  const version = readInstalledCliVersion2();
  if (version) {
    printStderr(`vozo-cli installed: ${version}`);
  } else {
    printStderr(
      "vozo-cli was installed, but reading the new version failed; open a new shell and run `vozo-cli --version` to verify."
    );
  }
  let skills = "skipped";
  let skillsMethod = "skipped";
  if (!options?.skipSkills) {
    if (installSkillsFromGithub()) {
      skills = "installed";
      skillsMethod = "skills_cli";
      printStderr("Agent skills installed from GitHub.");
    } else if (installSkillsFromBundledPackage()) {
      skills = "installed";
      skillsMethod = "bundled";
      printStderr("Bundled agent skills installed.");
    } else {
      skills = "failed";
      skillsMethod = "skills_cli";
      printStderr(
        `Warning: skills install failed. Run \`npx skills add ${DEFAULT_SKILLS_GITHUB} -g -y\` or \`vozo-cli skills install\` manually.`
      );
    }
  }
  return {
    installSpec,
    skills,
    skillsMethod,
    status: "installed",
    version
  };
}

// src/core/local-file.ts
import { constants, existsSync as existsSync2 } from "node:fs";
import { access, open, readdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, basename, join, dirname as dirname2 } from "node:path";
var moduleDir = typeof __dirname !== "undefined" ? __dirname : dirname2(process.argv[1] ?? process.cwd());
function resolveMediainfoWasmPath() {
  const bundledWasmPath = join(moduleDir, "MediaInfoModule.wasm");
  if (existsSync2(bundledWasmPath)) {
    return bundledWasmPath;
  }
  try {
    const cliPackageRequire = createRequire(
      join(moduleDir, "..", "package.json")
    );
    return join(
      dirname2(cliPackageRequire.resolve("mediainfo.js/package.json")),
      "dist/MediaInfoModule.wasm"
    );
  } catch (_error) {
    return bundledWasmPath;
  }
}
var SUBTITLE_EXTENSIONS = /* @__PURE__ */ new Set([".srt", ".txt", ".vtt"]);
var AUDIO_EXTENSIONS = /* @__PURE__ */ new Set([".aac", ".m4a", ".mp3", ".wav"]);
var IMAGE_EXTENSIONS = /* @__PURE__ */ new Set([".jpeg", ".jpg", ".png", ".webp"]);
var VIDEO_EXTENSIONS = /* @__PURE__ */ new Set([".avi", ".mov", ".mp4", ".webm", ".wmv"]);
var mediainfoPromise = null;
var mediainfoAnalysisQueue = Promise.resolve();
async function getMediainfoInstance() {
  if (!mediainfoPromise) {
    mediainfoPromise = (async () => {
      const { default: mediaInfoFactory } = await import("mediainfo.js");
      return mediaInfoFactory({
        format: "object",
        locateFile: () => resolveMediainfoWasmPath()
      });
    })();
  }
  return mediainfoPromise;
}
function extractDurationSeconds(result) {
  const tracks = result?.media?.track ?? [];
  for (const trackType of ["General", "Video", "Audio"]) {
    const track = tracks.find((entry) => entry["@type"] === trackType);
    if (track?.Duration == null) {
      continue;
    }
    const parsed = Number(track.Duration);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}
function extractVideoDimensions(result) {
  const tracks = result?.media?.track ?? [];
  for (const trackType of ["Video", "General"]) {
    const track = tracks.find((entry) => entry["@type"] === trackType);
    if (!track) {
      continue;
    }
    const width = Number(track.Width);
    const height = Number(track.Height);
    if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
      return { width, height };
    }
  }
  return null;
}
function buildUndetectableMediaDurationError(filePath) {
  return `Unable to detect media duration for ${filePath}. Upload this file on the Vozo web app (${getWebAppUrl()}) instead.`;
}
async function analyzeLocalMediaFile(filePath) {
  const run = async () => {
    const fileSize = await getLocalFileSize(filePath);
    const mediainfo = await getMediainfoInstance();
    return mediainfo.analyzeData(
      () => fileSize,
      async (chunkSize, offset) => {
        const handle = await open(filePath, "r");
        try {
          const buffer = Buffer.alloc(chunkSize);
          const { bytesRead } = await handle.read(buffer, 0, chunkSize, offset);
          return new Uint8Array(buffer.subarray(0, bytesRead));
        } finally {
          await handle.close();
        }
      }
    );
  };
  const analysis = mediainfoAnalysisQueue.then(run, run);
  mediainfoAnalysisQueue = analysis.catch(() => void 0);
  return analysis;
}
async function getLocalMediaMetadata(filePath) {
  const result = await analyzeLocalMediaFile(filePath);
  const durationSeconds = extractDurationSeconds(result);
  if (durationSeconds == null) {
    throw new Error(buildUndetectableMediaDurationError(filePath));
  }
  const dimensions = extractVideoDimensions(result);
  return {
    durationSeconds,
    width: dimensions?.width,
    height: dimensions?.height
  };
}
async function ensureLocalFileReadable(filePath) {
  await access(filePath, constants.R_OK);
}
async function ensureLocalDirectoryReadable(directoryPath) {
  await access(directoryPath, constants.R_OK | constants.X_OK);
}
function getLocalFileExtension(filePath) {
  return extname(filePath).replace(/^\./, "").toLowerCase();
}
function getLocalFileBaseName(filePath) {
  return basename(filePath);
}
function getLocalFileTitle(filePath) {
  return basename(filePath, extname(filePath));
}
function inferLocalMediaType(filePath) {
  const extension = extname(filePath).toLowerCase();
  if (SUBTITLE_EXTENSIONS.has(extension)) {
    return "subtitle";
  }
  if (AUDIO_EXTENSIONS.has(extension)) {
    return "audio";
  }
  if (IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }
  return "video";
}
function isSupportedLocalMediaFile(filePath) {
  const extension = extname(filePath).toLowerCase();
  return SUBTITLE_EXTENSIONS.has(extension) || AUDIO_EXTENSIONS.has(extension) || IMAGE_EXTENSIONS.has(extension) || VIDEO_EXTENSIONS.has(extension);
}
function assertSupportedLocalMediaFile(filePath) {
  if (isSupportedLocalMediaFile(filePath)) {
    return;
  }
  throw new Error(
    `Unsupported media file extension for ${filePath}. Supported video formats: ${[
      ...VIDEO_EXTENSIONS
    ].join(", ")}; audio formats: ${[...AUDIO_EXTENSIONS].join(", ")}.`
  );
}
async function getLocalFileSize(filePath) {
  const fileStats = await stat(filePath);
  return fileStats.size;
}
async function getLocalMediaDuration(filePath) {
  const metadata = await getLocalMediaMetadata(filePath);
  return metadata.durationSeconds;
}
async function listLocalFilesInDirectory(directoryPath) {
  await ensureLocalDirectoryReadable(directoryPath);
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listLocalFilesInDirectory(entryPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

// src/core/user-font.ts
import { readFile as readFile2 } from "node:fs/promises";
import { basename as basename2, extname as extname2 } from "node:path";

// ../shared-lib/constants/fontList.ts
var prefix = "https://static-hb.clipp.ai/resources/static/assets/fonts";
var PresetFontListMap = {
  Anton: {
    fontURL: `${prefix}/anton.woff`,
    fontFamily: "Anton",
    fontFullName: "Anton",
    fontSubfamily: "",
    fontPath: "",
    fontID: "Anton"
  },
  BakbakOne: {
    fontURL: `${prefix}/bakbakOne.woff`,
    fontFamily: "Bakbak One",
    fontFullName: "BakbakOne",
    fontSubfamily: "",
    fontPath: "",
    fontID: "BakbakOne"
  },
  Bayon: {
    fontURL: `${prefix}/bayon.woff`,
    fontFamily: "Bayon",
    fontFullName: "Bayon",
    fontSubfamily: "",
    fontPath: "",
    fontID: "Bayon"
  },
  Chivo: {
    fontURL: `${prefix}/chivo.woff`,
    fontFamily: "Chivo",
    fontFullName: "Chivo",
    fontSubfamily: "",
    fontPath: "",
    fontID: "Chivo"
  },
  ButterSans: {
    fontURL: `${prefix}/ButterSans.woff`,
    fontFamily: "Butter Sans",
    fontFullName: "ButterSans",
    fontSubfamily: "",
    fontPath: "",
    fontID: "ButterSans"
  },
  Chromate: {
    fontURL: `${prefix}/Chromate.woff`,
    fontFamily: "Chromate",
    fontFullName: "Chromate",
    fontSubfamily: "",
    fontPath: "",
    fontID: "Chromate"
  },
  FredokaOne: {
    fontURL: `${prefix}/fredokaOne.woff`,
    fontFamily: "Fredoka One",
    fontFullName: "FredokaOne",
    fontSubfamily: "",
    fontPath: "",
    fontID: "FredokaOne"
  },
  MontserratBold: {
    fontURL: `${prefix}/MontserratBold.woff`,
    fontFamily: "Montserrat Bold",
    fontFullName: "MontserratBold",
    fontSubfamily: "",
    fontPath: "",
    fontID: "MontserratBold"
  },
  MontserratBlackItalic: {
    fontURL: `${prefix}/MontserratBlackItalic.woff`,
    fontFamily: "Montserrat Black Italic",
    fontFullName: "MontserratBlackItalic",
    fontSubfamily: "",
    fontPath: "",
    fontID: "MontserratBlackItalic"
  },
  LilitaOne: {
    fontURL: `${prefix}/lilitaOne.woff`,
    fontFamily: "Lilita One",
    fontFullName: "LilitaOne",
    fontSubfamily: "",
    fontPath: "",
    fontID: "LilitaOne"
  },
  SecularOne: {
    fontURL: `${prefix}/secularOne.woff`,
    fontFamily: "Secular One",
    fontFullName: "SecularOne",
    fontSubfamily: "",
    fontPath: "",
    fontID: "SecularOne"
  },
  Sriracha: {
    fontURL: `${prefix}/sriracha.woff`,
    fontFamily: "Sriracha",
    fontFullName: "Sriracha",
    fontSubfamily: "",
    fontPath: "",
    fontID: "Sriracha"
  },
  Staatliches: {
    fontURL: `${prefix}/staatliches.woff`,
    fontFamily: "Staatliches",
    fontFullName: "Staatliches",
    fontSubfamily: "",
    fontPath: "",
    fontID: "Staatliches"
  },
  TiltWarp: {
    fontURL: `${prefix}/TiltWarp.woff`,
    fontFamily: "TiltWarp",
    fontFullName: "TiltWarp",
    fontSubfamily: "",
    fontPath: "",
    fontID: "TiltWarp"
  },
  Truculenta: {
    fontURL: `${prefix}/truculenta.woff`,
    fontFamily: "Truculenta",
    fontFullName: "Truculenta",
    fontSubfamily: "",
    fontPath: "",
    fontID: "Truculenta"
  },
  NotoSansKR: {
    fontURL: `${prefix}/NotoSansKr.otf`,
    fontFamily: "Noto Sans KR",
    fontFullName: "NotoSansKR",
    fontSubfamily: "",
    fontPath: "",
    fontID: "NotoSansKR"
  },
  NotoSansJP: {
    fontURL: `${prefix}/NotoSansJpRegular.woff`,
    fontFamily: "Noto Sans JP",
    fontFullName: "NotoSansJP",
    fontSubfamily: "",
    fontPath: "",
    fontID: "NotoSansJP"
  },
  NotoNaskhArabicSemiBold: {
    fontURL: `${prefix}/NotoNaskhArabicSemiBold.woff`,
    fontFamily: "Noto Naskh Arabic",
    fontFullName: "NotoNaskhArabicSemiBold",
    fontSubfamily: "",
    fontPath: "",
    fontID: "NotoNaskhArabicSemiBold"
  },
  NotoSansTamil: {
    fontURL: `${prefix}/NotoSansTamil.woff`,
    fontFamily: "Noto Sans Tamil",
    fontFullName: "NotoSansTamil",
    fontSubfamily: "",
    fontPath: "",
    fontID: "NotoSansTamil"
  },
  Sathu: {
    fontURL: `${prefix}/Sathu.ttf`,
    fontFamily: "Sathu",
    fontFullName: "Sathu",
    fontSubfamily: "",
    fontPath: "",
    fontID: "Sathu"
  },
  AlibabaPuHuiTi: {
    fontURL: `${prefix}/AlibabaPuHuiTi.woff`,
    fontFamily: "\u963F\u91CC\u5DF4\u5DF4\u666E\u60E0\u4F53",
    fontFullName: "AlibabaPuHuiTi",
    fontSubfamily: "",
    fontPath: "",
    fontID: "AlibabaPuHuiTi"
  },
  InterBold: {
    fontURL: `${prefix}/interBold.woff`,
    fontFamily: "Inter Bold",
    fontFullName: "InterBold",
    fontSubfamily: "",
    fontPath: "",
    fontID: "InterBold"
  },
  YaoGunQingNianHei: {
    fontURL: `${prefix}/YaoGunQingNianHei.ttf`,
    fontFamily: "YaoGunQingNianHei",
    fontFullName: "YaoGunQingNianHei",
    fontSubfamily: "",
    fontPath: "",
    fontID: "YaoGunQingNianHei"
  },
  SourceHanSerifSC: {
    fontURL: `${prefix}/SourceHanSerifSC.otf`,
    fontFamily: "SourceHanSerifSC",
    fontFullName: "SourceHanSerifSC",
    fontSubfamily: "",
    fontPath: "",
    fontID: "SourceHanSerifSC"
  },
  IPix: {
    fontURL: `${prefix}/IPix.ttf`,
    fontFamily: "IPix",
    fontFullName: "IPix",
    fontSubfamily: "",
    fontPath: "",
    fontID: "IPix"
  },
  FrutigerArabic: {
    fontURL: `${prefix}/FrutigerLTArabic45Light.ttf`,
    fontFamily: "Frutiger Arabic",
    fontFullName: "FrutigerLTArabic45Light",
    fontSubfamily: "",
    fontPath: "",
    fontID: "FrutigerLTArabic45Light"
  },
  Gulim: {
    fontURL: `${prefix}/Gulim.ttf`,
    fontFamily: "Gulim",
    fontFullName: "Gulim",
    fontSubfamily: "",
    fontPath: "",
    fontID: "Gulim"
  },
  MSPGothic: {
    fontURL: `${prefix}/MSPGothicRegular.ttf`,
    fontFamily: "MS PGothic",
    fontFullName: "MSPGothic",
    fontSubfamily: "",
    fontPath: "",
    fontID: "MSPGothic"
  },
  ArialHebrew: {
    fontURL: `${prefix}/ArialHebrewLight.ttf`,
    fontFamily: "Arial Hebrew",
    fontFullName: "ArialHebrew",
    fontSubfamily: "",
    fontPath: "",
    fontID: "ArialHebrew"
  },
  FrutigerNeue: {
    fontURL: `${prefix}/FrutigerNeueLight.ttf`,
    fontFamily: "Frutiger Neue",
    fontFullName: "FrutigerNeue",
    fontSubfamily: "",
    fontPath: "",
    fontID: "FrutigerNeue"
  },
  DFPHeiW3: {
    fontURL: `${prefix}/DFPHeiW3.ttf`,
    fontFamily: "DFPHeiW3",
    fontFullName: "DFPHeiW3",
    fontSubfamily: "",
    fontPath: "",
    fontID: "DFPHeiW3"
  },
  DFHeiW3: {
    fontURL: `${prefix}/DFHeiW3.otf`,
    fontFamily: "DFHeiW3",
    fontFullName: "DFHeiW3",
    fontSubfamily: "",
    fontPath: "",
    fontID: "DFHeiW3"
  },
  Frutiger45Light: {
    fontURL: `${prefix}/Frutiger45Light.otf`,
    fontFamily: "Frutiger",
    fontFullName: "Frutiger45Light",
    fontSubfamily: "",
    fontPath: "",
    fontID: "Frutiger45Light"
  },
  ArialHebrewLight: {
    fontURL: `${prefix}/ArialHebrewLight.ttf`,
    fontFamily: "Arial Hebrew",
    fontFullName: "ArialHebrewLight",
    fontSubfamily: "",
    fontPath: "",
    fontID: "ArialHebrewLight"
  },
  LilyUPCRegular: {
    fontURL: `${prefix}/LilyUPCRegular.ttf`,
    fontFamily: "LilyUPC",
    fontFullName: "LilyUPCRegular",
    fontSubfamily: "",
    fontPath: "",
    fontID: "LilyUPCRegular"
  },
  NotoSansBold: {
    fontURL: `${prefix}/NotoSans-Bold.ttf`,
    fontFamily: "Noto Sans Bold",
    fontFullName: "NotoSansBold",
    fontSubfamily: "",
    fontPath: "",
    fontID: "NotoSansBold"
  },
  NotoSansLight: {
    fontURL: `${prefix}/NotoSans-Light.ttf`,
    fontFamily: "Noto Sans Light",
    fontFullName: "NotoSansLight",
    fontSubfamily: "",
    fontPath: "",
    fontID: "NotoSansLight"
  },
  NotoSansMedium: {
    fontURL: `${prefix}/NotoSans-Medium.ttf`,
    fontFamily: "Noto Sans Medium",
    fontFullName: "NotoSansMedium",
    fontSubfamily: "",
    fontPath: "",
    fontID: "NotoSansMedium"
  },
  NotoSansRegular: {
    fontURL: `${prefix}/NotoSans-Regular.ttf`,
    fontFamily: "Noto Sans Regular",
    fontFullName: "NotoSansRegular",
    fontSubfamily: "",
    fontPath: "",
    fontID: "NotoSansRegular"
  },
  NotoSansMalayalam: {
    fontURL: `${prefix}/NotoSansMalayalam.ttf`,
    fontFamily: "Noto Sans Malayalam",
    fontFullName: "NotoSansMalayalam",
    fontSubfamily: "",
    fontPath: "",
    fontID: "NotoSansMalayalam"
  },
  NotoSansArmenian: {
    fontURL: `${prefix}/NotoSansArmenian.ttf`,
    fontFamily: "Noto Sans Armenian",
    fontFullName: "NotoSansArmenian",
    fontSubfamily: "",
    fontPath: "",
    fontID: "NotoSansArmenian"
  },
  NotoSansGeorgian: {
    fontURL: `${prefix}/NotoSansGeorgian.ttf`,
    fontFamily: "Noto Sans Georgian",
    fontFullName: "NotoSansGeorgian",
    fontSubfamily: "",
    fontPath: "",
    fontID: "NotoSansGeorgian"
  },
  NotoSansMyanmar: {
    fontURL: `${prefix}/NotoSansMyanmar.ttf`,
    fontFamily: "Noto Sans Myanmar",
    fontFullName: "NotoSansMyanmar",
    fontSubfamily: "",
    fontPath: "",
    fontID: "NotoSansMyanmar"
  },
  NotoSansKhmer: {
    fontURL: `${prefix}/NotoSansKhmer.ttf`,
    fontFamily: "Noto Sans Khmer",
    fontFullName: "NotoSansKhmer",
    fontSubfamily: "",
    fontPath: "",
    fontID: "NotoSansKhmer"
  },
  NotoSansKannada: {
    fontURL: `${prefix}/NotoSansKannada.ttf`,
    fontFamily: "Noto Sans Kannada",
    fontFullName: "NotoSansKannada",
    fontSubfamily: "",
    fontPath: "",
    fontID: "NotoSansKannada"
  },
  NotoSansSinhala: {
    fontURL: `${prefix}/NotoSansSinhala.ttf`,
    fontFamily: "Noto Sans Sinhala",
    fontFullName: "NotoSansSinhala",
    fontSubfamily: "",
    fontPath: "",
    fontID: "NotoSansSinhala"
  },
  NotoSansLao: {
    fontURL: `${prefix}/NotoSansLao.ttf`,
    fontFamily: "Noto Sans Lao",
    fontFullName: "NotoSansLao",
    fontSubfamily: "",
    fontPath: "",
    fontID: "NotoSansLao"
  },
  NotoSansGujarati: {
    fontURL: `${prefix}/NotoSansGujarati.ttf`,
    fontFamily: "Noto Sans Gujarati",
    fontFullName: "NotoSansGujarati",
    fontSubfamily: "",
    fontPath: "",
    fontID: "NotoSansGujarati"
  },
  NotoSansOriya: {
    fontURL: `${prefix}/NotoSansOriya.ttf`,
    fontFamily: "Noto Sans Oriya",
    fontFullName: "NotoSansOriya",
    fontSubfamily: "",
    fontPath: "",
    fontID: "NotoSansOriya"
  },
  NotoSansGurmukhi: {
    fontURL: `${prefix}/NotoSansGurmukhi.ttf`,
    fontFamily: "Noto Sans Gurmukhi",
    fontFullName: "NotoSansGurmukhi",
    fontSubfamily: "",
    fontPath: "",
    fontID: "NotoSansGurmukhi"
  },
  NotoSansCanadianAboriginal: {
    fontURL: `${prefix}/NotoSansCanadianAboriginal.ttf`,
    fontFamily: "Noto Sans Canadian Aboriginal",
    fontFullName: "NotoSansCanadianAboriginal",
    fontSubfamily: "",
    fontPath: "",
    fontID: "NotoSansCanadianAboriginal"
  }
};
var PresetFontList = Object.values(PresetFontListMap);

// src/core/user-font.ts
var FONT_FILE_SIZE_LIMIT_BYTES = 30 * 1024 * 1024;
var FONT_UPLOAD_ERROR_CODES = {
  studioRequired: 1510,
  limitReached: 1511,
  parseFailed: 1512
};
function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function normalizeUserFontRecord(data) {
  const fontFullName = readString(data.font_full_name) ?? readString(data.fontFullName);
  const fontURL = readString(data.font_url) ?? readString(data.fontURL);
  if (!fontFullName || !fontURL) {
    throw new Error("Font API response was incomplete.");
  }
  return {
    fontFamily: readString(data.font_family) ?? readString(data.fontFamily) ?? fontFullName,
    fontFullName,
    fontID: readString(data.font_id) ?? readString(data.fontID) ?? "",
    fontPath: readString(data.font_path) ?? readString(data.fontPath) ?? "",
    fontSubfamily: readString(data.font_subfamily) ?? readString(data.fontSubfamily) ?? "",
    fontURL
  };
}
function normalizeUserFontResponse(payload) {
  const data = payload && typeof payload === "object" ? payload : {};
  try {
    return normalizeUserFontRecord(data);
  } catch {
    throw new Error(
      "Font upload succeeded but the API response was incomplete."
    );
  }
}
async function listUserFonts(options) {
  const session = await requireAuthenticatedSession(options?.apiBaseUrl);
  const response = await requestJson({
    apiBaseUrl: session.apiBaseUrl,
    headers: {
      Authorization: `${session.tokenType} ${session.accessToken}`
    },
    path: "/v1/user_fonts"
  });
  const items = Array.isArray(response.data) ? response.data : [];
  return items.map(
    (item) => item && typeof item === "object" ? normalizeUserFontRecord(item) : null
  ).filter((item) => item !== null);
}
async function assertFontFileForUpload(fontFilePath) {
  await ensureLocalFileReadable(fontFilePath);
  const extension = extname2(fontFilePath).toLowerCase();
  if (extension !== ".ttf" && extension !== ".otf") {
    throw new Error(
      `Unsupported font file type "${extension || "(none)"}". Use a .ttf or .otf file.`
    );
  }
  const sizeBytes = await getLocalFileSize(fontFilePath);
  if (sizeBytes > FONT_FILE_SIZE_LIMIT_BYTES) {
    throw new Error(
      `Font file exceeds the ${FONT_FILE_SIZE_LIMIT_BYTES / (1024 * 1024)} MB limit.`
    );
  }
}
function buildFontUploadError(error) {
  if (error.code === FONT_UPLOAD_ERROR_CODES.studioRequired) {
    return new Error(
      `Custom font upload requires a ${STUDIO_PLAN_LABEL} membership. Upgrade your plan or remove --font-file.`
    );
  }
  if (error.code === FONT_UPLOAD_ERROR_CODES.limitReached) {
    return new Error(
      "Upload limit reached: a maximum of 20 custom fonts can be stored on your account."
    );
  }
  if (error.code === FONT_UPLOAD_ERROR_CODES.parseFailed) {
    return new Error(
      "This font file cannot be used. Upload a different .ttf or .otf file."
    );
  }
  return error;
}
async function uploadUserFontFromFile(options) {
  await assertFontFileForUpload(options.filePath);
  const session = await requireAuthenticatedSession(options.apiBaseUrl);
  const url = new URL("/v1/user_fonts", getApiBaseUrl(session.apiBaseUrl));
  const fileBuffer = await readFile2(options.filePath);
  const form = new FormData();
  form.append("font", new Blob([fileBuffer]), basename2(options.filePath));
  let response;
  let rawText;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: buildDefaultApiRequestHeaders(
        {
          Accept: "application/json",
          Authorization: `${session.tokenType} ${session.accessToken}`
        },
        session.apiBaseUrl
      ),
      body: form,
      signal: AbortSignal.timeout(12e4)
    });
    rawText = await response.text();
  } catch (error) {
    if (typeof error === "object" && error !== null && "name" in error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error(
        `Unable to upload font file: request timed out after 120s. Check your network connection and try again.`
      );
    }
    throw buildNetworkRequestError(error, url);
  }
  const parsedBody = rawText ? JSON.parse(rawText) : void 0;
  if (!response.ok) {
    const apiError = new CliApiError(
      readString(parsedBody?.message) ?? `Font upload failed with status ${response.status}`,
      response.status,
      typeof parsedBody?.code === "number" ? parsedBody.code : void 0,
      parsedBody
    );
    throw buildFontUploadError(apiError);
  }
  handleCliUpgradeHeaders(response);
  return normalizeUserFontResponse(parsedBody);
}
function parseVisualTranslateFontOptions(options) {
  const fontFilePath = options.fontFilePath?.trim() || void 0;
  if (fontFilePath) {
    return {
      fontFilePath,
      fontKind: "uploaded_file",
      hasCustomFont: true
    };
  }
  const fontFamily = options.fontFamily?.trim() || void 0;
  const fontSrc = options.fontSrc?.trim() || void 0;
  const hasFontUrl = Boolean(fontFamily || fontSrc);
  if (hasFontUrl && (!fontFamily || !fontSrc)) {
    if (fontFamily && !fontSrc) {
      const preset = Object.values(PresetFontListMap).find(
        (item) => item.fontFullName === fontFamily
      );
      if (preset) {
        return {
          fontFamily,
          fontSrc: void 0,
          fontKind: "preset",
          hasCustomFont: false
        };
      }
    }
    throw new Error(
      "Custom font requires both `--font-family` and `--font-src`, or use `--font-file` to upload a local font. Preset fonts only need `--font-family`."
    );
  }
  return {
    fontFamily,
    fontSrc,
    fontKind: hasFontUrl ? "custom_url" : "none",
    hasCustomFont: Boolean(hasFontUrl)
  };
}
async function materializeVisualTranslateFont(options) {
  const parsed = parseVisualTranslateFontOptions(options);
  if (parsed.fontFilePath) {
    const uploaded = await uploadUserFontFromFile({
      apiBaseUrl: options.apiBaseUrl,
      filePath: parsed.fontFilePath
    });
    return {
      fontFamily: uploaded.fontFullName,
      fontSrc: uploaded.fontURL
    };
  }
  if (parsed.fontKind === "preset") {
    const preset = Object.values(PresetFontListMap).find(
      (item) => item.fontFullName === parsed.fontFamily
    );
    if (!preset) {
      throw new Error(
        `Unknown preset font: ${parsed.fontFamily}. Run \`vozo-cli project visual_translate fonts\` to see supported values.`
      );
    }
    return {
      fontFamily: preset.fontFullName,
      fontSrc: preset.fontURL
    };
  }
  if (parsed.hasCustomFont) {
    return {
      fontFamily: parsed.fontFamily,
      fontSrc: parsed.fontSrc
    };
  }
  return {};
}

// src/core/font-capabilities.ts
function buildPresetFonts() {
  return Object.values(PresetFontListMap).map((font) => ({
    fontFamily: font.fontFamily,
    fontFullName: font.fontFullName,
    fontID: font.fontID,
    fontURL: font.fontURL,
    source: "preset"
  })).sort((left, right) => left.fontFullName.localeCompare(right.fontFullName));
}
function mapUserFonts(fonts) {
  return fonts.map((font) => ({
    fontFamily: font.fontFamily,
    fontFullName: font.fontFullName,
    fontID: font.fontID,
    fontURL: font.fontURL,
    source: "user"
  })).sort((left, right) => left.fontFullName.localeCompare(right.fontFullName));
}
async function getVisualTranslateFonts(options) {
  const presetFonts = buildPresetFonts();
  const authStatus = await getAuthStatus(options?.apiBaseUrl);
  if (!authStatus.authenticated) {
    return {
      authenticated: false,
      presetFonts,
      usage: buildFontUsage(),
      userFonts: []
    };
  }
  const userFonts = mapUserFonts(
    await listUserFonts({ apiBaseUrl: options?.apiBaseUrl })
  );
  return {
    authenticated: true,
    presetFonts,
    usage: buildFontUsage(),
    userFonts
  };
}
function buildFontUsage() {
  return {
    listCommand: "vozo-cli project visual_translate fonts",
    localFile: "Use `--font-file <path>` with a local .ttf or .otf file (Studio+ membership, max 30 MB). Do not pass `--font-family` / `--font-src` together with `--font-file`.",
    presetOrRemote: "Use `--font-family <fontFullName>` and `--font-src <fontURL>` from a preset or user font below (both required, Studio+ membership)."
  };
}

// ../shared-lib/constants/language.ts
var TranslateOriginalLanguageMap = {
  "English (United States)": "en-US",
  "English (United Kingdom)": "en-GB",
  "English (Australia)": "en-AU",
  "English (Canada)": "en-CA",
  "English (Ghana)": "en-GH",
  "English (Hong Kong)": "en-HK",
  "English (Ireland)": "en-IE",
  "English (India)": "en-IN",
  "English (Kenya)": "en-KE",
  "English (Nigeria)": "en-NG",
  "English (New Zealand)": "en-NZ",
  "English (Philippines)": "en-PH",
  "English (Singapore)": "en-SG",
  "English (Tanzania)": "en-TZ",
  "English (South Africa)": "en-ZA",
  "Chinese (Mainland China)": "zh-CN",
  "Chinese (Hong Kong)": "zh-HK",
  "Chinese (Taiwan)": "zh-TW",
  "Spanish (Spain)": "es-ES",
  "Spanish (Mexico)": "es-MX",
  "Spanish (United States)": "es-US",
  "Spanish (Argentina)": "es-AR",
  "Spanish (Bolivia)": "es-BO",
  "Spanish (Chile)": "es-CL",
  "Spanish (Colombia)": "es-CO",
  "Spanish (Costa Rica)": "es-CR",
  "Spanish (Cuba)": "es-CU",
  "Spanish (Dominican Republic)": "es-DO",
  "Spanish (Ecuador)": "es-EC",
  "Spanish (Equatorial Guinea)": "es-GQ",
  "Spanish (Guatemala)": "es-GT",
  "Spanish (Honduras)": "es-HN",
  "Spanish (Nicaragua)": "es-NI",
  "Spanish (Panama)": "es-PA",
  "Spanish (Peru)": "es-PE",
  "Spanish (Puerto Rico)": "es-PR",
  "Spanish (Paraguay)": "es-PY",
  "Spanish (El Salvador)": "es-SV",
  "Spanish (Uruguay)": "es-UY",
  "Spanish (Venezuela)": "es-VE",
  "Arabic (Egypt)": "ar-EG",
  "Arabic (Saudi Arabia)": "ar-SA",
  "Arabic (United Arab Emirates)": "ar-AE",
  "Arabic (Morocco)": "ar-MA",
  "Arabic (Syria)": "ar-SY",
  "Russian (Russia)": "ru-RU",
  "Portuguese (Portugal)": "pt-PT",
  "Portuguese (Brazil)": "pt-BR",
  "French (Belgium)": "fr-BE",
  "French (Canada)": "fr-CA",
  "French (Switzerland)": "fr-CH",
  "French (France)": "fr-FR",
  "German (Germany)": "de-DE",
  "German (Austria)": "de-AT",
  "German (Switzerland)": "de-CH",
  "Korean (South Korea)": "ko-KR",
  "Japanese (Japan)": "ja-JP",
  "Hindi (India)": "hi-IN",
  "Turkish (Turkey)": "tr-TR",
  "Urdu (Pakistan)": "ur-IN",
  // 前端显示为ur-Pk
  "Filipino (Philippines)": "fil-PH",
  "Finnish (Finland)": "fi-FI",
  "Czech (Czech Republic)": "cs-CZ",
  "Hungarian (Hungary)": "hu-HU",
  "Danish (Denmark)": "da-DK",
  "Dutch (Belgium)": "nl-BE",
  "Polish (Poland)": "pl-PL",
  "Romanian (Romania)": "ro-RO",
  "Slovak (Slovakia)": "sk-SK",
  "Swedish (Sweden)": "sv-SE",
  "Croatian (Croatia)": "hr-HR",
  "Indonesian (Indonesia)": "id-ID",
  "Italian (Italy)": "it-IT",
  "Italian (Switzerland)": "it-CH",
  "Bulgarian (Bulgaria)": "bg-BG",
  "Greek (Greece)": "el-GR",
  "Malay (Malaysia)": "ms-MY",
  "Tamil (India)": "ta-IN",
  "Ukrainian (Ukraine)": "uk-UA",
  "Albanian (Albania)": "sq-AL",
  "Azerbaijani (Azerbaijan)": "az-AZ",
  "Basque (Spain)": "eu-ES",
  "Bengali (India)": "bn-IN",
  "Bosnian (Bosnia and Herzegovina)": "bs-BA",
  "Cantonese (China)": "yue-CN",
  "Catalan (Spain)": "ca-ES",
  "Galician (Spain)": "gl-ES",
  "Gujarati (India)": "gu-IN",
  "Icelandic (Iceland)": "is-IS",
  "Kannada (India)": "kn-IN",
  "Kazakh (Kazakhstan)": "kk-KZ",
  "Latvian (Latvia)": "lv-LV",
  "Lithuanian (Lithuania)": "lt-LT",
  "Macedonian (North Macedonia)": "mk-MK",
  "Malayalam (India)": "ml-IN",
  "Maltese (Malta)": "mt-MT",
  "Marathi (India)": "mr-IN",
  "Mongolian (Mongolia)": "mn-MN",
  "Nepali (Nepal)": "ne-NP",
  "Norwegian (Norway)": "nb-NO",
  "Punjabi (India)": "pa-IN",
  "Slovenian (Slovenia)": "sl-SI",
  "Somali (Somalia)": "so-SO",
  "Serbian (Serbia)": "sr-RS",
  "Swahili (Kenya)": "sw-KE",
  "Swahili (Tanzania)": "sw-TZ",
  "Uzbek (Uzbekistan)": "uz-UZ",
  "Vietnamese (Vietnam)": "vi-VN",
  "Hebrew (Israel)": "he-IL",
  "Persian (Iran)": "fa-IR",
  "Thai (Thailand)": "th-TH"
};
var TranslateFrameOriginalLanguageMap = {
  Albanian: "sq-AL",
  Azerbaijani: "az-AZ",
  Basque: "eu-ES",
  Bosnian: "bs-BA",
  Catalan: "ca-ES",
  "Chinese (Simplified)": "zh-CN",
  "Chinese (Traditional)": "zh-TW",
  Croatian: "hr-HR",
  Czech: "cs-CZ",
  Danish: "da-DK",
  Dutch: "nl-NL",
  English: "en-US",
  Estonian: "et-EE",
  Finnish: "fi-FI",
  French: "fr-FR",
  Galician: "gl-ES",
  German: "de-DE",
  Hungarian: "hu-HU",
  Icelandic: "is-IS",
  Indonesian: "id-ID",
  Irish: "ga-IE",
  Italian: "it-IT",
  Japanese: "ja-JP",
  Hindi: "hi-IN",
  Korean: "ko-KR",
  Latvian: "lv-LV",
  Lithuanian: "lt-LT",
  Malay: "ms-MY",
  Maltese: "mt-MT",
  Norwegian: "nb-NO",
  Persian: "fa-IR",
  Polish: "pl-PL",
  Portuguese: "pt-PT",
  Romanian: "ro-RO",
  Russian: "ru-RU",
  Serbian: "sr-RS",
  Slovak: "sk-SK",
  Slovenian: "sl-SI",
  Spanish: "es-ES",
  Swahili: "sw-KE",
  Swedish: "sv-SE",
  Filipino: "fil-PH",
  Turkish: "tr-TR",
  Uzbek: "uz-UZ",
  Vietnamese: "vi-VN",
  Arabic: "ar-SA",
  Bulgarian: "bg-BG",
  Greek: "el-GR",
  Thai: "th-TH",
  Ukrainian: "uk-UA",
  Urdu: "ur-IN",
  Marathi: "mr-IN",
  Tamil: "ta-IN",
  Kazakh: "kk-KZ",
  Macedonian: "mk-MK",
  Mongolian: "mn-MN",
  Nepali: "ne-NP",
  Cantonese: "yue-CN"
};
var TranslateTargetLanguageMap = {
  English: "en-US",
  Chinese: "zh-CN",
  Spanish: "es-ES",
  Arabic: "ar-SA",
  Russian: "ru-RU",
  Portuguese: "pt-PT",
  French: "fr-FR",
  German: "de-DE",
  Korean: "ko-KR",
  Japanese: "ja-JP",
  Hindi: "hi-IN",
  Turkish: "tr-TR",
  Filipino: "fil-PH",
  Finnish: "fi-FI",
  Czech: "cs-CZ",
  Danish: "da-DK",
  Dutch: "nl-BE",
  Polish: "pl-PL",
  Romanian: "ro-RO",
  Slovak: "sk-SK",
  Swedish: "sv-SE",
  Croatian: "hr-HR",
  Indonesian: "id-ID",
  Italian: "it-IT",
  Bulgarian: "bg-BG",
  Greek: "el-GR",
  Malay: "ms-MY",
  Tamil: "ta-IN",
  Ukrainian: "uk-UA",
  Thai: "th-TH",
  Vietnamese: "vi-VN"
};
var TranslateLanguageCodeMap = {
  English: "en",
  Chinese: "zh",
  Spanish: "es",
  Arabic: "ar",
  Russian: "ru",
  Portuguese: "pt",
  French: "fr",
  German: "de",
  Korean: "ko",
  Japanese: "ja",
  Hindi: "hi",
  Turkish: "tr",
  Filipino: "fil",
  Finnish: "fi",
  Czech: "cs",
  Danish: "da",
  Dutch: "nl",
  Polish: "pl",
  Romanian: "ro",
  Slovak: "sk",
  Swedish: "sv",
  Croatian: "hr",
  Indonesian: "id",
  Italian: "it",
  Bulgarian: "bg",
  Greek: "el",
  Malay: "ms",
  Tamil: "ta",
  Ukrainian: "uk",
  Thai: "th",
  Vietnamese: "vi",
  Amharic: "am",
  Bengali: "bn",
  Bosnian: "bs",
  Catalan: "ca",
  Estonian: "et",
  Basque: "eu",
  Galician: "gl",
  Hebrew: "he",
  Hungarian: "hu",
  Javanese: "jv",
  Macedonian: "mk",
  "Norwegian Bokm\xE5l": "nb",
  Nepali: "ne",
  Pashto: "ps",
  Slovenian: "sl",
  Swahili: "sw",
  Telugu: "te",
  Zulu: "zu",
  Afrikaans: "af",
  Albanian: "sq",
  Armenian: "hy",
  Azerbaijani: "az",
  Burmese: "my",
  Georgian: "ka",
  Icelandic: "is",
  Irish: "ga",
  Kannada: "kn",
  Kazakh: "kk",
  Khmer: "km",
  Lao: "lo",
  Latvian: "lv",
  Lithuanian: "lt",
  Malayalam: "ml",
  Maltese: "mt",
  Mongolian: "mn",
  Persian: "fa",
  Serbian: "sr",
  Sinhala: "si",
  Somali: "so",
  Sundanese: "su",
  Urdu: "ur",
  Uzbek: "uz",
  Welsh: "cy",
  Assamese: "as",
  Gujarati: "gu",
  Inuktitut: "iu",
  Marathi: "mr",
  Odia: "or",
  Punjabi: "pa"
};
var TranslateCode2Lang = Object.fromEntries(
  Object.entries(TranslateLanguageCodeMap).map(([key, value]) => [value, key])
);
var TranslateLocaleCodeMap = {
  Bengali: {
    Bangla: "BD"
  },
  English: {
    "English (Australia)": "AU",
    "English (Canada)": "CA",
    "English (United Kingdom)": "GB",
    "English (Ireland)": "IE",
    "English (India)": "IN",
    "English (United States)": "US",
    "English (Hong Kong)": "HK",
    "English (Kenya)": "KE",
    "English (New Zealand)": "NZ",
    "English (Nigeria)": "NG",
    "English (Philippines)": "PH",
    "English (Singapore)": "SG",
    "English (South Africa)": "ZA",
    "English (Tanzania)": "TZ"
  },
  Spanish: {
    "Spanish (Spain)": "ES",
    "Spanish (Mexico)": "MX",
    "Spanish (Argentina)": "AR",
    "Spanish (Bolivia)": "BO",
    "Spanish (Chile)": "CL",
    "Spanish (Colombia)": "CO",
    "Spanish (Costa Rica)": "CR",
    "Spanish (Cuba)": "CU",
    "Spanish (Dominican Republic)": "DO",
    "Spanish (Ecuador)": "EC",
    "Spanish (El Salvador)": "SV",
    "Spanish (Equatorial Guinea)": "GQ",
    "Spanish (Guatemala)": "GT",
    "Spanish (Honduras)": "HN",
    "Spanish (Nicaragua)": "NI",
    "Spanish (Panama)": "PA",
    "Spanish (Paraguay)": "PY",
    "Spanish (Peru)": "PE",
    "Spanish (Puerto Rico)": "PR",
    "Spanish (United States)": "US",
    "Spanish (Uruguay)": "UY",
    "Spanish (Venezuela)": "VE"
  },
  Arabic: {
    "Arabic (Egypt)": "EG",
    "Arabic (Saudi Arabia)": "SA",
    "Arabic (Algeria)": "DZ",
    "Arabic (Bahrain)": "BH",
    "Arabic (Iraq)": "IQ",
    "Arabic (Jordan)": "JO",
    "Arabic (Kuwait)": "KW",
    "Arabic (Lebanon)": "LB",
    "Arabic (Libya)": "LY",
    "Arabic (Morocco)": "MA",
    "Arabic (Oman)": "OM",
    "Arabic (Qatar)": "QA",
    "Arabic (Syria)": "SY",
    "Arabic (Tunisia)": "TN",
    "Arabic (United Arab Emirates)": "AE",
    "Arabic (Yemen)": "YE"
  },
  Portuguese: {
    "Portuguese (Brazil)": "BR",
    "Portuguese (Portugal)": "PT"
  },
  French: {
    "French (Canada)": "CA",
    "French (Switzerland)": "CH",
    "French (France)": "FR",
    "French (Belgium)": "BE"
  },
  German: {
    "German (Austria)": "AT",
    "German (Switzerland - Standard)": "CH",
    "German (Switzerland - Swiss German)": "GSW",
    "German (Germany)": "DE"
  },
  Chinese: {
    "Chinese (Mainland China - Simplified)": "CN",
    "Chinese (Hong Kong - Traditional)": "HK",
    "Chinese (Taiwan - Traditional)": "TW",
    "Chinese (Jilu - Simplified)": "CN-shandong",
    "Chinese (Northeastern - Simplified)": "CN-liaoning",
    "Chinese (Southwestern - Simplified)": "CN-sichuan",
    "Chinese (Henan - Simplified)": "CN-henan",
    "Chinese (Shaanxi - Simplified)": "CN-shaanxi",
    "Chinese (Guangxi - Simplified)": "CN-GUANGXI",
    "Chinese (Wu - Simplified)": "wuu"
  },
  Dutch: {
    "Dutch (Netherlands)": "NL",
    "Dutch (Belgium)": "BE"
  },
  Swahili: {
    "Swahili (Kenya)": "KE",
    "Swahili (Tanzania)": "TZ"
  },
  Tamil: {
    "Tamil (India)": "IN",
    "Tamil (Malaysia)": "MY",
    "Tamil (Singapore)": "SG",
    "Tamil (Sri Lanka)": "LK"
  },
  Urdu: {
    "Urdu (India)": "IN",
    "Urdu (Pakistan)": "PK"
  },
  Inuktitut: {
    "Inuktitut (Syllabics)": "CANS-CA",
    "Inuktitut (Latin)": "LATN-CA"
  }
};
var TranslateAllLangWithLocale = Object.entries(TranslateLanguageCodeMap).reduce(
  (acc, [lang, code]) => {
    const locales = TranslateLocaleCodeMap[lang] || {};
    acc[lang] = `${code}-`;
    Object.entries(locales).forEach(([localeName, localeCode]) => {
      acc[localeName] = `${code}-${localeCode}`;
    });
    return acc;
  },
  {}
);
var TranslateAllLangWithLocaleKeyMap = Object.fromEntries(
  Object.entries(TranslateAllLangWithLocale).map(([key, value]) => [
    value,
    key
  ])
);
var RewriteLanguageMap = {
  "English (United States)": "en-US",
  "English (United Kingdom)": "en-GB",
  "English (Australia)": "en-AU",
  "English (Canada)": "en-CA",
  "English (Ghana)": "en-GH",
  "English (Hong Kong)": "en-HK",
  "English (Ireland)": "en-IE",
  "English (India)": "en-IN",
  "English (Kenya)": "en-KE",
  "English (Nigeria)": "en-NG",
  "English (New Zealand)": "en-NZ",
  "English (Philippines)": "en-PH",
  "English (Singapore)": "en-SG",
  "English (Tanzania)": "en-TZ",
  "English (South Africa)": "en-ZA",
  "Chinese (Mainland China)": "zh-CN",
  "Chinese (Hong Kong)": "zh-HK",
  "Chinese (Taiwan)": "zh-TW",
  "Spanish (Spain)": "es-ES",
  "Spanish (Mexico)": "es-MX",
  "Spanish (United States)": "es-US",
  "Spanish (Argentina)": "es-AR",
  "Spanish (Bolivia)": "es-BO",
  "Spanish (Chile)": "es-CL",
  "Spanish (Colombia)": "es-CO",
  "Spanish (Costa Rica)": "es-CR",
  "Spanish (Cuba)": "es-CU",
  "Spanish (Dominican Republic)": "es-DO",
  "Spanish (Ecuador)": "es-EC",
  "Spanish (Equatorial Guinea)": "es-GQ",
  "Spanish (Guatemala)": "es-GT",
  "Spanish (Honduras)": "es-HN",
  "Spanish (Nicaragua)": "es-NI",
  "Spanish (Panama)": "es-PA",
  "Spanish (Peru)": "es-PE",
  "Spanish (Puerto Rico)": "es-PR",
  "Spanish (Paraguay)": "es-PY",
  "Spanish (El Salvador)": "es-SV",
  "Spanish (Uruguay)": "es-UY",
  "Spanish (Venezuela)": "es-VE",
  "Arabic (Egypt)": "ar-EG",
  "Arabic (Saudi Arabia)": "ar-SA",
  "Arabic (United Arab Emirates)": "ar-AE",
  "Arabic (Morocco)": "ar-MA",
  "Arabic (Syria)": "ar-SY",
  "Russian (Russia)": "ru-RU",
  "Portuguese (Portugal)": "pt-PT",
  "Portuguese (Brazil)": "pt-BR",
  "French (Belgium)": "fr-BE",
  "French (Canada)": "fr-CA",
  "French (Switzerland)": "fr-CH",
  "French (France)": "fr-FR",
  "German (Germany)": "de-DE",
  "German (Austria)": "de-AT",
  "German (Switzerland)": "de-CH",
  "Korean (South Korea)": "ko-KR",
  "Japanese (Japan)": "ja-JP",
  "Hindi (India)": "hi-IN",
  "Turkish (Turkey)": "tr-TR",
  "Filipino (Philippines)": "fil-PH",
  "Finnish (Finland)": "fi-FI",
  "Czech (Czech Republic)": "cs-CZ",
  "Danish (Denmark)": "da-DK",
  "Dutch (Belgium)": "nl-BE",
  "Polish (Poland)": "pl-PL",
  "Romanian (Romania)": "ro-RO",
  "Slovak (Slovakia)": "sk-SK",
  "Swedish (Sweden)": "sv-SE",
  "Croatian (Croatia)": "hr-HR",
  "Indonesian (Indonesia)": "id-ID",
  "Italian (Italy)": "it-IT",
  "Italian (Switzerland)": "it-CH",
  "Bulgarian (Bulgaria)": "bg-BG",
  "Greek (Greece)": "el-GR",
  "Malay (Malaysia)": "ms-MY",
  "Tamil (India)": "ta-IN",
  "Ukrainian (Ukraine)": "uk-UA"
};
var CommonLanguageMap = {
  English: "en-US",
  Chinese: "zh-CN",
  Spanish: "es-ES",
  Arabic: "ar-SA",
  Russian: "ru-RU",
  Portuguese: "pt-PT",
  French: "fr-FR",
  German: "de-DE",
  Korean: "ko-KR",
  Japanese: "ja-JP",
  Hindi: "hi-IN",
  Turkish: "tr-TR",
  Filipino: "fil-PH",
  Finnish: "fi-FI",
  Czech: "cs-CZ",
  Danish: "da-DK",
  Dutch: "nl-BE",
  Polish: "pl-PL",
  Romanian: "ro-RO",
  Slovak: "sk-SK",
  Swedish: "sv-SE",
  Croatian: "hr-HR",
  Indonesian: "id-ID",
  Italian: "it-IT",
  Bulgarian: "bg-BG",
  Greek: "el-GR",
  Malay: "ms-MY",
  Tamil: "ta-IN",
  Ukrainian: "uk-UA"
};
var TranslateOriginalLanguageKeyMap = Object.fromEntries(
  Object.entries(TranslateOriginalLanguageMap).map(([key, value]) => [
    value.toLowerCase(),
    key
  ])
);
var TranslateTargetLanguageKeyMap = Object.fromEntries(
  Object.entries(TranslateTargetLanguageMap).map(([key, value]) => [
    value.toLowerCase(),
    key
  ])
);
var RewriteLanguageKeyMap = Object.fromEntries(
  Object.entries(RewriteLanguageMap).map(([key, value]) => [
    value.toLowerCase(),
    key
  ])
);
var CommonLanguageKeyMap = Object.fromEntries(
  Object.entries(CommonLanguageMap).map(([key, value]) => [
    value.toLowerCase(),
    key
  ])
);
var CommonLanguageCodeMap = Object.fromEntries(
  Object.entries(CommonLanguageMap).map(([key, value]) => [
    getLangPrefix(value.toLowerCase()),
    key
  ])
);
var TranslateOriginalLanguageString = Array.from(
  new Set(
    Object.keys(TranslateOriginalLanguageMap).map(
      (lang) => lang.match(/^([a-zA-Z]+)(?:-[a-zA-Z]+)?/)?.[1] || null
    )
  )
).join(", ");
var TranslateTargetLanguageString = Object.keys(
  TranslateTargetLanguageMap
).map((lang) => lang).join(", ");
var CommonLanguageString = Object.keys(CommonLanguageMap).map((lang) => lang).join(", ");
var TranslateOriginalLanguageOptions = Object.entries(
  TranslateOriginalLanguageMap
).map(([key, value]) => ({ value, label: key }));
var TranslateOriginalLangCode = (() => {
  const map = {};
  Object.entries(TranslateOriginalLanguageMap).forEach(([key, value]) => {
    const prop = getLangPrefix(value);
    map[prop] = getLangCountry(key);
  });
  return Object.entries(map).map(([key, value]) => ({
    value: key,
    label: value
  }));
})();
var TranslateTargetLanguageOptions = Object.entries(
  TranslateLanguageCodeMap
).map(([label, value]) => ({ value, label })).sort((a, b) => {
  return a.label.localeCompare(b.label);
});
var RewriteLanguageOptions = Object.entries(RewriteLanguageMap).map(
  ([key, value]) => ({ value, label: key })
);
var CommonLanguageOptions = Object.entries(CommonLanguageMap).map(
  ([key, value]) => ({ value, label: key })
);
function getLangPrefix(language) {
  return language?.split("-")[0] ?? "";
}
function getLangCountry(language) {
  return language.replace(/\s*\(.*\)/, "");
}

// src/core/language-labels.ts
var FRAME_ORIGINAL_CODE_TO_NAME = Object.fromEntries(
  Object.entries(TranslateFrameOriginalLanguageMap).map(([name, code]) => [
    code.toLowerCase(),
    name
  ])
);
var LOCALE_CODE_TO_LABEL = buildLocaleCodeToLabelMap();
function buildLocaleCodeToLabelMap() {
  const map = /* @__PURE__ */ new Map();
  for (const [languageName, locales] of Object.entries(
    TranslateLocaleCodeMap
  )) {
    for (const [label, localeCode] of Object.entries(locales)) {
      map.set(`${languageName}:${localeCode}`.toLowerCase(), label);
      map.set(localeCode.toLowerCase(), label);
    }
  }
  return map;
}
function normalizeCode(code) {
  return code.trim().toLowerCase();
}
function lookupShortLanguageCode(code) {
  return TranslateCode2Lang[code] ?? TranslateCode2Lang[code.split("-")[0] ?? ""] ?? null;
}
function resolveOriginalLanguageLabel(code) {
  if (!code) {
    return null;
  }
  const normalized = normalizeCode(code);
  if (normalized === "auto") {
    return "Auto-detect";
  }
  return TranslateOriginalLanguageKeyMap[normalized] ?? FRAME_ORIGINAL_CODE_TO_NAME[normalized] ?? TranslateTargetLanguageKeyMap[normalized] ?? lookupShortLanguageCode(normalized) ?? code;
}
function resolveTargetLanguageLabel(code) {
  if (!code) {
    return null;
  }
  const normalized = normalizeCode(code);
  return TranslateTargetLanguageKeyMap[normalized] ?? TranslateOriginalLanguageKeyMap[normalized] ?? lookupShortLanguageCode(normalized) ?? code;
}
function resolveTargetLocaleLabel(targetLanguage, targetLocale) {
  if (!targetLocale) {
    return null;
  }
  const normalizedLocale = normalizeCode(targetLocale);
  const languageName = resolveTargetLanguageLabel(targetLanguage);
  if (languageName) {
    const localeLabel = LOCALE_CODE_TO_LABEL.get(
      `${languageName}:${targetLocale}`.toLowerCase()
    );
    if (localeLabel) {
      return localeLabel;
    }
  }
  const fullTag = targetLocale.includes("-") ? normalizedLocale : targetLanguage ? `${normalizeCode(targetLanguage)}-${normalizedLocale}` : normalizedLocale;
  const fullTagLabel = TranslateOriginalLanguageKeyMap[fullTag] ?? TranslateTargetLanguageKeyMap[fullTag];
  if (fullTagLabel) {
    return fullTagLabel;
  }
  const localeOnlyLabel = LOCALE_CODE_TO_LABEL.get(normalizedLocale);
  if (localeOnlyLabel) {
    return localeOnlyLabel;
  }
  return targetLocale;
}
function resolveLanguageCapabilityLabel(field, value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }
  if (field === "original-language") {
    return resolveOriginalLanguageLabel(trimmed) ?? trimmed;
  }
  const direct = resolveTargetLanguageLabel(trimmed);
  if (direct && normalizeCode(direct) !== normalizeCode(trimmed)) {
    return direct;
  }
  const separator = trimmed.indexOf("-");
  if (separator > 0) {
    const language = trimmed.slice(0, separator);
    const locale = trimmed.slice(separator + 1);
    const localeLabel = resolveTargetLocaleLabel(language, locale);
    if (localeLabel && normalizeCode(localeLabel) !== normalizeCode(trimmed)) {
      return localeLabel;
    }
  }
  return direct ?? trimmed;
}
function enrichProjectLanguageLabels(project) {
  return {
    ...project,
    originalLanguageLabel: resolveOriginalLanguageLabel(
      project.originalLanguage
    ),
    targetLanguageLabel: resolveTargetLanguageLabel(project.targetLanguage),
    targetLocaleLabel: resolveTargetLocaleLabel(
      project.targetLanguage,
      project.targetLocale
    )
  };
}

// src/core/language-capabilities.ts
import { InvalidArgumentError as InvalidArgumentError2 } from "commander";
function uniqueSorted(values) {
  return Array.from(new Set(values)).sort(
    (left, right) => left.localeCompare(right)
  );
}
function createLookup(values) {
  const normalizedPairs = uniqueSorted(values).map(
    (value) => [value.toLowerCase(), value]
  );
  return {
    canonicalByNormalized: new Map(normalizedPairs),
    values: normalizedPairs.map(([, value]) => value)
  };
}
function buildOriginalLanguageValues(originalLanguageMap) {
  const tags = Object.values(originalLanguageMap);
  const baseCodes = tags.map((tag) => tag.split("-")[0]).filter(Boolean);
  return [...baseCodes, ...tags];
}
function buildLocaleTags(languageCodeMap, localeCodeMap) {
  const values = [];
  for (const [languageName, locales] of Object.entries(localeCodeMap)) {
    const languageCode = languageCodeMap[languageName];
    if (!languageCode) {
      continue;
    }
    for (const localeCode of Object.values(locales)) {
      values.push(`${languageCode}-${localeCode}`);
    }
  }
  return values;
}
function buildFieldCapabilities(lookup, options) {
  const supportedValues = lookup?.values ?? [];
  return {
    allowAuto: Boolean(options.allowAuto),
    required: options.required,
    supportedOptions: supportedValues.map((value) => ({
      label: resolveLanguageCapabilityLabel(options.field, value),
      value
    })),
    supportedValues
  };
}
var TRANSLATE_TARGET_LANGUAGE_VALUES = [
  ...Object.values(TranslateLanguageCodeMap),
  ...buildLocaleTags(TranslateLanguageCodeMap, TranslateLocaleCodeMap)
];
var CAPABILITY_DEFINITIONS = {
  lipsync: {
    allowAutoOriginalLanguage: false,
    kind: "lipsync",
    originalLanguage: null,
    targetLanguage: null,
    targetLocale: null
  },
  translate_dub: {
    allowAutoOriginalLanguage: true,
    kind: "translate_dub",
    originalLanguage: createLookup(
      buildOriginalLanguageValues(TranslateOriginalLanguageMap)
    ),
    targetLanguage: createLookup(TRANSLATE_TARGET_LANGUAGE_VALUES),
    targetLocale: createLookup(
      buildLocaleTags(TranslateLanguageCodeMap, TranslateLocaleCodeMap)
    )
  },
  translate_subtitles: {
    allowAutoOriginalLanguage: true,
    kind: "translate_subtitles",
    originalLanguage: createLookup(
      buildOriginalLanguageValues(TranslateOriginalLanguageMap)
    ),
    targetLanguage: createLookup(TRANSLATE_TARGET_LANGUAGE_VALUES),
    targetLocale: createLookup(
      buildLocaleTags(TranslateLanguageCodeMap, TranslateLocaleCodeMap)
    )
  },
  visual_translate: {
    allowAutoOriginalLanguage: false,
    kind: "visual_translate",
    originalLanguage: createLookup(
      buildOriginalLanguageValues(TranslateFrameOriginalLanguageMap)
    ),
    targetLanguage: createLookup(TRANSLATE_TARGET_LANGUAGE_VALUES),
    targetLocale: createLookup(
      buildLocaleTags(TranslateLanguageCodeMap, TranslateLocaleCodeMap)
    )
  }
};
function fieldFlag(field) {
  switch (field) {
    case "original-language":
      return "--original-language";
    case "target-language":
      return "--target-language";
    default:
      return "--language";
  }
}
function fieldLabel(field) {
  switch (field) {
    case "original-language":
      return "original language";
    case "target-language":
      return "target language";
    default:
      return "language";
  }
}
function getProjectLanguageCapabilities(kind) {
  const definition = CAPABILITY_DEFINITIONS[kind];
  return {
    kind,
    originalLanguage: buildFieldCapabilities(definition.originalLanguage, {
      allowAuto: definition.allowAutoOriginalLanguage,
      field: "original-language",
      required: kind === "visual_translate"
    }),
    targetLanguage: buildFieldCapabilities(definition.targetLanguage, {
      field: "target-language",
      required: kind === "translate_dub" || kind === "translate_subtitles" || kind === "visual_translate"
    })
  };
}
function assertSupportedProjectLanguage(options) {
  const rawValue = options.value?.trim();
  const capabilities = getProjectLanguageCapabilities(options.kind);
  const fieldCaps = options.field === "original-language" ? capabilities.originalLanguage : capabilities.targetLanguage;
  if (!rawValue) {
    if (fieldCaps.required) {
      throw new InvalidArgumentError2(
        `\`${fieldFlag(options.field)}\` is required for \`${options.kind}\`. Run \`vozo-cli project languages ${options.kind}\` to see supported values.`
      );
    }
    return void 0;
  }
  if (options.field === "original-language" && rawValue.toLowerCase() === "auto" && CAPABILITY_DEFINITIONS[options.kind].allowAutoOriginalLanguage) {
    return "auto";
  }
  const definition = CAPABILITY_DEFINITIONS[options.kind];
  const lookup = options.field === "original-language" ? definition.originalLanguage : definition.targetLanguage;
  if (!lookup) {
    throw new InvalidArgumentError2(
      `\`${fieldFlag(options.field)}\` is not supported for \`${options.kind}\`.`
    );
  }
  const canonical = lookup.canonicalByNormalized.get(rawValue.toLowerCase());
  if (canonical) {
    return canonical;
  }
  throw new InvalidArgumentError2(
    `\`${rawValue}\` is not a supported ${fieldLabel(options.field)} for \`${options.kind}\`. Run \`vozo-cli project languages ${options.kind}\` to see supported values.`
  );
}
function requireProjectLanguage(options) {
  const resolved = assertSupportedProjectLanguage(options);
  if (!resolved) {
    throw new InvalidArgumentError2(
      `\`${fieldFlag(options.field)}\` is required for \`${options.kind}\`. Run \`vozo-cli project languages ${options.kind}\` to see supported values.`
    );
  }
  return resolved;
}
function splitLanguageLocaleTag(tag) {
  const [language, ...localeParts] = tag.split("-");
  const locale = localeParts.join("-");
  return {
    language,
    locale: locale || void 0
  };
}
function resolveCreateTargetLanguageAndLocale(options) {
  const resolvedTarget = requireProjectLanguage({
    field: "target-language",
    kind: options.kind,
    value: options.targetLanguage
  });
  const definition = CAPABILITY_DEFINITIONS[options.kind];
  const combinedLanguageTag = definition.targetLocale?.canonicalByNormalized.get(
    resolvedTarget.toLowerCase()
  );
  if (!combinedLanguageTag) {
    return { targetLanguage: resolvedTarget, targetLocale: void 0 };
  }
  const split = splitLanguageLocaleTag(combinedLanguageTag);
  return {
    targetLanguage: split.language,
    targetLocale: split.locale
  };
}

// src/core/project-error-codes.ts
var PROJECT_ERROR_MESSAGES = {
  "996": "An issue occurred while validating the points used for this project. Please submit a new project. Your points have been refunded to your account.",
  "997": "We\u2019ve detected that your content may belong to episodic series. Due to high demand and resource usage, this type of content is currently not supported under the free trial. Contact support if you need a tailored trial.",
  "1003": "This content type is not supported.",
  "1004": "Unable to extract viral shorts from this content.",
  "1999": "This language isn\u2019t available on your current plan. Please upgrade to continue.",
  "10002": "No speech detected, or the wrong original language was selected. Unable to translate.",
  "10032": "Subtitle extraction failed. If you try again, audio will be transcribed instead of extracting subtitles from the video. Your points have been refunded.",
  "10033": "Subtitle extraction failed. If you try again, audio will be transcribed instead of extracting subtitles from the video. Your points have been refunded.",
  "10034": "The subtitle file you uploaded doesn\u2019t match the audio. If you try again, the audio will be transcribed automatically instead of using the subtitle file. Your points have been refunded.",
  "10035": "The video language does not support subtitle removal. Re-upload without enabling \u201CRemove Original Subtitles.\u201D",
  "10041": "No speech detected, or the wrong original language was selected. Unable to translate.",
  "10042": "No speech detected, or the wrong original language was selected. Unable to translate.",
  "10046": "Voice cloning failed for one or more speakers. Check the speakers in the web editor or contact support.",
  "10051": "Your content includes sensitive or political figures, and voice cloning is not allowed. Please select another file to translate. Your points have been refunded.",
  "10080": "The video language is not supported. Please upload another language.",
  "10082": "The selected target language is the same as the detected original language. Please select a different target language. Your points have been refunded.",
  "10211": "The voice language is not supported. Please upload another language.",
  "20403": "The video cannot be lip synced because no faces were detected.",
  "20406": "The video cannot be lip synced because there is no audio stream.",
  "20601": "The video cannot be lip synced because no faces were detected.",
  "20621": "The selected Text-to-Speech language doesn\u2019t match the input language, so the audio couldn\u2019t be generated. Your points have been refunded.",
  "30001": "The selected language is not supported for this project.",
  "30002": "No speech detected, or the wrong original language was selected. Unable to translate.",
  "30003": "The selected language is not supported for this project.",
  "40002": "No translatable on-screen text was detected in this video (e.g. titles, labels, or explanatory text).",
  "40011": "This video uses an unsupported or abnormal encoding format and can\u2019t be processed. Convert it to a common video encoding format and try again.",
  "40032": "No translatable on-screen text was detected in this video (e.g. titles, labels, or explanatory text).",
  "40041": "No translatable on-screen text was detected in this video (e.g. titles, labels, or explanatory text)."
};
var NON_ERROR_CODES = /* @__PURE__ */ new Set(["10000"]);
function resolveProjectErrorInfo(errorCode) {
  if (errorCode == null || String(errorCode).trim() === "") {
    return {
      errorCode: null,
      errorMessage: null
    };
  }
  const normalized = String(errorCode).trim();
  if (NON_ERROR_CODES.has(normalized)) {
    return {
      errorCode: null,
      errorMessage: null
    };
  }
  const mapped = PROJECT_ERROR_MESSAGES[normalized];
  return {
    errorCode: normalized,
    errorMessage: mapped ?? `Project processing failed with error code ${normalized}.`
  };
}

// src/core/create-guard.ts
var KIND_LABEL = {
  lipsync: "lipsync",
  translate_subtitles: "translate subtitles",
  visual_translate: "visual translate",
  translate_dub: "translate dub"
};
var CAPTION_DURATION_QUOTA_FALLBACK = 599940;
function formatGb(bytes) {
  return `${round2(bytes / (1024 * 1024 * 1024))} GB`;
}
function formatMinutes(seconds) {
  return `${round2(seconds / 60)} min`;
}
function resolveEffectiveDurationMaxSeconds(options) {
  const [hardMin, hardMax] = DURATION_HARD_LIMIT_SECONDS[options.kind];
  const appliesTier = options.kind === "translate_dub" || options.kind === "translate_subtitles";
  if (!appliesTier || options.skipTierDuration) {
    return { effectiveMaxSeconds: hardMax, hardMinSeconds: hardMin };
  }
  return {
    effectiveMaxSeconds: Math.min(
      hardMax,
      tierMaxUploadSeconds(options.membershipUserType)
    ),
    hardMinSeconds: hardMin
  };
}
function buildDurationSkipReason(options) {
  return `media duration ${formatMinutes(
    options.durationSeconds
  )} exceeds the ${formatMinutes(options.effectiveMaxSeconds)} limit for ${KIND_LABEL[options.kind]}`;
}
function buildFileSizeSkipReason(options) {
  return `file size ${formatGb(options.sizeBytes)} exceeds the ${formatGb(
    options.sizeCap
  )} limit for ${KIND_LABEL[options.kind]}`;
}
async function filterBatchFilePathsForCreate(options) {
  if (!options.filePaths.length) {
    return { filePaths: [], skippedFiles: [] };
  }
  let membership;
  let features;
  try {
    [membership, features] = await Promise.all([
      getUserMembership(options.apiBaseUrl),
      getUserFeatureConfig(options.apiBaseUrl)
    ]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to verify account entitlements before creating the project: ${detail}`
    );
  }
  const skipTierDuration = options.kind === "translate_dub" && features.existSuccessfulTranslation === false;
  const { effectiveMaxSeconds } = resolveEffectiveDurationMaxSeconds({
    kind: options.kind,
    membershipUserType: membership.userType,
    skipTierDuration
  });
  const sizeCap = FILE_SIZE_LIMIT_BYTES[options.kind];
  const allowedFilePaths = [];
  const skippedFiles = [];
  for (const filePath of options.filePaths) {
    let sizeBytes = null;
    try {
      sizeBytes = await getLocalFileSize(filePath);
    } catch {
      skippedFiles.push({
        filePath,
        reason: `unable to read file size for ${filePath}`
      });
      continue;
    }
    if (sizeBytes > sizeCap) {
      skippedFiles.push({
        filePath,
        reason: buildFileSizeSkipReason({
          kind: options.kind,
          sizeBytes,
          sizeCap
        }),
        sizeBytes
      });
      continue;
    }
    const mediaType = inferLocalMediaType(filePath);
    let durationSeconds = null;
    if (mediaType === "video" || mediaType === "audio") {
      try {
        const metadata = await getLocalMediaMetadata(filePath);
        durationSeconds = metadata.durationSeconds;
      } catch {
        skippedFiles.push({
          filePath,
          reason: `unable to read media duration for ${filePath}`,
          sizeBytes
        });
        continue;
      }
    }
    if (durationSeconds != null && Number.isFinite(durationSeconds) && durationSeconds > 0 && durationSeconds > effectiveMaxSeconds) {
      skippedFiles.push({
        durationSeconds,
        filePath,
        reason: buildDurationSkipReason({
          durationSeconds,
          effectiveMaxSeconds,
          kind: options.kind
        })
      });
      continue;
    }
    allowedFilePaths.push(filePath);
  }
  if (!allowedFilePaths.length && skippedFiles.length > 0) {
    throw new Error(
      `All ${options.filePaths.length} file(s) were skipped because they exceed upload limits for ${KIND_LABEL[options.kind]}. No projects were created.`
    );
  }
  return { filePaths: allowedFilePaths, skippedFiles };
}
function assertCaptionDurationQuotaAllowed(options) {
  const remaining = options.translateCaptionDuration;
  if (!options.isMember || remaining == null || !Number.isFinite(remaining)) {
    return;
  }
  if (options.totalDurationSeconds <= remaining) {
    return;
  }
  const durationLimit = Math.floor(
    (options.captionDurationQuota ?? CAPTION_DURATION_QUOTA_FALLBACK) / 60
  );
  throw new Error(
    buildEntitlementError(
      `Subtitle translation duration limit reached: this creation needs ${formatMinutes(
        options.totalDurationSeconds
      )} but only ${formatMinutes(
        remaining
      )} of your ${durationLimit} min subtitle-translation quota remains.`,
      "plan"
    )
  );
}
async function resolveItem(item) {
  if (!item.filePath) {
    const width2 = item.width ?? null;
    const height2 = item.height ?? null;
    return {
      durationSeconds: item.durationSeconds ?? null,
      filePath: item.filePath,
      height: height2,
      mediaType: width2 != null && height2 != null ? "video" : null,
      sizeBytes: null,
      width: width2
    };
  }
  const mediaType = inferLocalMediaType(item.filePath);
  let durationSeconds = item.durationSeconds ?? null;
  let width = null;
  let height = null;
  if (mediaType === "video" || mediaType === "audio") {
    const metadata = await getLocalMediaMetadata(item.filePath);
    durationSeconds = durationSeconds ?? metadata.durationSeconds;
    width = metadata.width ?? null;
    height = metadata.height ?? null;
  }
  const sizeBytes = await getLocalFileSize(item.filePath);
  return {
    durationSeconds,
    filePath: item.filePath,
    height,
    mediaType,
    sizeBytes,
    width
  };
}
function evaluatePointsAllowanceForCreate(options) {
  if (options.consumedPoints <= options.totalPoints) {
    return "ok";
  }
  const isBatch = options.itemCount > 1;
  if (isBatch) {
    return "insufficient";
  }
  if (options.translateDubFirstUser && options.totalPoints > 0 && options.kind === "translate_dub") {
    return "partial_clip";
  }
  if (options.visualTranslateFirstUser && options.totalPoints > 0 && options.kind === "visual_translate") {
    return "partial_clip";
  }
  return "insufficient";
}
function buildInsufficientPointsError(options) {
  if (options.isBatch) {
    return buildEntitlementError(
      `Insufficient points for batch creation: ${options.itemCount} project(s) need about ${options.consumedPoints} point(s) in total but only ${round2(
        options.totalPoints
      )} are available. No files were uploaded.`,
      "points"
    );
  }
  return buildEntitlementError(
    `Insufficient points: this creation needs about ${options.consumedPoints} point(s) but only ${round2(options.totalPoints)} are available.`,
    "points"
  );
}
async function assertCreateAllowed(options) {
  let membership;
  let points;
  let features;
  let profile;
  try {
    [membership, points, features, profile] = await Promise.all([
      getUserMembership(options.apiBaseUrl),
      getUserPoints(options.apiBaseUrl),
      getUserFeatureConfig(options.apiBaseUrl),
      getUserProfile(options.apiBaseUrl)
    ]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to verify account entitlements before creating the project: ${detail}`
    );
  }
  assertUserPermission({
    action: "create projects",
    permissionKeys: [USER_PERMISSIONS.createProject],
    profile
  });
  if (membership.isExpired) {
    throw new Error(
      buildEntitlementError(
        "Your membership has expired. Renew your plan before creating new projects.",
        "renew"
      )
    );
  }
  const flags = deriveMembershipFlags(membership.userType);
  assertMembershipForCreateOptions(membership.userType, {
    batchItemCount: options.items.length,
    glossaryIdList: options.glossaryIdList,
    hasCustomFont: options.hasCustomFont,
    hasSubtitleFile: options.hasSubtitleFile,
    proofreadBeforeDubbing: options.proofreadBeforeDubbing,
    userPrompt: options.userPrompt
  });
  if (!flags.isMember) {
    const freeProjectCount = features.freeProjectCount ?? 0;
    if (options.items.length > freeProjectCount) {
      throw new Error(
        buildEntitlementError(
          `Free trial limit reached: your account can create ${freeProjectCount} more free project(s), but ${options.items.length} were requested.`,
          "plan"
        )
      );
    }
  }
  const resolved = await Promise.all(options.items.map(resolveItem));
  const [hardMin, hardMax] = DURATION_HARD_LIMIT_SECONDS[options.kind];
  const appliesTier = options.kind === "translate_dub" || options.kind === "translate_subtitles";
  const skipTierDuration = options.kind === "translate_dub" && features.existSuccessfulTranslation === false;
  const tierMax = tierMaxUploadSeconds(membership.userType);
  for (const item of resolved) {
    if (item.durationSeconds == null) {
      continue;
    }
    if (!Number.isFinite(item.durationSeconds) || item.durationSeconds <= 0) {
      throw new Error(
        `Unable to determine a valid media duration for ${item.filePath ?? "the source URL"}, so pre-creation checks cannot run. Verify the source and try again.`
      );
    }
    if (item.durationSeconds < hardMin) {
      throw new Error(
        `${KIND_LABEL[options.kind]} requires a media duration of at least ${hardMin}s.`
      );
    }
    if (item.durationSeconds > hardMax) {
      throw new Error(
        `Media duration ${formatMinutes(
          item.durationSeconds
        )} exceeds the ${formatMinutes(hardMax)} limit for ${KIND_LABEL[options.kind]}.`
      );
    }
    if (appliesTier && !skipTierDuration && item.durationSeconds > tierMax) {
      throw new Error(
        buildEntitlementError(
          `Media duration ${formatMinutes(
            item.durationSeconds
          )} exceeds your plan's ${formatMinutes(tierMax)} upload limit.`,
          "plan"
        )
      );
    }
  }
  if (options.kind === "translate_subtitles") {
    assertCaptionDurationQuotaAllowed({
      captionDurationQuota: features.captionDurationQuota,
      isMember: flags.isMember,
      totalDurationSeconds: resolved.reduce(
        (sum, item) => sum + (item.durationSeconds ?? 0),
        0
      ),
      translateCaptionDuration: features.translateCaptionDuration
    });
  }
  const sizeCap = FILE_SIZE_LIMIT_BYTES[options.kind];
  for (const item of resolved) {
    if (item.sizeBytes != null && item.sizeBytes > sizeCap) {
      throw new Error(
        `File ${item.filePath} is ${formatGb(
          item.sizeBytes
        )}, which exceeds the ${formatGb(sizeCap)} limit for ${KIND_LABEL[options.kind]}.`
      );
    }
  }
  for (const item of resolved) {
    const shouldCheckVideoResolution = item.mediaType === "video" || options.kind === "lipsync" && item.width != null && item.height != null;
    if (!shouldCheckVideoResolution) {
      continue;
    }
    if (item.width == null || item.height == null) {
      throw new Error(
        `Unable to detect video resolution for ${item.filePath ?? "the source video"}.`
      );
    }
    assertCreateVideoResolutionAllowed({
      durationSeconds: item.durationSeconds,
      filePath: item.filePath,
      height: item.height,
      kind: options.kind,
      width: item.width
    });
  }
  const totalPoints = calcTotalPoints(points);
  if (options.kind === "lipsync" && totalPoints <= 0) {
    throw new Error(
      buildEntitlementError(
        "Insufficient points to create a lipsync project.",
        "points"
      )
    );
  }
  const frameFirstUser = options.kind === "visual_translate" && (features.translateFrameCount ?? 0) === 0;
  if (frameFirstUser && totalPoints <= 0) {
    throw new Error(
      buildEntitlementError(
        "Insufficient points to create a visual translate project.",
        "points"
      )
    );
  }
  const consumedPoints = round2(
    resolved.reduce((sum, item) => {
      if (item.durationSeconds == null) {
        return sum;
      }
      return sum + estimateConsumedPoints({
        durationSeconds: item.durationSeconds,
        enableSubtitles: options.enableSubtitles,
        kind: options.kind,
        removeOriginalSubtitle: options.removeOriginalSubtitle
      });
    }, 0)
  );
  const translateDubFirstUser = options.kind === "translate_dub" && features.existSuccessfulTranslation === false;
  const pointsAllowance = evaluatePointsAllowanceForCreate({
    consumedPoints,
    itemCount: options.items.length,
    kind: options.kind,
    totalPoints,
    translateDubFirstUser,
    visualTranslateFirstUser: frameFirstUser
  });
  if (pointsAllowance === "insufficient") {
    throw new Error(
      buildInsufficientPointsError({
        consumedPoints,
        isBatch: options.items.length > 1,
        itemCount: options.items.length,
        totalPoints
      })
    );
  }
  return { features, membership, points, profile };
}

// src/core/project-title.ts
var MAX_PROJECT_TITLE_LENGTH = 100;
function truncateProjectTitle(title) {
  return title.slice(0, MAX_PROJECT_TITLE_LENGTH);
}
function resolveProjectTitle(title) {
  return truncateProjectTitle(title);
}

// src/core/subtitle-file.ts
import { readFile as readFile3 } from "node:fs/promises";
var SUBTITLE_FILE_SIZE_LIMIT_BYTES = 10 * 1024 * 1024;
function parseTimeToMs(timeStr) {
  const normalized = timeStr.replace(",", ".");
  const [h, m, s] = normalized.split(":");
  const [sec, ms] = s.split(".");
  return parseInt(h, 10) * 36e5 + parseInt(m, 10) * 6e4 + parseInt(sec, 10) * 1e3 + parseInt(ms, 10);
}
function validateSubtitleFileContent(content, maxEndTimeInSeconds) {
  const regex = /(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]\d{3})/g;
  const matches = [...content.matchAll(regex)];
  if (matches.length === 0) {
    return { valid: false, error: "no timestamp" };
  }
  const timestamps = matches.map((match) => ({
    end: parseTimeToMs(match[2]),
    start: parseTimeToMs(match[1])
  }));
  timestamps.sort((left, right) => left.start - right.start);
  for (let index = 0; index < timestamps.length; index += 1) {
    const { end, start } = timestamps[index];
    if (end < start) {
      return { valid: false, error: "timestamp invalid" };
    }
    if (index > 0 && start < timestamps[index - 1].end) {
      return { valid: false, error: "timestamp overlap" };
    }
  }
  const maxEndInMs = maxEndTimeInSeconds * 1e3;
  if (timestamps.length > 0 && timestamps[timestamps.length - 1].end > maxEndInMs) {
    return { valid: false, error: "timestamp overflow" };
  }
  return { valid: true };
}
function formatMb(bytes) {
  return `${round2(bytes / (1024 * 1024))} MB`;
}
async function assertSubtitleFileForTranslation(options) {
  const { subtitleFilePath, videoDurationSeconds } = options;
  await ensureLocalFileReadable(subtitleFilePath);
  if (inferLocalMediaType(subtitleFilePath) !== "subtitle") {
    throw new Error("Subtitle file must be a .srt, .vtt, or .txt file.");
  }
  const sizeBytes = await getLocalFileSize(subtitleFilePath);
  if (sizeBytes > SUBTITLE_FILE_SIZE_LIMIT_BYTES) {
    throw new Error(
      `Subtitle file is ${formatMb(sizeBytes)}, which exceeds the 10 MB limit.`
    );
  }
  let content;
  try {
    content = await readFile3(subtitleFilePath, "utf8");
  } catch {
    throw new Error(`Unable to read subtitle file ${subtitleFilePath}.`);
  }
  const maxEndTimeInSeconds = videoDurationSeconds + 1;
  const result = validateSubtitleFileContent(content, maxEndTimeInSeconds);
  if (result.valid) {
    return;
  }
  if (result.error === "timestamp overflow") {
    throw new Error(
      `Subtitle timestamps exceed the video duration (${round2(
        videoDurationSeconds
      )}s).`
    );
  }
  throw new Error(
    "Subtitle file could not be parsed. Ensure it is a valid .srt, .vtt, or .txt file with proper timestamps."
  );
}

// src/core/project-status.ts
var TRANSLATE_DUB_PROCESSING_STATUSES = [
  "aligning_video",
  "created",
  "detecting",
  "dubbing",
  "processing",
  "proofreading",
  "redubbing",
  "regenerating",
  "retranslating"
];
var AWAITING_USER_ACTION_STATUS = "proofreading";
var TRANSLATE_SUBTITLES_PROCESSING_STATUSES = [
  "in_queue",
  "preprocessing",
  "processing"
];
var LIPSYNC_PROCESSING_STATUSES = [
  "face_detecting",
  "in_queue",
  "preprocessing",
  "processing",
  "resync_in_queue",
  "resyncing"
];
var EXPORT_BLOCKED_PROCESSING_STATUS_LIST = [
  ...TRANSLATE_DUB_PROCESSING_STATUSES,
  ...TRANSLATE_SUBTITLES_PROCESSING_STATUSES,
  ...LIPSYNC_PROCESSING_STATUSES,
  "exporting"
];
function normalizeStatusList(statuses) {
  return new Set(statuses.map((status) => status.toLowerCase()));
}
var BLOCK_PROCESSING_STATUSES = [
  "translating",
  "cloning",
  "dubbing",
  "reverting"
];
var BLOCK_PROCESSING_STATUS_SET = normalizeStatusList(
  BLOCK_PROCESSING_STATUSES
);
function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}
function readString2(value) {
  return typeof value === "string" && value.trim() ? value : null;
}
function extractStashBlocks(source) {
  const blocks = asRecord(source).stashBlocks ?? asRecord(source).stash_blocks;
  return Array.isArray(blocks) ? blocks.filter(
    (block) => block && typeof block === "object" && !Array.isArray(block)
  ) : [];
}
function isBlockProcessingStatus(status) {
  return BLOCK_PROCESSING_STATUS_SET.has(normalizeProjectStatus(status));
}
function hasTranslationBlocksInProcessing(rawProject) {
  return extractStashBlocks(rawProject).some(
    (block) => isBlockProcessingStatus(readString2(block.status))
  );
}
var SUBTITLE_SEGMENT_PROCESSING_STATUSES = [
  "retranslating",
  "splitting"
];
var SUBTITLE_SEGMENT_PROCESSING_STATUS_SET = normalizeStatusList(
  SUBTITLE_SEGMENT_PROCESSING_STATUSES
);
var TRANSLATE_SUBTITLES_PROCESSING_STATUS_SET = normalizeStatusList(
  TRANSLATE_SUBTITLES_PROCESSING_STATUSES
);
function extractSegments(source) {
  const segments = asRecord(source).segments;
  return Array.isArray(segments) ? segments.filter(
    (segment) => segment && typeof segment === "object" && !Array.isArray(segment)
  ) : [];
}
function isSubtitleSegmentProcessingStatus(status) {
  return SUBTITLE_SEGMENT_PROCESSING_STATUS_SET.has(
    normalizeProjectStatus(status)
  );
}
function isTranslateSubtitlesProcessingStatus(status) {
  return TRANSLATE_SUBTITLES_PROCESSING_STATUS_SET.has(
    normalizeProjectStatus(status)
  );
}
function hasSubtitleSegmentsInProcessing(rawProject) {
  return extractSegments(rawProject).some(
    (segment) => isSubtitleSegmentProcessingStatus(readString2(segment.status))
  );
}
function asTextBlock(record, key) {
  const value = record[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function textBlockNeedsSubtitleInit(block) {
  const text = readString2(block.text);
  if (!text) {
    return false;
  }
  const subtitles = block.subtitles;
  return !Array.isArray(subtitles) || subtitles.length === 0;
}
function isDeletedSegment(segment) {
  return segment.isDeleted === true || segment.is_deleted === true;
}
function hasCaptionSegmentsMissingSubtitles(rawProject) {
  const segments = extractSegments(rawProject).filter(
    (segment) => !isDeletedSegment(segment)
  );
  if (!segments.length) {
    return false;
  }
  return segments.some((segment) => {
    const original = asTextBlock(segment, "original");
    const translated = asTextBlock(segment, "translated");
    return textBlockNeedsSubtitleInit(original) || textBlockNeedsSubtitleInit(translated);
  });
}
function shouldInitCaptionSubtitles(rawProject) {
  if (!hasCaptionSegmentsMissingSubtitles(rawProject)) {
    return false;
  }
  if (hasSubtitleSegmentsInProcessing(rawProject)) {
    return false;
  }
  const status = readString2(asRecord(rawProject).status);
  if (isTranslateSubtitlesProcessingStatus(status)) {
    return false;
  }
  return extractSegments(rawProject).some(
    (segment) => !isDeletedSegment(segment)
  );
}
var TRANSLATE_DUB_ASR_PROCESSING_STATUS = "processing";
function extractAsr(source) {
  const asr = asRecord(source).asr;
  if (!asr || typeof asr !== "object" || Array.isArray(asr)) {
    return null;
  }
  return asr;
}
function readAsrStatus(rawProject) {
  return readString2(extractAsr(rawProject)?.status);
}
function isAsrProcessingStatus(status) {
  return normalizeProjectStatus(status) === TRANSLATE_DUB_ASR_PROCESSING_STATUS;
}
function hasAsrInProcessing(rawProject) {
  return isAsrProcessingStatus(readAsrStatus(rawProject));
}
var CALLOUT_TEXT_EXPORT_BLOCKED_STATUSES = ["retranslating"];
var CALLOUT_TEXT_EXPORT_BLOCKED_STATUS_SET = normalizeStatusList(
  CALLOUT_TEXT_EXPORT_BLOCKED_STATUSES
);
function extractCalloutTexts(source) {
  const calloutTexts = asRecord(source).calloutTexts ?? asRecord(source).callout_texts;
  return Array.isArray(calloutTexts) ? calloutTexts.filter(
    (item) => item && typeof item === "object" && !Array.isArray(item)
  ) : [];
}
function isCalloutTextDeleted(item) {
  return item.isDeleted === true || item.is_deleted === true;
}
function isCalloutTextExportBlockedStatus(status) {
  const normalized = normalizeProjectStatus(status);
  if (!normalized) {
    return false;
  }
  if (CALLOUT_TEXT_EXPORT_BLOCKED_STATUS_SET.has(normalized)) {
    return true;
  }
  return false;
}
function hasCalloutTextsInProcessing(rawProject) {
  return extractCalloutTexts(rawProject).some((item) => {
    if (isCalloutTextDeleted(item)) {
      return false;
    }
    return isCalloutTextExportBlockedStatus(readString2(item.status));
  });
}
function extractLipsyncVariants(rawProject) {
  const variants = asRecord(rawProject).variants;
  return Array.isArray(variants) ? variants.filter(
    (variant) => variant && typeof variant === "object" && !Array.isArray(variant)
  ) : [];
}
function getLatestLipsyncVariant(rawProject) {
  const variants = extractLipsyncVariants(rawProject);
  return variants.length ? variants[variants.length - 1] : null;
}
function resolveLipsyncEffectiveStatus(rawProject, projectStatus) {
  const variantStatus = readString2(getLatestLipsyncVariant(rawProject)?.status);
  return variantStatus ?? projectStatus ?? null;
}
function resolveProjectExportGuardStatus(kind, rawProject, projectStatus) {
  if (kind === "lipsync" || kind === "talking-photo") {
    return resolveLipsyncEffectiveStatus(rawProject, projectStatus);
  }
  return projectStatus ?? null;
}
var EXPORT_BLOCKED_PROCESSING_STATUSES = normalizeStatusList(
  EXPORT_BLOCKED_PROCESSING_STATUS_LIST
);
function normalizeProjectStatus(status) {
  return status?.toLowerCase() ?? "";
}
function isExportBlockedProcessingStatus(status) {
  return EXPORT_BLOCKED_PROCESSING_STATUSES.has(normalizeProjectStatus(status));
}
function isProjectCurrentlyExporting(status) {
  return normalizeProjectStatus(status) === "exporting";
}
function isExportBlockedFailedStatus(status) {
  const normalized = normalizeProjectStatus(status);
  if (!normalized) {
    return false;
  }
  return normalized === "failed" || normalized.endsWith("_failed");
}
function isProjectProcessing(kind, rawProject, status) {
  const effectiveStatus = resolveProjectExportGuardStatus(
    kind,
    rawProject,
    status
  );
  if (isExportBlockedProcessingStatus(effectiveStatus) && normalizeProjectStatus(effectiveStatus) !== AWAITING_USER_ACTION_STATUS) {
    return true;
  }
  if (kind === "translate_dub" || kind === "audio-translation") {
    return hasTranslationBlocksInProcessing(rawProject) || hasAsrInProcessing(rawProject);
  }
  if (kind === "translate_subtitles") {
    return hasSubtitleSegmentsInProcessing(rawProject);
  }
  if (kind === "visual_translate") {
    return hasCalloutTextsInProcessing(rawProject);
  }
  return false;
}
function assertProjectNotFailedForArtifactAccess(options) {
  const effectiveStatus = resolveProjectExportGuardStatus(
    options.kind,
    options.rawProject,
    options.status
  );
  if (isExportBlockedFailedStatus(effectiveStatus)) {
    throw new Error(
      `Project ${options.id} failed (status: \`${effectiveStatus}\`) and cannot be exported or downloaded.`
    );
  }
}
function assertProjectNotAwaitingProofreadingForDownload(options) {
  const effectiveStatus = resolveProjectExportGuardStatus(
    options.kind,
    options.rawProject,
    options.status
  );
  if (normalizeProjectStatus(effectiveStatus) !== AWAITING_USER_ACTION_STATUS) {
    return;
  }
  throw new Error(
    `Project ${options.id} is awaiting voice proofreading and cannot be downloaded yet. Confirm the voices in the web editor (see webUrl) to start dubbing, then export and download.`
  );
}
function assertProjectNotCurrentlyExporting(options) {
  if (isProjectCurrentlyExporting(options.status)) {
    throw new Error(
      `Project ${options.id} is already exporting. Wait until export completes before trying again.`
    );
  }
}

// src/core/subtitle-export.ts
import path3 from "node:path";
var PAUSE_TAG_FULL = /\[Pause \d+(?:\.\d+)?s\]/;
var PAUSE_REGEX = new RegExp(`(${PAUSE_TAG_FULL.source})`, "g");
var PRON_REGEX = /\[pron:(.*?)\|\|.*?\]/g;
var SUBTITLE_ARTIFACTS = /* @__PURE__ */ new Set([
  "original_subtitle_srt",
  "original_subtitle_vtt",
  "original_subtitle_txt",
  "translated_subtitle_srt",
  "translated_subtitle_vtt",
  "translated_subtitle_txt"
]);
function asRecord2(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}
function readString3(value) {
  return typeof value === "string" && value.trim() ? value : null;
}
function readNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
function readField(block, camelKey, snakeKey) {
  return block[camelKey] ?? block[snakeKey];
}
function clearMarkText(text) {
  return text.replace(PAUSE_REGEX, "").replace(PRON_REGEX, "$1");
}
function formatTimeForSubtitle(seconds, fileType) {
  const date = /* @__PURE__ */ new Date(0);
  date.setSeconds(seconds);
  const timeString = date.toISOString().slice(11, 19);
  const milliseconds = Math.floor(seconds % 1 * 1e3);
  const separator = fileType === "srt" ? "," : ".";
  return `${timeString}${separator}${milliseconds.toString().padStart(3, "0")}`;
}
function generateSubtitleDataForPlainText(dataArray) {
  return dataArray.filter((item) => item.text !== "").map((item) => clearMarkText(item.text)).join("\n");
}
function generateSubtitleContent(sections, fileType) {
  if (fileType === "txt") {
    return generateSubtitleDataForPlainText(sections);
  }
  let subtitleData = sections.filter((item) => item.text !== "").map((item, index) => {
    const startTime = formatTimeForSubtitle(item.start, fileType);
    const endTime = formatTimeForSubtitle(item.end, fileType);
    const text = clearMarkText(item.text);
    return `${index + 1}
${startTime} --> ${endTime}
${text}

`;
  }).join("");
  if (fileType === "vtt") {
    subtitleData = `WEBVTT

${subtitleData}`;
  }
  return subtitleData;
}
function extractBlocksByKey(source, camelKey, snakeKey) {
  const record = asRecord2(source);
  const blocks = record[camelKey] ?? record[snakeKey];
  return Array.isArray(blocks) ? blocks.filter(
    (block) => block && typeof block === "object" && !Array.isArray(block)
  ) : [];
}
function readBlockId(block) {
  return readString3(readField(block, "blockID", "block_id")) ?? readString3(readField(block, "blockId", "block_id")) ?? "";
}
function isProofreadingStatus(status) {
  return status === "proofreading" || status === "dubbing_failed";
}
function extractTranslationSubtitleSections(rawProject, language) {
  const stableBlocks = extractBlocksByKey(
    rawProject,
    "stableBlocks",
    "stable_blocks"
  );
  const stashBlocks = extractBlocksByKey(
    rawProject,
    "stashBlocks",
    "stash_blocks"
  );
  const status = readString3(asRecord2(rawProject).status);
  const isProofreading = isProofreadingStatus(status);
  const stableById = new Map(
    stableBlocks.map((block) => [readBlockId(block), block])
  );
  const sections = [];
  for (const stash of stashBlocks) {
    const stable = stableById.get(readBlockId(stash));
    if (language === "original") {
      const text2 = readString3(readField(stash, "originalText", "original_text")) ?? readString3(readField(stable ?? {}, "originalText", "original_text")) ?? "";
      const start2 = readNumber(
        readField(stash, "originalStartTime", "original_start_time")
      ) ?? 0;
      const end2 = readNumber(readField(stash, "originalEndTime", "original_end_time")) ?? start2;
      sections.push({ text: text2, start: start2, end: end2 });
      continue;
    }
    const text = readString3(readField(stash, "translatedText", "translated_text")) ?? readString3(
      readField(stable ?? {}, "translatedText", "translated_text")
    ) ?? "";
    let start = readNumber(
      readField(stash, "translatedStartTime", "translated_start_time")
    ) ?? 0;
    let end = readNumber(
      readField(stash, "translatedEndTime", "translated_end_time")
    ) ?? start;
    if (isProofreading) {
      start = readNumber(
        readField(stash, "originalStartTime", "original_start_time")
      ) ?? readNumber(
        readField(stable ?? {}, "originalStartTime", "original_start_time")
      ) ?? start;
      end = readNumber(readField(stash, "originalEndTime", "original_end_time")) ?? readNumber(
        readField(stable ?? {}, "originalEndTime", "original_end_time")
      ) ?? end;
    }
    sections.push({ text, start, end });
  }
  return sections;
}
function extractCaptionSubtitleSections(rawProject, language) {
  const segments = asRecord2(rawProject).segments;
  if (!Array.isArray(segments)) {
    return [];
  }
  const sections = [];
  const seen = /* @__PURE__ */ new Set();
  for (const segment of segments) {
    const segmentRecord = asRecord2(segment);
    if (segmentRecord.isDeleted || segmentRecord.is_deleted) {
      continue;
    }
    const textBlock = asRecord2(
      language === "original" ? segmentRecord.original ?? segmentRecord["original"] : segmentRecord.translated ?? segmentRecord["translated"]
    );
    const subtitles = textBlock.subtitles;
    if (!Array.isArray(subtitles)) {
      continue;
    }
    for (const subtitle of subtitles) {
      const subtitleRecord = asRecord2(subtitle);
      const interval = asRecord2(subtitleRecord.interval);
      const start = readNumber(interval.startTime ?? interval.start_time) ?? 0;
      const end = readNumber(interval.endTime ?? interval.end_time) ?? start;
      const text = readString3(subtitleRecord.text) ?? "";
      const dedupeKey = readString3(readField(subtitleRecord, "subtitleId", "subtitle_id")) ?? `${start}|${end}|${text}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      sections.push({ text, start, end });
    }
  }
  return sections;
}
function isSubtitleArtifact(artifact) {
  return SUBTITLE_ARTIFACTS.has(artifact);
}
function parseSubtitleArtifact(artifact) {
  switch (artifact) {
    case "original_subtitle_srt":
      return { language: "original", format: "srt" };
    case "original_subtitle_vtt":
      return { language: "original", format: "vtt" };
    case "original_subtitle_txt":
      return { language: "original", format: "txt" };
    case "translated_subtitle_srt":
      return { language: "translated", format: "srt" };
    case "translated_subtitle_vtt":
      return { language: "translated", format: "vtt" };
    case "translated_subtitle_txt":
      return { language: "translated", format: "txt" };
    default:
      throw new Error(`Unsupported subtitle artifact: ${artifact}`);
  }
}
function extractSubtitleSections(kind, rawProject, language) {
  switch (kind) {
    case "translate_dub":
    case "audio-translation":
      return extractTranslationSubtitleSections(rawProject, language);
    case "translate_subtitles":
      return extractCaptionSubtitleSections(rawProject, language);
    default:
      throw new Error(
        `Subtitle files are not supported for project kind \`${kind}\`.`
      );
  }
}
function inferSubtitleOutputPath(outputPath, format) {
  if (path3.extname(outputPath)) {
    return outputPath;
  }
  return `${outputPath}.${format}`;
}
function sanitizeFileNameSegment(value) {
  const sanitized = value.replace(/[\\/:*?"<>|]/g, "_").trim();
  return sanitized || "project";
}
function buildSubtitleFileName(options) {
  const languageText = options.language === "original" ? "original" : TranslateCode2Lang[options.targetLanguage ?? ""] ?? options.targetLanguage ?? "translated";
  const title = sanitizeFileNameSegment(options.title ?? "project");
  return `${title}_${sanitizeFileNameSegment(languageText)}_subtitles.${options.format}`;
}

// src/core/project.ts
import { randomUUID as randomUUID4 } from "node:crypto";
import { mkdir as mkdir2, stat as stat2, writeFile as writeFile3 } from "node:fs/promises";
import * as path4 from "node:path";

// src/core/storage.ts
import { createReadStream } from "node:fs";
import mime from "mime-types";
import OSS from "ali-oss";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
var OSS_USER_REGION = "cn";
function getStorageProviderFromRegion(region) {
  return region?.toLowerCase() === OSS_USER_REGION ? "oss" : "s3";
}
function shouldFallbackOssToS3(error) {
  if (error instanceof CliApiError) {
    return error.status === 404 || error.status >= 500;
  }
  const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : void 0;
  return status === 404 || status != null && status >= 500;
}
async function getAwsTemporaryCredentials(apiBaseUrl) {
  const session = await requireAuthenticatedSession(apiBaseUrl);
  const response = await requestJson({
    apiBaseUrl: session.apiBaseUrl,
    headers: {
      Authorization: `${session.tokenType} ${session.accessToken}`
    },
    path: "/v1/token/aws"
  });
  return {
    accessKeyID: response.data.accessKeyID ?? response.data.access_key_id ?? "",
    accessKeySecret: response.data.accessKeySecret ?? response.data.access_key_secret ?? "",
    currentTime: response.data.currentTime ?? response.data.current_time ?? "",
    securityToken: response.data.securityToken ?? response.data.security_token ?? "",
    tokenExpireAt: response.data.tokenExpireAt ?? response.data.token_expire_at ?? ""
  };
}
async function getOssTemporaryCredentials(apiBaseUrl) {
  const session = await requireAuthenticatedSession(apiBaseUrl);
  const response = await requestJson({
    apiBaseUrl: session.apiBaseUrl,
    headers: {
      Authorization: `${session.tokenType} ${session.accessToken}`
    },
    path: "/v1/token/oss"
  });
  return {
    accessKeyID: response.data.accessKeyID ?? response.data.access_key_id ?? "",
    accessKeySecret: response.data.accessKeySecret ?? response.data.access_key_secret ?? "",
    region: response.data.region ?? "oss-cn-hangzhou",
    securityToken: response.data.securityToken ?? response.data.security_token ?? ""
  };
}
async function uploadLocalFileByS3(options) {
  const credentials = await getAwsTemporaryCredentials(options.apiBaseUrl);
  const contentType = mime.lookup(options.filePath) || void 0;
  const s3 = new S3Client({
    region: "us-west-2",
    systemClockOffset: Date.parse(credentials.currentTime) - Date.now(),
    credentials: {
      accessKeyId: credentials.accessKeyID,
      secretAccessKey: credentials.accessKeySecret,
      sessionToken: credentials.securityToken
    },
    useAccelerateEndpoint: true,
    maxAttempts: 5
  });
  const upload = new Upload({
    client: s3,
    params: {
      Body: createReadStream(options.filePath),
      Bucket: options.bucketName,
      ContentType: typeof contentType === "string" ? contentType : void 0,
      Key: options.uploadPath
    },
    queueSize: 4,
    partSize: 5 * 1024 * 1024,
    leavePartsOnError: false
  });
  await upload.done();
}
async function uploadLocalFileByOss(options) {
  const credentials = await getOssTemporaryCredentials(options.apiBaseUrl);
  const contentType = mime.lookup(options.filePath) || void 0;
  const client = new OSS({
    accessKeyId: credentials.accessKeyID,
    accessKeySecret: credentials.accessKeySecret,
    bucket: options.bucketName,
    region: credentials.region,
    refreshSTSToken: async () => {
      const refreshed = await getOssTemporaryCredentials(options.apiBaseUrl);
      return {
        accessKeyId: refreshed.accessKeyID,
        accessKeySecret: refreshed.accessKeySecret,
        stsToken: refreshed.securityToken
      };
    },
    refreshSTSTokenInterval: 5 * 60 * 1e3,
    secure: true,
    stsToken: credentials.securityToken
  });
  await client.multipartUpload(options.uploadPath, options.filePath, {
    mime: typeof contentType === "string" ? contentType : void 0,
    parallel: 6,
    partSize: 5 * 1024 * 1024
  });
}
async function uploadLocalFileToBucket(options) {
  const region = options.region ?? await getUserStorageRegion(options.apiBaseUrl);
  if (getStorageProviderFromRegion(region) === "oss") {
    try {
      await uploadLocalFileByOss(options);
      return;
    } catch (error) {
      if (!(options.allowS3Fallback ?? true) || !shouldFallbackOssToS3(error)) {
        throw error;
      }
    }
  }
  await uploadLocalFileByS3(options);
}

// src/core/project.ts
var LIPSYNC_CREATE_MODE = "precision";
var TEMP_BUCKET_NAME = "kea-us-west-2-tmp";
var TEMP_BUCKET_NAME_CN = "kea-cn-hangzhou-tmp";
var LIST_KIND_TO_QUERY_TYPE = {
  "audio-translation": "audio_translation",
  lipsync: "lipsync",
  "talking-photo": "talking_photo",
  translate_dub: "translation",
  translate_subtitles: "translate_caption",
  visual_translate: "translate_frame"
};
var DETAIL_KIND_TO_PATH = {
  "audio-translation": "/v1/audio_translations",
  lipsync: "/v1/lipsyncs",
  "talking-photo": "/v1/lipsyncs",
  translate_dub: "/v1/translations",
  translate_subtitles: "/v1/translate_captions",
  visual_translate: "/v1/translate_frames"
};
var DETAIL_KIND_TO_WEB_PATH = {
  "audio-translation": "/audio_translation",
  lipsync: "/lipsync",
  "talking-photo": "/lipsync",
  translate_dub: "/translation",
  translate_subtitles: "/subtitle_translation",
  visual_translate: "/frame_translation"
};
var DETAIL_KIND_TO_OPEN_PATH = {
  "audio-translation": "/audio_translation",
  translate_dub: "/translation"
};
var PRIMARY_EXPORT_ARTIFACT = {
  "audio-translation": "dubbed_audio",
  lipsync: "lipsync_video",
  "talking-photo": "lipsync_video",
  translate_dub: "dubbed_video",
  translate_subtitles: "translation_subtitle",
  visual_translate: "visual_translation"
};
var EXPORTABLE_ARTIFACTS = {
  "audio-translation": ["dubbed_audio", "dubbed_audio_mp3"],
  translate_dub: ["dubbed_video", "dubbed_audio", "dubbed_audio_mp3"]
};
var KIND_ALIASES = {
  all: "all",
  "audio-translation": "audio-translation",
  audio_translation: "audio-translation",
  audiotranslation: "audio-translation",
  caption: "translate_subtitles",
  captions: "translate_subtitles",
  "frame-translation": "visual_translate",
  frame_translation: "visual_translate",
  frametranslation: "visual_translate",
  lipsync: "lipsync",
  subtitle_translation: "translate_subtitles",
  talking_photo: "talking-photo",
  talkingphoto: "talking-photo",
  "talking-photo": "talking-photo",
  translate_caption: "translate_subtitles",
  translate_dub: "translate_dub",
  translate_frame: "visual_translate",
  translate_subtitles: "translate_subtitles",
  translatecaption: "translate_subtitles",
  translation: "translate_dub",
  visual_translate: "visual_translate"
};
function assertProjectReadyForExport(options) {
  const currentStatus = normalizeProjectStatus(
    resolveProjectExportGuardStatus(
      options.kind,
      options.project.raw,
      options.project.status
    )
  );
  if (isExportBlockedProcessingStatus(currentStatus)) {
    if (currentStatus === AWAITING_USER_ACTION_STATUS) {
      throw new Error(
        `Project ${options.id} is awaiting voice proofreading and cannot be exported yet. Confirm the voices in the web editor (see webUrl) to start dubbing, then export.`
      );
    }
    throw new Error(
      `Project ${options.id} is still processing (status: \`${options.project.status}\`). Try exporting again after processing completes.`
    );
  }
  if ((options.kind === "translate_dub" || options.kind === "audio-translation") && hasTranslationBlocksInProcessing(options.project.raw)) {
    throw new Error(
      `Project ${options.id} cannot be exported because translation blocks are still processing.`
    );
  }
  if ((options.kind === "translate_dub" || options.kind === "audio-translation") && hasAsrInProcessing(options.project.raw)) {
    throw new Error(
      `Project ${options.id} cannot be exported because ASR is still processing.`
    );
  }
  if (options.kind === "translate_subtitles" && hasSubtitleSegmentsInProcessing(options.project.raw)) {
    throw new Error(
      `Project ${options.id} cannot be exported because subtitle segments are still processing.`
    );
  }
  if (options.kind === "visual_translate" && hasCalloutTextsInProcessing(options.project.raw)) {
    throw new Error(
      `Project ${options.id} cannot be exported because callout texts are still processing.`
    );
  }
}
var ARTIFACT_TYPES = /* @__PURE__ */ new Set([
  "background_audio",
  "dubbed_audio",
  "dubbed_audio_mp3",
  "dubbed_video",
  "lipsync_video",
  "original_subtitle_srt",
  "original_subtitle_txt",
  "original_subtitle_vtt",
  "translated_subtitle_srt",
  "translated_subtitle_txt",
  "translated_subtitle_vtt",
  "translation_subtitle",
  "visual_translation"
]);
var SUBTITLE_ARTIFACTS2 = [
  "original_subtitle_srt",
  "original_subtitle_vtt",
  "original_subtitle_txt",
  "translated_subtitle_srt",
  "translated_subtitle_vtt",
  "translated_subtitle_txt"
];
function supportsSubtitleArtifact(kind, artifact) {
  if (!SUBTITLE_ARTIFACTS2.includes(artifact)) {
    return false;
  }
  return kind === "translate_dub" || kind === "audio-translation" || kind === "translate_subtitles";
}
function buildQueryPath(path6, query) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === void 0 || value === "") {
      continue;
    }
    searchParams.set(key, String(value));
  }
  const queryString = searchParams.toString();
  return queryString ? `${path6}?${queryString}` : path6;
}
function asRecord3(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}
function readString4(value) {
  return typeof value === "string" && value.trim() ? value : null;
}
function isPlaceholderExportDownloadUrl(url) {
  return url.includes("/exports/-/download_url");
}
function readArtifactDownloadUrl(value) {
  const url = readString4(value);
  if (!url || isPlaceholderExportDownloadUrl(url)) {
    return null;
  }
  return url;
}
function readNestedString(source, ...keys) {
  let current = source;
  for (const key of keys) {
    current = asRecord3(current)[key];
  }
  return readString4(current);
}
function readNestedArtifactDownloadUrl(source, ...keys) {
  let current = source;
  for (const key of keys) {
    current = asRecord3(current)[key];
  }
  return readArtifactDownloadUrl(current);
}
function readLatestLipsyncVariantDownloadUrl(rawProject) {
  const latestVariant = getLatestLipsyncVariant(rawProject);
  if (!latestVariant) {
    return null;
  }
  return readNestedArtifactDownloadUrl(
    latestVariant,
    "lipSyncedResult",
    "downloadURL"
  ) ?? readNestedArtifactDownloadUrl(
    latestVariant,
    "lip_synced_result",
    "download_url"
  );
}
function parseArtifactType(value) {
  const normalized = value.trim().toLowerCase().replaceAll("-", "_");
  if (!ARTIFACT_TYPES.has(normalized)) {
    throw new Error(`Unsupported artifact type: ${value}`);
  }
  return normalized;
}
function resolveArtifactTypeForKind(kind, artifact) {
  switch (kind) {
    case "translate_dub":
      if (artifact === "dubbed_video" || artifact === "dubbed_audio" || artifact === "dubbed_audio_mp3" || artifact === "background_audio" || supportsSubtitleArtifact(kind, artifact)) {
        return artifact;
      }
      break;
    case "audio-translation":
      if (artifact === "dubbed_audio" || artifact === "dubbed_audio_mp3" || artifact === "background_audio" || supportsSubtitleArtifact(kind, artifact)) {
        return artifact;
      }
      break;
    case "translate_subtitles":
      if (artifact === "translation_subtitle" || supportsSubtitleArtifact(kind, artifact)) {
        return artifact;
      }
      break;
    case "visual_translate":
      if (artifact === "visual_translation") {
        return "visual_translation";
      }
      break;
    case "lipsync":
    case "talking-photo":
      if (artifact === "lipsync_video") {
        return "lipsync_video";
      }
      break;
    default:
      break;
  }
  throw new Error(
    `Artifact \`${artifact}\` is not supported for project kind \`${kind}\`.`
  );
}
function resolveArtifactSourceUrl(kind, artifact, rawProject) {
  const renderedVideo = asRecord3(asRecord3(rawProject).renderedVideo);
  switch (kind) {
    case "translate_dub":
      if (artifact === "dubbed_video") {
        return readArtifactDownloadUrl(renderedVideo.dubbedDownloadURL) ?? readNestedArtifactDownloadUrl(
          rawProject,
          "rendered_video",
          "dubbed_download_url"
        );
      }
      if (artifact === "dubbed_audio") {
        return readArtifactDownloadUrl(renderedVideo.dubbedAudioDownloadURL) ?? readNestedArtifactDownloadUrl(
          rawProject,
          "rendered_video",
          "dubbed_audio_download_url"
        );
      }
      if (artifact === "dubbed_audio_mp3") {
        return readArtifactDownloadUrl(renderedVideo.dubbedAudioMp3DownloadURL) ?? readNestedArtifactDownloadUrl(
          rawProject,
          "rendered_video",
          "dubbed_audio_mp3_download_url"
        );
      }
      if (artifact === "background_audio") {
        return readArtifactDownloadUrl(asRecord3(rawProject).bgmDownloadURL) ?? readArtifactDownloadUrl(asRecord3(rawProject).bgm_download_url);
      }
      return null;
    case "audio-translation":
      if (artifact === "dubbed_audio") {
        return readArtifactDownloadUrl(renderedVideo.dubbedAudioDownloadURL) ?? readNestedArtifactDownloadUrl(
          rawProject,
          "rendered_video",
          "dubbed_audio_download_url"
        );
      }
      if (artifact === "dubbed_audio_mp3") {
        return readArtifactDownloadUrl(renderedVideo.dubbedAudioMp3DownloadURL) ?? readNestedArtifactDownloadUrl(
          rawProject,
          "rendered_video",
          "dubbed_audio_mp3_download_url"
        );
      }
      if (artifact === "background_audio") {
        return readArtifactDownloadUrl(asRecord3(rawProject).bgmDownloadURL) ?? readArtifactDownloadUrl(asRecord3(rawProject).bgm_download_url);
      }
      return null;
    case "translate_subtitles":
      return readArtifactDownloadUrl(renderedVideo.videoWithCaptionDownloadURL) ?? readNestedArtifactDownloadUrl(
        rawProject,
        "rendered_video",
        "video_with_caption_download_url"
      );
    case "visual_translate":
      return readArtifactDownloadUrl(renderedVideo.videoDownloadURL) ?? readNestedArtifactDownloadUrl(
        rawProject,
        "rendered_video",
        "video_download_url"
      );
    case "lipsync":
    case "talking-photo":
      return readLatestLipsyncVariantDownloadUrl(rawProject) ?? readNestedArtifactDownloadUrl(
        rawProject,
        "lipSyncedResult",
        "downloadURL"
      ) ?? readNestedArtifactDownloadUrl(
        rawProject,
        "lip_synced_result",
        "download_url"
      ) ?? readArtifactDownloadUrl(renderedVideo.lipSyncedDownloadURL) ?? readNestedArtifactDownloadUrl(
        rawProject,
        "rendered_video",
        "lip_synced_download_url"
      );
    default:
      return null;
  }
}
function inferExtensionFromContentType(contentType) {
  if (!contentType) {
    return null;
  }
  if (contentType.includes("video/mp4")) {
    return "mp4";
  }
  if (contentType.includes("audio/mpeg")) {
    return "mp3";
  }
  if (contentType.includes("audio/wav") || contentType.includes("audio/x-wav")) {
    return "wav";
  }
  if (contentType.includes("audio/mp4")) {
    return "m4a";
  }
  return null;
}
function inferExtensionFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const ext = path4.extname(pathname).replace(/^\./, "");
    return ext || null;
  } catch {
    return null;
  }
}
function parseContentDispositionFilename(header) {
  if (!header) {
    return null;
  }
  const encoded = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (encoded?.[1]) {
    const value = encoded[1].trim().replace(/^"|"$/g, "");
    try {
      return decodeURIComponent(value) || null;
    } catch {
      return value || null;
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() || null;
}
function normalizeExtension(ext) {
  const value = ext.toLowerCase();
  if (value === "jpeg") {
    return "jpg";
  }
  if (value === "m4a") {
    return "mp4";
  }
  return value;
}
function extMatches(a, b) {
  return normalizeExtension(a) === normalizeExtension(b);
}
function inferOutputPath(options) {
  const dispositionExt = options.dispositionFilename ? path4.extname(options.dispositionFilename).replace(/^\./, "").toLowerCase() || null : null;
  const actualExtension = dispositionExt ?? inferExtensionFromContentType(options.contentType) ?? inferExtensionFromUrl(options.sourceUrl);
  const userExtension = path4.extname(options.outputPath).replace(/^\./, "").toLowerCase();
  if (userExtension) {
    if (actualExtension && !extMatches(userExtension, actualExtension)) {
      const evidence = options.dispositionFilename ? `server filename: ${options.dispositionFilename}` : options.contentType ? `content-type: ${options.contentType}` : `source URL extension: .${actualExtension}`;
      process.stderr.write(
        `Warning: --output has extension .${userExtension} but the downloaded file appears to be .${actualExtension} (${evidence}). Saving as .${userExtension} as requested.
`
      );
    }
    return options.outputPath;
  }
  const extension = actualExtension ?? (options.artifact.includes("audio") ? "wav" : "mp4");
  return `${options.outputPath}.${extension}`;
}
function buildArtifactRequestHeaders(sourceUrl, apiBaseUrl, authHeaders) {
  let target;
  try {
    target = new URL(sourceUrl);
  } catch {
    return authHeaders;
  }
  try {
    return target.origin === new URL(apiBaseUrl).origin ? authHeaders : {};
  } catch {
    return {};
  }
}
function extractNestedDownloadUrl(source) {
  return readString4(asRecord3(source).url) ?? readString4(asRecord3(source).downloadURL) ?? readString4(asRecord3(source).download_url) ?? readNestedString(source, "data", "url") ?? readNestedString(source, "data", "downloadURL") ?? readNestedString(source, "data", "download_url");
}
function parseJwtPayload(token) {
  const [, payload] = token.split(".");
  if (!payload) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
function getCountryCodeFromToken(token) {
  return parseJwtPayload(token)?.country_code ?? "USA";
}
function getTempBucketName(userRegion) {
  return getStorageProviderFromRegion(userRegion) === "oss" ? TEMP_BUCKET_NAME_CN : TEMP_BUCKET_NAME;
}
function getVideoExtension(video) {
  const fromExtra = video.extra?.trim();
  if (fromExtra) {
    return fromExtra.replace(/^\./, "");
  }
  const directUrl = video.videoSrcList?.[0] ?? video.video_src_list?.[0] ?? video.videoUrl ?? video.video_url;
  if (directUrl) {
    try {
      const pathname = new URL(directUrl).pathname;
      const lastSegment = pathname.split("/").pop() ?? "";
      const extension = lastSegment.includes(".") ? lastSegment.split(".").pop() : void 0;
      if (extension) {
        return extension.toLowerCase();
      }
    } catch {
    }
  }
  return "mp4";
}
function buildPreparedUploadPath(uploadDir, extension) {
  const normalizedExtension = extension.replace(/^\./, "") || "mp4";
  const originalPath = `${uploadDir}/video.mp4`;
  const pathWithoutExt = originalPath.includes(".") ? originalPath.substring(0, originalPath.lastIndexOf(".")) : originalPath;
  return `${pathWithoutExt}.${normalizedExtension}`;
}
function buildPreparedSubtitleUploadPath(uploadDir, extension) {
  return replaceStoragePathExtension(`${uploadDir}/subtitle.srt`, extension);
}
function buildBatchUploadPath(batchDir, extension) {
  const normalizedExtension = extension || "mp4";
  return `${batchDir}/${randomUUID4().replaceAll("-", "").slice(0, 8)}.${normalizedExtension}`;
}
function getPreferredVideoUrl(video, fallbackUrl) {
  return video.videoSrcList?.[0] ?? video.video_src_list?.[0] ?? video.videoUrl ?? video.video_url ?? fallbackUrl;
}
function getPreferredThumbnailUrl(video) {
  return video.thumbnail ?? video.thumbUrl ?? video.thumb_url ?? "";
}
function getPreferredTitle(video, fallbackTitle) {
  return resolveProjectTitle(
    video.pageTitle || video.page_title || video.name || fallbackTitle
  );
}
async function uploadSingleLocalFile(options) {
  await ensureLocalFileReadable(options.filePath);
  await uploadLocalFileToBucket(options);
}
function replaceStoragePathExtension(filePath, newExtension) {
  const normalizedExtension = newExtension.replace(/^\./, "");
  if (!normalizedExtension) {
    return filePath;
  }
  const parts = filePath.split(".");
  parts.pop();
  return `${parts.join(".")}.${normalizedExtension}`;
}
async function uploadSubtitleFileForTranslation(options) {
  const basePath = options.createInfo.uploadSubtitlePath ?? options.createInfo.upload_subtitle_path;
  if (!basePath) {
    throw new Error(
      "The create API response did not include a subtitle upload path."
    );
  }
  const uploadPath = replaceStoragePathExtension(
    basePath,
    getLocalFileExtension(options.subtitleFilePath)
  );
  await uploadSingleLocalFile({
    apiBaseUrl: options.apiBaseUrl,
    bucketName: options.bucketName,
    filePath: options.subtitleFilePath,
    uploadPath
  });
  return uploadPath;
}
async function createBatchUploadEntries(options) {
  const batchDir = `batch_upload/${randomUUID4().replaceAll("-", "").slice(0, 8)}`;
  const uploadedFiles = [];
  for (const filePath of options.filePaths) {
    assertSupportedLocalMediaFile(filePath);
    await ensureLocalFileReadable(filePath);
    const mediaType = inferLocalMediaType(filePath);
    if (mediaType !== "audio" && mediaType !== "video") {
      throw new Error(`Unsupported batch media file: ${filePath}`);
    }
    const duration = await getLocalMediaDuration(filePath);
    const extension = getLocalFileExtension(filePath) || "mp4";
    const uploadPath = buildBatchUploadPath(batchDir, extension);
    await uploadLocalFileToBucket({
      // The batch temp bucket only exists on the region's own provider, and its
      // name is sent as `uploaded_bucket` in the batch-create request body, so
      // silently retrying on the other provider would strand the files.
      allowS3Fallback: false,
      apiBaseUrl: options.apiBaseUrl,
      bucketName: options.bucketName,
      filePath,
      region: options.userRegion,
      uploadPath
    });
    uploadedFiles.push({
      duration,
      filename: truncateProjectTitle(getLocalFileBaseName(filePath)),
      media_type: mediaType,
      path: uploadPath
    });
  }
  return uploadedFiles;
}
async function prepareBatchFilePathsForCreate(options) {
  assertBatchFileCountAllowed(options.filePaths);
  const { filePaths, skippedFiles } = await filterBatchFilePathsForCreate(
    options
  );
  const warnings = skippedFiles.map(
    (skipped) => `Skipped ${skipped.filePath}: ${skipped.reason}.`
  );
  return {
    filePaths,
    skippedFiles,
    warnings
  };
}
function buildBatchCreateResult(options) {
  return {
    ids: options.ids,
    kind: options.kind,
    status: "started",
    ...options.skippedFiles.length ? { skippedFiles: options.skippedFiles } : {},
    ...options.warnings.length ? { warnings: options.warnings } : {}
  };
}
function resolveBatchTranslationMediaType(filePaths) {
  const normalized = filePaths.filter(Boolean);
  for (const filePath of normalized) {
    assertSupportedLocalMediaFile(filePath);
  }
  const seen = /* @__PURE__ */ new Set();
  for (const filePath of normalized) {
    const mediaType = inferLocalMediaType(filePath);
    if (mediaType !== "audio" && mediaType !== "video") {
      continue;
    }
    seen.add(mediaType);
    if (seen.size > 1) {
      throw new Error(
        "Batch translate_dub creation cannot mix audio and video files. Split audio files and video files into separate batches."
      );
    }
  }
  return seen.has("audio") ? "audio" : "video";
}
function assertBatchVideoOnly(filePaths) {
  for (const filePath of filePaths.filter(Boolean)) {
    assertSupportedLocalMediaFile(filePath);
    const mediaType = inferLocalMediaType(filePath);
    if (mediaType !== "video") {
      throw new Error(
        "translate_subtitles does not support audio files. Provide video files only for batch creation."
      );
    }
  }
}
function buildFirstTimeClipWarning(clip) {
  return `Insufficient points on a first-time creation: the video was automatically clipped to ${clip.clipInterval[0]}-${clip.clipInterval[1]}s (original duration ${clip.originalDurationSeconds}s).`;
}
function compactJsonObject(value) {
  const entries = Object.entries(value).filter(([, entryValue]) => {
    return entryValue !== void 0;
  });
  return Object.fromEntries(entries);
}
async function resolveFirstVisualTranslateClipInterval(options) {
  const [points, features] = options.entitlements ? [options.entitlements.points, options.entitlements.features] : await Promise.all([
    getUserPoints(options.apiBaseUrl),
    getUserFeatureConfig(options.apiBaseUrl)
  ]);
  const isFirstUser = (features.translateFrameCount ?? 0) === 0;
  if (!isFirstUser) {
    return null;
  }
  const totalPoints = calcTotalPoints(points);
  if (totalPoints <= 0) {
    return null;
  }
  const consumedPoints = estimateConsumedPoints({
    durationSeconds: options.durationSeconds,
    kind: "visual_translate"
  });
  if (consumedPoints <= totalPoints) {
    return null;
  }
  const clipEndSeconds = totalPoints * 6;
  if (!Number.isFinite(clipEndSeconds) || clipEndSeconds <= 0) {
    return null;
  }
  return {
    clipInterval: [0, clipEndSeconds],
    durationSeconds: clipEndSeconds
  };
}
async function resolveFirstTranslateDubClipInterval(options) {
  const [points, features] = options.entitlements ? [options.entitlements.points, options.entitlements.features] : await Promise.all([
    getUserPoints(options.apiBaseUrl),
    getUserFeatureConfig(options.apiBaseUrl)
  ]);
  const isFirstUser = features.existSuccessfulTranslation === false;
  if (!isFirstUser) {
    return null;
  }
  const totalPoints = calcTotalPoints(points);
  if (totalPoints <= 0) {
    return null;
  }
  const consumedPoints = estimateConsumedPoints({
    durationSeconds: options.durationSeconds,
    enableSubtitles: options.enableSubtitles,
    kind: "translate_dub",
    removeOriginalSubtitle: options.removeOriginalSubtitle
  });
  if (consumedPoints <= totalPoints) {
    return null;
  }
  const secondsPerPoint = options.enableSubtitles && options.removeOriginalSubtitle ? 15 : 20;
  const clipEndSeconds = totalPoints * secondsPerPoint;
  if (!Number.isFinite(clipEndSeconds) || clipEndSeconds <= 0) {
    return null;
  }
  return {
    clipInterval: [0, clipEndSeconds],
    durationSeconds: clipEndSeconds
  };
}
function normalizeKind(kind) {
  const normalized = KIND_ALIASES[kind.toLowerCase()];
  if (!normalized) {
    throw new Error(`Unsupported project kind: ${kind}`);
  }
  return normalized;
}
var CLI_LISTABLE_KINDS = /* @__PURE__ */ new Set([
  "audio-translation",
  "lipsync",
  "translate_dub",
  "translate_subtitles",
  "visual_translate"
]);
var LIPSYNC_CREATION_SOURCES = /* @__PURE__ */ new Set([
  "file",
  "link",
  "rewrite",
  "translation",
  "voice_editing"
]);
function isTalkingPhotoLipsyncItem(project) {
  return !LIPSYNC_CREATION_SOURCES.has(
    project.creationSource ?? project.creation_source ?? ""
  );
}
function safeNormalizeKind(kind) {
  return KIND_ALIASES[kind.toLowerCase()] ?? null;
}
function normalizeFolder(folder) {
  return {
    folderId: folder.folderID ?? folder.folder_id ?? "",
    folderName: folder.folderName ?? folder.folder_name ?? "",
    projectCount: folder.projectCount ?? folder.project_count ?? null,
    thumbUrls: folder.thumbUrls ?? folder.thumb_urls ?? []
  };
}
function buildProjectWebUrl(kind, id) {
  const basePath = DETAIL_KIND_TO_WEB_PATH[kind];
  return new URL(`${basePath}/${id}`, resolveWebAppUrl()).toString();
}
function buildProjectOpenUrl(kind, id) {
  const previewBasePath = DETAIL_KIND_TO_OPEN_PATH[kind];
  if (previewBasePath) {
    return new URL(
      `${previewBasePath}/${id}/preview`,
      resolveWebAppUrl()
    ).toString();
  }
  return buildProjectWebUrl(kind, id);
}
function resolveProjectArtifactType(kind, artifactInput) {
  return resolveArtifactTypeForKind(kind, parseArtifactType(artifactInput));
}
function resolveProjectArtifactSourceUrl(kind, artifact, rawProject) {
  return resolveArtifactSourceUrl(kind, artifact, rawProject);
}
function resolveExportArtifactForKind(kind, artifactInput) {
  const defaultArtifact = PRIMARY_EXPORT_ARTIFACT[kind];
  const artifact = artifactInput ? resolveProjectArtifactType(kind, artifactInput) : defaultArtifact;
  const allowed = EXPORTABLE_ARTIFACTS[kind];
  if (allowed) {
    if (!allowed.includes(artifact)) {
      throw new Error(
        `Artifact \`${artifact}\` cannot be exported for project kind \`${kind}\`. Supported export artifacts: ${allowed.join(
          ", "
        )}.`
      );
    }
    return artifact;
  }
  if (artifactInput && artifact !== defaultArtifact) {
    throw new Error(
      `Project kind \`${kind}\` only supports exporting \`${defaultArtifact}\`. Remove --artifact or use the default.`
    );
  }
  return defaultArtifact;
}
function buildExportRequestBody(kind, artifact, rawProject) {
  if (kind === "translate_dub" || kind === "audio-translation") {
    const raw = asRecord3(rawProject);
    const enableSubtitles = Boolean(
      raw.enableSubtitles ?? raw.enable_subtitles
    );
    return compactJsonObject({
      exportType: artifact,
      isSubtitleAdded: enableSubtitles
    });
  }
  if (kind === "lipsync" || kind === "talking-photo") {
    const raw = asRecord3(rawProject);
    const latestVariant = getLatestLipsyncVariant(rawProject);
    const variantId = readString4(raw.variantID ?? raw.variantId ?? raw.variant_id) ?? readString4(latestVariant?.variantID ?? latestVariant?.variant_id);
    return compactJsonObject({
      // Keep the same key casing as web APIs (`variantID`).
      variantID: variantId ?? void 0
    });
  }
  return {};
}
var PROJECT_NOT_FOUND_MESSAGE = "Project not found.";
function extractApiErrorInfo(error) {
  if (error instanceof CliApiError) {
    return { message: error.message, status: error.status };
  }
  if (error instanceof Error) {
    return {
      message: error.message,
      status: "status" in error ? Number(error.status) : void 0
    };
  }
  if (error && typeof error === "object") {
    const record = error;
    return {
      message: typeof record.message === "string" ? record.message : String(error),
      status: typeof record.status === "number" ? record.status : Number(record.status)
    };
  }
  if (typeof error === "string") {
    return { message: error };
  }
  return { message: String(error) };
}
function isProjectNotFoundError(error) {
  const { message, status } = extractApiErrorInfo(error);
  if (status === 404) {
    return true;
  }
  return /\bnot found\b/i.test(message);
}
function buildProjectNotFoundError() {
  return new Error(PROJECT_NOT_FOUND_MESSAGE);
}
function throwProjectNotFoundIfNeeded(error) {
  if (isProjectNotFoundError(error)) {
    throw buildProjectNotFoundError();
  }
  throw error;
}
function shouldFallbackToAudioTranslationDetail(error) {
  const { message, status } = extractApiErrorInfo(error);
  if (status === 404) {
    return true;
  }
  return /translation not found/i.test(message);
}
var PROGRESS_FIELD_KEYS = /* @__PURE__ */ new Set([
  "processed_steps",
  "processedSteps",
  "progress"
]);
function stripProgressFields(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stripProgressFields(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !PROGRESS_FIELD_KEYS.has(key)).map(([key, entryValue]) => [key, stripProgressFields(entryValue)])
  );
}
async function fetchProjectDetail(options) {
  if (options.kind !== "translate_dub") {
    try {
      let response = await authorizedRequest2({
        apiBaseUrl: options.apiBaseUrl,
        path: `${DETAIL_KIND_TO_PATH[options.kind]}/${options.id}`
      });
      if (!options.skipSideEffects && options.kind === "translate_subtitles" && shouldInitCaptionSubtitles(response.data)) {
        await authorizedRequest2({
          apiBaseUrl: options.apiBaseUrl,
          body: {},
          method: "POST",
          path: `/v1/translate_captions/${options.id}/init_subtitles`
        });
        response = await authorizedRequest2({
          apiBaseUrl: options.apiBaseUrl,
          path: `${DETAIL_KIND_TO_PATH[options.kind]}/${options.id}`
        });
      }
      return { data: stripProgressFields(response.data), kind: options.kind };
    } catch (error) {
      throwProjectNotFoundIfNeeded(error);
    }
  }
  try {
    const response = await authorizedRequest2({
      apiBaseUrl: options.apiBaseUrl,
      path: `/v1/translations/${options.id}`
    });
    return { data: stripProgressFields(response.data), kind: "translate_dub" };
  } catch (error) {
    if (shouldFallbackToAudioTranslationDetail(error)) {
      try {
        const response = await authorizedRequest2({
          apiBaseUrl: options.apiBaseUrl,
          path: `/v1/audio_translations/${options.id}`
        });
        return {
          data: stripProgressFields(response.data),
          kind: "audio-translation"
        };
      } catch (fallbackError) {
        throwProjectNotFoundIfNeeded(fallbackError);
      }
    }
    throwProjectNotFoundIfNeeded(error);
  }
}
async function resolveDetailKind(options) {
  if (options.kind !== "translate_dub") {
    return options.kind;
  }
  return (await fetchProjectDetail(options)).kind;
}
function normalizeSummary(project, overrideKind) {
  let inferredKind = "unknown";
  if (overrideKind) {
    inferredKind = overrideKind;
  } else if (project.projectType) {
    const parsedKind = safeNormalizeKind(project.projectType);
    inferredKind = !parsedKind || parsedKind === "all" ? "unknown" : parsedKind;
  } else if (project.project_type) {
    const parsedKind = safeNormalizeKind(project.project_type);
    inferredKind = !parsedKind || parsedKind === "all" ? "unknown" : parsedKind;
  }
  const errorCode = project.errorCode ?? project.error_code ?? project.asr?.errorCode ?? null;
  const errorInfo = resolveProjectErrorInfo(errorCode);
  return enrichProjectLanguageLabels({
    createdAt: project.createdAt ?? project.created_at ?? null,
    duration: project.duration ?? project.estimatedDuration ?? project.estimated_duration ?? null,
    errorCode: errorInfo.errorCode,
    errorMessage: errorInfo.errorMessage,
    folderId: project.folderID ?? project.folder_id ?? null,
    id: project.pid ?? "",
    kind: inferredKind,
    originalLanguage: project.originalLanguage ?? project.original_language ?? null,
    processing: isProjectProcessing(inferredKind, project, project.status),
    status: inferredKind === "lipsync" || inferredKind === "talking-photo" ? resolveLipsyncEffectiveStatus(project, project.status) : project.status ?? null,
    targetLanguage: project.targetLanguage ?? project.target_language ?? null,
    targetLocale: project.targetLocale ?? project.target_locale ?? null,
    title: project.title ?? null,
    updatedAt: project.updatedAt ?? project.updated_at ?? null,
    webUrl: project.pid && inferredKind !== "unknown" ? buildProjectWebUrl(inferredKind, project.pid) : null
  });
}
async function authorizedRequest2(options) {
  const session = await requireAuthenticatedSession(options.apiBaseUrl);
  return requestJson({
    apiBaseUrl: session.apiBaseUrl,
    body: options.body,
    headers: {
      Authorization: `${session.tokenType} ${session.accessToken}`
    },
    method: options.method,
    path: options.path
  });
}
async function getAuthenticatedSession(apiBaseUrl) {
  return requireAuthenticatedSession(apiBaseUrl);
}
async function prepareUploadForProject(options) {
  const response = await authorizedRequest2({
    apiBaseUrl: options.apiBaseUrl,
    body: {},
    method: "POST",
    path: options.path
  });
  const uploadDir = response.data.uploadDir ?? response.data.upload_dir ?? "";
  const uploadBucket = response.data.uploadBucket ?? response.data.upload_bucket ?? "";
  return {
    uploadBucket,
    uploadDir
  };
}
function parseProjectKind(kind) {
  const normalized = normalizeKind(kind);
  if (normalized === "talking-photo") {
    throw new Error(
      "Talking photo projects are not managed by this CLI. Supported kinds: translate_dub, translate_subtitles, visual_translate, lipsync."
    );
  }
  return normalized;
}
function resolveProjectListNextCursor(options) {
  const { hasCursor, items, pageSize, totalCount } = options;
  if (items.length === 0) {
    return null;
  }
  const lastId = items.at(-1)?.id;
  if (!lastId) {
    return null;
  }
  const effectivePageSize = pageSize ?? items.length;
  if (items.length < effectivePageSize) {
    return null;
  }
  if (!hasCursor && totalCount != null && totalCount <= items.length) {
    return null;
  }
  return lastId;
}
var UNSUPPORTED_LIST_NOTICE = "Some projects were omitted from items because this CLI does not manage their type (e.g. talking photo, voice studio). totalCount is the server total and may exceed the sum of listable items across pages. Paginate with nextCursor; do not treat totalCount as the listable count.";
function buildCliProjectListPage(options) {
  const items = options.pageItems.filter(
    (item) => CLI_LISTABLE_KINDS.has(item.kind)
  );
  const skippedUnsupportedCount = options.pageItems.length - items.length;
  return {
    folderId: options.folderId,
    items,
    kind: options.kind,
    nextCursor: resolveProjectListNextCursor({
      hasCursor: options.hasCursor,
      items: options.pageItems,
      pageSize: options.pageSize,
      totalCount: options.totalCount
    }),
    notice: skippedUnsupportedCount > 0 ? UNSUPPORTED_LIST_NOTICE : null,
    pageSize: options.pageSize,
    searchKey: options.searchKey,
    skippedUnsupportedCount,
    totalCount: options.totalCount
  };
}
async function listProjects(options) {
  const projectType = options.kind === "all" ? void 0 : LIST_KIND_TO_QUERY_TYPE[options.kind];
  const response = await authorizedRequest2({
    apiBaseUrl: options.apiBaseUrl,
    path: buildQueryPath("/v1/voice_projects", {
      cursor: options.cursor ?? "",
      folder_id: options.folderId ?? "",
      page_size: options.limit ?? 20,
      project_type: projectType,
      search_key: options.searchKey ?? ""
    })
  });
  const pageItems = (response.data.items ?? []).map((item) => {
    const summary = normalizeSummary(
      item,
      options.kind === "all" ? void 0 : options.kind
    );
    if (summary.kind === "lipsync" && isTalkingPhotoLipsyncItem(item)) {
      return { ...summary, kind: "talking-photo" };
    }
    return summary;
  });
  const pageSize = response.data.pageSize ?? response.data.page_size ?? options.limit ?? null;
  const totalCount = response.data.totalCount ?? response.data.total_count ?? null;
  return buildCliProjectListPage({
    folderId: options.folderId ?? null,
    hasCursor: Boolean(options.cursor),
    kind: options.kind,
    pageItems,
    pageSize,
    searchKey: options.searchKey ?? "",
    totalCount
  });
}
async function getProject(options) {
  const { data, kind } = await fetchProjectDetail({
    apiBaseUrl: options.apiBaseUrl,
    id: options.id,
    kind: options.kind
  });
  return {
    project: {
      ...normalizeSummary(
        {
          ...data,
          pid: data.pid ?? options.id,
          projectType: data.projectType ?? data.project_type ?? kind.replaceAll("-", "_")
        },
        kind
      ),
      raw: data
    }
  };
}
async function exportProject(options) {
  const projectDetail = await getProject({
    apiBaseUrl: options.apiBaseUrl,
    id: options.id,
    kind: options.kind
  });
  const resolvedKind = projectDetail.project.kind;
  const artifact = resolveExportArtifactForKind(resolvedKind, options.artifact);
  assertProjectNotCurrentlyExporting({
    id: options.id,
    status: resolveProjectExportGuardStatus(
      resolvedKind,
      projectDetail.project.raw,
      projectDetail.project.status
    )
  });
  assertProjectNotFailedForArtifactAccess({
    id: options.id,
    kind: resolvedKind,
    rawProject: projectDetail.project.raw,
    status: projectDetail.project.status
  });
  assertProjectReadyForExport({
    id: options.id,
    kind: resolvedKind,
    project: projectDetail.project
  });
  const existingDownloadUrl = resolveArtifactSourceUrl(
    resolvedKind,
    artifact,
    projectDetail.project.raw
  );
  if (existingDownloadUrl) {
    return {
      artifact,
      downloadUrl: existingDownloadUrl,
      estimatedDuration: null,
      id: options.id,
      kind: resolvedKind,
      project: projectDetail.project,
      status: "already_exported"
    };
  }
  const response = await authorizedRequest2({
    apiBaseUrl: options.apiBaseUrl,
    body: buildExportRequestBody(
      resolvedKind,
      artifact,
      projectDetail.project.raw
    ),
    method: "POST",
    path: `${DETAIL_KIND_TO_PATH[resolvedKind]}/${options.id}/exports`
  });
  const estimatedDuration = response.data.estimatedDuration ?? response.data.estimated_duration ?? null;
  const refreshedProject = await getProject({
    apiBaseUrl: options.apiBaseUrl,
    id: options.id,
    kind: resolvedKind
  });
  return {
    artifact,
    downloadUrl: null,
    estimatedDuration,
    id: options.id,
    kind: resolvedKind,
    project: refreshedProject.project,
    status: "started"
  };
}
function buildMediaArtifactFileNameBase(artifact, project) {
  const title = sanitizeFileNameSegment(project.title ?? "project");
  switch (artifact) {
    case "dubbed_video":
    case "dubbed_audio":
    case "dubbed_audio_mp3":
    case "translation_subtitle":
    case "visual_translation": {
      const language = project.targetLanguageLabel ? `${sanitizeFileNameSegment(project.targetLanguageLabel)}_` : "";
      return `${title}_${language}translated`;
    }
    default:
      return `${title}_${artifact}`;
  }
}
async function isDirectoryOutputPath(outputPath) {
  if (outputPath.endsWith("/") || outputPath.endsWith(path4.sep)) {
    return true;
  }
  try {
    return (await stat2(outputPath)).isDirectory();
  } catch {
    return false;
  }
}
async function downloadProjectArtifact(options) {
  const checkOnly = Boolean(options.checkOnly);
  const projectDetail = await getProject({
    apiBaseUrl: options.apiBaseUrl,
    id: options.id,
    kind: options.kind
  });
  const resolvedKind = projectDetail.project.kind;
  const artifact = resolveArtifactTypeForKind(
    resolvedKind,
    parseArtifactType(options.artifact)
  );
  assertProjectNotFailedForArtifactAccess({
    id: options.id,
    kind: resolvedKind,
    rawProject: projectDetail.project.raw,
    status: projectDetail.project.status
  });
  assertProjectNotAwaitingProofreadingForDownload({
    id: options.id,
    kind: resolvedKind,
    rawProject: projectDetail.project.raw,
    status: projectDetail.project.status
  });
  if (isSubtitleArtifact(artifact)) {
    const { format, language } = parseSubtitleArtifact(artifact);
    const sections = extractSubtitleSections(
      resolvedKind,
      projectDetail.project.raw,
      language
    );
    if (!sections.some((section) => section.text.trim())) {
      throw new Error(
        `Project ${options.id} does not have any ${language} subtitle content to export yet.`
      );
    }
    if (checkOnly) {
      return {
        artifact,
        contentType: "text/plain;charset=utf-8",
        downloadedUrl: "generated-locally",
        id: options.id,
        kind: resolvedKind,
        outputPath: null,
        sourceUrl: "generated-locally",
        verified: true
      };
    }
    if (!options.outputPath) {
      throw new Error(
        "An --output path is required to download this artifact."
      );
    }
    const content = generateSubtitleContent(sections, format);
    const defaultFileName = buildSubtitleFileName({
      format,
      language,
      targetLanguage: projectDetail.project.targetLanguage,
      title: projectDetail.project.title
    });
    const resolvedOutputPath2 = await isDirectoryOutputPath(options.outputPath) ? path4.join(options.outputPath, defaultFileName) : inferSubtitleOutputPath(options.outputPath, format);
    await mkdir2(path4.dirname(resolvedOutputPath2), { recursive: true });
    await writeFile3(resolvedOutputPath2, content, "utf8");
    return {
      artifact,
      contentType: "text/plain;charset=utf-8",
      downloadedUrl: resolvedOutputPath2,
      id: options.id,
      kind: resolvedKind,
      outputPath: resolvedOutputPath2,
      sourceUrl: "generated-locally"
    };
  }
  const sourceUrl = resolveArtifactSourceUrl(
    resolvedKind,
    artifact,
    projectDetail.project.raw
  );
  if (!sourceUrl) {
    throw new Error(
      `Project ${options.id} does not have a downloadable \`${artifact}\` artifact yet.`
    );
  }
  const session = await getAuthenticatedSession(options.apiBaseUrl);
  const authHeaders = {
    Authorization: `${session.tokenType} ${session.accessToken}`
  };
  if (checkOnly) {
    let probe = await requestDownloadProbe({
      apiBaseUrl: session.apiBaseUrl,
      headers: buildArtifactRequestHeaders(
        sourceUrl,
        session.apiBaseUrl,
        authHeaders
      ),
      path: sourceUrl
    });
    if (probe.contentType?.includes("application/json")) {
      const nestedUrl = extractNestedDownloadUrl(probe.json);
      if (!nestedUrl) {
        throw new Error(
          `Download endpoint for project ${options.id} returned JSON without a file URL.`
        );
      }
      probe = await requestDownloadProbe({
        apiBaseUrl: session.apiBaseUrl,
        headers: buildArtifactRequestHeaders(
          nestedUrl,
          session.apiBaseUrl,
          authHeaders
        ),
        path: nestedUrl
      });
    }
    return {
      artifact,
      contentLength: probe.contentLength,
      contentType: probe.contentType,
      downloadedUrl: probe.url || sourceUrl,
      id: options.id,
      kind: resolvedKind,
      outputPath: null,
      sourceUrl,
      verified: true
    };
  }
  if (!options.outputPath) {
    throw new Error("An --output path is required to download this artifact.");
  }
  let downloadResponse = await requestDownload({
    apiBaseUrl: session.apiBaseUrl,
    headers: buildArtifactRequestHeaders(
      sourceUrl,
      session.apiBaseUrl,
      authHeaders
    ),
    path: sourceUrl
  });
  let contentType = downloadResponse.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    const payload = JSON.parse(await downloadResponse.text());
    const nestedUrl = extractNestedDownloadUrl(payload);
    if (!nestedUrl) {
      throw new Error(
        `Download endpoint for project ${options.id} returned JSON without a file URL.`
      );
    }
    downloadResponse = await requestDownload({
      apiBaseUrl: session.apiBaseUrl,
      headers: buildArtifactRequestHeaders(
        nestedUrl,
        session.apiBaseUrl,
        authHeaders
      ),
      path: nestedUrl
    });
    contentType = downloadResponse.headers.get("content-type");
  }
  const dispositionFilename = parseContentDispositionFilename(
    downloadResponse.headers.get("content-disposition")
  );
  const mediaOutputPath = await isDirectoryOutputPath(options.outputPath) ? path4.join(
    options.outputPath,
    dispositionFilename ? path4.basename(dispositionFilename) : buildMediaArtifactFileNameBase(artifact, projectDetail.project)
  ) : options.outputPath;
  const resolvedOutputPath = inferOutputPath({
    artifact,
    contentType,
    dispositionFilename,
    outputPath: mediaOutputPath,
    sourceUrl: downloadResponse.url || sourceUrl
  });
  await mkdir2(path4.dirname(resolvedOutputPath), { recursive: true });
  await downloadResponse.saveToFile(resolvedOutputPath);
  return {
    artifact,
    contentType,
    downloadedUrl: downloadResponse.url,
    id: options.id,
    kind: resolvedKind,
    outputPath: resolvedOutputPath,
    sourceUrl
  };
}
async function openProject(options) {
  const resolvedKind = await resolveDetailKind({
    id: options.id,
    kind: options.kind
  });
  const url = buildProjectOpenUrl(resolvedKind, options.id);
  return {
    id: options.id,
    kind: resolvedKind,
    url
  };
}
async function getProjectTypeForDelete(options) {
  const kinds = [
    "translate_dub",
    "translate_subtitles",
    "visual_translate",
    "lipsync"
  ];
  let lastError;
  for (const kind of kinds) {
    try {
      const { data, kind: resolvedKind } = await fetchProjectDetail({
        apiBaseUrl: options.apiBaseUrl,
        id: options.id,
        kind,
        skipSideEffects: true
      });
      const projectType = readString4(data.projectType ?? data.project_type);
      if (projectType) {
        return projectType;
      }
      return LIST_KIND_TO_QUERY_TYPE[resolvedKind];
    } catch (error) {
      lastError = error;
      if (!isProjectNotFoundError(error)) {
        throw error;
      }
    }
  }
  throwProjectNotFoundIfNeeded(lastError ?? buildProjectNotFoundError());
}
async function deleteProjects(options) {
  const ids = options.ids.map((id) => id.trim()).filter(Boolean);
  if (!ids.length) {
    throw new Error("At least one project ID is required.");
  }
  await requireUserPermission({
    action: "delete projects",
    apiBaseUrl: options.apiBaseUrl,
    permissionKeys: [USER_PERMISSIONS.deleteProject]
  });
  const projectTypes = await Promise.all(
    ids.map(
      (id) => getProjectTypeForDelete({
        apiBaseUrl: options.apiBaseUrl,
        id
      })
    )
  );
  const response = await authorizedRequest2({
    apiBaseUrl: options.apiBaseUrl,
    body: compactJsonObject({
      delete_all: false,
      folder_id: "",
      project_type: "",
      projects: ids.map((pid, index) => ({
        pid,
        project_type: projectTypes[index]
      })),
      search_key: ""
    }),
    method: "POST",
    path: "/v1/voice_project_folders/batch_delete"
  });
  return {
    requestedIds: ids,
    result: response.data ?? null,
    status: "ok"
  };
}
async function listProjectFolders(options) {
  const response = await authorizedRequest2({
    apiBaseUrl: options?.apiBaseUrl,
    path: buildQueryPath("/v1/voice_projects", {
      cursor: "",
      folder_id: "",
      page_size: 1,
      search_key: ""
    })
  });
  return {
    folders: (response.data.folders ?? []).map(normalizeFolder)
  };
}
function findProjectFolderByExactName(folders, folderName) {
  const normalized = folderName.trim();
  if (!normalized) {
    return null;
  }
  return folders.find((folder) => folder.folderName === normalized) ?? null;
}
function assertReviewerCannotCreateProjectFolder(profile) {
  if (profile.teamSpace?.teamRole === "reviewer") {
    throw new Error(
      "Reviewers cannot create folders. Ask a team editor or owner to create one, or use `vozo-cli project folder search` to find an existing folder."
    );
  }
}
async function createProjectFolder(options) {
  const folderName = String(options.folderName ?? "").trim();
  if (!folderName) {
    throw new Error("Folder name is required.");
  }
  if (folderName.length > 100) {
    throw new Error("Folder name must be 100 characters or fewer.");
  }
  const profile = await getUserProfile(options.apiBaseUrl);
  assertReviewerCannotCreateProjectFolder(profile);
  const { folders } = await listProjectFolders(options);
  const existingFolder = findProjectFolderByExactName(folders, folderName);
  if (existingFolder) {
    throw new Error(
      `A folder named \`${folderName}\` already exists (folderId: ${existingFolder.folderId}). Use \`vozo-cli project folder search "${folderName}"\` to find it.`
    );
  }
  const response = await authorizedRequest2({
    apiBaseUrl: options.apiBaseUrl,
    body: { folderName },
    method: "POST",
    path: "/v1/voice_project_folders"
  });
  const folderId = response.data.folderID ?? response.data.folder_id ?? "";
  if (!folderId) {
    throw new Error(
      "Folder was created but the API response did not include folderId."
    );
  }
  return {
    folder: {
      folderId,
      folderName,
      projectCount: 0,
      thumbUrls: []
    },
    status: "created"
  };
}
function filterProjectFolders(folders, query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return folders;
  }
  return folders.filter(
    (folder) => folder.folderName.toLowerCase().includes(normalized)
  );
}
async function searchProjectFolders(options) {
  const query = String(options.query ?? "").trim();
  const { folders } = await listProjectFolders(options);
  return {
    folders: filterProjectFolders(folders, query),
    query
  };
}
function findProjectFolderById(folders, folderId) {
  const normalized = folderId.trim();
  if (!normalized) {
    return null;
  }
  return folders.find((folder) => folder.folderId === normalized) ?? null;
}
async function resolveProjectFolderId(options) {
  const folderId = options.folderId?.trim();
  const folderName = options.folderName?.trim();
  if (folderId) {
    if (folderName) {
      throw new Error("Use either `--folder` or `--folder-name`, not both.");
    }
    const { folders: folders2 } = await listProjectFolders(options);
    if (!findProjectFolderById(folders2, folderId)) {
      throw new Error(
        `No folder found with id \`${folderId}\`. Run \`vozo-cli project folder list\` to see available folders.`
      );
    }
    return folderId;
  }
  if (!folderName) {
    return void 0;
  }
  const { folders } = await listProjectFolders(options);
  const normalized = folderName.toLowerCase();
  const exactMatches = folders.filter(
    (folder) => folder.folderName.toLowerCase() === normalized
  );
  if (exactMatches.length === 1) {
    return exactMatches[0].folderId;
  }
  const partialMatches = filterProjectFolders(folders, folderName);
  if (partialMatches.length === 1) {
    return partialMatches[0].folderId;
  }
  if (partialMatches.length > 1) {
    const names = partialMatches.map((folder) => `${folder.folderName} (${folder.folderId})`).join(", ");
    throw new Error(
      `Multiple folders match \`${folderName}\`: ${names}. Use \`project folder search\` or \`--folder <folderId>\` instead.`
    );
  }
  throw new Error(
    `No folder found matching \`${folderName}\`. Run \`project folder list\` to see available folders.`
  );
}
async function resolveValidatedProjectFolderId(options) {
  return resolveProjectFolderId({
    apiBaseUrl: options.apiBaseUrl,
    folderId: options.folderId
  });
}
async function resolveVideoFromUrl(apiBaseUrl, sourceUrl) {
  const response = await authorizedRequest2({
    apiBaseUrl,
    path: buildQueryPath("/v1/video_spider/video_link", {
      from: "cli",
      url: sourceUrl
    })
  });
  return response.data;
}
function readVideoDimensionsFromRecord(source) {
  const record = asRecord3(source);
  const width = Number(record.width ?? record.Width);
  const height = Number(record.height ?? record.Height);
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return { height, width };
  }
  const extra = readString4(record.extra);
  if (extra) {
    try {
      const parsed = JSON.parse(extra);
      const extraWidth = Number(parsed.width ?? parsed.Width);
      const extraHeight = Number(parsed.height ?? parsed.Height);
      if (Number.isFinite(extraWidth) && extraWidth > 0 && Number.isFinite(extraHeight) && extraHeight > 0) {
        return { height: extraHeight, width: extraWidth };
      }
    } catch {
    }
  }
  return null;
}
function buildLipsyncCreateGuardItem(options) {
  const dimensions = (options.video ? readVideoDimensionsFromRecord(options.video) : null) ?? (options.rawProject ? readVideoDimensionsFromRecord(options.rawProject) : null);
  return {
    durationSeconds: options.durationSeconds ?? null,
    filePath: options.filePath,
    height: dimensions?.height ?? null,
    width: dimensions?.width ?? null
  };
}
function resolveSpeakerRange(speakerNumber = "Auto") {
  const speakerMap = {
    "1": [1, 1],
    "2": [2, 2],
    "3+": [3, 35],
    Auto: [1, 35]
  };
  return speakerMap[speakerNumber] ?? speakerMap.Auto;
}
async function createTranslationProjectFromUrl(options) {
  const { targetLanguage, targetLocale } = resolveCreateTargetLanguageAndLocale(
    {
      kind: "translate_dub",
      targetLanguage: options.targetLanguage
    }
  );
  const folderId = await resolveValidatedProjectFolderId({
    apiBaseUrl: options.apiBaseUrl,
    folderId: options.folderId
  });
  const resolvedApiBaseUrl = getApiBaseUrl(options.apiBaseUrl);
  const video = await resolveVideoFromUrl(
    resolvedApiBaseUrl,
    options.sourceUrl
  );
  const resolvedDuration = Number(video.duration);
  const entitlements = await assertCreateAllowed({
    apiBaseUrl: resolvedApiBaseUrl,
    enableSubtitles: options.enableSubtitles,
    glossaryIdList: options.glossaryIdList,
    items: [{ durationSeconds: resolvedDuration }],
    kind: "translate_dub",
    proofreadBeforeDubbing: options.proofreadBeforeDubbing,
    removeOriginalSubtitle: options.removeOriginalSubtitle,
    userPrompt: options.userPrompt
  });
  const firstUserClip = await resolveFirstTranslateDubClipInterval({
    apiBaseUrl: resolvedApiBaseUrl,
    durationSeconds: resolvedDuration,
    enableSubtitles: options.enableSubtitles,
    entitlements,
    removeOriginalSubtitle: options.removeOriginalSubtitle
  });
  const durationForCreate = firstUserClip?.durationSeconds ?? resolvedDuration;
  const speakerNumber = options.speakerNumber ?? "Auto";
  const [minSpeakerNumber, maxSpeakerNumber] = resolveSpeakerRange(speakerNumber);
  const title = getPreferredTitle(video, "Translation Project");
  const extension = getVideoExtension(video);
  const createResponse = await authorizedRequest2({
    apiBaseUrl: resolvedApiBaseUrl,
    body: compactJsonObject({
      extension,
      thumb_url: getPreferredThumbnailUrl(video),
      title
    }),
    method: "POST",
    path: "/v1/translations"
  });
  await authorizedRequest2({
    apiBaseUrl: resolvedApiBaseUrl,
    body: compactJsonObject({
      audio_duration: durationForCreate,
      auto_align_video: options.autoAlignVideo,
      auto_pause_alignment: false,
      clip_interval: firstUserClip?.clipInterval,
      dub_preference: options.dubPreference ?? "auto",
      dubbing_model: "real",
      enable_subtitles: options.enableSubtitles,
      folder_id: folderId,
      glossary_id_list: options.glossaryIdList ?? [],
      max_speaker_number: maxSpeakerNumber,
      min_speaker_number: minSpeakerNumber,
      original_language: options.originalLanguage ?? "auto",
      original_url: video.originURL ?? video.origin_url ?? options.sourceUrl,
      platform: video.platform,
      proofread_before_dubbing: options.proofreadBeforeDubbing ?? false,
      remove_original_subtitle: options.enableSubtitles ? options.removeOriginalSubtitle ?? false : void 0,
      target_language: targetLanguage,
      target_locale: targetLocale,
      title,
      uploaded_file_path: createResponse.data.uploadPath ?? createResponse.data.upload_path,
      user_prompt: options.userPrompt ?? "",
      video_duration: durationForCreate,
      video_url: getPreferredVideoUrl(video, options.sourceUrl)
    }),
    method: "POST",
    path: `/v1/translations/${createResponse.data.pid}/link_translate`
  });
  const clip = firstUserClip?.clipInterval && Number.isFinite(resolvedDuration) ? {
    originalDurationSeconds: resolvedDuration,
    durationSeconds: durationForCreate,
    clipInterval: firstUserClip.clipInterval,
    reason: "insufficient_points_first_time"
  } : null;
  return {
    id: createResponse.data.pid,
    kind: "translate_dub",
    status: "started",
    title,
    webUrl: buildProjectWebUrl("translate_dub", createResponse.data.pid),
    clip,
    warnings: clip ? [buildFirstTimeClipWarning(clip)] : []
  };
}
async function createTranslationProjectFromFile(options) {
  const { targetLanguage, targetLocale } = resolveCreateTargetLanguageAndLocale(
    {
      kind: "translate_dub",
      targetLanguage: options.targetLanguage
    }
  );
  const folderId = await resolveValidatedProjectFolderId({
    apiBaseUrl: options.apiBaseUrl,
    folderId: options.folderId
  });
  assertSupportedLocalMediaFile(options.filePath);
  const mediaType = inferLocalMediaType(options.filePath);
  if (mediaType !== "video" && mediaType !== "audio") {
    throw new Error(
      "Translation file create supports local video or audio files only."
    );
  }
  const isAudio = mediaType === "audio";
  if (isAudio && (options.enableSubtitles || options.removeOriginalSubtitle || options.autoAlignVideo || options.subtitleFilePath)) {
    throw new Error(
      "Subtitle and video-alignment options apply only to video sources. Omit --enable-subtitles, --remove-original-subtitle, --auto-align-video, and --subtitle-file when uploading audio."
    );
  }
  const duration = await getLocalMediaDuration(options.filePath);
  if (options.subtitleFilePath) {
    await assertSubtitleFileForTranslation({
      subtitleFilePath: options.subtitleFilePath,
      videoDurationSeconds: duration
    });
  }
  const entitlements = await assertCreateAllowed({
    apiBaseUrl: options.apiBaseUrl,
    enableSubtitles: options.enableSubtitles,
    glossaryIdList: options.glossaryIdList,
    hasSubtitleFile: Boolean(options.subtitleFilePath),
    items: [{ durationSeconds: duration, filePath: options.filePath }],
    kind: "translate_dub",
    proofreadBeforeDubbing: options.proofreadBeforeDubbing,
    removeOriginalSubtitle: options.removeOriginalSubtitle,
    userPrompt: options.userPrompt
  });
  const firstUserClip = await resolveFirstTranslateDubClipInterval({
    apiBaseUrl: options.apiBaseUrl,
    durationSeconds: duration,
    enableSubtitles: options.enableSubtitles,
    entitlements,
    removeOriginalSubtitle: options.removeOriginalSubtitle
  });
  const durationForCreate = firstUserClip?.durationSeconds ?? duration;
  const extension = getLocalFileExtension(options.filePath) || (isAudio ? "mp3" : "mp4");
  const title = resolveProjectTitle(getLocalFileTitle(options.filePath));
  const [minSpeakerNumber, maxSpeakerNumber] = resolveSpeakerRange(
    options.speakerNumber ?? "Auto"
  );
  const apiPrefix = isAudio ? "/v1/audio_translations" : "/v1/translations";
  const detailKind = isAudio ? "audio-translation" : "translate_dub";
  const resultKind = isAudio ? "audio-translation" : "translate_dub";
  const createResponse = await authorizedRequest2({
    apiBaseUrl: options.apiBaseUrl,
    body: compactJsonObject({
      extension,
      title
    }),
    method: "POST",
    path: apiPrefix
  });
  const bucketName = createResponse.data.uploadBucket ?? createResponse.data.upload_bucket;
  const uploadPath = createResponse.data.uploadPath ?? createResponse.data.upload_path;
  if (!bucketName || !uploadPath) {
    throw new Error(
      "The create API response did not include an upload bucket/path for the media file."
    );
  }
  await uploadSingleLocalFile({
    apiBaseUrl: options.apiBaseUrl,
    bucketName,
    filePath: options.filePath,
    uploadPath
  });
  let uploadedSubtitlePath = "";
  let subtitleUseAsOriginal;
  if (options.subtitleFilePath) {
    uploadedSubtitlePath = await uploadSubtitleFileForTranslation({
      apiBaseUrl: options.apiBaseUrl,
      bucketName,
      createInfo: createResponse.data,
      subtitleFilePath: options.subtitleFilePath
    });
    subtitleUseAsOriginal = (options.subtitleUsage ?? "original") === "original";
  }
  await authorizedRequest2({
    apiBaseUrl: options.apiBaseUrl,
    body: compactJsonObject({
      audio_duration: durationForCreate,
      auto_pause_alignment: false,
      clip_interval: firstUserClip?.clipInterval,
      dub_preference: options.dubPreference ?? "auto",
      dubbing_model: "real",
      folder_id: folderId,
      glossary_id_list: options.glossaryIdList ?? [],
      max_speaker_number: maxSpeakerNumber,
      min_speaker_number: minSpeakerNumber,
      original_language: options.originalLanguage ?? "auto",
      proofread_before_dubbing: options.proofreadBeforeDubbing ?? false,
      target_language: targetLanguage,
      target_locale: targetLocale,
      title,
      uploaded_file_path: createResponse.data.uploadPath ?? createResponse.data.upload_path,
      uploaded_subtitle_path: uploadedSubtitlePath,
      subtitle_use_as_original: subtitleUseAsOriginal,
      user_prompt: options.userPrompt ?? "",
      video_duration: durationForCreate,
      ...isAudio ? {} : {
        auto_align_video: options.autoAlignVideo,
        enable_subtitles: options.enableSubtitles,
        remove_original_subtitle: options.enableSubtitles ? options.removeOriginalSubtitle ?? false : void 0
      }
    }),
    method: "POST",
    path: `${apiPrefix}/${createResponse.data.pid}/translate`
  });
  const clip = firstUserClip?.clipInterval && Number.isFinite(duration) ? {
    originalDurationSeconds: duration,
    durationSeconds: durationForCreate,
    clipInterval: firstUserClip.clipInterval,
    reason: "insufficient_points_first_time"
  } : null;
  return {
    id: createResponse.data.pid,
    kind: resultKind,
    status: "started",
    title,
    webUrl: buildProjectWebUrl(detailKind, createResponse.data.pid),
    clip,
    warnings: clip ? [buildFirstTimeClipWarning(clip)] : []
  };
}
async function batchCreateTranslationProjectsFromFiles(options) {
  const { targetLanguage, targetLocale } = resolveCreateTargetLanguageAndLocale(
    {
      kind: "translate_dub",
      targetLanguage: options.targetLanguage
    }
  );
  const folderId = await resolveValidatedProjectFolderId({
    apiBaseUrl: options.apiBaseUrl,
    folderId: options.folderId
  });
  const isAudio = resolveBatchTranslationMediaType(options.filePaths) === "audio";
  if (isAudio && (options.enableSubtitles || options.removeOriginalSubtitle || options.autoAlignVideo)) {
    throw new Error(
      "Subtitle and video-alignment options apply only to video sources. Omit --enable-subtitles, --remove-original-subtitle, and --auto-align-video when uploading audio."
    );
  }
  const session = await getAuthenticatedSession(options.apiBaseUrl);
  const prepared = await prepareBatchFilePathsForCreate({
    apiBaseUrl: session.apiBaseUrl,
    filePaths: options.filePaths,
    kind: "translate_dub"
  });
  await assertCreateAllowed({
    apiBaseUrl: session.apiBaseUrl,
    enableSubtitles: options.enableSubtitles,
    glossaryIdList: options.glossaryIdList,
    items: prepared.filePaths.map((filePath) => ({ filePath })),
    kind: "translate_dub",
    proofreadBeforeDubbing: options.proofreadBeforeDubbing,
    removeOriginalSubtitle: options.removeOriginalSubtitle,
    userPrompt: options.userPrompt
  });
  const userRegion = await getUserStorageRegion(session.apiBaseUrl);
  const bucketName = getTempBucketName(userRegion);
  const uploadedFiles = await createBatchUploadEntries({
    apiBaseUrl: session.apiBaseUrl,
    bucketName,
    filePaths: prepared.filePaths,
    userRegion
  });
  const apiPrefix = isAudio ? "/v1/audio_translations" : "/v1/translations";
  const response = await authorizedRequest2({
    apiBaseUrl: session.apiBaseUrl,
    body: compactJsonObject({
      auto_pause_alignment: false,
      dub_preference: options.dubPreference ?? "auto",
      dubbing_model: "real",
      folder_id: folderId,
      glossary_id_list: options.glossaryIdList ?? [],
      ocr_text_box: null,
      original_language: options.originalLanguage ?? "auto",
      proofread_before_dubbing: options.proofreadBeforeDubbing ?? false,
      target_language: targetLanguage,
      target_locale: targetLocale ?? "",
      uploaded_bucket: bucketName,
      uploaded_files: uploadedFiles,
      user_prompt: options.userPrompt ?? "",
      ...isAudio ? {} : {
        auto_align_video: options.autoAlignVideo,
        enable_subtitles: options.enableSubtitles,
        remove_original_subtitle: options.enableSubtitles ? options.removeOriginalSubtitle ?? false : void 0
      }
    }),
    method: "POST",
    path: `${apiPrefix}/batch_translate`
  });
  return buildBatchCreateResult({
    ids: response.data.pids ?? [],
    kind: isAudio ? "audio-translation" : "translate_dub",
    skippedFiles: prepared.skippedFiles,
    warnings: prepared.warnings
  });
}
async function createCaptionProjectFromUrl(options) {
  const { targetLanguage, targetLocale } = resolveCreateTargetLanguageAndLocale(
    {
      kind: "translate_subtitles",
      targetLanguage: options.targetLanguage
    }
  );
  const folderId = await resolveValidatedProjectFolderId({
    apiBaseUrl: options.apiBaseUrl,
    folderId: options.folderId
  });
  const session = await getAuthenticatedSession(options.apiBaseUrl);
  const video = await resolveVideoFromUrl(
    session.apiBaseUrl,
    options.sourceUrl
  );
  await assertCreateAllowed({
    apiBaseUrl: session.apiBaseUrl,
    glossaryIdList: options.glossaryIdList,
    items: [{ durationSeconds: Number(video.duration) }],
    kind: "translate_subtitles",
    removeOriginalSubtitle: options.removeOriginalSubtitle,
    userPrompt: options.userPrompt
  });
  const preparedUpload = await prepareUploadForProject({
    apiBaseUrl: session.apiBaseUrl,
    path: "/v1/translate_captions/upload_prepare"
  });
  const title = getPreferredTitle(video, "Subtitle Translation Project");
  const uploadVideoPath = buildPreparedUploadPath(
    preparedUpload.uploadDir,
    getVideoExtension(video)
  );
  const response = await authorizedRequest2({
    apiBaseUrl: session.apiBaseUrl,
    body: compactJsonObject({
      country_code: getCountryCodeFromToken(session.accessToken),
      creation_source: "link",
      folder_id: folderId,
      glossary_id_list: options.glossaryIdList ?? [],
      original_language: options.originalLanguage ?? "auto",
      original_url: video.originURL ?? video.origin_url ?? options.sourceUrl,
      platform: video.platform,
      remove_original_subtitle: options.removeOriginalSubtitle ?? false,
      subtitle_display_type: options.subtitleDisplayType ?? "translated_only",
      subtitle_use_as_original: false,
      target_language: targetLanguage,
      target_locale: targetLocale,
      thumb_url: getPreferredThumbnailUrl(video),
      title,
      uploaded_subtitle_path: "",
      uploaded_video_path: uploadVideoPath,
      user_prompt: options.userPrompt ?? "",
      video_duration: Number(video.duration),
      video_url: getPreferredVideoUrl(video, options.sourceUrl)
    }),
    method: "POST",
    path: "/v1/translate_captions"
  });
  const id = response.data.translation?.pid ?? "";
  return {
    id,
    kind: "translate_subtitles",
    status: "started",
    title,
    webUrl: buildProjectWebUrl("translate_subtitles", id)
  };
}
async function createCaptionProjectFromFile(options) {
  const { targetLanguage, targetLocale } = resolveCreateTargetLanguageAndLocale(
    {
      kind: "translate_subtitles",
      targetLanguage: options.targetLanguage
    }
  );
  const folderId = await resolveValidatedProjectFolderId({
    apiBaseUrl: options.apiBaseUrl,
    folderId: options.folderId
  });
  assertSupportedLocalMediaFile(options.filePath);
  const mediaType = inferLocalMediaType(options.filePath);
  if (mediaType !== "video") {
    throw new Error(
      "Caption file create currently supports local video files only."
    );
  }
  const duration = await getLocalMediaDuration(options.filePath);
  if (options.subtitleFilePath) {
    await assertSubtitleFileForTranslation({
      subtitleFilePath: options.subtitleFilePath,
      videoDurationSeconds: duration
    });
  }
  await assertCreateAllowed({
    apiBaseUrl: options.apiBaseUrl,
    glossaryIdList: options.glossaryIdList,
    hasSubtitleFile: Boolean(options.subtitleFilePath),
    items: [{ durationSeconds: duration, filePath: options.filePath }],
    kind: "translate_subtitles",
    removeOriginalSubtitle: options.removeOriginalSubtitle,
    userPrompt: options.userPrompt
  });
  const session = await getAuthenticatedSession(options.apiBaseUrl);
  const preparedUpload = await prepareUploadForProject({
    apiBaseUrl: session.apiBaseUrl,
    path: "/v1/translate_captions/upload_prepare"
  });
  const extension = getLocalFileExtension(options.filePath) || "mp4";
  const title = resolveProjectTitle(getLocalFileTitle(options.filePath));
  const uploadVideoPath = buildPreparedUploadPath(
    preparedUpload.uploadDir,
    extension
  );
  await uploadSingleLocalFile({
    apiBaseUrl: session.apiBaseUrl,
    bucketName: preparedUpload.uploadBucket,
    filePath: options.filePath,
    uploadPath: uploadVideoPath
  });
  let uploadedSubtitlePath = "";
  let subtitleUseAsOriginal = false;
  if (options.subtitleFilePath) {
    const subtitleExtension = getLocalFileExtension(options.subtitleFilePath) || "srt";
    uploadedSubtitlePath = buildPreparedSubtitleUploadPath(
      preparedUpload.uploadDir,
      subtitleExtension
    );
    await uploadSingleLocalFile({
      apiBaseUrl: session.apiBaseUrl,
      bucketName: preparedUpload.uploadBucket,
      filePath: options.subtitleFilePath,
      uploadPath: uploadedSubtitlePath
    });
    subtitleUseAsOriginal = (options.subtitleUsage ?? "original") === "original";
  }
  const response = await authorizedRequest2({
    apiBaseUrl: session.apiBaseUrl,
    body: compactJsonObject({
      country_code: getCountryCodeFromToken(session.accessToken),
      creation_source: "file",
      folder_id: folderId,
      glossary_id_list: options.glossaryIdList ?? [],
      original_language: options.originalLanguage ?? "auto",
      remove_original_subtitle: options.removeOriginalSubtitle ?? false,
      subtitle_display_type: options.subtitleDisplayType ?? "translated_only",
      subtitle_use_as_original: subtitleUseAsOriginal,
      target_language: targetLanguage,
      target_locale: targetLocale,
      title,
      uploaded_subtitle_path: uploadedSubtitlePath,
      uploaded_video_path: uploadVideoPath,
      user_prompt: options.userPrompt ?? "",
      video_duration: duration
    }),
    method: "POST",
    path: "/v1/translate_captions"
  });
  const id = response.data.translation?.pid ?? "";
  return {
    id,
    kind: "translate_subtitles",
    status: "started",
    title,
    webUrl: buildProjectWebUrl("translate_subtitles", id)
  };
}
async function batchCreateCaptionProjectsFromFiles(options) {
  const { targetLanguage, targetLocale } = resolveCreateTargetLanguageAndLocale(
    {
      kind: "translate_subtitles",
      targetLanguage: options.targetLanguage
    }
  );
  const folderId = await resolveValidatedProjectFolderId({
    apiBaseUrl: options.apiBaseUrl,
    folderId: options.folderId
  });
  assertBatchVideoOnly(options.filePaths);
  const session = await getAuthenticatedSession(options.apiBaseUrl);
  const prepared = await prepareBatchFilePathsForCreate({
    apiBaseUrl: session.apiBaseUrl,
    filePaths: options.filePaths,
    kind: "translate_subtitles"
  });
  await assertCreateAllowed({
    apiBaseUrl: session.apiBaseUrl,
    glossaryIdList: options.glossaryIdList,
    items: prepared.filePaths.map((filePath) => ({ filePath })),
    kind: "translate_subtitles",
    removeOriginalSubtitle: options.removeOriginalSubtitle,
    userPrompt: options.userPrompt
  });
  const userRegion = await getUserStorageRegion(session.apiBaseUrl);
  const bucketName = getTempBucketName(userRegion);
  const uploadedFiles = await createBatchUploadEntries({
    apiBaseUrl: session.apiBaseUrl,
    bucketName,
    filePaths: prepared.filePaths,
    userRegion
  });
  const response = await authorizedRequest2({
    apiBaseUrl: session.apiBaseUrl,
    body: compactJsonObject({
      country_code: getCountryCodeFromToken(session.accessToken),
      folder_id: folderId,
      glossary_id_list: options.glossaryIdList ?? [],
      original_language: options.originalLanguage ?? "auto",
      remove_original_subtitle: options.removeOriginalSubtitle ?? false,
      subtitle_display_type: options.subtitleDisplayType ?? "translated_only",
      target_language: targetLanguage,
      target_locale: targetLocale ?? "",
      uploaded_files: uploadedFiles.map((file) => ({
        duration: file.duration,
        filename: file.filename,
        path: file.path
      })),
      user_prompt: options.userPrompt ?? ""
    }),
    method: "POST",
    path: "/v1/translate_captions/batch"
  });
  return buildBatchCreateResult({
    ids: response.data.pids ?? [],
    kind: "translate_subtitles",
    skippedFiles: prepared.skippedFiles,
    warnings: prepared.warnings
  });
}
async function createFrameTranslationProjectFromUrl(options) {
  const { targetLanguage, targetLocale } = resolveCreateTargetLanguageAndLocale(
    {
      kind: "visual_translate",
      targetLanguage: options.targetLanguage
    }
  );
  const folderId = await resolveValidatedProjectFolderId({
    apiBaseUrl: options.apiBaseUrl,
    folderId: options.folderId
  });
  const originalLanguage = options.originalLanguage?.trim();
  if (!originalLanguage || originalLanguage.toLowerCase() === "auto") {
    throw new Error(
      "Frame translation requires an explicit `originalLanguage`; `auto` is not supported."
    );
  }
  const session = await getAuthenticatedSession(options.apiBaseUrl);
  const video = await resolveVideoFromUrl(
    session.apiBaseUrl,
    options.sourceUrl
  );
  const resolvedDuration = Number(video.duration);
  const fontPlan = parseVisualTranslateFontOptions({
    fontFamily: options.fontFamily,
    fontFilePath: options.fontFilePath,
    fontSrc: options.fontSrc
  });
  const entitlements = await assertCreateAllowed({
    apiBaseUrl: session.apiBaseUrl,
    glossaryIdList: options.glossaryIdList,
    hasCustomFont: fontPlan.hasCustomFont,
    items: [{ durationSeconds: resolvedDuration }],
    kind: "visual_translate",
    userPrompt: options.userPrompt
  });
  const font = await materializeVisualTranslateFont({
    apiBaseUrl: session.apiBaseUrl,
    fontFamily: options.fontFamily,
    fontFilePath: options.fontFilePath,
    fontSrc: options.fontSrc
  });
  const firstUserClip = await resolveFirstVisualTranslateClipInterval({
    apiBaseUrl: session.apiBaseUrl,
    durationSeconds: resolvedDuration,
    entitlements
  });
  const durationForCreate = firstUserClip?.durationSeconds ?? resolvedDuration;
  const preparedUpload = await prepareUploadForProject({
    apiBaseUrl: session.apiBaseUrl,
    path: "/v1/translate_frames/upload_prepare"
  });
  const title = getPreferredTitle(video, "Visual Translation Project");
  const uploadVideoPath = buildPreparedUploadPath(
    preparedUpload.uploadDir,
    getVideoExtension(video)
  );
  const response = await authorizedRequest2({
    apiBaseUrl: session.apiBaseUrl,
    body: compactJsonObject({
      creation_source: "link",
      duration: durationForCreate,
      clip_interval: firstUserClip?.clipInterval,
      folder_id: folderId,
      glossary_id_list: options.glossaryIdList ?? [],
      original_language: originalLanguage,
      original_url: video.originURL ?? video.origin_url ?? options.sourceUrl,
      platform: video.platform,
      project_font_family: font.fontFamily,
      project_font_src: font.fontSrc,
      target_language: targetLanguage,
      target_locale: targetLocale,
      thumb_url: getPreferredThumbnailUrl(video),
      title,
      uploaded_subtitle_path: "",
      uploaded_video_path: uploadVideoPath,
      user_prompt: options.userPrompt ?? "",
      video_url: getPreferredVideoUrl(video, options.sourceUrl)
    }),
    method: "POST",
    path: "/v1/translate_frames"
  });
  const clip = firstUserClip?.clipInterval && Number.isFinite(resolvedDuration) ? {
    originalDurationSeconds: resolvedDuration,
    durationSeconds: durationForCreate,
    clipInterval: firstUserClip.clipInterval,
    reason: "insufficient_points_first_time"
  } : null;
  return {
    id: response.data.pid,
    kind: "visual_translate",
    status: "started",
    title,
    webUrl: buildProjectWebUrl("visual_translate", response.data.pid),
    clip,
    warnings: clip ? [buildFirstTimeClipWarning(clip)] : []
  };
}
async function createFrameTranslationProjectFromFile(options) {
  const { targetLanguage, targetLocale } = resolveCreateTargetLanguageAndLocale(
    {
      kind: "visual_translate",
      targetLanguage: options.targetLanguage
    }
  );
  const folderId = options.skipCreateGuard ? options.folderId : await resolveValidatedProjectFolderId({
    apiBaseUrl: options.apiBaseUrl,
    folderId: options.folderId
  });
  assertSupportedLocalMediaFile(options.filePath);
  const mediaType = inferLocalMediaType(options.filePath);
  if (mediaType !== "video") {
    throw new Error(
      "Frame translation file create currently supports local video files only."
    );
  }
  const originalLanguage = options.originalLanguage?.trim();
  if (!originalLanguage || originalLanguage.toLowerCase() === "auto") {
    throw new Error(
      "Frame translation requires an explicit `originalLanguage`; `auto` is not supported."
    );
  }
  const duration = await getLocalMediaDuration(options.filePath);
  const fontPlan = parseVisualTranslateFontOptions({
    fontFamily: options.fontFamily,
    fontFilePath: options.fontFilePath,
    fontSrc: options.fontSrc
  });
  let entitlements;
  if (!options.skipCreateGuard) {
    entitlements = await assertCreateAllowed({
      apiBaseUrl: options.apiBaseUrl,
      glossaryIdList: options.glossaryIdList,
      hasCustomFont: fontPlan.hasCustomFont,
      items: [{ durationSeconds: duration, filePath: options.filePath }],
      kind: "visual_translate",
      userPrompt: options.userPrompt
    });
  }
  const font = await materializeVisualTranslateFont({
    apiBaseUrl: options.apiBaseUrl,
    fontFamily: options.fontFamily,
    fontFilePath: options.fontFilePath,
    fontSrc: options.fontSrc
  });
  const firstUserClip = await resolveFirstVisualTranslateClipInterval({
    apiBaseUrl: options.apiBaseUrl,
    durationSeconds: duration,
    entitlements
  });
  const durationForCreate = firstUserClip?.durationSeconds ?? duration;
  const session = await getAuthenticatedSession(options.apiBaseUrl);
  const preparedUpload = await prepareUploadForProject({
    apiBaseUrl: session.apiBaseUrl,
    path: "/v1/translate_frames/upload_prepare"
  });
  const extension = getLocalFileExtension(options.filePath) || "mp4";
  const title = resolveProjectTitle(getLocalFileTitle(options.filePath));
  const uploadVideoPath = buildPreparedUploadPath(
    preparedUpload.uploadDir,
    extension
  );
  await uploadSingleLocalFile({
    apiBaseUrl: session.apiBaseUrl,
    bucketName: preparedUpload.uploadBucket,
    filePath: options.filePath,
    uploadPath: uploadVideoPath
  });
  const response = await authorizedRequest2({
    apiBaseUrl: session.apiBaseUrl,
    body: compactJsonObject({
      creation_source: "file",
      duration: durationForCreate,
      clip_interval: firstUserClip?.clipInterval,
      folder_id: folderId,
      glossary_id_list: options.glossaryIdList ?? [],
      original_language: originalLanguage,
      project_font_family: font.fontFamily,
      project_font_src: font.fontSrc,
      target_language: targetLanguage,
      target_locale: targetLocale,
      title,
      uploaded_subtitle_path: "",
      uploaded_video_path: uploadVideoPath,
      user_prompt: options.userPrompt ?? ""
    }),
    method: "POST",
    path: "/v1/translate_frames"
  });
  const clip = firstUserClip?.clipInterval && Number.isFinite(duration) ? {
    originalDurationSeconds: duration,
    durationSeconds: durationForCreate,
    clipInterval: firstUserClip.clipInterval,
    reason: "insufficient_points_first_time"
  } : null;
  return {
    id: response.data.pid,
    kind: "visual_translate",
    status: "started",
    title,
    webUrl: buildProjectWebUrl("visual_translate", response.data.pid),
    clip,
    warnings: clip ? [buildFirstTimeClipWarning(clip)] : []
  };
}
async function batchCreateFrameTranslationProjectsFromFiles(options) {
  resolveCreateTargetLanguageAndLocale({
    kind: "visual_translate",
    targetLanguage: options.targetLanguage
  });
  const folderId = await resolveValidatedProjectFolderId({
    apiBaseUrl: options.apiBaseUrl,
    folderId: options.folderId
  });
  const prepared = await prepareBatchFilePathsForCreate({
    apiBaseUrl: options.apiBaseUrl,
    filePaths: options.filePaths,
    kind: "visual_translate"
  });
  const fontPlan = parseVisualTranslateFontOptions({
    fontFamily: options.fontFamily,
    fontFilePath: options.fontFilePath,
    fontSrc: options.fontSrc
  });
  await assertCreateAllowed({
    apiBaseUrl: options.apiBaseUrl,
    glossaryIdList: options.glossaryIdList,
    hasCustomFont: fontPlan.hasCustomFont,
    items: prepared.filePaths.map((filePath) => ({ filePath })),
    kind: "visual_translate",
    userPrompt: options.userPrompt
  });
  const font = await materializeVisualTranslateFont({
    apiBaseUrl: options.apiBaseUrl,
    fontFamily: options.fontFamily,
    fontFilePath: options.fontFilePath,
    fontSrc: options.fontSrc
  });
  const ids = [];
  const skippedFiles = [...prepared.skippedFiles];
  const warnings = [...prepared.warnings];
  let firstError = null;
  for (const filePath of prepared.filePaths) {
    try {
      const result = await createFrameTranslationProjectFromFile({
        apiBaseUrl: options.apiBaseUrl,
        filePath,
        folderId,
        fontFamily: font.fontFamily,
        fontSrc: font.fontSrc,
        glossaryIdList: options.glossaryIdList,
        originalLanguage: options.originalLanguage,
        skipCreateGuard: true,
        targetLanguage: options.targetLanguage,
        userPrompt: options.userPrompt
      });
      ids.push(result.id);
    } catch (error) {
      firstError ??= error;
      const reason = error instanceof Error ? error.message : String(error);
      skippedFiles.push({ filePath, reason: `create failed: ${reason}` });
      warnings.push(`Skipped ${filePath}: create failed: ${reason}.`);
    }
  }
  if (!ids.length && firstError) {
    throw firstError;
  }
  return buildBatchCreateResult({
    ids,
    kind: "visual_translate",
    skippedFiles,
    warnings
  });
}
async function createLipsyncProjectFromUrl(options) {
  const folderId = await resolveValidatedProjectFolderId({
    apiBaseUrl: options.apiBaseUrl,
    folderId: options.folderId
  });
  const session = await getAuthenticatedSession(options.apiBaseUrl);
  const video = await resolveVideoFromUrl(
    session.apiBaseUrl,
    options.sourceUrl
  );
  await assertCreateAllowed({
    apiBaseUrl: session.apiBaseUrl,
    items: [
      buildLipsyncCreateGuardItem({
        durationSeconds: Number(video.duration),
        video
      })
    ],
    kind: "lipsync"
  });
  const title = getPreferredTitle(video, "Lip Sync Project");
  const extension = getVideoExtension(video);
  const createResponse = await authorizedRequest2({
    apiBaseUrl: session.apiBaseUrl,
    body: compactJsonObject({
      audio_extension: ".mp3",
      thumb_url: getPreferredThumbnailUrl(video),
      title,
      video_extension: extension
    }),
    method: "POST",
    path: "/v1/lipsyncs"
  });
  await authorizedRequest2({
    apiBaseUrl: session.apiBaseUrl,
    body: compactJsonObject({
      audio_source: "from_this_video",
      duration: Number(video.duration),
      face_mode: options.faceMode,
      folder_id: folderId,
      link: getPreferredVideoUrl(video, options.sourceUrl),
      lip_sync_mode: LIPSYNC_CREATE_MODE,
      original_url: video.originURL ?? video.origin_url ?? options.sourceUrl,
      original_video_duration: Number(video.duration),
      platform: video.platform,
      title,
      voice_cloned_from_video: false
    }),
    method: "POST",
    path: `/v1/lipsyncs/${createResponse.data.pid}/link_lipsync`
  });
  return {
    id: createResponse.data.pid,
    kind: "lipsync",
    status: "started",
    title,
    webUrl: buildProjectWebUrl("lipsync", createResponse.data.pid)
  };
}
async function createLipsyncProjectFromFile(options) {
  const folderId = options.skipCreateGuard ? options.folderId : await resolveValidatedProjectFolderId({
    apiBaseUrl: options.apiBaseUrl,
    folderId: options.folderId
  });
  assertSupportedLocalMediaFile(options.filePath);
  const mediaType = inferLocalMediaType(options.filePath);
  if (mediaType !== "video") {
    throw new Error(
      "Lipsync file create currently supports local video files only."
    );
  }
  const title = resolveProjectTitle(getLocalFileTitle(options.filePath));
  const extension = getLocalFileExtension(options.filePath) || "mp4";
  const duration = await getLocalMediaDuration(options.filePath);
  if (!options.skipCreateGuard) {
    await assertCreateAllowed({
      apiBaseUrl: options.apiBaseUrl,
      items: [
        buildLipsyncCreateGuardItem({
          durationSeconds: duration,
          filePath: options.filePath
        })
      ],
      kind: "lipsync"
    });
  }
  const createResponse = await authorizedRequest2({
    apiBaseUrl: options.apiBaseUrl,
    body: compactJsonObject({
      audio_extension: ".mp3",
      title,
      video_extension: extension
    }),
    method: "POST",
    path: "/v1/lipsyncs"
  });
  const uploadVideoPath = createResponse.data.uploadVideoPath ?? createResponse.data.upload_video_path ?? createResponse.data.uploadPath ?? createResponse.data.upload_path;
  if (!uploadVideoPath) {
    throw new Error("Lipsync create response did not include uploadVideoPath.");
  }
  const uploadBucket = createResponse.data.uploadBucket ?? createResponse.data.upload_bucket;
  if (!uploadBucket) {
    throw new Error(
      "Lipsync create response did not include an upload bucket."
    );
  }
  await uploadSingleLocalFile({
    apiBaseUrl: options.apiBaseUrl,
    bucketName: uploadBucket,
    filePath: options.filePath,
    uploadPath: uploadVideoPath
  });
  await authorizedRequest2({
    apiBaseUrl: options.apiBaseUrl,
    body: compactJsonObject({
      audio_source: "from_this_video",
      duration,
      face_mode: options.faceMode,
      folder_id: folderId,
      lip_sync_mode: LIPSYNC_CREATE_MODE,
      original_video_duration: duration,
      title,
      video_path: uploadVideoPath,
      voice_cloned_from_video: false
    }),
    method: "POST",
    path: `/v1/lipsyncs/${createResponse.data.pid}/file_lipsync`
  });
  return {
    id: createResponse.data.pid,
    kind: "lipsync",
    status: "started",
    title,
    webUrl: buildProjectWebUrl("lipsync", createResponse.data.pid)
  };
}
async function batchCreateLipsyncProjectsFromFiles(options) {
  const folderId = await resolveValidatedProjectFolderId({
    apiBaseUrl: options.apiBaseUrl,
    folderId: options.folderId
  });
  const prepared = await prepareBatchFilePathsForCreate({
    apiBaseUrl: options.apiBaseUrl,
    filePaths: options.filePaths,
    kind: "lipsync"
  });
  await assertCreateAllowed({
    apiBaseUrl: options.apiBaseUrl,
    items: prepared.filePaths.map(
      (filePath) => buildLipsyncCreateGuardItem({ filePath })
    ),
    kind: "lipsync"
  });
  const ids = [];
  const skippedFiles = [...prepared.skippedFiles];
  const warnings = [...prepared.warnings];
  let firstError = null;
  for (const filePath of prepared.filePaths) {
    try {
      const result = await createLipsyncProjectFromFile({
        apiBaseUrl: options.apiBaseUrl,
        faceMode: options.faceMode,
        filePath,
        folderId,
        skipCreateGuard: true
      });
      ids.push(result.id);
    } catch (error) {
      firstError ??= error;
      const reason = error instanceof Error ? error.message : String(error);
      skippedFiles.push({ filePath, reason: `create failed: ${reason}` });
      warnings.push(`Skipped ${filePath}: create failed: ${reason}.`);
    }
  }
  if (!ids.length && firstError) {
    throw firstError;
  }
  return buildBatchCreateResult({
    ids,
    kind: "lipsync",
    skippedFiles,
    warnings
  });
}
async function createLipsyncProjectFromTranslation(options) {
  const folderId = await resolveValidatedProjectFolderId({
    apiBaseUrl: options.apiBaseUrl,
    folderId: options.folderId
  });
  const projectDetail = await getProject({
    apiBaseUrl: options.apiBaseUrl,
    id: options.translationId,
    kind: "translate_dub"
  });
  const rawProject = asRecord3(projectDetail.project.raw);
  const title = resolveProjectTitle(
    projectDetail.project.title || "Lip Sync Project"
  );
  await assertCreateAllowed({
    apiBaseUrl: options.apiBaseUrl,
    items: [
      buildLipsyncCreateGuardItem({
        durationSeconds: projectDetail.project.duration,
        rawProject: projectDetail.project.raw
      })
    ],
    kind: "lipsync"
  });
  const createResponse = await authorizedRequest2({
    apiBaseUrl: options.apiBaseUrl,
    body: compactJsonObject({
      audio_extension: ".mp3",
      title,
      video_extension: ".mp4"
    }),
    method: "POST",
    path: "/v1/lipsyncs"
  });
  await authorizedRequest2({
    apiBaseUrl: options.apiBaseUrl,
    body: compactJsonObject({
      duration: projectDetail.project.duration ?? void 0,
      faceMode: options.faceMode,
      folderID: folderId ?? readString4(rawProject.folderID) ?? readString4(rawProject.folder_id) ?? "",
      lipSyncMode: LIPSYNC_CREATE_MODE,
      title,
      translationID: options.translationId
    }),
    method: "POST",
    path: `/v1/lipsyncs/${createResponse.data.pid}/translation_lipsync`
  });
  return {
    id: createResponse.data.pid,
    kind: "lipsync",
    status: "started",
    title,
    webUrl: buildProjectWebUrl("lipsync", createResponse.data.pid)
  };
}

// src/core/skills.ts
import fs2 from "fs";
import os from "os";
import path5 from "path";
function resolveWorkbuddySkillsDir(homeDir = os.homedir()) {
  const configDir = process.env.WORKBUDDY_CONFIG_DIR?.trim() || path5.join(homeDir, ".workbuddy");
  return path5.join(configDir, "skills");
}
function getInstallTargets(target) {
  const home = os.homedir();
  const targets = [];
  if (target === "cursor" || target === "all") {
    const agentRootDir = path5.join(home, ".cursor");
    targets.push({
      target: "cursor",
      agentRootDir,
      skillsDir: path5.join(agentRootDir, "skills")
    });
  }
  if (target === "codex" || target === "all") {
    const agentRootDir = path5.join(home, ".codex");
    targets.push({
      target: "codex",
      agentRootDir,
      skillsDir: path5.join(agentRootDir, "skills")
    });
  }
  if (target === "claude-code" || target === "all") {
    const agentRootDir = path5.join(home, ".claude");
    targets.push({
      target: "claude-code",
      agentRootDir,
      skillsDir: path5.join(agentRootDir, "skills")
    });
  }
  if (target === "workbuddy" || target === "all") {
    const skillsDir = resolveWorkbuddySkillsDir(home);
    targets.push({
      target: "workbuddy",
      agentRootDir: path5.dirname(skillsDir),
      skillsDir
    });
  }
  if (target === "agents" || target === "all") {
    const agentRootDir = path5.join(home, ".agents");
    targets.push({
      target: "agents",
      agentRootDir,
      skillsDir: path5.join(agentRootDir, "skills")
    });
  }
  return targets;
}
function getPackageRoot() {
  let current = __dirname;
  while (current !== path5.dirname(current)) {
    const packageJsonPath = path5.join(current, "package.json");
    if (fs2.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(
          fs2.readFileSync(packageJsonPath, "utf8")
        );
        if (packageJson.name === "@vozoai/cli" || packageJson.name === "@vozo/cli") {
          return current;
        }
      } catch {
      }
    }
    current = path5.dirname(current);
  }
  throw new Error("Could not locate @vozoai/cli package root");
}
function getBundledSkillsDir() {
  return path5.join(getPackageRoot(), "skills");
}
function readSkillDescription(skillMdPath) {
  if (!fs2.existsSync(skillMdPath)) {
    return void 0;
  }
  const content = fs2.readFileSync(skillMdPath, "utf8");
  const match = content.match(/^description:\s*(.+)$/m);
  return match?.[1]?.trim();
}
function listBundledSkills() {
  const skillsDir = getBundledSkillsDir();
  if (!fs2.existsSync(skillsDir)) {
    return [];
  }
  return fs2.readdirSync(skillsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
    const dir = path5.join(skillsDir, entry.name);
    const skillMdPath = path5.join(dir, "SKILL.md");
    return {
      name: entry.name,
      dir,
      description: readSkillDescription(skillMdPath)
    };
  }).filter((skill) => fs2.existsSync(path5.join(skill.dir, "SKILL.md")));
}
function copyDirRecursive(src, dest) {
  fs2.mkdirSync(dest, { recursive: true });
  for (const entry of fs2.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path5.join(src, entry.name);
    const destPath = path5.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs2.copyFileSync(srcPath, destPath);
    }
  }
}
function installSkillToTarget(skill, targetDir, mode) {
  fs2.mkdirSync(targetDir, { recursive: true });
  const dest = path5.join(targetDir, skill.name);
  if (fs2.existsSync(dest)) {
    fs2.rmSync(dest, { recursive: true, force: true });
  }
  if (mode === "symlink") {
    fs2.symlinkSync(skill.dir, dest, "dir");
  } else {
    copyDirRecursive(skill.dir, dest);
  }
  return dest;
}
function installBundledSkills(options) {
  const target = options?.target ?? "all";
  const mode = options?.link ? "symlink" : "copy";
  const dryRun = Boolean(options?.dryRun);
  const bundled = listBundledSkills();
  if (bundled.length === 0) {
    throw new Error(
      `No bundled skills found under ${getBundledSkillsDir()}. Reinstall @vozoai/cli or run from a built package.`
    );
  }
  const selected = options?.skillNames && options.skillNames.length > 0 ? bundled.filter((skill) => options.skillNames.includes(skill.name)) : bundled;
  const unknown = (options?.skillNames ?? []).filter(
    (name) => !bundled.some((skill) => skill.name === name)
  );
  if (unknown.length > 0) {
    throw new Error(`Unknown skill(s): ${unknown.join(", ")}`);
  }
  const skipped = [];
  let targetDirs;
  if (options?.path) {
    targetDirs = [path5.resolve(options.path)];
  } else {
    const candidates = getInstallTargets(target);
    const present = candidates.filter(
      (candidate) => fs2.existsSync(candidate.agentRootDir)
    );
    const missing = candidates.filter(
      (candidate) => !fs2.existsSync(candidate.agentRootDir)
    );
    if (target !== "all" && missing.length > 0) {
      throw new Error(
        `Target "${target}" does not appear to be installed: ${missing[0].agentRootDir} not found. Install the agent first, or pass --path <dir> to choose the destination explicitly.`
      );
    }
    for (const candidate of missing) {
      skipped.push({
        target: candidate.target,
        agentRootDir: candidate.agentRootDir,
        reason: `${candidate.agentRootDir} not found; agent does not appear to be installed`
      });
    }
    if (present.length === 0) {
      throw new Error(
        "No supported agent directories were found (~/.cursor, ~/.codex, ~/.claude, ~/.workbuddy, ~/.agents). Install an agent first, or pass --path <dir> to choose the destination explicitly."
      );
    }
    targetDirs = present.map((candidate) => candidate.skillsDir);
  }
  const installed = [];
  for (const skill of selected) {
    for (const targetDir of targetDirs) {
      if (!dryRun) {
        installSkillToTarget(skill, targetDir, mode);
      }
      installed.push({ skill: skill.name, targetDir, mode });
    }
  }
  return {
    dryRun,
    installed,
    skills: selected.map((skill) => skill.name),
    skipped,
    targets: targetDirs
  };
}

// src/program.ts
import { Command } from "commander";

// src/commands/auth.ts
async function printAuthRequiredStatus() {
  const status = await getAuthStatus();
  if (status.authenticated) {
    return true;
  }
  printStderr(status.nextAction);
  printJson(status);
  process.exitCode = 1;
  return false;
}
function formatAccountLabel(user) {
  return user.email ?? user.displayId ?? user.nickname ?? user.id ?? "Unknown";
}
function printMembershipSummary(result) {
  const account = formatAccountLabel(result.user);
  const plan = result.membership.userType ?? result.membership.planType ?? "unknown";
  const lines = [
    `Account: ${account}`,
    `Membership: ${plan}`,
    `Status: ${result.membership.isExpired ? "expired" : "active"}`
  ];
  if (result.membership.vipStatus) {
    lines.push(`VIP status: ${result.membership.vipStatus}`);
  }
  if (result.membership.startedAt) {
    lines.push(`Started at: ${result.membership.startedAt}`);
  }
  if (result.membership.expiredAt && result.membership.expiredAt !== result.membership.startedAt) {
    lines.push(`Expires at: ${result.membership.expiredAt}`);
  }
  if (result.membership.paymentType) {
    lines.push(`Payment type: ${result.membership.paymentType}`);
  }
  if (result.membership.upcomingPlanType) {
    lines.push(`Upcoming plan: ${result.membership.upcomingPlanType}`);
  }
  printStdout(lines.join("\n"));
}
function printPointsSummary(result) {
  const account = formatAccountLabel(result.user);
  const lines = [
    `Account: ${account}`,
    `Total available points: ${result.totalAvailablePoints.toFixed(2)}`
  ];
  if (!result.points.length) {
    lines.push("Point buckets: none");
    printStdout(lines.join("\n"));
    return;
  }
  lines.push("Point buckets:");
  for (const point of result.points) {
    const pointType = point.pointType ?? "unknown";
    const available = point.availablePoint ?? 0;
    const total = point.totalPoint ?? 0;
    const status = point.isExpired ? "expired" : "active";
    const expiry = point.expiredAt ? `, expires at ${point.expiredAt}` : "";
    lines.push(
      `- ${pointType}: available ${available.toFixed(
        2
      )} / total ${total.toFixed(2)}, ${status}${expiry}`
    );
  }
  printStdout(lines.join("\n"));
}
function buildBrowserLoginOptions(options) {
  return {
    callbackPath: options.callbackPath,
    // Commander stores `--no-open` as `open: false`, not `noOpen: true`.
    noOpen: options.open === false,
    port: options.port ? Number(options.port) : void 0,
    timeoutSeconds: options.timeoutSeconds ? Number(options.timeoutSeconds) : void 0,
    webAppUrl: options.webAppUrl
  };
}
function printBrowserLoginPending(payload) {
  printCliEvent({
    callbackUrl: payload.callbackUrl,
    event: "auth_pending",
    loginUrl: payload.loginUrl,
    mode: "blocking",
    sessionFile: getSessionFilePath()
  });
  printStderr(`Waiting for browser authentication at ${payload.callbackUrl}`);
  printStderr("Open this login URL if the browser did not launch:");
  printStderr(payload.loginUrl);
}
function printBrowserLoginWaiting(elapsedSeconds) {
  printCliEvent({
    elapsedSeconds,
    event: "auth_waiting",
    mode: "blocking"
  });
  printStderr(
    `Waiting for browser sign-in to complete... (${elapsedSeconds}s)`
  );
}
function registerAuthCommands(program) {
  const auth = program.command("auth").description("Manage CLI authentication");
  auth.command("status").description("Show the current authentication status").action(async () => {
    const status = await getAuthStatus();
    if (!status.authenticated) {
      printStderr(status.nextAction);
    }
    printJson(status);
  });
  auth.command("login").description(
    "Open the browser for sign-in, poll until complete, and save a local CLI session"
  ).option(
    "--background",
    "Start browser login in the background and return immediately"
  ).option(
    "--callback-path <path>",
    "Override the local callback path",
    "/callback"
  ).option(
    "--no-open",
    "Do not auto-open the browser; print the login URL only"
  ).option("--port <port>", "Preferred local callback port").option(
    "--timeout-seconds <seconds>",
    "How long to wait for the browser callback",
    "300"
  ).option(
    "--web-app-url <url>",
    "Override the web app URL used for browser sign-in"
  ).action(async (options) => {
    const loginOptions = buildBrowserLoginOptions(options);
    if (options.background) {
      printJson(
        await startBrowserLoginInBackground(process.argv[1], loginOptions)
      );
      return;
    }
    printJson(
      await loginWithBrowser({
        ...loginOptions,
        onCallbackReceived: (payload) => {
          printCliEvent({
            callbackUrl: payload.callbackUrl,
            event: "auth_callback_received",
            mode: "blocking"
          });
          printStderr(
            `Browser authorization received at ${payload.callbackUrl}`
          );
          printStderr("Finalizing the local CLI session...");
        },
        onPending: (payload) => {
          printBrowserLoginPending(payload);
        },
        onWaiting: ({ elapsedSeconds }) => {
          printBrowserLoginWaiting(elapsedSeconds);
        }
      })
    );
  });
  auth.command("login-token").description(
    "Sign in with an existing access token and save a local CLI session"
  ).requiredOption("--access-token <token>", "Access token from the web app").option(
    "--refresh-token <token>",
    "Optional refresh token for session renewal"
  ).option("--token-type <type>", "Token type", "Bearer").option("--api-base-url <url>", "Override the API base URL").action(async (options) => {
    printJson(
      await loginWithAccessToken({
        accessToken: options.accessToken,
        apiBaseUrl: options.apiBaseUrl,
        refreshToken: options.refreshToken,
        tokenType: options.tokenType
      })
    );
  });
  auth.command("login-worker", { hidden: true }).description("Internal background worker for browser login").option(
    "--callback-path <path>",
    "Override the local callback path",
    "/callback"
  ).option(
    "--no-open",
    "Do not auto-open the browser; print the login URL only"
  ).option("--port <port>", "Preferred local callback port").option(
    "--timeout-seconds <seconds>",
    "How long to wait for the browser callback",
    "300"
  ).option(
    "--web-app-url <url>",
    "Override the web app URL used for browser sign-in"
  ).action(async (options) => {
    await loginWithBrowser({
      ...buildBrowserLoginOptions(options),
      trackPending: true
    });
  });
  auth.command("wait").description(
    "Poll auth status until browser sign-in completes or times out"
  ).option(
    "--poll-interval-ms <milliseconds>",
    "How often to poll auth status",
    "500"
  ).option(
    "--timeout-seconds <seconds>",
    "How long to wait for sign-in to complete",
    "300"
  ).action(async (options) => {
    const status = await waitForAuthenticatedSession({
      onPoll: (elapsedSeconds) => {
        printCliEvent({
          elapsedSeconds,
          event: "auth_waiting"
        });
        printStderr(
          `Waiting for browser sign-in to complete... (${elapsedSeconds}s)`
        );
      },
      pollIntervalMs: Number(options.pollIntervalMs),
      timeoutSeconds: Number(options.timeoutSeconds)
    });
    printJson(status);
  });
  auth.command("logout").description(
    "Clear the local CLI session and terminate the remote session if possible"
  ).action(async () => {
    printJson(await logout());
  });
  auth.command("points").description("Show the current remaining point balances").action(async () => {
    if (!await printAuthRequiredStatus()) {
      return;
    }
    await requireUserPermission({
      action: "view point balances",
      permissionKeys: [USER_PERMISSIONS.showPoints]
    });
    printPointsSummary(await getUserPointsStatus());
  });
  auth.command("membership").description("Show the current membership benefit").action(async () => {
    if (!await printAuthRequiredStatus()) {
      return;
    }
    printMembershipSummary(await getUserMembershipStatus());
  });
}

// src/commands/install.ts
function registerInstallCommands(program) {
  program.command("install").description(
    "Bootstrap vozo-cli from npm (`npx @vozoai/cli install`), then install agent skills from GitHub"
  ).option(
    "--github",
    "Install the CLI binary from GitHub (github:vozoai/cli) instead of npm"
  ).option(
    "--repo <git-url>",
    "Override the GitHub repo when using --github (default: vozoai/cli)"
  ).option(
    "--tag <ref>",
    "Install a specific npm version, or git tag/branch when using --github"
  ).option("--skip-skills", "Do not install agent skills after the CLI").action(async (options) => {
    printJson(
      await runCliInstall({
        github: Boolean(options.github),
        ref: options.tag,
        repoUrl: options.repo,
        skipSkills: Boolean(options.skipSkills)
      })
    );
  });
}

// src/commands/project.ts
import { InvalidArgumentError as InvalidArgumentError3 } from "commander";
var PROJECT_KIND_FLAG_HELP = "Project kind: translate_dub, translate_subtitles, visual_translate, lipsync";
var MAX_PROJECT_LIST_LIMIT = 30;
var MAX_GLOSSARY_ID_COUNT = 3;
function emitWarnings(value) {
  const warnings = value?.warnings;
  if (!Array.isArray(warnings)) {
    return;
  }
  for (const warning of warnings) {
    if (typeof warning === "string" && warning.trim()) {
      console.error(warning);
    }
  }
}
function buildFriendlyDownloadErrorMessage(options) {
  const artifact = options.artifact;
  const isSubtitle = artifact.includes("subtitle") || artifact.includes("caption");
  const prefix2 = isSubtitle ? "Failed to download subtitles" : "Failed to download file";
  const error = options.error instanceof Error ? options.error : new Error(String(options.error));
  const errorCode = String(options.error?.code);
  const rawMessage = error.message || String(options.error);
  if (rawMessage.toLowerCase().includes("provide --output")) {
    return `${prefix2}: provide --output <path> to set the save location.`;
  }
  if (errorCode === "EACCES" || /permission denied/i.test(rawMessage)) {
    return `${prefix2}: permission denied when writing to the output path (${options.outputPath ?? "not specified"}). Check the directory permissions or choose another location.`;
  }
  if (errorCode === "ENOSPC") {
    return `${prefix2}: not enough disk space to write the output file. Free up space and try again.`;
  }
  return `${prefix2}: ${rawMessage}`;
}
function parseListLimitOption(value) {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("`--limit` must be a positive integer.");
  }
  if (limit > MAX_PROJECT_LIST_LIMIT) {
    throw new Error(`\`--limit\` cannot exceed ${MAX_PROJECT_LIST_LIMIT}.`);
  }
  return limit;
}
function addCommonListOptions(command) {
  return command.option(
    "--kind <kind>",
    `Project kind: all, ${PROJECT_KIND_FLAG_HELP.replace(
      "Project kind: ",
      ""
    )}`,
    "all"
  ).option("--folder <folderId>", "Filter by folder ID").option(
    "--folder-name <name>",
    "Filter by folder name (exact or unique partial match)"
  ).option("--limit <n>", `Page size (1-${MAX_PROJECT_LIST_LIMIT})`, "20").option("--cursor <cursor>", "Pagination cursor");
}
async function resolveListFolderId(options) {
  return resolveProjectFolderId({
    folderId: options.folder,
    folderName: options.folderName
  });
}
function parseDetailKind(kind) {
  const parsed = parseProjectKind(kind);
  if (parsed === "all") {
    throw new Error(
      "This command requires a specific project kind, not `all`."
    );
  }
  return parsed;
}
function countDefinedSources(values) {
  return values.filter((value) => {
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return Boolean(value);
  }).length;
}
function collectMultiValueOption(values) {
  if (!values) {
    return [];
  }
  const inputValues = Array.isArray(values) ? values : [values];
  return inputValues.flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
}
function collectGlossaryIdList(values) {
  const ids = collectMultiValueOption(values);
  if (ids.length > MAX_GLOSSARY_ID_COUNT) {
    throw new Error(
      `At most ${MAX_GLOSSARY_ID_COUNT} glossary ids can be set (got ${ids.length}).`
    );
  }
  return ids;
}
function validateTranslationCreateOptions(options) {
  if (options.removeOriginalSubtitle && !options.enableSubtitles) {
    throw new Error(
      "`--remove-original-subtitle` requires `--enable-subtitles`."
    );
  }
}
function assertSingleSourceOnlyOptions(options) {
  if (options.subtitleFile && !options.fromFile) {
    throw new Error(
      "`--subtitle-file` is only supported with `--from-file`. Remove it, or switch to a single local file source."
    );
  }
}
function parseRequiredFrameOriginalLanguage(value) {
  const normalized = parseLanguageInput(value, "--original-language");
  if (normalized.toLowerCase() === "auto") {
    throw new InvalidArgumentError3(
      "`--original-language` must be an explicit language code for visual translate; `auto` is not supported."
    );
  }
  return normalized;
}
function parseTargetLanguageOption(value) {
  return parseLanguageInput(value, "--target-language");
}
function parseOriginalLanguageOption(value) {
  return parseLanguageInput(value, "--original-language");
}
function parseSpeakerNumberOption(value) {
  return parseSpeakerNumber(value);
}
async function resolveDirectorySourceFiles(directoryPath, allowedMediaTypes) {
  const files = await listLocalFilesInDirectory(directoryPath);
  const matchedFiles = files.filter((filePath) => {
    if (!isSupportedLocalMediaFile(filePath)) {
      return false;
    }
    return allowedMediaTypes.includes(inferLocalMediaType(filePath));
  });
  if (!matchedFiles.length) {
    throw new Error(`No supported files were found in ${directoryPath}.`);
  }
  return matchedFiles;
}
async function resolveDirectorySourceFilesForDub(directoryPath) {
  const files = await listLocalFilesInDirectory(directoryPath);
  const audioFiles = [];
  const videoFiles = [];
  for (const filePath of files) {
    if (!isSupportedLocalMediaFile(filePath)) {
      continue;
    }
    const mediaType = inferLocalMediaType(filePath);
    if (mediaType === "audio") {
      audioFiles.push(filePath);
    } else if (mediaType === "video") {
      videoFiles.push(filePath);
    }
  }
  if (!audioFiles.length && !videoFiles.length) {
    throw new Error(`No supported files were found in ${directoryPath}.`);
  }
  if (audioFiles.length && videoFiles.length) {
    throw new Error(
      `Batch translate_dub directory contains both audio and video files, which is not supported. Split them into separate folders (or pass only one type via --from-files). Directory: ${directoryPath}.`
    );
  }
  return videoFiles.length ? videoFiles : audioFiles;
}
function omitProjectRaw(project) {
  const { raw: _raw, ...rest } = project;
  return rest;
}
function parseLanguageToolKind(kind) {
  const parsed = parseDetailKind(kind);
  if (parsed === "audio-translation" || parsed === "talking-photo") {
    throw new Error(
      "`project languages` only supports translate_dub, translate_subtitles, visual_translate, or lipsync."
    );
  }
  return parsed;
}
function registerToolDetailCommands(tool, kind, downloadArtifactHelp, exportArtifactHelp) {
  tool.command("get <id>").description("Get a single project").action(async (id) => {
    const detail = await getProject({ id, kind });
    printJson({ project: omitProjectRaw(detail.project) });
  });
  tool.command("open <id>").description("Return a project preview URL").action(async (id) => {
    printJson(await openProject({ id, kind }));
  });
  const exportCommand = tool.command("export <id>").description("Start a backend export for a project");
  if (exportArtifactHelp) {
    exportCommand.option("--artifact <type>", exportArtifactHelp);
  }
  exportCommand.action(async (id, options) => {
    const result = await exportProject({
      artifact: options.artifact,
      id,
      kind
    });
    printJson({ ...result, project: omitProjectRaw(result.project) });
  });
  tool.command("download <id>").description("Download a project output").requiredOption("--artifact <type>", downloadArtifactHelp).option(
    "--output <path>",
    "Local output path; pass a directory (or trailing `/`) to use the product file naming (e.g. `{title}_{language}_translated.mp4`, `{title}_{language}_subtitles.srt`)"
  ).action(async (id, options) => {
    const checkOnly = process.env.VOZO_CLI_DOWNLOAD_CHECK === "1";
    if (!checkOnly && !options.output) {
      throw new Error("Provide --output <path> to download this artifact.");
    }
    try {
      printJson(
        await downloadProjectArtifact({
          artifact: options.artifact,
          checkOnly,
          id,
          kind,
          outputPath: options.output
        })
      );
    } catch (error) {
      printJson({
        artifact: options.artifact,
        id,
        kind,
        message: buildFriendlyDownloadErrorMessage({
          artifact: options.artifact,
          error,
          outputPath: options.output
        }),
        status: "failed"
      });
      process.exitCode = 1;
    }
  });
}
function registerProjectCommands(program) {
  const project = program.command("project").description("Manage projects");
  project.command("languages <kind>").description(
    "Show supported original/target languages for translate_dub, translate_subtitles, visual_translate, or lipsync"
  ).action((kind) => {
    printJson(getProjectLanguageCapabilities(parseLanguageToolKind(kind)));
  });
  addCommonListOptions(
    project.command("list").description("List projects")
  ).action(async (options) => {
    const folderId = await resolveListFolderId(options);
    printJson(
      await listProjects({
        cursor: options.cursor,
        folderId,
        kind: parseProjectKind(options.kind),
        limit: parseListLimitOption(options.limit),
        searchKey: ""
      })
    );
  });
  addCommonListOptions(
    project.command("search <query>").description("Search projects by keyword")
  ).action(async (query, options) => {
    const folderId = await resolveListFolderId(options);
    printJson(
      await listProjects({
        cursor: options.cursor,
        folderId,
        kind: parseProjectKind(options.kind),
        limit: parseListLimitOption(options.limit),
        searchKey: String(query).trim()
      })
    );
  });
  project.command("delete <ids...>").description("Delete one or more projects").action(async (ids) => {
    printJson(await deleteProjects({ ids }));
  });
  const folder = project.command("folder").description("Manage project folders");
  folder.command("list").description("List project folders").action(async () => {
    printJson(await listProjectFolders());
  });
  folder.command("create <name>").description("Create a project folder").action(async (name) => {
    printJson(await createProjectFolder({ folderName: String(name) }));
  });
  folder.command("search <query>").description("Search project folders by name").action(async (query) => {
    printJson(await searchProjectFolders({ query: String(query) }));
  });
  const translateDub = project.command("translate_dub").description("Manage translate dub projects");
  translateDub.command("create").description(
    "Create a translate dub project (kind: translate_dub) from a source URL"
  ).requiredOption(
    "--target-language <language>",
    "Target language code or locale tag (e.g. zh, en-AU, zh-HK)",
    parseTargetLanguageOption
  ).option("--from-url <url>", "Source video URL").option("--from-file <path>", "Source local video or audio file").option(
    "--from-files <paths...>",
    "Batch source local video or audio files"
  ).option("--from-dir <path>", "Batch source local video or audio directory").option("--folder <folderId>", "Create inside a folder").option(
    "--original-language <language>",
    "Original language code or `auto`",
    parseOriginalLanguageOption,
    "auto"
  ).option(
    "--speaker-number <count>",
    "Speaker number preset: Auto, 1, 2, 3+",
    parseSpeakerNumberOption,
    "Auto"
  ).option(
    "--dub-preference <mode>",
    "Dub voice mode: auto, real, native",
    parseDubPreference,
    "auto"
  ).option("--enable-subtitles", "Enable subtitles in the translated output").option(
    "--remove-original-subtitle",
    "Remove original subtitle tracks when subtitles are enabled"
  ).option(
    "--auto-align-video",
    "Enable video alignment for the translated output"
  ).option(
    "--proofread-before-dubbing",
    "Run proofreading before dubbing starts"
  ).option(
    "--prompt <text>",
    "Optional translation prompt (max 1000 characters)",
    parseUserPrompt
  ).option(
    "--subtitle-file <path>",
    "Optional local subtitle file (.srt / .vtt / .txt) to upload with the video"
  ).option(
    "--subtitle-usage <mode>",
    "How to use --subtitle-file: original (source script) or translated (final script)",
    parseSubtitleUsage,
    "original"
  ).option(
    "--glossary <ids...>",
    "Glossary ID list, separated by spaces or commas"
  ).action(async (options, command) => {
    validateTranslationCreateOptions(options);
    if ((options.fromFiles?.length || options.fromDir) && command.getOptionValueSource("speakerNumber") === "cli") {
      throw new Error(
        "`--speaker-number` is only supported for single-file or URL creates. Remove it for batch creation; batch dub always detects speakers automatically."
      );
    }
    assertSupportedProjectLanguage({
      field: "target-language",
      kind: "translate_dub",
      value: options.targetLanguage
    });
    assertSupportedProjectLanguage({
      field: "original-language",
      kind: "translate_dub",
      value: options.originalLanguage
    });
    const glossaryIdList = collectGlossaryIdList(options.glossary);
    if (countDefinedSources([
      options.fromUrl,
      options.fromFile,
      options.fromFiles,
      options.fromDir
    ]) !== 1) {
      throw new Error(
        "Provide exactly one source: `--from-url <url>`, `--from-file <path>`, `--from-files <paths...>`, or `--from-dir <path>`."
      );
    }
    assertSingleSourceOnlyOptions(options);
    if (options.fromFile) {
      const result2 = await createTranslationProjectFromFile({
        autoAlignVideo: Boolean(options.autoAlignVideo),
        dubPreference: options.dubPreference,
        enableSubtitles: Boolean(options.enableSubtitles),
        filePath: options.fromFile,
        folderId: options.folder,
        glossaryIdList,
        originalLanguage: options.originalLanguage,
        proofreadBeforeDubbing: Boolean(options.proofreadBeforeDubbing),
        removeOriginalSubtitle: Boolean(options.removeOriginalSubtitle),
        speakerNumber: options.speakerNumber,
        subtitleFilePath: options.subtitleFile,
        subtitleUsage: options.subtitleFile ? options.subtitleUsage : void 0,
        targetLanguage: options.targetLanguage,
        userPrompt: options.prompt
      });
      emitWarnings(result2);
      printJson(result2);
      return;
    }
    if (options.fromFiles?.length) {
      const result2 = await batchCreateTranslationProjectsFromFiles({
        autoAlignVideo: Boolean(options.autoAlignVideo),
        dubPreference: options.dubPreference,
        enableSubtitles: Boolean(options.enableSubtitles),
        filePaths: options.fromFiles,
        folderId: options.folder,
        glossaryIdList,
        originalLanguage: options.originalLanguage,
        proofreadBeforeDubbing: Boolean(options.proofreadBeforeDubbing),
        removeOriginalSubtitle: Boolean(options.removeOriginalSubtitle),
        targetLanguage: options.targetLanguage,
        userPrompt: options.prompt
      });
      emitWarnings(result2);
      printJson(result2);
      return;
    }
    if (options.fromDir) {
      const result2 = await batchCreateTranslationProjectsFromFiles({
        autoAlignVideo: Boolean(options.autoAlignVideo),
        dubPreference: options.dubPreference,
        enableSubtitles: Boolean(options.enableSubtitles),
        filePaths: await resolveDirectorySourceFilesForDub(options.fromDir),
        folderId: options.folder,
        glossaryIdList,
        originalLanguage: options.originalLanguage,
        proofreadBeforeDubbing: Boolean(options.proofreadBeforeDubbing),
        removeOriginalSubtitle: Boolean(options.removeOriginalSubtitle),
        targetLanguage: options.targetLanguage,
        userPrompt: options.prompt
      });
      emitWarnings(result2);
      printJson(result2);
      return;
    }
    const result = await createTranslationProjectFromUrl({
      autoAlignVideo: Boolean(options.autoAlignVideo),
      dubPreference: options.dubPreference,
      enableSubtitles: Boolean(options.enableSubtitles),
      folderId: options.folder,
      glossaryIdList,
      originalLanguage: options.originalLanguage,
      proofreadBeforeDubbing: Boolean(options.proofreadBeforeDubbing),
      removeOriginalSubtitle: Boolean(options.removeOriginalSubtitle),
      sourceUrl: options.fromUrl,
      speakerNumber: options.speakerNumber,
      targetLanguage: options.targetLanguage,
      userPrompt: options.prompt
    });
    emitWarnings(result);
    printJson(result);
  });
  registerToolDetailCommands(
    translateDub,
    "translate_dub",
    "Artifact type: dubbed_video, dubbed_audio, dubbed_audio_mp3, background_audio, original_subtitle_srt, original_subtitle_vtt, original_subtitle_txt, translated_subtitle_srt, translated_subtitle_vtt, translated_subtitle_txt",
    "Export artifact type: dubbed_video, dubbed_audio, dubbed_audio_mp3 (default: dubbed_video)"
  );
  const translateSubtitles = project.command("translate_subtitles").description("Manage translate subtitles projects");
  translateSubtitles.command("create").description(
    "Create a translate subtitles project (kind: translate_subtitles) from a source URL"
  ).requiredOption(
    "--target-language <language>",
    "Target language code or locale tag (e.g. zh, en-AU, zh-HK)",
    parseTargetLanguageOption
  ).option("--from-url <url>", "Source video URL").option("--from-file <path>", "Source local video file").option("--from-files <paths...>", "Batch source local video files").option("--from-dir <path>", "Batch source local video directory").option("--folder <folderId>", "Create inside a folder").option(
    "--original-language <language>",
    "Original language code or `auto`",
    parseOriginalLanguageOption,
    "auto"
  ).option(
    "--subtitle-display <mode>",
    "Subtitle display mode: translated_only, original_translated",
    parseSubtitleDisplayType,
    "translated_only"
  ).option(
    "--remove-original-subtitle",
    "Remove original subtitle tracks from the output"
  ).option(
    "--prompt <text>",
    "Optional translation prompt (max 1000 characters)",
    parseUserPrompt
  ).option(
    "--subtitle-file <path>",
    "Optional local subtitle file (.srt / .vtt / .txt) to upload with the video"
  ).option(
    "--subtitle-usage <mode>",
    "How to use --subtitle-file: original (source script) or translated (final script)",
    parseSubtitleUsage,
    "original"
  ).option(
    "--glossary <ids...>",
    "Glossary ID list, separated by spaces or commas"
  ).action(async (options) => {
    assertSupportedProjectLanguage({
      field: "target-language",
      kind: "translate_subtitles",
      value: options.targetLanguage
    });
    assertSupportedProjectLanguage({
      field: "original-language",
      kind: "translate_subtitles",
      value: options.originalLanguage
    });
    const glossaryIdList = collectGlossaryIdList(options.glossary);
    if (countDefinedSources([
      options.fromUrl,
      options.fromFile,
      options.fromFiles,
      options.fromDir
    ]) !== 1) {
      throw new Error(
        "Provide exactly one source: `--from-url <url>`, `--from-file <path>`, `--from-files <paths...>`, or `--from-dir <path>`."
      );
    }
    assertSingleSourceOnlyOptions(options);
    if (options.fromFile) {
      printJson(
        await createCaptionProjectFromFile({
          filePath: options.fromFile,
          folderId: options.folder,
          glossaryIdList,
          originalLanguage: options.originalLanguage,
          removeOriginalSubtitle: Boolean(options.removeOriginalSubtitle),
          subtitleDisplayType: options.subtitleDisplay,
          subtitleFilePath: options.subtitleFile,
          subtitleUsage: options.subtitleFile ? options.subtitleUsage : void 0,
          targetLanguage: options.targetLanguage,
          userPrompt: options.prompt
        })
      );
      return;
    }
    if (options.fromFiles?.length) {
      const invalid = options.fromFiles.find((filePath) => {
        return inferLocalMediaType(filePath) !== "video";
      });
      if (invalid) {
        throw new Error(
          `translate_subtitles does not support audio files: detected non-video input ${invalid}. Provide video files only, or use translate_dub instead.`
        );
      }
      const result = await batchCreateCaptionProjectsFromFiles({
        filePaths: options.fromFiles,
        folderId: options.folder,
        glossaryIdList,
        originalLanguage: options.originalLanguage,
        removeOriginalSubtitle: Boolean(options.removeOriginalSubtitle),
        subtitleDisplayType: options.subtitleDisplay,
        targetLanguage: options.targetLanguage,
        userPrompt: options.prompt
      });
      emitWarnings(result);
      printJson(result);
      return;
    }
    if (options.fromDir) {
      const result = await batchCreateCaptionProjectsFromFiles({
        filePaths: await resolveDirectorySourceFiles(options.fromDir, [
          "video"
        ]),
        folderId: options.folder,
        glossaryIdList,
        originalLanguage: options.originalLanguage,
        removeOriginalSubtitle: Boolean(options.removeOriginalSubtitle),
        subtitleDisplayType: options.subtitleDisplay,
        targetLanguage: options.targetLanguage,
        userPrompt: options.prompt
      });
      emitWarnings(result);
      printJson(result);
      return;
    }
    printJson(
      await createCaptionProjectFromUrl({
        folderId: options.folder,
        glossaryIdList,
        originalLanguage: options.originalLanguage,
        removeOriginalSubtitle: Boolean(options.removeOriginalSubtitle),
        sourceUrl: options.fromUrl,
        subtitleDisplayType: options.subtitleDisplay,
        targetLanguage: options.targetLanguage,
        userPrompt: options.prompt
      })
    );
  });
  registerToolDetailCommands(
    translateSubtitles,
    "translate_subtitles",
    "Artifact type: translation_subtitle, original_subtitle_srt, original_subtitle_vtt, original_subtitle_txt, translated_subtitle_srt, translated_subtitle_vtt, translated_subtitle_txt"
  );
  const visualTranslate = project.command("visual_translate").description("Manage visual translate projects");
  visualTranslate.command("fonts").description(
    "List preset fonts and your uploaded fonts for --font-family / --font-src"
  ).action(async () => {
    printJson(await getVisualTranslateFonts());
  });
  visualTranslate.command("create").description(
    "Create a visual translate project (kind: visual_translate) from a source URL"
  ).requiredOption(
    "--target-language <language>",
    "Target language code or locale tag (e.g. zh, en-AU, zh-HK)",
    parseTargetLanguageOption
  ).option("--from-url <url>", "Source video URL").option("--from-file <path>", "Source local video file").option("--from-files <paths...>", "Batch source local video files").option("--from-dir <path>", "Batch source local video directory").option("--folder <folderId>", "Create inside a folder").requiredOption(
    "--original-language <language>",
    "Original language code. `auto` is not supported for visual translate",
    parseRequiredFrameOriginalLanguage
  ).option(
    "--prompt <text>",
    "Optional translation prompt (max 1000 characters)",
    parseUserPrompt
  ).option(
    "--glossary <ids...>",
    "Glossary ID list, separated by spaces or commas"
  ).option("--font-family <name>", "Custom font family name for the output").option("--font-src <url>", "Custom font source URL for the output").option(
    "--font-file <path>",
    "Upload a local custom font file (.ttf / .otf); when set, --font-family / --font-src are ignored"
  ).action(async (options) => {
    const originalLanguage = options.originalLanguage;
    assertSupportedProjectLanguage({
      field: "target-language",
      kind: "visual_translate",
      value: options.targetLanguage
    });
    assertSupportedProjectLanguage({
      field: "original-language",
      kind: "visual_translate",
      value: originalLanguage
    });
    const glossaryIdList = collectGlossaryIdList(options.glossary);
    if (countDefinedSources([
      options.fromUrl,
      options.fromFile,
      options.fromFiles,
      options.fromDir
    ]) !== 1) {
      throw new Error(
        "Provide exactly one source: `--from-url <url>`, `--from-file <path>`, `--from-files <paths...>`, or `--from-dir <path>`."
      );
    }
    assertSingleSourceOnlyOptions(options);
    if (options.fromFile) {
      const result2 = await createFrameTranslationProjectFromFile({
        filePath: options.fromFile,
        folderId: options.folder,
        fontFamily: options.fontFamily,
        fontFilePath: options.fontFile,
        fontSrc: options.fontSrc,
        glossaryIdList,
        originalLanguage,
        targetLanguage: options.targetLanguage,
        userPrompt: options.prompt
      });
      emitWarnings(result2);
      printJson(result2);
      return;
    }
    if (options.fromFiles?.length) {
      const result2 = await batchCreateFrameTranslationProjectsFromFiles({
        filePaths: options.fromFiles,
        folderId: options.folder,
        fontFamily: options.fontFamily,
        fontFilePath: options.fontFile,
        fontSrc: options.fontSrc,
        glossaryIdList,
        originalLanguage,
        targetLanguage: options.targetLanguage,
        userPrompt: options.prompt
      });
      emitWarnings(result2);
      printJson(result2);
      return;
    }
    if (options.fromDir) {
      const result2 = await batchCreateFrameTranslationProjectsFromFiles({
        filePaths: await resolveDirectorySourceFiles(options.fromDir, [
          "video"
        ]),
        folderId: options.folder,
        fontFamily: options.fontFamily,
        fontFilePath: options.fontFile,
        fontSrc: options.fontSrc,
        glossaryIdList,
        originalLanguage,
        targetLanguage: options.targetLanguage,
        userPrompt: options.prompt
      });
      emitWarnings(result2);
      printJson(result2);
      return;
    }
    const result = await createFrameTranslationProjectFromUrl({
      folderId: options.folder,
      fontFamily: options.fontFamily,
      fontFilePath: options.fontFile,
      fontSrc: options.fontSrc,
      glossaryIdList,
      originalLanguage,
      sourceUrl: options.fromUrl,
      targetLanguage: options.targetLanguage,
      userPrompt: options.prompt
    });
    emitWarnings(result);
    printJson(result);
  });
  registerToolDetailCommands(
    visualTranslate,
    "visual_translate",
    "Artifact type: visual_translation"
  );
  const lipsync = project.command("lipsync").description("Manage lipsync projects");
  lipsync.command("create").description("Create a lipsync project using audio from the source video").option("--from-translation <id>", "Source translation project ID").option("--from-url <url>", "Source video URL").option("--from-file <path>", "Source local video file").option("--from-files <paths...>", "Batch source local video files").option("--from-dir <path>", "Batch source local video directory").option("--folder <folderId>", "Create inside a folder").requiredOption(
    "--face-mode <mode>",
    "Face mode: single or more (required)",
    parseFaceMode
  ).action(async (options) => {
    if (countDefinedSources([
      options.fromTranslation,
      options.fromUrl,
      options.fromFile,
      options.fromFiles,
      options.fromDir
    ]) !== 1) {
      throw new Error(
        "Provide exactly one source: `--from-translation <id>`, `--from-url <url>`, `--from-file <path>`, `--from-files <paths...>`, or `--from-dir <path>`."
      );
    }
    if (options.fromTranslation) {
      printJson(
        await createLipsyncProjectFromTranslation({
          faceMode: options.faceMode,
          folderId: options.folder,
          translationId: options.fromTranslation
        })
      );
      return;
    }
    if (options.fromFile) {
      printJson(
        await createLipsyncProjectFromFile({
          faceMode: options.faceMode,
          filePath: options.fromFile,
          folderId: options.folder
        })
      );
      return;
    }
    if (options.fromFiles?.length) {
      const result = await batchCreateLipsyncProjectsFromFiles({
        faceMode: options.faceMode,
        filePaths: options.fromFiles,
        folderId: options.folder
      });
      emitWarnings(result);
      printJson(result);
      return;
    }
    if (options.fromDir) {
      const result = await batchCreateLipsyncProjectsFromFiles({
        faceMode: options.faceMode,
        filePaths: await resolveDirectorySourceFiles(options.fromDir, [
          "video"
        ]),
        folderId: options.folder
      });
      emitWarnings(result);
      printJson(result);
      return;
    }
    printJson(
      await createLipsyncProjectFromUrl({
        faceMode: options.faceMode,
        folderId: options.folder,
        sourceUrl: options.fromUrl
      })
    );
  });
  registerToolDetailCommands(
    lipsync,
    "lipsync",
    "Artifact type: lipsync_video"
  );
}

// src/commands/skills.ts
function parseSkillTarget(value) {
  if (value === "cursor" || value === "codex" || value === "claude-code" || value === "workbuddy" || value === "agents" || value === "all") {
    return value;
  }
  throw new Error(
    `Invalid --target "${value}". Use cursor, codex, claude-code, workbuddy, agents, or all.`
  );
}
function registerSkillsCommands(program) {
  const skills = program.command("skills").description("List and install bundled agent skills");
  skills.command("list").description("List skills bundled with this CLI package").action(() => {
    printJson({
      skills: listBundledSkills().map((skill) => ({
        name: skill.name,
        description: skill.description
      }))
    });
  });
  skills.command("install").description(
    "Install bundled skills into the skills directories of detected agents (~/.cursor, ~/.codex, ~/.claude, ~/.workbuddy, ~/.agents); agents that are not installed are skipped"
  ).option(
    "--target <target>",
    "cursor, codex, claude-code, workbuddy, agents, or all",
    "all"
  ).option("--skill <name>", "Install only one skill; repeatable", collect, []).option(
    "--link",
    "Create symlinks instead of copying (useful for monorepo development)"
  ).option(
    "--path <dir>",
    "Install into this directory instead of auto-detected agent directories"
  ).option("--dry-run", "Show what would be installed without writing files").action((options) => {
    const result = installBundledSkills({
      target: parseSkillTarget(options.target),
      skillNames: options.skill.length > 0 ? options.skill : void 0,
      link: Boolean(options.link),
      path: options.path,
      dryRun: Boolean(options.dryRun)
    });
    printJson(result);
    const verb = result.dryRun ? "Would install" : "Installed";
    for (const item of result.installed) {
      printStderr(
        `${verb} ${item.skill} -> ${item.targetDir}/${item.skill} (${item.mode})`
      );
    }
    for (const item of result.skipped) {
      printStderr(`Skipped ${item.target}: ${item.reason}`);
    }
  });
}
function collect(value, previous) {
  return previous.concat(value);
}

// src/commands/upgrade.ts
function registerUpgradeCommands(program) {
  program.command("upgrade").description(
    "Upgrade vozo-cli from its GitHub distribution repo (npm install -g), then reinstall bundled skills"
  ).option(
    "--repo <git-url>",
    "Override the distribution repo (default: built-in repository URL or VOZO_CLI_UPGRADE_REPO)"
  ).option("--tag <ref>", "Install a specific tag/branch, e.g. v0.0.2").option("--skip-skills", "Do not run `skills install` after upgrading").action(async (options) => {
    printJson(
      await runCliUpgrade({
        ref: options.tag,
        repoUrl: options.repo,
        skipSkills: Boolean(options.skipSkills)
      })
    );
  });
}

// src/program.ts
function buildCli() {
  const program = new Command();
  program.name("vozo-cli").description("Vozo CLI").showHelpAfterError().version(CLI_VERSION);
  registerInstallCommands(program);
  registerAuthCommands(program);
  registerProjectCommands(program);
  registerSkillsCommands(program);
  registerUpgradeCommands(program);
  return program;
}

export {
  CLI_VERSION,
  formatCliVersionForApiHeader,
  CLI_VERSION_API_HEADER,
  resolveUpgradeRepoUrl,
  noteCliUpgradeSuggestion,
  attachCliUpgradeSuggestion,
  resetCliUpgradeSuggestState,
  printJson,
  printStderr,
  buildNetworkRequestError,
  CliApiError,
  CliUpgradeRequiredError,
  CliNetworkError,
  buildCliCommandErrorPayload,
  setCliClientRegion,
  clearCliClientRegion,
  getCliClientRegion,
  resolveCliRequestLanguage,
  resolveCliRequestTimezone,
  buildDefaultApiRequestHeaders,
  prefetchCliClientRegion,
  isCliUpgradeExemptRequest,
  resolveCliUpgradeHint,
  buildCliUpgradeRequiredError,
  warnCliUpgradeIfSuggested,
  handleCliUpgradeHeaders,
  assertNoCliUpgradeRequired,
  getSessionFilePath,
  readStoredSession,
  writeStoredSession,
  clearStoredSession,
  createDeviceId,
  createAuthCallbackListener,
  loginWithEmail,
  requestEmailLoginCode,
  completeEmailLogin,
  loginWithAccessToken,
  loginWithBrowser,
  waitForAuthenticatedSession,
  startBrowserLoginInBackground,
  getAuthStatus,
  logout,
  FILE_SIZE_LIMIT_BYTES,
  BATCH_CREATE_MAX_FILES,
  assertBatchFileCountAllowed,
  DEFAULT_VIDEO_RESOLUTION_LIMIT,
  LIPSYNC_1080P_PIXEL_LIMIT,
  LIPSYNC_DURATION_4K_MAX_SECONDS,
  exceedsVideoResolutionLimit,
  assertVideoResolutionAllowed,
  assertLipsyncVideoConstraints,
  assertCreateVideoResolutionAllowed,
  DURATION_HARD_LIMIT_SECONDS,
  normalizeMembershipUserType,
  deriveMembershipFlags,
  tierMaxUploadSeconds,
  MAX_USER_PROMPT_LENGTH,
  assertUserPromptLength,
  parseUserPrompt,
  assertMembershipForCreateOptions,
  parseSpeakerNumber,
  parseDubPreference,
  parseSubtitleDisplayType,
  parseFaceMode,
  parseSubtitleUsage,
  parseLanguageInput,
  calcTotalPoints,
  estimateConsumedPoints,
  snakeToCamelKey,
  normalizePermissionMap,
  getUserProfile,
  getUserMembership,
  getUserPoints,
  getUserMembershipStatus,
  getUserPointsStatus,
  getUserFeatureConfig,
  refreshCliClientRegion,
  getUserSummary,
  USER_PERMISSIONS,
  isTeamAccessSuspended,
  hasUserPermission,
  buildPermissionDeniedError,
  assertUserPermission,
  requireUserPermission,
  buildUpgradeInstallSpec,
  runCliUpgrade,
  resolveInstallSpec,
  runCliInstall,
  buildUndetectableMediaDurationError,
  FONT_FILE_SIZE_LIMIT_BYTES,
  listUserFonts,
  assertFontFileForUpload,
  uploadUserFontFromFile,
  parseVisualTranslateFontOptions,
  materializeVisualTranslateFont,
  getVisualTranslateFonts,
  resolveOriginalLanguageLabel,
  resolveTargetLanguageLabel,
  resolveTargetLocaleLabel,
  resolveLanguageCapabilityLabel,
  enrichProjectLanguageLabels,
  getProjectLanguageCapabilities,
  assertSupportedProjectLanguage,
  requireProjectLanguage,
  resolveCreateTargetLanguageAndLocale,
  resolveProjectErrorInfo,
  resolveEffectiveDurationMaxSeconds,
  assertCaptionDurationQuotaAllowed,
  evaluatePointsAllowanceForCreate,
  assertCreateAllowed,
  MAX_PROJECT_TITLE_LENGTH,
  truncateProjectTitle,
  resolveProjectTitle,
  SUBTITLE_FILE_SIZE_LIMIT_BYTES,
  validateSubtitleFileContent,
  assertSubtitleFileForTranslation,
  TRANSLATE_DUB_PROCESSING_STATUSES,
  TRANSLATE_SUBTITLES_PROCESSING_STATUSES,
  LIPSYNC_PROCESSING_STATUSES,
  BLOCK_PROCESSING_STATUSES,
  isBlockProcessingStatus,
  hasTranslationBlocksInProcessing,
  SUBTITLE_SEGMENT_PROCESSING_STATUSES,
  isSubtitleSegmentProcessingStatus,
  hasSubtitleSegmentsInProcessing,
  hasCaptionSegmentsMissingSubtitles,
  shouldInitCaptionSubtitles,
  isAsrProcessingStatus,
  hasAsrInProcessing,
  CALLOUT_TEXT_EXPORT_BLOCKED_STATUSES,
  isCalloutTextExportBlockedStatus,
  hasCalloutTextsInProcessing,
  getLatestLipsyncVariant,
  resolveLipsyncEffectiveStatus,
  resolveProjectExportGuardStatus,
  EXPORT_BLOCKED_PROCESSING_STATUSES,
  normalizeProjectStatus,
  isExportBlockedProcessingStatus,
  isProjectCurrentlyExporting,
  isExportBlockedFailedStatus,
  assertProjectNotFailedForArtifactAccess,
  assertProjectNotAwaitingProofreadingForDownload,
  assertProjectNotCurrentlyExporting,
  generateSubtitleContent,
  isSubtitleArtifact,
  parseSubtitleArtifact,
  extractSubtitleSections,
  inferSubtitleOutputPath,
  buildSubtitleFileName,
  buildProjectWebUrl,
  buildProjectOpenUrl,
  resolveProjectArtifactType,
  resolveProjectArtifactSourceUrl,
  PROJECT_NOT_FOUND_MESSAGE,
  isProjectNotFoundError,
  buildProjectNotFoundError,
  shouldFallbackToAudioTranslationDetail,
  parseProjectKind,
  resolveProjectListNextCursor,
  buildCliProjectListPage,
  listProjects,
  getProject,
  exportProject,
  buildMediaArtifactFileNameBase,
  downloadProjectArtifact,
  openProject,
  deleteProjects,
  listProjectFolders,
  findProjectFolderByExactName,
  assertReviewerCannotCreateProjectFolder,
  createProjectFolder,
  filterProjectFolders,
  searchProjectFolders,
  findProjectFolderById,
  resolveProjectFolderId,
  createTranslationProjectFromUrl,
  createTranslationProjectFromFile,
  batchCreateTranslationProjectsFromFiles,
  createCaptionProjectFromUrl,
  createCaptionProjectFromFile,
  batchCreateCaptionProjectsFromFiles,
  createFrameTranslationProjectFromUrl,
  createFrameTranslationProjectFromFile,
  batchCreateFrameTranslationProjectsFromFiles,
  createLipsyncProjectFromUrl,
  createLipsyncProjectFromFile,
  batchCreateLipsyncProjectsFromFiles,
  createLipsyncProjectFromTranslation,
  resolveWorkbuddySkillsDir,
  getBundledSkillsDir,
  listBundledSkills,
  installBundledSkills,
  buildCli
};
//# sourceMappingURL=chunk-3OP5HOYE.mjs.map