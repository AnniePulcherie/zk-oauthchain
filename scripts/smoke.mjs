/**
 * Test de bout en bout hors-chaine : emission, generation de preuve, verification,
 * et contre-epreuve de revocation. Ne requiert aucun noeud EVM.
 *
 * Le separateur de domaine est ici une valeur de demonstration ; en fonctionnement
 * reel il est lu sur le contrat (registry.domainSeparator()).
 *
 * Usage : node scripts/smoke.mjs
 */
import fs from "node:fs";
import * as snarkjs from "snarkjs";
import {
  AuthorizationServer, proveAuthorization,
  ISSUER_DEFAULT, RESOURCE_SERVER_DEFAULT, CLIENT_DEFAULT,
} from "../lib/zkoauth.mjs";

const DOMAINE_DEMO = 1234567890123456789n;

const as = await AuthorizationServer.create({ issuer: ISSUER_DEFAULT, domain: DOMAINE_DEMO });

const emettre = (subject) => as.issueToken({
  subject, client: CLIENT_DEFAULT,
  resourceServer: RESOURCE_SERVER_DEFAULT, scope: "read:accounts",
});

for (let i = 0; i < 7; i++) emettre(`user${i}`);
const grant = emettre("alice");
for (let i = 0; i < 5; i++) emettre(`user${i + 10}`);

// L'arbre de revocation ne doit pas etre vide : la preuve d'exclusion est alors
// reellement sollicitee, et non reduite au cas trivial de l'arbre vide.
await as.revoke(emettre("mallory").commitment);

const challenge = AuthorizationServer.challenge("read:accounts", "nonce-42", 1900000000);
const w = await as.witness(grant, challenge);

console.log("racine d'emission    :", w.root);
console.log("racine de revocation :", w.revRoot);
console.log("contexte public      : iss=%s… aud=%s… rs=%s…",
  w.issuerId.slice(0, 8), w.clientId.slice(0, 8), w.resourceServerId.slice(0, 8));

const t0 = performance.now();
const { proof, publicSignals } = await proveAuthorization(w);
console.log(`preuve generee en ${(performance.now() - t0).toFixed(0)} ms ` +
            `(${publicSignals.length} signaux publics)`);

const vkey = JSON.parse(fs.readFileSync("build/verification_key.json", "utf8"));
const ok = await snarkjs.groth16.verify(vkey, publicSignals, proof);
console.log("verification hors-chaine :", ok ? "VALIDE" : "INVALIDE");

// Contre-epreuve 1 : apres revocation, aucun temoin d'exclusion n'est productible.
await as.revoke(grant.commitment);
try {
  await as.witness(grant, challenge);
  console.error("ERREUR : un temoin a ete produit pour un engagement revoque");
  process.exit(1);
} catch (err) {
  console.log("contre-epreuve revocation :", err.message);
}

// Contre-epreuve 2 : declarer un autre Serveur de Ressource rend le circuit
// insatisfiable -- la liaison de contexte est cryptographique, pas declarative.
const falsifie = { ...w, resourceServerId: (BigInt(w.resourceServerId) + 1n).toString() };
try {
  await proveAuthorization(falsifie);
  console.error("ERREUR : une preuve a ete produite pour un contexte falsifie");
  process.exit(1);
} catch {
  console.log("contre-epreuve liaison    : contexte falsifie -> circuit insatisfiable");
}

process.exit(ok ? 0 : 1);
