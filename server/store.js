// Minimal JSON-file store for codes and sessions. Holds only hashes: a leaked
// file reveals no usable code or token. Swap for your real database later.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function createStore(file = process.env.AUTH_STORE || "./data/auth-store.json") {
  let data = { codes: {}, sessions: {} };
  try {
    data = JSON.parse(await readFile(file, "utf8"));
  } catch {
    /* first run */
  }
  let writing = Promise.resolve();
  const save = () => {
    writing = writing.then(async () => {
      await mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      await writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
      await rename(tmp, file);
    });
    return writing;
  };
  const purge = () => {
    const t = Date.now();
    for (const [k, v] of Object.entries(data.codes)) if (v.expiresAt < t) delete data.codes[k];
    for (const [k, v] of Object.entries(data.sessions)) if (v.expiresAt < t) delete data.sessions[k];
  };
  return {
    async getCode(pubkey) { return data.codes[pubkey]; },
    async saveCode(pubkey, value) { data.codes[pubkey] = value; purge(); await save(); },
    async deleteCode(pubkey) { delete data.codes[pubkey]; await save(); },
    async getSession(key) { return data.sessions[key]; },
    async saveSession(key, value) { data.sessions[key] = value; purge(); await save(); },
    async deleteSession(key) { delete data.sessions[key]; await save(); },
    /** Ends every session, e.g. after a leaked token. */
    async revokeAll() { data.sessions = {}; await save(); },
    /** Ends every session for one person, e.g. when an admin revokes them. */
    async revokePubkey(pubkey) {
      for (const [k, v] of Object.entries(data.sessions)) if (v.pubkey === pubkey) delete data.sessions[k];
      await save();
    },
  };
}
