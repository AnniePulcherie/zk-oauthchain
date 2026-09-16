// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IGroth16Verifier} from "./IGroth16Verifier.sol";

/**
 * @title ZKAuthRegistry -- contrat intelligent d'autorisation de ZK-OAuthChain
 * @notice Remplace le Serveur d'Autorisation (AS) d'OAuth 2.0 dans son role d'emission
 *         et de validation des jetons. L'AS n'est conserve que pour l'authentification
 *         initiale et l'ancrage des racines Merkle.
 *
 * Liaison de contexte (lecon de zkLogin -- Celi et al., 2026)
 * ----------------------------------------------------------
 * Les vulnerabilites de zkLogin ne sont pas cryptographiques : elles proviennent de
 * l'absence de liaison, au niveau du protocole, entre emetteur, audience, sujet et
 * identite du Serveur de Ressource. Ici ces quatre composantes sont scellees dans
 * l'engagement par le circuit (contrainte C1), et le contrat impose au moment de la
 * consommation :
 *   - issuerId          == l'emetteur declare du deploiement  (politique d'emetteur explicite)
 *   - resourceServerId  == l'identite enregistree de l'appelant (liaison RP)
 *   - domain            == le separateur de domaine du contrat (separation inter-chaines)
 * clientId (aud) est journalise : il est verifie par le Serveur de Ressource, seul a
 * connaitre le client OAuth qu'il attend.
 *
 * Invariants de securite (Section 4, prouves dans formal/)
 * -------------------------------------------------------
 *   J0 -- COUPLAGE (unicite du detenteur)
 *         forall u : commitmentOf[u] != 0 => holderOf[commitmentOf[u]] == u
 *
 *   I1 -- SURETE (non-revocation)
 *         forall u : commitmentOf[u] != 0 => not revoked[commitmentOf[u]]
 *         Forme duale demontree par SMTChecker (indexation par l'engagement) :
 *         forall c : holderOf[c] != 0 => not revoked[c]
 *
 *   I2 -- INTEGRITE (validite de preuve)
 *         forall n : grantedEpoch[n] != 0 => nullifierUsed[n]
 *
 *   I2b -- FRAICHEUR
 *         forall n : grantedEpoch[n] != 0 => epoch != 0
 *
 *   I3 -- LIAISON D'AUDIENCE
 *         forall n : grantedEpoch[n] != 0 => grantedRsId[n] != 0
 *         Tout octroi est attribue a un Serveur de Ressource enregistre, dont
 *         l'identifiant est celui scelle dans la preuve.
 */
