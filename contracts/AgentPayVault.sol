// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * AgentPayVault — prepaid balance + signed-voucher batch settlement.
 *
 * Why this design: BOT Chain's USDT is vanilla Tether (no EIP-2612 permit, no
 * EIP-3009 transferWithAuthorization), so the x402 "exact" gasless scheme cannot
 * work here. Instead an agent deposits once, then pays per call with an EIP-712
 * voucher that costs it zero gas and zero chain writes; whoever submits the
 * voucher pays the gas.  That is x402 v2's batch-settlement shape.
 */
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

contract AgentPayVault {
    IERC20 public immutable token;

    mapping(address => uint256) public balance;
    mapping(bytes32 => bool) public invoiceUsed;

    uint256 public settleCount;
    uint256 public totalSettled;

    // keccak256("Voucher(address agent,address payee,uint256 amount,bytes32 invoiceId,uint256 expiry,uint256 chainId,address vault)")
    bytes32 private constant VOUCHER_TYPEHASH =
        keccak256(
            "Voucher(address agent,address payee,uint256 amount,bytes32 invoiceId,uint256 expiry,uint256 chainId,address vault)"
        );

    event Deposited(address indexed agent, uint256 amount);
    event Withdrawn(address indexed agent, uint256 amount);
    event VoucherSettled(bytes32 indexed invoiceId, address indexed agent, address indexed payee, uint256 amount);
    event SettledBatch(uint256 count, uint256 totalAmount, bytes32 firstInvoice, bytes32 lastInvoice);

    constructor(address _token) {
        require(_token != address(0), "token=0");
        token = IERC20(_token);
    }

    // ---------------------------------------------------------------- deposits
    function deposit(uint256 amount) external {
        require(amount > 0, "amount=0");
        require(token.transferFrom(msg.sender, address(this), amount), "transferFrom failed");
        balance[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external {
        require(balance[msg.sender] >= amount, "insufficient balance");
        balance[msg.sender] -= amount;
        require(token.transfer(msg.sender, amount), "transfer failed");
        emit Withdrawn(msg.sender, amount);
    }

    // ------------------------------------------------------------------ EIP-712
    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("AgentPay"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    function voucherHash(
        address agent,
        address payee,
        uint256 amount,
        bytes32 invoiceId,
        uint256 expiry
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(VOUCHER_TYPEHASH, agent, payee, amount, invoiceId, expiry, block.chainid, address(this))
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function _recover(bytes32 h, bytes calldata sig) internal pure returns (address) {
        require(sig.length == 65, "bad sig length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "bad v");
        // reject malleable high-s
        require(uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0, "bad s");
        address signer = ecrecover(h, v, r, s);
        require(signer != address(0), "bad sig");
        return signer;
    }

    // ------------------------------------------------------------------- settle
    /// Permissionless: anyone holding valid signed vouchers may submit them.
    /// The agent's balance only ever moves with the agent's own signature.
    function settle(
        address[] calldata agents,
        address payee,
        uint256[] calldata amounts,
        bytes32[] calldata invoiceIds,
        uint256[] calldata expiries,
        bytes[] calldata sigs
    ) external {
        uint256 n = agents.length;
        require(n > 0, "empty batch");
        require(
            amounts.length == n && invoiceIds.length == n && expiries.length == n && sigs.length == n,
            "length mismatch"
        );

        uint256 sum;
        for (uint256 i = 0; i < n; i++) {
            bytes32 inv = invoiceIds[i];
            require(!invoiceUsed[inv], "invoice already used");
            require(block.timestamp <= expiries[i], "voucher expired");
            require(balance[agents[i]] >= amounts[i], "insufficient vault balance");

            bytes32 h = voucherHash(agents[i], payee, amounts[i], inv, expiries[i]);
            require(_recover(h, sigs[i]) == agents[i], "invalid voucher signature");

            invoiceUsed[inv] = true;
            balance[agents[i]] -= amounts[i];
            sum += amounts[i];
            emit VoucherSettled(inv, agents[i], payee, amounts[i]);
        }

        balance[payee] += sum;
        settleCount += n;
        totalSettled += sum;
        emit SettledBatch(n, sum, invoiceIds[0], invoiceIds[n - 1]);
    }

    function vaultStats() external view returns (uint256 count, uint256 total, uint256 held) {
        return (settleCount, totalSettled, token.balanceOf(address(this)));
    }
}
