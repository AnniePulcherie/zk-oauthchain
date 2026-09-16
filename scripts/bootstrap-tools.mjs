/**
 * Recupere les outils externes du prototype dans tools/ (repertoire non versionne).
 * Aucune installation systeme : tout est local au depot.
 *
 *   circom 2.2.2            compilation du circuit          (release GitHub iden3)
 *   ProB 1.16.1 + parseur   model-checking Methode B        (HHU Dusseldorf)
 *   JRE Temurin 21          requis par le parseur B de ProB (Adoptium)
 *   solc 0.8.28 statique    SMTChecker sous WSL             (release GitHub ethereum)
 *   libz3 4.12.6            solveur Horn de solc            (roue PyPI manylinux)
 *
 * Usage : node scripts/bootstrap-tools.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";

const TOOLS = path.resolve("tools");
fs.mkdirSync(TOOLS, { recursive: true });

const CIRCOM_VERSION = "2.2.2";
const PROB_VERSION = "1.16.1";
const JRE_TAG = "jdk-21.0.12.1+1";
const JRE_DIR = "jdk-21.0.12.1+1-jre";
const SOLC_VERSION = "0.8.28";
const Z3_WHEEL =
  "https://files.pythonhosted.org/packages/24/99/ca3e00003887498be6c864603ad2cdb57396481d71774377934c9783a38a/" +
  "z3_solver-4.12.6.0-py2.py3-none-manylinux2014_x86_64.whl";

function etape(msg) { console.log(`\n=== ${msg} ===`); }

async function telecharger(url, destination) {
  console.log(`  ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destination, buf);
  console.log(`  -> ${path.relative(process.cwd(), destination)} (${(buf.length / 1e6).toFixed(1)} Mo)`);
  return buf;
}

/** Extraction ZIP via Python (present sur toutes les plateformes ciblees). */
function dezipper(archive, destination, membres = null) {
  const script = membres
    ? `import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);[z.extract(m,sys.argv[2]) for m in ${JSON.stringify(membres)}]`
    : `import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])`;
  execFileSync("python", ["-c", script, archive, destination], { stdio: "inherit" });
}

const exists = (p) => fs.existsSync(p);

// ------------------------------------------------------------------ circom
etape("1/5 circom " + CIRCOM_VERSION);
const circomBin = path.join(TOOLS, process.platform === "win32" ? "circom.exe" : "circom");
if (exists(circomBin)) console.log("  deja present");
else {
  const nom = process.platform === "win32" ? "circom-windows-amd64.exe"
            : process.platform === "darwin" ? "circom-macos-amd64" : "circom-linux-amd64";
  await telecharger(
    `https://github.com/iden3/circom/releases/download/v${CIRCOM_VERSION}/${nom}`, circomBin);
  if (process.platform !== "win32") fs.chmodSync(circomBin, 0o755);
}

// --------------------------------------------------------------------- JRE
etape("2/5 JRE Temurin 21 (parseur B de ProB)");
const javaBin = path.join(TOOLS, "jre", JRE_DIR, "bin",
  process.platform === "win32" ? "java.exe" : "java");
if (exists(javaBin)) console.log("  deja present");
else {
  const zip = path.join(TOOLS, "jre.zip");
  await telecharger(
    `https://github.com/adoptium/temurin21-binaries/releases/download/` +
    `${encodeURIComponent(JRE_TAG)}/OpenJDK21U-jre_x64_windows_hotspot_21.0.12.1_1.zip`, zip);
  dezipper(zip, path.join(TOOLS, "jre"));
  fs.rmSync(zip);
}

// -------------------------------------------------------------------- ProB
etape("3/5 ProB " + PROB_VERSION);
const probBin = path.join(TOOLS, "prob", "probcli.exe");
const probParser = path.join(TOOLS, "prob", "lib", "probcliparser.jar");
if (exists(probBin) && exists(probParser)) console.log("  deja present");
else {
  const base = `https://stups.hhu-hosting.de/downloads/prob`;
  if (!exists(probBin)) {
    const zip = path.join(TOOLS, "probcli.zip");
    await telecharger(`${base}/cli/releases/${PROB_VERSION}/probcli_windows64.zip`, zip);
    dezipper(zip, path.join(TOOLS, "prob"));
    fs.rmSync(zip);
  }
  // Le paquet probcli ne contient pas le parseur B : il vient de la distribution complete.
  if (!exists(probParser)) {
    const zip = path.join(TOOLS, "prob-full.zip");
    await telecharger(`${base}/tcltk/releases/${PROB_VERSION}/ProB.windows64.zip`, zip);
    const tmp = path.join(TOOLS, "_probfull");
    dezipper(zip, tmp, ["ProB/lib/probcliparser.jar"]);
    fs.copyFileSync(path.join(tmp, "ProB/lib/probcliparser.jar"), probParser);
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(zip);
  }
}

// ---------------------------------------------------- solc statique (Linux)
etape("4/5 solc " + SOLC_VERSION + " statique Linux (SMTChecker via WSL)");
const solcLinux = path.join(TOOLS, "solc-static-linux");
if (exists(solcLinux)) console.log("  deja present");
else {
  await telecharger(
    `https://github.com/ethereum/solidity/releases/download/v${SOLC_VERSION}/solc-static-linux`,
    solcLinux);
}

// ------------------------------------------------------------------- libz3
etape("5/5 libz3 4.12.6 (solveur Horn de solc)");
const z3so = path.join(TOOLS, "z3lib", "libz3.so.4.12");
if (exists(z3so)) console.log("  deja present");
else {
  const whl = path.join(TOOLS, "z3.whl");
  await telecharger(Z3_WHEEL, whl);
  fs.mkdirSync(path.join(TOOLS, "z3lib"), { recursive: true });
  execFileSync("python", ["-c",
    "import zipfile,sys,shutil;z=zipfile.ZipFile(sys.argv[1]);" +
    "n=[x for x in z.namelist() if x.endswith('libz3.so')][0];" +
    "f=z.open(n);o=open(sys.argv[2],'wb');shutil.copyfileobj(f,o)",
    whl, z3so], { stdio: "inherit" });
  fs.rmSync(whl);
}

console.log("\nOutils prets dans tools/. Le binaire Windows de solc est compile sans z3 :");
console.log("le SMTChecker s'execute via WSL sur le binaire Linux statique.");
