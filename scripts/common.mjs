import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import "dotenv/config";

/**
 * Comptes de test #0 et #1 de Hardhat. Ces cles sont publiques et documentees :
 * elles ne valent que sur un noeud local et ne doivent jamais detenir de fonds reels.
 * Le deploiement Sepolia lit DEPLOYER_PRIVATE_KEY depuis .env, jamais versionne.
 */
export const LOCAL_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
export const LOCAL_KEY_1 =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

export function artifact(name) {
  const p = path.join("artifacts/contracts", `${name}.sol`, `${name}.json`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function networkConfig(network) {
  if (network === "sepolia") {
    const url = process.env.SEPOLIA_RPC_URL;
    const key = process.env.DEPLOYER_PRIVATE_KEY;
    if (!url || !key) {
      throw new Error(
        "Sepolia : renseignez SEPOLIA_RPC_URL et DEPLOYER_PRIVATE_KEY dans .env " +
        "(copiez .env.example). Ces valeurs ne doivent jamais etre versionnees."
      );
    }
    return { url, key, chainId: 11155111 };
  }
  return { url: "http://127.0.0.1:8545", key: LOCAL_KEY, chainId: 31337 };
}

export async function connect(network) {
  const cfg = networkConfig(network);
  const provider = new ethers.JsonRpcProvider(cfg.url, cfg.chainId);
  // NonceManager : serialise les nonces sur des deploiements/transactions successifs.
  const signer = new ethers.NonceManager(new ethers.Wallet(cfg.key, provider));
  const wallet = new ethers.Wallet(cfg.key, provider);
  return { provider, wallet, signer, cfg };
}

export function deploymentPath(network) {
  fs.mkdirSync("deployments", { recursive: true });
  return path.join("deployments", `${network}.json`);
}

export function loadDeployment(network) {
  const p = deploymentPath(network);
  if (!fs.existsSync(p)) {
    throw new Error(`Aucun deploiement pour '${network}'. Lancez : npm run deploy:${network}`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
