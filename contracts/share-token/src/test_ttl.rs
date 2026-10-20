//! A balance or freeze the token creates reaches its extend target in the call that
//! creates it, even where the network's minimum lifetime is shorter.

use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::{storage::Persistent as _, Address as _, Ledger as _},
    Address, Env, IntoVal, String, Symbol, Val,
};
use stellar_tokens::{
    fungible::{FungibleStorageKey, BALANCE_EXTEND_AMOUNT},
    rwa::{identity_verification, RWAStorageKey, FROZEN_EXTEND_AMOUNT},
};

use crate::{ShareToken, ShareTokenClient};
use compliance::{Compliance, ComplianceClient};

/// Testnet's minimum lifetime of a new persistent entry, in ledgers.
const TESTNET_MIN_PERSISTENT_TTL: u32 = 120_960;
/// Mainnet's, in ledgers: longer than any extend target.
const MAINNET_MIN_PERSISTENT_TTL: u32 = 2_073_600;

/// Accepts every account and names the recovery target a test sets.
#[contract]
struct OpenVerifier;

#[contractimpl]
impl OpenVerifier {
    pub fn set_recovery_target(e: Env, target: Address) {
        e.storage()
            .instance()
            .set(&symbol_short!("target"), &target);
    }
}

#[contractimpl(contracttrait)]
impl identity_verification::IdentityVerifier for OpenVerifier {
    fn verify_identity(_e: &Env, _account: &Address) {}

    fn recovery_target(e: &Env, _old_account: &Address) -> Option<Address> {
        e.storage().instance().get(&symbol_short!("target"))
    }

    fn set_claim_topics_and_issuers(
        _e: &Env,
        _claim_topics_and_issuers: Address,
        _operator: Address,
    ) {
    }
}

struct Fixture<'a> {
    e: Env,
    token: ShareTokenClient<'a>,
    verifier: OpenVerifierClient<'a>,
    admin: Address,
    compliance_authority: Address,
}

impl Fixture<'_> {
    fn persistent_ttl<K: IntoVal<Env, Val>>(&self, key: &K) -> u32 {
        self.e.as_contract(&self.token.address, || {
            self.e.storage().persistent().get_ttl(key)
        })
    }

    fn balance_ttl(&self, account: &Address) -> u32 {
        self.persistent_ttl(&FungibleStorageKey::Balance(account.clone()))
    }

    /// A manager to mint with, and a holder of `shares`.
    fn holder(&self, shares: i128) -> (Address, Address) {
        let manager = Address::generate(&self.e);
        self.token
            .grant_role(&manager, &manager_role(), &self.admin);
        let holder = Address::generate(&self.e);
        self.token.mint(&holder, &shares, &manager);
        (manager, holder)
    }

    fn order(&self) -> String {
        String::from_str(&self.e, "court-order-2026-117")
    }
}

fn manager_role() -> Symbol {
    symbol_short!("manager")
}

/// A token in setup on a ledger with testnet's minimum lifetime; its verifier accepts everyone.
fn setup<'a>() -> Fixture<'a> {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger()
        .set_min_persistent_entry_ttl(TESTNET_MIN_PERSISTENT_TTL);
    let admin = Address::generate(&e);
    let compliance_authority = Address::generate(&e);
    let rules = ComplianceClient::new(&e, &e.register(Compliance, (admin.clone(),)));
    let verifier = OpenVerifierClient::new(&e, &e.register(OpenVerifier, ()));
    let token = ShareTokenClient::new(
        &e,
        &e.register(
            ShareToken,
            (
                String::from_str(&e, "Strata Vault USDC"),
                String::from_str(&e, "bvUSDC"),
                admin.clone(),
                compliance_authority.clone(),
                rules.address.clone(),
                verifier.address.clone(),
            ),
        ),
    );
    rules.bind_token(&token.address, &admin);
    Fixture {
        e,
        token,
        verifier,
        admin,
        compliance_authority,
    }
}

#[test]
fn a_mint_writes_the_new_balance_with_the_full_ttl() {
    let f = setup();

    let (_, holder) = f.holder(100);

    assert_eq!(f.balance_ttl(&holder), BALANCE_EXTEND_AMOUNT);
}

#[test]
fn a_transfer_writes_the_new_balance_with_the_full_ttl() {
    let f = setup();
    let (_, holder) = f.holder(100);
    let to = Address::generate(&f.e);

    f.token.transfer(&holder, &to, &40);

    assert_eq!(f.balance_ttl(&to), BALANCE_EXTEND_AMOUNT);
}

#[test]
fn a_transfer_from_writes_the_new_balance_with_the_full_ttl() {
    let f = setup();
    let (_, holder) = f.holder(100);
    let spender = Address::generate(&f.e);
    let to = Address::generate(&f.e);
    f.token
        .approve(&holder, &spender, &40, &(f.e.ledger().sequence() + 100));

    f.token.transfer_from(&spender, &holder, &to, &40);

    assert_eq!(f.balance_ttl(&to), BALANCE_EXTEND_AMOUNT);
}

