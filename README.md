# ZK-OAuthChain — prototype et évaluation expérimentale

Implémentation de référence de l'architecture **ZK-OAuthChain** : autorisation
déléguée décentralisée, confidentielle et formellement vérifiée, fusionnant
OAuth 2.0, blockchain et preuves à connaissance nulle.

Ce dépôt matérialise les six objectifs spécifiques du prototype :

| Objectif | Livrable | Emplacement |
|---|---|---|
| OS1 — contrat d'autorisation Solidity | `ZKAuthRegistry` (enregistrement, vérification, état) | [`contracts/`](contracts/) |
| OS2 — circuit ZKP Circom | hachage Poseidon + appartenance Merkle + non-révocation | [`circuits/zkauth.circom`](circuits/zkauth.circom) |
| OS3 — déploiement testnet Sepolia | scripts et configuration prêts | [`scripts/deploy.mjs`](scripts/deploy.mjs) |
| OS4 — mesures (preuve, gas, taille) | banc d'essai Groth16 | [`bench/`](bench/) |
| OS5 — vérification formelle **exécutée** | Méthode B (ProB) + SMTChecker (CHC/z3) | [`formal/`](formal/) |
| OS6 — comparaison avec OAuth 2.0 | flux OAuth complet + tableaux comparatifs | [`baseline-oauth/`](baseline-oauth/) |

---

## 1. Architecture

Le Serveur d'Autorisation (AS) d'OAuth 2.0 est conservé pour la seule
authentification initiale. L'émission et la validation des jetons passent au
contrat intelligent.

```
Utilisateur ──auth──▶ AS ──engagement h = Poseidon(token, meta)──▶ arbre Merkle
                       │
                       └──setRoots(racine émission, racine révocation)──▶ ZKAuthRegistry
Client ──preuve π (Groth16)──▶ Serveur de Ressource ──verifyAuthorization(π)──▶ ZKAuthRegistry
                                                                                     │
                                              accès accordé ⟺ preuve valide ─────────┘
```

Le circuit prouve, **sans révéler `token`, `sub` ni `meta`** :

| | Contrainte | Énoncé |
|---|---|---|
| **C1** | Liaison de contexte | `ctx = Poseidon(iss, aud, sub, rs, dom)` |
| **C2** | Hachage d'engagement | `h = Poseidon(token, ctx, meta)` |
| **C3** | Appartenance Merkle | `h` figure dans la racine ancrée par l'AS |
| **C4** | Non-révocation | `h ∉ SMT(revRoot)` — preuve d'*exclusion* (`SMTVerifier`, `fnc = 1`) |
| **C5** | Anti-rejeu + domaine | `nullifier = Poseidon(h, challenge, dom)` |

**C1 répond à la vulnérabilité centrale de zkLogin** (Celi et al., 2026) : l'absence
de liaison forte entre émetteur, audience, sujet et partie utilisatrice. Le
quadruplet `(iss, aud, sub, rs)` et le domaine sont scellés dans l'engagement à
l'émission ; quatre des cinq composantes sont publiques, donc opposables au
vérificateur. Le sujet reste privé — lié sans être divulgué — et dérivé dans
l'espace de noms de son émetteur.

Le contrat impose une seconde ligne de défense indépendante de la cryptographie :
il rejette toute preuve dont l'émetteur n'est pas celui déclaré, dont le domaine
n'est pas le sien, ou dont l'identifiant de Serveur de Ressource ne coïncide pas
avec celui enregistré pour l'appelant.

### Invariants de sécurité

