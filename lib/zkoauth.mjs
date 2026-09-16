/**
 * ZK-OAuthChain -- bibliotheque client / Serveur d'Autorisation.
 *
 * Fournit :
 *  - MerkleTree      : arbre des engagements emis (hachage Poseidon, profondeur fixe)
 *  - RevocationTree  : Sparse Merkle Tree des engagements revoques (preuve d'exclusion)
 *  - AuthorizationServer : role AS -- emission de jeton, engagement, temoins
 *  - proveAuthorization  : role Client -- generation de la preuve Groth16
 */
import { buildPoseidon, newMemEmptyTrie } from "circomlibjs";
import * as snarkjs from "snarkjs";
import crypto from "node:crypto";
import path from "node:path";

export const ISSUER_DEFAULT = "as.zk-oauthchain.example";
export const RESOURCE_SERVER_DEFAULT = "rs.api.banque.example";
export const CLIENT_DEFAULT = "app-mobile-banque";

export const LEVELS = 20;
export const REV_LEVELS = 20;
export const FIELD_P =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

let _poseidon = null;
export async function poseidon() {
  if (!_poseidon) _poseidon = await buildPoseidon();
  return _poseidon;
}

/** Reduit un tampon arbitraire en un element du corps BN254. */
export function toField(buf) {
  const hex = crypto.createHash("sha256").update(buf).digest("hex");
  return BigInt("0x" + hex) % FIELD_P;
}

/** Arbre de Merkle binaire a profondeur fixe, feuilles nulles par defaut. */
export class MerkleTree {
  constructor(poseidonInstance, levels = LEVELS) {
    this.p = poseidonInstance;
    this.F = poseidonInstance.F;
    this.levels = levels;
    this.leaves = [];
    this.zeros = [0n];
    for (let i = 1; i <= levels; i++) {
      this.zeros[i] = this._h(this.zeros[i - 1], this.zeros[i - 1]);
    }
  }

  _h(a, b) {
    return this.F.toObject(this.p([this.F.e(a), this.F.e(b)]));
  }

  insert(leaf) {
    this.leaves.push(BigInt(leaf));
    return this.leaves.length - 1;
  }

  /** Renvoie { root, pathElements, pathIndices } pour la feuille d'indice donne. */
  proof(index) {
    let layer = this.leaves.slice();
    const pathElements = [];
    const pathIndices = [];
    let idx = index;

    for (let level = 0; level < this.levels; level++) {
      const isRight = idx & 1;
      const siblingIdx = isRight ? idx - 1 : idx + 1;
      pathElements.push(
        siblingIdx < layer.length ? layer[siblingIdx] : this.zeros[level]
      );
      pathIndices.push(isRight);

      const next = [];
      for (let i = 0; i < layer.length; i += 2) {
        const l = layer[i];
        const r = i + 1 < layer.length ? layer[i + 1] : this.zeros[level];
        next.push(this._h(l, r));
      }
      layer = next.length ? next : [this.zeros[level + 1]];
      idx >>= 1;
    }
    return { root: this.root(), pathElements, pathIndices };
  }

  root() {
    if (this.leaves.length === 0) return this.zeros[this.levels];
    let layer = this.leaves.slice();
    for (let level = 0; level < this.levels; level++) {
      const next = [];
      for (let i = 0; i < layer.length; i += 2) {
        const l = layer[i];
        const r = i + 1 < layer.length ? layer[i + 1] : this.zeros[level];
        next.push(this._h(l, r));
      }
      layer = next;
    }
    return layer[0];
  }
}

/** Sparse Merkle Tree des revocations : supporte la preuve d'exclusion (fnc = 1). */
export class RevocationTree {
  static async create() {
    const t = new RevocationTree();
    t.smt = await newMemEmptyTrie();
    t.F = t.smt.F;
    return t;
  }

  root() {
    return this.F.toObject(this.smt.root);
  }

  async revoke(commitment) {
    await this.smt.insert(this.F.e(commitment), this.F.e(1));
  }

  /** Temoin de NON-appartenance de `commitment` a l'arbre des revocations. */
  async exclusionWitness(commitment) {
    const res = await this.smt.find(this.F.e(commitment));
    if (res.found) throw new Error("engagement revoque : pas de temoin d'exclusion");

    const siblings = res.siblings.map((s) => this.F.toObject(s));
    while (siblings.length < REV_LEVELS) siblings.push(0n);
    if (siblings.length > REV_LEVELS) {
      throw new Error(`profondeur SMT depassee (${siblings.length} > ${REV_LEVELS})`);
    }
    return {
      revSiblings: siblings,
      revOldKey: res.isOld0 ? 0n : this.F.toObject(res.notFoundKey),
      revOldValue: res.isOld0 ? 0n : this.F.toObject(res.notFoundValue),
      revIsOld0: res.isOld0 ? 1n : 0n,
    };
  }
}

/**
 * Serveur d'Autorisation : authentifie l'utilisateur (hors perimetre ZK),
 * emet le jeton, calcule l'engagement et ancre les racines.
 *
 * L'engagement scelle le contexte d'autorisation complet -- emetteur, audience,
 * sujet, Serveur de Ressource, domaine -- conformement a la mitigation exigee par
 * l'analyse de zkLogin (Celi et al., 2026). Le sujet reste prive : il est lie sans
 * jamais etre divulgue.
 */
