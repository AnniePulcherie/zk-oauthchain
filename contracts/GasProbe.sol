// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IGroth16Verifier} from "./IGroth16Verifier.sol";

/// @notice Sonde de mesure : isole le cout en gas de la SEULE verification
///         de la preuve Groth16 (couplages sur BN254), hors ecritures d'etat
///         et hors cout intrinseque de transaction.
contract GasProbe {
    IGroth16Verifier public immutable verifier;
    bool public lastResult;
    uint256 public lastGas;

    constructor(address verifier_) {
        verifier = IGroth16Verifier(verifier_);
    }

    function probe(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[8] calldata pubSignals
    ) external returns (uint256 used) {
        uint256 before = gasleft();
        bool ok = verifier.verifyProof(pA, pB, pC, pubSignals);
        used = before - gasleft();
        lastResult = ok;
        lastGas = used;
    }
}
