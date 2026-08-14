window.__ModuleLoader__.load({
	id: "@dsh-desktop/file-changes",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		var React = require("react");
		var createElement = React.createElement;
		var useSyncExternalStore = React.useSyncExternalStore;
		var useEffect = React.useEffect;
		var useLayoutEffect = React.useLayoutEffect;
		var useRef = React.useRef;
		var useState = React.useState;

		// Module-wide store: header button + overlay panel share it.
		var store = {
			state: { open: false, sessionId: null, cwd: "", changes: [], busy: new Set(), lastResult: "" },
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

		var bridge = window.dshDesktop && window.dshDesktop.fileChanges ? window.dshDesktop.fileChanges : null;

		// Live pushes from the host plugin.
		window.addEventListener("dsh-file-changes-changed", (event) => {
			var detail = event.detail || {};
			if (detail.sessionId === store.state.sessionId) {
				store.patch({ cwd: detail.cwd || "", changes: detail.changes || [] });
			}
		});

		function loadChanges(sessionId) {
			if (bridge === null) return;
			void Promise.resolve(bridge.get(sessionId)).then((result) => {
				if (result && result.ok) {
					store.patch({ sessionId, cwd: result.cwd, changes: result.changes });
				}
			});
		}

		function revertOp(sessionId, opId) {
			if (bridge === null) return;
			var busy = new Set(store.state.busy);
			busy.add(opId);
			store.patch({ busy, lastResult: "" });
			void Promise.resolve(bridge.revert(sessionId, opId)).then((result) => {
				var next = new Set(store.state.busy);
				next.delete(opId);
				store.patch({ busy: next, lastResult: result && result.ok ? "已还原" : "还原失败：" + (result && result.reason) });
				loadChanges(sessionId);
			});
		}

		function revertAll(sessionId) {
			if (bridge === null) return;
			store.patch({ busy: new Set(["__all__"]), lastResult: "" });
			void Promise.resolve(bridge.revertAll(sessionId)).then((result) => {
				store.patch({ busy: new Set(), lastResult: result && result.ok ? "已全部还原" : "还原失败" });
				loadChanges(sessionId);
			});
		}

		// ---- header button ----------------------------------------------------
		// Registered in the title-adjacent action row, then physically moved into
		// the view-tab row (对话 / 轨迹) so it sits right next to the tabs. The
		// move is DOM-level (the shell offers no slot inside the tab row) and is
		// kept reversible: on unmount the button returns to its holder span first,
		// so React can remove it cleanly.
		var TAB_BTN_STYLE = {
			display: "inline-block",
			color: "var(--dsw-alias-label-tertiary, #93a5d8)",
			cursor: "pointer",
			background: "transparent",
			border: "none",
			padding: "0 0 11px",
			fontSize: "13px",
			fontWeight: 500,
			lineHeight: "16px",
			position: "relative",
		};
		var CHIP_BTN_STYLE = {
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

		function FileChangesButton(props) {
			var s = useSyncExternalStore(store.subscribe, store.getSnapshot);
			var sessionId = props.sessionId;
			var holderRef = useRef(null);
			var btnRef = useRef(null);
			var inTabsDraft = useState(false);
			var inTabs = inTabsDraft[0];
			var setInTabs = inTabsDraft[1];
			useEffect(() => {
				if (typeof sessionId === "string" && sessionId !== "") loadChanges(sessionId);
			}, [sessionId]);
			useLayoutEffect(() => {
				var btn = btnRef.current;
				var holder = holderRef.current;
				if (btn === null || holder === null) return;
				var header = null;
				var tabs = null;
				var ensure = function () {
					if (header === null || !document.contains(header)) {
						header = holder.closest("header");
						tabs = null;
					}
					if (tabs === null || !document.contains(tabs)) {
						tabs = header === null ? null : header.querySelector('[role="tablist"]');
					}
					var next = tabs !== null;
					if (next) {
						if (btn.parentElement !== tabs) { try { tabs.appendChild(btn); } catch (_) {} }
					} else if (btn.parentElement !== holder) {
						try { holder.appendChild(btn); } catch (_) {}
					}
					setInTabs((prev) => (prev === next ? prev : next));
				};
				ensure();
				var mo = header !== null && typeof MutationObserver !== "undefined" ? new MutationObserver(ensure) : null;
				if (mo !== null) mo.observe(header, { childList: true });
				var iv = setInterval(ensure, 1500);
				return () => {
					if (mo !== null) mo.disconnect();
					clearInterval(iv);
					if (btn.parentElement !== holder) { try { holder.appendChild(btn); } catch (_) {} }
				};
			}, []);
			var count = typeof sessionId === "string" && sessionId === store.state.sessionId ? store.state.changes.length : 0;
			return createElement("span", { ref: holderRef, style: { display: "contents" } },
				createElement("button", {
					ref: btnRef,
					type: "button",
					style: inTabs ? TAB_BTN_STYLE : CHIP_BTN_STYLE,
					title: "本会话文件改动",
					onClick: () => {
						if (typeof sessionId !== "string" || sessionId === "") return;
						store.patch({ open: true, sessionId });
						loadChanges(sessionId);
					},
				}, "文件" + (count > 0 ? " (" + count + ")" : "")));
		}

		// ---- overlay panel ----------------------------------------------------
		var PANEL_STYLE = {
			position: "absolute",
			inset: "0",
			zIndex: 4000,
			display: "flex",
			alignItems: "flex-start",
			justifyContent: "center",
			paddingTop: "10vh",
			background: "rgba(5,8,18,.45)",
			pointerEvents: "auto",
		};
		var CARD_STYLE = {
			width: "min(560px, 88vw)",
			maxHeight: "72vh",
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
		var ROW_STYLE = {
			display: "flex",
			justifyContent: "space-between",
			alignItems: "center",
			gap: "10px",
			padding: "8px 4px",
			borderBottom: "1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.06))",
			fontSize: "12px",
		};
		var REVERT_STYLE = {
			cursor: "pointer",
			border: "1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.16))",
			background: "transparent",
			color: "var(--dsw-alias-label-primary, #e6ecff)",
			borderRadius: "8px",
			padding: "3px 10px",
			fontSize: "11px",
		};

		function FileChangesPanel() {
			var s = useSyncExternalStore(store.subscribe, store.getSnapshot);
			if (!s.open) return null;
			var close = () => store.patch({ open: false });
			var rows = s.changes.map((op) => {
				var label = op.command + " · " + (op.added > 0 ? "+" + op.added : "") + (op.removed > 0 ? " −" + op.removed : "");
				var status = op.status === "error" ? " ✗" : "";
				var busy = s.busy.has(op.id);
				return createElement("div", { key: op.id, style: ROW_STYLE },
					createElement("div", { style: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, color: "var(--dsw-alias-label-secondary, #b8c5ea)" } },
						op.path + status),
					createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px", flex: "none" } },
						createElement("span", { style: { color: "var(--dsw-alias-label-tertiary, #93a5d8)", fontSize: "11px" } }, label),
						createElement("button", {
							style: REVERT_STYLE,
							disabled: !op.revertable || op.status !== "success" || busy,
							onClick: () => revertOp(s.sessionId, op.id),
						}, busy ? "…" : "还原")));
			});
			return createElement("div", { style: PANEL_STYLE, onClick: (e) => { if (e.target === e.currentTarget) close(); } },
				createElement("div", { style: CARD_STYLE },
					createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" } },
						createElement("div", { style: { fontSize: "14px", fontWeight: 600 } }, "文件改动（本会话）"),
						createElement("button", { style: REVERT_STYLE, onClick: close }, "关闭")),
					s.changes.length === 0
						? createElement("div", { style: { color: "var(--dsw-alias-label-tertiary, #93a5d8)", fontSize: "12px", padding: "16px 4px" } }, "本会话暂无文件改动记录。")
						: rows,
					s.changes.length > 0
						? createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px" } },
							createElement("span", { style: { color: "var(--dsw-alias-label-tertiary, #93a5d8)", fontSize: "11px" } }, s.lastResult),
							createElement("button", {
								style: REVERT_STYLE,
								disabled: s.busy.has("__all__"),
								onClick: () => revertAll(s.sessionId),
							}, "全部还原"))
						: null));
		}

		function apply(ctx) {
			ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "file-changes",
				order: 10,
				label: "文件改动",
				inject: (sessionId) => ({ sessionId }),
			}, FileChangesButton));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "file-changes-panel",
				order: 10,
				label: "文件改动",
				inject: () => ({}),
			}, FileChangesPanel));
			console.log("[dsh-desktop] file-changes widget mounted");
		}

		exports.apply = apply;
		exports.inject = ["slots"];
		exports.FileChangesButton = FileChangesButton;
		exports.FileChangesPanel = FileChangesPanel;
		return module.exports;
	}
});
