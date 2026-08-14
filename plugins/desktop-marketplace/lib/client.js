window.__ModuleLoader__.load({
	id: "@dsh-desktop/marketplace",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		var React = require("react");
		var createElement = React.createElement;
		var useSyncExternalStore = React.useSyncExternalStore;
		var useState = React.useState;
		var useEffect = React.useEffect;

		var bridge = window.dshDesktop && window.dshDesktop.marketplace ? window.dshDesktop.marketplace : null;

		var store = {
			state: { open: false, query: "", results: [], installed: [], busy: false, note: "" },
			listeners: new Set(),
			getSnapshot() { return store.state; },
			subscribe(listener) {
				store.listeners.add(listener);
				return () => { store.listeners.delete(listener); };
			},
			patch(partial) {
				store.state = { ...store.state, ...partial };
				for (const listener of [...store.listeners]) listener();
			},
		};

		function runSearch(query) {
			if (bridge === null) return;
			store.patch({ busy: true, note: "" });
			void Promise.resolve(bridge.search(query)).then((result) => {
				store.patch({ busy: false, results: result && result.ok ? result.results : [], note: result && result.ok ? "" : "搜索失败" });
			});
		}

		function refreshInstalled() {
			if (bridge === null) return;
			void Promise.resolve(bridge.installed()).then((result) => {
				if (result && result.ok) store.patch({ installed: result.installed });
			});
		}

		function install(pkg, id) {
			if (bridge === null || pkg === "") return;
			store.patch({ busy: true, note: "安装中…" });
			void Promise.resolve(bridge.install(pkg)).then((result) => {
				store.patch({ busy: false, note: result && result.ok ? result.note : "安装失败：" + (result && result.reason) });
				refreshInstalled();
			});
		}

		var BTN_STYLE = {
			display: "inline-flex",
			alignItems: "center",
			gap: "4px",
			cursor: "pointer",
			background: "transparent",
			border: "none",
			padding: "4px 8px",
			borderRadius: "8px",
			fontSize: "12px",
			color: "var(--dsw-alias-label-secondary, #b8c5ea)",
		};

		function MarketplaceButton() {
			var s = useSyncExternalStore(store.subscribe, store.getSnapshot);
			return createElement("button", {
				style: BTN_STYLE,
				title: "浏览与安装 dsh 插件",
				onClick: () => {
					store.patch({ open: true });
					refreshInstalled();
					if (s.results.length === 0) runSearch("");
				},
			}, "插件市场");
		}

		var PANEL_STYLE = {
			position: "absolute",
			inset: "0",
			zIndex: 4001,
			display: "flex",
			alignItems: "flex-start",
			justifyContent: "center",
			paddingTop: "8vh",
			background: "rgba(5,8,18,.45)",
		};
		var CARD_STYLE = {
			width: "min(640px, 90vw)",
			maxHeight: "80vh",
			overflow: "auto",
			boxSizing: "border-box",
			padding: "16px",
			borderRadius: "16px",
			background: "var(--dsw-alias-bg-layer-2, #101828)",
			border: "1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.1))",
			color: "var(--dsw-alias-label-primary, #e6ecff)",
			fontFamily: "var(--dsw-font-family, \"Segoe UI\", system-ui, sans-serif)",
			boxShadow: "0 18px 60px rgba(0,0,0,.55)",
		};
		var INPUT_STYLE = {
			flex: 1,
			boxSizing: "border-box",
			padding: "8px 12px",
			borderRadius: "10px",
			border: "1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.14))",
			background: "var(--dsw-alias-bg-layer-1, #0b1220)",
			color: "var(--dsw-alias-label-primary, #e6ecff)",
			fontSize: "13px",
			outline: "none",
		};
		var ROW_STYLE = {
			display: "flex",
			justifyContent: "space-between",
			alignItems: "center",
			gap: "10px",
			padding: "10px 4px",
			borderBottom: "1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.06))",
		};
		var ACT_STYLE = {
			cursor: "pointer",
			border: "1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.16))",
			background: "transparent",
			color: "var(--dsw-alias-label-primary, #e6ecff)",
			borderRadius: "8px",
			padding: "4px 12px",
			fontSize: "12px",
			flex: "none",
		};

		function MarketplacePanel() {
			var s = useSyncExternalStore(store.subscribe, store.getSnapshot);
			var draft = useState("");
			var query = draft[0];
			var setQuery = draft[1];
			if (!s.open) return null;
			var close = () => store.patch({ open: false });
			var rows = s.results.map((item) => createElement("div", { key: item.id, style: ROW_STYLE },
				createElement("div", { style: { minWidth: 0, flex: 1 } },
					createElement("div", { style: { fontSize: "13px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, item.name),
					createElement("div", { style: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary, #93a5d8)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
						(item.source === "github" ? "★ " + item.stars + " · " : "") + (item.description || ""))),
				createElement("button", {
					style: ACT_STYLE,
					disabled: s.busy || s.installed.indexOf(item.name) !== -1,
					onClick: () => install(item.name, item.id),
				}, s.installed.indexOf(item.name) !== -1 ? "已安装" : s.busy ? "…" : "安装")));
			var installedRows = s.installed.map((pkg) => createElement("div", { key: pkg, style: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary, #93a5d8)", padding: "3px 4px" } }, "· " + pkg));
			return createElement("div", { style: PANEL_STYLE, onClick: (e) => { if (e.target === e.currentTarget) close(); } },
				createElement("div", { style: CARD_STYLE },
					createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" } },
						createElement("div", { style: { fontSize: "15px", fontWeight: 600 } }, "插件市场"),
						createElement("button", { style: ACT_STYLE, onClick: close }, "关闭")),
					createElement("div", { style: { display: "flex", gap: "8px", marginBottom: "10px" } },
						createElement("input", {
							style: INPUT_STYLE,
							placeholder: "搜索（GitHub dsh-plugin 主题 + npm）",
							value: query,
							onChange: (e) => setQuery(e.target.value),
							onKeyDown: (e) => { if (e.key === "Enter") runSearch(query); },
						}),
						createElement("button", { style: ACT_STYLE, disabled: s.busy, onClick: () => runSearch(query) }, "搜索"),
						createElement("button", { style: ACT_STYLE, disabled: s.busy, onClick: () => { store.patch({ open: false }); window.location.reload(); } }, "刷新界面")),
					createElement("div", { style: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary, #93a5d8)", marginBottom: "6px" } }, s.note),
					rows.length > 0 ? rows : createElement("div", { style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary, #93a5d8)", padding: "18px 4px" } }, "输入关键词后回车，或直接点击搜索浏览热门 dsh 插件。"),
					s.installed.length > 0
						? createElement("div", { style: { marginTop: "12px", borderTop: "1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.06))", paddingTop: "8px" } },
							createElement("div", { style: { fontSize: "12px", fontWeight: 600, marginBottom: "4px" } }, "已安装（宿主运行时挂载）"),
							installedRows)
						: null));
		}

		function apply(ctx) {
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "marketplace",
				order: 10,
				label: "插件市场",
				inject: () => ({}),
			}, MarketplaceButton));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "marketplace-panel",
				order: 20,
				label: "插件市场",
				inject: () => ({}),
			}, MarketplacePanel));
			console.log("[dsh-desktop] marketplace mounted");
		}

		exports.apply = apply;
		exports.inject = ["slots"];
		exports.MarketplaceButton = MarketplaceButton;
		exports.MarketplacePanel = MarketplacePanel;
		return module.exports;
	}
});
