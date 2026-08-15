/**
 * @dsh-desktop/balance — host half.
 *
 * Runs inside the desktop app's in-process host composition:
 *   - reads the DeepSeek API key (env, then $DSH_HOME/.credentials.yaml)
 *   - polls https://api.deepseek.com/user/balance for the CNY balance
 *   - folds provider-reported token usage from the live `session/event`
 *     stream into a per-turn cost estimate (¥ per million-token price table)
 *   - pushes {balance, turnCost, sessionCost, model, key} to the renderer
 *     over the desktopUi service (the desktop carrier's send channel)
 *
 * Inert on non-desktop hosts (desktopUi absent).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';

const name = 'desktop-balance';

/** ¥ per million tokens; last-resort fallback for unlisted models. */
const PRICES = {
	'deepseek-chat': { miss: 2, hit: 0.5, out: 8 },
	'deepseek-reasoner': { miss: 4, hit: 1, out: 16 },
	'deepseek-v4-pro': { miss: 4, hit: 1, out: 16 },
};
const FALLBACK_PRICES = { miss: 2, hit: 0.5, out: 8 };

const BALANCE_ENDPOINT = process.env.DEEPSEEK_BALANCE_URL
	|| `${(process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com').replace(/\/+$/, '')}/user/balance`;
const TOP_UP_URL = 'https://platform.deepseek.com/top_up';

function readApiKey() {
	const envKey = process.env.DEEPSEEK_API_KEY;
	if (envKey !== undefined && envKey !== '') return envKey.trim();
	try {
		const text = readFileSync(join(resolveDshHome(), '.credentials.yaml'), 'utf8');
		const match = text.match(/^\s*DEEPSEEK_API_KEY\s*:\s*["']?([^"'\s#]+)/m);
		return match === null ? '' : match[1];
	} catch {
		return '';
	}
}

function activeModel(ctx) {
	try {
		const section = ctx.get('settings')?.get('agent-default-model');
		if (typeof section?.model === 'string' && section.model !== '') return section.model;
	} catch {
		/* fall through to default */
	}
	return 'deepseek-chat';
}

/** usage buckets → ¥, per the provider-reported usage shape. */
function usageOf(event) {
	if (event.type === 'assistant/chunk' && event.data?.chunk?.type === 'usage') return event.data.chunk.usage;
	if (event.type === 'assistant/message' && event.data?.usage !== undefined) return event.data.usage;
	return undefined;
}

function bucketsOf(usage) {
	return {
		miss: (usage.inputTokens ?? 0) + (usage.cacheWriteTokens ?? 0),
		hit: usage.cacheReadTokens ?? 0,
		out: usage.outputTokens ?? 0,
	};
}

export function apply(ctx) {
	const ui = ctx.get('desktopUi');
	if (ui === undefined) return; // non-desktop host: do nothing

	let apiKey = readApiKey();
	let model = activeModel(ctx);
	let balance = null;
	let perSession = { miss: 0, hit: 0, out: 0 };
	let currentTurn = { turn: -1, cost: 0 };

	const priceOf = () => PRICES[model] ?? FALLBACK_PRICES;
	const costYuan = (buckets) => (buckets.miss * priceOf().miss + buckets.hit * priceOf().hit + buckets.out * priceOf().out) / 1e6;
	const round2 = (v) => Math.round(v * 100) / 100;

	function push() {
		ui.send('dsh:balance', {
			key: apiKey !== '',
			balance,
			model,
			turnCost: round2(currentTurn.cost),
			sessionCost: round2(costYuan(perSession)),
			topUpUrl: TOP_UP_URL,
			endpoint: BALANCE_ENDPOINT,
		});
	}

	async function refresh() {
		if (apiKey === '') {
			balance = null;
			console.log('[dsh-desktop] balance: no API key configured');
			push();
			return;
		}
		try {
			const response = await fetch(BALANCE_ENDPOINT, {
				headers: { Authorization: `Bearer ${apiKey}`, 'User-Agent': 'dsh-desktop' },
				signal: AbortSignal.timeout(15_000),
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const data = await response.json();
			const infos = Array.isArray(data.balance_infos) ? data.balance_infos : [];
			const cny = infos.find((info) => info.currency === 'CNY');
			balance = cny === undefined ? null : (cny.total_balance ?? null);
			console.log('[dsh-desktop] balance refreshed:', balance);
		} catch (error) {
			balance = null;
			console.log('[dsh-desktop] balance refresh failed:', String(error));
		}
		push();
	}

	// Usage fold over the live session event stream (same buckets as the
	// shipped tokenUsage projection; kept per-turn by resetting on turn/end).
	//
	// A step's usage is reported TWICE on the log: the stream's usage chunk
	// (`assistant/chunk` type='usage') arrives first, then `assistant/message`
	// carries the same final usage for that (turn, step) — and a retried
	// request re-reports usage for the same (turn, step) as well. Folding both
	// verbatim would double-count every step, so a repeated sample for the
	// same (session, turn, step) REPLACES the earlier one instead of adding
	// (same contract as the shipped tokenUsage projection).
	let lastSample = null; // { sessionId, turn, step, buckets }
	const offEvents = ctx.on('session/event', (session, event) => {
		const usage = usageOf(event);
		if (usage !== undefined) {
			const { turn, step } = event.data;
			const buckets = bucketsOf(usage);
			const replacing = lastSample !== null
				&& lastSample.sessionId === session.id
				&& lastSample.turn === turn
				&& lastSample.step === step;
			if (replacing) {
				// Same (session, turn, step) re-reported: swap the old sample out.
				const delta = {
					miss: buckets.miss - lastSample.buckets.miss,
					hit: buckets.hit - lastSample.buckets.hit,
					out: buckets.out - lastSample.buckets.out,
				};
				perSession.miss += delta.miss;
				perSession.hit += delta.hit;
				perSession.out += delta.out;
				if (currentTurn.turn === turn) currentTurn.cost += costYuan(delta);
				lastSample.buckets = buckets;
			} else {
				perSession.miss += buckets.miss;
				perSession.hit += buckets.hit;
				perSession.out += buckets.out;
				if (currentTurn.turn !== turn) currentTurn = { turn, cost: 0 };
				currentTurn.cost += costYuan(buckets);
				lastSample = { sessionId: session.id, turn, step, buckets };
			}
		}
		if (event.type === 'turn/end') push();
	});

	// Credential updates (settings UI writes) → re-read the key.
	const offCred = ctx.on('credentials/updated', () => {
		const next = readApiKey();
		if (next !== apiKey) {
			apiKey = next;
			void refresh();
		}
	});

	// Model switches change the price tier.
	const offModel = ctx.on('agent-default-model/updated', () => {
		model = activeModel(ctx);
		push();
	});

	let timer = null;
	const started = ctx.get('timer');
	if (started !== undefined) {
		timer = started.setInterval(() => void refresh(), 30 * 60 * 1000);
	} else {
		const id = setInterval(() => void refresh(), 30 * 60 * 1000);
		timer = () => clearInterval(id);
	}

	// First balance read shortly after boot.
	setTimeout(() => void refresh(), 3_000).unref?.();

	ctx.effect(() => () => {
		offEvents();
		offCred();
		offModel();
		if (typeof timer === 'function') timer();
	}, 'desktop-balance lifecycle');
}

export { name };
