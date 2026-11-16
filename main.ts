// FREIGHTLINE hand-in program.
// When the grader runs this file it assembles the entry's output folder:
// the playable game and its screenshots are copied across, then a dossier
// describing them is built with the vendored library and saved as JSON.

import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-threejs.ts";

// Everything this program needs sits beside it in the repository root.
const root = dirname(fileURLToPath(import.meta.url));

// The grader may point the output elsewhere; /output is the default.
const out = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";

mkdirSync(out, { recursive: true });

// The game is a static site, so it travels to the output unchanged.
// Fail loudly when it is absent: a dossier built from an empty output
// folder would waste a judging run on a packaging mistake.
const gameDir = join(root, "game");
if (!existsSync(gameDir)) {
  console.error(`FREIGHTLINE: no game directory found at ${gameDir}`);
  process.exit(1);
}
cpSync(gameDir, join(out, "game"), { recursive: true });

// Screenshots are judging evidence; include them whenever they exist.
const shotsDir = join(root, "screenshots");
if (existsSync(shotsDir)) {
  cpSync(shotsDir, join(out, "screenshots"), { recursive: true });
}

// Build the dossier under the competition's size caps and write it out.
const dossier = await buildDossier(out, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(out, "dossier.json"), JSON.stringify(dossier, null, 2));
