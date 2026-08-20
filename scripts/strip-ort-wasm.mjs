// ort wasm is loaded from the CDN at runtime (WASM_CDN_BASE in
// components/editor/constants.ts); drop the webpack-emitted copy to stay
// under the Cloudflare Pages 25 MiB per-file limit.
import { readdirSync, rmSync } from "node:fs"
import { join } from "node:path"

const mediaDir = join("out", "_next", "static", "media")
for (const f of readdirSync(mediaDir)) {
  if (f.startsWith("ort-") && f.endsWith(".wasm")) {
    rmSync(join(mediaDir, f))
    console.log(`removed ${f}`)
  }
}
