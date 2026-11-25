// Shared building blocks (same as Agent Access): host tokens + the "Ink & clay" accents
// (navy ink, sage teal, ochre, clay), kept low-saturation so both plugins match.
const SKY = "#24324A"; // navy accent for important buttons and selected states
const ON_SKY = "#F4F2EA";
const INK = "#1E2533";
const RED = "#9A5641"; // clay
const YELLOW = "#E3D3AE"; // ochre tint, used as a highlighter
const SAGE = "#BFD2D0"; // sage tint, used as a highlighter
const T = {
  text: "var(--text-standard)", subtle: "var(--text-subtle)", meta: "var(--text-metadata)",
  panel: "var(--surface-panel)", inset: "var(--surface-inset)", border: "var(--border-standard)",
  prominent: "var(--border-prominent)", focus: "var(--border-focus)",
  primary: "var(--affordance-prominent)", onPrimary: "var(--text-inverse)", subtleBg: "var(--affordance-subtle)",
  selected: "var(--affordance-selected)", danger: "var(--text-danger)", dangerBg: "var(--affordance-danger)",
  warn: "var(--text-warning)", warnBg: "var(--affordance-warning)", ok: "var(--text-success)", okBg: "var(--affordance-success)",
  online: "var(--status-online)", pad: "var(--space-panel-inset, 16px)",
};
const timeLabel = (at) => {
  const d = new Date(at);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" });
};
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

