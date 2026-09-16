/**
 * Processus enfant du banc d'essai : genere UNE preuve Groth16 et la verifie
 * hors-chaine, dans un processus neuf. Isole chaque mesure de toute
 * interference (pools de threads snarkjs, ramasse-miettes, cache).
 *
 * Le temps de preuve est decompose en deux postes :
 *   - calcul du temoin      (evaluation du circuit en WebAssembly)
 *   - preuve Groth16        (MSM et FFT sur BN254)
 * Cette separation permet d'imputer correctement le cout, le calcul du temoin
 * etant particulierement penalise par l'execution WebAssembly.
 *
 * Usage : node bench/prove-once.mjs <temoin.json> <sortie.json>
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as snarkjs from "snarkjs";
import { toSolidityCalldata } from "../lib/zkoauth.mjs";

const [temoinPath, sortiePath] = process.argv.slice(2);
const entree = JSON.parse(fs.readFileSync(temoinPath, "utf8"));
const vkey = JSON.parse(fs.readFileSync("build/verification_key.json", "utf8"));

const WASM = path.resolve("build/zkauth_js/zkauth.wasm");
const ZKEY = path.resolve("build/zkauth_final.zkey");
const wtns = path.join(os.tmpdir(), `zkoauth-${process.pid}.wtns`);

const t0 = performance.now();
await snarkjs.wtns.calculate(entree, WASM, wtns);
const t1 = performance.now();
const { proof, publicSignals } = await snarkjs.groth16.prove(ZKEY, wtns);
const t2 = performance.now();
const ok = await snarkjs.groth16.verify(vkey, publicSignals, proof);
const t3 = performance.now();

fs.rmSync(wtns, { force: true });
fs.writeFileSync(sortiePath, JSON.stringify({
  tempsCalculTemoinMs: t1 - t0,
  tempsPreuveGroth16Ms: t2 - t1,
  tempsGenerationMs: t2 - t0,
  tempsVerificationHorsChaineMs: t3 - t2,
  valide: ok,
  calldata: toSolidityCalldata(proof, publicSignals),
  taillePreuveJsonOctets: Buffer.byteLength(JSON.stringify(proof)),
}));
process.exit(ok ? 0 : 1);