| | Énoncé | Statut |
|---|---|---|
| **J0** couplage détenteur | `∀u : commitmentOf[u] ≠ 0 ⇒ holderOf[commitmentOf[u]] = u` | vérifié (ProB) |
| **J1** couplage RP | `∀r : idDuRP(r) défini ⇒ rpDeLId(idDuRP(r)) = r` | vérifié (ProB) |
| **I1** sûreté | `∀u : commitmentOf[u] ≠ 0 ⇒ ¬revoked[commitmentOf[u]]` | vérifié (ProB) ; forme duale prouvée (CHC) |
| **I2** intégrité | `∀n : grantedEpoch[n] ≠ 0 ⇒ nullifierUsed[n]` | **prouvé** (CHC) et vérifié (ProB) |
| **I2b** fraîcheur | `∀n : grantedEpoch[n] ≠ 0 ⇒ epoch ≠ 0` | **prouvé** (CHC) et vérifié (ProB) |
| **I3** liaison d'audience | `∀n : grantedEpoch[n] ≠ 0 ⇒ grantedRsId[n] ≠ 0` | **prouvé** (CHC) et vérifié (ProB) |

Quatre propriétés de sécurité sont en outre définies par jeux d'adversaire dans
l'article : confidentialité de l'autorisation, solidité de l'autorisation,
résistance au rejeu et non-substitution d'audience.

---

## 2. Prérequis

- **Node.js ≥ 20** et npm
- **Python 3** (utilisé par `npm run bootstrap` pour décompresser les archives)
- **WSL** (distribution Ubuntu) pour le SMTChecker : le binaire Windows de
  `solc` est compilé sans z3, le binaire Linux statique le charge dynamiquement.

Aucune installation système n'est requise : `npm run bootstrap` place tous les
outils externes dans `tools/`.

## 3. Installation

```bash
npm install
```

```bash
npm run bootstrap
```

`bootstrap` télécharge dans `tools/` (non versionné) : `circom` 2.2.2, ProB 1.16.1
et son parseur B, un JRE Temurin 21, le `solc` 0.8.28 statique Linux et `libz3`
4.12.6. Le script est idempotent : il ne retélécharge rien de déjà présent.

## 4. Chaîne complète

```bash
npm run circuit:build
```

Compile le circuit, exécute les Powers of Tau, la phase 2 Groth16, exporte la
clé de vérification et **génère `contracts/Groth16Verifier.sol`**.

> **Setup de confiance.** Les miroirs publics de la cérémonie Hermez
> (`storage.googleapis.com/zkevm`, `hermez.s3-eu-west-1.amazonaws.com`) renvoient
> aujourd'hui HTTP 403. Le script les tente d'abord puis, à défaut, effectue une
> cérémonie locale à contributeur unique. `build/ptau-origine.json` consigne
> laquelle a été utilisée. Un setup local convient à un prototype, **pas à la
> production** : c'est une limite documentée en discussion.

```bash
npm run compile        # contrats Solidity
npm test               # suite de tests on-chain (14 tests)
```

## 5. Déploiement

### Réseau local

```bash
npx hardhat node       # dans un terminal dédié
npm run deploy:local
```

### Testnet Sepolia

```bash
cp .env.example .env
```

Renseignez **vous-même** dans `.env` :

- `SEPOLIA_RPC_URL` — point d'accès Alchemy, Infura ou nœud public ;
- `DEPLOYER_PRIVATE_KEY` — clé privée d'un compte **de test uniquement**,
  alimenté par un faucet Sepolia (≈ 0,05 ETH suffisent).

`.env` est exclu par `.gitignore` — ne le versionnez jamais.

```bash
npm run deploy:sepolia
```

Le script écrit `deployments/sepolia.json` (adresses, hachages de transaction,
gas de déploiement) et affiche le lien Etherscan.

## 6. Vérification formelle

```bash
npm run verify
```

Exécute successivement :

- **ProB 1.16.1** (Méthode B, Abrial 1996) sur trois machines B —
  [`formal/b/ZKAuthRegistry_v0.mch`](formal/b/ZKAuthRegistry_v0.mch), transcription
  du pseudo-code initial (ProB y trouve un contre-exemple),
  [`formal/b/ZKAuthRegistry.mch`](formal/b/ZKAuthRegistry.mch), modèle du contrat
  déployé, et [`formal/b/ZKAuthBinding.mch`](formal/b/ZKAuthBinding.mch), dédié à
  la liaison d'audience ;