contract ZKAuthRegistry {
    /// @dev Ordre du corps scalaire de BN254.
    uint256 internal constant FIELD_P =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    // --- Roles
    address public owner;
    address public authorizationServer;

    // --- Verificateur ZKP (immuable apres deploiement)
    IGroth16Verifier public immutable verifier;

    /// @notice Separateur de domaine : lie toute preuve a cette chaine et a ce contrat.
    uint256 public immutable domainSeparator;

    /// @notice Identifiant de l'emetteur (AS) reconnu par ce deploiement.
    uint256 public issuerId;

    // --- Etat ancre par l'AS
    uint256 public issuanceRoot;    // racine Merkle des engagements emis
    uint256 public revocationRoot;  // racine SMT des engagements revoques
    uint256 public epoch;           // incremente a chaque mise a jour des racines

    // --- Registre d'engagements (compatibilite avec le flux OAuth 2.0 nominatif)
    mapping(address => uint256) public commitmentOf;
    mapping(uint256 => address) public holderOf;   // reciproque : garantit l'unicite du detenteur
    mapping(uint256 => bool) public revoked;

    // --- Registre des Serveurs de Ressource
    mapping(address => uint256) public resourceServerIdOf;
    mapping(uint256 => address) public resourceServerOf;

    // --- Anti-rejeu
    mapping(uint256 => bool) public nullifierUsed;
    mapping(uint256 => uint256) public grantedEpoch;
    mapping(uint256 => uint256) public grantedRsId;

    event CommitmentRegistered(address indexed holder, uint256 commitment);
    event CommitmentReleased(address indexed holder, uint256 commitment);
    event CommitmentRevoked(address indexed holder, uint256 commitment);
    event RootsUpdated(uint256 indexed epoch, uint256 issuanceRoot, uint256 revocationRoot);
    event IssuerDeclared(uint256 issuerId);
    event ResourceServerRegistered(address indexed server, uint256 resourceServerId);
    event AccessGranted(
        uint256 indexed nullifier,
        uint256 indexed epoch,
        uint256 indexed resourceServerId,
        uint256 clientId,
        uint256 challenge
    );

    error NotOwner();
    error NotAuthorizationServer();
    error StaleRoots();
    error NullifierAlreadyUsed();
    error InvalidProof();
    error EmptyCommitment();
    error CommitmentIsRevoked();
    error CommitmentAlreadyHeld();
    error HolderAlreadyBound();
    error ZeroHolder();
    error UnknownIssuer();
    error WrongDomain();
    error ResourceServerNotRegistered();
    error ResourceServerMismatch();
    error ResourceServerIdTaken();
    error EmptyResourceServerId();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAS() {
        if (msg.sender != authorizationServer) revert NotAuthorizationServer();
        _;
    }

    constructor(address verifier_, address authorizationServer_, uint256 issuerId_) {
        owner = msg.sender;
        verifier = IGroth16Verifier(verifier_);
        authorizationServer = authorizationServer_;
        issuerId = issuerId_;
        domainSeparator = uint256(keccak256(
            abi.encode(block.chainid, address(this), "ZK-OAuthChain-v1"))) % FIELD_P;
        emit IssuerDeclared(issuerId_);
    }

    function setAuthorizationServer(address as_) external onlyOwner {
        authorizationServer = as_;
    }

    /// @notice Declare l'identifiant d'emetteur reconnu. Politique d'emetteur explicite
    ///         et verifiable, exigee par l'analyse de zkLogin.
    function setIssuerId(uint256 issuerId_) external onlyOwner {
        issuerId = issuerId_;
        emit IssuerDeclared(issuerId_);
    }

    /// @notice Un Serveur de Ressource lie son adresse a son identifiant de protocole.
    /// @dev Relation biunivoque : sans elle, une preuve destinee a un RP pourrait etre
    ///      consommee par un autre.
    function registerResourceServer(uint256 resourceServerId) external {
        if (msg.sender == address(0)) revert ZeroHolder();
        if (resourceServerId == 0) revert EmptyResourceServerId();
        if (resourceServerOf[resourceServerId] != address(0)) revert ResourceServerIdTaken();
        if (resourceServerIdOf[msg.sender] != 0) revert HolderAlreadyBound();

        resourceServerIdOf[msg.sender] = resourceServerId;
        resourceServerOf[resourceServerId] = msg.sender;
        emit ResourceServerRegistered(msg.sender, resourceServerId);
    }

    /// @notice Ancre on-chain les racines calculees par l'AS. Ouvre une nouvelle epoque.
    function setRoots(uint256 issuanceRoot_, uint256 revocationRoot_) external onlyAS {
        issuanceRoot = issuanceRoot_;
        revocationRoot = revocationRoot_;
        unchecked { epoch += 1; }
        emit RootsUpdated(epoch, issuanceRoot_, revocationRoot_);
    }

    /// @notice Enregistre l'engagement h = Poseidon(token, ctx, meta) d'un detenteur.
    /// @dev Preserve I1 et le couplage J0 : un engagement deja revoque ne peut pas etre
    ///      re-attache, et un engagement ne peut avoir qu'un seul detenteur a la fois.
    ///      Sans cette contrainte d'unicite, deux detenteurs peuvent partager le meme
    ///      engagement et la revocation de l'un laisse l'autre attache a un engagement
    ///      revoque -- violation de I1 exhibee par ProB sur le modele naif
    ///      (formal/b/ZKAuthRegistry_v0.mch).
    function registerCommitment(uint256 commitment) external {
        // address(0) sert de sentinelle "non detenu" dans holderOf. Sans cette garde,
        // un detenteur d'adresse nulle rend la sentinelle ambigue et reintroduit
        // l'aliasing d'engagement -- violation de J0 et I1 exhibee par SMTChecker.
        if (msg.sender == address(0)) revert ZeroHolder();
        if (commitment == 0) revert EmptyCommitment();
        if (revoked[commitment]) revert CommitmentIsRevoked();
        if (holderOf[commitment] != address(0)) revert CommitmentAlreadyHeld();
        // La rotation est explicite (releaseCommitment) et non implicite : une ecriture
        // a un indice symbolique distinct dans la meme fonction empeche le moteur CHC
        // d'inferer l'invariant quantifie I1. Separer les deux operations rend le
        // contrat demontrable sans affaiblir sa fonctionnalite.
        if (commitmentOf[msg.sender] != 0) revert HolderAlreadyBound();

        commitmentOf[msg.sender] = commitment;
        holderOf[commitment] = msg.sender;
        emit CommitmentRegistered(msg.sender, commitment);
    }

    /// @notice Detache volontairement son engagement (rotation de jeton).
    /// @dev Preserve I1 : n'affaiblit que l'antecedent de l'implication.
    function releaseCommitment() external {
        uint256 commitment = commitmentOf[msg.sender];
        if (commitment == 0) revert EmptyCommitment();
        commitmentOf[msg.sender] = 0;
        holderOf[commitment] = address(0);
        emit CommitmentReleased(msg.sender, commitment);
    }

    /// @notice Revoque un engagement. Irreversible.
    /// @dev Preserve I1 : marque revoked ET detache l'engagement du detenteur,
    ///      de sorte que dom(commitmentOf) ne contienne jamais d'engagement revoque.
    function revokeCommitment(address holder) external onlyAS {
        uint256 commitment = commitmentOf[holder];
        if (commitment == 0) revert EmptyCommitment();
        revoked[commitment] = true;
        commitmentOf[holder] = 0;
        holderOf[commitment] = address(0);
        emit CommitmentRevoked(holder, commitment);
    }

    /// @dev Controles communs de contexte, partages par la lecture et la consommation.
    ///      Renvoie l'identifiant du Serveur de Ressource attendu.
    function _checkContext(uint256[8] calldata pubSignals, address resourceServer)
        internal view returns (uint256 rsId)
    {
        if (epoch == 0) revert StaleRoots();
        if (pubSignals[1] != issuanceRoot || pubSignals[2] != revocationRoot) revert StaleRoots();
        if (pubSignals[3] != issuerId) revert UnknownIssuer();
        if (pubSignals[6] != domainSeparator) revert WrongDomain();

        rsId = resourceServerIdOf[resourceServer];
        if (rsId == 0) revert ResourceServerNotRegistered();
        if (pubSignals[5] != rsId) revert ResourceServerMismatch();
    }

    /// @notice Verification pure d'une preuve, sans modification d'etat.
    ///         Utilisee par le Serveur de Ressource pour un controle hors-transaction.
    /// @param resourceServer adresse du Serveur de Ressource dont la preuve revendique l'identite.
    function verifyAuthorization(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[8] calldata pubSignals,
        address resourceServer
    ) external view returns (bool) {
        _checkContext(pubSignals, resourceServer);
        if (nullifierUsed[pubSignals[0]]) return false;
        return verifier.verifyProof(pA, pB, pC, pubSignals);
    }

    /// @notice Consomme une autorisation : verifie la preuve puis enregistre l'acces.
    /// @dev Retablit I2 et I3 : grantedEpoch et grantedRsId ne sont ecrits qu'apres
    ///      verifyProof reussi, et toujours conjointement a nullifierUsed.
    function authorize(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[8] calldata pubSignals
    ) external {
        uint256 nullifier = pubSignals[0];

        // Fraicheur, politique d'emetteur, separation de domaine, liaison au RP appelant.
        uint256 rsId = _checkContext(pubSignals, msg.sender);
        // Anti-rejeu.
        if (nullifierUsed[nullifier]) revert NullifierAlreadyUsed();
        // Validite cryptographique (contexte + engagement + Merkle + non-revocation).
        if (!verifier.verifyProof(pA, pB, pC, pubSignals)) revert InvalidProof();

        nullifierUsed[nullifier] = true;
        grantedEpoch[nullifier] = epoch;
        grantedRsId[nullifier] = rsId;
        emit AccessGranted(nullifier, epoch, rsId, pubSignals[4], pubSignals[7]);
    }
}
