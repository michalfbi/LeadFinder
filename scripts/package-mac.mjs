#!/usr/bin/env node
// Pakowanie LeadFinder na macOS: .app → .zip i .dmg dla Apple Silicon (arm64) i Intela (x64).
//
// Użycie:
//   node scripts/package-mac.mjs                 # obie architektury
//   node scripts/package-mac.mjs --arch arm64    # tylko Apple Silicon
//   node scripts/package-mac.mjs --skip-build    # bez ponownego budowania interfejsu
// Wersja: zmienna APP_VERSION (np. 1.2.0) albo pole "version" z package.json.
//
// Aplikacja nie jest podpisana certyfikatem Apple Developer. Na macOS skrypt podpisuje ją
// podpisem ad-hoc (bez tego Apple Silicon w ogóle nie uruchomi pobranej aplikacji),
// a instrukcję pierwszego uruchomienia zawiera opis wydania i README.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { packager } from "@electron/packager";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "release");
const APP_NAME = "LeadFinder";
const BUNDLE_ID = "pl.leadfinder.desktop";
const IS_MAC = process.platform === "darwin";
const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const archArg = argValue("--arch") ?? "all";
const ARCHES = archArg === "all" ? ["arm64", "x64"] : [archArg];
for (const a of ARCHES) {
  if (!["arm64", "x64"].includes(a)) throw new Error(`Nieznana architektura: ${a} (dozwolone: arm64, x64, all)`);
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const VERSION = String(process.env.APP_VERSION || pkg.version || "0.0.0").replace(/^v/, "");
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(VERSION)) {
  throw new Error(`Wersja „${VERSION}” musi mieć postać 1.2.3`);
}

function run(cmd, cmdArgs, opts = {}) {
  console.log(`$ ${cmd} ${cmdArgs.join(" ")}`);
  execFileSync(cmd, cmdArgs, { stdio: "inherit", cwd: ROOT, ...opts });
}

