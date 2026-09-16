/**
 * Banc d'essai ZK-OAuthChain (OS4) :
 *   - temps de generation de preuve (client)
 *   - temps de verification hors-chaine et sur-chaine
 *   - cout en gas : verification pure des couplages, puis autorisation complete
 *   - taille de preuve (calldata effective)
 *   - latence totale du flux d'autorisation decentralise
 *
 * Methodologie : chaque preuve est generee dans un PROCESSUS NEUF
 * (bench/prove-once.mjs). C'est le comportement reel d'un client, et cela
 * elimine toute interference entre iterations -- les pools de threads de
 * snarkjs ne sont pas liberes entre deux appels et degradent sinon les
 * mesures d'un facteur 4.
 *
 * Usage : node bench/bench-zk.mjs [reseau] [iterations]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ethers } from "ethers";
import { artifact, connect, loadDeployment, LOCAL_KEY_1 } from "../scripts/common.mjs";
import { AuthorizationServer, toField, ISSUER_DEFAULT,
         RESOURCE_SERVER_DEFAULT, CLIENT_DEFAULT } from "../lib/zkoauth.mjs";
import { stats, ligne, ENTETE } from "./stats.mjs";

const network = process.argv[2] || "localhost";
const N = Number(process.argv[3] || 30);
const TAILLE_ARBRE = 64;
const REVOQUES = [3, 17, 40];

const dep = loadDeployment(network);
const { provider, signer } = await connect(network);
const registry = new ethers.Contract(
  dep.contrats.ZKAuthRegistry.adresse, artifact("ZKAuthRegistry").abi, signer);
const probe = new ethers.Contract(
  dep.contrats.GasProbe.adresse, artifact("GasProbe").abi, signer);

console.log(`Reseau     : ${network} (chainId ${dep.chainId})`);
console.log(`Registre   : ${dep.contrats.ZKAuthRegistry.adresse}`);
const rsAddress = dep.serveurRessource.adresse;
console.log(`Serv. Ressource : ${rsAddress} (${dep.serveurRessource.nom})`);
console.log(`Iterations : ${N}\n`);

// ------------------------------------------------- Phase 1 : emission par l'AS
const tEmission = [];
const domain = await registry.domainSeparator();
const as = await AuthorizationServer.create({ issuer: ISSUER_DEFAULT, domain });
const grants = [];
for (let i = 0; i < TAILLE_ARBRE; i++) {
  const t0 = performance.now();
  grants.push(as.issueToken({
    subject: `sujet-${i}`, client: CLIENT_DEFAULT,
    resourceServer: RESOURCE_SERVER_DEFAULT, scope: "read:accounts",
  }));
  tEmission.push(performance.now() - t0);
}
for (const i of REVOQUES) await as.revoke(grants[i].commitment);

const roots = as.roots();
const asSigner = network === "sepolia"
  ? signer
  : new ethers.NonceManager(new ethers.Wallet(LOCAL_KEY_1, provider));
const rSet = await (await registry.connect(asSigner)
  .setRoots(roots.issuanceRoot, roots.revocationRoot)).wait();
console.log(`Ancrage des racines : gas=${rSet.gasUsed}, epoque=${await registry.epoch()}\n`);

// ------------------------------------------------- Phase 2 : mesures
const m = {
  temoin: [], preuve: [], calculTemoin: [], preuveGroth16: [],
  verifHorsChaine: [], verifSurChaine: [],
  gasVerificationPure: [], gasAutorisation: [],
  latenceFluxLecture: [], latenceFluxEcriture: [],
};
let tailleCalldata = 0, taillePreuveJson = 0;
const TAILLE_PREUVE = 8 * 32;   // 2 x G1 + 1 x G2 sur BN254

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zkoauth-bench-"));
const temoinTmp = path.join(tmp, "temoin.json");
const preuveTmp = path.join(tmp, "preuve.json");

let effectuees = 0;
for (let i = 0; effectuees < N; i++) {
  const idx = (i * 7 + 1) % TAILLE_ARBRE;
  if (REVOQUES.includes(idx)) continue;
  const grant = grants[idx];

  const challenge = AuthorizationServer.challenge(
    "read:accounts", `nonce-${i}-${Date.now()}`, 1900000000);

  // (a) AS/client : assemblage du temoin (chemin Merkle + exclusion SMT)
  const t0 = performance.now();
  const w = await as.witness(grant, challenge);
  const tTemoin = performance.now() - t0;
  m.temoin.push(tTemoin);

  // (b) client : generation de la preuve, processus isole
  fs.writeFileSync(temoinTmp, JSON.stringify(w));
  execFileSync(process.execPath, ["bench/prove-once.mjs", temoinTmp, preuveTmp],
    { stdio: ["ignore", "ignore", "inherit"] });
  const r = JSON.parse(fs.readFileSync(preuveTmp, "utf8"));
  if (!r.valide) throw new Error(`iteration ${i} : preuve invalide hors-chaine`);
  m.preuve.push(r.tempsGenerationMs);
  m.calculTemoin.push(r.tempsCalculTemoinMs);
  m.preuveGroth16.push(r.tempsPreuveGroth16Ms);
  m.verifHorsChaine.push(r.tempsVerificationHorsChaineMs);
  taillePreuveJson = r.taillePreuveJsonOctets;
  const cd = r.calldata;

  // (c) Serveur de Ressource : verification en lecture, sans transaction
  const t3 = performance.now();
  const ok = await registry.verifyAuthorization(
    cd.pA, cd.pB, cd.pC, cd.pubSignals, rsAddress);
  const tVerif = performance.now() - t3;
  if (!ok) throw new Error(`iteration ${i} : preuve rejetee par le contrat`);
  m.verifSurChaine.push(tVerif);
  m.latenceFluxLecture.push(tTemoin + r.tempsGenerationMs + tVerif);

  // (d) gas de la seule verification des couplages BN254
  m.gasVerificationPure.push(Number(
    await probe.probe.staticCall(cd.pA, cd.pB, cd.pC, cd.pubSignals)));

  // (e) autorisation complete : verification + consommation du nullifieur
  const tTx = performance.now();
  const rec = await (await registry.authorize(cd.pA, cd.pB, cd.pC, cd.pubSignals)).wait();
  const tAutorisation = performance.now() - tTx;
  m.gasAutorisation.push(Number(rec.gasUsed));
  m.latenceFluxEcriture.push(tTemoin + r.tempsGenerationMs + tAutorisation);

  if (!tailleCalldata) {
    tailleCalldata = ethers.dataLength(registry.interface.encodeFunctionData(
      "authorize", [cd.pA, cd.pB, cd.pC, cd.pubSignals]));
  }
  effectuees++;
  process.stdout.write(`\r  iteration ${effectuees}/${N}   `);
}
console.log("\n");
fs.rmSync(tmp, { recursive: true, force: true });

// ------------------------------------------------- Rapport
const circuit = JSON.parse(fs.readFileSync("build/circuit-stats.json", "utf8"));
const resultats = {
  horodatage: new Date().toISOString(),
  reseau: network, chainId: dep.chainId, iterations: m.preuve.length,
  machine: { cpu: os.cpus()[0].model, coeurs: os.cpus().length,
             memoireGo: +(os.totalmem() / 1e9).toFixed(1), node: process.version, os: `${os.type()} ${os.release()}` },
  circuit,
  tailles: {
    preuveGroth16Octets: TAILLE_PREUVE,
    preuveSerialiseeJsonOctets: taillePreuveJson,
    signauxPublicsOctets: circuit.signauxPublics * 32,
    calldataAutorisationOctets: tailleCalldata,
  },
  gasDeploiement: Object.fromEntries(
    Object.entries(dep.contrats).map(([k, v]) => [k, Number(v.gasDeploiement)])),
  gasAncrageRacines: Number(rSet.gasUsed),
  temps: {
    emissionJetonAS: stats(tEmission),
    assemblageTemoin: stats(m.temoin),
    generationPreuve: stats(m.preuve),
    calculTemoinWasm: stats(m.calculTemoin),
    preuveGroth16Seule: stats(m.preuveGroth16),
    verificationHorsChaine: stats(m.verifHorsChaine),
    verificationSurChaine: stats(m.verifSurChaine),
    latenceFluxLecture: stats(m.latenceFluxLecture),
    latenceFluxEcriture: stats(m.latenceFluxEcriture),
  },
  gas: {
    verificationPreuveSeule: stats(m.gasVerificationPure),
    autorisationComplete: stats(m.gasAutorisation),
  },
};
fs.mkdirSync("resultats", { recursive: true });
fs.writeFileSync("resultats/bench-zk.json", JSON.stringify(resultats, null, 2));

console.log(ENTETE);
console.log("-".repeat(88));
for (const [k, v] of Object.entries(resultats.temps)) console.log(ligne(k, v));
console.log("-".repeat(88));
for (const [k, v] of Object.entries(resultats.gas)) console.log(ligne(k, v, "gas"));
console.log("-".repeat(88));
console.log(`Circuit : ${circuit.contraintes} contraintes | preuve ${TAILLE_PREUVE} o | ` +
            `calldata ${tailleCalldata} o`);
console.log(`\nEcrit -> resultats/bench-zk.json`);
process.exit(0);
