import { getContext } from "../../../extensions.js";
import "./index.js";

const FLOAT_ROOT_ID = "besoloom_float_root";
const SETTINGS_ID = "besoloom_settings";
const EXTENSION_FOLDER_NAME = "besoloom";

let updateRunning = false;
let settingsObserver = null;
let pageObserver = null;

function text(selector, fallback = "") {
    return String(document.querySelector(selector)?.textContent || fallback).trim();
}

function snapshot() {
    const settingsReady = Boolean(document.getElementById(SETTINGS_ID));
    const inspectButton = document.querySelector("#besoloom_inspect");
    const enabledToggle = document.querySelector("#besoloom_enabled");

    return {
        settingsReady,
        position: text("#besoloom_position", "—"),
        status: text("#besoloom_status", settingsReady ? "等待剧情路线" : "正在连接剧情织机…"),
        statusState: document.querySelector("#besoloom_status")?.getAttribute("data-state") || "idle",
        currentNode: text(
            "#besoloom_nodes .besoloom_node.is-current .besoloom_node_text",
            settingsReady ? "还没有剧情节点" : "设置面板加载完成后会自动同步。",
        ),
        note: text("#besoloom_inspection_note", settingsReady ? "暂无巡检记录。" : "等待 Beso Loom 核心加载。"),
        controlsDisabled: !inspectButton || Boolean(inspectButton.disabled),
        enabled: enabledToggle ? Boolean(enabledToggle.checked) : true,
    };
}

function updateFloatingUi(root) {
    const state = snapshot();

    root.querySelectorAll("[data-loom-position]").forEach((node) => {
        node.textContent = state.position;
    });

    const status = root.querySelector("[data-loom-status]");
    if (status) {
        status.textContent = state.settingsReady
            ? (state.enabled ? state.status : "已停用")
            : "正在连接剧情织机…";
        status.dataset.state = state.settingsReady
            ? (state.enabled ? state.statusState : "disabled")
            : "working";
    }

    const node = root.querySelector("[data-loom-node]");
    if (node) node.textContent = state.currentNode;

    const note = root.querySelector("[data-loom-note]");
    if (note) note.textContent = state.note;

    for (const button of root.querySelectorAll("[data-loom-action]")) {
        button.disabled = state.controlsDisabled;
    }

    root.classList.toggle("is-disabled", state.settingsReady && !state.enabled);
}

function triggerMainControl(action) {
    const map = {
        prev: "#besoloom_prev",
        inspect: "#besoloom_inspect",
        next: "#besoloom_next",
    };
    const target = document.querySelector(map[action]);
    if (!target || target.disabled) {
        globalThis.toastr?.warning?.("先打开聊天并保存剧情路线。", "Beso Loom");
        return;
    }
    target.click();
}

async function updateSelf() {
    if (updateRunning) return;
    updateRunning = true;

    const buttons = Array.from(document.querySelectorAll("#besoloom_update, [data-loom-update]"));
    const labels = new Map();
    for (const button of buttons) {
        labels.set(button, button.textContent);
        button.disabled = true;
        if (button.id === "besoloom_update") button.textContent = "正在检查更新…";
    }

    try {
        const context = getContext();
        const headers = context?.getRequestHeaders?.() || { "Content-Type": "application/json" };
        const response = await fetch("/api/extensions/update", {
            method: "POST",
            headers,
            body: JSON.stringify({
                extensionName: EXTENSION_FOLDER_NAME,
                global: false,
            }),
        });

        if (!response.ok) {
            const detail = await response.text();
            throw new Error(detail || `HTTP ${response.status}`);
        }

        const result = await response.json();
        if (result?.isUpToDate) {
            globalThis.toastr?.success?.("已经是最新版本。", "Beso Loom");
        } else {
            const hash = result?.shortCommitHash ? `（${result.shortCommitHash}）` : "";
            globalThis.toastr?.success?.(`更新成功${hash}，刷新页面后生效。`, "Beso Loom");
        }
    } catch (error) {
        console.error("[Beso Loom] self update failed", error);
        globalThis.toastr?.error?.(String(error?.message || error), "Beso Loom 更新失败");
    } finally {
        updateRunning = false;
        for (const button of buttons) {
            button.disabled = false;
            if (labels.has(button)) button.textContent = labels.get(button);
        }
    }
}

