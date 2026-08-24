const ROOT_ID = "besoloom_float_root";
const PROBE_ID = "besoloom_mount_probe";
const PREF_KEY = "besoloom:floating-enabled";

function floatEnabled() {
    try {
        return localStorage.getItem(PREF_KEY) !== "false";
    } catch {
        return true;
    }
}

function forceRealFloatVisible() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return false;

    if (!floatEnabled()) return true;

    root.hidden = false;
    root.style.setProperty("position", "fixed", "important");
    root.style.setProperty("top", "92px", "important");
    root.style.setProperty("right", "10px", "important");
    root.style.setProperty("bottom", "auto", "important");
    root.style.setProperty("left", "auto", "important");
    root.style.setProperty("z-index", "2147483647", "important");
    root.style.setProperty("display", "block", "important");
    root.style.setProperty("visibility", "visible", "important");
    root.style.setProperty("opacity", "1", "important");
    root.style.setProperty("pointer-events", "auto", "important");

    const pill = root.querySelector(".besoloom_float_pill");
    if (pill) {
        pill.style.setProperty("display", "flex", "important");
        pill.style.setProperty("visibility", "visible", "important");
        pill.style.setProperty("opacity", "1", "important");
    }

    document.getElementById(PROBE_ID)?.remove();
    return true;
}

function ensureProbe() {
    if (document.getElementById(PROBE_ID) || forceRealFloatVisible()) return;

    const probe = document.createElement("button");
    probe.id = PROBE_ID;
    probe.type = "button";
    probe.textContent = "🧵 Loom";
    probe.title = "Beso Loom 浮窗挂载诊断";
    probe.style.cssText = [
        "position:fixed!important",
        "top:92px!important",
        "right:10px!important",
        "z-index:2147483647!important",
        "display:flex!important",
        "align-items:center!important",
        "gap:6px!important",
        "min-height:42px!important",
        "padding:8px 12px!important",
        "border:1px solid rgba(211,185,226,.55)!important",
        "border-radius:999px!important",
        "background:rgba(31,28,36,.97)!important",
        "color:#f2edf4!important",
        "font:600 14px/1.2 sans-serif!important",
        "box-shadow:0 8px 28px rgba(0,0,0,.42)!important",
        "visibility:visible!important",
        "opacity:1!important",
        "pointer-events:auto!important"
    ].join(";");

    probe.addEventListener("click", () => {
        if (forceRealFloatVisible()) return;
        globalThis.toastr?.warning?.("入口已运行，但正式浮窗 DOM 没有挂载。", "Beso Loom");
    });

    document.body.appendChild(probe);
}

function startWatchdog() {
    if (!document.body) return;
    ensureProbe();
    window.setInterval(() => {
        if (!forceRealFloatVisible()) ensureProbe();
    }, 1000);
    console.info("[Beso Loom] mount watchdog active");
}

if (document.body) {
    window.setTimeout(startWatchdog, 700);
} else {
    document.addEventListener("DOMContentLoaded", () => window.setTimeout(startWatchdog, 700), { once: true });
}
