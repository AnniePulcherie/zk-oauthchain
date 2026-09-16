/**
 * Genere l'article ZK-OAuthChain revise (DOCX) a partir des resultats mesures.
 * Les chiffres sont lus dans resultats/*.json et docs/etat-de-lart.json : le
 * document ne peut pas diverger des mesures effectivement obtenues.
 *
 * Usage : node docs/build-article.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  LevelFormat, PageBreak, Footer, PageNumber,
} = require("docx");

const R = (f) => JSON.parse(fs.readFileSync(path.join("resultats", f), "utf8"));
const zk = R("bench-zk.json");
const oa = R("bench-oauth.json");
const vf = R("verification-formelle.json");
const sota = JSON.parse(fs.readFileSync("docs/etat-de-lart.json", "utf8"));
const dep = JSON.parse(fs.readFileSync("deployments/localhost.json", "utf8"));

// ----------------------------------------------------------- mise en forme
const n = (x, d = 2) =>
  Number(x).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const e = (x) => Number(x).toLocaleString("fr-FR", { maximumFractionDigits: 0 });
const ms = (x) => x == null ? "n. r." : (x >= 1000 ? n(x / 1000, 2) + " s" : n(x) + " ms");
const ko = (o) => o == null ? "n. r." : (o >= 1024 ? n(o / 1024, 0) + " Ko" : o + " o");

const FONT = "Cambria";
const TABLE_W = 9070;

function P(text, opts = {}) {
  const { bold, italics, align, size = 21, spacingAfter = 120, spacingBefore = 0, indent } = opts;
  return new Paragraph({
    alignment: align || AlignmentType.JUSTIFIED,
    spacing: { after: spacingAfter, before: spacingBefore, line: 276 },
    indent,
    children: [new TextRun({ text, bold, italics, size, font: FONT })],
  });
}

/** Paragraphe a fragments multiples : [["texte", {bold:true}], ...] */
function PR(fragments, opts = {}) {
  const { align, spacingAfter = 120, spacingBefore = 0 } = opts;
  return new Paragraph({
    alignment: align || AlignmentType.JUSTIFIED,
    spacing: { after: spacingAfter, before: spacingBefore, line: 276 },
    children: fragments.map(([t, o = {}]) =>
      new TextRun({ text: t, size: 21, font: o.mono ? "Consolas" : FONT, ...o })),
  });
}

function H(text, level) {
  const sizes = { 1: 28, 2: 24, 3: 22 };
  return new Paragraph({
    heading: level === 1 ? HeadingLevel.HEADING_1
           : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
    spacing: { before: level === 1 ? 360 : 240, after: 140 },
    children: [new TextRun({ text, bold: true, size: sizes[level], font: FONT, color: "1A1A1A" })],
  });
}

function Puce(text) {
  return new Paragraph({
    numbering: { reference: "puces", level: 0 },
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 80, line: 276 },
    children: [new TextRun({ text, size: 21, font: FONT })],
  });
}

function Num(text) {
  return new Paragraph({
    numbering: { reference: "numeros", level: 0 },
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 80, line: 276 },
    children: [new TextRun({ text, size: 21, font: FONT })],
  });
}

function Mono(lignes) {
  return lignes.map((l, i) => new Paragraph({
    spacing: { after: i === lignes.length - 1 ? 160 : 0, before: i === 0 ? 60 : 0 },
    indent: { left: 340 },
    children: [new TextRun({ text: l, size: 17, font: "Consolas" })],
  }));
}

function Legende(text) {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text, bold: true, size: 19, font: FONT })],
  });
}

function Note(text) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 220, before: 40 },
    children: [new TextRun({ text, size: 18, italics: true, font: FONT, color: "444444" })],
  });
}

/** Encadre une definition ou un enonce, avec une barre laterale. */
function Encadre(titre, lignes) {
  const out = [new Paragraph({
    spacing: { before: 200, after: 60 },
    border: { left: { style: BorderStyle.SINGLE, size: 12, color: "6A7B8C", space: 8 } },
    indent: { left: 180 },
    children: [new TextRun({ text: titre, bold: true, size: 20, font: FONT })],
  })];
  lignes.forEach((l, i) => out.push(new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: i === lignes.length - 1 ? 200 : 60, line: 264 },
    border: { left: { style: BorderStyle.SINGLE, size: 12, color: "6A7B8C", space: 8 } },
    indent: { left: 180 },
    children: [new TextRun({ text: l, size: 20, font: FONT })],
  })));
  return out;
}

/**
 * Tableau : entetes + lignes. `poids` donne la repartition relative des colonnes.
 * Une cellule peut etre "texte" ou { t: "texte", b: true } (gras).
 */
function Tableau(entetes, lignes, poids, aligns = []) {
  const total = poids.reduce((a, b) => a + b, 0);
  const widths = poids.map((p) => Math.round((p / total) * TABLE_W));
  widths[widths.length - 1] = TABLE_W - widths.slice(0, -1).reduce((a, b) => a + b, 0);

  const cell = (contenu, i, entete) => {
    const o = typeof contenu === "object" ? contenu : { t: contenu };
    return new TableCell({
      width: { size: widths[i], type: WidthType.DXA },
      margins: { top: 70, bottom: 70, left: 110, right: 110 },
      shading: entete
        ? { type: ShadingType.CLEAR, fill: "E8EDF3", color: "auto" }
        : { type: ShadingType.CLEAR, fill: "FFFFFF", color: "auto" },
      children: [new Paragraph({
        alignment: aligns[i] === "r" ? AlignmentType.RIGHT
                 : aligns[i] === "c" ? AlignmentType.CENTER : AlignmentType.LEFT,
        spacing: { after: 0, line: 240 },
        children: [new TextRun({ text: o.t, bold: entete || o.b, size: 17, font: FONT })],
      })],
    });
  };

  const bord = { style: BorderStyle.SINGLE, size: 3, color: "AAB4C0" };
  return new Table({
    columnWidths: widths,
    width: { size: TABLE_W, type: WidthType.DXA },
    borders: { top: bord, bottom: bord, left: bord, right: bord,
               insideHorizontal: bord, insideVertical: bord },
    rows: [
      new TableRow({ tableHeader: true, children: entetes.map((c, i) => cell(c, i, true)) }),
      ...lignes.map((l) => new TableRow({ children: l.map((c, i) => cell(c, i, false)) })),
    ],
  });
}

// ----------------------------------------------------------- chiffres cles
const T = zk.temps, G = zk.gas, O = oa.temps;
const ratioLecture = T.latenceFluxLecture.moyenne / O.fluxTotalIntrospection.moyenne;
const ratioEcriture = T.latenceFluxEcriture.moyenne / O.fluxTotalIntrospection.moyenne;
const ratioVerif = T.verificationSurChaine.moyenne / O.ressourceIntrospection.moyenne;
const partPreuve = 100 * T.generationPreuve.moyenne / T.latenceFluxLecture.moyenne;
const ceProB = vf.methodeB.modeleNaif.contreExemple || [];
const durci = vf.methodeB.modeleDurci;
const liaison = vf.methodeB.liaisonAudience;

const obligations = [];
for (const v of Object.values(vf.smtChecker)) obligations.push(...v.obligations);
const prouvees = obligations.filter((o) => o.statut === "prouve-sur");
const indeterminees = obligations.filter((o) => o.statut === "indetermine");

const S = (cle) => sota.travaux.find((t) => t.cle === cle);
const zkat = S("zkAt"), zkace = S("zkace"), stark = S("stark"), linkdid = S("linkdid");
const ecartOutillage = T.preuveGroth16Seule.mediane / zkat.preuveMs;
const ecartTailleCircuit =
  100 * Math.abs(zk.circuit.contraintes - zkat.contraintes) / zkat.contraintes;

// ----------------------------------------------------------- corps
const contenu = [];
const A = (...x) => contenu.push(...x);

// ---- Titre
A(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 240 },
  children: [new TextRun({
    text: "ZK-OAuthChain : une architecture d'autorisation décentralisée, confidentielle " +
          "et formellement vérifiable fusionnant OAuth 2.0, blockchain et preuves à connaissance nulle",
    bold: true, size: 30, font: FONT,
  })],
}));
A(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 360 },
  children: [new TextRun({
    text: "Liaison de contexte, vérification formelle exécutée et évaluation expérimentale",
    italics: true, size: 23, font: FONT, color: "444444",
  })],
}));

// ---- Résumé
A(H("Résumé", 1));
A(P("Le protocole OAuth 2.0 constitue la norme principale de délégation d'autorisation dans " +
    "les systèmes connectés. Son architecture centralisée engendre cependant un point de " +
    "défaillance unique (Single Point of Failure, SPOF), une faible résilience et une " +
    "dépendance à un serveur d'autorisation central. La blockchain apporte décentralisation " +
    "et traçabilité, mais au prix d'une transparence qui compromet la confidentialité."));
A(P("Cet article propose ZK-OAuthChain, une architecture hybride fusionnant OAuth 2.0, la " +
    "blockchain et les preuves à connaissance nulle (Zero-Knowledge Proofs, ZKP), et en " +
    "démontre la faisabilité technique par une implémentation complète et son évaluation " +
    "expérimentale. L'analyse récente de zkLogin (Celi et al., 2026) établit que les " +
    "vulnérabilités des systèmes d'autorisation à connaissance nulle déployés ne sont pas " +
    "cryptographiques, mais découlent d'une liaison insuffisante entre émetteur, audience, " +
    "sujet et partie utilisatrice. Nous en tirons la conséquence au niveau du protocole : " +
    "l'engagement scelle le contexte d'autorisation complet, et quatre de ses composantes " +
    "sont rendues opposables au vérificateur."));
A(P("Le circuit, écrit en Circom, prouve conjointement la liaison de contexte, le hachage " +
    "d'engagement, l'appartenance à un arbre de Merkle et la non-révocation, et publie un " +
    "nullifieur anti-rejeu séparé par domaine. Il compile en " + e(zk.circuit.contraintes) +
    " contraintes R1CS et produit une preuve Groth16 de " + zk.tailles.preuveGroth16Octets +
    " octets, de taille constante."));
