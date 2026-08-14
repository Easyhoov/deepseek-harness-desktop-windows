window.__ModuleLoader__.load({
	id: "@dsh-desktop/marketplace",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		var React = require("react");
		var createElement = React.createElement;
		var useSyncExternalStore = React.useSyncExternalStore;
		var useState = React.useState;

		var bridge = window.dshDesktop && window.dshDesktop.marketplace ? window.dshDesktop.marketplace : null;

		var TYPE_LABELS = {
			recommended: "推荐",
			plugin: "插件",
			skill: "技能",
			application: "应用",
			infrastructure: "基础设施",
			channel: "渠道",
			collection: "合集",
			directory: "目录",
			all: "全部",
			npm: "npm",
		};

		var store = {
			state: { open: false, query: "", type: "recommended", sort: "score", results: [], installed: [], counts: {}, updatedAt: null, busy: false, note: "", resolving: new Set() },
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

		function runSearch(query, type, sort) {
			if (bridge === null) {
				store.patch({ note: "桥接不可用" });
				return;
			}
			store.patch({ busy: true, note: "" });
			void Promise.resolve(bridge.search(query, type, sort)).then((result) => {
				if (!result || !result.ok) {
					store.patch({ busy: false, note: "目录加载失败（网络不可达且无缓存），稍后再试" });
					return;
				}
				store.patch({
					busy: false,
					results: result.results,
					counts: result.counts || {},
					updatedAt: result.updatedAt,
					note: result.results.length === 0 ? "没有匹配结果" : "",
				});
			});
		}

		function refreshInstalled() {
			if (bridge === null) return;
			void Promise.resolve(bridge.installed()).then((result) => {
				if (result && result.ok) store.patch({ installed: result.installed });
			});
		}

		function openMarketplace() {
			store.patch({ open: true });
			refreshInstalled();
			if (store.state.results.length === 0) runSearch(store.state.query, store.state.type, store.state.sort);
		}

		window.addEventListener("dsh-marketplace-open", openMarketplace);

		function install(item) {
			if (bridge === null) return;
			var doInstall = function (pkg) {
				store.patch({ busy: true, note: "安装中…" });
				void Promise.resolve(bridge.install(pkg)).then((result) => {
					store.patch({ busy: false, note: result && result.ok ? result.note : "安装失败：" + (result && result.reason) });
					refreshInstalled();
				});
			};
			if (item.source === "npm") {
				doInstall(item.name);
				return;
			}
			// GitHub repo: resolve the npm package name first.
			var resolving = new Set(store.state.resolving);
			resolving.add(item.id);
			store.patch({ resolving, note: "" });
			void Promise.resolve(bridge.resolve(item.name, item.defaultBranch)).then((result) => {
				var next = new Set(store.state.resolving);
				next.delete(item.id);
				if (result && result.ok) {
					store.patch({ resolving: next });
					doInstall(result.name);
				} else {
					store.patch({ resolving: next, note: item.name + " 不是 npm 包，无法一键安装（可到仓库页查看安装方式）" });
				}
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
				onClick: openMarketplace,
			}, "插件市场");
		}

		var PANEL_STYLE = {
			position: "absolute",
			inset: "0",
			zIndex: 4001,
			display: "flex",
			alignItems: "flex-start",
			justifyContent: "center",
			paddingTop: "6vh",
			background: "rgba(5,8,18,.45)",
			pointerEvents: "auto",
		};
		var CARD_STYLE = {
			width: "min(680px, 92vw)",
			maxHeight: "84vh",
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
		var CHIP_STYLE = {
			cursor: "pointer",
			border: "1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.14))",
			background: "transparent",
			color: "var(--dsw-alias-label-secondary, #b8c5ea)",
			borderRadius: "999px",
			padding: "3px 12px",
			fontSize: "12px",
			flex: "none",
		};
		var CHIP_ON_STYLE = {
			background: "var(--dsw-alias-interactive-bg-hover-solid, rgba(255,255,255,.14))",
			color: "var(--dsw-alias-label-primary, #eef2ff)",
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
		var BADGE_STYLE = {
			flex: "none",
			fontSize: "10px",
			lineHeight: "16px",
			padding: "0 8px",
			borderRadius: "999px",
			border: "1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.14))",
			color: "var(--dsw-alias-label-tertiary, #93a5d8)",
		};

		function updatedLabel(pushedAt) {
			if (!pushedAt) return "";
			var days = Math.floor((Date.now() - Date.parse(pushedAt)) / 86400000);
			if (days < 1) return "今天";
			if (days < 30) return days + " 天前";
			if (days < 365) return Math.floor(days / 30) + " 个月前";
			return Math.floor(days / 365) + " 年前";
		}

		function MarketplacePanel() {
			var s = useSyncExternalStore(store.subscribe, store.getSnapshot);
			var draft = useState("");
			var query = draft[0];
			var setQuery = draft[1];
			if (!s.open) return null;
			var close = () => store.patch({ open: false });

			var chips = ["recommended", "plugin", "skill", "application", "infrastructure", "channel", "collection", "directory"];
			var chipRow = chips.map((type) => {
				var label = TYPE_LABELS[type];
				var count = type === "recommended" ? "" : s.counts[type];
				return createElement("button", {
					key: type,
					style: { ...CHIP_STYLE, ...(s.type === type ? CHIP_ON_STYLE : {}) },
					onClick: () => {
						store.patch({ type });
						runSearch(query, type, s.sort);
					},
				}, label + (count !== undefined && count !== "" ? " " + count : ""));
			});

			var rows = s.results.map((item) => {
				var isInstalled = s.installed.indexOf(item.name) !== -1;
				var resolving = s.resolving.has(item.id);
				var meta = [
					item.source === "github" && item.stars != null ? "★ " + item.stars : "",
					updatedLabel(item.pushedAt),
				].filter(Boolean).join(" · ");
				return createElement("div", { key: item.id, style: ROW_STYLE },
					createElement("div", { style: { minWidth: 0, flex: 1 } },
						createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "2px" } },
							createElement("span", { style: BADGE_STYLE }, TYPE_LABELS[item.type] || item.type),
							createElement("a", {
								href: item.url,
								target: "_blank",
								rel: "noreferrer",
								style: { fontSize: "13px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--dsw-alias-label-primary, #e6ecff)", textDecoration: "none" },
							}, item.name),
							meta !== "" ? createElement("span", { style: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary, #93a5d8)", flex: "none" } }, meta) : null),
						createElement("div", { style: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary, #93a5d8)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
							item.description || ""),
						item.topics && item.topics.length > 0
							? createElement("div", { style: { marginTop: "3px" } },
								item.topics.map((topic) => createElement("span", { key: topic, style: { fontSize: "10px", color: "var(--dsw-alias-label-tertiary, #93a5d8)", marginRight: "6px" } }, "#" + topic)))
							: null),
					createElement("button", {
						style: ACT_STYLE,
						disabled: s.busy || isInstalled || resolving,
						onClick: () => install(item),
					}, isInstalled ? "已安装" : resolving ? "解析中…" : "安装"));
			});

			var updated = s.updatedAt ? new Date(s.updatedAt).toLocaleString() : "—";
			return createElement("div", { style: PANEL_STYLE, onClick: (e) => { if (e.target === e.currentTarget) close(); } },
				createElement("div", { style: CARD_STYLE },
					createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" } },
						createElement("div", { style: { fontSize: "15px", fontWeight: 600 } }, "插件市场"),
						createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px" } },
							createElement("span", { style: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary, #93a5d8)" } }, "目录更新 " + updated),
							createElement("button", { style: ACT_STYLE, onClick: close }, "关闭"))),
					createElement("div", { style: { display: "flex", gap: "8px", marginBottom: "8px" } },
						createElement("input", {
							style: INPUT_STYLE,
							placeholder: "搜索名称、作者、描述或标签",
							value: query,
							onChange: (e) => setQuery(e.target.value),
							onKeyDown: (e) => {
								if (e.key === "Enter") {
									store.patch({ query });
									runSearch(query, s.type, s.sort);
								}
							},
						}),
						createElement("button", { style: ACT_STYLE, disabled: s.busy, onClick: () => { store.patch({ query }); runSearch(query, s.type, s.sort); } }, "搜索"),
						createElement("select", {
							style: { ...ACT_STYLE, borderRadius: "8px" },
							value: s.sort,
							onChange: (e) => { store.patch({ sort: e.target.value }); runSearch(query, s.type, e.target.value); },
						},
							createElement("option", { value: "score" }, "综合推荐"),
							createElement("option", { value: "stars" }, "最多 Star"),
							createElement("option", { value: "updated" }, "最近更新")),
						createElement("button", { style: ACT_STYLE, disabled: s.busy, onClick: () => { store.patch({ open: false }); window.location.reload(); } }, "刷新界面")),
					createElement("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "8px" } }, chipRow),
					createElement("div", { style: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary, #93a5d8)", marginBottom: "6px" } }, s.note),
					rows.length > 0 ? rows : createElement("div", { style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary, #93a5d8)", padding: "18px 4px" } }, s.busy ? "加载中…" : "输入关键词回车，或切换上方分类浏览目录。"),
					s.installed.length > 0
						? createElement("div", { style: { marginTop: "12px", borderTop: "1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.06))", paddingTop: "8px" } },
							createElement("div", { style: { fontSize: "12px", fontWeight: 600, marginBottom: "4px" } }, "已安装（宿主运行时挂载）"),
							s.installed.map((pkg) => createElement("div", { key: pkg, style: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary, #93a5d8)", padding: "3px 4px" } }, "· " + pkg)))
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
			console.log("[dsh-desktop] marketplace mounted (catalog-first)");
		}

		exports.apply = apply;
		exports.inject = ["slots"];
		exports.MarketplaceButton = MarketplaceButton;
		exports.MarketplacePanel = MarketplacePanel;
		return module.exports;
	}
});
