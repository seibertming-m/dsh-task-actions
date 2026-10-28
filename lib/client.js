window.__ModuleLoader__.load({
	id: "dsh-task-actions",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const h = React.createElement;

		/** Dictionary namespace owned by this plugin. */
		const NS = "session-actions";
		/** Required Cordis services. */
		const inject = ["slots", "locale"];
		/** Host route prefix served by this package's Node half. */
		const ENDPOINT = "/x-session-actions";

		const zh = {
			"menu.move": "移动到其他空间…",
			"menu.delete": "删除任务…",
			"move.title": "移动到其他空间",
			"move.desc": "把「{title}」移动到另一个空间。会话记录会一起搬过去。",
			"move.current": "当前空间",
			"move.empty": "没有其他空间可移动。请先在左侧添加另一个空间。",
			"move.action": "移动",
			"delete.title": "删除任务",
			"delete.desc": "「{title}」会从侧栏移除，会话文件移入 DSH 回收站（~/.dsh/trash/sessions），不会立即永久删除。",
			"delete.action": "删除",
			"cancel": "取消",
			"busy": "处理中…",
			"moving.done": "已移动，正在刷新…",
			"deleting.done": "已删除，正在刷新…",
			"unavailable": "宿主插件没有响应。请确认 dsh-task-actions 已安装，然后重启 DSH 再试。",
			"close": "关闭"
		};

		const en = {
			"menu.move": "Move to another space…",
			"menu.delete": "Delete task…",
			"move.title": "Move to another space",
			"move.desc": "Move “{title}” into another workspace. Its session log moves with it.",
			"move.current": "Current space",
			"move.empty": "No other workspace is available. Add one in the sidebar first.",
			"move.action": "Move",
			"delete.title": "Delete task",
			"delete.desc": "“{title}” disappears from the sidebar and its session files move to the DSH trash (~/.dsh/trash/sessions). This is not an immediate permanent delete.",
			"delete.action": "Delete",
			"cancel": "Cancel",
			"busy": "Working…",
			"moving.done": "Moved. Reloading…",
			"deleting.done": "Deleted. Reloading…",
			"unavailable": "The host plugin did not respond. Make sure dsh-task-actions is installed, then restart DSH.",
			"close": "Close"
		};

		/** One pending dialog, shared between the menu rows and the overlay. */
		let pending = null;
		const listeners = new Set();

		function publish(next) {
			pending = next;
			for (const listener of listeners) {
				try {
					listener();
				} catch {
					/* a stale subscriber must not block the rest */
				}
			}
		}

		function subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}

		function usePending() {
			const [value, setValue] = React.useState(pending);
			React.useEffect(() => {
				setValue(pending);
				return subscribe(() => setValue(pending));
			}, []);
			return value;
		}

		function messageOf(reason) {
			if (reason && typeof reason.message === "string" && reason.message !== "") return reason.message;
			return "unknown error";
		}

		/** Call one host route; throw the host's message on failure. */
		async function callJson(path, options) {
			const settings = options || {};
			let response;
			try {
				response = await fetch(ENDPOINT + path, {
					method: settings.method || "GET",
					credentials: "same-origin",
					cache: "no-store",
					headers: Object.assign({ "x-session-actions": "1", "content-type": "application/json" }, settings.headers),
					body: settings.body
				});
			} catch {
				throw new Error(translate("unavailable"));
			}
			let payload = null;
			try {
				payload = await response.json();
			} catch {
				payload = null;
			}
			if (!response.ok || payload === null || payload.ok !== true) {
				if (response.status === 401 || response.status === 404) throw new Error(translate("unavailable"));
				if (payload && typeof payload.error === "string" && payload.error !== "") throw new Error(payload.error);
				throw new Error("HTTP " + response.status);
			}
			return payload;
		}

		/** Resolve a dictionary key without a locale prop. */
		function translate(key, params) {
			let text = zh[key] || key;
			if (params) {
				for (const name of Object.keys(params)) {
					text = text.split("{" + name + "}").join(String(params[name]));
				}
			}
			return text;
		}

		const styles = {
			overlay: {
				position: "fixed",
				inset: 0,
				zIndex: 2147483000,
				background: "rgba(0,0,0,0.42)",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				padding: "24px"
			},
			card: {
				width: "min(440px, 100%)",
				maxHeight: "80vh",
				overflow: "auto",
				borderRadius: "12px",
				background: "var(--dsh-surface, #ffffff)",
				color: "var(--dsh-text, #1f2329)",
				boxShadow: "0 18px 48px rgba(0,0,0,0.28)",
				padding: "20px"
			},
			title: {
				fontSize: "16px",
				fontWeight: 600,
				lineHeight: "24px",
				margin: 0
			},
			desc: {
				marginTop: "8px",
				fontSize: "13px",
				lineHeight: "20px",
				opacity: 0.72
			},
			list: {
				marginTop: "14px",
				display: "flex",
				flexDirection: "column",
				gap: "6px"
			},
			option: {
				display: "flex",
				flexDirection: "column",
				alignItems: "flex-start",
				gap: "2px",
				width: "100%",
				padding: "9px 12px",
				borderRadius: "8px",
				border: "1px solid rgba(127,127,127,0.28)",
				background: "transparent",
				color: "inherit",
				textAlign: "left",
				cursor: "pointer",
				font: "inherit"
			},
			optionActive: {
				borderColor: "var(--dsh-accent, #4d6bfe)",
				background: "rgba(77,107,254,0.08)"
			},
			optionTitle: {
				fontSize: "13px",
				fontWeight: 500
			},
			optionPath: {
				fontSize: "11px",
				opacity: 0.55,
				wordBreak: "break-all"
			},
			badge: {
				marginLeft: "6px",
				fontSize: "10px",
				opacity: 0.5
			},
			footer: {
				marginTop: "18px",
				display: "flex",
				justifyContent: "flex-end",
				gap: "8px"
			},
			button: {
				padding: "6px 14px",
				borderRadius: "8px",
				border: "1px solid rgba(127,127,127,0.35)",
				background: "transparent",
				color: "inherit",
				font: "inherit",
				fontSize: "13px",
				cursor: "pointer"
			},
			primary: {
				borderColor: "transparent",
				background: "var(--dsh-accent, #4d6bfe)",
				color: "#ffffff"
			},
			danger: {
				borderColor: "transparent",
				background: "#e5484d",
				color: "#ffffff"
			},
			error: {
				marginTop: "12px",
				fontSize: "12px",
				lineHeight: "18px",
				color: "#e5484d"
			},
			status: {
				marginTop: "12px",
				fontSize: "12px",
				lineHeight: "18px",
				opacity: 0.7
			},
			item: {
				display: "flex",
				alignItems: "center",
				width: "100%",
				padding: "7px 12px",
				border: "none",
				borderRadius: "6px",
				background: "transparent",
				color: "inherit",
				font: "inherit",
				fontSize: "13px",
				textAlign: "left",
				cursor: "pointer"
			}
		};

		/** One menu row with hover/focus feedback. */
		function MenuRow(props) {
			const [hovered, setHovered] = React.useState(false);
			const style = Object.assign({}, styles.item, {
				background: hovered ? "rgba(127,127,127,0.14)" : "transparent",
				color: props.danger ? "#e5484d" : "inherit"
			});
			return h(
				"button",
				{
					type: "button",
					role: "menuitem",
					style: style,
					onMouseEnter: () => setHovered(true),
					onMouseLeave: () => setHovered(false),
					onFocus: () => setHovered(true),
					onBlur: () => setHovered(false),
					onClick: props.onSelect
				},
				props.label
			);
		}

		/** Row-menu entry: move this task to another workspace. */
		function MoveMenuItem(props) {
			const t = typeof props.t === "function" ? props.t : (key) => translate(key);
			const menu = props.useMenuOpenState();
			const close = menu[1];
			return h(MenuRow, {
				label: t("menu.move"),
				onSelect: () => {
					close(false);
					publish({ kind: "move", sessionId: props.sessionId, title: props.displayTitle });
				}
			});
		}

		/** Row-menu entry: remove this task from the sidebar. */
		function DeleteMenuItem(props) {
			const t = typeof props.t === "function" ? props.t : (key) => translate(key);
			const menu = props.useMenuOpenState();
			const close = menu[1];
			return h(MenuRow, {
				label: t("menu.delete"),
				danger: true,
				onSelect: () => {
					close(false);
					publish({ kind: "delete", sessionId: props.sessionId, title: props.displayTitle });
				}
			});
		}

		/** The single overlay dialog driven by the shared pending request. */
		function SessionActionsDialog(props) {
			const request = usePending();
			const t = typeof props.t === "function" ? props.t : (key, params) => translate(key, params);
			if (request === null) return null;
			return h(DialogBody, { request: request, t: t }, request.kind + ":" + request.sessionId);
		}

		/** One request's dialog; its fetch and in-flight state die with it. */
		function DialogBody(props) {
			const request = props.request;
			const t = props.t;
			const [workspaces, setWorkspaces] = React.useState(null);
			const [currentId, setCurrentId] = React.useState(null);
			const [selected, setSelected] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState("");
			const [done, setDone] = React.useState("");

			React.useEffect(() => {
				if (request.kind !== "move") return undefined;
				let cancelled = false;
				callJson("/workspaces?sessionId=" + encodeURIComponent(request.sessionId))
					.then((payload) => {
						if (cancelled) return;
						const list = Array.isArray(payload.workspaces) ? payload.workspaces : [];
						setWorkspaces(list);
						setCurrentId(payload.currentId || null);
						const first = list.find((workspace) => workspace.id !== payload.currentId);
						setSelected(first ? first.id : null);
					})
					.catch((reason) => {
						if (!cancelled) setError(messageOf(reason));
					});
				return () => {
					cancelled = true;
				};
			}, [request]);

			const close = () => {
				if (busy) return;
				publish(null);
			};

			const submit = () => {
				if (busy) return;
				if (request.kind === "move" && selected === null) return;
				setBusy(true);
				setError("");
				const path = request.kind === "move" ? "/move" : "/delete";
				const body =
					request.kind === "move"
						? { sessionId: request.sessionId, targetWorkspaceId: selected }
						: { sessionId: request.sessionId };
				callJson(path, { method: "POST", body: JSON.stringify(body) })
					.then(() => {
						setBusy(false);
						setDone(t(request.kind === "move" ? "moving.done" : "deleting.done"));
						window.setTimeout(() => window.location.reload(), 900);
					})
					.catch((reason) => {
						setBusy(false);
						setError(messageOf(reason));
					});
			};

			const move = request.kind === "move";
			const title = move ? t("move.title") : t("delete.title");
			const desc = move
				? t("move.desc", { title: request.title || request.sessionId })
				: t("delete.desc", { title: request.title || request.sessionId });

			const children = [];
			children.push(h("h2", { key: "title", style: styles.title }, title));
			children.push(h("p", { key: "desc", style: styles.desc }, desc));

			if (done !== "") {
				children.push(h("div", { key: "status", style: styles.status, role: "status" }, done));
			} else if (move) {
				if (workspaces === null && error === "") {
					children.push(h("div", { key: "loading", style: styles.status, role: "status" }, t("busy")));
				} else if (workspaces !== null && workspaces.length <= 1) {
					children.push(h("div", { key: "empty", style: styles.status }, t("move.empty")));
				} else if (workspaces !== null) {
					const rows = workspaces.map((workspace) => {
						const isCurrent = workspace.id === currentId;
						const active = workspace.id === selected;
						const style = Object.assign({}, styles.option, active ? styles.optionActive : {});
						return h(
							"button",
							{
								key: workspace.id,
								type: "button",
								style: style,
								disabled: isCurrent || busy,
								onClick: () => setSelected(workspace.id)
							},
							h(
								"span",
								{ style: styles.optionTitle },
								workspace.title || workspace.path,
								isCurrent ? h("span", { style: styles.badge }, t("move.current")) : null
							),
							h("span", { style: styles.optionPath }, workspace.path)
						);
					});
					children.push(h("div", { key: "list", style: styles.list }, rows));
				}
			}

			if (error !== "") children.push(h("div", { key: "error", style: styles.error, role: "alert" }, error));
			if (busy) children.push(h("div", { key: "busy", style: styles.status, role: "status" }, t("busy")));

			const canSubmit = !busy && done === "" && (!move || selected !== null);
			const footer = h(
				"div",
				{ key: "footer", style: styles.footer },
				h("button", { type: "button", style: styles.button, disabled: busy, onClick: close }, t("cancel")),
				h(
					"button",
					{
						type: "button",
						style: Object.assign({}, styles.button, move ? styles.primary : styles.danger),
						disabled: !canSubmit,
						onClick: submit
					},
					move ? t("move.action") : t("delete.action")
				)
			);
			children.push(footer);

			return h(
				"div",
				{
					style: styles.overlay,
					onMouseDown: (event) => {
						if (event.target === event.currentTarget) close();
					}
				},
				h(
					"div",
					{ style: styles.card, role: "dialog", "aria-modal": "true", "aria-label": title },
					children
				)
			);
		}

		/** Register the two row-menu entries and the shared overlay dialog. */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "session-actions: dictionaries");
			ctx.slots.inject("sidebar.workspaces.session.menu.item", function* () {
				yield ctx.slots.register(
					{
						name: "sidebar.workspaces.session.menu.item",
						id: "session-actions.move",
						order: 460,
						locale: NS
					},
					MoveMenuItem
				);
				yield ctx.slots.register(
					{
						name: "sidebar.workspaces.session.menu.item",
						id: "session-actions.delete",
						order: 470,
						locale: NS
					},
					DeleteMenuItem
				);
			});
			ctx.slots.inject("shell.overlay", () =>
				ctx.slots.register(
					{
						name: "shell.overlay",
						id: "session-actions.dialogs",
						locale: NS
					},
					SessionActionsDialog
				)
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