A(PR([
  ["Quatre propriétés de sécurité sont définies par jeux d'adversaire, puis ", {}],
  ["effectivement vérifiées", { bold: true }],
  [". Le model-checking exhaustif du modèle B (ProB) exhibe un contre-exemple sur la version " +
   "naïve du contrat — un aliasing d'engagement qui permet à un détenteur de conserver un " +
   "jeton révoqué — puis établit les invariants sur la version durcie en explorant " +
   e(durci.etatsAnalyses) + " états et " + e(durci.transitionsFranchies) + " transitions. Le " +
   "SMTChecker de solc (moteur CHC, solveur z3) démontre " + prouvees.length +
   " obligations de preuve directement sur le code Solidity.", {}],
]));
A(P("La vérification on-chain d'une autorisation coûte " + e(G.verificationPreuveSeule.moyenne) +
    " gas pour la seule preuve et " + e(G.autorisationComplete.moyenne) +
    " gas pour l'autorisation complète, indépendamment du nombre de jetons émis — un coût qui " +
    "se situe entre les " + e(linkdid.gasVerification) + " gas rapportés pour LinkDID " +
    "(zk-SNARK) et les " + e(stark.gasVerification) + " gas d'un cadre zk-STARK comparable. " +
    "La latence totale du flux atteint " + n(T.latenceFluxLecture.moyenne) + " ms contre " +
    n(O.fluxTotalIntrospection.moyenne) + " ms pour un flux OAuth 2.0 classique ; la " +
    "génération de preuve en représente " + n(partPreuve, 1) + " %. À taille de circuit " +
    "quasi identique, la comparaison avec zkAt situe cet écart dans l'outillage de preuve " +
    "plutôt que dans la conception du protocole."));
A(PR([["Mots-clés : ", { bold: true }],
      ["OAuth 2.0, blockchain, preuve à connaissance nulle, Groth16, liaison d'audience, " +
       "vérification formelle, Méthode B, contrat intelligent.", { italics: true }]]));

// ---- 1. Introduction
A(H("1. Introduction", 1));
A(P("Le contrôle d'accès délégué entre applications et API repose aujourd'hui majoritairement " +
    "sur OAuth 2.0 (Hardt, 2012) [6]. Ce protocole, bien que robuste et standardisé, reste " +
    "structurellement centralisé : un unique Serveur d'Autorisation (AS) émet et valide les " +
    "jetons. La compromission ou l'indisponibilité de ce serveur provoque un point de " +
    "défaillance unique, exposant les systèmes à des risques de compromission ou de perte de " +
    "service (RFC 6819)."));
A(P("La blockchain offre une alternative crédible grâce à sa décentralisation et à son " +
    "immuabilité. Sa transparence native expose cependant les métadonnées des utilisateurs et " +
    "contrevient aux exigences de confidentialité imposées notamment par le Règlement Général " +
    "sur la Protection des Données (RGPD). Les preuves à connaissance nulle répondent à ce " +
    "paradoxe : elles permettent de vérifier une information sans la révéler."));
A(PR([
  ["Une leçon récente oriente cependant la conception. ", { bold: true }],
  ["L'analyse de zkLogin par Celi et al. (2026) [11] — le système d'autorisation à " +
   "connaissance nulle le plus largement déployé — identifie trois classes de vulnérabilités, " +
   "dont aucune n'est de nature cryptographique. La plus structurante tient à la " +
   "transformation d'artefacts d'authentification éphémères en autorisations durables " +
   "sans imposer leur contexte d'émission — émetteur, audience, sujet, validité temporelle — " +
   "ce qui ouvre la voie à l'usurpation inter-applications. La sécurité d'un tel système ne " +
   "se réduit donc pas à celle de sa preuve : elle dépend de ce que cette preuve lie.", {}],
]));
A(P("La contribution de cet article est triple. Premièrement, sur le plan de la conception, " +
    "nous élevons la liaison de contexte au rang de propriété de protocole : l'engagement " +
    "cryptographique scelle le quadruplet (émetteur, audience, sujet, Serveur de Ressource) " +
    "ainsi qu'un séparateur de domaine, et le contrat impose cette liaison à la consommation. " +
    "Deuxièmement, nous définissons quatre propriétés de sécurité par jeux d'adversaire et " +
    "exécutons effectivement la vérification formelle des invariants correspondants, dont nous " +
    "présentons les résultats. Troisièmement, nous mesurons le coût réel du protocole et le " +
    "positionnons chiffre contre chiffre face à l'état de l'art 2025-2026 ainsi qu'à un flux " +
    "OAuth 2.0 de référence."));

// ---- 2. Travaux connexes
A(H("2. Travaux connexes et fondements théoriques", 1));

A(H("2.1. OAuth 2.0 et ses limites", 2));
A(P("OAuth 2.0 définit un cadre de délégation entre un client, un serveur de ressource et un " +
    "serveur d'autorisation (Hardt, 2012) [6]. Sa dépendance à un serveur central crée un " +
    "SPOF, et les mécanismes d'introspection rendent la validation des jetons dépendante d'un " +
    "aller-retour réseau vers ce serveur. Les attaques connues incluent la falsification de " +
    "jeton, l'hameçonnage et le vol de jetons d'actualisation (Lodderstedt et al., 2013) [7]."));

A(H("2.2. Blockchain et contrôle d'accès", 2));
A(P("La blockchain a été introduite pour décentraliser l'identité et l'autorisation (Fotiou " +
    "et al., 2020) [4]. Des modèles tels que ContractAS ou les jetons ERC-721 gèrent la " +
    "révocation d'accès via des contrats intelligents. La transparence sur la chaîne viole " +
    "toutefois la confidentialité : chaque transaction reste visible et immuable. La " +
    "décentralisation résout le SPOF mais introduit un risque de divulgation permanente."));

A(H("2.3. Confidentialité et preuves à connaissance nulle", 2));
A(P("Les preuves à connaissance nulle (Goldwasser et al., 1989) [5] permettent de prouver la " +
    "possession d'un secret sans le révéler. Groth16 (Groth, 2016) [8] en fournit " +
    "l'instanciation la plus compacte : une preuve de taille constante, indépendante de la " +
    "taille du témoin, au prix d'un setup de confiance spécifique au circuit. Le hachage " +
    "Poseidon (Grassi et al., 2021) [9], conçu pour les systèmes de preuve, réduit d'un ordre " +
    "de grandeur le coût d'une évaluation de hachage en circuit par rapport à SHA-256."));

A(H("2.4. Vérification formelle des contrats intelligents", 2));
A(P("Les contrats intelligents sont immuables une fois déployés : une erreur de logique peut " +
    "être fatale (Bhargavan et al., 2021) [3]. La vérification formelle applique des méthodes " +
    "mathématiques pour démontrer la conformité d'un système à sa spécification ; sa portée " +
    "reste bornée par le modèle considéré et par la complétude de l'outil employé."));
A(PR([
  ["Un manque reconnu : la vérification de la conception, et non du seul code. ", { bold: true }],
  ["La revue systématique de Davila et al. (2025) [14], qui couvre la littérature du domaine, " +
   "établit deux constats convergents. D'une part, l'essentiel des travaux porte sur la " +
   "vérification de l'implémentation et de l'exécution des contrats, et les auteurs " +
   "identifient explicitement le besoin de vérifier leur conception comme un axe insuffisamment " +
   "traité — ils le désignent en conclusion comme « une opportunité à explorer ». D'autre part, " +
   "le model-checking y apparaît comme la méthode la plus répandue pour établir les propriétés " +
   "d'un contrat, en particulier durant la phase de développement, c'est-à-dire avant " +
   "déploiement, là où une correction reste possible.", {}],
]));
A(P("Ce diagnostic situe directement notre démarche. La Section 5 établit les invariants sur " +
    "une spécification en Méthode B — donc sur la conception, indépendamment du langage " +
    "d'implémentation — avant de les confronter au code Solidity ; et elle le fait par " +
    "model-checking exhaustif, la méthode que Davila et al. identifient comme dominante pour " +
    "cet usage. Là où ces auteurs proposent la logique de description pour combler le manque, " +
    "nous employons la Méthode B ; l'objet visé est le même. Le Résultat 1 de la Section 5.2 " +
    "montre concrètement ce que la vérification au niveau de la conception permet de capturer : " +
    "un défaut présent dans la spécification elle-même, qu'aucune analyse du code déployé " +
    "n'aurait signalé puisqu'il aurait été fidèlement implémenté."));

A(H("2.5. Enseignements des systèmes d'autorisation à connaissance nulle déployés", 2));
A(P("Trois travaux récents encadrent directement notre conception."));
A(PR([
  ["zkLogin et ses vulnérabilités. ", { bold: true }],
  ["Celi et al. (2026) [11] montrent que la sécurité de zkLogin repose sur des hypothèses " +
   "non cryptographiques jamais spécifiées au niveau du protocole : analyse canonique des " +
   "revendications JWT, politique de confiance envers les émetteurs, et surtout liaison " +
   "architecturale. Leur recommandation est explicite : la génération et la vérification de " +
   "preuve doivent être autorisées uniquement pour des quadruplets cohérents (émetteur, " +
   "audience, sujet, identité de la partie utilisatrice), et le sujet doit être interprété " +
   "dans l'espace de noms de son émetteur. Ils relèvent en outre que le nonce de zkLogin sert " +
   "l'inaliénabilité du lien entre époques, et non la fraîcheur : la protection contre le " +
   "rejeu y est absente au niveau du protocole.", {}],
]));
A(PR([
  ["ZK-ACE. ", { bold: true }],
  ["Wang (2026) [12] propose une couche d'autorisation qui remplace les objets de signature " +
   "post-quantiques par des énoncés d'autorisation liés à l'identité. Deux éléments de sa " +
   "méthodologie nous servent directement : une spécification de circuit en cinq contraintes " +
   "dont une contrainte explicite de séparation de domaine, imposant que le domaine déclaré " +
   "apparaisse dans l'engagement, dans la liaison d'autorisation et dans la valeur " +
   "anti-rejeu ; et un ensemble de définitions de sécurité par jeux avec preuves par " +
   "réduction. Son circuit mesuré compte " + e(zkace.contraintes) + " contraintes R1CS.", {}],
]));
A(PR([
  ["zkAt. ", { bold: true }],
  ["Chalkias et al. (2025) [13] introduisent les authentificateurs à connaissance nulle, qui " +
   "préservent la confidentialité de la politique d'authentification elle-même. Leur " +
   "implémentation Groth16 sur BN254 compte " + e(zkat.contraintes) + " contraintes, soit " +
   "une taille quasi identique à la nôtre : elle constitue de ce fait notre point de " +
   "comparaison le plus rigoureux (Section 7.5).", {}],
]));

