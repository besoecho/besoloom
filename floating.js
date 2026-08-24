import "./index.js";

const FLOAT_ROOT_ID = "besoloom_float_root";
const SETTINGS_ID = "besoloom_settings";

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
                <button class="besoloom_float_close" type="button" aria-label="收起 Beso Loom">×</button>
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
    const close = root.querySelector(".besoloom_float_close");

    const setOpen = (open) => {
        panel.hidden = !open;
        pill.setAttribute("aria-expanded", String(open));
        root.classList.toggle("is-open", open);
    };

    pill.addEventListener("click", () => setOpen(panel.hidden));
    close.addEventListener("click", () => setOpen(false));

    root.addEventListener("click", (event) => {
        const button = event.target.closest("[data-loom-action]");
        if (!button) return;
        triggerMainControl(button.dataset.loomAction);
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
        console.info("[Beso Loom] floating controls loaded");
    } catch (error) {
        console.error("[Beso Loom] floating controls failed", error);
    }
});
