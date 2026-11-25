// The built plugin must load as a module, or Buzz shows nothing.
import { test } from "node:test";
import assert from "node:assert/strict";

test("plugin/dist/plugin.js loads and exports inject and apply", async () => {
  const mod = await import(new URL("../plugin/dist/plugin.js", import.meta.url).href + "?t=" + Date.now());
  assert.ok(Array.isArray(mod.inject));
  assert.equal(typeof mod.apply, "function");
});