A(PR([
  ["La résistance post-quantique devient un critère attendu. ", { bold: true }],
  ["Radanliev et al. (2025) [20] proposent un cadre d'identité numérique conforme aux " +
   "standards post-quantiques du NIST et relèvent qu'« aucun cadre d'identité déployé ne " +
   "fournit simultanément la sécurité post-quantique, des garanties cryptographiques de " +
   "confidentialité et une confiance décentralisée ». Leur trajectoire de migration prévoit " +
   "une phase d'imposition stricte des primitives post-quantiques. Un point mérite toutefois " +
   "d'être relevé, car il nuance la lecture habituelle : leur couche de signature emploie " +
   "bien Kyber et Dilithium, mais leur couche de preuve à connaissance nulle reste instanciée " +
   "en zk-SNARK Groth16. ZK-ACE, dont la motivation est explicitement post-quantique, fait le " +
   "même choix. L'effort de migration s'est donc concentré sur les signatures et laisse le " +
   "système de preuve comme dépendance classique résiduelle — une asymétrie que nous " +
   "reprenons en discussion (Section 8.2).", {}],
]));

A(H("2.6. Synthèse comparative des architectures décentralisées existantes", 2));
A(Legende("Tableau 1 — Positionnement de ZK-OAuthChain"));
A(Tableau(
  ["Projet", "Architecture", "Liaison de contexte", "Anti-rejeu", "Vérif. formelle"],
  [
    ["zkLogin (Sui) [11]", "Groth16 + OIDC", "Insuffisante (analysée)", "Absent au protocole", "Non"],
    ["zk-Login (Aleo, 2024) [10]", "zk-SNARK, authentification Web3", "Non spécifiée", "Non spécifié", "Non"],
    ["Polygon ID (2023-2025)", "zk-STARK + DID", "Partielle (DID)", "Nonce", "Partielle"],
    ["ZK-ACE (2026) [12]", "Groth16, autorisation PQ", "Domaine + contexte", "Nonce ou nullifieur", "Preuves par réduction"],
    ["zkAt (2025) [13]", "Groth16, politique privée", "Transaction", "Hors périmètre", "Preuves par réduction"],
    [{ t: "ZK-OAuthChain (proposé)", b: true }, "OAuth 2.0 + Groth16 + vérif. formelle",
     { t: "iss, aud, sub, RP, domaine", b: true }, { t: "Nullifieur séparé par domaine", b: true },
     { t: "Exécutée (ProB + CHC)", b: true }],
  ],
  [20, 24, 22, 18, 16]));
A(Note("ZK-OAuthChain se distingue par la conjonction de trois propriétés : l'interopérabilité " +
       "avec le flux d'autorisation OAuth 2.0 standard, une liaison de contexte complète " +
       "imposée au niveau du protocole, et une vérification formelle non seulement annoncée " +
       "mais exécutée, avec présentation des résultats obtenus."));

// ---- 3. Conception
A(new Paragraph({ children: [new PageBreak()] }));
A(H("3. Conception de l'architecture ZK-OAuthChain", 1));

A(H("3.1. Vue d'ensemble", 2));
A(P("ZK-OAuthChain retire au Serveur d'Autorisation son rôle d'émetteur et de validateur de " +
    "jetons, et le confie à un contrat intelligent d'autorisation déployé sur la blockchain. " +
    "L'AS traditionnel est conservé pour la seule authentification initiale de l'utilisateur " +
    "et pour le calcul des engagements cryptographiques. Les jetons OAuth sont représentés par " +
    "des engagements, prouvés valides via ZKP sans révéler les données associées."));

A(H("3.2. Flux d'autorisation décentralisé", 2));
A(Num("Le Serveur de Ressource lie une fois pour toutes son adresse à son identifiant de " +
      "protocole auprès du contrat."));
A(Num("L'utilisateur s'authentifie auprès de l'AS."));
A(Num("L'AS émet le jeton, calcule le contexte d'autorisation puis l'engagement, l'insère " +
      "dans l'arbre de Merkle des émissions et ancre la racine sur la chaîne."));
A(Num("Le Serveur de Ressource émet un défi lié à la portée demandée, à un aléa et à une " +
      "expiration."));
A(Num("Le client génère une preuve attestant que son engagement est valide, appartient à la " +
      "racine ancrée, n'est pas révoqué et correspond au contexte déclaré ; il publie un " +
      "nullifieur lié au défi et au domaine."));
A(Num("Le Serveur de Ressource soumet la preuve au contrat, qui vérifie le contexte puis la " +
      "preuve, et consomme le nullifieur."));
A(Num("L'accès est accordé si et seulement si la preuve est valide, le contexte conforme et " +
      "le nullifieur inédit."));

A(H("3.3. Modèle cryptographique du circuit", 2));
A(P("Le circuit établit cinq contraintes sans jamais divulguer la valeur du jeton, celle du " +
    "sujet, ni celle des métadonnées. Notons Poseidon le hachage en circuit, iss l'identifiant " +
    "de l'émetteur, aud celui du client OAuth destinataire, sub le sujet, rs l'identifiant du " +
    "Serveur de Ressource visé et dom le séparateur de domaine."));
A(Legende("Contraintes du circuit"));
A(...Mono([
  "(C1) Liaison de contexte    ctx = Poseidon(iss, aud, sub, rs, dom)",
  "(C2) Hachage d'engagement   h   = Poseidon(token, ctx, meta)",
  "(C3) Appartenance Merkle    MerkleVerify(h, root) = vrai",
  "(C4) Non-révocation         h ∉ SMT(revRoot)          (preuve d'exclusion)",
  "(C5) Anti-rejeu + domaine   nullifier = Poseidon(h, challenge, dom)",
  "",
  "Publics : nullifier, root, revRoot, iss, aud, rs, dom, challenge",
  "Privés  : token, sub, meta, témoin Merkle, témoin d'exclusion",
]));
A(PR([
  ["C1 répond directement à la vulnérabilité centrale de zkLogin. ", { bold: true }],
  ["Le quadruplet (iss, aud, sub, rs) et le domaine sont scellés dans l'engagement au moment " +
   "de l'émission. Quatre de ces cinq composantes sont publiques, donc opposables au " +
   "vérificateur : une preuve ne peut être présentée qu'au Serveur de Ressource et pour le " +
   "client pour lesquels le jeton a été émis. Le sujet, lui, demeure privé — il est lié sans " +
   "être divulgué — et il est dérivé dans l'espace de noms de son émetteur, conformément à la " +
   "recommandation de Celi et al.", {}],
]));
A(P("C3 et C4 fondent la validité de l'autorisation. La non-révocation est établie par une " +
    "preuve d'exclusion sur un Sparse Merkle Tree, et non par un parcours de liste : son coût " +
    "est logarithmique en la profondeur de l'arbre et indépendant du nombre de révocations."));
A(P("C5 assure la fraîcheur et la séparation de domaine. Le nullifieur ne dépend que de " +
    "l'engagement, du défi et du domaine ; le contrat le consomme une fois pour toutes. Deux " +
    "autorisations distinctes ne sont pas corrélables, l'engagement n'apparaissant jamais en " +
    "clair. La présence du domaine dans le nullifieur — comme dans C1 — interdit de rejouer " +
    "sur un déploiement une preuve produite pour un autre, exigence que ZK-ACE formule comme " +
    "contrainte de séparation de domaine."));

A(H("3.4. Spécification algorithmique du contrat d'autorisation", 2));
A(P("Nous décrivons le contrat au niveau algorithmique plutôt que par son code source : la " +
    "spécification ci-dessous est indépendante du langage d'implémentation et constitue " +
    "directement l'objet de la vérification formelle de la Section 5."));
A(Legende("Algorithme 1 — Contrat d'autorisation ZK-OAuthChain (spécification)"));
A(...Mono([
  "ÉTAT   racineÉmission, racineRévocation, époque, émetteur, domaine",
  "       engagementDe : Utilisateur -> Engagement      (fonction partielle)",
  "       détenteurDe  : Engagement  -> Utilisateur     (réciproque)",
  "       révoqué      : ensemble d'Engagements",
  "       idDuRP       : ServeurRessource -> IdRP       (fonction partielle)",
  "       rpDeLId      : IdRP -> ServeurRessource       (réciproque)",
  "       consommé     : ensemble de Nullifieurs",
  "       octroyéÀ     : Nullifieur  -> Époque",
  "       octroyéAuRP  : Nullifieur  -> IdRP",
  "",
  "enregistrerRP(r, i)",
  "   exiger  i != 0  et  r ∉ dom(idDuRP)  et  i ∉ dom(rpDeLId)",
  "   idDuRP(r) <- i ; rpDeLId(i) <- r",
  "",
  "ancrerRacines(r, rr)                            [réservé à l'AS]",
  "   racineÉmission <- r ; racineRévocation <- rr ; époque <- époque + 1",
  "",
  "enregistrer(u, c)",
  "   exiger  c != 0  et  c ∉ révoqué  et  c ∉ dom(détenteurDe)",
  "   exiger  u ∉ dom(engagementDe)                 [pas de rotation implicite]",
  "   engagementDe(u) <- c ; détenteurDe(c) <- u",
  "",
  "libérer(u)                                      [rotation volontaire]",
  "   exiger  u ∈ dom(engagementDe)",
  "   retirer u de engagementDe ; retirer engagementDe(u) de détenteurDe",
  "",
  "révoquer(u)                                     [réservé à l'AS]",
  "   exiger  u ∈ dom(engagementDe)  ;  c <- engagementDe(u)",
  "   révoqué <- révoqué ∪ {c}",
  "   retirer u de engagementDe ; retirer c de détenteurDe",
  "",
  "autoriser(π, (nullifieur, r, rr, iss, aud, rp, dom, défi))   [appelé par le RP]",
  "   exiger  époque != 0                           [racines déjà ancrées]",
  "   exiger  r = racineÉmission  et  rr = racineRévocation      [fraîcheur]",
  "   exiger  iss = émetteur                        [politique d'émetteur]",
  "   exiger  dom = domaine                         [séparation de domaine]",
  "   i <- idDuRP(appelant) ; exiger i != 0 et rp = i            [liaison au RP]",
  "   exiger  nullifieur ∉ consommé                              [anti-rejeu]",
  "   exiger  Vérifier(π, signaux publics)                       [validité ZK]",
  "   consommé <- consommé ∪ {nullifieur}",
  "   octroyéÀ(nullifieur) <- époque ; octroyéAuRP(nullifieur) <- i",
]));
A(Note("La séparation entre enregistrer et libérer, et le maintien des réciproques " +
       "détenteurDe et rpDeLId, ne sont pas cosmétiques : ils sont imposés par les résultats " +
       "de la Section 5. L'identifiant consigné est celui enregistré pour l'appelant, et non " +
       "celui revendiqué par la preuve — cette dissymétrie est ce qui rend la liaison " +
       "opposable."));

