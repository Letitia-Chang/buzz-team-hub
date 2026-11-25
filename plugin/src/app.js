// ---------- Team Hub plugin ----------
// Sign in with Buzz (a one-time code by DM, filled in automatically), then the
// team's Home, Members, Roles, Plugins, Data & servers, Requests and Audit log.
// Every page asks the server, which checks your role on every request; the
// page only hides what you can't do so it doesn't tease you with it.

export const inject = DEMO ? ["react", "pages", "relay"] : ["react", "pages", "relay", "host"];

const STORE = DEMO ? "northstar.team-hub-demo.session" : "northstar.team-hub.session:v1";
const SHARE_KEY = "northstar.team-hub.share-stats";
const CODE_IN_DM = /sign-in code is (\d{3})-(\d{3})/;
// Agent Access 4.1+ stores its state under the new name; older versions used the first.
const AGENT_ACCESS_STATE = "letitia.agent-access:state";
const AGENT_ACCESS_STATE_OLD = "letitia.teammate-access:state";
const PAGES = [
  ["home", "house", "Home", "dash"], ["members", "users", "Members", null], ["roles", "shield", "Roles & permissions", null],
  ["plugins", "puzzle", "Plugins", null], ["data", "server", "Data & servers", null], ["requests", "inbox", "Requests", "approve"], ["audit", "scroll-text", "Audit log", "audit"],
];
const ROLE_COLORS = { Owner: ["var(--affordance-prominent)", "var(--text-inverse)"], Admin: [SKY, ON_SKY], Member: ["var(--surface-inset)", "var(--text-standard)"], Guest: ["#EBE0C6", "#6E5424"], Ended: ["var(--surface-inset)", "var(--text-subtle)"] };

// Audit entries name a Lucide icon; entries saved by Team Hub 1.0 used emoji.
const OLD_AUDIT_ICONS = { "🔑": "key-round", "🚪": "log-out", "🛡️": "shield", "🧩": "puzzle", "✅": "circle-check", "✋": "hand", "🗂️": "server", "👋": "hand" };
function AuditIcon({ h, icon }) {
  const name = ICONS[icon] ? icon : OLD_AUDIT_ICONS[icon] || "circle-check";
  return h(Icon, { h, name, style: { color: T.subtle, marginTop: 2 } });
}

