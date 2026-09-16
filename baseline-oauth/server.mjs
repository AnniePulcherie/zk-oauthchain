/**
 * Flux OAuth 2.0 classique servant de reference comparative.
 *
 * Implemente un Serveur d'Autorisation (AS) et un Serveur de Ressource (RS)
 * conformes au RFC 6749 (code d'autorisation + PKCE, RFC 7636) avec deux modes
 * de validation cote RS :
 *   - jeton opaque  + introspection centralisee (RFC 7662)  -> mode "introspection"
 *   - jeton JWT RS256 auto-porteur, verifie localement      -> mode "jwt"
 *
 * Les deux modes sont mesures : le premier illustre le SPOF et l'aller-retour
 * vers l'AS, le second est la variante OAuth la plus rapide, donc la borne
 * basse la plus defavorable a ZK-OAuthChain.
 */
import express from "express";
import crypto from "node:crypto";

export const AS_PORT = 4001;
export const RS_PORT = 4002;

const CLIENT_ID = "zk-oauthchain-bench";
const CLIENT_SECRET = "s3cr3t-de-banc-d-essai";
const REDIRECT_URI = "http://127.0.0.1:4003/cb";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" });

const b64u = (b) => Buffer.from(b).toString("base64url");

function signJwt(payload) {
  const header = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${body}`), privateKey);
  return `${header}.${body}.${sig.toString("base64url")}`;
}

function verifyJwt(token) {
  const [h, b, s] = token.split(".");
  if (!h || !b || !s) return null;
  const ok = crypto.verify("RSA-SHA256", Buffer.from(`${h}.${b}`),
    PUBLIC_PEM, Buffer.from(s, "base64url"));
  if (!ok) return null;
  const payload = JSON.parse(Buffer.from(b, "base64url").toString());
  if (payload.exp * 1000 < Date.now()) return null;
  return payload;
}

export function startServers() {
  const codes = new Map();   // code -> { challenge, subject, scope }
  const tokens = new Map();  // jeton opaque -> { subject, scope, exp, revoked }

  // ---------------- Serveur d'Autorisation ----------------
  const as = express();
  as.use(express.urlencoded({ extended: false }));
  as.use(express.json());

  // RFC 6749 §4.1.1 -- point de terminaison d'autorisation (consentement suppose acquis)
  as.get("/authorize", (req, res) => {
    const { client_id, code_challenge, code_challenge_method, scope, state } = req.query;
    if (client_id !== CLIENT_ID) return res.status(400).json({ error: "invalid_client" });
    if (code_challenge_method !== "S256") return res.status(400).json({ error: "invalid_request" });
    const code = crypto.randomBytes(32).toString("base64url");
    codes.set(code, { challenge: code_challenge, subject: "alice", scope: scope || "read:accounts" });
    res.redirect(302, `${REDIRECT_URI}?code=${code}&state=${state || ""}`);
  });

  // RFC 6749 §4.1.3 -- echange code <-> jeton, avec verification PKCE
  as.post("/token", (req, res) => {
    const { grant_type, code, code_verifier, client_id } = req.body;
    if (grant_type !== "authorization_code") return res.status(400).json({ error: "unsupported_grant_type" });
    if (client_id !== CLIENT_ID) return res.status(401).json({ error: "invalid_client" });
    const entry = codes.get(code);
    if (!entry) return res.status(400).json({ error: "invalid_grant" });
    codes.delete(code);

    const computed = crypto.createHash("sha256").update(code_verifier).digest("base64url");
    if (computed !== entry.challenge) return res.status(400).json({ error: "invalid_grant" });

    const exp = Math.floor(Date.now() / 1000) + 3600;
    const opaque = crypto.randomBytes(32).toString("base64url");
    tokens.set(opaque, { subject: entry.subject, scope: entry.scope, exp, revoked: false });
    const jwt = signJwt({ sub: entry.subject, scope: entry.scope, exp, aud: "api.banque.example" });

    res.json({ access_token: opaque, jwt_access_token: jwt, token_type: "Bearer", expires_in: 3600 });
  });

  // RFC 7662 -- introspection centralisee
  as.post("/introspect", (req, res) => {
    const auth = req.headers.authorization || "";
    const expected = "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
    if (auth !== expected) return res.status(401).json({ error: "invalid_client" });
    const t = tokens.get(req.body.token);
    if (!t || t.revoked || t.exp * 1000 < Date.now()) return res.json({ active: false });
    res.json({ active: true, sub: t.subject, scope: t.scope, exp: t.exp });
  });

  as.post("/revoke", (req, res) => {
    const t = tokens.get(req.body.token);
    if (t) t.revoked = true;
    res.status(200).end();
  });

  // ---------------- Serveur de Ressource ----------------
  const rs = express();
  rs.use(express.json());

  // Mode 1 : jeton opaque -> introspection aupres de l'AS (dependance centrale)
  rs.get("/resource", async (req, res) => {
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    const r = await fetch(`http://127.0.0.1:${AS_PORT}/introspect`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64"),
      },
      body: JSON.stringify({ token }),
    });
    const info = await r.json();
    if (!info.active) return res.status(401).json({ error: "invalid_token" });
    res.json({ data: "solde: 1 234,56 EUR", sub: info.sub });
  });

  // Mode 2 : JWT auto-porteur -> verification locale de signature
  rs.get("/resource-jwt", (req, res) => {
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    const payload = verifyJwt(token);
    if (!payload) return res.status(401).json({ error: "invalid_token" });
    res.json({ data: "solde: 1 234,56 EUR", sub: payload.sub });
  });

  return new Promise((resolve) => {
    const sAs = as.listen(AS_PORT, "127.0.0.1", () => {
      const sRs = rs.listen(RS_PORT, "127.0.0.1", () => {
        resolve({ close: () => { sAs.close(); sRs.close(); } });
      });
    });
  });
}

export const oauthConfig = { CLIENT_ID, CLIENT_SECRET, REDIRECT_URI };