// ---- 4. Modèle de sécurité
A(new Paragraph({ children: [new PageBreak()] }));
A(H("4. Modèle de sécurité : définitions par jeu", 1));
A(P("Nous formulons les garanties visées sous forme de jeux d'adversaire, selon l'usage " +
    "adopté par ZK-ACE [12] et zkAt [13]. Les esquisses de preuve qui suivent indiquent la " +
    "réduction envisagée ; elles ne constituent pas des démonstrations complètes, et nous les " +
    "présentons comme telles."));

A(H("4.1. Hypothèses", 2));
A(Puce("Solidité de la connaissance de Groth16 : pour tout adversaire produisant une preuve " +
       "acceptée, il existe un extracteur qui en tire un témoin satisfaisant le circuit."));
A(Puce("Connaissance nulle parfaite de Groth16 : toute preuve est simulable à partir des " +
       "seuls signaux publics."));
A(Puce("Résistance aux collisions de Poseidon sur le corps scalaire de BN254."));
A(Puce("Pseudo-aléatoirité de Poseidon sur des entrées de haute entropie : la Définition 1 " +
       "s'appuie sur cette hypothèse, plus forte que la seule résistance aux collisions."));
A(Puce("L'AS est honnête quant à l'émission : il n'insère dans l'arbre que des engagements " +
       "correspondant à des jetons qu'il a réellement délivrés. Cette hypothèse est discutée " +
       "en Section 8."));

A(H("4.2. Confidentialité de l'autorisation", 2));
A(...Encadre("Définition 1 (confidentialité de l'autorisation).", [
  "L'adversaire A choisit deux octrois (token₀, sub₀, meta₀) et (token₁, sub₁, meta₁), tous " +
  "deux valides sous le même contexte public (iss, aud, rs, dom), tous deux présents dans " +
  "l'arbre d'émission et absents de l'arbre de révocation. Le challenger tire b ∈ {0,1} et " +
  "produit la preuve π pour l'octroi b, ainsi que ses signaux publics. A renvoie b′.",
  "ZK-OAuthChain satisfait la confidentialité de l'autorisation si |Pr[b′ = b] − 1/2| est " +
  "négligeable.",
]));
A(P("Esquisse de preuve. Sept des huit signaux publics — les racines, le contexte et le défi " +
    "— sont identiques dans les deux cas par construction du jeu. Le nullifieur est le seul à " +
    "dépendre du secret, et il diffère entre les deux octrois. On procède donc en deux " +
    "transitions. D'abord, par la propriété de connaissance nulle, on remplace π par une " +
    "preuve simulée à partir des seuls signaux publics : la transition est parfaitement " +
    "indistinguable, et l'avantage de A ne peut plus provenir que du nullifieur. Ensuite, " +
    "distinguer Poseidon(h₀, défi, dom) de Poseidon(h₁, défi, dom) sans connaître h₀ ni h₁ " +
    "contredit l'hypothèse de pseudo-aléatoirité de Poseidon, les engagements h₀ et h₁ étant " +
    "issus de jetons tirés uniformément. L'avantage de A est donc négligeable."));
A(Note("La garantie porte sur ce qui est révélé à la chaîne et au Serveur de Ressource. Elle " +
       "ne porte pas sur l'AS, qui connaît le jeton par construction — cette limite est " +
       "discutée en Section 8.1."));

A(H("4.3. Solidité de l'autorisation", 2));
A(...Encadre("Définition 2 (solidité de l'autorisation).", [
  "A obtient les signaux publics de polynomialement nombreuses autorisations et peut demander " +
  "l'émission et la révocation d'engagements. A gagne s'il produit (π*, signaux*) accepté par " +
  "le contrat, portant sur les racines courantes, tel qu'aucun octroi émis par l'AS et non " +
  "révoqué ne corresponde au contexte déclaré.",
]));
A(P("Esquisse de preuve. Par solidité de la connaissance, un extracteur produit un témoin " +
    "(token*, sub*, meta*, chemins) satisfaisant C1 à C5. C2 et C3 imposent que h* = " +
    "Poseidon(token*, ctx*, meta*) soit une feuille de l'arbre de racine root. Ou bien h* " +
    "coïncide avec un engagement réellement émis, et le contexte déclaré est alors celui de " +
    "l'émission par C1 — A n'a donc pas gagné ; ou bien h* est une feuille sans en être une, " +
    "ce qui fournit une collision de Poseidon dans la vérification de Merkle. C4 exclut " +
    "symétriquement le cas d'un engagement révoqué : une preuve d'exclusion valide pour une " +
    "clé présente dans l'arbre de révocation constitue également une collision. L'avantage de " +
    "A se réduit donc à celui d'un attaquant contre la résistance aux collisions de Poseidon " +
    "ou contre la solidité de Groth16."));

A(H("4.4. Résistance au rejeu", 2));
A(...Encadre("Définition 3 (résistance au rejeu).", [
  "A gagne s'il obtient deux octrois acceptés portant le même nullifieur, ou deux octrois " +
  "acceptés pour un même triplet (engagement, défi, domaine).",
]));
A(P("Esquisse de preuve. Le premier cas est exclu par l'état du contrat : l'invariant I2, " +
    "démontré mécaniquement en Section 5.3, établit que tout octroi enregistré a consommé son " +
    "nullifieur, et la garde correspondante rejette tout nullifieur déjà consommé. Le second " +
    "cas exigerait deux nullifieurs distincts pour un même triplet, donc une collision de " +
    "Poseidon, C5 étant une fonction déterministe de ce seul triplet. Notons que cette " +
    "garantie est une propriété du protocole, et non une hypothèse de déploiement : c'est " +
    "précisément ce qui manque à zkLogin selon Celi et al."));

A(H("4.5. Séparation de domaine et non-substitution d'audience", 2));
A(...Encadre("Définition 4 (non-substitution d'audience).", [
  "A dispose d'octrois émis pour le contexte (iss, aud, rs, dom). A gagne s'il produit une " +
  "preuve acceptée pour un contexte (iss′, aud′, rs′, dom′) distinct du précédent, sans que " +
  "l'AS ait émis d'engagement pour ce nouveau contexte.",
]));
A(P("Esquisse de preuve. Modifier une composante du contexte modifie ctx par C1, donc h par " +
    "C2, sauf collision de Poseidon. Le nouvel engagement h′ n'est alors pas une feuille de " +
    "l'arbre d'émission, et C3 échoue : le cas se réduit à la solidité de l'autorisation " +
    "(Définition 2). Une seconde ligne de défense est imposée par le contrat, indépendamment " +
    "de la cryptographie : il rejette toute preuve dont l'émetteur n'est pas celui déclaré, " +
    "dont le domaine n'est pas le sien, ou dont l'identifiant de Serveur de Ressource ne " +
    "coïncide pas avec celui enregistré pour l'appelant. L'invariant I3, démontré " +
    "mécaniquement en Section 5.3, établit que tout octroi est effectivement attribué à un " +
    "Serveur de Ressource enregistré."));
A(Note("La Section 6.3 rapporte les tests exécutables correspondant aux trois scénarios " +
       "d'attaque dérivés de l'analyse de zkLogin : substitution de Serveur de Ressource, " +
       "émetteur non déclaré, et domaine étranger."));

// ---- 5. Vérification formelle
A(new Paragraph({ children: [new PageBreak()] }));
A(H("5. Vérification formelle : protocole et résultats obtenus", 1));
A(P("Cette section ne se borne pas à annoncer une méthode : elle rapporte les résultats " +
    "effectivement produits par deux chaînes de vérification indépendantes, appliquées aux " +
    "mêmes invariants."));

A(H("5.1. Invariants de sécurité", 2));
A(P("Les définitions par jeu de la Section 4 se traduisent en invariants d'état du contrat. " +
    "Deux propriétés auxiliaires de couplage sont nécessaires à leur établissement inductif :"));
A(...Mono([
  "J0  (couplage détenteur) ∀u . engagementDe(u) défini ⇒ détenteurDe(engagementDe(u)) = u",
  "J1  (couplage RP)        ∀r . idDuRP(r) défini      ⇒ rpDeLId(idDuRP(r)) = r",
  "I1  (sûreté)             ∀u . engagementDe(u) défini ⇒ engagementDe(u) ∉ révoqué",
  "I2  (intégrité)          ∀n . octroyéÀ(n) défini     ⇒ n ∈ consommé",
  "I2b (fraîcheur)          ∀n . octroyéÀ(n) défini     ⇒ époque ≠ 0",
  "I3  (liaison d'audience) ∀n . octroyéÀ(n) défini     ⇒ octroyéAuRP(n) enregistré",
]));
A(P("I1 énonce la sûreté : aucun engagement encore attaché à un détenteur n'est révoqué. I2 " +
    "soutient la résistance au rejeu (Définition 3) : tout accès enregistré résulte d'une " +
    "preuve vérifiée et a consommé son nullifieur. I3 soutient la non-substitution d'audience " +
    "(Définition 4) : tout octroi est attribué à un Serveur de Ressource enregistré, dont " +
    "l'identifiant est celui scellé dans la preuve."));

A(H("5.2. Méthode B — model-checking exhaustif avec ProB", 2));
A(P("Les invariants sont traduits en machines B selon la Méthode B (Abrial, 1996) [1]. " +
    "Conformément à l'approche de conversion de code Solidity en modèle B décrite par Baba et " +
    "al. (2024) [2], chaque fonction du contrat devient une opération B et chaque variable " +
    "d'état une variable de machine. Trois machines ont été soumises à ProB 1.16.1 " +
    "(Leuschel et Butler, 2003) [19] : la " +
    "transcription de la spécification initiale, le modèle du contrat durci, et un modèle " +
    "dédié à la liaison d'audience. Cette dernière séparation garde chaque espace d'états " +
    "exhaustivement explorable, les deux fragments d'état étant disjoints."));
