// src/utils/chatError.ts
var RATE_LIMIT_RE = /429|rate.?limit|too many requests|FreeUsageLimit|quota|限流/i;
var BUSY_RE = /409|already in flight|in progress/i;
var NETWORK_RE = /network|failed to fetch|fetch failed|timeout|timed out|ECONN|abort|网络/i;
var TECHNICAL_RE = /[{}\[\]\\]|\n|Traceback|Exception|\bError\b|status code|HTTP \d{3}|stack/i;
var RAW_OK_MAX_LEN = 120;
function extract(raw) {
  if (raw == null) return { text: "" };
  if (typeof raw === "string") return { text: raw };
  const e = raw;
  const status = typeof e.status === "number" ? e.status : void 0;
  const text = typeof e.detail === "string" && e.detail || typeof e.message === "string" && e.message || String(raw);
  return { status, text };
}
function classifyChatError(raw) {
  const { status, text } = extract(raw);
  let kind = "unknown";
  if (status === 429 || RATE_LIMIT_RE.test(text)) kind = "rateLimit";
  else if (status === 409 || BUSY_RE.test(text)) kind = "busy";
  else if (status === void 0 && (raw instanceof TypeError || NETWORK_RE.test(text)))
    kind = "network";
  const useRaw = kind === "unknown" && text.length > 0 && text.length <= RAW_OK_MAX_LEN && !TECHNICAL_RE.test(text);
  return { kind, detail: text, useRaw };
}
function chatErrorMessage(t, raw) {
  const info = classifyChatError(raw);
  if (info.useRaw) return info.detail;
  return t(`chat.error.${info.kind}`);
}
function chatErrorDetail(raw) {
  const info = classifyChatError(raw);
  if (!info.detail || info.useRaw) return null;
  return info.detail;
}
export {
  chatErrorDetail,
  chatErrorMessage,
  classifyChatError
};
