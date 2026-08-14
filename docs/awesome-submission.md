# Awesome-list submission texts

Paste-ready blurbs for submitting this project to DSH ecosystem directories.
Both directories take GitHub issues or PRs; adapt the category header to their
current section layout.

---

## 1. `0xsline/awesome-deepseek-harness` 鈥?Infrastructure section

> Title / 鏍囬锛?*DeepSeek Harness Desktop 鈥?unofficial in-process desktop app**

**English:**

**DeepSeek Harness Desktop** is an unofficial Windows desktop application for DeepSeek Harness that follows the upstream integration seam instead of wrapping `dsh web` in a browser window. The full host composition boots **in-process inside the Electron main process** (via `dsh-app-boot`), the built Web frontend is served from a materialized dist copy over a privileged `app://localhost` scheme, and every `/api` request plus the mux/host event downlinks cross an **Electron IPC bridge** (`toFetchHandler(apiProxy)` 鈫?mock req/res 鈫?captured webServer routes). No child process, no listening port, no local HTTP server 鈥?the shipped 37 client plugin bundles run unmodified.

Highlights:

- Tray residency (close-to-tray keeps sessions, goals, and jobs running) and host-event-driven native notifications (approvals, questions, agent errors, background reply completion)
- First-run home wizard (private data dir or shared `~/.dsh`) with a live-`dsh web` conflict guard
- Renderer crash recovery with the host state intact; chunked IPC responses; session export with taskbar progress
- Ships the official black-whale favicon as the app icon; `electron-updater` wired; NSIS + portable builds
- Includes a repair tool for the upstream interruption-flush seq-reorder bug (`corrupt session log: seq gap in committed region`)

- Repository: <https://github.com/Easyhoov/deepseek-harness-desktop-windows>
- Status: working on Windows (macOS/Linux packaging planned) 路 MIT 路 unofficial (not affiliated with DeepSeek)

**涓枃锛?*

**DeepSeek Harness Desktop** 鏄?DeepSeek Harness 鐨勯潪瀹樻柟 Windows 妗岄潰搴旂敤銆備笉璧?spawn `dsh web` + 娴忚鍣ㄧ獥鍙?鐨勮杽灏佽璺嚎锛岃€屾槸鎸夊畼鏂归鐣欑殑闆嗘垚鎺ョ紳瀹炵幇锛歨ost 缁勫悎**鍦?Electron 涓昏繘绋嬪唴杩涚▼鍐呭惎鍔?*锛屾瀯寤哄ソ鐨?Web 鍓嶇浠?`app://localhost` 鐗规潈 scheme 鍔犺浇锛屽叏閮?`/api` 璇锋眰涓?mux/host 浜嬩欢涓嬭璧?**Electron IPC 妗?*锛坄toFetchHandler(apiProxy)` + 鎹曡幏鐨?webServer 璺敱锛夈€傛棤瀛愯繘绋嬨€佹棤绔彛銆佹棤鏈湴 HTTP 鏈嶅姟鍣紝鍑哄巶 37 涓鎴风鎻掍欢闆舵敼鍔ㄨ繍琛屻€?
浜偣锛氭墭鐩樺父椹伙紙鍏崇獥缁х画璺戯級+ 瀹夸富浜嬩欢娴佸師鐢熼€氱煡锛涢娆″惎鍔?home 鍚戝 + `dsh web` 骞跺彂鍐茬獊妫€娴嬶紱娓叉煋杩涚▼宕╂簝鑷姩鎭㈠锛涘垎鍧?IPC 鍝嶅簲锛涘鍑轰换鍔℃爮杩涘害锛涘畼鏂归粦椴搁奔鍥炬爣锛沞lectron-updater 鑷姩鏇存柊锛涢檮甯︿笂娓?涓柇鍥炲悎鍒风洏涔卞簭"鏃ュ織淇宸ュ叿銆侻IT锛岄潪瀹樻柟锛堜笌 DeepSeek 鏃犻毝灞炲叧绯伙級銆?
---

## 2. `AdamPlatin123/awesome-dsh-plugins` 鈥?Tools / infrastructure entry

> Note: this directory tracks DSH **plugins**; a desktop app is an adjacent
> deliverable. Only submit if their scope accepts tooling/infrastructure 鈥?> otherwise the `0xsline` list above is the right home.

**English:**

**DeepSeek Harness Desktop** 鈥?unofficial in-process desktop packaging of DeepSeek Harness: host composition inside the Electron main process, `app://` dist loading, all API traffic over an IPC bridge, zero ports. Complements any plugin set with tray residency, native notifications driven by host events, crash recovery, and a session-log repair tool for the upstream interruption-flush seq bug. MIT, Windows builds (NSIS/portable), not affiliated with DeepSeek. Repository: <https://github.com/Easyhoov/deepseek-harness-desktop-windows>

**涓枃锛?*

**DeepSeek Harness Desktop** 鈥斺€?DeepSeek Harness 闈炲畼鏂硅繘绋嬪唴妗岄潰灏佽锛歨ost 缁勫悎璺戝湪 Electron 涓昏繘绋嬨€乣app://` 鍔犺浇鍓嶇銆佸叏閮?API 璧?IPC 妗ャ€侀浂绔彛銆傛彁渚涙墭鐩樺父椹汇€佸涓讳簨浠跺師鐢熼€氱煡銆佸穿婧冩仮澶嶏紝浠ュ強涓婃父"涓柇鍥炲悎鍒风洏涔卞簭"鐨勪細璇濇棩蹇椾慨澶嶅伐鍏枫€侻IT锛學indows锛圢SIS/渚挎惡鐗堬級锛屼笌 DeepSeek 鏃犻毝灞炲叧绯汇€備粨搴擄細<https://github.com/Easyhoov/deepseek-harness-desktop-windows>

---

## Checklist before submitting

- [x] Repository public, with `README.md` (English + 涓枃), `LICENSE`, and the unofficial disclaimer at the top
- [x] Repository URL: https://github.com/Easyhoov/deepseek-harness-desktop
- [x] Topics set: `deepseek-harness`, `dsh-plugin`
- [x] Pick the right section (Infrastructure vs Plugins) and follow the target list's contribution format (issue vs PR)
