/**
 * Agrege les mesures ZK-OAuthChain et OAuth 2.0 et produit les tableaux
 * de la Section 6 (evaluation experimentale) : Markdown + CSV.
 */
import fs from "node:fs";

const zk = JSON.parse(fs.readFileSync("resultats/bench-zk.json", "utf8"));
const oa = JSON.parse(fs.readFileSync("resultats/bench-oauth.json", "utf8"));
const sota = JSON.parse(fs.readFileSync("docs/etat-de-lart.json", "utf8"));
const vf = fs.existsSync("resultats/verification-formelle.json")
  ? JSON.parse(fs.readFileSync("resultats/verification-formelle.json", "utf8"))
  : null;

const f = (x, d = 2) =>
  Number(x).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const g = (x) => Number(x).toLocaleString("fr-FR", { maximumFractionDigits: 0 });
const TICK = String.fromCharCode(96);
const code = (s) => TICK + s + TICK;

const L = [];
const push = (...s) => L.push(...s);

push("# ZK-OAuthChain -- resultats experimentaux", "");
push("Genere le " + new Date().toISOString() + ".", "");
push("**Environnement.** " + zk.machine.cpu + ", " + zk.machine.coeurs + " coeurs, " +
     zk.machine.memoireGo + " Go, " + zk.machine.os + ", Node " + zk.machine.node +
     ". Chaine : " + zk.reseau + " (chainId " + zk.chainId + "). " +
     zk.iterations + " autorisations mesurees ; " + oa.iterations + " flux OAuth 2.0 mesures.", "");

// -------------------------------------------------- Tableau 1 : circuit
push("## Tableau 1 -- Circuit ZKP compile (Circom 2.2.2 / Groth16, courbe BN254)", "");
push("| Grandeur | Valeur |", "|---|---|");
push("| Contraintes R1CS | " + g(zk.circuit.contraintes) + " |");
push("| Variables | " + g(zk.circuit.variables) + " |");
push("| Signaux publics | " + zk.circuit.signauxPublics +
     " (nullifieur, racines d'emission et de revocation, iss, aud, rs, domaine, defi) |");
push("| Puissance Powers of Tau | 2^" + zk.circuit.ptauPower + " |");
push("| Cle de preuve (zkey) | " + f(zk.circuit.tailleZkeyOctets / 1e6, 1) + " Mo |");
push("| Temoin WebAssembly | " + f(zk.circuit.tailleWasmOctets / 1e6, 1) + " Mo |");
push("| **Taille de preuve Groth16** | **" + zk.tailles.preuveGroth16Octets +
     " octets** (2 x G1 + 1 x G2) |");
push("| Signaux publics serialises | " + zk.tailles.signauxPublicsOctets + " octets |");
push("| Calldata d'autorisation | " + zk.tailles.calldataAutorisationOctets + " octets |", "");

// -------------------------------------------------- Tableau 2 : temps
push("## Tableau 2 -- Temps mesures (ms, " + zk.iterations + " iterations)", "");
push("| Etape | Moyenne | Ecart-type | Mediane | p95 |", "|---|---:|---:|---:|---:|");
const libelles = {
  emissionJetonAS: "Emission du jeton + engagement (AS)",
  assemblageTemoin: "Assemblage du temoin (Merkle + exclusion SMT)",
  generationPreuve: "**Generation de la preuve Groth16 (client)**",
  verificationHorsChaine: "Verification hors-chaine (snarkjs)",
  verificationSurChaine: "**Verification sur-chaine (appel en lecture)**",
  latenceFluxLecture: "**Latence totale du flux (validation en lecture)**",
  latenceFluxEcriture: "Latence totale du flux (avec transaction on-chain)",
};
for (const [k, lab] of Object.entries(libelles)) {
  const s = zk.temps[k];
  push("| " + lab + " | " + f(s.moyenne) + " | " + f(s.ecartType) + " | " +
       f(s.mediane) + " | " + f(s.p95) + " |");
}
push("");

