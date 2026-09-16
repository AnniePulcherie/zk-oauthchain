import fs from "node:fs";
import * as snarkjs from "snarkjs";
import { AuthorizationServer, proveAuthorization } from "../lib/zkoauth.mjs";

const as = await AuthorizationServer.create();
for (let i = 0; i < 7; i++) as.issueToken(`user${i}`, "read:profile", 1800000000);
const grant = as.issueToken("alice", "read:accounts", 1800000000);
for (let i = 0; i < 5; i++) as.issueToken(`user${i + 10}`, "read:profile", 1800000000);

const challenge = AuthorizationServer.challenge("api.banque.example", "read:accounts", "nonce-42", 1800000000);
const w = await as.witness(grant, challenge);

console.log("racine d'emission   :", w.root);
console.log("racine de revocation:", w.revRoot);

const t0 = performance.now();
const { proof, publicSignals } = await proveAuthorization(w);
const t1 = performance.now();
console.log(`preuve generee en ${(t1 - t0).toFixed(0)} ms`);
console.log("signaux publics :", publicSignals);

const vkey = JSON.parse(fs.readFileSync("build/verification_key.json", "utf8"));
const ok = await snarkjs.groth16.verify(vkey, publicSignals, proof);
console.log("verification hors-chaine :", ok ? "VALIDE" : "INVALIDE");

// Contre-epreuve : apres revocation, le temoin d'exclusion doit devenir impossible.
await as.revoke(grant.commitment);
try {
  await as.witness(grant, challenge);
  console.log("ERREUR : un temoin a ete produit pour un engagement revoque");
  process.exit(1);
} catch (e) {
  console.log("contre-epreuve revocation :", e.message);
}
process.exit(ok ? 0 : 1);
