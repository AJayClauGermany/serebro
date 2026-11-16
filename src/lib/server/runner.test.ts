import type { StreamChunk } from '@tanstack/ai';
import { describe, expect, it } from '@effect/vitest';
import { Duration, Effect } from 'effect';
import { superviseAgentStream } from './runner.ts';

const chunk = (n: number) => ({ type: 'TEXT_MESSAGE_CONTENT', delta: String(n) }) as unknown as StreamChunk;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A fake agent: yields chunks with a delay and records whether it was closed. Like chat(),
 * it only notices it should stop while hanging through its abort controller (`stop`).
 */
function fakeAgent(opts: { count: number; every: number; thenHang?: boolean; throwAfter?: number }) {
	const abort = new AbortController();
	const state = { closed: false, stop: () => abort.abort() };
	const source: AsyncIterable<StreamChunk> = {
		async *[Symbol.asyncIterator]() {
			try {
				for (let i = 0; i < opts.count; i++) {
					if (opts.throwAfter === i) throw new Error('agent crashed');
					await sleep(opts.every);
					yield chunk(i);
				}
				if (opts.thenHang) await new Promise((resolve) => abort.signal.addEventListener('abort', resolve));
			} finally {
				state.closed = true;
			}
		}
	};
	return { source, state };
}

const collect = async (it: AsyncIterable<StreamChunk>) => {
	const out: Array<Record<string, unknown>> = [];
	for await (const c of it) out.push(c as never);
	return out;
};

const limits = (turn: number, idle: number) => ({
	turnTimeout: Duration.millis(turn),
	idleTimeout: Duration.millis(idle)
});

describe('superviseAgentStream', () => {
	it('passes chunks through and runs onChunk for each', async () => {
		const { source } = fakeAgent({ count: 3, every: 1 });
		const seen: StreamChunk[] = [];
		let stopped = false;
		const out = await collect(
			superviseAgentStream(source, {
				...limits(5_000, 5_000),
				stop: () => (stopped = true),
				onChunk: (c) => Effect.sync(() => void seen.push(c))
			})
		);
		expect(out.map((c) => c.delta)).toEqual(['0', '1', '2']);
		expect(seen.length).toBe(3);
		expect(stopped).toBe(false);
	});

	it('stops a silent agent after the idle timeout', async () => {
		const { source, state } = fakeAgent({ count: 1, every: 1, thenHang: true });
		let stopped = false;
		const stop = () => {
			stopped = true;
			state.stop();
		};
		const out = await collect(superviseAgentStream(source, { ...limits(5_000, 80), stop }));
		expect(out[0].delta).toBe('0');
		expect(out.at(-1)).toMatchObject({ type: 'RUN_ERROR' });
		expect(out.at(-1)?.message).toMatch(/without any output \(SEREBRO_IDLE_TIMEOUT\)/);
		expect(stopped).toBe(true);
		await sleep(20);
		expect(state.closed).toBe(true);
	});

	it('stops a busy agent after the turn timeout', async () => {
		const { source, state } = fakeAgent({ count: 10_000, every: 10 });
		let stopped = false;
		const out = await collect(superviseAgentStream(source, { ...limits(150, 5_000), stop: () => (stopped = true) }));
		expect(out.length).toBeGreaterThan(3);
		expect(out.at(-1)?.message).toMatch(/after running for .* \(SEREBRO_TURN_TIMEOUT\)/);
		expect(stopped).toBe(true);
		await sleep(20);
		expect(state.closed).toBe(true);
	});

	it('turns an agent exception into a RUN_ERROR', async () => {
		const { source } = fakeAgent({ count: 5, every: 1, throwAfter: 2 });
		let stopped = false;
		const out = await collect(superviseAgentStream(source, { ...limits(5_000, 5_000), stop: () => (stopped = true) }));
		expect(out.map((c) => c.type)).toEqual(['TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_CONTENT', 'RUN_ERROR']);
		expect(out.at(-1)?.message).toBe('agent crashed');
		expect(stopped).toBe(true);
	});

	it('closes the agent stream when the client stops reading', async () => {
		const { source, state } = fakeAgent({ count: 100, every: 5 });
		const it = superviseAgentStream(source, { ...limits(5_000, 5_000), stop: () => {} });
		for await (const _ of it) break;
		await sleep(20);
		expect(state.closed).toBe(true);
	});
});