function RoleChip({ h, role, children }) {
  const [bg, fg] = ROLE_COLORS[role] || ROLE_COLORS.Member;
  return h("span", { style: { display: "inline-flex", alignItems: "center", gap: 4, height: 24, padding: "0 9px", borderRadius: 6, background: bg, color: fg, fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" } }, children || role);
}

export function apply(ctx) {
  const React = ctx.react;
  const h = React.createElement;
  const usedCodes = new Set();

  async function call(path, { method = "GET", body, token } = {}) {
    if (DEMO) return DEMO_BACKEND.call(path, { method, body });
    const headers = { Accept: "application/json" };
    if (body) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await ctx.host.request({ url: SERVER + path, method, headers, body: body ? JSON.stringify(body) : undefined, timeoutMs: 20_000 });
    let data = {};
    try { data = JSON.parse(res.body || "{}"); } catch {}
    return { status: res.status, data };
  }
  const sessions = {
    load(viewer) { try { const s = JSON.parse(localStorage.getItem(STORE) || "{}")[viewer]; return s && s.expiresAt > Date.now() ? s : undefined; } catch { return undefined; } },
    save(viewer, s) { try { const all = JSON.parse(localStorage.getItem(STORE) || "{}"); if (s) all[viewer] = s; else delete all[viewer]; localStorage.setItem(STORE, JSON.stringify(all)); } catch {} },
  };
  const nameFrom = (session, pubkey) => {
    try { const p = session?.profiles?.snapshot?.()?.get?.(pubkey); return p?.displayName || p?.display_name || p?.name; } catch { return undefined; }
  };

  /** Opt-in: this person's Agent Access answer counts, by agent and day. Never questions. */
  function agentAccessCounts() {
    try {
      const state = JSON.parse(localStorage.getItem(AGENT_ACCESS_STATE) || localStorage.getItem(AGENT_ACCESS_STATE_OLD) || "null");
      if (!state?.activity) return [];
      const byAgent = new Map();
      for (const a of state.activity) {
        if (a.result !== "ok") continue;
        const name = ctx.agents?.find?.(a.agent)?.name || "Agent";
        const day = new Date(a.at).toISOString().slice(0, 10);
        const entry = byAgent.get(name) || {};
        entry[day] = (entry[day] || 0) + 1;
        byAgent.set(name, entry);
      }
      return [...byAgent].map(([name, answered]) => ({ name, answered }));
    } catch { return []; }
  }

  function TeamHub() {
    const connection = React.useSyncExternalStore((l) => ctx.relay.subscribe(l), () => ctx.relay.snapshot());
    const viewer = connection.status === "ready" ? connection.viewer : undefined;
    const session = connection.status === "ready" ? connection.session : undefined;
    const [phase, setPhase] = React.useState("checking");
    const [token, setToken] = React.useState();
    const [me, setMe] = React.useState();
    const [page, setPage] = React.useState("home");
    const [toast, setToast] = React.useState("");
    const [error, setError] = React.useState("");
    const flash = (t) => { setToast(t); clearTimeout(flash.t); flash.t = setTimeout(() => setToast(""), 2600); };

    React.useEffect(() => {
      if (!viewer) return;
      const saved = sessions.load(viewer);
      if (saved) { setToken(saved.token); setPhase("signedIn"); } else setPhase("signedOut");
    }, [viewer]);

    const api = React.useCallback(async (path, opts = {}) => {
      const r = await call(path, { ...opts, token });
      if (r.status === 401) { sessions.save(viewer, undefined); setToken(undefined); setMe(undefined); setPhase("signedOut"); setError("Your sign-in ended, or you no longer have access. Sign in again."); }
      return r;
    }, [token, viewer]);

    React.useEffect(() => {
      if (phase !== "signedIn" || !token) return;
      let live = true;
      api("/api/me").then(({ status, data }) => { if (live && status === 200) setMe(data); }, (e) => live && setError(`Can't reach Team Hub's server: ${e.message}`));
      const myName = nameFrom(session, viewer);
      if (myName && !DEMO) void api("/api/me", { method: "POST", body: { name: myName } }).catch(() => {});
      return () => { live = false; };
    }, [phase, token]);

    // Opt-in stats from Agent Access, once a day.
    React.useEffect(() => {
      if (!me || localStorage.getItem(SHARE_KEY) !== "on") return;
      const agents = agentAccessCounts();
      if (agents.length) void api("/api/stats", { method: "POST", body: { agents } }).catch(() => {});
    }, [me]);

    const signOut = async () => { if (token) await call("/auth/logout", { method: "POST", token }).catch(() => {}); sessions.save(viewer, undefined); setToken(undefined); setMe(undefined); setPhase("signedOut"); };
    const env = { h, React, ctx, api, me, viewer, session, flash, setPage, nameOf: (pk, fallback) => (DEMO && DEMO_BACKEND.nameFor(pk)) || nameFrom(session, pk) || fallback || pk.slice(0, 8) + "…" };

    if (!viewer) return h(Page, { h }, h(Sub, { h }, "Connecting to your community…"));
    if (phase !== "signedIn") return h(SignIn, { ...env, phase, setPhase, setToken, error, setError });
    if (!me) return h(Page, { h }, h(Sub, { h }, error || "Loading Team Hub…"));

    const allowedPages = PAGES.filter(([, , , need]) => !need || me.permissions[need]);
    const current = allowedPages.some(([id]) => id === page) ? page : allowedPages[0][0];
    return h(Page, { h },
      h("header", { style: { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 } },
        h("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
          h("span", { "aria-hidden": true, style: { width: 30, height: 30, borderRadius: 8, background: T.inset, display: "inline-flex", alignItems: "center", justifyContent: "center", color: T.text } }, h(Icon, { h, name: "compass", size: 18 })),
          h("div", null, h("h1", { style: { margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em" } }, "Team Hub"), h("span", { style: { fontSize: 12, color: T.meta } }, TEAM_NAME))),
        h("div", { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } },
          h(Avatar, { h, name: env.nameOf(me.pubkey, me.name) }), h("span", { style: { fontSize: 14, fontWeight: 600 } }, env.nameOf(me.pubkey, me.name)), h(RoleChip, { h, role: me.role }),
          h(Btn, { h, onClick: signOut }, "Sign out"))),
      h("nav", { "aria-label": "Team Hub sections", style: { display: "flex", gap: 2, overflowX: "auto", borderBottom: `1px solid ${T.border}` } },
        allowedPages.map(([id, icon, label]) => h("button", { key: id, type: "button", "aria-current": current === id ? "page" : undefined, onClick: () => setPage(id),
          style: { display: "inline-flex", alignItems: "center", gap: 6, height: 42, padding: "0 12px", border: 0, background: "transparent", font: "inherit", fontSize: 14, whiteSpace: "nowrap", cursor: "pointer", color: current === id ? T.text : T.subtle, fontWeight: current === id ? 700 : 500, boxShadow: current === id ? `inset 0 -2px 0 ${T.focus}` : "none" } },
          h(Icon, { h, name: icon }), label))),
      current === "home" && h(Home, env),
      current === "members" && h(Members, env),
      current === "roles" && h(Roles, env),
      current === "plugins" && h(Plugins, env),
      current === "data" && h(Data, env),
      current === "requests" && h(Requests, env),
      current === "audit" && h(Audit, env),
      toast && h("div", { role: "status", style: { position: "sticky", bottom: 16, alignSelf: "center", padding: "10px 16px", borderRadius: 10, background: T.primary, color: T.onPrimary, fontWeight: 600, fontSize: 14 } }, toast));
  }

  // ----- sign in -----
  function SignIn({ h, viewer, session, phase, setPhase, setToken, error, setError }) {
    const [code, setCode] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const sentAt = React.useRef(0);
    const verify = React.useCallback(async (digits) => {
      setBusy(true); setError("");
      try {
        const { status, data } = await call("/auth/verify", { method: "POST", body: { pubkey: viewer, code: digits } });
        if (status === 200) { sessions.save(viewer, { token: data.token, expiresAt: data.expiresAt }); setToken(data.token); setPhase("signedIn"); }
        else setError(data.error || `Sign-in failed (${status}).`);
      } catch (e) { setError(`Can't reach the server: ${e.message}`); } finally { setBusy(false); }
    }, [viewer]);
    // Demo: the "DM" arrives after a moment, and the page fills the code in as it would for real.
    React.useEffect(() => {
      if (!DEMO || phase !== "codeSent") return;
      const t = setTimeout(() => { const c = DEMO_BACKEND.lastCode; setCode(c); void verify(c); }, 1600);
      return () => clearTimeout(t);
    }, [phase, verify]);
    React.useEffect(() => {
      if (DEMO || phase !== "codeSent" || !session?.observe) return;
      const since = Math.floor(sentAt.current / 1000) - 5;
      const view = session.observe([{ kinds: [9], authors: [BOT_PUBKEY], since, limit: 5 }]);
      let done = false;
      const scan = () => {
        if (done) return;
        for (const event of view.snapshot().events) {
          const m = event.created_at >= since && CODE_IN_DM.exec(event.content || "");
          if (m && !usedCodes.has(m[1] + m[2])) { done = true; usedCodes.add(m[1] + m[2]); setCode(m[1] + m[2]); void verify(m[1] + m[2]); return; }
        }
      };
      const stop = view.subscribe(scan); scan(); void view.refresh?.();
      const timer = setInterval(() => void view.refresh?.(), 4000);
      return () => { clearInterval(timer); stop(); view.dispose?.(); };
    }, [phase, session, verify]);
    const requestCode = async () => {
      setBusy(true); setError("");
      try {
        sentAt.current = Date.now();
        const { status, data } = await call("/auth/login", { method: "POST", body: { pubkey: viewer } });
        if (status === 200) setPhase("codeSent"); else setError(data.error || `The server answered ${status}.`);
      } catch (e) { setError(`Can't reach the server: ${e.message}`); } finally { setBusy(false); }
    };
    const digits = code.replace(/\D/g, "");
    return h(Page, { h },
      h("section", { style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "32px 56px", padding: "24px 0" } },
        h("div", { style: { flex: "1 1 340px", maxWidth: 440, display: "flex", flexDirection: "column", gap: 16 } },
          h("span", { style: { display: "inline-flex", alignItems: "center", gap: 10, fontWeight: 700 } }, h(Icon, { h, name: "compass", size: 18 }), "Team Hub · ", TEAM_NAME),
          h("p", { style: { margin: 0, fontSize: 38, lineHeight: 1.08, fontWeight: 800, letterSpacing: "-0.035em" } }, "Sign in with ", h("span", { style: { background: `linear-gradient(transparent 70%, ${YELLOW} 70%, ${YELLOW} 95%, transparent 95%)` } }, "Buzz"), "."),
          h(Sub, { h, style: { fontSize: 16 } }, "No passwords. We send a one-time code to your Buzz DMs, and this page fills it in for you."),
          h(Card, { h, style: { padding: 20, display: "flex", flexDirection: "column", gap: 12 } },
            phase === "codeSent"
              ? h(React.Fragment, null,
                  h("p", { style: { margin: 0, fontSize: 15, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } }, h(Icon, { h, name: "mail" }), h("span", null, "Check your Buzz DMs from ", h("strong", null, "Project Board bot"), ".")),
                  h("div", { "aria-label": "One-time code", style: { display: "flex", gap: 8 } }, [0, 1, 2, 3, 4, 5].map((i) => h("span", { key: i, style: { width: 42, height: 50, borderRadius: 8, border: `1.5px solid ${digits[i] ? INK : T.prominent}`, background: digits[i] ? T.subtleBg : T.panel, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 800 } }, digits[i] || ""))),
                  h("input", { inputMode: "numeric", autoComplete: "one-time-code", maxLength: 7, value: code, onChange: (e) => setCode(e.target.value), "aria-label": "Or type the code", placeholder: "Or type the code", style: { height: 38, padding: "0 12px", borderRadius: 8, border: `1px solid ${T.prominent}`, background: T.panel, color: T.text, font: "inherit", letterSpacing: "0.2em", maxWidth: 200 } }),
                  h("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
                    h(Btn, { h, kind: "primary", disabled: busy || digits.length !== 6, onClick: () => verify(digits) }, busy ? "Checking…" : "Continue"),
                    h(Btn, { h, disabled: busy, onClick: requestCode }, "Send a new code")),
                  h(Sub, { h, style: { fontSize: 13 } }, "Codes work once, for 10 minutes, with 5 tries. No DM after a minute? You may not be in the access channel yet."))
              : h(React.Fragment, null,
                  h(Sub, { h }, "You're signed in to Buzz here, so we know who you are. We just need to check it's really you."),
                  h(Btn, { h, kind: "sky", disabled: busy || phase === "checking", onClick: requestCode, style: { minHeight: 42 } }, busy ? "Sending…" : "Send me a code")),
            error && h("p", { role: "alert", style: { margin: 0, color: T.danger, fontSize: 14 } }, error)),
          h(Callout, { h, icon: "lock" }, "Only people in the team's private access channel can sign in. Team Hub never sees your Buzz key, and the team's data stays on the office server.")),
        h(Paper, { h, art: "p_paper", alt: "Someone reading a note", style: { flex: "0 1 280px", maxWidth: 300, aspectRatio: "0.8", border: 0 } })));
  }

  // ----- pages -----
  function useApi(api, path, deps = []) {
    const [state, setState] = React.useState({ loading: true });
    const load = React.useCallback(() => api(path).then(({ status, data }) => setState(status === 200 ? { data } : { error: data.error || `Error ${status}` }), (e) => setState({ error: e.message })), [api, path]);
    React.useEffect(() => { void load(); }, [load, ...deps]);
    return [state, load];
  }
  const Loading = ({ h, state }) => h(Sub, { h }, state.error ? `Couldn't load this: ${state.error}` : "Loading…");
  const Title = ({ h, kicker, title, sub, action }) => h("div", { style: { display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: 12 } },
    h("div", { style: { display: "flex", flexDirection: "column", gap: 6 } }, h(Kicker, { h }, kicker), h("p", { style: { margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em" } }, title), sub ? h(Sub, { h, style: { fontSize: 15 } }, sub) : null), action || null);

  function Home({ h, api, me, setPage, flash }) {
    const [period, setPeriod] = React.useState("week");
    const [state] = useApi(api, `/api/dashboard?period=${period}`, [period]);
    const [share, setShare] = React.useState(() => localStorage.getItem(SHARE_KEY) === "on");
    const toggleShare = async (on) => {
      setShare(on);
      try { localStorage.setItem(SHARE_KEY, on ? "on" : "off"); } catch {}
      if (on) { const agents = agentAccessCounts(); await api("/api/stats", { method: "POST", body: { agents } }); flash(agents.length ? "Your Agent Access counts are shared" : "Nothing to share yet"); }
      else { await api("/api/stats", { method: "DELETE" }); flash("Your counts were removed"); }
    };
    const d = state.data;
    const big = { fontSize: 38, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1, fontVariantNumeric: "tabular-nums" };
    const max = Math.max(1, ...(d?.topAgents || []).map((a) => a.answered));
    return h(React.Fragment, null,
      h("section", { style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "16px 32px" } },
        h("div", { style: { flex: "1 1 320px", display: "flex", flexDirection: "column", gap: 10 } },
          h(Kicker, { h }, "Home"),
          h("p", { style: { margin: 0, fontSize: 34, lineHeight: 1.1, fontWeight: 800, letterSpacing: "-0.03em" } }, "How the ", h("span", { style: { background: `linear-gradient(transparent 70%, ${YELLOW} 70%, ${YELLOW} 95%, transparent 95%)` } }, "team"), " is doing"),
          h(Sub, { h, style: { fontSize: 15 } }, "Shared agents, plugins and the Project Board, in one place.")),
        h(Paper, { h, art: "ChillingDoodle", style: { flex: "0 1 260px", maxWidth: 260, aspectRatio: "4 / 3", border: 0 } })),
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 } }, h(H2, { h }, "Community"), h(Segmented, { h, label: "Period", value: period, onChange: setPeriod, options: [["today", "Today"], ["week", "This week"]] })),
      !d ? h(Loading, { h, state }) : h(React.Fragment, null,
        h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 } },
          [["Members", d.members, d.newMembers ? `+${d.newMembers} this ${period === "week" ? "week" : "day"}` : "No one new"],
           ["Agents shared in the team", d.agentsShared, d.sharers ? `By ${plural(d.sharers, "person", "people")}` : "Nobody shares counts yet"],
           ["Questions answered", d.answered, "From shared Agent Access counts"],
           ["Plugins in use", d.pluginsInUse, d.updatesReady ? plural(d.updatesReady, "update") + " ready" : "All up to date"]].map(([label, value, note], i) =>
            h(Card, { h, key: label, style: { padding: 18, display: "flex", flexDirection: "column", gap: 8 } }, h("span", { style: { fontSize: 14, color: T.subtle } }, label),
              h("span", { style: i === 2 ? { ...big, alignSelf: "flex-start", background: `linear-gradient(transparent 70%, ${SAGE} 70%, ${SAGE} 95%, transparent 95%)` } : big }, value), h("span", { style: { fontSize: 13, color: T.subtle } }, note)))),
        h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 } },
          h(Card, { h, style: { padding: 18, display: "flex", flexDirection: "column", gap: 12 } },
            h(H2, { h }, "Most asked agents"),
            d.topAgents.length ? d.topAgents.map((a) => h("div", { key: a.name + a.owner, style: { display: "flex", flexDirection: "column", gap: 4 } },
              h("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 14 } }, h("span", null, h("strong", null, a.name), h("span", { style: { color: T.subtle } }, ` · ${a.owner}`)), h("strong", { style: { fontVariantNumeric: "tabular-nums" } }, a.answered)),
              h("div", { style: { height: 8, borderRadius: 999, background: T.inset, overflow: "hidden" } }, h("div", { style: { height: "100%", width: `${Math.round(a.answered / max * 100)}%`, background: a.answered === max ? T.primary : T.prominent, borderRadius: 999 } }))))
              : h(Sub, { h }, "No counts yet."),
            h("div", { style: { display: "flex", alignItems: "center", gap: 12, paddingTop: 10, borderTop: `1px solid ${T.border}` } },
              h("div", { style: { flex: 1 } }, h("strong", { style: { fontSize: 14 } }, "Share my Agent Access counts"), h(Sub, { h, style: { fontSize: 13 } }, "Agent names and how many answers per day. Never who asked or what.")),
              h(Toggle, { h, ui: ctx.reflect?.get?.("ui"), on: share, onChange: toggleShare, label: "Share my Agent Access counts" }))),
          h(Card, { h, style: { padding: 18, display: "flex", flexDirection: "column", gap: 4 } },
            h(H2, { h }, "Lately"),
            d.lately.length ? d.lately.map((f, i) => h("div", { key: i, style: { display: "flex", gap: 10, padding: "8px 0", borderTop: i ? `1px solid ${T.border}` : 0, fontSize: 14 } }, h(AuditIcon, { h, icon: f.icon }), h("span", { style: { flex: 1 } }, f.text), h("span", { style: { color: T.meta, fontSize: 13, whiteSpace: "nowrap" } }, timeLabel(f.at))))
              : h(Sub, { h }, "Nothing yet."))),
        h(ServerLine, { h, api, onDetails: me.permissions.servers ? () => setPage("data") : undefined })));
  }

  function ServerLine({ h, api, onDetails }) {
    const [state] = useApi(api, "/api/health");
    const ok = state.data?.ok;
    return h(Card, { h, style: { padding: "14px 16px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 } },
      h("span", { style: { width: 10, height: 10, borderRadius: "50%", background: state.loading ? "var(--status-offline)" : ok ? T.online : RED } }),
      h("p", { style: { margin: 0, flex: "999 1 260px", fontSize: 14 } }, h("strong", null, state.loading ? "Checking the office server…" : ok ? "The office server is online" : "Can't reach the office server"), ok ? h("span", { style: { color: T.subtle } }, ` · up ${Math.round(state.data.uptimeSeconds / 3600)}h`) : null),
      onDetails ? h(Btn, { h, onClick: onDetails }, "Details") : null);
  }

  function Members({ h, api, me, flash, nameOf }) {
    const [state, reload] = useApi(api, "/api/members");
    const [invite, setInvite] = React.useState(false);
    const canManage = me.permissions.members;
    const setRole = async (m, role) => { const r = await api(`/api/members/${m.pubkey}`, { method: "POST", body: { role } }); flash(r.status === 200 ? `${nameOf(m.pubkey, m.name)} is now ${role === "Admin" ? "an" : "a"} ${role}` : r.data.error); void reload(); };
    const remove = async (m) => { const r = await api(`/api/members/${m.pubkey}/remove`, { method: "POST" }); flash(r.status === 200 ? `${nameOf(m.pubkey, m.name)} was signed out. Also remove them from the access channel in Buzz.` : r.data.error); void reload(); };
    const inviteText = `You're invited to ${TEAM_NAME}'s Team Hub. Install the Team Hub plugin in Buzz, open it, and press "Send me a code".`;
    return h(React.Fragment, null,
      h(Title, { h, kicker: "Members", title: "Who's on the team", action: canManage ? h(Btn, { h, kind: "primary", onClick: () => setInvite(!invite) }, "＋ Add someone") : undefined }),
      invite && h(Card, { h, style: { padding: 18, display: "flex", flexWrap: "wrap", alignItems: "center", gap: "16px 24px", borderColor: T.focus } },
        h(Paper, { h, art: "s_point", style: { width: 110, height: 110, border: 0 } }),
        h("div", { style: { flex: "999 1 300px", display: "flex", flexDirection: "column", gap: 8 } },
          h(H2, { h }, "Add them to the access channel in Buzz"),
          h(Sub, { h }, "That private channel is the guest list. Anyone in it can sign in as a Member. Take them out of it and they're signed out within 5 minutes."),
          h("div", null, h(Btn, { h, onClick: async () => { try { await (ctx.host?.writeClipboardText ? ctx.host.writeClipboardText(inviteText) : navigator.clipboard.writeText(inviteText)); flash("Invite message copied"); } catch { flash("Couldn't copy"); } } }, h(Icon, { h, name: "copy" }), "Copy an invite message")))),
      !state.data ? h(Loading, { h, state }) : h(Card, { h, style: { overflow: "hidden" } },
        state.data.members.map((m, i) => {
          const locked = !canManage || m.role === "Owner" || m.role === "Ended";
          const options = ["Admin", "Member", "Guest"].filter((r) => r !== m.role && (r !== "Admin" || me.role === "Owner"));
          return h("div", { key: m.pubkey, style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 16px", padding: "10px 14px", borderTop: i ? `1px solid ${T.border}` : 0 } },
            h("span", { style: { display: "flex", alignItems: "center", gap: 10, flex: "1 1 200px", minWidth: 0 } }, h(Avatar, { h, name: nameOf(m.pubkey, m.name) }), h("span", null, h("strong", { style: { display: "block" } }, nameOf(m.pubkey, m.name)), h("span", { style: { fontSize: 12, color: T.meta } }, m.inChannel ? "In the access channel" : "Not in the access channel"))),
            h("span", { style: { flex: "0 0 auto" } }, h(RoleChip, { h, role: m.role }, m.role + (m.until ? ` · until ${new Date(m.until).toLocaleDateString([], { month: "short", day: "numeric" })}` : ""))),
            h("span", { style: { flex: "1 1 110px", fontSize: 14, color: T.subtle } }, m.lastSeen ? `Seen ${timeLabel(m.lastSeen)}` : "Not seen yet"),
            locked ? h("span", { style: { width: 32 } }) : h(MoreMenu, { h, React, ui: ctx.reflect?.get?.("ui"), label: `Change ${nameOf(m.pubkey, m.name)}`, items: [
              ...options.map((r) => ({ label: `Make ${r === "Admin" ? "an" : "a"} ${r}${r === "Guest" ? " for 7 days" : ""}`, onSelect: () => setRole(m, r) })),
              { label: "Remove from Team Hub", danger: true, onSelect: () => remove(m) },
            ] }));
        })),
      h(Sub, { h }, "Membership is checked against the access channel every 5 minutes. Guests' access ends on the date shown."));
  }

  function Roles({ h, api, me, flash }) {
    const [state, reload] = useApi(api, "/api/permissions");
    const canEdit = me.permissions.members;
    const flip = async (perm, role, on) => { const r = await api("/api/permissions", { method: "PUT", body: { permission: perm, role, on } }); if (r.status !== 200) flash(r.data.error); void reload(); };
    return h(React.Fragment, null,
      h(Title, { h, kicker: "Roles & permissions", title: "Who can do what", sub: "Owners can always do everything, so nobody gets locked out." }),
      !state.data ? h(Loading, { h, state }) : h(Card, { h, style: { overflowX: "auto" } },
        h("div", { role: "table", "aria-label": "Permissions", style: { minWidth: 620 } },
          h("div", { role: "row", style: { display: "grid", gridTemplateColumns: "minmax(220px, 2fr) repeat(4, minmax(80px, 1fr))", padding: "10px 14px", fontSize: 13, color: T.subtle } },
            h("span", { role: "columnheader" }, "Permission"), state.data.roles.map((r) => h("span", { key: r, role: "columnheader", style: { textAlign: "center" } }, h(RoleChip, { h, role: r })))),
          state.data.permissions.map((p) => h("div", { key: p.id, role: "row", style: { display: "grid", gridTemplateColumns: "minmax(220px, 2fr) repeat(4, minmax(80px, 1fr))", alignItems: "center", padding: "10px 14px", borderTop: `1px solid ${T.border}` } },
            h("span", { role: "cell", style: { fontSize: 14, fontWeight: 600 } }, p.label),
            state.data.roles.map((r) => {
              const on = p.roles[r];
              const locked = !canEdit || r === "Owner" || (p.id === "servers" && me.role !== "Owner");
              return h("span", { key: r, role: "cell", style: { textAlign: "center" } },
                h("button", { type: "button", role: "checkbox", "aria-checked": on, "aria-label": `${p.label} for ${r}`, disabled: locked, onClick: () => flip(p.id, r, !on),
                  style: { width: 26, height: 26, borderRadius: 6, cursor: locked ? "default" : "pointer", border: `1.5px solid ${on ? INK : T.prominent}`, background: on ? (r === "Owner" ? T.inset : SKY) : T.panel, color: on && r !== "Owner" ? ON_SKY : INK, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" } }, on ? h(Icon, { h, name: "check", size: 14, strokeWidth: 2.25 }) : null));
            }))))));
  }

  function Plugins({ h, api, me, flash }) {
    const [state, reload] = useApi(api, "/api/plugins");
    const canManage = me.permissions.members;
    const act = async (id, action, done) => { const r = await api(`/api/plugins/${id}/${action}`, { method: "POST" }); flash(r.status === 200 ? done : r.data.error); void reload(); };
    const setLevel = async (id, level) => { const r = await api(`/api/plugins/${id}`, { method: "PUT", body: { level } }); if (r.status !== 200) flash(r.data.error); void reload(); };
    const copyTrust = async () => { const r = await api("/api/plugin-trust"); try { const text = JSON.stringify(r.data, null, 2); await (ctx.host?.writeClipboardText ? ctx.host.writeClipboardText(text) : navigator.clipboard.writeText(text)); flash("Trust file copied. Save it as plugin-trust.json and run `buzzodz plugin trust`."); } catch { flash("Couldn't copy"); } };
    const stateLabel = (p) => p.state === "review" ? ["Waiting for review", T.warn] : p.state === "rejected" ? ["Rejected", T.danger] : p.update ? [`Update ready: ${p.update.version}`, T.warn] : ["Approved · up to date", T.ok];
    return h(React.Fragment, null,
      h(Title, { h, kicker: "Plugins", title: "Team plugins", sub: "Approved here, installed from Buzz. Each plugin checks your role before it shows anything.", action: h(Btn, { h, onClick: copyTrust }, "Copy trust file") }),
      !state.data ? h(Loading, { h, state }) : h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 } },
        state.data.plugins.map((p) => {
          const [label, color] = stateLabel(p);
          return h(Card, { h, key: p.id, style: { padding: 18, display: "flex", flexDirection: "column", gap: 12 } },
            h("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
              h("div", { style: { flex: 1, minWidth: 0 } }, h(H2, { h }, p.name), h(Sub, { h, style: { fontSize: 13 } }, `v${p.version || "?"}${p.publisher ? " · by " + p.publisher : ""}`)),
              p.verified ? h(Chip, { h, bg: T.okBg, color: T.ok }, h(Icon, { h, name: "check", size: 13 }), "Verified") : h(Chip, { h, bg: T.warnBg, color: T.warn }, "Not verified")),
            p.description ? h(Sub, { h }, p.description) : null,
            h("div", { style: { display: "flex", flexDirection: "column", gap: 6 } }, h("span", { style: { fontSize: 13, fontWeight: 600 } }, "Who can use it after installing"),
              canManage ? h(Pills, { h, label: "Who can use it", value: p.level, onChange: (l) => setLevel(p.id, l), options: [["Everyone", "Everyone"], ["Members", "Members and up"], ["Admins", "Admins and up"]] })
                : h("span", { style: { fontSize: 14 } }, p.level === "Everyone" ? "Everyone" : `${p.level} and up`, p.state !== "approved" ? " · once it's approved" : p.canUse ? " · including you" : " · not you yet")),
            h("div", { style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, paddingTop: 10, borderTop: `1px solid ${T.border}` } },
              h("span", { style: { fontSize: 13, fontWeight: 600, color } }, label), h("span", { style: { flex: 1 } }),
              canManage && p.state === "review" ? h(Btn, { h, kind: "sky", onClick: () => act(p.id, "approve", `${p.name} approved`) }, "Approve") : null,
              canManage && p.state === "review" ? h(Btn, { h, onClick: () => act(p.id, "reject", `${p.name} rejected`) }, "Reject") : null,
              canManage && p.update ? h(Btn, { h, kind: "sky", onClick: () => act(p.id, "rollout", `${p.name} ${p.update.version} rolls out to the team`) }, `Roll out ${p.update.version}`) : null,
              !p.canUse && p.state === "approved" ? h(Btn, { h, onClick: async () => { const r = await api("/api/requests", { method: "POST", body: { kind: "plugin", target: p.id } }); flash(r.status === 201 ? "Asked an admin" : r.data.error); } }, "Ask for access") : null));
        })),
      h(Callout, { h, icon: "circle-check" }, h("strong", null, "Verified"), " means the release is signed by a publisher this team trusts. With the trust file, Buzz can refuse anything else."));
  }

  function Data({ h, api, me, flash }) {
    const [state, reload] = useApi(api, "/api/health");
    const d = state.data;
    const rows = [["Sign-in code lasts", "10 minutes"], ["Wrong tries before a pause", "5"], ["Stay signed in for", "14 days"], ["Check the access channel every", "5 minutes"]];
    return h(React.Fragment, null,
      h(Title, { h, kicker: "Data & servers", title: "Where the data lives" }),
      h(Card, { h, style: { padding: 18, display: "flex", flexDirection: "column", gap: 12 } },
        h("div", { style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 } }, h(Icon, { h, name: "server", size: 20 }), h(H2, { h }, "Office server"),
          h(Chip, { h, bg: d?.ok ? T.okBg : T.dangerBg, color: d?.ok ? T.ok : T.danger }, state.loading ? "Checking…" : d?.ok ? "Online" : "Unreachable")),
        h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 } },
          [["Address", SERVER.replace("https://", "")], ["Reached through", "Cloudflare Tunnel → office machine"], ["Up for", d ? `${Math.floor(d.uptimeSeconds / 3600)}h ${Math.floor((d.uptimeSeconds % 3600) / 60)}m` : "…"], ["Version", d?.version || "…"]].map(([k, v]) =>
            h("div", { key: k, style: { padding: 12, borderRadius: 8, background: T.inset } }, h(Kicker, { h }, k), h("p", { style: { margin: "4px 0 0", fontSize: 14, fontWeight: 600, wordBreak: "break-all" } }, v)))),
        h("div", null, h(Btn, { h, onClick: async () => { const t0 = Date.now(); await reload(); flash(`Reached the office server in ${Date.now() - t0} ms`); } }, "Test connection"))),
      h(Card, { h, style: { padding: 18, display: "flex", flexDirection: "column", gap: 8 } },
        h("div", { style: { display: "flex", alignItems: "center", gap: 10 } }, h(Icon, { h, name: "bot", size: 20 }), h(H2, { h }, "Project Board bot")),
        h(Sub, { h }, "A separate Buzz account, so nobody's personal key sits on the server. It does two things: sends sign-in codes by DM, and reads who's in the access channel.")),
      h(Card, { h, style: { padding: 18, display: "flex", flexDirection: "column", gap: 4 } },
        h(H2, { h }, "Sign-in & sessions"),
        rows.map(([k, v]) => h("div", { key: k, style: { display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderTop: `1px solid ${T.border}`, fontSize: 14 } }, h("span", null, k), h("strong", null, v))),
        me.permissions.servers ? h("div", { style: { paddingTop: 10 } }, h(Btn, { h, kind: "danger", onClick: async () => { const r = await api("/api/sessions/revoke-all", { method: "POST" }); if (r.status === 200) flash("Everyone, including you, was signed out"); } }, "Sign everyone out")) : null));
  }

  function Requests({ h, api, flash, nameOf }) {
    const [state, reload] = useApi(api, "/api/requests");
    const act = async (r, action) => { const res = await api(`/api/requests/${r.id}/${action}`, { method: "POST" }); flash(res.status === 200 ? (res.data.note || (action === "approve" ? "Approved" : "Dismissed")) : res.data.error); void reload(); };
    const what = (r) => r.kind === "role" ? `wants to be a ${r.target}` : r.kind === "plugin" ? `wants to use ${r.targetName || r.target}` : "asked to join Team Hub";
    return h(React.Fragment, null,
      h(Title, { h, kicker: "Requests", title: "Waiting for a yes" }),
      !state.data ? h(Loading, { h, state }) : state.data.requests.length
        ? state.data.requests.map((r) => h(Card, { h, key: r.id, style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 14px", padding: "12px 14px" } },
            h(Avatar, { h, name: nameOf(r.from, r.name) }),
            h("div", { style: { flex: "999 1 260px" } }, h("p", { style: { margin: 0, fontSize: 15 } }, h("strong", null, nameOf(r.from, r.name)), ` ${what(r)}`), h(Sub, { h, style: { fontSize: 13 } }, `${r.note ? "“" + r.note + "” · " : ""}${timeLabel(r.at)}`)),
            h(Btn, { h, kind: "sky", onClick: () => act(r, "approve") }, "Approve"), h(Btn, { h, onClick: () => act(r, "dismiss") }, "Not now")))
        : h("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: 24, textAlign: "center" } }, h(Paper, { h, art: "LayingDoodle", style: { width: 220, height: 140, border: 0 } }), h("p", { style: { margin: 0, fontSize: 17, fontWeight: 700 } }, "All caught up"), h(Sub, { h }, "New requests show up here.")));
  }

  function Audit({ h, api }) {
    const [state] = useApi(api, "/api/audit");
    return h(React.Fragment, null,
      h(Title, { h, kicker: "Audit log", title: "Every change, in order", sub: "Kept for 90 days on the office server: sign-ins, roles, plugins and settings. Nothing from your Buzz messages." }),
      !state.data ? h(Loading, { h, state }) : h(Card, { h, style: { overflow: "hidden" } },
        state.data.entries.length ? state.data.entries.map((a, i) => h("div", { key: i, style: { display: "flex", flexWrap: "wrap", gap: "4px 16px", padding: "10px 14px", borderTop: i ? `1px solid ${T.border}` : 0, fontSize: 14 } },
          h("span", { style: { flex: "0 0 90px", color: T.subtle, fontVariantNumeric: "tabular-nums" } }, timeLabel(a.at)), h("strong", { style: { flex: "0 0 160px" } }, a.name), h("span", { style: { flex: "1 1 260px", display: "inline-flex", alignItems: "center", gap: 8 } }, h(AuditIcon, { h, icon: a.icon }), a.what)))
          : h("div", { style: { padding: 18 } }, h(Sub, { h }, "Nothing yet."))));
  }

  /** Demo only: a banner to preview each role, and a reset. */
  function DemoShell() {
    const [role, setRole] = React.useState(DEMO_BACKEND.persona);
    const [run, setRun] = React.useState(0);
    const pick = (r) => { DEMO_BACKEND.setPersona(r); setRole(r); };
    const reset = () => { DEMO_BACKEND.reset(); try { localStorage.removeItem(STORE); } catch {} setRole("Owner"); setRun(run + 1); };
    return h("div", { style: { height: "100%", display: "flex", flexDirection: "column" } },
      h("div", { role: "region", "aria-label": "Demo controls", style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px", padding: "10px clamp(16px, 4vw, 48px)", background: T.inset, borderBottom: `1px solid ${T.border}`, fontSize: 13 } },
        h(Icon, { h, name: "info", style: { color: T.subtle } }),
        h("span", { style: { color: T.subtle, flex: "1 1 260px" } }, h("strong", { style: { color: T.text } }, "Demo. "), "Sample people and data, all in Buzz. Nothing is saved or sent."),
        h("span", { style: { display: "inline-flex", alignItems: "center", gap: 6 } }, h(Icon, { h, name: "eye", style: { color: T.subtle } }), "Preview as"),
        h("div", { role: "group", "aria-label": "Preview as", style: { display: "inline-flex", gap: 4 } },
          ["Owner", "Admin", "Member", "Guest"].map((r) => h("button", { key: r, type: "button", "aria-pressed": role === r, onClick: () => pick(r),
            style: { height: 28, padding: "0 10px", borderRadius: 999, border: `1px solid ${role === r ? T.primary : T.border}`, background: role === r ? T.primary : T.panel, color: role === r ? T.onPrimary : T.text, font: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" } }, r))),
        h(Btn, { h, onClick: reset }, h(Icon, { h, name: "rotate-ccw" }), "Reset demo")),
      h("div", { style: { flex: 1, minHeight: 0 } }, h(TeamHub, { key: role + ":" + run })));
  }

  ctx.pages.register({ id: "main", title: DEMO ? "Team Hub demo" : "Team Hub", primary: true, placement: "dock", layout: "workspace", icon: iconDataUrl("compass"), component: DEMO ? DemoShell : TeamHub });
}
