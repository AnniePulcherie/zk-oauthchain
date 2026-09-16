/*
 * ZK-OAuthChain -- modele B du contrat d'autorisation ZKAuthRegistry (version durcie).
 *
 * Correspondance avec le Solidity :
 *   commitments <-> mapping(address => uint256) commitmentOf
 *   holder      <-> mapping(uint256 => address) holderOf
 *   revoked     <-> mapping(uint256 => bool)    revoked
 *   used        <-> mapping(uint256 => bool)    nullifierUsed
 *   granted     <-> mapping(uint256 => uint256) grantedEpoch
 *
 * Invariants de securite de la Section 4 :
 *   I1 SURETE     !u.(u : dom(commitments) => commitments(u) /: revoked)
 *   I2 INTEGRITE  !n.(n : dom(granted)     => n : used)
 */
MACHINE ZKAuthRegistry

SETS
    USER = {u1, u2, u3};
    COMMITMENT = {c1, c2, c3};
    NULLIFIER = {n1, n2, n3}

VARIABLES commitments, holder, revoked, used, granted, epoch

INVARIANT
    commitments : USER +-> COMMITMENT &
    holder : COMMITMENT +-> USER &
    revoked <: COMMITMENT &
    used <: NULLIFIER &
    granted : NULLIFIER +-> NATURAL1 &
    epoch : NATURAL &

    /* J0 -- couplage : un engagement attache a un detenteur unique (injectivite) */
    !u.(u : dom(commitments)
        => (commitments(u) : dom(holder) & holder(commitments(u)) = u)) &

    /* I1 -- SURETE (non-revocation) :
       aucun engagement encore attache a un detenteur n'est revoque */
    !u.(u : dom(commitments) => commitments(u) /: revoked) &

    /* I2 -- INTEGRITE (validite de preuve) :
       tout acces enregistre a consomme son nullifieur */
    !n.(n : dom(granted) => n : used) &

    /* I2b -- fraicheur : aucun acces avant le premier ancrage de racines */
    !n.(n : dom(granted) => granted(n) : 1..epoch)

INITIALISATION
    commitments := {} || holder := {} || revoked := {} ||
    used := {} || granted := {} || epoch := 0

OPERATIONS

    /* setRoots : l'AS ancre de nouvelles racines et ouvre une epoque. */
    setRoots =
        PRE epoch < 3 THEN
            epoch := epoch + 1
        END;

    /* registerCommitment : non-revocation, unicite du detenteur, pas de rotation implicite. */
    registerCommitment(uu, cc) =
        PRE uu : USER & cc : COMMITMENT &
            cc /: revoked & cc /: dom(holder) & uu /: dom(commitments) THEN
            holder := holder <+ {cc |-> uu} ||
            commitments := commitments <+ {uu |-> cc}
        END;

    /* releaseCommitment : rotation explicite, detache l'engagement sans le revoquer. */
    releaseCommitment(uu) =
        PRE uu : USER & uu : dom(commitments) THEN
            holder := {commitments(uu)} <<| holder ||
            commitments := {uu} <<| commitments
        END;

    /* revokeCommitment : irreversible, detache simultanement l'engagement. */
    revokeCommitment(uu) =
        PRE uu : USER & uu : dom(commitments) THEN
            revoked := revoked \/ {commitments(uu)} ||
            holder := {commitments(uu)} <<| holder ||
            commitments := {uu} <<| commitments
        END;

    /* authorize : preuve Groth16 verifiee (abstraite), consommation du nullifieur. */
    authorize(nn) =
        PRE nn : NULLIFIER & nn /: used & epoch > 0 THEN
            used := used \/ {nn} ||
            granted := granted <+ {nn |-> epoch}
        END

END
