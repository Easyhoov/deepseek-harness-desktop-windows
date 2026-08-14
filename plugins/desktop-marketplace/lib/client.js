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

		var RESOLVE_NOTES = {
			private: " 是应用/私有仓库，未发布到 npm，无法一键安装（可到仓库页查看安装方式）",
			unpublished: " 在 npm 上没有可安装版本（同名包为空占位），无法一键安装（可到仓库页查看安装方式）",
			network: " 解析失败（网络不可达），无法一键安装；请稍后重试，或到仓库页查看安装方式",
			invalid: " 仓库地址无效，无法一键安装",
		};

		var store = {
			state: { open: false, query: "", type: "recommended", sort: "score", results: [], installed: [], counts: {}, updatedAt: null, busy: false, note: "", resolving: new Set(), detail: null, detailData: null, detailBusy: false, confirm: null },
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

		function installBySource(source) {
			if (bridge === null) return;
			// Risk confirmation first: third-party code runs inside the DSH
			// process; the user must explicitly accept before the host runs
			// `dsh plugin add` (same gate the official plugin store enforces).
			store.patch({ confirm: source });
		}

		function doInstall(source) {
			store.patch({ busy: true, confirm: null, note: "安装中…" });
			void Promise.resolve(bridge.install(source)).then((result) => {
				store.patch({ busy: false, note: result && result.ok ? result.note : "安装失败：" + (result && result.reason) });
				refreshInstalled();
			});
		}

		function install(item) {
			if (bridge === null) return;
			if (item.source === "npm") {
				installBySource(item.name);
				return;
			}
			// GitHub repo: resolve the install source first.
			var resolving = new Set(store.state.resolving);
			resolving.add(item.id);
			store.patch({ resolving, note: "" });
			void Promise.resolve(bridge.resolve(item.name, item.defaultBranch)).then((result) => {
				var next = new Set(store.state.resolving);
				next.delete(item.id);
				if (result && result.ok) {
					store.patch({ resolving: next });
					installBySource(result.source);
				} else {
					var reason = result && result.reason ? result.reason : "not-npm";
					// Not a dsh bundle — open the detail view, which shows the
					// repo's real install method (skill/mcp/script/…).
					if (reason === "not-bundle") {
						store.patch({ resolving: next });
						openDetail(item);
						return;
					}
					var note = RESOLVE_NOTES[reason] || " 不是 npm 包，无法一键安装（可到仓库页查看安装方式）";
					store.patch({ resolving: next, note: item.name + note });
				}
			});
		}

		function openDetail(item) {
			if (bridge === null || item.source !== "github") return;
			store.patch({ detail: item, detailData: null, detailBusy: true, note: "" });
			void Promise.resolve(bridge.detail(item.name, item.defaultBranch, item.type, item.topics)).then((result) => {
				if (result && result.ok) {
					store.patch({ detailData: result, detailBusy: false });
				} else {
					store.patch({ detailData: null, detailBusy: false, note: "详情加载失败，请稍后重试" });
				}
			});
		}

		function closeDetail() {
			store.patch({ detail: null, detailData: null, detailBusy: false });
		}

		// Sidebar-foot entry styled like the built-in 设置 trigger row.
		var BTN_STYLE = {
			boxSizing: "border-box",
			cursor: "pointer",
			width: "calc(100% + 8px)",
			height: "34px",
			color: "var(--dsw-alias-label-primary, #e6ecff)",
			background: "transparent",
			border: "none",
			borderRadius: "12px",
			alignItems: "center",
			display: "flex",
			gap: "8px",
			margin: "4px -4px",
			padding: "6px 2px 6px 10px",
			fontFamily: "inherit",
			fontSize: "14px",
			lineHeight: "22px",
			overflow: "hidden",
			textAlign: "left",
		};

		function MarketplaceButton() {
			var s = useSyncExternalStore(store.subscribe, store.getSnapshot);
			return createElement("button", {
				type: "button",
				style: BTN_STYLE,
				title: "浏览与安装 dsh 插件",
				onClick: (e) => openMarketplace(e.currentTarget),
			}, "插件市场");
		}

		// ---- shared body ------------------------------------------------------
		var INPUT_STYLE = {
			flex: 1,
			minWidth: 0,
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

		// The desktop shell denies window.open / target=_blank (setWindowOpenHandler
		// deny), so every external link must go through the openExternal bridge —
		// otherwise clicking a repo card does nothing. Web UI falls back to a plain
		// window.open.
		function openRepo(url) {
			if (typeof url !== "string" || url === "") return;
			var ext = window.dshDesktop && typeof window.dshDesktop.openExternal === "function" ? window.dshDesktop.openExternal : null;
			if (ext !== null) {
				void ext(url);
				return;
			}
			window.open(url, "_blank", "noopener");
		}
		function repoLinkProps(url) {
			return {
				href: url,
				onClick: (e) => {
					e.preventDefault();
					openRepo(url);
				},
			};
		}

		function MarketplaceBody() {
			var s = useSyncExternalStore(store.subscribe, store.getSnapshot);
			var draft = useState("");
			var query = draft[0];
			var setQuery = draft[1];
			if (s.detail !== null) return createElement(MarketplaceDetail);

			var chips = ["recommended", "plugin", "skill", "application", "infrastructure", "channel", "collection", "directory"];
			var chipRow = chips.map((type) => {
				var label = TYPE_LABELS[type];
				var count = type === "recommended" ? "" : s.counts[type];
				return createElement("button", {
					key: type,
					type: "button",
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
				// Applications (or repos tagged desktop-app) are standalone
				// programs, not DSH plugins — opening the repo page beats a
				// doomed one-click npm install.
				var isApp = item.type === "application" || (item.topics || []).indexOf("desktop-app") !== -1;
				var meta = [
					item.source === "github" && item.stars != null ? "★ " + item.stars : "",
					updatedLabel(item.pushedAt),
				].filter(Boolean).join(" · ");
				return createElement("div", { key: item.id, style: ROW_STYLE },
					createElement("div", { style: { minWidth: 0, flex: 1 } },
						createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "2px" } },
							createElement("span", { style: BADGE_STYLE }, TYPE_LABELS[item.type] || item.type),
							createElement("a", {
								...repoLinkProps(item.url),
								style: { fontSize: "13px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--dsw-alias-label-primary, #e6ecff)", textDecoration: "none", cursor: "pointer" },
							}, item.name),
							meta !== "" ? createElement("span", { style: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary, #93a5d8)", flex: "none" } }, meta) : null),
						createElement("div", { style: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary, #93a5d8)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
							item.description || ""),
						item.topics && item.topics.length > 0
							? createElement("div", { style: { marginTop: "3px" } },
								item.topics.map((topic) => createElement("span", { key: topic, style: { fontSize: "10px", color: "var(--dsw-alias-label-tertiary, #93a5d8)", marginRight: "6px" } }, "#" + topic)))
							: null),
					createElement("div", { style: { display: "flex", gap: "8px", flex: "none", alignItems: "center" } },
						item.source === "github"
							? createElement("button", { type: "button", style: ACT_STYLE, disabled: s.detailBusy, onClick: () => openDetail(item) }, "详情")
							: null,
						isApp
							? createElement("a", {
								key: "open",
								...repoLinkProps(item.url),
								style: { ...ACT_STYLE, textDecoration: "none", display: "inline-block", textAlign: "center" },
							}, "打开仓库页")
							: createElement("button", {
								type: "button",
								style: ACT_STYLE,
								disabled: s.busy || isInstalled || resolving,
								onClick: () => install(item),
							}, isInstalled ? "已安装" : resolving ? "解析中…" : "安装")));
			});

			var updated = s.updatedAt ? new Date(s.updatedAt).toLocaleString() : "—";
			return createElement("div", { style: { display: "flex", flexDirection: "column", gap: "8px", color: "var(--dsw-alias-label-primary, #e6ecff)" } },
				createElement("div", { style: { display: "flex", gap: "8px", alignItems: "center" } },
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
					createElement("button", { type: "button", style: ACT_STYLE, disabled: s.busy, onClick: () => { store.patch({ query }); runSearch(query, s.type, s.sort); } }, "搜索"),
					createElement("select", {
						style: { ...ACT_STYLE, borderRadius: "8px" },
						value: s.sort,
						onChange: (e) => { store.patch({ sort: e.target.value }); runSearch(query, s.type, e.target.value); },
					},
						createElement("option", { value: "score" }, "综合推荐"),
						createElement("option", { value: "stars" }, "最多 Star"),
						createElement("option", { value: "updated" }, "最近更新")),
					createElement("button", { type: "button", style: ACT_STYLE, disabled: s.busy, onClick: () => window.location.reload() }, "刷新界面")),
				createElement("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } }, chipRow),
				createElement("div", { style: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary, #93a5d8)", minHeight: "14px" } },
					s.note || "目录更新 " + updated + " · 安装即写入会话配置，界面新元素刷新后生效"),
				rows.length > 0 ? rows : createElement("div", { style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary, #93a5d8)", padding: "18px 4px" } }, s.busy ? "加载中…" : "输入关键词回车，或切换上方分类浏览目录。"),
				s.installed.length > 0
					? createElement("div", { style: { marginTop: "12px", borderTop: "1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.06))", paddingTop: "8px" } },
						createElement("div", { style: { fontSize: "12px", fontWeight: 600, marginBottom: "4px" } }, "已安装（宿主运行时挂载）"),
						s.installed.map((pkg) => createElement("div", { key: pkg, style: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary, #93a5d8)", padding: "3px 4px" } }, "· " + pkg)))
					: null);
		}

		// ---- in-app detail view ----------------------------------------------
		// Strips the worst markdown noise so a README reads as plain text.
		function cleanReadme(text) {
			var t = String(text || "");
			t = t.replace(/^---[\s\S]*?---\n/, ""); // YAML front matter
			t = t.replace(/<[^>]+>/g, ""); // html tags
			t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ""); // images
			t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"); // links → text
			t = t.replace(/^#{1,6}\s*/gm, ""); // headings
			t = t.replace(/```/g, ""); // code fences
			t = t.replace(/`/g, ""); // inline code
			t = t.replace(/^\s*[-*+]\s+/gm, "· "); // list items
			t = t.replace(/^\s*>\s?/gm, ""); // blockquotes
			t = t.replace(/^\s*[-=]{3,}\s*$/gm, ""); // hr lines
			t = t.replace(/^(\s*)\|.*$/gm, ""); // table rows
			t = t.replace(/\*\*([^*]+)\*\*/g, "$1");
			t = t.replace(/\*([^*]+)\*/g, "$1");
			t = t.replace(/~~([^~]+)~~/g, "$1");
			t = t.replace(/\n{3,}/g, "\n\n");
			t = t.trim();
			if (t.length > 6000) t = t.slice(0, 6000) + "\n\n…（内容过长已截断）";
			return t;
		}

		function copyText(text, onDone) {
			var done = false;
			try {
				if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
					void navigator.clipboard.writeText(text).then(() => { done = true; onDone && onDone(); }, () => {});
				}
			} catch (_) { /* fall through */ }
			if (done) return;
			try {
				var ta = document.createElement("textarea");
				ta.value = text;
				ta.style.position = "fixed";
				ta.style.opacity = "0";
				document.body.appendChild(ta);
				ta.select();
				document.execCommand("copy");
				document.body.removeChild(ta);
				onDone && onDone();
			} catch (_) { /* best effort */ }
		}

		var CMD_BOX_STYLE = {
			display: "flex",
			alignItems: "center",
			gap: "8px",
			border: "1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.06))",
			borderRadius: "10px",
			padding: "8px 12px",
			fontFamily: "var(--ds-font-family-code, Consolas, monospace)",
			fontSize: "11.5px",
			lineHeight: "18px",
			color: "var(--dsw-alias-label-secondary, #b8c5ea)",
			wordBreak: "break-all",
			flex: 1,
			minWidth: 0,
		};

		function MarketplaceDetail() {
			var s = useSyncExternalStore(store.subscribe, store.getSnapshot);
			var item = s.detail;
			var copiedDraft = useState("");
			var copied = copiedDraft[0];
			var setCopied = copiedDraft[1];
			if (item === null) return null;
			var data = s.detailData;
			var pkg = data && data.pkg ? data.pkg : null;
			var install = data && data.install ? data.install : null;
			var isInstalled = pkg !== null && pkg.name ? s.installed.indexOf(pkg.name) !== -1 : false;
			var meta = [
				item.source === "github" && item.stars != null ? "★ " + item.stars : "",
				updatedLabel(item.pushedAt),
			].filter(Boolean).join(" · ");

			var npmLine = "";
			var npmErrorLine = "";
			if (s.detailBusy) {
				npmLine = "正在获取 npm 发布信息…";
			} else if (pkg === null) {
				npmLine = "仓库信息暂不可用";
			} else if (pkg.error === "private") {
				npmErrorLine = "私有/应用仓库，未发布到 npm";
			} else if (pkg.error === "unpublished") {
				npmErrorLine = "npm 上无可用版本（同名包为空占位）";
			} else if (pkg.error === "network") {
				npmErrorLine = "无法连接 npm registry（网络问题）";
			} else if (pkg.error === "not-npm") {
				npmErrorLine = "该仓库不是 npm 包";
			} else if (pkg.published) {
				npmLine = "npm：" + pkg.name + " · " + (pkg.versions || 0) + " 个版本 · 最新 " + (pkg.latest || "—") + (pkg.lastPublish ? " · 更新于 " + new Date(pkg.lastPublish).toLocaleDateString() : "");
			} else {
				npmErrorLine = "该包未发布到 npm";
			}

			var readme = data && data.readme && String(data.readme).trim() !== "" ? cleanReadme(data.readme) : null;
			var installable = install !== null && (install.method === "npm" || install.method === "git") && install.source;
			var canInstall = installable && !isInstalled && !s.busy;
			var command = install !== null && install.command ? install.command : null;
			var installNote = install !== null && install.note ? install.note : "";

			var doCopy = function (text) {
				copyText(text, () => {
					setCopied(text);
					setTimeout(() => setCopied(""), 1500);
				});
			};

			return createElement("div", { style: { display: "flex", flexDirection: "column", gap: "10px", color: "var(--dsw-alias-label-primary, #e6ecff)" } },
				createElement("button", { type: "button", style: { ...ACT_STYLE, alignSelf: "flex-start" }, onClick: closeDetail }, "← 返回"),
				createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
					createElement("span", { style: BADGE_STYLE }, TYPE_LABELS[item.type] || item.type),
					createElement("a", { ...repoLinkProps(item.url), style: { fontSize: "15px", fontWeight: 600, color: "var(--dsw-alias-label-primary, #e6ecff)", textDecoration: "none", cursor: "pointer" } }, item.name),
					meta !== "" ? createElement("span", { style: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary, #93a5d8)" } }, meta) : null),
				item.description
					? createElement("div", { style: { fontSize: "13px", lineHeight: "20px", color: "var(--dsw-alias-label-secondary, #b8c5ea)" } }, item.description)
					: null,
				createElement("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
					canInstall
						? createElement("button", { type: "button", style: ACT_STYLE, disabled: s.busy, onClick: () => installBySource(install.source) }, s.busy ? "安装中…" : isInstalled ? "已安装" : "一键安装")
						: null,
					createElement("a", { ...repoLinkProps(item.url), style: { ...ACT_STYLE, textDecoration: "none", display: "inline-block", textAlign: "center" } }, "打开仓库页")),
				installNote !== ""
					? createElement("div", { style: { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-secondary, #b8c5ea)" } }, installNote)
					: null,
				command !== null
					? createElement("div", { style: { display: "flex", gap: "8px", alignItems: "center" } },
						createElement("div", { style: CMD_BOX_STYLE }, command),
						createElement("button", { type: "button", style: ACT_STYLE, onClick: () => doCopy(command) }, copied === command ? "已复制" : "复制"))
					: null,
				pkg !== null && (npmLine !== "" || npmErrorLine !== "")
					? createElement("div", { style: { border: "1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.06))", borderRadius: "10px", padding: "8px 12px", fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-secondary, #b8c5ea)" } }, npmLine || npmErrorLine)
					: null,
				readme !== null
					? createElement("div", { style: { borderTop: "1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.06))", paddingTop: "10px" } },
						createElement("div", { style: { fontSize: "12px", fontWeight: 600, marginBottom: "6px" } }, "README"),
						createElement("pre", { style: { whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--dsw-font-family, \"Segoe UI\", system-ui, sans-serif)", fontSize: "12px", lineHeight: "19px", color: "var(--dsw-alias-label-secondary, #b8c5ea)", maxHeight: "38vh", overflowY: "auto", margin: 0, paddingRight: "4px" } }, readme),
						createElement("a", { ...repoLinkProps(item.url), style: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary, #93a5d8)", cursor: "pointer", textDecoration: "none" } }, "在 GitHub 查看完整 README →"))
					: s.detailBusy
						? createElement("div", { style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary, #93a5d8)" } }, "README 加载中…")
						: null);
		}

		// ---- settings-native section ------------------------------------------
		// Renders inside the built-in 设置 modal: identical chrome (nav rail,
		// content column, close/Escape/mask) with zero duplicated panel styling.
		function MarketplaceSection() {
			useEffect(() => {
				refreshInstalled();
				if (store.state.results.length === 0) runSearch(store.state.query, store.state.type, store.state.sort);
			}, []);
			return createElement(MarketplaceBody);
		}

		// ---- fallback overlay (mirrors the settings modal geometry) -----------
		var FALLBACK_OVERLAY_STYLE = {
			zIndex: 1200,
			justifyContent: "center",
			alignItems: "center",
			display: "flex",
			position: "fixed",
			inset: "0",
			pointerEvents: "auto",
		};
		var FALLBACK_MASK_STYLE = {
			background: "var(--dsw-alias-bg-mask-1, rgba(5,8,18,.45))",
			backdropFilter: "var(--dsw-mask-blur, blur(4px))",
			position: "absolute",
			inset: "0",
		};
		var FALLBACK_PANEL_STYLE = {
			zIndex: 1,
			background: "var(--dsw-alias-bg-layer-2, #101828)",
			width: "800px",
			maxWidth: "calc(100vw - 48px)",
			height: "min(800px, 100vh - 48px)",
			boxShadow: "var(--dsw-shadow-lv3, 0 18px 60px rgba(0,0,0,.55))",
			borderRadius: "24px",
			display: "flex",
			flexDirection: "column",
			position: "relative",
			overflow: "hidden",
		};
		var FALLBACK_HEADER_STYLE = {
			boxSizing: "border-box",
			flex: "none",
			justifyContent: "space-between",
			alignItems: "flex-start",
			gap: "8px",
			height: "54px",
			padding: "20px 14px 8px 10px",
			display: "flex",
		};
		var FALLBACK_OPTIONS_STYLE = {
			flex: 1,
			minHeight: 0,
			padding: "0 24px 24px",
			overflowY: "auto",
			display: "flex",
			flexDirection: "column",
		};

		function MarketplacePanel() {
			var s = useSyncExternalStore(store.subscribe, store.getSnapshot);
			useEffect(() => {
				if (!s.open) return;
				var onKeyDown = (e) => { if (e.key === "Escape") store.patch({ open: false }); };
				document.addEventListener("keydown", onKeyDown);
				refreshInstalled();
				if (store.state.results.length === 0) runSearch(store.state.query, store.state.type, store.state.sort);
				return () => document.removeEventListener("keydown", onKeyDown);
			}, [s.open]);
			if (!s.open) return null;
			return createElement("div", { style: FALLBACK_OVERLAY_STYLE },
				createElement("div", { style: FALLBACK_MASK_STYLE, onClick: () => store.patch({ open: false }) }),
				createElement("div", { style: FALLBACK_PANEL_STYLE, role: "dialog", "aria-modal": "true" },
					createElement("div", { style: FALLBACK_HEADER_STYLE },
						createElement("div", { style: { color: "var(--dsw-alias-label-primary, #e6ecff)", fontSize: "16px", fontWeight: 500, lineHeight: "24px" } }, "插件市场"),
						createElement("button", {
							type: "button",
							style: { cursor: "pointer", width: "28px", height: "28px", color: "var(--dsw-alias-label-primary, #e6ecff)", background: "transparent", border: "none", borderRadius: "28px", justifyContent: "center", alignItems: "center", padding: 0, display: "inline-flex", fontSize: "14px" },
							onClick: () => store.patch({ open: false }),
							"aria-label": "关闭",
						}, "✕")),
					createElement("div", { style: FALLBACK_OPTIONS_STYLE },
						createElement(MarketplaceBody))));
		}

		// ---- install risk confirmation ---------------------------------------
		var CONFIRM_OVERLAY_STYLE = {
			zIndex: 1300,
			justifyContent: "center",
			alignItems: "center",
			display: "flex",
			position: "fixed",
			inset: "0",
			pointerEvents: "auto",
		};
		var CONFIRM_MASK_STYLE = {
			background: "var(--dsw-alias-bg-mask-1, rgba(5,8,18,.55))",
			backdropFilter: "var(--dsw-mask-blur, blur(4px))",
			position: "absolute",
			inset: "0",
		};
		var CONFIRM_PANEL_STYLE = {
			zIndex: 1,
			background: "var(--dsw-alias-bg-layer-2, #101828)",
			width: "min(420px, 92vw)",
			boxSizing: "border-box",
			padding: "18px",
			borderRadius: "16px",
			border: "1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.1))",
			boxShadow: "var(--dsw-shadow-lv3, 0 18px 60px rgba(0,0,0,.55))",
			display: "flex",
			flexDirection: "column",
			gap: "10px",
			color: "var(--dsw-alias-label-primary, #e6ecff)",
		};

		function InstallConfirmDialog() {
			var s = useSyncExternalStore(store.subscribe, store.getSnapshot);
			var source = s.confirm;
			if (source === null) return null;
			return createElement("div", { style: CONFIRM_OVERLAY_STYLE },
				createElement("div", { style: CONFIRM_MASK_STYLE, onClick: () => store.patch({ confirm: null }) }),
				createElement("div", { style: CONFIRM_PANEL_STYLE, role: "dialog", "aria-modal": "true" },
					createElement("div", { style: { fontSize: "14px", fontWeight: 600 } }, "安装第三方插件"),
					createElement("div", { style: { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-secondary, #b8c5ea)", wordBreak: "break-all" } },
						"即将安装 " + source + "。第三方插件会在 DeepSeek Harness 进程权限范围内运行，请先审阅仓库来源与代码；安装完成后需重启应用生效。"),
					createElement("div", { style: { display: "flex", gap: "8px", justifyContent: "flex-end" } },
						createElement("button", { type: "button", style: ACT_STYLE, onClick: () => store.patch({ confirm: null }) }, "取消"),
						createElement("button", { type: "button", style: { ...ACT_STYLE, borderColor: "var(--dsw-alias-state-error-primary, #e81123)", color: "var(--dsw-alias-state-error-primary, #ff8a8a)" }, onClick: () => doInstall(source) }, "确认安装"))));
		}

		// ---- opener -----------------------------------------------------------
		// Preferred route: click the built-in 设置 trigger, then select the
		// marketplace section in its nav rail — the panel then IS the settings
		// panel. Falls back to the local overlay when the shell route is missing.
		function findFootArea(anchor) {
			var wrapper = null;
			if (anchor && anchor.closest) wrapper = anchor.closest('[data-slot="sidebar.footer.action"]');
			if (wrapper === null) wrapper = document.querySelector('[data-slot="sidebar.footer.action"]');
			return wrapper && wrapper.parentElement ? wrapper.parentElement.parentElement : null;
		}

		function openMarketplace(anchor) {
			var footArea = findFootArea(anchor);
			var trigger = footArea ? footArea.querySelector('button[aria-haspopup="dialog"]') : null;
			if (trigger === null) {
				store.patch({ open: true });
				return;
			}
			trigger.click();
			var attempts = 0;
			var tryNav = function () {
				var dlg = document.querySelector('[role="dialog"][aria-modal="true"]');
				if (dlg === null) return null;
				var cells = dlg.querySelectorAll("nav button");
				for (var i = 0; i < cells.length; i++) {
					if ((cells[i].textContent || "").indexOf("插件市场") !== -1) {
						cells[i].click();
						return true;
					}
				}
				return false; // dialog open but section missing
			};
			var r = tryNav();
			if (r === true) return;
			if (r === false) { store.patch({ open: true }); return; }
			var timer = setInterval(() => {
				attempts++;
				var r2 = tryNav();
				if (r2 === true) clearInterval(timer);
				else if (r2 === false || attempts > 12) {
					clearInterval(timer);
					store.patch({ open: true });
				}
			}, 100);
		}

		window.addEventListener("dsh-marketplace-open", () => openMarketplace(null));

		function apply(ctx) {
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "marketplace",
				order: 10,
				label: "插件市场",
				inject: () => ({}),
			}, MarketplaceButton));
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "marketplace",
				order: 90,
				label: "插件市场",
				inject: (owner) => ({ close: owner && owner.close }),
			}, MarketplaceSection));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "marketplace-panel",
				order: 20,
				label: "插件市场",
				inject: () => ({}),
			}, MarketplacePanel));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "marketplace-install-confirm",
				order: 30,
				label: "安装确认",
				inject: () => ({}),
			}, InstallConfirmDialog));
			console.log("[dsh-desktop] marketplace mounted (settings-native)");
		}

		exports.apply = apply;
		exports.inject = ["slots"];
		exports.MarketplaceButton = MarketplaceButton;
		exports.MarketplaceSection = MarketplaceSection;
		exports.MarketplacePanel = MarketplacePanel;
		return module.exports;
	}
});