// ----- building blocks -----
function Page({ h, children }) {
  return h("div", { style: { padding: "32px clamp(16px, 4vw, 48px) 64px", color: T.text, overflowY: "auto", height: "100%", boxSizing: "border-box" } },
    h("div", { style: { maxWidth: 960, margin: "0 auto", display: "flex", flexDirection: "column", gap: 28 } }, children));
}
const btnBase = { minHeight: 36, padding: "0 14px", borderRadius: 8, font: "inherit", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, whiteSpace: "nowrap" };
const BTN = {
  primary: { ...btnBase, border: `1px solid ${T.primary}`, background: T.primary, color: T.onPrimary },
  quiet: { ...btnBase, border: `1px solid ${T.border}`, background: T.panel, color: T.text },
  sky: { ...btnBase, border: `1px solid ${T.prominent}`, background: SKY, color: ON_SKY },
  danger: { ...btnBase, border: `1px solid ${T.danger}`, background: T.panel, color: T.danger },
};
function Btn({ h, kind = "quiet", onClick, disabled, children, label, style }) {
  return h("button", { type: "button", onClick, disabled, "aria-label": label, style: { ...BTN[kind], ...(disabled ? { opacity: 0.45, cursor: "not-allowed" } : null), ...style } }, children);
}
function Card({ h, children, style }) {
  return h("div", { style: { border: `1px solid ${T.border}`, borderRadius: 12, background: T.panel, ...style } }, children);
}
function Callout({ h, icon, tone, children }) {
  const bg = tone === "warn" ? T.warnBg : tone === "danger" ? T.dangerBg : T.inset;
  return h("div", { style: { display: "flex", gap: 12, padding: "14px 16px", borderRadius: 8, background: bg, fontSize: 14, lineHeight: 1.55 } },
    h("span", { "aria-hidden": true, style: { fontSize: 18 } }, icon), h("div", { style: { flex: 1 } }, children));
}
function H2({ h, children, badge }) {
  return h("h2", { style: { margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", display: "flex", alignItems: "center", gap: 10 } }, children, badge ? h(Badge, { h }, badge) : null);
}
function Badge({ h, children }) {
  return h("span", { style: { minWidth: 22, height: 22, padding: "0 7px", borderRadius: 999, background: RED, color: "#fff", fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" } }, children);
}
function Chip({ h, children, bg, color }) {
  return h("span", { style: { display: "inline-flex", alignItems: "center", height: 24, padding: "0 8px", borderRadius: 6, background: bg || T.inset, color: color || T.text, fontSize: 13, fontWeight: 500, whiteSpace: "nowrap" } }, children);
}
const Sub = ({ h, children, style }) => h("p", { style: { margin: 0, fontSize: 14, lineHeight: 1.55, color: T.subtle, ...style } }, children);
const Kicker = ({ h, children }) => h("span", { style: { fontSize: 12, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: T.meta } }, children);
function Paper({ h, art, alt, style }) {
  // Black-ink drawings sit on white paper so they read in dark mode too.
  return h("div", { style: { background: "#fff", border: `2px solid ${INK}`, borderRadius: 12, overflow: "hidden", ...style } },
    h("img", { src: ART[art], alt: alt || "", style: { display: "block", width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 0" } }));
}
function Toggle({ h, ui, on, onChange, label }) {
  if (ui?.Switch) return h(ui.Switch, { checked: on, onCheckedChange: onChange, "aria-label": label });
  return h("button", { type: "button", role: "switch", "aria-checked": on, "aria-label": label, onClick: () => onChange(!on),
    style: { position: "relative", width: 40, height: 24, flex: "0 0 40px", borderRadius: 999, border: 0, cursor: "pointer", background: on ? SKY : "#8F8A7C" } },
    h("span", { style: { position: "absolute", top: 3, left: on ? 19 : 3, width: 18, height: 18, borderRadius: "50%", background: "#F4F2EA", transition: "left .15s" } }));
}
function Pills({ h, options, value, onChange, label }) {
  return h("div", { role: "group", "aria-label": label, style: { display: "flex", flexWrap: "wrap", gap: 6 } },
    options.map(([id, text]) => h("button", { key: id, type: "button", "aria-pressed": value === id, onClick: () => onChange(id),
      style: { height: 32, padding: "0 12px", borderRadius: 999, font: "inherit", fontSize: 14, cursor: "pointer", border: `1px solid ${value === id ? T.primary : T.border}`, background: value === id ? T.primary : T.panel, color: value === id ? T.onPrimary : T.text } }, text)));
}
function Segmented({ h, options, value, onChange, label }) {
  return h("div", { role: "group", "aria-label": label, style: { display: "inline-flex", padding: 3, borderRadius: 8, background: T.inset } },
    options.map(([id, text]) => h("button", { key: id, type: "button", "aria-pressed": value === id, onClick: () => onChange(id),
      style: { height: 30, padding: "0 12px", borderRadius: 6, border: 0, font: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer", background: value === id ? "var(--surface-control-selected)" : "transparent", color: value === id ? "var(--text-control-selected)" : T.subtle, boxShadow: value === id ? "0 1px 2px rgba(0,0,0,.12)" : "none" } }, text)));
}
function Avatar({ h, name }) {
  const initials = String(name || "?").split(/\s+/).map((x) => x[0]).join("").slice(0, 2).toUpperCase();
  return h("span", { "aria-hidden": true, style: { width: 34, height: 34, flex: "0 0 34px", borderRadius: "50%", background: "#EFE6D2", border: `2px solid ${INK}`, color: INK, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 } }, initials);
}
function Field({ h, value, onChange, placeholder, label, style }) {
  return h("input", { value, placeholder, "aria-label": label, onChange: (e) => onChange(e.target.value),
    style: { height: 38, padding: "0 12px", borderRadius: 8, border: `1px solid ${T.prominent}`, background: T.panel, color: T.text, font: "inherit", fontSize: 14, ...style } });
}
function MoreMenu({ h, React, ui, items, label }) {
  if (ui?.Menu) return h(ui.Menu, { "aria-label": label, align: "end", items: items.map((i) => ({ label: i.label, onSelect: i.onSelect, tone: i.danger ? "destructive" : undefined })) });
  const [open, setOpen] = React.useState(false);
  return h("span", { style: { position: "relative" } },
    h("button", { type: "button", "aria-label": label, "aria-expanded": open, onClick: () => setOpen(!open), style: { width: 32, height: 32, borderRadius: 6, border: 0, background: "transparent", color: T.subtle, fontSize: 20, cursor: "pointer" } }, "⋯"),
    open && h("div", { role: "menu", style: { position: "absolute", right: 0, top: 36, zIndex: 5, minWidth: 210, padding: 6, borderRadius: 10, background: "var(--surface-popover)", border: `1px solid ${T.border}`, boxShadow: "0 12px 32px rgba(0,0,0,.14)" } },
      items.map((i) => h("button", { key: i.label, type: "button", role: "menuitem", onClick: () => { setOpen(false); i.onSelect(); },
        style: { display: "block", width: "100%", textAlign: "left", padding: "8px 10px", border: 0, borderRadius: 6, background: "transparent", font: "inherit", fontSize: 14, cursor: "pointer", color: i.danger ? T.danger : T.text } }, i.label))));
}

