/**
 * Deploiement de ZK-OAuthChain : verificateur Groth16, registre d'autorisation
 * et sonde de gas. Reseau passe en argument (localhost par defaut, ou sepolia).
 */
import fs from "node:fs";
import { ethers } from "ethers";
import { artifact, connect, deploymentPath, LOCAL_KEY_1 } from "./common.mjs";
import { toField, ISSUER_DEFAULT, RESOURCE_SERVER_DEFAULT } from "../lib/zkoauth.mjs";

const network = process.argv[2] || process.env.NETWORK || "localhost";
const { provider, wallet, signer } = await connect(network);

const bal = await provider.getBalance(wallet.address);
console.log(`Reseau    : ${network}`);
console.log(`Deployeur : ${wallet.address} (${ethers.formatEther(bal)} ETH)`);
if (bal === 0n) throw new Error("Solde nul : alimentez le compte via un faucet Sepolia.");

async function deploy(name, args = []) {
  const a = artifact(name);
  const factory = new ethers.ContractFactory(a.abi, a.bytecode, signer);
  const c = await factory.deploy(...args);
  const tx = c.deploymentTransaction();
  const receipt = await tx.wait();
  const addr = await c.getAddress();
  console.log(`  ${name.padEnd(16)} ${addr}  gas=${receipt.gasUsed}`);
  return { contract: c, address: addr, gasUsed: receipt.gasUsed.toString(), txHash: tx.hash };
}

console.log("\nDeploiement :");
const verifier = await deploy("Groth16Verifier");
// Sur reseau local, le compte #1 joue le role du Serveur d'Autorisation.
const asAddress = process.env.AS_ADDRESS
  || (network === "sepolia" ? wallet.address : new ethers.Wallet(LOCAL_KEY_1).address);
const issuerId = toField(ISSUER_DEFAULT);
const registry = await deploy("ZKAuthRegistry", [verifier.address, asAddress, issuerId]);
const probe = await deploy("GasProbe", [verifier.address]);

// Le Serveur de Ressource lie son adresse a son identifiant de protocole.
// Sans cet enregistrement, aucune preuve ne peut etre consommee : c'est la
// liaison RP exigee par l'analyse de zkLogin.
const rsId = toField(RESOURCE_SERVER_DEFAULT);
const rsTx = await registry.contract.registerResourceServer(rsId);
const rsRec = await rsTx.wait();
console.log(`  ${"ServeurRessource".padEnd(16)} ${wallet.address}  gas=${rsRec.gasUsed}`);
const domainSeparator = await registry.contract.domainSeparator();

const out = {
  reseau: network,
  chainId: Number((await provider.getNetwork()).chainId),
  horodatage: new Date().toISOString(),
  serveurAutorisation: asAddress,
  emetteur: { nom: ISSUER_DEFAULT, id: issuerId.toString() },
  serveurRessource: {
    nom: RESOURCE_SERVER_DEFAULT, id: rsId.toString(),
    adresse: wallet.address, gasEnregistrement: rsRec.gasUsed.toString(),
  },
  separateurDomaine: domainSeparator.toString(),
  contrats: {
    Groth16Verifier: { adresse: verifier.address, gasDeploiement: verifier.gasUsed, tx: verifier.txHash },
    ZKAuthRegistry: { adresse: registry.address, gasDeploiement: registry.gasUsed, tx: registry.txHash },
    GasProbe: { adresse: probe.address, gasDeploiement: probe.gasUsed, tx: probe.txHash },
  },
};
fs.writeFileSync(deploymentPath(network), JSON.stringify(out, null, 2));
console.log(`\nEcrit -> ${deploymentPath(network)}`);
if (network === "sepolia") {
  console.log(`Explorateur : https://sepolia.etherscan.io/address/${registry.address}`);
}
process.exit(0);
