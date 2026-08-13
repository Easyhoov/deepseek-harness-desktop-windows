/**
 * Desktop notifications driven by the host's own event streams.
 *
 * The carrier taps `apiProxy.events.mux` (a second consumer beside the
 * renderer's downlink — the mux fan-outs every session event to each open
 * stream) and `apiProxy.events.host`:
 *
 *   approval/requested        → always notify (needs a human decision)
 *   question/requested        → always notify
 *   session/event turn/end    → notify only when the window is in the
 *                               background (the "run in tray" case)
 *   host/agent-error          → always notify
 *   host/remote-event         → cordis/request-run (dynamic plugin approval)
 *
 * Subagent sessions are tracked through host/session-added and never page for
 * turn/end, so background agents do not spam the user.
 *
 * @module dsh-desktop/notifications
 */
import { Notification } from 'electron';
import { randomUUID } from 'node:crypto';

const SHORT_ID_LENGTH = 8;

/** Reusable Windows-toast notifier (also used by the updater). */
export function createNotifier({ getWindow, logLine }) {
	return function notify(title, body, onClick) {
		if (!Notification.isSupported()) return;
		try {
			const n = new Notification({ title, body, silent: false });
			n.on('click', () => {
				const win = getWindow();
				if (win !== undefined) {
					win.show();
					win.focus();
				}
				onClick?.();
			});
			n.show();
			logLine(`notify: ${title} — ${String(body).slice(0, 80)}`);
		} catch (error) {
			logLine(`notify failed: ${String(error)}`);
		}
	};
}

export function installNotifications({ ctx, getWindow, logLine }) {
	const apiProxy = ctx.get('apiProxy');
	const notify = createNotifier({ getWindow, logLine });
	if (apiProxy === undefined) {
		return { dispose() {}, notify };
	}
	const abort = new AbortController();
	const subagentSessions = new Set();

	function windowInBackground() {
		const win = getWindow();
		return win === undefined || !win.isVisible() || !win.isFocused();
	}

	const pump = async (stream, onFrame) => {
		try {
			for await (const frame of stream({ rpcId: randomUUID(), payload: {} }, abort.signal)) {
				onFrame(frame.payload);
			}
		} catch (error) {
			if (!abort.signal.aborted) logLine(`notification stream ended: ${String(error)}`);
		}
	};

	void pump(apiProxy.events.mux, (payload) => {
		switch (payload.type) {
			case 'approval/requested':
				notify('DSH · 需要审批', `工具 ${payload.toolName} 请求执行权限`);
				break;
			case 'question/requested': {
				const first = payload.questions?.[0];
				if (first !== undefined) notify('DSH · 问题等待回答', first.question);
				break;
			}
			case 'session/event':
				if (payload.event?.type === 'turn/end' && !subagentSessions.has(payload.sessionId) && windowInBackground()) {
					notify('DSH · 回复完成', `会话 ${String(payload.sessionId).slice(0, SHORT_ID_LENGTH)} 的回复已就绪`);
				}
				break;
			default:
				break;
		}
	});

	void pump(apiProxy.events.host, (payload) => {
		switch (payload.type) {
			case 'host/session-added':
				if (payload.origin === 'subagent') subagentSessions.add(payload.sessionId);
				break;
			case 'host/session-removed':
				subagentSessions.delete(payload.sessionId);
				break;
			case 'host/agent-error':
				notify('DSH · 会话错误', payload.message);
				break;
			case 'host/remote-event':
				if (payload.event === 'cordis/request-run') {
					notify('DSH · 插件等待批准', '动态 Cordis 插件请求运行，请在应用中批准或拒绝');
				}
				break;
			default:
				break;
		}
	});

	return {
		notify,
		dispose() {
			abort.abort();
		},
	};
}
