/**
 * Banc d'essai OAuth 2.0 classique (reference comparative, OS6).
 *
 * Mesure la latence totale du flux d'autorisation, decomposee :
 *   1. GET  /authorize  -- obtention du code d'autorisation (PKCE S256)
 *   2. POST /token      -- echange code <-> jeton d'acces
 *   3. acces a la ressource protegee, selon deux modes de validation :
 *        a) jeton opaque + introspection RFC 7662 aupres de l'AS (dependance centrale)
 *        b) JWT RS256 auto-porteur verifie localement par le RS (variante la plus rapide)
 *
 * Usage : node bench/bench-oauth.mjs [iterations]
 */
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import { startServers, AS_PORT, RS_PORT, oauthConfig } from "../baseline-oauth/server.mjs";
import { stats, ligne, ENTETE } from "./stats.mjs";

const N = Number(process.argv[2] || 200);
const servers = await startServers();
const AS = `http://127.0.0.1:${AS_PORT}`;
const RS = `http://127.0.0.1:${RS_PORT}`;

const m = {
  autorisation: [], echangeJeton: [],
  ressourceIntrospection: [], ressourceJwt: [],
  fluxTotalIntrospection: [], fluxTotalJwt: [],
};

// Rodage : ecarte les effets de demarrage a froid (JIT, pool RSA, connexions).
for (let i = 0; i < 20; i++) await unFlux();

async function unFlux() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

  const t0 = performance.now();
  const rAuth = await fetch(
    `${AS}/authorize?client_id=${oauthConfig.CLIENT_ID}&response_type=code` +
    `&code_challenge=${challenge}&code_challenge_method=S256` +
    `&scope=read:accounts&state=xyz`, { redirect: "manual" });
  const code = new URL(rAuth.headers.get("location")).searchParams.get("code");
  const t1 = performance.now();

  const rTok = await fetch(`${AS}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code, code_verifier: verifier,
      client_id: oauthConfig.CLIENT_ID, redirect_uri: oauthConfig.REDIRECT_URI,
    }),
  });
  const tok = await rTok.json();
  const t2 = performance.now();

  const rIntro = await fetch(`${RS}/resource`, {
    headers: { authorization: `Bearer ${tok.access_token}` } });
  if (rIntro.status !== 200) throw new Error("introspection : acces refuse");
  const t3 = performance.now();

  const rJwt = await fetch(`${RS}/resource-jwt`, {
    headers: { authorization: `Bearer ${tok.jwt_access_token}` } });
  if (rJwt.status !== 200) throw new Error("jwt : acces refuse");
  const t4 = performance.now();

  return { autorisation: t1 - t0, echangeJeton: t2 - t1,
           ressourceIntrospection: t3 - t2, ressourceJwt: t4 - t3 };
}

console.log(`Flux OAuth 2.0 mesures : ${N}\n`);
for (let i = 0; i < N; i++) {
  const r = await unFlux();
  m.autorisation.push(r.autorisation);
  m.echangeJeton.push(r.echangeJeton);
  m.ressourceIntrospection.push(r.ressourceIntrospection);
  m.ressourceJwt.push(r.ressourceJwt);
  m.fluxTotalIntrospection.push(r.autorisation + r.echangeJeton + r.ressourceIntrospection);
  m.fluxTotalJwt.push(r.autorisation + r.echangeJeton + r.ressourceJwt);
  if ((i + 1) % 25 === 0) process.stdout.write(`\r  flux ${i + 1}/${N}   `);
}
console.log("\n");

const resultats = {
  horodatage: new Date().toISOString(),
  iterations: N,
  machine: { cpu: os.cpus()[0].model, coeurs: os.cpus().length, node: process.version },
  configuration: "AS et RS sur boucle locale (127.0.0.1), aucune latence reseau etendue",
  temps: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, stats(v)])),
};
fs.mkdirSync("resultats", { recursive: true });
fs.writeFileSync("resultats/bench-oauth.json", JSON.stringify(resultats, null, 2));

console.log(ENTETE);
console.log("-".repeat(88));
for (const [k, v] of Object.entries(resultats.temps)) console.log(ligne(k, v));
console.log(`\nEcrit -> resultats/bench-oauth.json`);

servers.close();
process.exit(0);