// -------------------------------------------------- Tableau 3 : gas
const gasVerif = zk.gas.verificationPreuveSeule.moyenne;
const gasAuth = zk.gas.autorisationComplete.moyenne;
push("## Tableau 3 -- Cout en gas (EVM, solc 0.8.28, optimiseur runs=200)", "");
push("| Operation | Gas | Remarque |", "|---|---:|---|");
push("| Deploiement du verificateur Groth16 | " + g(zk.gasDeploiement.Groth16Verifier) +
     " | une seule fois |");
push("| Deploiement de ZKAuthRegistry | " + g(zk.gasDeploiement.ZKAuthRegistry) +
     " | une seule fois |");
push("| Ancrage des racines par l'AS (setRoots) | " + g(zk.gasAncrageRacines) +
     " | par epoque, amorti sur tous les jetons |");
push("| **Verification de la preuve seule** | **" + g(gasVerif) +
     "** | couplages BN254, cout constant |");
push("| **Autorisation complete (authorize)** | **" + g(gasAuth) +
     "** | verification + nullifieur + evenement |");
push("| Surcout d'etat (authorize - verification) | " + g(gasAuth - gasVerif) +
     " | ecritures de stockage + journal |", "");
push("Le cout de verification est **independant du nombre de jetons emis** : c'est la");
push("propriete de taille constante de Groth16. Une autorisation coute " + g(gasAuth) +
     " gas, soit " + f(gasAuth * 20 / 1e9, 5) + " ETH a 20 gwei.", "");

// -------------------------------------------------- Tableau 4 : comparaison
const zkLect = zk.temps.latenceFluxLecture;
const zkEcr = zk.temps.latenceFluxEcriture;
const oaIntro = oa.temps.fluxTotalIntrospection;
const oaJwt = oa.temps.fluxTotalJwt;
push("## Tableau 4 -- Comparaison avec OAuth 2.0 : latence totale du flux d'autorisation", "");
push("| Architecture | Validation | Latence moyenne | Mediane | p95 | Rapport |",
     "|---|---|---:|---:|---:|---:|");
push("| OAuth 2.0 | jeton opaque + introspection RFC 7662 | " + f(oaIntro.moyenne) + " ms | " +
     f(oaIntro.mediane) + " ms | " + f(oaIntro.p95) + " ms | 1,00x |");
push("| OAuth 2.0 | JWT RS256 auto-porteur | " + f(oaJwt.moyenne) + " ms | " +
     f(oaJwt.mediane) + " ms | " + f(oaJwt.p95) + " ms | " +
     f(oaJwt.moyenne / oaIntro.moyenne) + "x |");
push("| ZK-OAuthChain | preuve ZK + verification en lecture | " + f(zkLect.moyenne) + " ms | " +
     f(zkLect.mediane) + " ms | " + f(zkLect.p95) + " ms | " +
     f(zkLect.moyenne / oaIntro.moyenne, 1) + "x |");
push("| ZK-OAuthChain | preuve ZK + consommation on-chain | " + f(zkEcr.moyenne) + " ms | " +
     f(zkEcr.mediane) + " ms | " + f(zkEcr.p95) + " ms | " +
     f(zkEcr.moyenne / oaIntro.moyenne, 1) + "x |", "");
push("**Decomposition.** La generation de la preuve represente " +
     f(100 * zk.temps.generationPreuve.moyenne / zkLect.moyenne, 1) +
     " % de la latence totale de ZK-OAuthChain. Isolee, l'etape de *verification* coute " +
     f(zk.temps.verificationSurChaine.moyenne) + " ms contre " +
     f(oa.temps.ressourceIntrospection.moyenne) + " ms pour une introspection OAuth (rapport " +
     f(zk.temps.verificationSurChaine.moyenne / oa.temps.ressourceIntrospection.moyenne, 1) +
     "x), soit environ " + f(zkLect.moyenne / oaIntro.moyenne /
     (zk.temps.verificationSurChaine.moyenne / oa.temps.ressourceIntrospection.moyenne), 0) +
     " fois moins que le rapport observe sur le flux complet.", "");
