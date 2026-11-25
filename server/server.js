// Team Hub server: Sign in with Buzz, roles and permissions, plugins, requests,
// audit log, the team dashboard, and the Project Board's data.
// Listens on 127.0.0.1 only: the Cloudflare Tunnel is the one way in.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createAuth, sendJson, readJson } from "./auth.js";
import { createBuzzCli } from "./buzz-cli.js";
import { createStore } from "./store.js";
import { createHub, createHubStore } from "./hub.js";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name}`);
  return value;
};
const list = (v) => (v || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

const sessions = await createStore();
const hubStore = await createHubStore();
let hub;
const auth = createAuth({
  cli: createBuzzCli(),
  store: sessions,
  accessChannelId: required("ACCESS_CHANNEL_ID"),
  adminPubkeys: list(process.env.OWNER_PUBKEYS),
  secret: required("AUTH_SECRET"),
  appName: process.env.APP_NAME || "Team Hub",
  membershipTtlMs: Number(process.env.MEMBERSHIP_TTL_MS || 5 * 60_000),
  isBlocked: (pk) => hub.isBlocked(pk),
  onSignIn: (pk) => hub.onSignIn(pk),
});
hub = createHub({ auth, sessions, store: hubStore, ownerPubkeys: list(process.env.OWNER_PUBKEYS), version: "1.0.0" });

// First run: list the team's plugins from data/plugins.json if there is one.
if (!Object.keys(hubStore.get().plugins).length) {
  try {
    const seed = JSON.parse(await readFile(process.env.PLUGINS_SEED || "./data/plugins.json", "utf8"));
    await hubStore.update((x) => { x.plugins = seed.plugins || {}; x.trustedPublishers = seed.trustedPublishers || []; });
  } catch { /* none */ }
}

// Stand-in for the real board data. Replace with feed_server.js's data.
const board = {
  projects: [
    { id: "p1", name: "City Bot", status: "In progress", lead: "Ting-Ya" },
    { id: "p2", name: "Sponsor Dossier", status: "Live", lead: "James" },
  ],
};

const server = createServer(async (req, res) => {
  if (await auth.handle(req, res)) return;
  if (await hub.handle(req, res)) return;
  const path = new URL(req.url, "http://local").pathname;
  if (req.method === "GET" && path === "/api/board") {
    const who = await hub.require(req, res, "view");
    if (who) sendJson(res, 200, { ...board, canEdit: hub.can(who.pubkey, "edit") });
    return;
  }
  if (req.method === "POST" && path === "/api/board/projects") {
    const who = await hub.require(req, res, "edit");
    if (!who) return;
    const body = await readJson(req).catch(() => ({}));
    const project = { id: "p" + Date.now(), name: String(body.name || "Untitled").slice(0, 80), status: String(body.status || "New").slice(0, 40), lead: String(body.lead || "").slice(0, 40) };
    board.projects.push(project);
    await hub.audit(who.pubkey, "server", `Added ${project.name} to the Project Board`);
    sendJson(res, 201, project);
    return;
  }
  sendJson(res, 404, { error: "Not found" });
});

const port = Number(process.env.PORT || 8787);
server.listen(port, "127.0.0.1", () => console.log(`[team-hub] listening on http://127.0.0.1:${port}`));
