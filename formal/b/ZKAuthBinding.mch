/*
 * ZK-OAuthChain -- modele B de la liaison d'audience (lecon de zkLogin).
 *
 * Machine dediee aux proprietes de liaison entre une preuve et le Serveur de
 * Ressource qui la consomme. Elle est separee de ZKAuthRegistry.mch afin de
 * garder chaque espace d'etats exhaustivement explorable : les deux machines
 * partagent l'operation authorize mais portent sur des fragments d'etat disjoints.
 *
 * Correspondance avec le Solidity :
 *   rsIdOf    <-> mapping(address => uint256) resourceServerIdOf
 *   rsOf      <-> mapping(uint256 => address) resourceServerOf
 *   grantedRs <-> mapping(uint256 => uint256) grantedRsId
 *
 * Invariants :
 *   J1 COUPLAGE RP     un identifiant de Serveur de Ressource a un titulaire unique
 *   I3 LIAISON         tout octroi est attribue a un RP enregistre
 *   I3b CONFORMITE     l'identifiant attribue est celui du RP appelant
 */
MACHINE ZKAuthBinding

SETS
    RSERVER = {r1, r2, r3};
    RSID = {i1, i2, i3};
    NULLIFIER = {n1, n2}

VARIABLES rsIdOf, rsOf, used, granted, grantedRs, epoch

INVARIANT
    rsIdOf : RSERVER +-> RSID &
    rsOf : RSID +-> RSERVER &
    used <: NULLIFIER &
    granted : NULLIFIER +-> NATURAL1 &
    grantedRs : NULLIFIER +-> RSID &
    epoch : NATURAL &

    /* J1 -- COUPLAGE RP : rsOf est la reciproque de rsIdOf (unicite du titulaire) */
    !r.(r : dom(rsIdOf)
        => (rsIdOf(r) : dom(rsOf) & rsOf(rsIdOf(r)) = r)) &

    /* I3 -- LIAISON D'AUDIENCE : tout octroi porte un identifiant de RP enregistre */
    !n.(n : dom(granted) => (n : dom(grantedRs) & grantedRs(n) : dom(rsOf))) &

    /* I3b -- l'octroi consomme bien le nullifieur */
    !n.(n : dom(granted) => n : used)

INITIALISATION
    rsIdOf := {} || rsOf := {} || used := {} ||
    granted := {} || grantedRs := {} || epoch := 0

OPERATIONS

    setRoots =
        PRE epoch < 2 THEN
            epoch := epoch + 1
        END;

    /* Un RP lie son adresse a son identifiant : relation biunivoque. */
    registerResourceServer(rr, ii) =
        PRE rr : RSERVER & ii : RSID &
            rr /: dom(rsIdOf) & ii /: dom(rsOf) THEN
            rsIdOf := rsIdOf <+ {rr |-> ii} ||
            rsOf := rsOf <+ {ii |-> rr}
        END;

    /* Consommation d'une autorisation par le RP appelant rr.
       La garde rr : dom(rsIdOf) traduit le controle du contrat
       resourceServerIdOf[msg.sender] != 0, et l'identifiant enregistre --
       et non celui revendique -- est celui qui est consigne. */
    authorize(nn, rr) =
        PRE nn : NULLIFIER & rr : RSERVER &
            nn /: used & epoch > 0 & rr : dom(rsIdOf) THEN
            used := used \/ {nn} ||
            granted := granted <+ {nn |-> epoch} ||
            grantedRs := grantedRs <+ {nn |-> rsIdOf(rr)}
        END

END