push("Les deux architectures sont mesurees sur boucle locale : aucune latence de reseau");
push("etendu n'est incluse, de part et d'autre.", "");

// ------------------------------- Tableau 5 : positionnement face a l'etat de l'art
const ko = (o) => o == null ? "n. r." : (o >= 1024 ? f(o / 1024, 0) + " Ko" : o + " o");
const ms = (x) => x == null ? "n. r." : (x >= 1000 ? f(x / 1000, 2) + " s" : f(x, 2) + " ms");

push("## Tableau 5 -- Positionnement face a l'etat de l'art 2025-2026", "");
push("| Travail | Systeme (setup) | Outillage | Contraintes | Preuve | Verification | Taille preuve | Gas verif. |",
     "|---|---|---|---:|---:|---:|---:|---:|");
for (const t of sota.travaux) {
  push("| " + t.nom + " | " + t.setupDeConfiance + " | " + t.outillage + " | " +
       (t.contraintes == null ? "n. r." : g(t.contraintes)) + " | " + ms(t.preuveMs) + " | " +
       ms(t.verificationMs) + " | " + ko(t.taillePreuveOctets) +
       (t.taillePreuveRapportee ? "" : "*") + " | " +
       (t.gasVerification == null ? "n. r." : g(t.gasVerification)) + " |");
}
push("| **ZK-OAuthChain (ce travail)** | **Groth16 -- setup par circuit** | " +
     "**JS / snarkjs (WebAssembly)** | **" +
     g(zk.circuit.contraintes) + "** | **" + ms(zk.temps.preuveGroth16Seule.mediane) + "** | **" +
     ms(zk.temps.verificationHorsChaine.mediane) + "** | **" + ko(zk.tailles.preuveGroth16Octets) +
     "** | **" + g(zk.gas.verificationPreuveSeule.moyenne) + "** |", "");
push("`n. r.` : non rapporte par les auteurs. `*` : taille non rapportee, valeur structurelle",
     "de Groth16 sur BN254. Les temps de preuve et de verification sont les medianes ;",
     "ceux de ce travail sont mesures hors-chaine, comme ceux des travaux compares.", "");

const zkat = sota.travaux.find((t) => t.cle === "zkAt");
const zkace = sota.travaux.find((t) => t.cle === "zkace");
const stark = sota.travaux.find((t) => t.cle === "stark");
const linkdid = sota.travaux.find((t) => t.cle === "linkdid");

push("**Lecture du tableau.** Les materiels et les outillages different : toute comparaison",
     "directe des temps absolus serait trompeuse. Trois observations resistent neanmoins :", "");
push("1. **A taille de circuit quasi identique, l'ecart est imputable a l'outillage.** zkAt compte " +
     g(zkat.contraintes) + " contraintes contre " + g(zk.circuit.contraintes) +
     " ici, soit une difference de " +
     f(100 * Math.abs(zk.circuit.contraintes - zkat.contraintes) / zkat.contraintes, 0) +
     " %. Le rapport des temps de preuve est pourtant de " +
     f(zk.temps.preuveGroth16Seule.mediane / zkat.preuveMs, 0) +
     "x (" + ms(zk.temps.preuveGroth16Seule.mediane) + " contre " + ms(zkat.preuveMs) +
     "). Cet ecart mesure la distance entre un prouveur natif (Go/gnark) et un prouveur",
     "   WebAssembly (snarkjs), non une difference de conception du protocole.", "");
