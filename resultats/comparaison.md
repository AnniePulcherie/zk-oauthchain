# ZK-OAuthChain -- resultats experimentaux

Genere le 2026-09-16T07:26:53.923Z.

**Environnement.** 13th Gen Intel(R) Core(TM) i5-13420H, 12 coeurs, 16.8 Go, Windows_NT 10.0.26200, Node v24.15.0. Chaine : localhost (chainId 31337). 40 autorisations mesurees ; 200 flux OAuth 2.0 mesures.

## Tableau 1 -- Circuit ZKP compile (Circom 2.2.2 / Groth16, courbe BN254)

| Grandeur | Valeur |
|---|---|
| Contraintes R1CS | 25 383 |
| Variables | 25 428 |
| Signaux publics | 8 (nullifieur, racines d'emission et de revocation, iss, aud, rs, domaine, defi) |
| Puissance Powers of Tau | 2^15 |
| Cle de preuve (zkey) | 11,4 Mo |
| Temoin WebAssembly | 3,1 Mo |
| **Taille de preuve Groth16** | **256 octets** (2 x G1 + 1 x G2) |
| Signaux publics serialises | 256 octets |
| Calldata d'autorisation | 516 octets |

## Tableau 2 -- Temps mesures (ms, 40 iterations)

| Etape | Moyenne | Ecart-type | Mediane | p95 |
|---|---:|---:|---:|---:|
| Emission du jeton + engagement (AS) | 0,57 | 0,63 | 0,45 | 0,80 |
| Assemblage du temoin (Merkle + exclusion SMT) | 47,17 | 5,18 | 46,32 | 54,56 |
| **Generation de la preuve Groth16 (client)** | 1 749,33 | 264,67 | 1 652,87 | 2 079,95 |
| Verification hors-chaine (snarkjs) | 38,22 | 28,27 | 26,96 | 100,29 |
| **Verification sur-chaine (appel en lecture)** | 43,80 | 11,95 | 41,03 | 57,13 |
| **Latence totale du flux (validation en lecture)** | 1 840,31 | 271,25 | 1 738,22 | 2 237,47 |
| Latence totale du flux (avec transaction on-chain) | 2 045,86 | 276,17 | 1 951,80 | 2 383,85 |

## Tableau 3 -- Cout en gas (EVM, solc 0.8.28, optimiseur runs=200)

| Operation | Gas | Remarque |
|---|---:|---|
| Deploiement du verificateur Groth16 | 486 118 | une seule fois |
| Deploiement de ZKAuthRegistry | 912 338 | une seule fois |
| Ancrage des racines par l'AS (setRoots) | 41 321 | par epoque, amorti sur tous les jetons |
| **Verification de la preuve seule** | **238 785** | couplages BN254, cout constant |
| **Autorisation complete (authorize)** | **348 917** | verification + nullifieur + evenement |
| Surcout d'etat (authorize - verification) | 110 132 | ecritures de stockage + journal |

Le cout de verification est **independant du nombre de jetons emis** : c'est la
propriete de taille constante de Groth16. Une autorisation coute 348 917 gas, soit 0,00698 ETH a 20 gwei.

## Tableau 4 -- Comparaison avec OAuth 2.0 : latence totale du flux d'autorisation

| Architecture | Validation | Latence moyenne | Mediane | p95 | Rapport |
|---|---|---:|---:|---:|---:|
| OAuth 2.0 | jeton opaque + introspection RFC 7662 | 4,81 ms | 4,00 ms | 7,57 ms | 1,00x |
| OAuth 2.0 | JWT RS256 auto-porteur | 3,58 ms | 3,33 ms | 6,08 ms | 0,74x |
| ZK-OAuthChain | preuve ZK + verification en lecture | 1 840,31 ms | 1 738,22 ms | 2 237,47 ms | 382,7x |
| ZK-OAuthChain | preuve ZK + consommation on-chain | 2 045,86 ms | 1 951,80 ms | 2 383,85 ms | 425,4x |

**Decomposition.** La generation de la preuve represente 95,1 % de la latence totale de ZK-OAuthChain. Isolee, l'etape de *verification* coute 43,80 ms contre 2,10 ms pour une introspection OAuth (rapport 20,9x), soit environ 18 fois moins que le rapport observe sur le flux complet.

Les deux architectures sont mesurees sur boucle locale : aucune latence de reseau
etendu n'est incluse, de part et d'autre.

## Tableau 5 -- Positionnement face a l'etat de l'art 2025-2026

| Travail | Systeme (setup) | Outillage | Contraintes | Preuve | Verification | Taille preuve | Gas verif. |
|---|---|---|---:|---:|---:|---:|---:|
| zkAt (Groth16) | Groth16 — setup par circuit | Go / gnark (natif) | 24 564 | 50,97 ms | 0,89 ms | 256 o* | n. r. |
| ZK-ACE (Groth16) | Groth16 — setup par circuit | Rust / arkworks (natif, mono-fil) | 4 024 | 63,00 ms | 0,65 ms | 256 o* | n. r. |
| Cadre DID/VC (zk-STARK) | zk-STARK — transparent, aucun setup | Cairo / chaine StarkWare | n. r. | 3,50 s | 5,00 ms | 45 Ko | 280 000 |
| LinkDID (zk-SNARK) | zk-SNARK — setup requis | non precise | n. r. | 5,00 s | 3,00 ms | 1 Ko | 210 000 |
| **ZK-OAuthChain (ce travail)** | **Groth16 -- setup par circuit** | **JS / snarkjs (WebAssembly)** | **25 383** | **1,53 s** | **26,96 ms** | **256 o** | **238 785** |

`n. r.` : non rapporte par les auteurs. `*` : taille non rapportee, valeur structurelle
de Groth16 sur BN254. Les temps de preuve et de verification sont les medianes ;
ceux de ce travail sont mesures hors-chaine, comme ceux des travaux compares.

**Lecture du tableau.** Les materiels et les outillages different : toute comparaison
directe des temps absolus serait trompeuse. Trois observations resistent neanmoins :

1. **A taille de circuit quasi identique, l'ecart est imputable a l'outillage.** zkAt compte 24 564 contraintes contre 25 383 ici, soit une difference de 3 %. Le rapport des temps de preuve est pourtant de 30x (1,53 s contre 50,97 ms). Cet ecart mesure la distance entre un prouveur natif (Go/gnark) et un prouveur
   WebAssembly (snarkjs), non une difference de conception du protocole.

2. **Le cout on-chain se situe dans la fourchette de l'etat de l'art.** La verification
   d'une preuve coute ici 238 785 gas, contre 210 000 pour LinkDID (zk-SNARK) et 280 000 pour le cadre zk-STARK. L'ancrage des racines coute 41 321 gas, contre 45 000 pour la mise a jour de l'accumulateur de revocation du cadre zk-STARK.

3. **La taille de preuve reste l'avantage decisif de Groth16.** 256 octets contre 45 Ko pour zk-STARK, soit un facteur 180, au prix d'un setup de confiance specifique au circuit.

ZK-ACE (4 024 contraintes, 63,00 ms) n'est pas directement comparable : son circuit ne comporte ni appartenance Merkle
ni preuve d'exclusion, d'ou un facteur 6,3 sur le nombre de contraintes.

## Tableau 6 -- Verification formelle : resultats obtenus

| Outil | Objet | Resultat |
|---|---|---|
| ProB 1.16.1 (Methode B) | modele naif (pseudo-code Section 3.4.b) | **contre-exemple trouve** en 4 etapes : `!u.(u : dom(commitments) => commitments(u) /: revoked)` |
| ProB 1.16.1 (Methode B) | modele durci (contrat deploye) | **aucun contre-exemple**, 8 600 etats et 48 379 transitions entierement explores (7000 ms) |
| SMTChecker CHC + z3 | `commitmentOf[u] == 0 || holderOf[commitmentOf[u]] == u` | indetermine (limite de l'outil) |
| SMTChecker CHC + z3 | `commitmentOf[u] == 0 || !revoked[commitmentOf[u]]` | indetermine (limite de l'outil) |
| SMTChecker CHC + z3 | `holderOf[c] == address(0) || !revoked[c]` | **prouve sur** |
| SMTChecker CHC + z3 | `grantedEpoch[n] == 0 || nullifierUsed[n]` | **prouve sur** |
| SMTChecker CHC + z3 | `grantedEpoch[n] == 0 || epoch != 0` | **prouve sur** |
| SMTChecker CHC + z3 | `grantedEpoch[n] == 0 || grantedRsId[n] != 0` | **prouve sur** |

**Contre-exemple ProB sur le modele naif** (aliasing d'engagement) :

```
  INITIALISATION(commitments={},epoch=0,granted={},revoked={},used={})
  registerCommitment(u1,c1)
  registerCommitment(u3,c1)
  revokeCommitment(u3)
```
