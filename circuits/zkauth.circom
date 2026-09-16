pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/smt/smtverifier.circom";

/*
 * ZK-OAuthChain -- circuit d'autorisation a divulgation nulle
 * ------------------------------------------------------------
 * Le client prouve, sans reveler ni le jeton, ni le sujet, ni les metadonnees :
 *
 *   C1 (liaison de contexte)   ctx = Poseidon(iss, aud, sub, rs, domain)
 *   C2 (hachage d'engagement)  h   = Poseidon(token, ctx, meta)
 *   C3 (appartenance Merkle)   MerkleVerify(h, root) = vrai
 *   C4 (non-revocation)        h n'appartient pas a l'arbre des revocations revRoot
 *   C5 (anti-rejeu + domaine)  nullifier = Poseidon(h, challenge, domain)
 *
 * C1 repond directement a la vulnerabilite centrale identifiee dans zkLogin
 * (Celi et al., 2026) : l'absence de liaison forte entre l'emetteur, l'audience,
 * le sujet et l'identite du Serveur de Ressource. Ici les quatre composantes sont
 * scellees DANS l'engagement au moment de l'emission, et quatre d'entre elles sont
 * publiques, donc opposables au verificateur. Le sujet (sub) reste prive : il est
 * lie sans etre divulgue.
 *
 * C5 fait apparaitre `domain` dans le nullifieur, conformement a l'exigence de
 * separation de domaine de ZK-ACE (C5.a) : une preuve produite pour un deploiement
 * ne peut etre rejouee sur un autre.
 *
 * Signaux publics : nullifier, root, revRoot, issuerId, clientId,
 *                   resourceServerId, domain, challenge
 * Signaux prives  : token, subject, meta, temoins Merkle et SMT
 */

// Aiguillage conditionnel : ordonne (gauche, droite) selon le bit de chemin.
template DualMux() {
    signal input in[2];
    signal input s;
    signal output out[2];

    s * (1 - s) === 0;                       // s est booleen
    out[0] <== (in[1] - in[0]) * s + in[0];
    out[1] <== (in[0] - in[1]) * s + in[1];
}

// Recalcule la racine Merkle a partir d'une feuille et de son chemin d'authentification.
template MerkleRootFromPath(nLevels) {
    signal input leaf;
    signal input pathElements[nLevels];
    signal input pathIndices[nLevels];
    signal output root;

    component mux[nLevels];
    component hash[nLevels];
    signal cur[nLevels + 1];
    cur[0] <== leaf;

    for (var i = 0; i < nLevels; i++) {
        mux[i] = DualMux();
        mux[i].in[0] <== cur[i];
        mux[i].in[1] <== pathElements[i];
        mux[i].s <== pathIndices[i];

        hash[i] = Poseidon(2);
        hash[i].inputs[0] <== mux[i].out[0];
        hash[i].inputs[1] <== mux[i].out[1];

        cur[i + 1] <== hash[i].out;
    }

    root <== cur[nLevels];
}

template ZKAuth(nLevels, nRevLevels) {
    // --- Entrees publiques
    signal input root;              // racine Merkle des engagements emis
    signal input revRoot;           // racine du SMT des engagements revoques
    signal input issuerId;          // iss : identifiant du Serveur d'Autorisation
    signal input clientId;          // aud : identifiant du client OAuth destinataire
    signal input resourceServerId;  // identite du Serveur de Ressource vise
    signal input domain;            // separateur de domaine (chaine + contrat + version)
    signal input challenge;         // defi de fraicheur : H(portee, alea, expiration)

    // --- Entrees privees (temoin, jamais revele)
    signal input token;             // jeton OAuth 2.0
    signal input subject;           // sub : sujet, lie au contexte mais non divulgue
    signal input meta;              // metadonnees (portee, expiration)
    signal input pathElements[nLevels];
    signal input pathIndices[nLevels];
    signal input revSiblings[nRevLevels];
    signal input revOldKey;
    signal input revOldValue;
    signal input revIsOld0;

    // --- Sortie publique
    signal output nullifier;

    // C1 : contexte d'autorisation -- liaison (iss, aud, sub, rs, domain)
    component context = Poseidon(5);
    context.inputs[0] <== issuerId;
    context.inputs[1] <== clientId;
    context.inputs[2] <== subject;
    context.inputs[3] <== resourceServerId;
    context.inputs[4] <== domain;
    signal ctx;
    ctx <== context.out;

    // C2 : engagement cryptographique, scelle sur le contexte
    component commit = Poseidon(3);
    commit.inputs[0] <== token;
    commit.inputs[1] <== ctx;
    commit.inputs[2] <== meta;
    signal h;
    h <== commit.out;

    // C3 : h appartient a l'arbre des engagements emis
    component mt = MerkleRootFromPath(nLevels);
    mt.leaf <== h;
    for (var i = 0; i < nLevels; i++) {
        mt.pathElements[i] <== pathElements[i];
        mt.pathIndices[i] <== pathIndices[i];
    }
    mt.root === root;

    // C4 : h n'appartient PAS a l'arbre des revocations (preuve d'exclusion, fnc = 1)
    component nonRev = SMTVerifier(nRevLevels);
    nonRev.enabled <== 1;
    nonRev.fnc <== 1;
    nonRev.root <== revRoot;
    for (var i = 0; i < nRevLevels; i++) {
        nonRev.siblings[i] <== revSiblings[i];
    }
    nonRev.oldKey <== revOldKey;
    nonRev.oldValue <== revOldValue;
    nonRev.isOld0 <== revIsOld0;
    nonRev.key <== h;
    nonRev.value <== 0;

    // C5 : nullifieur anti-rejeu, lie au defi ET au domaine
    component nf = Poseidon(3);
    nf.inputs[0] <== h;
    nf.inputs[1] <== challenge;
    nf.inputs[2] <== domain;
    nullifier <== nf.out;
}

component main {
    public [root, revRoot, issuerId, clientId, resourceServerId, domain, challenge]
} = ZKAuth(20, 20);
