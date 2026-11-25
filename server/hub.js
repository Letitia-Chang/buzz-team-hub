// Team Hub: roles, permissions, plugins, requests, audit log and the team
// dashboard, on top of "Sign in with Buzz" (auth.js).
//
// Who can sign in is still decided in Buzz: membership of the private access
// channel. Team Hub adds what each person can do once they're in.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { readJson, sendJson } from "./auth.js";

export const ROLES = ["Owner", "Admin", "Member", "Guest"];
export const PERMISSIONS = {
  view: { label: "See the Project Board", Owner: true, Admin: true, Member: true, Guest: true },
  edit: { label: "Edit the Project Board", Owner: true, Admin: true, Member: true, Guest: false },
  dash: { label: "See the team dashboard", Owner: true, Admin: true, Member: true, Guest: false },
  install: { label: "Use approved plugins", Owner: true, Admin: true, Member: true, Guest: false },
  approve: { label: "Answer requests", Owner: true, Admin: true, Member: false, Guest: false },
  members: { label: "Manage members, roles and plugins", Owner: true, Admin: true, Member: false, Guest: false },
  servers: { label: "Sign everyone out", Owner: true, Admin: false, Member: false, Guest: false },
  audit: { label: "See the audit log", Owner: true, Admin: true, Member: false, Guest: false },
};
const LEVELS = ["Everyone", "Members", "Admins"];
const HEX64 = /^[0-9a-f]{64}$/;
const DAY = 86_400_000;
const AUDIT_DAYS = 90;
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const emptyData = () => ({ people: {}, permissions: {}, plugins: {}, trustedPublishers: [], requests: [], audit: [], stats: {} });

export async function createHubStore(file = process.env.HUB_STORE || "./data/hub.json") {
  let data = emptyData();
  try {
    data = { ...data, ...JSON.parse(await readFile(file, "utf8")) };
  } catch {
    /* first run */
  }
  let writing = Promise.resolve();
  return {
    get: () => data,
    async update(fn) {
      fn(data);
      writing = writing.then(async () => {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(`${file}.tmp`, JSON.stringify(data), { mode: 0o600 });
        await rename(`${file}.tmp`, file);
      });
      await writing;
    },
  };
}