push("2. **Le cout on-chain se situe dans la fourchette de l'etat de l'art.** La verification",
     "   d'une preuve coute ici " + g(zk.gas.verificationPreuveSeule.moyenne) +
     " gas, contre " + g(linkdid.gasVerification) + " pour LinkDID (zk-SNARK) et " +
     g(stark.gasVerification) + " pour le cadre zk-STARK. L'ancrage des racines coute " +
     g(zk.gasAncrageRacines) + " gas, contre " + g(stark.gasAncrageRacines) +
     " pour la mise a jour de l'accumulateur de revocation du cadre zk-STARK.", "");
push("3. **La taille de preuve reste l'avantage decisif de Groth16.** " +
     zk.tailles.preuveGroth16Octets + " octets contre " + ko(stark.taillePreuveOctets) +
     " pour zk-STARK, soit un facteur " +
     g(stark.taillePreuveOctets / zk.tailles.preuveGroth16Octets) +
     ", au prix d'un setup de confiance specifique au circuit.", "");
push("ZK-ACE (" + g(zkace.contraintes) + " contraintes, " + ms(zkace.preuveMs) +
     ") n'est pas directement comparable : son circuit ne comporte ni appartenance Merkle",
     "ni preuve d'exclusion, d'ou un facteur " +
     f(zk.circuit.contraintes / zkace.contraintes, 1) + " sur le nombre de contraintes.", "");

// -------------------------------------------------- Tableau 5 : verification formelle
if (vf) {
  push("## Tableau 6 -- Verification formelle : resultats obtenus", "");
  push("| Outil | Objet | Resultat |", "|---|---|---|");
  const mb = vf.methodeB;
  const nEtapes = mb.modeleNaif.contreExemple ? mb.modeleNaif.contreExemple.length : "?";
  push("| ProB 1.16.1 (Methode B) | modele naif (pseudo-code Section 3.4.b) | " +
       "**contre-exemple trouve** en " + nEtapes + " etapes : " +
       code(mb.modeleNaif.invariantViole) + " |");
  push("| ProB 1.16.1 (Methode B) | modele durci (contrat deploye) | " +
       "**aucun contre-exemple**, " + g(mb.modeleDurci.etatsAnalyses) + " etats et " +
       g(mb.modeleDurci.transitionsFranchies) + " transitions entierement explores (" +
       mb.modeleDurci.tempsMs + " ms) |");
  const etiquette = {
    "prouve-sur": "**prouve sur**",
    "viole": "**viole**",
    "indetermine": "indetermine (limite de l'outil)",
  };
  for (const v of Object.values(vf.smtChecker)) {
    for (const o of v.obligations) {
      push("| SMTChecker CHC + z3 | " + code(o.assertion) + " | " + etiquette[o.statut] + " |");
    }
  }
  push("");
  if (mb.modeleNaif.contreExemple) {
    push("**Contre-exemple ProB sur le modele naif** (aliasing d'engagement) :", "", "```");
    for (const t of mb.modeleNaif.contreExemple) push("  " + t);
    push("```", "");
  }
}

fs.writeFileSync("resultats/comparaison.md", L.join("\n"));

// -------------------------------------------------- CSV
const csv = ["mesure;unite;moyenne;ecart_type;mediane;p95"];
for (const [k, v] of Object.entries(zk.temps)) {
  csv.push("zk_" + k + ";ms;" + v.moyenne + ";" + v.ecartType + ";" + v.mediane + ";" + v.p95);
}
for (const [k, v] of Object.entries(zk.gas)) {
  csv.push("zk_" + k + ";gas;" + v.moyenne + ";" + v.ecartType + ";" + v.mediane + ";" + v.p95);
}
for (const [k, v] of Object.entries(oa.temps)) {
  csv.push("oauth_" + k + ";ms;" + v.moyenne + ";" + v.ecartType + ";" + v.mediane + ";" + v.p95);
}
fs.writeFileSync("resultats/mesures.csv", csv.join("\n"));

console.log(L.join("\n"));
console.log("\n\nEcrit -> resultats/comparaison.md et resultats/mesures.csv");
