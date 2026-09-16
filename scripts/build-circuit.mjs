/**
 * Chaine de construction du circuit ZK-OAuthChain :
 * compilation circom -> Powers of Tau (ceremonie Hermez) -> setup Groth16 phase 2
 * -> cle de verification JSON -> verificateur Solidity.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as snarkjs from "snarkjs";
import { getCurveFromName } from "ffjavascript";

const ROOT = process.cwd();
const BUILD = path.join(ROOT, "build");
const PTAU_POWER = 15;
const PTAU_FILE = path.join(BUILD, `powersOfTau28_hez_final_${PTAU_POWER}.ptau`);
const PTAU_ORIGIN = path.join(BUILD, "ptau-origine.json");
const PHASE1_ENTROPY = "zk-oauthchain-phase1-entropie-prototype-2026";
const PTAU_MIRRORS = [
  `https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_${PTAU_POWER}.ptau`,
  `https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_${PTAU_POWER}.ptau`,
];
const CIRCOM = path.join(ROOT, "tools", process.platform === "win32" ? "circom.exe" : "circom");

fs.mkdirSync(BUILD, { recursive: true });
const curve = await getCurveFromName("bn128");

function step(msg) { console.log(`\n=== ${msg} ===`); }

step("1/5 Compilation du circuit Circom");
execFileSync(CIRCOM, [
  "circuits/zkauth.circom", "--r1cs", "--wasm", "--sym",
  "-l", "node_modules", "-o", "build",
], { stdio: "inherit" });

step("2/5 Powers of Tau (phase 1, independante du circuit)");
if (!fs.existsSync(PTAU_FILE)) {
  let ok = false;
  for (const url of PTAU_MIRRORS) {
    try {
      console.log(`Tentative de telechargement : ${url}`);
      const res = await fetch(url);
      if (!res.ok) { console.log(`  -> HTTP ${res.status}, miroir suivant`); continue; }
      fs.writeFileSync(PTAU_FILE, Buffer.from(await res.arrayBuffer()));
      fs.writeFileSync(PTAU_ORIGIN, JSON.stringify({ origine: "ceremonie-publique", url }, null, 2));
      ok = true; break;
    } catch (e) { console.log(`  -> echec (${e.message}), miroir suivant`); }
  }
  if (!ok) {
    console.log("Aucun miroir public disponible : ceremonie locale reproductible (bn128, 2^%d).", PTAU_POWER);
    const p0 = path.join(BUILD, "pot_0000.ptau");
    const p1 = path.join(BUILD, "pot_0001.ptau");
    await snarkjs.powersOfTau.newAccumulator(curve, PTAU_POWER, p0);
    await snarkjs.powersOfTau.contribute(p0, p1, "ZK-OAuthChain phase1", PHASE1_ENTROPY);
    await snarkjs.powersOfTau.preparePhase2(p1, PTAU_FILE);
    fs.writeFileSync(PTAU_ORIGIN, JSON.stringify({
      origine: "ceremonie-locale-mono-contributeur",
      note: "Setup de confiance local : suffisant pour un prototype, PAS pour la production. Limite documentee en discussion.",
      courbe: "bn128", puissance: PTAU_POWER,
    }, null, 2));
  }
}
console.log(`ptau : ${PTAU_FILE} (${(fs.statSync(PTAU_FILE).size / 1e6).toFixed(1)} Mo)`);

step("3/5 Setup Groth16 (phase 2, specifique au circuit)");
const r1cs = path.join(BUILD, "zkauth.r1cs");
const zkey0 = path.join(BUILD, "zkauth_0000.zkey");
const zkeyFinal = path.join(BUILD, "zkauth_final.zkey");
await snarkjs.zKey.newZKey(r1cs, PTAU_FILE, zkey0);
await snarkjs.zKey.contribute(zkey0, zkeyFinal, "ZK-OAuthChain phase2", "entropie-prototype-zk-oauthchain-2026");

step("4/5 Export de la cle de verification");
const vkey = await snarkjs.zKey.exportVerificationKey(zkeyFinal);
fs.writeFileSync(path.join(BUILD, "verification_key.json"), JSON.stringify(vkey, null, 2));

step("5/5 Export du verificateur Solidity");
const sol = await snarkjs.zKey.exportSolidityVerifier(zkeyFinal, {
  groth16: fs.readFileSync(
    path.join(ROOT, "node_modules/snarkjs/templates/verifier_groth16.sol.ejs"), "utf8"),
});
fs.writeFileSync(path.join(ROOT, "contracts/Groth16Verifier.sol"), sol);

const info = await snarkjs.r1cs.info(r1cs);
const stats = {
  contraintes: info.nConstraints,
  variables: info.nVars,
  signauxPublics: info.nOutputs + info.nPubInputs,
  ptauPower: PTAU_POWER,
  tailleZkeyOctets: fs.statSync(zkeyFinal).size,
  tailleWasmOctets: fs.statSync(path.join(BUILD, "zkauth_js/zkauth.wasm")).size,
};
fs.writeFileSync(path.join(BUILD, "circuit-stats.json"), JSON.stringify(stats, null, 2));
console.log("\nStatistiques du circuit :", stats);
process.exit(0);
