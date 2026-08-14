window.__ModuleLoader__.load({
	id: "@dsh-desktop/balance",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		var React = require("react");
		var useSyncExternalStore = React.useSyncExternalStore;
		var createElement = React.createElement;

		// Tiny store fed by the preload's dsh-balance-changed window event.
		var INITIAL = { key: false, balance: null, turnCost: 0, sessionCost: 0, model: "", topUpUrl: "https://platform.deepseek.com/top_up" };
		var store = {
			state: INITIAL,
			listeners: new Set(),
			getSnapshot() { return store.state; },
			subscribe(listener) {
				store.listeners.add(listener);
				return () => { store.listeners.delete(listener); };
			},
			set(next) {
				store.state = next;
				for (const listener of [...store.listeners]) listener();
			},
		};
		window.addEventListener("dsh-balance-changed", (event) => {
			try { store.set({ ...INITIAL, ...event.detail }); } catch {}
		});

		var STYLE = {
			display: "inline-flex",
			alignItems: "center",
			gap: "6px",
			background: "transparent",
			border: "none",
			padding: "0",
			margin: "0",
			cursor: "pointer",
			fontFamily: "var(--ds-font-family-code, Consolas, monospace)",
			fontSize: "11px",
			lineHeight: "16px",
			color: "var(--dsw-alias-label-tertiary, #93a5d8)",
			whiteSpace: "nowrap",
		};

		function BalanceDock() {
			var s = useSyncExternalStore(store.subscribe, store.getSnapshot);
			if (!s.key) return null;
			var text = s.balance == null
				? "余额 --"
				: "余额 ¥" + s.balance + " · 本轮 ¥" + s.turnCost;
			var openTopUp = () => {
				if (window.dshDesktop && typeof window.dshDesktop.openExternal === "function") {
					window.dshDesktop.openExternal(s.topUpUrl);
				}
			};
			return createElement("button", { onClick: openTopUp, style: STYLE, title: "DeepSeek 账户余额 · 点击充值" }, text);
		}

		function apply(ctx) {
			ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
				name: "conversation.composer.dock",
				id: "balance",
				order: 1,
				inject: () => ({}),
			}), BalanceDock);
			console.log("[dsh-desktop] balance widget mounted (composer.dock)");
		}

		exports.apply = apply;
		exports.inject = ["slots"];
		exports.BalanceDock = BalanceDock;
		return module.exports;
	}
});
