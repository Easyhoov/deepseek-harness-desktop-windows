/**
 * @dsh-desktop/file-changes — host half.
 *
 * Tracks per-session file mutations from the live `session/event` stream:
 *   - the str-replace editor (`edit` tool): str_replace / insert / create /
 *     view commands — a `view` result doubles as the "known previous
 *     content" anchor for later reverts
 *   - the `write` tool (create/overwrite)
 *
 * Each op carries line-level +/− stats (LCS diff) and a revertability
 * verdict. Reverts run in the main process behind a hard fence:
 *   - the target must be an absolute path under the session's cwd or a
 *     workspace root
 *   - dangerous extensions (.bat/.exe/.ps1/...) are refused
 *   - snippet swaps require the exact current content before touching
 *
 * Inert on non-desktop hosts (desktopUi absent).
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync, statSync } from 'node:fs';
import { join, resolve, sep, isAbsolute } from 'node:path';

const name = 'desktop-file-changes';

const DANGEROUS_EXT = /\.(bat|cmd|com|exe|ps1|vbs|lnk|js|jse|msi|scr|pif|reg)$/i;
const MAX_OPS_PER_SESSION = 400;

function norm(p) {
	return resolve(p).toLowerCase();
}

function lcsDiff(oldText, newText) {
	const a = (oldText ?? '').split('\n');
	const b = (newText ?? '').split('\n');
	// Dynamic-programming LCS over lines; both inputs are bounded (tool args).
	const rows = a.length + 1;
	const cols = b.length + 1;
	const dp = new Uint32Array(rows * cols);
	for (let i = 1; i < rows; i += 1) {
		for (let j = 1; j < cols; j += 1) {
			dp[i * cols + j] = a[i - 1] === b[j - 1]
				? dp[(i - 1) * cols + (j - 1)] + 1
				: Math.max(dp[(i - 1) * cols + j], dp[i * cols + (j - 1)]);
		}
	}
	const lcs = dp[(rows - 1) * cols + (cols - 1)];
	return { added: Math.max(0, b.length - lcs), removed: Math.max(0, a.length - lcs) };
}

function parseArgs(raw) {
	try {
		const parsed = JSON.parse(raw);
		return typeof parsed === 'object' && parsed !== null ? parsed : {};
	} catch {
		return {};
	}
}

export function apply(ctx) {
	const ui = ctx.get('desktopUi');
	if (ui === undefined) return;

	/** sessionId -> { cwd, ops: [], viewed: Map<path, content> } */
	const records = new Map();

	function recordOf(sessionId) {
		let record = records.get(sessionId);
		if (record === undefined) {
			record = { cwd: '', ops: [], viewed: new Map() };
			records.set(sessionId, record);
		}
		return record;
	}

	function sessionCwd(session) {
		try {
			const headerCwd = session?.header?.cwd;
			if (typeof headerCwd === 'string' && headerCwd !== '') return headerCwd;
		} catch {
			/* fall through */
		}
		return '';
	}

	function workspaceRoots() {
		const roots = new Set();
		try {
			const workspace = ctx.get('workspace');
			const list = workspace?.list?.();
			if (Array.isArray(list)) {
				for (const entry of list) {
					const root = entry?.path ?? entry?.cwd;
					if (typeof root === 'string' && root !== '') roots.add(norm(root));
				}
			}
		} catch {
			/* workspace service unavailable: fence degrades to session cwd */
		}
		for (const session of ctx.sessions.list()) {
			const cwd = sessionCwd(session);
			if (cwd !== '') roots.add(norm(cwd));
		}
		return roots;
	}

	function underRoots(target) {
		if (DANGEROUS_EXT.test(target)) return { ok: false, reason: 'dangerous extension' };
		if (!isAbsolute(target)) return { ok: false, reason: 'not an absolute path' };
		const n = norm(target);
		for (const root of workspaceRoots()) {
			if (n === root || n.startsWith(`${root}${sep.toLowerCase()}`)) return { ok: true };
		}
		return { ok: false, reason: 'outside session/workspace roots' };
	}

	function push(record, sessionId) {
		ui.send('dsh:file-changes', {
			sessionId,
			cwd: record.cwd,
			changes: record.ops.map((op) => ({
				id: op.id,
				time: op.time,
				path: op.path,
				tool: op.tool,
				command: op.command,
				status: op.status,
				added: op.added,
				removed: op.removed,
				revertable: op.revertable,
			})),
		});
	}

	function addOp(sessionId, op) {
		const record = recordOf(sessionId);
		record.ops.push(op);
		if (record.ops.length > MAX_OPS_PER_SESSION) record.ops.shift();
		push(record, sessionId);
	}

	// ---- revert machinery --------------------------------------------------
	function currentContent(target) {
		try {
			return readFileSync(target, 'utf8');
		} catch {
			return undefined;
		}
	}

	function applyRevert(record, op) {
		const fence = underRoots(op.path);
		if (!fence.ok) return { ok: false, reason: fence.reason };
		try {
			if (op.command === 'str_replace') {
				const current = currentContent(op.path);
				if (current === undefined) return { ok: false, reason: 'file not found' };
				const at = current.indexOf(op.newText);
				if (at === -1) return { ok: false, reason: 'file no longer contains the written snippet' };
				writeFileSync(op.path, current.slice(0, at) + op.oldText + current.slice(at + op.newText.length), 'utf8');
				return { ok: true };
			}
			if (op.command === 'insert') {
				const current = currentContent(op.path);
				if (current === undefined) return { ok: false, reason: 'file not found' };
				const at = current.indexOf(op.newText);
				if (at === -1) return { ok: false, reason: 'file no longer contains the inserted snippet' };
				writeFileSync(op.path, current.slice(0, at) + current.slice(at + op.newText.length), 'utf8');
				return { ok: true };
			}
			// create / write: restore the previously viewed content, else delete
			// only when the file is byte-identical to what the op wrote.
			const previous = record.viewed.get(norm(op.path));
			if (previous !== undefined) {
				writeFileSync(op.path, previous, 'utf8');
				return { ok: true };
			}
			const current = currentContent(op.path);
			if (current === undefined) return { ok: false, reason: 'file not found' };
			if (current !== op.newText) return { ok: false, reason: 'file changed since the write' };
			unlinkSync(op.path);
			return { ok: true };
		} catch (error) {
			return { ok: false, reason: String(error?.message ?? error) };
		}
	}

	// ---- event stream fold -------------------------------------------------
	const offEvents = ctx.on('session/event', (session, event) => {
		const sessionId = session.id;
		if (event.type === 'tool/call') {
			const data = event.data;
			if (data?.name === 'edit') {
				const args = parseArgs(data.arguments);
				const path = typeof args.path === 'string' ? args.path : '';
				const command = typeof args.command === 'string' ? args.command : 'str_replace';
				const oldText = typeof args.old_str === 'string' ? args.old_str : '';
				const newText = typeof args.new_str === 'string' ? args.new_str : '';
				const diff = lcsDiff(oldText, newText);
				const record = recordOf(sessionId);
				record.cwd = record.cwd || sessionCwd(session);
				addOp(sessionId, {
					id: `${event.time ?? Date.now()}-${data.callId ?? ''}`,
					time: event.time ?? Date.now(),
					path,
					tool: 'edit',
					command,
					status: 'running',
					added: diff.added,
					removed: diff.removed,
					oldText,
					newText,
					revertable: command === 'str_replace' || command === 'insert' || record.viewed.has(norm(path)),
				});
			} else if (data?.name === 'write') {
				const args = parseArgs(data.arguments);
				const path = typeof args.file_path === 'string' ? args.file_path : '';
				const content = typeof args.content === 'string' ? args.content : '';
				const record = recordOf(sessionId);
				record.cwd = record.cwd || sessionCwd(session);
				const viewed = record.viewed.get(norm(path));
				const diff = lcsDiff(viewed ?? '', content);
				addOp(sessionId, {
					id: `${event.time ?? Date.now()}-${data.callId ?? ''}`,
					time: event.time ?? Date.now(),
					path,
					tool: 'write',
					command: 'write',
					status: 'running',
					added: diff.added,
					removed: diff.removed,
					oldText: viewed ?? '',
					newText: content,
					revertable: viewed !== undefined,
				});
			}
			return;
		}
		if (event.type === 'tool/result') {
			const data = event.data;
			const record = recordOf(sessionId);
			// Settle the newest running op for this tool name.
			for (let i = record.ops.length - 1; i >= 0; i -= 1) {
				if (record.ops[i].status !== 'running') continue;
				const namesMatch = record.ops[i].tool === data?.name
					|| (record.ops[i].tool === 'edit' && data?.name === 'edit')
					|| (record.ops[i].tool === 'write' && data?.name === 'write');
				if (!namesMatch) continue;
				record.ops[i].status = data?.outcome === 'success' || data?.status === 'success' ? 'success' : 'error';
				// A successful view records the "known previous content" anchor.
				if (record.ops[i].tool === 'edit' && record.ops[i].command === 'view') {
					try {
						const viewTarget = record.ops[i].path;
						if (existsSync(viewTarget)) {
							record.viewed.set(norm(viewTarget), readFileSync(viewTarget, 'utf8'));
						}
					} catch {
						/* leave anchor unset */
					}
				}
				push(record, sessionId);
				break;
			}
		}
	});

	// ---- renderer RPC ------------------------------------------------------
	const offHandlers = [
		ui.on('file-changes-get', ({ sessionId }) => {
			const record = records.get(sessionId);
			if (record === undefined) return { ok: true, cwd: '', changes: [] };
			return {
				ok: true,
				cwd: record.cwd,
				changes: record.ops.map((op) => ({
					id: op.id, time: op.time, path: op.path, tool: op.tool,
					command: op.command, status: op.status, added: op.added,
					removed: op.removed, revertable: op.revertable,
				})),
			};
		}),
		ui.on('file-revert', ({ sessionId, opId }) => {
			const record = records.get(sessionId);
			const op = record?.ops.find((candidate) => candidate.id === opId);
			if (op === undefined) return { ok: false, reason: 'unknown op' };
			return applyRevert(record, op);
		}),
		ui.on('file-revert-all', ({ sessionId }) => {
			const record = records.get(sessionId);
			if (record === undefined) return { ok: false, reason: 'no record' };
			const results = [];
			for (let i = record.ops.length - 1; i >= 0; i -= 1) {
				const op = record.ops[i];
				if (op.status !== 'success' || !op.revertable) continue;
				results.push({ id: op.id, ...applyRevert(record, op) });
			}
			return { ok: true, results };
		}),
	];

	ctx.effect(() => () => {
		offEvents();
		for (const off of offHandlers) off();
	}, 'desktop-file-changes lifecycle');
}

export { name };