#[test]
fn an_escrow_writes_the_receiving_balance_with_the_full_ttl() {
    let f = setup();
    let (manager, holder) = f.holder(100);
    let vault = Address::generate(&f.e);

    f.token.forced_transfer(&holder, &vault, &40, &manager);

    assert_eq!(f.balance_ttl(&vault), BALANCE_EXTEND_AMOUNT);
}

#[test]
fn a_legal_transfer_writes_the_new_balance_with_the_full_ttl() {
    let f = setup();
    let (_, holder) = f.holder(100);
    let to = Address::generate(&f.e);

    f.token
        .legal_transfer(&holder, &to, &40, &f.order(), &f.compliance_authority);

    assert_eq!(f.balance_ttl(&to), BALANCE_EXTEND_AMOUNT);
}

#[test]
fn a_recovery_writes_the_new_balance_with_the_full_ttl() {
    let f = setup();
    let (_, holder) = f.holder(100);
    let new_account = Address::generate(&f.e);
    f.verifier.set_recovery_target(&new_account);

    assert!(f
        .token
        .recover_balance(&holder, &new_account, &f.compliance_authority));

    assert_eq!(f.balance_ttl(&new_account), BALANCE_EXTEND_AMOUNT);
}

#[test]
fn a_recovery_writes_the_freezes_it_carries_with_the_full_ttl() {
    let f = setup();
    let (_, holder) = f.holder(100);
    f.token
        .freeze_partial_tokens(&holder, &30, &f.compliance_authority);
    f.token
        .set_address_frozen(&holder, &true, &f.compliance_authority);
    let new_account = Address::generate(&f.e);
    f.verifier.set_recovery_target(&new_account);

    assert!(f
        .token
        .recover_balance(&holder, &new_account, &f.compliance_authority));

    assert_eq!(
        f.persistent_ttl(&RWAStorageKey::FrozenTokens(new_account.clone())),
        FROZEN_EXTEND_AMOUNT
    );
    assert_eq!(
        f.persistent_ttl(&RWAStorageKey::AddressFrozen(new_account)),
        FROZEN_EXTEND_AMOUNT
    );
}

/// OpenZeppelin writes a zero balance for an account that sends nothing and
/// held nothing.
#[test]
fn sending_nothing_from_an_empty_account_writes_its_balance_with_the_full_ttl() {
    let f = setup();
    let (manager, _) = f.holder(100);
    let to = Address::generate(&f.e);
    let empty = || Address::generate(&f.e);
    let (by_transfer, by_transfer_from, by_escrow, by_order, by_burn) =
        (empty(), empty(), empty(), empty(), empty());

    f.token.transfer(&by_transfer, &to, &0);
    f.token.transfer_from(&to, &by_transfer_from, &to, &0);
    f.token.forced_transfer(&by_escrow, &to, &0, &manager);
    f.token
        .legal_transfer(&by_order, &to, &0, &f.order(), &f.compliance_authority);
    f.token.burn(&by_burn, &0, &manager);

    for account in [by_transfer, by_transfer_from, by_escrow, by_order, by_burn] {
        assert_eq!(f.balance_ttl(&account), BALANCE_EXTEND_AMOUNT);
    }
}

#[test]
fn a_freeze_writes_its_entry_with_the_full_ttl() {
    let f = setup();
    let account = Address::generate(&f.e);

    f.token
        .set_address_frozen(&account, &true, &f.compliance_authority);

    assert_eq!(
        f.persistent_ttl(&RWAStorageKey::AddressFrozen(account)),
        FROZEN_EXTEND_AMOUNT
    );
}

#[test]
fn a_partial_freeze_writes_its_entry_with_the_full_ttl() {
    let f = setup();
    let (_, holder) = f.holder(100);
    let empty = Address::generate(&f.e);

    f.token
        .freeze_partial_tokens(&holder, &30, &f.compliance_authority);
    f.token
        .unfreeze_partial_tokens(&empty, &0, &f.compliance_authority);

    for account in [holder, empty] {
        assert_eq!(
            f.persistent_ttl(&RWAStorageKey::FrozenTokens(account)),
            FROZEN_EXTEND_AMOUNT
        );
    }
}

#[test]
fn a_network_minimum_longer_than_the_extend_target_is_kept() {
    let f = setup();
    f.e.ledger()
        .set_min_persistent_entry_ttl(MAINNET_MIN_PERSISTENT_TTL);

    let (_, holder) = f.holder(100);

    assert_eq!(f.balance_ttl(&holder), MAINNET_MIN_PERSISTENT_TTL - 1);
}
