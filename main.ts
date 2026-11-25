import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { boardIssue, buildRadar, dataScript, parseSnapshot } from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const inputDirectory = process.env.MAKEFUN_INPUT_DIR ?? "/input";
const inputFile = inputDirectory.endsWith(".json") ? inputDirectory : join(inputDirectory, "snapshot.json");
const outputDirectory = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";

if (!existsSync(inputFile)) {
  throw new Error(`No snapshot at ${inputFile}`);
}

const snapshot = parseSnapshot(readFileSync(inputFile, "utf8"));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue) throw new Error(`Board failed its own gate: ${issue}`);

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(join(outputDirectory, "board.json"), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outputDirectory, "data.js"), dataScript(radar));

function copyRegularFiles(source: string, target: string): number {
  if (!existsSync(source)) return 0;
  mkdirSync(target, { recursive: true });
  let count = 0;
  for (const name of readdirSync(source)) {
    if (name.startsWith(".")) continue;
    const path = join(source, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(target, name));
    count += 1;
  }
  return count;
}

copyRegularFiles(join(here, "dashboard"), join(outputDirectory, "dashboard"));
const screenshotDirectory = join(here, "screenshots");
const screenshotFiles = readdirSync(screenshotDirectory).filter((name) => !name.startsWith("."));
if (screenshotFiles.some((name) => !/\.(png|jpe?g)$/i.test(name))) {
  throw new Error("Every screenshot must be a PNG or JPEG image");
}
const screenshots = copyRegularFiles(screenshotDirectory, join(outputDirectory, "screenshots"));
if (screenshots < 3) throw new Error(`Need at least 3 screenshots, found ${screenshots}`);

const dossier = buildDossier(outputDirectory, {
  text_max_bytes: 65_536,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
});
writeFileSync(join(outputDirectory, "dossier.json"), dossier);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} watchlist, ${board.length} ranked rows, ${radar.early_size} early radar rows\n`,
);
