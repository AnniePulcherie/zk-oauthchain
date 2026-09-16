const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ZK-OAuthChain -- contrat d'autorisation", function () {
  this.timeout(300000);

  let lib, as, registry, verifierAddr, owner, asSigner, rs, autre;
  let grant, challenge, calldata, rsId;

  const NONCE = () => `nonce-${Math.random().toString(36).slice(2)}`;

  before(async () => {
    lib = await import("../lib/zkoauth.mjs");
    [owner, asSigner, rs, autre] = await ethers.getSigners();

    const Verifier = await ethers.getContractFactory("Groth16Verifier");
    const verifier = await Verifier.deploy();
    await verifier.waitForDeployment();
    verifierAddr = await verifier.getAddress();

    const Registry = await ethers.getContractFactory("ZKAuthRegistry");
    registry = await Registry.deploy(
      verifierAddr, asSigner.address, lib.toField(lib.ISSUER_DEFAULT));
    await registry.waitForDeployment();

    // Le Serveur de Ressource lie son adresse a son identifiant de protocole.
    rsId = lib.toField(lib.RESOURCE_SERVER_DEFAULT);
    await registry.connect(rs).registerResourceServer(rsId);

    const domain = await registry.domainSeparator();
    as = await lib.AuthorizationServer.create({ issuer: lib.ISSUER_DEFAULT, domain });

    // 13 jetons emis, 3 revoques : l'arbre de non-revocation n'est pas vide.
    const grants = [];
    for (let i = 0; i < 13; i++) {
      grants.push(as.issueToken({
        subject: `user${i}`, client: lib.CLIENT_DEFAULT,
        resourceServer: lib.RESOURCE_SERVER_DEFAULT, scope: "read:accounts",
      }));
    }
    grant = grants[7];
    for (const idx of [1, 4, 11]) await as.revoke(grants[idx].commitment);

    const { issuanceRoot, revocationRoot } = as.roots();
    await registry.connect(asSigner).setRoots(issuanceRoot, revocationRoot);

    challenge = lib.AuthorizationServer.challenge("read:accounts", NONCE(), 1900000000);
    const w = await as.witness(grant, challenge);
    const { proof, publicSignals } = await lib.proveAuthorization(w);
    calldata = lib.toSolidityCalldata(proof, publicSignals);
  });

  it("ancre les racines et ouvre l'epoque 1", async () => {
    expect(await registry.epoch()).to.equal(1n);
    expect(await registry.revocationRoot()).to.not.equal(0n);
  });

  it("accepte une preuve valide (contexte + engagement + Merkle + non-revocation)", async () => {
    const ok = await registry.verifyAuthorization(
      calldata.pA, calldata.pB, calldata.pC, calldata.pubSignals, rs.address);
    expect(ok).to.equal(true);
  });

  it("octroie l'acces, consomme le nullifieur et l'attribue au bon RP", async () => {
    await expect(registry.connect(rs).authorize(
      calldata.pA, calldata.pB, calldata.pC, calldata.pubSignals))
      .to.emit(registry, "AccessGranted");
    expect(await registry.nullifierUsed(calldata.pubSignals[0])).to.equal(true);
    expect(await registry.grantedEpoch(calldata.pubSignals[0])).to.equal(1n);
    expect(await registry.grantedRsId(calldata.pubSignals[0])).to.equal(rsId);
  });

  it("rejette le rejeu de la meme preuve", async () => {
    await expect(registry.connect(rs).authorize(
      calldata.pA, calldata.pB, calldata.pC, calldata.pubSignals))
      .to.be.revertedWithCustomError(registry, "NullifierAlreadyUsed");
  });

  // --- Liaison de contexte : les trois attaques identifiees sur zkLogin -------

  it("zkLogin #1 -- rejette une preuve consommee par un autre Serveur de Ressource", async () => {
    // `autre` s'enregistre legitimement, puis tente de consommer une preuve
    // destinee au RP `rs`. L'identifiant scelle dans la preuve ne correspond pas.
    await registry.connect(autre).registerResourceServer(lib.toField("rs.autre.example"));

    const w = await as.witness(grant, lib.AuthorizationServer.challenge(
      "read:accounts", NONCE(), 1900000000));
    const { proof, publicSignals } = await lib.proveAuthorization(w);
    const cd = lib.toSolidityCalldata(proof, publicSignals);

    await expect(registry.connect(autre).authorize(cd.pA, cd.pB, cd.pC, cd.pubSignals))
      .to.be.revertedWithCustomError(registry, "ResourceServerMismatch");
    // ... alors que le RP legitime l'accepte.
    expect(await registry.verifyAuthorization(
      cd.pA, cd.pB, cd.pC, cd.pubSignals, rs.address)).to.equal(true);
  });

  it("zkLogin #2 -- rejette une preuve issue d'un emetteur non declare", async () => {
    const autreAs = await lib.AuthorizationServer.create({
      issuer: "as.malveillant.example", domain: await registry.domainSeparator() });
    const g = autreAs.issueToken({
      subject: "alice", client: lib.CLIENT_DEFAULT,
      resourceServer: lib.RESOURCE_SERVER_DEFAULT });
    await registry.connect(asSigner).setRoots(
      autreAs.roots().issuanceRoot, autreAs.roots().revocationRoot);

    const w = await autreAs.witness(g, lib.AuthorizationServer.challenge(
      "read:accounts", NONCE(), 1900000000));
    const { proof, publicSignals } = await lib.proveAuthorization(w);
    const cd = lib.toSolidityCalldata(proof, publicSignals);

    await expect(registry.connect(rs).authorize(cd.pA, cd.pB, cd.pC, cd.pubSignals))
      .to.be.revertedWithCustomError(registry, "UnknownIssuer");

    const r = as.roots();   // retablit l'etat pour la suite
    await registry.connect(asSigner).setRoots(r.issuanceRoot, r.revocationRoot);
  });

  it("zkLogin #3 -- rejette une preuve produite pour un autre domaine", async () => {
    const autreDomaine = await lib.AuthorizationServer.create({
      issuer: lib.ISSUER_DEFAULT, domain: 123456789n });
    const g = autreDomaine.issueToken({
      subject: "alice", client: lib.CLIENT_DEFAULT,
      resourceServer: lib.RESOURCE_SERVER_DEFAULT });
    await registry.connect(asSigner).setRoots(
      autreDomaine.roots().issuanceRoot, autreDomaine.roots().revocationRoot);

    const w = await autreDomaine.witness(g, lib.AuthorizationServer.challenge(
      "read:accounts", NONCE(), 1900000000));
    const { proof, publicSignals } = await lib.proveAuthorization(w);
    const cd = lib.toSolidityCalldata(proof, publicSignals);

    await expect(registry.connect(rs).authorize(cd.pA, cd.pB, cd.pC, cd.pubSignals))
      .to.be.revertedWithCustomError(registry, "WrongDomain");

    const r = as.roots();
    await registry.connect(asSigner).setRoots(r.issuanceRoot, r.revocationRoot);
  });

  it("la liaison est cryptographique : un contexte falsifie rend le circuit insatisfiable",
    async () => {
      // Le controle du contrat n'est qu'une seconde ligne de defense. Declarer un
      // autre Serveur de Ressource dans les signaux publics casse l'appartenance
      // Merkle : aucune preuve ne peut etre produite.
      const w = await as.witness(grant, lib.AuthorizationServer.challenge(
        "read:accounts", NONCE(), 1900000000));
      w.resourceServerId = lib.toField("rs.autre.example").toString();

      let echec = null;
      try { await lib.proveAuthorization(w); } catch (e) { echec = e; }
      expect(echec, "la generation de preuve aurait du echouer").to.not.equal(null);
    });

  // --- Fraicheur et integrite ------------------------------------------------

  it("rejette une preuve portant sur une racine perimee", async () => {
    const w = await as.witness(grant, lib.AuthorizationServer.challenge(
      "read:accounts", NONCE(), 1900000000));
    const { proof, publicSignals } = await lib.proveAuthorization(w);
    const cd = lib.toSolidityCalldata(proof, publicSignals);

    await as.revoke(as.issueToken({
      subject: "mallory", client: lib.CLIENT_DEFAULT,
      resourceServer: lib.RESOURCE_SERVER_DEFAULT }).commitment);
    const r = as.roots();
    await registry.connect(asSigner).setRoots(r.issuanceRoot, r.revocationRoot);

    await expect(registry.connect(rs).authorize(cd.pA, cd.pB, cd.pC, cd.pubSignals))
      .to.be.revertedWithCustomError(registry, "StaleRoots");
  });

  it("rejette une preuve falsifiee", async () => {
    const r = as.roots();
    const bad = [...calldata.pubSignals];
    bad[0] = (BigInt(bad[0]) + 1n).toString();
    bad[1] = r.issuanceRoot.toString();
    bad[2] = r.revocationRoot.toString();
    await expect(registry.connect(rs).authorize(calldata.pA, calldata.pB, calldata.pC, bad))
      .to.be.revertedWithCustomError(registry, "InvalidProof");
  });

  // --- Invariants du registre ------------------------------------------------

  it("I1 -- la revocation detache l'engagement et est irreversible", async () => {
    const c = 12345678901234567890n;
    await registry.connect(rs).registerCommitment(c);
    expect(await registry.commitmentOf(rs.address)).to.equal(c);

    await registry.connect(asSigner).revokeCommitment(rs.address);
    expect(await registry.commitmentOf(rs.address)).to.equal(0n);
    expect(await registry.revoked(c)).to.equal(true);

    await expect(registry.connect(rs).registerCommitment(c))
      .to.be.revertedWithCustomError(registry, "CommitmentIsRevoked");
  });

  it("I1 -- regression : le contre-exemple ProB (aliasing d'engagement) est bloque", async () => {
    // Trace exhibee par ProB sur le modele naif formal/b/ZKAuthRegistry_v0.mch :
    //   registerCommitment(u1, c1) ; registerCommitment(u2, c1) ; revokeCommitment(u2)
    // laissait u1 attache a un engagement revoque. La contrainte d'unicite l'interdit.
    const c = 99887766554433221100n;
    await registry.connect(owner).registerCommitment(c);
    await expect(registry.connect(asSigner).registerCommitment(c))
      .to.be.revertedWithCustomError(registry, "CommitmentAlreadyHeld");

    await registry.connect(asSigner).revokeCommitment(owner.address);
    expect(await registry.revoked(c)).to.equal(true);
    expect(await registry.commitmentOf(owner.address)).to.equal(0n);
    expect(await registry.holderOf(c)).to.equal(ethers.ZeroAddress);
  });

  it("un identifiant de Serveur de Ressource ne peut etre revendique deux fois", async () => {
    await expect(registry.connect(owner).registerResourceServer(rsId))
      .to.be.revertedWithCustomError(registry, "ResourceServerIdTaken");
  });

  it("seul l'AS peut ancrer les racines", async () => {
    await expect(registry.connect(rs).setRoots(1n, 2n))
      .to.be.revertedWithCustomError(registry, "NotAuthorizationServer");
  });
});