export class AuthorizationServer {
  /**
   * @param {object} config
   * @param {string} config.issuer  identifiant de l'emetteur (iss)
   * @param {bigint} config.domain  separateur de domaine, lu sur le contrat
   */
  static async create({ issuer = "as.zk-oauthchain.example", domain = 0n } = {}) {
    const as = new AuthorizationServer();
    as.p = await poseidon();
    as.F = as.p.F;
    as.tree = new MerkleTree(as.p);
    as.revocations = await RevocationTree.create();
    as.issued = new Map();
    as.issuer = issuer;
    as.issuerId = toField(issuer);
    as.domain = BigInt(domain);
    return as;
  }

  _hash(inputs) {
    return this.F.toObject(this.p(inputs.map((x) => this.F.e(x))));
  }

  /** ctx = Poseidon(iss, aud, sub, rs, domain) -- contrainte C1 du circuit. */
  context(clientId, subject, resourceServerId) {
    return this._hash([this.issuerId, clientId, subject, resourceServerId, this.domain]);
  }

  /**
   * Emet un jeton OAuth 2.0 et son engagement h = Poseidon(token, ctx, meta).
   * @param {object} d
   * @param {string} d.subject          sujet (sub), reste prive
   * @param {string} d.client           identifiant du client OAuth (aud)
   * @param {string} d.resourceServer   identifiant du Serveur de Ressource vise
   * @param {string} d.scope            portee demandee
   * @param {number} d.expiresAt        expiration (epoch secondes)
   */
  issueToken({ subject, client, resourceServer, scope = "read:accounts", expiresAt = 1900000000 }) {
    const token = toField(crypto.randomBytes(32));
    const subjectId = toField(`${this.issuer}|${subject}`);   // sub interprete dans l'espace de l'emetteur
    const clientId = toField(client);
    const resourceServerId = toField(resourceServer);
    const meta = toField(`${scope}|${expiresAt}`);

    const ctx = this.context(clientId, subjectId, resourceServerId);
    const h = this._hash([token, ctx, meta]);
    const index = this.tree.insert(h);

    const grant = {
      token, subjectId, clientId, resourceServerId, meta, ctx,
      commitment: h, index, subject, client, resourceServer, scope, expiresAt,
    };
    this.issued.set(h.toString(), grant);
    return grant;
  }

  async revoke(commitment) {
    await this.revocations.revoke(commitment);
  }

  roots() {
    return { issuanceRoot: this.tree.root(), revocationRoot: this.revocations.root() };
  }

  /** Defi de fraicheur emis par le Serveur de Ressource : H(portee, alea, expiration). */
  static challenge(scope, nonce, expiry) {
    return toField(`${scope}|${nonce}|${expiry}`);
  }

  /** Assemble le temoin complet du circuit pour un octroi donne. */
  async witness(grant, challenge) {
    const mt = this.tree.proof(grant.index);
    const ex = await this.revocations.exclusionWitness(grant.commitment);
    return {
      root: mt.root.toString(),
      revRoot: this.revocations.root().toString(),
      issuerId: this.issuerId.toString(),
      clientId: grant.clientId.toString(),
      resourceServerId: grant.resourceServerId.toString(),
      domain: this.domain.toString(),
      challenge: challenge.toString(),
      token: grant.token.toString(),
      subject: grant.subjectId.toString(),
      meta: grant.meta.toString(),
      pathElements: mt.pathElements.map(String),
      pathIndices: mt.pathIndices.map(String),
      revSiblings: ex.revSiblings.map(String),
      revOldKey: ex.revOldKey.toString(),
      revOldValue: ex.revOldValue.toString(),
      revIsOld0: ex.revIsOld0.toString(),
    };
  }
}

/** Derive un element du corps a partir d'un identifiant textuel (iss, aud, rs). */
export const identifiant = toField;

const WASM = path.resolve("build/zkauth_js/zkauth.wasm");
const ZKEY = path.resolve("build/zkauth_final.zkey");

/**
 * Libere le pool de threads de la courbe BN254.
 * snarkjs ne le fait pas : sans cet appel, chaque preuve laisse ses workers
 * actifs et les generations successives se degradent d'un facteur 4.
 */
export async function releaseCurve() {
  if (globalThis.curve_bn128) {
    await globalThis.curve_bn128.terminate();
    globalThis.curve_bn128 = null;
  }
}

/** Cote Client : genere la preuve Groth16 a partir du temoin. */
export async function proveAuthorization(witnessInput, { release = false } = {}) {
  try {
    return await snarkjs.groth16.fullProve(witnessInput, WASM, ZKEY);
  } finally {
    if (release) await releaseCurve();
  }
}

/** Verification hors-chaine, avec liberation des ressources. */
export async function verifyOffchain(vkey, publicSignals, proof) {
  try {
    return await snarkjs.groth16.verify(vkey, publicSignals, proof);
  } finally {
    await releaseCurve();
  }
}

/** Met la preuve au format attendu par le verificateur Solidity. */
export function toSolidityCalldata(proof, publicSignals) {
  return {
    pA: [proof.pi_a[0], proof.pi_a[1]],
    pB: [
      [proof.pi_b[0][1], proof.pi_b[0][0]],
      [proof.pi_b[1][1], proof.pi_b[1][0]],
    ],
    pC: [proof.pi_c[0], proof.pi_c[1]],
    pubSignals: publicSignals,
  };
}
