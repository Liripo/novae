/**
 * Unit tests for src/components/chat/tool-renderers/groupToolCalls.ts — run via:
 *   npx esbuild src/components/chat/tool-renderers/groupToolCalls.ts --bundle --format=esm \
 *     --outfile=scripts/.toolGroup.bundle.mjs && node scripts/test-toolGroup.mjs
 * (esbuild comes with vite; no extra test framework needed.)
 */
import assert from 'node:assert/strict';

import {
	groupToolCalls,
	groupStatus,
	countFailed,
	isGroupRunning,
} from './.toolGroup.bundle.mjs';

// ── 测试辅助：构造最小 tool_call / tool_result 块 ─────────────────────
const call = (id, name = 'Bash', state = 'finished') => ({
	type: 'tool_call',
	id,
	name,
	input: `input-${id}`,
	state,
});
const result = (id, name = 'Bash', state = 'success') => ({
	type: 'tool_result',
	id,
	name,
	output: `output-${id}`,
	state,
});
const text = (txt) => ({ type: 'text', text: txt });

// ── 1. 连续工具调用（含并发交叉布局）合并为一个分组 ───────────────────
{
	const blocks = [
		call('c1', 'Glob'),
		call('c2', 'Grep'),
		result('c1', 'Glob'),
		result('c2', 'Grep'),
	];
	const grouped = groupToolCalls(blocks);
	assert.equal(grouped.length, 1);
	assert.equal(grouped[0].type, 'tool_call_group');
	assert.equal(grouped[0].id, 'group-c1'); // 确定性 id：取首个 call
	assert.equal(grouped[0].calls.length, 2);
	// 结果按 id 正确配对（交叉布局不错配）
	assert.equal(grouped[0].calls[0].result.output, 'output-c1');
	assert.equal(grouped[0].calls[1].result.output, 'output-c2');
}

// ── 2. 文本块是分组边界：两侧的工具调用不合并 ─────────────────────────
{
	const blocks = [call('c1'), result('c1'), text('中间说明'), call('c2'), result('c2')];
	const grouped = groupToolCalls(blocks);
	assert.equal(grouped.length, 3);
	assert.equal(grouped[0].type, 'tool_call_group');
	assert.equal(grouped[0].calls.length, 1);
	assert.equal(grouped[1].type, 'text');
	assert.equal(grouped[2].type, 'tool_call_group');
	assert.equal(grouped[2].id, 'group-c2');
}

// ── 3. 孤儿 result（无匹配 call）追加为合成单条分组 ───────────────────
{
	const grouped = groupToolCalls([result('orphan1')]);
	assert.equal(grouped.length, 1);
	assert.equal(grouped[0].type, 'tool_call_group');
	assert.equal(grouped[0].id, 'group-orphan-orphan1');
	assert.equal(grouped[0].calls[0].call.state, 'finished'); // 占位 call
	assert.equal(grouped[0].calls[0].result.output, 'output-orphan1');
}

// ── 4. 无工具块时原样透传 ─────────────────────────────────────────────
{
	const blocks = [text('a'), text('b')];
	const grouped = groupToolCalls(blocks);
	assert.deepEqual(grouped, blocks);
}

// ── 5. groupStatus 优先级：running > error > interrupted > success ────
{
	// 有 call 未收到 result → running
	assert.equal(groupStatus([{ call: call('c1') }]), 'running');
	// asking 状态视为 running（等待用户授权，阻塞流水线）
	assert.equal(
		groupStatus([{ call: call('c1', 'Bash', 'asking') }]),
		'running',
	);
	// error 优先于 interrupted
	assert.equal(
		groupStatus([
			{ call: call('c1'), result: result('c1', 'Bash', 'interrupted') },
			{ call: call('c2'), result: result('c2', 'Bash', 'error') },
		]),
		'error',
	);
	// denied 也算 error
	assert.equal(
		groupStatus([{ call: call('c1'), result: result('c1', 'Bash', 'denied') }]),
		'error',
	);
	// 全部成功
	assert.equal(
		groupStatus([
			{ call: call('c1'), result: result('c1') },
			{ call: call('c2'), result: result('c2') },
		]),
		'success',
	);
	// 仅中断
	assert.equal(
		groupStatus([{ call: call('c1'), result: result('c1', 'Bash', 'interrupted') }]),
		'interrupted',
	);
}

// ── 6. countFailed 统计 error + denied ────────────────────────────────
{
	const calls = [
		{ call: call('c1'), result: result('c1', 'Bash', 'error') },
		{ call: call('c2'), result: result('c2', 'Bash', 'denied') },
		{ call: call('c3'), result: result('c3') },
	];
	assert.equal(countFailed(calls), 2);
	assert.equal(countFailed([]), 0);
}

// ── 7. isGroupRunning 覆盖各运行态 ────────────────────────────────────
{
	assert.equal(isGroupRunning([{ call: call('c1', 'Bash', 'pending') }]), true);
	assert.equal(isGroupRunning([{ call: call('c1', 'Bash', 'allowed') }]), true);
	assert.equal(isGroupRunning([{ call: call('c1', 'Bash', 'submitted') }]), true);
	assert.equal(
		isGroupRunning([{ call: call('c1'), result: result('c1', 'Bash', 'running') }]),
		true,
	);
	assert.equal(
		isGroupRunning([{ call: call('c1'), result: result('c1') }]),
		false,
	);
}

console.log('test-toolGroup: all assertions passed');