/** 1. Interfejs w trybie SPA, tam gdzie szuka go electron/main.cjs (dist/client). */
function buildInterface() {
  if (!args.includes("--skip-build")) {
    run(process.execPath, [path.join(ROOT, "node_modules", "vite", "bin", "vite.js"), "build", "--config", "vite.desktop.config.ts"]);
  }
  const target = path.join(ROOT, "dist", "client");
  if (fs.existsSync(path.join(target, "_shell.html"))) return;
  // Zależnie od środowiska Nitro zapisuje statyczny interfejs w .output/public.
  const alt = path.join(ROOT, ".output", "public");
  if (!fs.existsSync(path.join(alt, "_shell.html"))) {
    throw new Error("Nie znaleziono _shell.html ani w dist/client, ani w .output/public — build interfejsu nie powiódł się.");
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(alt, target, { recursive: true });
  console.log("Skopiowano interfejs z .output/public do dist/client");
}

/** 2. Zależności procesu głównego: tylko to, co faktycznie wymaga electron/*.cjs, z całym drzewem. */
function mainProcessModules() {
  const sources = fs
    .readdirSync(path.join(ROOT, "electron"))
    .filter((f) => f.endsWith(".cjs"))
    .map((f) => fs.readFileSync(path.join(ROOT, "electron", f), "utf8"))
    .join("\n");
  const builtins = new Set(require("node:module").builtinModules);
  const roots = new Set();
  for (const m of sources.matchAll(/require\(\s*["']([^"'./][^"']*)["']\s*\)/g)) {
    const spec = m[1];
    const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
    if (name === "electron" || name.startsWith("node:") || builtins.has(name)) continue;
    roots.add(name);
  }
  const keep = new Set();
  const visit = (name) => {
    if (keep.has(name)) return;
    const manifest = path.join(ROOT, "node_modules", name, "package.json");
    if (!fs.existsSync(manifest)) return; // zależność opcjonalna, której nie zainstalowano
    keep.add(name);
    const p = JSON.parse(fs.readFileSync(manifest, "utf8"));
    for (const dep of Object.keys({ ...p.dependencies, ...p.optionalDependencies, ...p.peerDependencies })) visit(dep);
  };
  for (const r of roots) visit(r);
  return keep;
}

/** 3. Ikona .icns z public/icon-512.png (tylko na macOS — sips i iconutil są systemowe). */
function buildIcon() {
  const png = path.join(ROOT, "public", "icon-512.png");
  if (!IS_MAC || !fs.existsSync(png)) return undefined;
  const set = path.join(ROOT, "build", "icon.iconset");
  fs.rmSync(set, { recursive: true, force: true });
  fs.mkdirSync(set, { recursive: true });
  for (const size of [16, 32, 128, 256, 512]) {
    run("sips", ["-z", String(size), String(size), png, "--out", path.join(set, `icon_${size}x${size}.png`)], { stdio: "ignore" });
    const double = Math.min(size * 2, 512);
    run("sips", ["-z", String(double), String(double), png, "--out", path.join(set, `icon_${size}x${size}@2x.png`)], { stdio: "ignore" });
  }
  const icns = path.join(ROOT, "build", "icon.icns");
  run("iconutil", ["-c", "icns", set, "-o", icns]);
  return icns;
}

const ALWAYS_IGNORED = [
  /^\/src(\/|$)/,
  /^\/public(\/|$)/,
  /^\/supabase(\/|$)/,
  /^\/drizzle(\/|$)/,
  /^\/scripts(\/|$)/,
  /^\/build(\/|$)/,
  /^\/release(\/|$)/,
  /^\/\.output(\/|$)/,
  /^\/\.github(\/|$)/,
  /^\/\.git(\/|$)/,
  /^\/dist\/server(\/|$)/,
  /^\/[^/]*\.(md|ts|lock|toml)$/,
  /^\/(package-lock\.json|components\.json|eslint\.config\.js|tsconfig\.json)$/,
];

async function main() {
  buildInterface();
  const keep = mainProcessModules();
  console.log(`Moduły procesu głównego (${keep.size}): ${[...keep].sort().join(", ")}`);
  const icon = buildIcon();
  fs.mkdirSync(OUT, { recursive: true });

  const ignore = (file) => {
    if (!file) return false;
    if (ALWAYS_IGNORED.some((re) => re.test(file))) return true;
    const m = file.match(/^\/node_modules\/(@[^/]+\/[^/]+|[^/@][^/]*)/);
    if (m) return !keep.has(m[1]);
    if (/^\/node_modules\/@[^/]+$/.test(file)) {
      const scope = file.slice("/node_modules/".length);
      return ![...keep].some((k) => k.startsWith(`${scope}/`));
    }
    return false;
  };

  const artifacts = [];
  for (const arch of ARCHES) {
    console.log(`\n=== ${APP_NAME} ${VERSION} · macOS ${arch} ===`);
    const [appDir] = await packager({
      dir: ROOT,
      name: APP_NAME,
      executableName: APP_NAME,
      platform: "darwin",
      arch,
      appVersion: VERSION,
      buildVersion: VERSION,
      appBundleId: BUNDLE_ID,
      appCategoryType: "public.app-category.business",
      appCopyright: `© ${new Date().getFullYear()} LeadFinder`,
      icon,
      out: OUT,
      overwrite: true,
      prune: true,
      asar: false,
      ignore,
      // Opcjonalnie: folder z pobranymi wcześniej zipami Electrona (praca bez sieci).
      ...(process.env.ELECTRON_ZIP_DIR ? { electronZipDir: process.env.ELECTRON_ZIP_DIR } : {}),
      extendInfo: {
        LSMinimumSystemVersion: "12.0",
        NSAppleEventsUsageDescription:
          "LeadFinder steruje aplikacją Wiadomości, żeby wysyłać zaplanowane przez Ciebie SMS-y.",
        NSHumanReadableCopyright: "LeadFinder",
      },
    });
    const app = path.join(appDir, `${APP_NAME}.app`);
    const label = arch === "arm64" ? "AppleSilicon" : "Intel";
    const base = `${APP_NAME}-${VERSION}-mac-${label}`;

    if (IS_MAC) {
      // Podpis ad-hoc: bez certyfikatu, ale wymagany, żeby Apple Silicon uruchomił aplikację.
      run("codesign", ["--force", "--deep", "--sign", "-", app]);
      run("codesign", ["--verify", "--deep", "--strict", app]);
      const zip = path.join(OUT, `${base}.zip`);
      fs.rmSync(zip, { force: true });
      run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, zip]);
      artifacts.push(zip);

      const staging = path.join(OUT, `dmg-${arch}`);
      fs.rmSync(staging, { recursive: true, force: true });
      fs.mkdirSync(staging, { recursive: true });
      run("ditto", [app, path.join(staging, `${APP_NAME}.app`)]);
      fs.symlinkSync("/Applications", path.join(staging, "Applications"));
      const dmg = path.join(OUT, `${base}.dmg`);
      fs.rmSync(dmg, { force: true });
      run("hdiutil", ["create", "-volname", `${APP_NAME} ${VERSION}`, "-srcfolder", staging, "-ov", "-format", "UDZO", dmg]);
      fs.rmSync(staging, { recursive: true, force: true });
      artifacts.push(dmg);
    } else {
      // Poza macOS (np. test na Linuksie) powstaje tylko .zip, bez podpisu i bez .dmg.
      const zip = path.join(OUT, `${base}.zip`);
      fs.rmSync(zip, { force: true });
      run("zip", ["-qry", zip, `${APP_NAME}.app`], { cwd: appDir });
      artifacts.push(zip);
    }
  }
  console.log("\nGotowe pliki:");
  for (const a of artifacts) console.log(`  ${path.relative(ROOT, a)}  (${(fs.statSync(a).size / 1048576).toFixed(1)} MB)`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${VERSION}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