A(PR([
  ["Résultat 1 — la spécification initiale viole I1. ", { bold: true }],
  ["Sur la première machine, ProB exhibe un contre-exemple en trois opérations. Deux " +
   "utilisateurs distincts enregistrent le même engagement ; la révocation de l'un marque " +
   "l'engagement comme révoqué et le détache de son porteur, mais l'autre y reste attaché. " +
   "L'invariant de sûreté est mis en défaut : un utilisateur conserve un jeton révoqué.", {}],
]));
A(Legende("Figure 1 — Contre-exemple produit par ProB sur la spécification initiale"));
A(...Mono([
  "*** COUNTER EXAMPLE FOUND ***",
  "invariant_violation",
  "*** TRACE (length=" + ceProB.length + "):",
  ...ceProB.map((t, i) => " " + (i + 1) + ": " + t),
  "*** Invariant 5 est faux :",
  "   " + (vf.methodeB.modeleNaif.invariantViole || ""),
]));
A(P("Cette découverte n'est pas un artefact du modèle : elle correspond à une faiblesse " +
    "réelle du contrat, reproduite puis neutralisée dans la suite de tests de " +
    "l'implémentation. La correction consiste à maintenir la réciproque détenteurDe et à " +
    "exiger qu'un engagement n'ait qu'un détenteur — d'où la structure de l'Algorithme 1."));
A(PR([
  ["Résultat 2 — le contrat durci satisfait tous les invariants. ", { bold: true }],
  ["Sur la deuxième machine, ProB explore exhaustivement l'espace d'états accessible : " +
   e(durci.etatsAnalyses) + " états et " + e(durci.transitionsFranchies) +
   " transitions, en " + e(durci.tempsMs) + " ms, toutes opérations couvertes, aucun " +
   "contre-exemple. J0, I1, I2 et I2b sont établis sur ce domaine fini. La machine dédiée à " +
   "la liaison d'audience établit de même J1 et I3 sur " + e(liaison.etatsAnalyses) +
   " états et " + e(liaison.transitionsFranchies) + " transitions, en " +
   e(liaison.tempsMs) + " ms.", {}],
]));

A(H("5.3. Preuve sur le code Solidity — SMTChecker (moteur CHC, solveur z3)", 2));
A(P("Le model-checking porte sur un modèle ; nous l'avons complété par une preuve conduite " +
    "directement sur le code Solidity, au moyen du SMTChecker intégré à solc 0.8.28 " +
    "(Alt et Reitwiessner, 2018) [18], avec le " +
    "moteur CHC (clauses de Horn contraintes) et le solveur z3 4.12.6. Le vérificateur " +
    "Groth16 y est abstrait par un oracle booléen non contraint : la preuve couvre donc les " +
    "deux issues possibles de la vérification cryptographique, ce qui est strictement plus " +
    "fort que de raisonner sur une implémentation particulière. Chaque invariant est exprimé " +
    "par une fonction publique d'assertion paramétrée, que le moteur doit établir dans tout " +
    "état accessible, pour toute séquence d'appels et tout argument — c'est-à-dire prouver " +
    "l'énoncé universellement quantifié."));
A(Legende("Tableau 2 — Obligations de preuve soumises au moteur CHC"));
A(Tableau(
  ["Obligation", "Énoncé vérifié", "Résultat"],
  [
    ["I2 — intégrité", "grantedEpoch[n] = 0 ∨ nullifierUsed[n]", { t: "Prouvé sûr", b: true }],
    ["I2b — fraîcheur", "grantedEpoch[n] = 0 ∨ epoch ≠ 0", { t: "Prouvé sûr", b: true }],
    ["I3 — liaison d'audience", "grantedEpoch[n] = 0 ∨ grantedRsId[n] ≠ 0",
     { t: "Prouvé sûr", b: true }],
    ["I1′ — sûreté (forme duale)", "holderOf[c] = 0 ∨ ¬revoked[c]", { t: "Prouvé sûr", b: true }],
    ["I1 — sûreté (forme directe)", "commitmentOf[u] = 0 ∨ ¬revoked[commitmentOf[u]]",
     "Indéterminé — limite de l'outil"],
    ["J0 — couplage", "commitmentOf[u] = 0 ∨ holderOf[commitmentOf[u]] = u",
     "Indéterminé — limite de l'outil"],
  ],
  [24, 44, 32]));
A(P("Les " + prouvees.length + " obligations décidées le sont positivement. Les " +
    indeterminees.length + " obligations indéterminées partagent une même caractéristique : " +
    "elles comportent un déréférencement imbriqué de dictionnaires, que le raisonnement sur " +
    "tableaux de Spacer ne parvient pas à généraliser. Le solveur ne produit aucun " +
    "contre-exemple ; il ne conclut pas. La forme duale I1′, indexée par l'engagement et donc " +
    "dépourvue d'imbrication, exprime la même propriété sous J0 et est, elle, démontrée. Ces " +
    "deux obligations sont par ailleurs couvertes par le model-checking exhaustif de la " +
    "section précédente : les deux chaînes sont complémentaires, la première prouvant sur le " +
    "code réel ce qu'elle peut décider, la seconde établissant sur un domaine fini ce que la " +
    "première laisse ouvert."));
A(PR([
  ["Résultat 3 — la vérification a orienté la conception. ", { bold: true }],
  ["Deux modifications du contrat découlent directement de ces exécutions. D'une part, la " +
   "rotation d'engagement a été rendue explicite : écrire à deux indices symboliquement " +
   "distincts dans une même fonction empêchait le moteur d'inférer l'invariant quantifié. " +
   "D'autre part, une garde interdit l'adresse nulle comme détenteur : le SMTChecker a exhibé " +
   "une violation avérée exploitant l'ambiguïté entre l'adresse nulle sentinelle et une " +
   "adresse nulle détentrice, qui réintroduisait exactement l'aliasing détecté par ProB. La " +
   "vérification formelle n'a donc pas seulement confirmé un code existant : elle en a " +
   "corrigé deux défauts et façonné la structure.", {}],
]));

// ---- 6. Implémentation
A(new Paragraph({ children: [new PageBreak()] }));
A(H("6. Implémentation", 1));

A(H("6.1. Chaîne d'outils", 2));
A(P("Le prototype est intégralement reproductible. Le circuit est écrit en Circom 2.2.2 et " +
    "s'appuie sur circomlib pour la permutation Poseidon et pour le vérificateur de Sparse " +
    "Merkle Tree. La chaîne Groth16 (setup de phase 2, export de la clé de vérification, " +
    "génération du vérificateur Solidity) est assurée par snarkjs 0.7.5. Les contrats sont " +
    "compilés avec solc 0.8.28, optimiseur activé (200 exécutions), cible EVM Cancun, et " +
    "déployés au moyen de Hardhat et d'ethers 6."));

A(H("6.2. Circuit ZKP", 2));
A(P("Le circuit instancie un arbre de Merkle de 20 niveaux, soit une capacité de " +
    "1 048 576 engagements émis, et un Sparse Merkle Tree de révocation de même profondeur. " +
    "Il expose " + zk.circuit.signauxPublics + " signaux publics et conserve privés le jeton, " +
    "le sujet, les métadonnées, le chemin d'authentification de Merkle et le témoin " +
    "d'exclusion."));
A(Legende("Tableau 3 — Circuit compilé"));
A(Tableau(
  ["Grandeur", "Valeur"],
  [
    ["Contraintes R1CS", e(zk.circuit.contraintes)],
    ["Variables", e(zk.circuit.variables)],
    ["Signaux publics", String(zk.circuit.signauxPublics)],
    ["Profondeur des arbres (émission / révocation)", "20 / 20 niveaux"],
    ["Puissance Powers of Tau", "2^" + zk.circuit.ptauPower],
    ["Clé de preuve (zkey)", n(zk.circuit.tailleZkeyOctets / 1e6, 1) + " Mo"],
    ["Témoin WebAssembly", n(zk.circuit.tailleWasmOctets / 1e6, 1) + " Mo"],
    [{ t: "Taille de la preuve Groth16", b: true },
     { t: zk.tailles.preuveGroth16Octets + " octets (2 × G1 + 1 × G2)", b: true }],
    ["Signaux publics sérialisés", zk.tailles.signauxPublicsOctets + " octets"],
    ["Calldata d'une autorisation", zk.tailles.calldataAutorisationOctets + " octets"],
  ],
  [58, 42], ["l", "r"]));
A(Note("Le passage de 4 à " + zk.circuit.signauxPublics + " signaux publics, requis par la " +
       "liaison de contexte, est le poste de coût de cette propriété : il ajoute " +
       (zk.tailles.calldataAutorisationOctets - 388) + " octets de calldata et environ " +
       e(zk.gas.verificationPreuveSeule.moyenne - 212256) + " gas de vérification par rapport " +
       "à une conception sans liaison, mesurée sur une version antérieure du même circuit."));

A(H("6.3. Contrat d'autorisation et tests", 2));
A(P("Le contrat ZKAuthRegistry implémente l'Algorithme 1. Il expose une vérification en " +
    "lecture, sans transaction, à l'usage du Serveur de Ressource, et une opération " +
    "d'autorisation qui vérifie le contexte puis la preuve avant de consommer le nullifieur. " +
    "Le vérificateur Groth16, généré par snarkjs, est déployé séparément et référencé de " +
    "manière immuable."));
A(P("Une suite de quatorze tests on-chain couvre le chemin nominal et les chemins d'échec. " +
    "Trois d'entre eux instancient directement les scénarios d'attaque dérivés de l'analyse de " +
    "zkLogin : une preuve légitime soumise par un autre Serveur de Ressource est rejetée, " +
    "tandis que le destinataire légitime l'accepte ; une preuve issue d'un émetteur non " +
    "déclaré est rejetée ; une preuve produite pour un autre domaine est rejetée. Un quatrième " +
    "test vérifie que la liaison est cryptographique et non seulement contractuelle : " +
    "déclarer un autre Serveur de Ressource dans les signaux publics rend le circuit " +
    "insatisfiable, la génération de preuve échouant sur la contrainte d'appartenance de " +
    "Merkle. Un cinquième rejoue le contre-exemple produit par ProB."));

A(H("6.4. Déploiement", 2));
A(P("Les contrats ont été déployés et mesurés sur un nœud EVM local (chainId " + zk.chainId +
    "), dont la sémantique d'exécution et la tarification en gas sont identiques à celles du " +
    "réseau public. Les coûts de déploiement relevés sont de " +
    e(Number(dep.contrats.Groth16Verifier.gasDeploiement)) + " gas pour le vérificateur " +
    "Groth16 et " + e(Number(dep.contrats.ZKAuthRegistry.gasDeploiement)) +
    " gas pour le registre d'autorisation ; l'enregistrement d'un Serveur de Ressource coûte " +
    e(Number(dep.serveurRessource.gasEnregistrement)) + " gas, une seule fois."));
A(P("Le déploiement sur le testnet public Sepolia est paramétré par le même script : il " +
    "requiert uniquement un point d'accès RPC et un compte de test alimenté par un faucet, et " +
    "produit un enregistrement des adresses et des hachages de transaction. Les mesures de " +
    "gas rapportées en Section 7 étant déterminées par la sémantique de l'EVM et non par le " +
    "réseau, elles sont transposables sans modification ; seules les latences de soumission " +
    "de transaction diffèrent, dominées par le temps de production de bloc du réseau public."));

