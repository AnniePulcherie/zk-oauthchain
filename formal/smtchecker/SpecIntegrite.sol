// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * Obligations de preuve I2 / I2b / I3 -- ZK-OAuthChain.
 * Fragment de ZKAuthRegistry portant l'etat d'autorisation.
 * Le verificateur Groth16 est abstrait par l'oracle non contraint `proofIsValid` :
 * la preuve couvre donc les deux issues possibles de la verification cryptographique.
 */
contract SpecIntegrite {
    address public authorizationServer;
    uint256 public issuerId;
    uint256 public domainSeparator;

    uint256 public issuanceRoot;
    uint256 public revocationRoot;
    uint256 public epoch;

    mapping(address => uint256) public resourceServerIdOf;

    mapping(uint256 => bool) public nullifierUsed;
    mapping(uint256 => uint256) public grantedEpoch;
    mapping(uint256 => uint256) public grantedRsId;

    constructor(address as_, uint256 issuerId_, uint256 domain_) {
        authorizationServer = as_;
        issuerId = issuerId_;
        domainSeparator = domain_;
    }

    function setRoots(uint256 r, uint256 rr) external {
        require(msg.sender == authorizationServer);
        require(epoch < type(uint256).max);
        issuanceRoot = r; revocationRoot = rr; epoch += 1;
    }

    function registerResourceServer(uint256 id) external {
        require(id != 0);
        require(resourceServerIdOf[msg.sender] == 0);
        resourceServerIdOf[msg.sender] = id;
    }

    /// @param rsClaimed identifiant de Serveur de Ressource scelle dans la preuve
    /// @param iss       emetteur declare par la preuve
    /// @param dom       domaine declare par la preuve
    function authorize(
        uint256 n,
        uint256 root,
        uint256 revRoot,
        uint256 iss,
        uint256 dom,
        uint256 rsClaimed,
        bool proofIsValid
    ) external {
        require(epoch != 0);
        require(root == issuanceRoot && revRoot == revocationRoot);
        require(iss == issuerId);
        require(dom == domainSeparator);

        uint256 rsId = resourceServerIdOf[msg.sender];
        require(rsId != 0);
        require(rsClaimed == rsId);

        require(!nullifierUsed[n]);
        require(proofIsValid);

        nullifierUsed[n] = true;
        grantedEpoch[n] = epoch;
        grantedRsId[n] = rsId;
    }

    // ---- Obligations de preuve -------------------------------------------

    /// I2 : tout acces enregistre a consomme son nullifieur.
    function checkI2(uint256 n) public view {
        assert(grantedEpoch[n] == 0 || nullifierUsed[n]);
    }

    /// I2b : aucun acces avant le premier ancrage de racines par l'AS.
    function checkI2b(uint256 n) public view {
        assert(grantedEpoch[n] == 0 || epoch != 0);
    }

    /// I3 : tout acces est attribue a un Serveur de Ressource enregistre,
    ///      dont l'identifiant est celui scelle dans la preuve.
    function checkI3(uint256 n) public view {
        assert(grantedEpoch[n] == 0 || grantedRsId[n] != 0);
    }
}
