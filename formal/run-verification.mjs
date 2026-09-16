/**
 * Execute l'integralite de la verification formelle de ZK-OAuthChain et
 * consigne les resultats obtenus (et non la seule methode employee) :
 *
 *   A. Methode B (Abrial)   -- model-checking exhaustif avec ProB
 *      A1. modele naif transcrit du pseudo-code de la Section 3.4.b
 *      A2. modele durci correspondant au contrat deploye
 *
 *   B. SMTChecker de solc   -- preuve par Horn clauses (moteur CHC, solveur z3)
 *      directement sur le code Solidity.
 *
 * Sortie : resultats/verification-formelle.json et resultats/verification-formelle.log
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "resultats");
fs.mkdirSync(OUT, { recursive: true });

const PROB = path.join(ROOT, "tools/prob/probcli.exe");
const JRE_BIN = path.join(ROOT, "tools/jre/jdk-21.0.12.1+1-jre/bin");
const SOLC_LINUX = "./tools/solc-static-linux";
/** Traduit C:\chemin en /mnt/c/chemin pour l'execution sous WSL. */
const versWsl = (p) => "/mnt/" + p[0].toLowerCase() + p.slice(2).split("\\").join("/");
const ROOT_WSL = versWsl(ROOT);
const Z3_LIB = ROOT_WSL + "/tools/z3lib";

const log = [];
function say(s) { console.log(s); log.push(s); }

function runProB(machine) {
  const env = { ...process.env, PROB_HOME: path.join(ROOT, "tools/prob"),
                PATH: `${JRE_BIN}${path.delimiter}${process.env.PATH}` };
  try {
    return execFileSync(PROB, [machine, "-model-check", "-nodead", "-p", "MAX_DISPLAY_SET", "-1"],
      { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    return (e.stdout || "") + (e.stderr || "");   // violation d'invariant => code de sortie non nul
  }
}

function runSMTChecker(specFile) {
  const cmd =
    `cd ${ROOT_WSL} && export LD_LIBRARY_PATH=${Z3_LIB} && ` +
    `${SOLC_LINUX} --model-checker-engine chc --model-checker-targets assert ` +
    `--model-checker-solvers z3 --model-checker-show-proved-safe ` +
    `--model-checker-show-unproved ${specFile} 2>&1`;
  try {
    return execFileSync("wsl", ["-d", "Ubuntu", "--", "bash", "-c", cmd],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    return (e.stdout || "") + (e.stderr || "");
  }
}

const rapport = { horodatage: new Date().toISOString(), methodeB: {}, smtChecker: {} };

// ---------------------------------------------------------------- Methode B
say("=".repeat(72));
say("A. METHODE B (Abrial 1996) -- model-checking exhaustif ProB 1.16.1");
say("=".repeat(72));

for (const [cle, machine, attendu] of [
  ["modeleNaif", "formal/b/ZKAuthRegistry_v0.mch", "violation"],
  ["modeleDurci", "formal/b/ZKAuthRegistry.mch", "sans-violation"],
  ["liaisonAudience", "formal/b/ZKAuthBinding.mch", "sans-violation"],
]) {
  say(`\n--- ${machine} ---`);
  const out = runProB(machine);
  say(out.trim());

  const violation = /COUNTER EXAMPLE FOUND/.test(out);
  const complet = /ALL states visited/.test(out);
  const etats = Number((out.match(/States analysed:\s*(\d+)/) || [])[1] || 0);
  const transitions = Number((out.match(/Transitions fired:\s*(\d+)/) || [])[1] || 0);
  const ms = Number((out.match(/Model checking time:\s*(\d+) ms/) || [])[1] || 0);
  const invariantFautif = (out.match(/\*\*\* Invariant \d+ \(Line:(\d+)[^\n]*\n\s*(.+)/) || [])[2];
  const trace = [...out.matchAll(/^\s*\d+:\s(.+)$/gm)].map((m) => m[1].trim());

  rapport.methodeB[cle] = {
    machine, attendu,
    violationTrouvee: violation,
    espaceDEtatsCompletementVisite: complet,
    etatsAnalyses: etats, transitionsFranchies: transitions, tempsMs: ms,
    invariantViole: invariantFautif ? invariantFautif.trim() : null,
    contreExemple: violation ? trace : null,
    conforme: attendu === "violation" ? violation : (!violation && complet),
  };
}

// ---------------------------------------------------------------- SMTChecker
say("\n" + "=".repeat(72));
say("B. SMTCHECKER solc 0.8.28 -- moteur CHC (Horn clauses), solveur z3 4.12.6");
say("=".repeat(72));

for (const [cle, spec] of [
  ["surete", "formal/smtchecker/SpecSurete.sol"],
  ["integrite", "formal/smtchecker/SpecIntegrite.sol"],
]) {
  say(`\n--- ${spec} ---`);
  const out = runSMTChecker(spec);
  say(out.trim() || "(aucune sortie)");

  const bloc = out.split(/(?=Info: CHC|Warning: CHC)/);
  const obligations = [];
  for (const b of bloc) {
    const m = b.match(/assert\((.+)\);/);
    if (!m) continue;
    let statut = "indetermine";
    if (/Assertion violation check is safe/.test(b)) statut = "prouve-sur";
    else if (/Assertion violation happens here/.test(b)) statut = "viole";
    obligations.push({ assertion: m[1].trim(), statut });
  }
  rapport.smtChecker[cle] = { fichier: spec, obligations };
}

fs.writeFileSync(path.join(OUT, "verification-formelle.json"), JSON.stringify(rapport, null, 2));
fs.writeFileSync(path.join(OUT, "verification-formelle.log"), log.join("\n"));

// ---------------------------------------------------------------- Synthese
say("\n" + "=".repeat(72));
say("SYNTHESE");
say("=".repeat(72));
for (const [k, v] of Object.entries(rapport.methodeB)) {
  say(`ProB ${k.padEnd(12)} : ${v.conforme ? "CONFORME" : "NON CONFORME"}  ` +
      `(${v.etatsAnalyses} etats, ${v.transitionsFranchies} transitions, ${v.tempsMs} ms)` +
      (v.violationTrouvee ? `  -> contre-exemple sur : ${v.invariantViole}` : ""));
}
for (const [k, v] of Object.entries(rapport.smtChecker)) {
  for (const o of v.obligations) say(`CHC  ${k.padEnd(12)} : ${o.statut.padEnd(13)} ${o.assertion}`);
}
say(`\nEcrit -> resultats/verification-formelle.json`);