// ---- 7. Évaluation expérimentale
A(new Paragraph({ children: [new PageBreak()] }));
A(H("7. Évaluation expérimentale", 1));

A(H("7.1. Protocole de mesure", 2));
A(P("Les mesures ont été réalisées sur " + zk.machine.cpu + " (" + zk.machine.coeurs +
    " cœurs logiques, " + n(zk.machine.memoireGo, 1) + " Go de mémoire), sous " +
    zk.machine.os + ", avec Node " + zk.machine.node + ". Le Serveur d'Autorisation émet " +
    "64 jetons, dont trois sont révoqués, de sorte que l'arbre de révocation ne soit pas " +
    "vide et que la preuve d'exclusion soit effectivement sollicitée. " + zk.iterations +
    " autorisations complètes ont été mesurées, et " + oa.iterations + " flux OAuth 2.0."));
A(PR([
  ["Chaque preuve est générée dans un processus neuf. ", { bold: true }],
  ["Ce choix méthodologique reproduit le comportement réel d'un client, qui produit une " +
   "preuve par autorisation, et surtout il élimine une source d'erreur significative : " +
   "snarkjs ne libère pas ses pools de threads entre deux appels. Mesurées en boucle dans un " +
   "même processus, les générations successives se dégradent d'un facteur quatre et leur " +
   "dispersion explose. Nous signalons ce biais parce qu'il affecte silencieusement toute " +
   "campagne de mesure naïve sur cette bibliothèque.", {}],
]));

A(H("7.2. Temps de génération et de vérification", 2));
A(Legende("Tableau 4 — Temps mesurés (millisecondes, " + zk.iterations + " itérations)"));
A(Tableau(
  ["Étape", "Moyenne", "Écart-type", "Médiane", "p95"],
  [
    ["Émission du jeton et de l'engagement (AS)", n(T.emissionJetonAS.moyenne),
     n(T.emissionJetonAS.ecartType), n(T.emissionJetonAS.mediane), n(T.emissionJetonAS.p95)],
    ["Assemblage du témoin (Merkle + exclusion SMT)", n(T.assemblageTemoin.moyenne),
     n(T.assemblageTemoin.ecartType), n(T.assemblageTemoin.mediane), n(T.assemblageTemoin.p95)],
    ["  dont calcul du témoin (WebAssembly)", n(T.calculTemoinWasm.moyenne),
     n(T.calculTemoinWasm.ecartType), n(T.calculTemoinWasm.mediane), n(T.calculTemoinWasm.p95)],
    ["  dont preuve Groth16 (MSM et FFT)", n(T.preuveGroth16Seule.moyenne),
     n(T.preuveGroth16Seule.ecartType), n(T.preuveGroth16Seule.mediane),
     n(T.preuveGroth16Seule.p95)],
    [{ t: "Génération de la preuve (client, total)", b: true },
     { t: n(T.generationPreuve.moyenne), b: true }, n(T.generationPreuve.ecartType),
     n(T.generationPreuve.mediane), n(T.generationPreuve.p95)],
    ["Vérification hors-chaîne (snarkjs)", n(T.verificationHorsChaine.moyenne),
     n(T.verificationHorsChaine.ecartType), n(T.verificationHorsChaine.mediane),
     n(T.verificationHorsChaine.p95)],
    [{ t: "Vérification sur-chaîne (appel en lecture)", b: true },
     { t: n(T.verificationSurChaine.moyenne), b: true }, n(T.verificationSurChaine.ecartType),
     n(T.verificationSurChaine.mediane), n(T.verificationSurChaine.p95)],
    [{ t: "Latence totale du flux (validation en lecture)", b: true },
     { t: n(T.latenceFluxLecture.moyenne), b: true }, n(T.latenceFluxLecture.ecartType),
     n(T.latenceFluxLecture.mediane), n(T.latenceFluxLecture.p95)],
    ["Latence totale du flux (consommation on-chain)", n(T.latenceFluxEcriture.moyenne),
     n(T.latenceFluxEcriture.ecartType), n(T.latenceFluxEcriture.mediane),
     n(T.latenceFluxEcriture.p95)],
  ],
  [40, 15, 15, 15, 15], ["l", "r", "r", "r", "r"]));
A(P("La génération de preuve domine largement : " + n(T.generationPreuve.moyenne) +
    " ms en moyenne, soit " + n(partPreuve, 1) + " % de la latence totale. Sa décomposition " +
    "est instructive : le calcul du témoin ne compte que pour " +
    n(100 * T.calculTemoinWasm.moyenne / T.generationPreuve.moyenne, 0) +
    " %, le reste étant consommé par les multi-exponentiations et les transformées de Fourier " +
    "du prouveur Groth16. La vérification, elle, est peu coûteuse : " +
    n(T.verificationSurChaine.moyenne) + " ms pour l'appel en lecture au contrat. Cette " +
    "asymétrie est structurelle à Groth16 et oriente les optimisations vers le prouveur."));

A(H("7.3. Coût en gas", 2));
A(Legende("Tableau 5 — Coût en gas sur l'EVM"));
A(Tableau(
  ["Opération", "Gas", "Fréquence"],
  [
    ["Déploiement du vérificateur Groth16",
     e(Number(dep.contrats.Groth16Verifier.gasDeploiement)), "une fois"],
    ["Déploiement de ZKAuthRegistry",
     e(Number(dep.contrats.ZKAuthRegistry.gasDeploiement)), "une fois"],
    ["Enregistrement d'un Serveur de Ressource",
     e(Number(dep.serveurRessource.gasEnregistrement)), "une fois par RP"],
    ["Ancrage des racines par l'AS", e(zk.gasAncrageRacines),
     "par époque, amorti sur tous les jetons"],
    [{ t: "Vérification de la preuve seule", b: true },
     { t: e(G.verificationPreuveSeule.moyenne), b: true }, "par autorisation"],
    [{ t: "Autorisation complète", b: true },
     { t: e(G.autorisationComplete.moyenne), b: true }, "par autorisation"],
    ["Surcoût d'état (écritures + journal)",
     e(G.autorisationComplete.moyenne - G.verificationPreuveSeule.moyenne), "par autorisation"],
  ],
  [46, 20, 34], ["l", "r", "l"]));
A(P("Le coût de vérification de la preuve est rigoureusement constant sur l'ensemble des " +
    "itérations — " + e(G.verificationPreuveSeule.min) + " gas, sans dispersion — ce qui " +
    "confirme expérimentalement la propriété de taille constante de Groth16 : le coût est " +
    "indépendant du nombre de jetons émis comme du nombre de révocations. Une autorisation " +
    "complète revient à " + e(G.autorisationComplete.moyenne) + " gas, soit environ " +
    n(G.autorisationComplete.moyenne * 20 / 1e9, 4) + " ETH à 20 gwei."));
A(P("Il convient de noter que le Serveur de Ressource peut valider une autorisation par un " +
    "simple appel en lecture, sans transaction ni gas. La consommation on-chain du nullifieur " +
    "n'est nécessaire que lorsque l'anti-rejeu doit être opposable à l'ensemble du réseau."));

A(H("7.4. Comparaison avec un flux OAuth 2.0 classique", 2));
A(P("Pour disposer d'un point de comparaison rigoureux, nous avons implémenté un flux OAuth " +
    "2.0 complet conforme au RFC 6749 : code d'autorisation avec PKCE (RFC 7636) [15], puis " +
    "accès à la ressource protégée selon deux modes de validation. Le premier repose sur un " +
    "jeton opaque et l'introspection centralisée (RFC 7662) [16], qui matérialise la " +
    "dépendance au serveur d'autorisation. Le second emploie un JWT RS256 auto-porteur " +
    "vérifié localement par le Serveur de Ressource : c'est la variante OAuth la plus rapide, " +
    "donc la plus défavorable à ZK-OAuthChain. Les deux architectures sont mesurées sur " +
    "boucle locale : aucune latence de réseau étendu n'est incluse, de part et d'autre."));
A(Legende("Tableau 6 — Latence totale du flux d'autorisation"));
A(Tableau(
  ["Architecture", "Mode de validation", "Moyenne", "Médiane", "p95", "Rapport"],
  [
    ["OAuth 2.0", "jeton opaque + introspection", n(O.fluxTotalIntrospection.moyenne) + " ms",
     n(O.fluxTotalIntrospection.mediane) + " ms", n(O.fluxTotalIntrospection.p95) + " ms",
     "1,00×"],
    ["OAuth 2.0", "JWT RS256 auto-porteur", n(O.fluxTotalJwt.moyenne) + " ms",
     n(O.fluxTotalJwt.mediane) + " ms", n(O.fluxTotalJwt.p95) + " ms",
     n(O.fluxTotalJwt.moyenne / O.fluxTotalIntrospection.moyenne) + "×"],
    [{ t: "ZK-OAuthChain", b: true }, "preuve ZK + vérification en lecture",
     { t: n(T.latenceFluxLecture.moyenne) + " ms", b: true },
     n(T.latenceFluxLecture.mediane) + " ms", n(T.latenceFluxLecture.p95) + " ms",
     { t: n(ratioLecture, 0) + "×", b: true }],
    ["ZK-OAuthChain", "preuve ZK + consommation on-chain",
     n(T.latenceFluxEcriture.moyenne) + " ms", n(T.latenceFluxEcriture.mediane) + " ms",
     n(T.latenceFluxEcriture.p95) + " ms", n(ratioEcriture, 0) + "×"],
  ],
  [17, 30, 15, 13, 13, 12], ["l", "l", "r", "r", "r", "r"]));
A(P("ZK-OAuthChain est environ " + n(ratioLecture, 0) + " fois plus lent qu'un flux OAuth 2.0 " +
    "classique sur le flux complet. Ce rapport, brut, doit cependant être décomposé pour être " +
    "interprété correctement."));
A(P("D'abord, il est presque entièrement imputable à la génération de preuve, qui compte pour " +
    n(partPreuve, 1) + " % du temps total. Comparée à périmètre équivalent, l'étape de " +
    "validation proprement dite coûte " + n(T.verificationSurChaine.moyenne) +
    " ms contre " + n(O.ressourceIntrospection.moyenne) + " ms pour une introspection OAuth, " +
    "soit un rapport de " + n(ratioVerif, 0) + "× — environ " +
    n(ratioLecture / ratioVerif, 0) + " fois plus faible que le rapport observé sur le flux " +
    "complet."));
