// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * Obligation de preuve J0 / I1 (SURETE) -- ZK-OAuthChain.
 * Fragment de ZKAuthRegistry portant le registre d'engagements.
 */
contract SpecSurete {
    address public authorizationServer;
    mapping(address => uint256) public commitmentOf;
    mapping(uint256 => address) public holderOf;
    mapping(uint256 => bool) public revoked;

    constructor(address as_) { authorizationServer = as_; }

    function registerCommitment(uint256 c) external {
        require(msg.sender != address(0));   // desambiguise la sentinelle holderOf
        require(c != 0);
        require(!revoked[c]);
        require(holderOf[c] == address(0));
        require(commitmentOf[msg.sender] == 0);   // rotation explicite uniquement
        commitmentOf[msg.sender] = c;
        holderOf[c] = msg.sender;
    }

    function releaseCommitment() external {
        uint256 c = commitmentOf[msg.sender];
        require(c != 0);
        commitmentOf[msg.sender] = 0;
        holderOf[c] = address(0);
    }

    function revokeCommitment(address h) external {
        require(msg.sender == authorizationServer);
        uint256 c = commitmentOf[h];
        require(c != 0);
        revoked[c] = true;
        commitmentOf[h] = 0;
        holderOf[c] = address(0);
    }

    /// J0 : couplage -- un engagement attache l'est a un detenteur unique.
    function checkJ0(address u) public view {
        assert(commitmentOf[u] == 0 || holderOf[commitmentOf[u]] == u);
    }

    /// I1 : aucun engagement encore attache a un detenteur n'est revoque.
    /// @dev Formulation indexee par l'utilisateur. Le moteur CHC ne la decharge pas :
    ///      le dereferencement imbrique holderOf[commitmentOf[u]] depasse le
    ///      raisonnement sur tableaux de Spacer. Voir checkI1prime, equivalente
    ///      sous J0 et indexee par l'engagement, qui est prouvee.
    function checkI1(address u) public view {
        assert(commitmentOf[u] == 0 || !revoked[commitmentOf[u]]);
    }

    /// I1' : formulation duale, indexee par l'engagement --
    ///       aucun engagement encore detenu n'est revoque.
    ///       Equivalente a I1 par le couplage J0 (holderOf est la reciproque de commitmentOf).
    function checkI1prime(uint256 c) public view {
        assert(holderOf[c] == address(0) || !revoked[c]);
    }
}
