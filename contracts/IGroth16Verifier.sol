// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Interface du verificateur Groth16 genere par snarkjs.
/// @dev Signaux publics, dans l'ordre produit par circom :
///      [0] nullifier, [1] root, [2] revRoot, [3] issuerId,
///      [4] clientId,  [5] resourceServerId, [6] domain, [7] challenge.
interface IGroth16Verifier {
    function verifyProof(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[8] calldata pubSignals
    ) external view returns (bool);
}