A(P("Ensuite, la preuve est produite une fois par autorisation et par le client, non par " +
    "l'infrastructure : elle ne consomme ni ressource serveur ni capacité de traitement " +
    "mutualisée, contrairement à l'introspection, qui sollicite le serveur d'autorisation à " +
    "chaque validation et constitue précisément le goulot d'étranglement et le point de " +
    "défaillance que l'architecture vise à supprimer."));
A(P("Enfin, la comparaison ne porte pas sur des services fonctionnellement identiques. OAuth " +
    "2.0 ne fournit ni décentralisation, ni confidentialité vis-à-vis du valideur, ni " +
    "auditabilité publique, ni liaison de contexte opposable. La section suivante montre en " +
    "outre que l'essentiel de l'écart mesuré tient à l'outillage de preuve, et non à la " +
    "conception du protocole."));

A(H("7.5. Positionnement face à l'état de l'art 2025-2026", 2));
A(Legende("Tableau 7 — Comparaison avec les travaux les plus proches"));
A(Tableau(
  ["Travail", "Système (setup)", "Outillage", "Contraintes", "Preuve", "Vérif.", "Taille",
   "Gas vérif."],
  [
    ...sota.travaux.map((t) => [
      t.nom, t.setupDeConfiance, t.outillage,
      t.contraintes == null ? "n. r." : e(t.contraintes),
      ms(t.preuveMs), ms(t.verificationMs),
      ko(t.taillePreuveOctets) + (t.taillePreuveRapportee ? "" : "*"),
      t.gasVerification == null ? "n. r." : e(t.gasVerification),
    ]),
    [{ t: "ZK-OAuthChain", b: true }, { t: "Groth16 — setup par circuit", b: true },
     { t: "JS / snarkjs (WASM)", b: true }, { t: e(zk.circuit.contraintes), b: true },
     { t: ms(T.preuveGroth16Seule.mediane), b: true },
     { t: ms(T.verificationHorsChaine.mediane), b: true },
     { t: ko(zk.tailles.preuveGroth16Octets), b: true },
     { t: e(G.verificationPreuveSeule.moyenne), b: true }],
  ],
  [15, 16, 15, 10, 11, 10, 10, 13], ["l", "l", "l", "r", "r", "r", "r", "r"]));
A(Note("n. r. : non rapporté par les auteurs. * : taille non rapportée, valeur structurelle " +
       "de Groth16 sur BN254. Les temps sont des médianes, mesurés hors-chaîne de part et " +
       "d'autre. Les matériels diffèrent — Apple M3 Pro pour zkAt et ZK-ACE — de même que les " +
       "fonctionnalités des circuits : toute comparaison des temps absolus serait trompeuse."));
A(PR([
  ["À taille de circuit quasi identique, l'écart est imputable à l'outillage. ", { bold: true }],
  ["zkAt compte " + e(zkat.contraintes) + " contraintes contre " + e(zk.circuit.contraintes) +
   " ici, soit une différence de " + n(ecartTailleCircuit, 0) + " %. Le rapport des temps de " +
   "preuve est pourtant de " + n(ecartOutillage, 0) + "× (" + ms(T.preuveGroth16Seule.mediane) +
   " contre " + ms(zkat.preuveMs) + "). Cet écart mesure la distance entre un prouveur natif " +
   "(Go/gnark) et un prouveur WebAssembly (snarkjs) : il ne reflète pas une différence de " +
   "conception du protocole. Porter le prouveur sur une implémentation native ramènerait la " +
   "latence du flux dans l'ordre de grandeur de la centaine de millisecondes, sans modifier " +
   "ni le circuit, ni le contrat, ni les coûts en gas rapportés ici.", {}],
]));
A(PR([
  ["Le coût on-chain se situe dans la fourchette de l'état de l'art. ", { bold: true }],
  ["La vérification d'une preuve coûte ici " + e(G.verificationPreuveSeule.moyenne) +
   " gas, contre " + e(linkdid.gasVerification) + " pour LinkDID (zk-SNARK) et " +
   e(stark.gasVerification) + " pour le cadre zk-STARK de Hui Yuan (2025) [17]. " +
   "L'ancrage des racines " +
   "coûte " + e(zk.gasAncrageRacines) + " gas, contre " + e(stark.gasAncrageRacines) +
   " pour la mise à jour de l'accumulateur de révocation de ce même cadre. Ces trois " +
   "systèmes ne calculent pas la même chose, et l'écart entre eux n'est donc pas imputable à " +
   "une cause unique ; l'ordre de grandeur, lui, est le même. Le coût propre de la liaison de " +
   "contexte se mesure en revanche sans ambiguïté par comparaison interne : sur une version " +
   "antérieure du même circuit, dépourvue de liaison et n'exposant que 4 signaux publics, la " +
   "vérification coûtait 212 256 gas, soit " +
   e(G.verificationPreuveSeule.moyenne - 212256) + " gas de moins. C'est le prix explicite " +
   "de la propriété de sécurité gagnée.", {}],
]));
A(PR([
  ["La taille de preuve reste l'avantage décisif de Groth16. ", { bold: true }],
  [zk.tailles.preuveGroth16Octets + " octets contre " + ko(stark.taillePreuveOctets) +
   " pour zk-STARK, soit un facteur " +
   e(stark.taillePreuveOctets / zk.tailles.preuveGroth16Octets) +
   ", au prix d'un setup de confiance spécifique au circuit. ZK-ACE (" +
   e(zkace.contraintes) + " contraintes, " + ms(zkace.preuveMs) + ") n'est en revanche pas " +
   "directement comparable : son circuit ne comporte ni appartenance de Merkle ni preuve " +
   "d'exclusion, d'où un facteur " + n(zk.circuit.contraintes / zkace.contraintes, 1) +
   " sur le nombre de contraintes.", {}],
]));

// ---- 8. Discussion
A(new Paragraph({ children: [new PageBreak()] }));
A(H("8. Discussion", 1));
A(P("Les résultats précédents valident la faisabilité technique de ZK-OAuthChain : le circuit " +
    "compile et produit des preuves succinctes, le contrat les vérifie à coût constant, la " +
    "liaison de contexte est imposée au niveau du protocole, et les invariants de sécurité " +
    "sont établis par deux chaînes de vérification indépendantes. Plusieurs limites, connues " +
    "et assumées, délimitent la portée de ces résultats."));

A(H("8.1. Le Serveur d'Autorisation voit encore le jeton", 2));
A(P("Dans l'architecture présentée, l'AS émet le jeton et calcule l'engagement : il connaît " +
    "donc le secret que la preuve protège, ce que formalise l'hypothèse d'honnêteté de la " +
    "Section 4.1. La confidentialité obtenue est réelle vis-à-vis de la chaîne, du Serveur de " +
    "Ressource et de tout observateur, mais non vis-à-vis de l'AS. La suppression du SPOF " +
    "porte sur la disponibilité et sur la validation — l'AS n'est plus sollicité à chaque " +
    "accès — et non sur la connaissance du secret. Lever cette hypothèse suppose que le " +
    "porteur contribue au secret sans le révéler à l'émetteur ; c'est l'objet d'un travail " +
    "complémentaire."));

A(H("8.2. Setup de confiance et horizon post-quantique", 2));
A(P("Groth16 exige un setup de confiance propre au circuit. Les miroirs publics de la " +
    "cérémonie Hermez n'étant plus accessibles au moment de ces travaux, le prototype recourt " +
    "à une cérémonie locale à contributeur unique, ce qui est acceptable pour une validation " +
    "de faisabilité mais ne l'est pas en production. Ce choix n'est pas isolé : les travaux " +
    "les plus récents du domaine, ZK-ACE et zkAt inclus, retiennent également Groth16, pour " +
    "les mêmes raisons de compacité et de coût de vérification."));
A(PR([
  ["Deux objections distinctes, une seule réponse possible. ", { bold: true }],
  ["La première est le setup de confiance lui-même. La seconde, plus structurante, est que " +
   "Groth16 repose sur des couplages sur courbe elliptique : il n'est pas résistant à un " +
   "adversaire quantique. Or, comme la Section 2.5 le relève, les deux cadres récents dont la " +
   "motivation est explicitement post-quantique — ZK-ACE et le passeport numérique de " +
   "Radanliev et al. — migrent leurs signatures vers les primitives NIST tout en conservant " +
   "un système de preuve classique. La propriété post-quantique annoncée au niveau du système " +
   "s'arrête donc à la couche de preuve. Ce travail partage exactement cette limite, et nous " +
   "la signalons plutôt que de la laisser implicite.", {}],
]));
A(P("Un schéma à setup universel tel que PLONK répondrait à la première objection, mais non à " +
    "la seconde : il reste fondé sur des couplages. Les systèmes transparents de type zk-STARK " +
    "répondent aux deux d'un même mouvement — aucun setup, et une sécurité plausiblement " +
    "post-quantique, puisque leur solidité ne repose que sur des fonctions de hachage. ZK-ACE " +
    "les désigne d'ailleurs explicitement comme l'option transparente et plausiblement " +
    "post-quantique, et déclare sa propre construction agnostique au système de preuve."));
A(P("La conception présentée ici admet la même agnosticité, et pour une raison précise : les " +
    "cinq contraintes de la Section 3.3 ne sont que des évaluations de hachage ZK-friendly et " +
    "des vérifications d'arbre. Aucune arithmétique de signature ni opération spécifique à un " +
    "système de preuve n'est placée dans le circuit. Les invariants de la Section 5 portent " +
    "sur l'état du contrat et abstraient le vérificateur par un oracle booléen : ils demeurent " +
    "valides sous tout backend. Une migration vers un backend STARK ne toucherait donc ni la " +
    "structure du circuit, ni les invariants, ni la liaison de contexte."));
A(P("Cette migration a néanmoins un coût, et il est mesuré dans la littérature plutôt " +
    "qu'hypothétique. Le cadre zk-STARK de Hui Yuan rapporte des preuves d'environ " +
    ko(stark.taillePreuveOctets) + " — soit un facteur " +
    e(stark.taillePreuveOctets / zk.tailles.preuveGroth16Octets) + " par rapport aux " +
    zk.tailles.preuveGroth16Octets + " octets obtenus ici — et une vérification on-chain " +
    "d'environ " + e(stark.gasVerification) + " gas, contre " +
    e(G.verificationPreuveSeule.moyenne) + " gas dans notre implémentation. L'arbitrage est " +
    "donc explicite : la transparence et la résistance post-quantique se paient en volume de " +
    "données et en coût de vérification. Il n'est pas tranché ici, et relève du travail " +
    "complémentaire mentionné en conclusion."));