function connectSettings(root) {
    const settingsRoot = document.getElementById(SETTINGS_ID);
    if (!settingsRoot) return false;

    if (settingsObserver) settingsObserver.disconnect();
    settingsObserver = new MutationObserver(() => updateFloatingUi(root));
    settingsObserver.observe(settingsRoot, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["disabled", "checked", "data-state"],
    });

    const updateButton = settingsRoot.querySelector("#besoloom_update");
    if (updateButton && !updateButton.dataset.loomBound) {
        updateButton.dataset.loomBound = "true";
        updateButton.addEventListener("click", () => {
            void updateSelf();
        });
    }

    updateFloatingUi(root);
    return true;
}

function watchForSettings(root) {
    if (connectSettings(root)) return;

    if (pageObserver) pageObserver.disconnect();
    pageObserver = new MutationObserver(() => {
        if (!connectSettings(root)) return;
        pageObserver.disconnect();
        pageObserver = null;
    });
    pageObserver.observe(document.documentElement, { childList: true, subtree: true });
}

function createFloatingUi() {
    const existing = document.getElementById(FLOAT_ROOT_ID);
    if (existing) {
        watchForSettings(existing);
        updateFloatingUi(existing);
        return existing;
    }

    const root = document.createElement("div");
    root.id = FLOAT_ROOT_ID;
    root.innerHTML = `
        <button class="besoloom_float_pill" type="button" aria-expanded="false" aria-controls="besoloom_float_panel" title="打开 Beso Loom">
            <span class="besoloom_float_mark" aria-hidden="true">🧵</span>
            <span class="besoloom_float_name">Loom</span>
            <span class="besoloom_float_pos" data-loom-position>—</span>
        </button>

        <section id="besoloom_float_panel" class="besoloom_float_panel" hidden>
            <header class="besoloom_float_header">
                <div>
                    <strong>Beso Loom</strong>
                    <span class="besoloom_float_subtitle">当前节点 <b data-loom-position>—</b></span>
                </div>
                <div>
                    <button class="besoloom_float_close" type="button" data-loom-update title="检查并更新 Beso Loom" aria-label="检查并更新 Beso Loom">↻</button>
                    <button class="besoloom_float_close" type="button" data-loom-close aria-label="收起 Beso Loom">×</button>
                </div>
            </header>

            <div class="besoloom_float_status" data-loom-status data-state="working">正在连接剧情织机…</div>
            <div class="besoloom_float_node" data-loom-node>设置面板加载完成后会自动同步。</div>

            <div class="besoloom_float_actions">
                <button type="button" data-loom-action="prev" disabled>← 上一节点</button>
                <button type="button" class="is-primary" data-loom-action="inspect" disabled>立即巡检</button>
                <button type="button" data-loom-action="next" disabled>下一节点 →</button>
            </div>

            <div class="besoloom_float_note">
                <span>最近巡检</span>
                <p data-loom-note>等待 Beso Loom 核心加载。</p>
            </div>
        </section>
    `;

    document.body.appendChild(root);

    const pill = root.querySelector(".besoloom_float_pill");
    const panel = root.querySelector(".besoloom_float_panel");
    const close = root.querySelector("[data-loom-close]");

    const setOpen = (open) => {
        panel.hidden = !open;
        pill.setAttribute("aria-expanded", String(open));
        root.classList.toggle("is-open", open);
    };

    pill.addEventListener("click", () => setOpen(panel.hidden));
    close.addEventListener("click", () => setOpen(false));

    root.addEventListener("click", (event) => {
        if (!(event.target instanceof Element)) return;

        const updater = event.target.closest("[data-loom-update]");
        if (updater) {
            void updateSelf();
            return;
        }

        const button = event.target.closest("[data-loom-action]");
        if (!button) return;
        triggerMainControl(button.dataset.loomAction);
    });

    updateFloatingUi(root);
    watchForSettings(root);
    return root;
}

function bootFloatingUi() {
    try {
        createFloatingUi();
        console.info("[Beso Loom] floating controls mounted");
    } catch (error) {
        console.error("[Beso Loom] floating controls failed", error);
    }
}

if (document.body) {
    bootFloatingUi();
} else {
    document.addEventListener("DOMContentLoaded", bootFloatingUi, { once: true });
}
