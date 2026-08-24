import { getContext } from "../../../extensions.js";
import "./index.js";

const FLOAT_ROOT_ID = "besoloom_float_root";
const SETTINGS_ID = "besoloom_settings";
const EXTENSION_FOLDER_NAME = "besoloom";

let updateRunning = false;

function waitForElement(selector, timeout = 12000) {
    return new Promise((resolve, reject) => {
        const found = document.querySelector(selector);
        if (found) {
            resolve(found);
            return;
        }

        const observer = new MutationObserver(() => {
            const node = document.querySelector(selector);
            if (!node) return;
            observer.disconnect();
            clearTimeout(timer);
            resolve(node);
        });

        observer.observe(document.documentElement, { childList: true, subtree: true });
        const timer = setTimeout(() => {
            observer.disconnect();
            reject(new Error(`Timed out waiting for ${selector}`));
        }, timeout);
    });
}

function text(selector, fallback = "") {
    return String(document.querySelector(selector)?.textContent || fallback).trim();
}

function snapshot() {
    const position = text("#besoloom_position", "—");
    const status = text("#besoloom_status", "等待剧情路线");
    const statusState = document.querySelector("#besoloom_status")?.getAttribute("data-state") || "idle";
    const currentNode = text("#besoloom_nodes .besoloom_node.is-current .besoloom_node_text", "还没有剧情节点");
    const note = text("#besoloom_inspection_note", "暂无巡检记录。");
    const disabled = Boolean(document.querySelector("#besoloom_inspect")?.disabled);
    const enabled = Boolean(document.querySelector("#besoloom_enabled")?.checked);
    return { position, status, statusState, currentNode, note, disabled, enabled };
}

function updateFloatingUi(root) {
    const state = snapshot();

    root.querySelectorAll("[data-loom-position]").forEach((node) => {
        node.textContent = state.position;
    });
    root.querySelector("[data-loom-status]").textContent = state.enabled ? state.status : "已停用";
    root.querySelector("[data-loom-status]").dataset.state = state.enabled ? state.statusState : "disabled";
    root.querySelector("[data-loom-node]").textContent = state.currentNode;
    root.querySelector("[data-loom-note]").textContent = state.note;

    for (const button of root.querySelectorAll("[data-loom-action]")) {
        button.disabled = state.disabled;
    }

    root.classList.toggle("is-disabled", !state.enabled);
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

function createFloatingUi(settingsRoot) {
    if (document.getElementById(FLOAT_ROOT_ID)) return;

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

            <div class="besoloom_float_status" data-loom-status data-state="idle">等待剧情路线</div>
            <div class="besoloom_float_node" data-loom-node>还没有剧情节点</div>

            <div class="besoloom_float_actions">
                <button type="button" data-loom-action="prev">← 上一节点</button>
                <button type="button" class="is-primary" data-loom-action="inspect">立即巡检</button>
                <button type="button" data-loom-action="next">下一节点 →</button>
            </div>

            <div class="besoloom_float_note">
                <span>最近巡检</span>
                <p data-loom-note>暂无巡检记录。</p>
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

    settingsRoot.querySelector("#besoloom_update")?.addEventListener("click", () => {
        void updateSelf();
    });

    const observer = new MutationObserver(() => updateFloatingUi(root));
    observer.observe(settingsRoot, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["disabled", "checked", "data-state"],
    });

    updateFloatingUi(root);
}

jQuery(async () => {
    try {
        const settingsRoot = await waitForElement(`#${SETTINGS_ID}`);
        createFloatingUi(settingsRoot);
        console.info("[Beso Loom] floating controls + self updater loaded");
    } catch (error) {
        console.error("[Beso Loom] floating controls failed", error);
    }
});