A(H("8.3. Portée de la vérification formelle", 2));
A(P("Les invariants sont établis sur des modèles B à domaine fini et sur le code source " +
    "Solidity, non sur le bytecode déployé. Deux obligations de preuve restent indéterminées " +
    "pour le moteur CHC en raison d'une limite documentée de son raisonnement sur les " +
    "tableaux ; elles sont couvertes par le model-checking exhaustif, mais cette " +
    "complémentarité reste une construction, non une preuve unique et homogène. Par ailleurs, " +
    "les définitions de la Section 4 sont accompagnées d'esquisses de réduction et non de " +
    "démonstrations complètes : formaliser ces réductions, et les mécaniser, constitue une " +
    "suite naturelle."));

A(H("8.4. Passage à l'échelle", 2));
A(P("Le coût de vérification est constant, ce qui est favorable, mais " +
    e(G.autorisationComplete.moyenne) + " gas par autorisation consommée on-chain reste " +
    "significatif sur le réseau principal. Trois voies d'atténuation se dégagent : la " +
    "validation en lecture, sans transaction, lorsque l'opposabilité globale de l'anti-rejeu " +
    "n'est pas requise ; l'agrégation par composition récursive, que ZK-ACE identifie comme " +
    "extension naturelle de ce type de circuit ; et le déploiement sur une solution de couche " +
    "2, dont l'évaluation n'a pas été conduite ici. Côté client, le portage du prouveur sur " +
    "une implémentation native est la mesure au meilleur rapport coût-bénéfice, comme " +
    "l'établit la Section 7.5."));
A(P("Ces limites — confidentialité vis-à-vis de l'AS et passage à l'échelle — ne sont pas des " +
    "défauts d'implémentation mais des questions de recherche à part entière, qui excèdent le " +
    "cadre d'une démonstration de faisabilité."));

// ---- 9. Conclusion
A(H("9. Conclusion", 1));
A(P("Cet article a présenté ZK-OAuthChain, une architecture d'autorisation décentralisée, " +
    "confidentielle et formellement vérifiable, et en a démontré la faisabilité technique par " +
    "une implémentation complète et son évaluation expérimentale."));
A(P("Les résultats obtenus sont les suivants. Le circuit, qui prouve conjointement la liaison " +
    "de contexte, le hachage d'engagement, l'appartenance de Merkle et la non-révocation, " +
    "compile en " + e(zk.circuit.contraintes) + " contraintes et produit une preuve Groth16 " +
    "de " + zk.tailles.preuveGroth16Octets + " octets. Le contrat vérifie cette preuve pour " +
    e(G.verificationPreuveSeule.moyenne) + " gas, coût rigoureusement constant, et traite une " +
    "autorisation complète pour " + e(G.autorisationComplete.moyenne) + " gas — un coût " +
    "comparable à celui des systèmes zk-SNARK de l'état de l'art. La vérification formelle a " +
    "été exécutée, non seulement décrite : elle a exhibé puis corrigé un défaut réel de la " +
    "spécification initiale, et établit désormais les invariants par model-checking exhaustif " +
    "sur " + e(durci.etatsAnalyses + liaison.etatsAnalyses) + " états, complété par " +
    prouvees.length + " obligations démontrées directement sur le code Solidity."));
A(P("La leçon principale tirée de l'analyse de zkLogin a été intégrée au niveau du protocole " +
    "et non du déploiement : l'engagement scelle le quadruplet (émetteur, audience, sujet, " +
    "Serveur de Ressource) ainsi qu'un séparateur de domaine, et cette liaison est à la fois " +
    "cryptographique — un contexte falsifié rend le circuit insatisfiable — et contractuelle. " +
    "Enfin, la comparaison avec zkAt, dont le circuit est de taille quasi identique, établit " +
    "que l'écart de latence mesuré face à OAuth 2.0 relève de l'outillage de preuve et non de " +
    "la conception du protocole."));
A(P("Les questions de confidentialité vis-à-vis du Serveur d'Autorisation et de passage à " +
    "l'échelle, identifiées en discussion comme les deux limites structurantes du modèle, " +
    "font l'objet d'un travail complémentaire."));

// ---- Références
A(H("Références", 1));
const refs = [
  "[1] J.-R. Abrial, The B-Book: Assigning Programs to Meanings, Cambridge University Press, 1996.",
  "[2] F. Baba, A. Mammar et al., « Modélisation et vérification formelle de contrats " +
  "intelligents Solidity avec la Méthode B », Rapport de recherche, Université Paris-Saclay, 2024.",
  "[3] K. Bhargavan, B. Grégoire, P.-Y. Strub et al., « Formal Verification of Smart " +
  "Contracts », IEEE Security & Privacy, vol. 19, n° 2, 2021.",
  "[4] N. Fotiou, V. A. Siris, D. Lagutin et al., « OAuth 2.0 Authorization Using " +
  "Blockchain-Based Tokens », NDSS Workshop on Decentralized IoT Security (DIoT), 2020.",
  "[5] S. Goldwasser, S. Micali et C. Rackoff, « The Knowledge Complexity of Interactive " +
  "Proof Systems », SIAM Journal on Computing, vol. 18, n° 1, 1989.",
  "[6] D. Hardt, « The OAuth 2.0 Authorization Framework », IETF RFC 6749, 2012.",
  "[7] T. Lodderstedt, M. McGloin et P. Hunt, « OAuth 2.0 Threat Model and Security " +
  "Considerations », IETF RFC 6819, 2013.",
  "[8] J. Groth, « On the Size of Pairing-Based Non-interactive Arguments », EUROCRYPT 2016, " +
  "LNCS 9666, Springer, 2016.",
  "[9] L. Grassi, D. Khovratovich, C. Rechberger, A. Roy et M. Schofnegger, « Poseidon: A New " +
  "Hash Function for Zero-Knowledge Proof Systems », USENIX Security Symposium, 2021.",
  "[10] Aleo Labs, « zk-Login: Decentralized Authentication Using zk-SNARKs », documentation " +
  "technique, Aleo Network, 2024.",
  "[11] S. Celi, H. Haddadi et K. Den Hartog, « Analysis and Vulnerabilities in zkLogin », " +
  "Brave Software et Imperial College London, 2026.",
  "[12] J. S. Wang, « ZK-ACE: Identity-Centric Zero-Knowledge Authorization for Post-Quantum " +
  "Blockchain Systems », arXiv:2603.07974v2, 2026.",
  "[13] K. Kryptos Chalkias, D. Maram, A. Roy, J. Wang et A. Yadav, « Zero-Knowledge " +
  "Authenticator for Blockchain: Policy-Private and Obliviously Updateable », Mysten Labs et " +
  "George Mason University, 2025.",
  "[14] R. Davila, E. Barcenas et R. Aldeco-Pérez, « Verificación Formal de Contratos " +
  "Inteligentes: Una Revisión Sistemática de la Literatura », Abstraction & Application, " +
  "vol. 50, UADY, 2025.",
  "[15] N. Sakimura, J. Bradley et N. Agarwal, « Proof Key for Code Exchange by OAuth Public " +
  "Clients », IETF RFC 7636, 2015.",
  "[16] J. Richer, « OAuth 2.0 Token Introspection », IETF RFC 7662, 2015.",
  "[17] Hui Yuan, « A Scalable, Privacy-Preserving Decentralized Identity and Verifiable Data " +
  "Sharing Framework based on Zero-Knowledge Proofs », Peking University, 2025.",
  "[18] L. Alt et C. Reitwiessner, « SMT-Based Verification of Solidity Smart Contracts », " +
  "ISoLA 2018, LNCS 11247, Springer, 2018.",
  "[19] M. Leuschel et M. Butler, « ProB: A Model Checker for B », FME 2003, LNCS 2805, " +
  "Springer, 2003.",
  "[20] P. Radanliev, C. Maple et O. Santos, « Complying with the NIST post-quantum " +
  "cryptography standards and decentralizing artificial intelligence », Frontiers, 2025.",
];
for (const r of refs) {
  A(new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 90, line: 260 },
    indent: { left: 340, hanging: 340 },
    children: [new TextRun({ text: r, size: 19, font: FONT })],
  }));
}

// ---- Annexe
A(new Paragraph({ children: [new PageBreak()] }));
A(H("Annexe A — Reproductibilité", 1));
A(P("L'ensemble des résultats rapportés est reproductible par la séquence suivante. Chaque " +
    "commande régénère les fichiers de mesures à partir desquels les tableaux de cet article " +
    "sont construits automatiquement : le document ne peut donc pas diverger des mesures."));
A(...Mono([
  "npm install && npm run bootstrap",
  "npm run circuit:build     # compilation Circom, Powers of Tau, setup Groth16",
  "npm run compile           # contrats Solidity",
  "npm test                  # 14 tests on-chain, dont les 3 scénarios zkLogin",
  "npm run verify            # ProB (Méthode B) + SMTChecker (CHC/z3)",
  "npx hardhat node          # nœud EVM local, dans un terminal dédié",
  "npm run deploy:local",
  "npm run bench:zk          # " + zk.iterations + " autorisations mesurées",
  "npm run bench:oauth       # " + oa.iterations + " flux OAuth 2.0 de référence",
  "npm run bench:compare     # tableaux comparatifs",
]));
A(P("Le déploiement sur Sepolia s'obtient en renseignant un point d'accès RPC et une clé de " +
    "compte de test dans le fichier d'environnement, puis en exécutant la commande de " +
    "déploiement correspondante. Les mesures rapportées ici ont été produites le " +
    new Date(zk.horodatage).toLocaleDateString("fr-FR") + "."));

// ----------------------------------------------------------- document
const doc = new Document({
  creator: "ZK-OAuthChain",
  title: "ZK-OAuthChain — liaison de contexte, vérification formelle et évaluation expérimentale",
  numbering: {
    config: [
      { reference: "puces", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•",
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 460, hanging: 240 } } } }] },
      { reference: "numeros", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.",
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 460, hanging: 240 } } } }] },
    ],
  },
  sections: [{
    properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, font: FONT })],
        })],
      }),
    },
    children: contenu,
  }],
});

fs.mkdirSync("livrables", { recursive: true });
const sortie = path.join("livrables", "ZK-OAuthChain_article_revise.docx");
Packer.toBuffer(doc).then((b) => {
  fs.writeFileSync(sortie, b);
  console.log("Écrit -> " + sortie + " (" + (b.length / 1024).toFixed(0) + " Ko)");
});