- **SMTChecker de solc 0.8.28** (moteur CHC sur clauses de Horn, solveur z3 4.12.6)
  directement sur le Solidity des harnais [`formal/smtchecker/`](formal/smtchecker/).

Résultats dans `resultats/verification-formelle.{json,log}`.

## 7. Mesures

```bash
npm run bench:zk       # 40 autorisations sur le réseau local
npm run bench:oauth    # 200 flux OAuth 2.0 de référence
npm run bench:compare  # tableaux Markdown + CSV
```

`bench:compare` produit aussi le tableau de positionnement face à l'état de l'art
2025-2026 (zkAt, ZK-ACE, cadres zk-STARK et zk-SNARK). Les chiffres de la
littérature, avec leur provenance exacte (publication, tableau, page), sont
consignés dans [`docs/etat-de-lart.json`](docs/etat-de-lart.json) ; toute valeur
non rapportée par les auteurs y est marquée comme telle plutôt qu'estimée.

Sur Sepolia, réduisez les itérations — chaque autorisation est une transaction
réelle :

```bash
node bench/bench-zk.mjs sepolia 5
```

**Méthodologie.** Chaque preuve est générée dans un **processus neuf**
([`bench/prove-once.mjs`](bench/prove-once.mjs)). snarkjs ne libère pas ses pools
de threads entre deux appels : mesurées en boucle dans un même processus, les
générations successives se dégradent d'un facteur 4 et la mesure perd tout sens.

Sorties : `resultats/bench-zk.json`, `resultats/bench-oauth.json`,
`resultats/comparaison.md`, `resultats/mesures.csv`.

## 8. Structure

```
circuits/zkauth.circom          circuit ZKP (Poseidon, Merkle, exclusion SMT, nullifieur)
contracts/ZKAuthRegistry.sol    contrat d'autorisation
contracts/Groth16Verifier.sol   vérificateur généré par snarkjs
contracts/GasProbe.sol          sonde isolant le gas de la seule vérification
lib/zkoauth.mjs                 bibliothèque AS + client (arbres, témoins, preuves)
baseline-oauth/server.mjs       AS + RS OAuth 2.0 (PKCE, introspection, JWT)
formal/b/                       machines B et exécution ProB
formal/smtchecker/              harnais de preuve Solidity
bench/                          bancs d'essai et agrégation
scripts/                        outils, construction du circuit, déploiement
test/                           suite de tests on-chain
docs/etat-de-lart.json          chiffres de la littérature et leur provenance
docs/build-article.cjs          génération de l'article à partir des mesures
```

## 9. Limites connues

- **Setup de confiance Groth16.** Cérémonie locale à contributeur unique en
  l'absence de miroir public ; une cérémonie multipartite est requise en production.
- **L'AS voit le jeton.** Il l'émet et calcule l'engagement. La confidentialité
  obtenue porte sur la chaîne et sur le Serveur de Ressource, pas vis-à-vis de l'AS.
- **Latence de génération de preuve.** ≈ 1,7 s côté client, soit 95 % de la
  latence totale du flux. À taille de circuit quasi identique, zkAt mesure 51 ms
  avec un prouveur natif (Go/gnark) : l'écart relève de l'outillage — snarkjs
  s'exécute en WebAssembly — et non de la conception du protocole. Porter le
  prouveur en natif est l'optimisation au meilleur rapport coût-bénéfice.
- **Portée de la vérification.** Les invariants sont établis sur le modèle B et
  sur les harnais Solidity, non sur le bytecode déployé. Deux obligations
  restent indéterminées pour le moteur CHC (déréférencement imbriqué de
  dictionnaires) et sont couvertes par le model-checking exhaustif ProB.
