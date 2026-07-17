/**
 * Unit tests for src/utils/chatError.ts — run via:
 *   npx esbuild src/utils/chatError.ts --bundle --format=esm \
 *     --outfile=scripts/.chatError.bundle.mjs && node scripts/test-chatError.mjs
 * (esbuild comes with vite; no extra test framework needed.)
 */
import assert from 'node:assert/strict';

import {
	classifyChatError,
	chatErrorDetail,
	chatErrorMessage,
} from './.chatError.bundle.mjs';

const t = (k) => k; // echo the i18n key for assertions

// ── 429 / rate limit ────────────────────────────────────────────────
let info = classifyChatError({
	name: 'ApiError',
	status: 429,
	detail: '{"error":{"type":"FreeUsageLimitError","message":"Rate limit exceeded"}}',
});
assert.equal(info.kind, 'rateLimit');
assert.equal(info.useRaw, false);

info = classifyChatError(new Error('Attempt 5 failed: Rate limit exceeded. Retrying in 3.0s'));
assert.equal(info.kind, 'rateLimit');

info = classifyChatError({ status: 500, detail: '{"detail":{"code":1001,"msg":"FreeUsageLimitError"}}' });
assert.equal(info.kind, 'rateLimit');

// ── 409 / busy ──────────────────────────────────────────────────────
info = classifyChatError({
	name: 'ApiError',
	status: 409,
	detail: 'A chat run for session abc is already in flight.',
});
assert.equal(info.kind, 'busy');

// ── network ──────────────────────────────────────────────────────────
info = classifyChatError(new TypeError('Failed to fetch'));
assert.equal(info.kind, 'network');

info = classifyChatError(new Error('timeout of 30000ms exceeded'));
assert.equal(info.kind, 'network');

// ── unknown: clean short server message passes through ───────────────
info = classifyChatError({ name: 'ApiError', status: 401, detail: 'Invalid username or password.' });
assert.equal(info.kind, 'unknown');
assert.equal(info.useRaw, true);

// ── unknown: long / JSON / stack text is masked ──────────────────────
info = classifyChatError({
	name: 'ApiError',
	status: 500,
	detail: '{"detail":"Internal error: Traceback (most recent call last)..."}',
});
assert.equal(info.kind, 'unknown');
assert.equal(info.useRaw, false);

// ── message mapping ──────────────────────────────────────────────────
assert.equal(
	chatErrorMessage(t, { status: 429, detail: '{"error":"x"}' }),
	'chat.error.rateLimit',
);
assert.equal(
	chatErrorMessage(t, { status: 409, detail: 'already in flight' }),
	'chat.error.busy',
);
assert.equal(chatErrorMessage(t, new TypeError('Failed to fetch')), 'chat.error.network');
assert.equal(
	chatErrorMessage(t, { status: 500, detail: '{"detail":"dump"}' }),
	'chat.error.unknown',
);
assert.equal(
	chatErrorMessage(t, { status: 401, detail: 'Invalid username or password.' }),
	'Invalid username or password.',
);

// ── technical detail exposure ────────────────────────────────────────
assert.equal(
	chatErrorDetail({ status: 401, detail: 'Invalid username or password.' }),
	null,
);
assert.equal(
	chatErrorDetail({ status: 429, detail: '{"error":"x"}' }),
	'{"error":"x"}',
);

console.log('ALL CHAT-ERROR CHECKS PASSED');
