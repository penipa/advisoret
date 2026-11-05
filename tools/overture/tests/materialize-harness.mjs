import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

// Execute the actual TypeScript modules with isolated service boundaries.
// No React Native runtime, network, .env or production credentials are used.
export async function loadModule(relativePath, dependencies, globals = {}) {
  const context = vm.createContext({
    Response, Request, Headers, Blob, TextEncoder, TextDecoder, Uint8Array,
    crypto: webcrypto, console, ...globals,
  });
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  const module = new vm.SourceTextModule(stripTypeScriptTypes(source), { context });
  await module.link((specifier) => {
    const exports = dependencies[specifier];
    if (!exports) throw new Error(`Unexpected import: ${specifier}`);
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context });
  });
  await module.evaluate();
  return module.namespace;
}

export const loadMaterializeClient = (invoke) => loadModule(
  "../../../src/lib/overture/materialize.ts",
  { "../supabase": { supabase: { functions: { invoke } } } },
);
