/*
 * ZK-OAuthChain -- modele B de la version NAIVE du contrat d'autorisation,
 * transcrite telle quelle depuis le pseudo-Solidity de la Section 3.4.b :
 *
 *     mapping(address => bytes32) commitments;
 *     function register(bytes32 c) { commitments[msg.sender] = c; }
 *
 * Objectif : soumettre cette version a la verification de l'invariant I1.
 */
MACHINE ZKAuthRegistry_v0

SETS
    USER = {u1, u2, u3};
    COMMITMENT = {c1, c2, c3};
    NULLIFIER = {n1, n2, n3}

VARIABLES commitments, revoked, used, granted, epoch

INVARIANT
    commitments : USER +-> COMMITMENT &
    revoked <: COMMITMENT &
    used <: NULLIFIER &
    granted : NULLIFIER +-> NATURAL1 &
    epoch : NATURAL &
    /* I1 -- SURETE (non-revocation) */
    !u.(u : dom(commitments) => commitments(u) /: revoked) &
    /* I2 -- INTEGRITE (validite de preuve) */
    !n.(n : dom(granted) => n : used)

INITIALISATION
    commitments := {} || revoked := {} || used := {} || granted := {} || epoch := 0

OPERATIONS

    setRoots =
        PRE epoch < 3 THEN epoch := epoch + 1 END;

    registerCommitment(uu, cc) =
        PRE uu : USER & cc : COMMITMENT & cc /: revoked THEN
            commitments := commitments <+ {uu |-> cc}
        END;

    revokeCommitment(uu) =
        PRE uu : USER & uu : dom(commitments) THEN
            revoked := revoked \/ {commitments(uu)} ||
            commitments := {uu} <<| commitments
        END;

    authorize(nn) =
        PRE nn : NULLIFIER & nn /: used & epoch > 0 THEN
            used := used \/ {nn} ||
            granted := granted <+ {nn |-> epoch}
        END

END