export function createHub({ auth, sessions, store, ownerPubkeys = [], version = "1.0.0", now = () => Date.now(), startedAt = Date.now() }) {
  const owners = new Set(ownerPubkeys.map((k) => k.toLowerCase()));
  const d = () => store.get();

  const roleOf = (pubkey) => {
    if (owners.has(pubkey)) return "Owner";
    const p = d().people[pubkey];
    if (p?.role === "Guest" && p.until && p.until < now()) return undefined; // guest time is over
    return ROLES.includes(p?.role) && p.role !== "Owner" ? p.role : "Member";
  };
  const allowed = (role, perm) => {
    if (role === "Owner") return true;
    const saved = d().permissions[perm];
    return Boolean(saved && role in saved ? saved[role] : PERMISSIONS[perm]?.[role]);
  };
  const can = (pubkey, perm) => {
    const role = roleOf(pubkey);
    return Boolean(role) && allowed(role, perm);
  };
  const permsFor = (pubkey) => Object.fromEntries(Object.keys(PERMISSIONS).map((k) => [k, can(pubkey, k)]));
  const audit = (who, icon, what) =>
    store.update((x) => {
      x.audit = [{ at: now(), who, icon, what }, ...x.audit.filter((a) => now() - a.at < AUDIT_DAYS * DAY)].slice(0, 2000);
    });
  const nameOf = (pubkey) => d().people[pubkey]?.name || `${pubkey.slice(0, 8)}…`;
  const isBlocked = async (pubkey) => Boolean(d().people[pubkey]?.blocked) || (roleOf(pubkey) === undefined && !owners.has(pubkey));
  const onSignIn = (pubkey) => audit(pubkey, "key-round", "Signed in with a Buzz code");

  const pluginView = (id, p) => ({
    id, ...p,
    verified: Boolean(p.signedBy && d().trustedPublishers.includes(p.signedBy)),
    level: LEVELS.includes(p.level) ? p.level : "Members",
  });
  const levelAllows = (level, role) =>
    level === "Everyone" ? true : level === "Members" ? ["Owner", "Admin", "Member"].includes(role) : ["Owner", "Admin"].includes(role);

  // ---- route table: [method, pattern, permission or null, handler] ----
  const routes = [
    ["GET", /^\/api\/me$/, null, async (who) => [200, { pubkey: who.pubkey, name: nameOf(who.pubkey), role: roleOf(who.pubkey), permissions: permsFor(who.pubkey), version }]],

    ["POST", /^\/api\/me$/, null, async (who, body) => {
      const name = String(body?.name || "").trim();
      if (name) await store.update((x) => { x.people[who.pubkey] = { ...(x.people[who.pubkey] || {}), name: name.slice(0, 60) }; });
      return [200, { ok: true }];
    }],

    ["GET", /^\/api\/dashboard$/, "dash", async (who, _b, _m, url) => {
      const days = url.searchParams.get("period") === "today" ? 1 : 7;
      const since = now() - days * DAY;
      const { pubkeys } = await auth.memberList();
      const agents = [];
      for (const [owner, report] of Object.entries(d().stats)) {
        for (const a of report.agents || []) {
          const answered = Object.entries(a.answered || {}).filter(([day]) => Date.parse(day) >= since - DAY).reduce((n, [, c]) => n + c, 0);
          agents.push({ name: a.name, owner: nameOf(owner), answered });
        }
      }
      agents.sort((a, b) => b.answered - a.answered);
      const plugins = Object.entries(d().plugins).map(([id, p]) => pluginView(id, p));
      return [200, {
        members: pubkeys.length,
        newMembers: Object.values(d().people).filter((p) => p.firstSeen && p.firstSeen > since).length,
        agentsShared: agents.length,
        sharers: new Set(Object.keys(d().stats)).size,
        answered: agents.reduce((n, a) => n + a.answered, 0),
        pluginsInUse: plugins.filter((p) => p.state === "approved").length,
        updatesReady: plugins.filter((p) => p.update).length,
        topAgents: agents.slice(0, 5),
        lately: d().audit.filter((a) => !/Signed in|wrong codes/.test(a.what)).slice(0, 6).map((a) => ({ at: a.at, icon: a.icon, text: a.who === "system" ? a.what : `${nameOf(a.who)} ${a.what.charAt(0).toLowerCase()}${a.what.slice(1)}` })),
      }];
    }],

    ["GET", /^\/api\/members$/, null, async () => {
      const { pubkeys, checkedAt } = await auth.memberList();
      const list = [...new Set([...pubkeys, ...owners])].map((pk) => {
        const p = d().people[pk] || {};
        return { pubkey: pk, name: nameOf(pk), role: roleOf(pk) || "Ended", until: p.until || null, lastSeen: p.lastSeen || null, inChannel: pubkeys.includes(pk), blocked: Boolean(p.blocked) };
      });
      return [200, { members: list, checkedAt }];
    }],
    ["POST", /^\/api\/members\/([0-9a-f]{64})$/, "members", async (who, body, [, pk]) => {
      if (owners.has(pk)) return [400, { error: "Owners can't be changed here." }];
      const role = body?.role;
      if (!["Admin", "Member", "Guest"].includes(role)) return [400, { error: "Role must be Admin, Member or Guest." }];
      if (role === "Admin" && roleOf(who.pubkey) !== "Owner") return [403, { error: "Only an owner can make someone an admin." }];
      const until = role === "Guest" ? (Number.isFinite(body.until) ? body.until : now() + 7 * DAY) : null;
      await store.update((x) => { x.people[pk] = { ...(x.people[pk] || {}), role, until, blocked: false }; });
      await audit(who.pubkey, "shield", `Made ${nameOf(pk)} ${role === "Admin" ? "an" : "a"} ${role}${until ? ` until ${new Date(until).toDateString()}` : ""}`);
      return [200, { ok: true, role, until }];
    }],
    ["POST", /^\/api\/members\/([0-9a-f]{64})\/remove$/, "members", async (who, _b, [, pk]) => {
      if (owners.has(pk)) return [400, { error: "Owners can't be removed here." }];
      await store.update((x) => { x.people[pk] = { ...(x.people[pk] || {}), blocked: true }; });
      await sessions.revokePubkey(pk);
      await audit(who.pubkey, "log-out", `Removed ${nameOf(pk)} and signed them out`);
      return [200, { ok: true, note: "Also remove them from the access channel in Buzz." }];
    }],

    ["GET", /^\/api\/permissions$/, null, async () => [200, {
      roles: ROLES,
      permissions: Object.entries(PERMISSIONS).map(([id, p]) => ({ id, label: p.label, roles: Object.fromEntries(ROLES.map((r) => [r, allowed(r, id)])) })),
    }]],
    ["PUT", /^\/api\/permissions$/, "members", async (who, body) => {
      const { permission, role, on } = body || {};
      if (!PERMISSIONS[permission] || !ROLES.includes(role) || typeof on !== "boolean") return [400, { error: "Send { permission, role, on }." }];
      if (role === "Owner") return [400, { error: "Owners can always do everything." }];
      if (permission === "servers" && roleOf(who.pubkey) !== "Owner") return [403, { error: "Only an owner can change who can sign everyone out." }];
      await store.update((x) => { x.permissions[permission] = { ...(x.permissions[permission] || {}), [role]: on }; });
      await audit(who.pubkey, "shield", `${on ? "Allowed" : "Stopped"} ${role}s: ${PERMISSIONS[permission].label.toLowerCase()}`);
      return [200, { ok: true }];
    }],

    ["GET", /^\/api\/plugins$/, null, async (who) => {
      const role = roleOf(who.pubkey);
      return [200, { plugins: Object.entries(d().plugins).map(([id, p]) => ({ ...pluginView(id, p), canUse: p.state === "approved" && levelAllows(pluginView(id, p).level, role) })), trustedPublishers: d().trustedPublishers }];
    }],
    ["POST", /^\/api\/plugins$/, "install", async (who, body) => {
      const { id, name, repo, version: v, publisher, signedBy, description } = body || {};
      if (!ID.test(id || "") || !name || !repo) return [400, { error: "Send { id, name, repo } at least." }];
      if (d().plugins[id]) return [409, { error: "That plugin is already listed." }];
      await store.update((x) => { x.plugins[id] = { name: String(name).slice(0, 80), repo: String(repo).slice(0, 300), version: String(v || "").slice(0, 30), publisher: String(publisher || "").slice(0, 80), signedBy: signedBy || null, description: String(description || "").slice(0, 300), level: "Members", state: "review", submittedBy: who.pubkey }; });
      await audit(who.pubkey, "puzzle", `Submitted ${name} for review`);
      return [201, { ok: true }];
    }],
    ["PUT", /^\/api\/plugins\/([a-z0-9][a-z0-9._-]*)$/, "members", async (who, body, [, id]) => {
      if (!d().plugins[id]) return [404, { error: "No such plugin." }];
      if (!LEVELS.includes(body?.level)) return [400, { error: "Level must be Everyone, Members or Admins." }];
      await store.update((x) => { x.plugins[id].level = body.level; });
      await audit(who.pubkey, "puzzle", `Set ${d().plugins[id].name} to ${{ Everyone: "everyone, guests too", Members: "members, admins and owners", Admins: "admins and owners" }[body.level]}`);
      return [200, { ok: true }];
    }],
    ["POST", /^\/api\/plugins\/([a-z0-9][a-z0-9._-]*)\/(approve|reject|rollout)$/, "members", async (who, _b, [, id, action]) => {
      const p = d().plugins[id];
      if (!p) return [404, { error: "No such plugin." }];
      if (action === "rollout" && !p.update) return [400, { error: "There's no update to roll out." }];
      await store.update((x) => {
        const q = x.plugins[id];
        if (action === "approve") q.state = "approved";
        if (action === "reject") q.state = "rejected";
        if (action === "rollout") { q.version = q.update.version; q.signedBy = q.update.signedBy ?? q.signedBy; delete q.update; }
      });
      await audit(who.pubkey, action === "reject" ? "hand" : "circle-check", `${action === "approve" ? "Approved" : action === "reject" ? "Rejected" : "Rolled out"} ${p.name}${action === "rollout" ? " " + d().plugins[id].version : ""}`);
      return [200, { ok: true }];
    }],
    ["GET", /^\/api\/plugin-trust$/, "install", async () => [200, {
      // Feed to `buzzodz plugin trust` so Buzz refuses unsigned or unknown publishers.
      version: 1, publishers: d().trustedPublishers.map((key) => ({ key })),
    }]],

    ["GET", /^\/api\/requests$/, "approve", async () => [200, { requests: d().requests.filter((r) => r.state === "open").map((r) => ({ ...r, name: nameOf(r.from), targetName: r.kind === "plugin" ? d().plugins[r.target]?.name || r.target : r.target })) }]],
    ["POST", /^\/api\/requests$/, null, async (who, body) => {
      const kind = body?.kind;
      if (!["role", "plugin", "join"].includes(kind)) return [400, { error: "kind must be role, plugin or join." }];
      if (d().requests.filter((r) => r.from === who.pubkey && r.state === "open").length >= 5) return [429, { error: "You already have 5 open requests." }];
      const req = { id: randomBytes(6).toString("hex"), from: who.pubkey, kind, target: String(body.target || "").slice(0, 120), note: String(body.note || "").slice(0, 280), at: now(), state: "open" };
      await store.update((x) => { x.requests = [req, ...x.requests].slice(0, 500); });
      return [201, { ok: true, id: req.id }];
    }],
    ["POST", /^\/api\/requests\/([0-9a-f]{12})\/(approve|dismiss)$/, "approve", async (who, _b, [, id, action]) => {
      const r = d().requests.find((x) => x.id === id && x.state === "open");
      if (!r) return [404, { error: "No such open request." }];
      await store.update((x) => {
        const q = x.requests.find((y) => y.id === id);
        q.state = action === "approve" ? "approved" : "dismissed";
        q.by = who.pubkey;
        if (action === "approve" && q.kind === "role" && ["Member", "Guest"].includes(q.target)) x.people[q.from] = { ...(x.people[q.from] || {}), role: q.target, until: q.target === "Guest" ? now() + 7 * DAY : null };
        if (action === "approve" && q.kind === "plugin" && x.plugins[q.target]) x.plugins[q.target].level = "Members";
      });
      await audit(who.pubkey, action === "approve" ? "circle-check" : "hand", `${action === "approve" ? "Approved" : "Dismissed"} ${nameOf(r.from)}'s request${r.target ? ` (${r.target})` : ""}`);
      return [200, { ok: true, note: r.kind === "join" && action === "approve" ? "Add them to the access channel in Buzz to finish." : undefined }];
    }],

    ["GET", /^\/api\/audit$/, "audit", async () => [200, { entries: d().audit.slice(0, 300).map((a) => ({ ...a, name: a.who === "system" ? "System" : nameOf(a.who) })) }]],

    ["POST", /^\/api\/stats$/, null, async (who, body) => {
      // Opt-in counts from a member's Agent Access: agent names and answers per day only.
      const agents = (Array.isArray(body?.agents) ? body.agents : []).slice(0, 20).map((a) => ({
        name: String(a?.name || "Agent").slice(0, 60),
        answered: Object.fromEntries(Object.entries(a?.answered || {}).filter(([k, v]) => /^\d{4}-\d{2}-\d{2}$/.test(k) && Number.isInteger(v) && v >= 0 && v < 100000).slice(-31)),
      }));
      await store.update((x) => { x.stats[who.pubkey] = { at: now(), agents }; });
      return [200, { ok: true }];
    }],
    ["DELETE", /^\/api\/stats$/, null, async (who) => {
      await store.update((x) => { delete x.stats[who.pubkey]; });
      return [200, { ok: true }];
    }],

    ["GET", /^\/api\/health$/, null, async () => {
      const { checkedAt } = await auth.memberList().catch(() => ({ checkedAt: null }));
      return [200, { ok: true, version, startedAt, uptimeSeconds: Math.round((now() - startedAt) / 1000), membershipCheckedAt: checkedAt }];
    }],
    ["POST", /^\/api\/sessions\/revoke-all$/, "servers", async (who) => {
      await sessions.revokeAll?.();
      await audit(who.pubkey, "log-out", "Signed everyone out");
      return [200, { ok: true }];
    }],
  ];

  /** Handles /api/* routes. Returns true when it answered. */
  async function handle(req, res) {
    const url = new URL(req.url, "http://local");
    if (!url.pathname.startsWith("/api/")) return false;
    const route = routes.find(([method, pattern]) => method === req.method && pattern.test(url.pathname));
    if (!route) return false; // let the app's own /api routes answer
    const who = await auth.requireMember(req, res);
    if (!who) return true;
    const [, pattern, perm, fn] = route;
    if (perm && !can(who.pubkey, perm)) {
      sendJson(res, 403, { error: "Your role can't do that. Ask an admin." });
      return true;
    }
    try {
      await store.update((x) => {
        const p = (x.people[who.pubkey] ||= { firstSeen: now() });
        p.lastSeen = now();
      });
      const body = ["POST", "PUT"].includes(req.method) ? await readJson(req) : undefined;
      const [status, out] = await fn(who, body, url.pathname.match(pattern), url);
      sendJson(res, status, out);
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.status ? error.message : "Something went wrong." });
    }
    return true;
  }

  /** Guard for your own data routes, e.g. the Project Board: `await hub.require(req, res, "edit")`. */
  async function require(req, res, perm) {
    const who = await auth.requireMember(req, res);
    if (!who) return undefined;
    if (!can(who.pubkey, perm)) {
      sendJson(res, 403, { error: "Your role can't do that. Ask an admin." });
      return undefined;
    }
    return { ...who, role: roleOf(who.pubkey) };
  }

  /** Lets the server name people (for the dashboard and audit log). */
  const rememberName = (pubkey, name) => store.update((x) => { if (HEX64.test(pubkey)) x.people[pubkey] = { ...(x.people[pubkey] || {}), name: String(name).slice(0, 60) }; });

  return { handle, require, can, roleOf, isBlocked, onSignIn, audit, rememberName };
}
