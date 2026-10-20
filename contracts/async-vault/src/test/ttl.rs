use soroban_sdk::testutils::storage::{Instance as _, Persistent as _};
use soroban_sdk::{contracttype, IntoVal, Symbol, Val};
use stellar_access::access_control::{AccessControlStorageKey, ROLE_EXTEND_AMOUNT};
use stellar_tokens::fungible::{FungibleStorageKey, BALANCE_EXTEND_AMOUNT};
use strata_storage::{INSTANCE_EXTEND_AMOUNT, PERSISTENT_EXTEND_AMOUNT};

use super::*;
use crate::keys::DataKey;
use crate::roles::{GUARDIAN_ROLE, MANAGER_ROLE, TREASURY_ROLE};

const TWO_DAYS: u64 = 2 * DAY_DURATION;

/// Testnet's minimum lifetime of a new persistent entry, in ledgers.
const TESTNET_MIN_PERSISTENT_TTL: u32 = 120_960;

fn persistent_ttl(f: &Fixture, key: &DataKey) -> u32 {
    f.e.as_contract(&f.vault.address, || f.e.storage().persistent().get_ttl(key))
}

fn ttl_in<K: IntoVal<Env, Val>>(e: &Env, contract: &Address, key: &K) -> u32 {
    e.as_contract(contract, || e.storage().persistent().get_ttl(key))
}

/// OpenZeppelin keeps the type of a role's member-list key private. A type
/// with the same variant name and fields encodes the same key.
#[contracttype]
struct RoleAccountKey {
    role: Symbol,
    index: u32,
}

#[contracttype]
enum RoleMemberKey {
    RoleAccounts(RoleAccountKey),
}

/// Every entry a grant writes: the role, its member-list slot, the member count, the role list.
fn role_entry_ttls(e: &Env, contract: &Address, account: &Address, role: &Symbol) -> [u32; 4] {
    let has_role = AccessControlStorageKey::HasRole(account.clone(), role.clone());
    let index: u32 = e.as_contract(contract, || {
        e.storage().persistent().get(&has_role).unwrap()
    });
    [
        ttl_in(e, contract, &has_role),
        ttl_in(
            e,
            contract,
            &RoleMemberKey::RoleAccounts(RoleAccountKey {
                role: role.clone(),
                index,
            }),
        ),
        ttl_in(
            e,
            contract,
            &AccessControlStorageKey::RoleAccountsCount(role.clone()),
        ),
        ttl_in(e, contract, &AccessControlStorageKey::ExistingRoles),
    ]
}

fn share_balance_ttl(f: &Fixture, account: &Address) -> u32 {
    ttl_in(
        &f.e,
        &f.share.address,
        &FungibleStorageKey::Balance(account.clone()),
    )
}

fn testnet_minimum(e: &Env) {
    e.ledger()
        .set_min_persistent_entry_ttl(TESTNET_MIN_PERSISTENT_TTL);
}

fn instance_ttl(f: &Fixture) -> u32 {
    f.e.as_contract(&f.vault.address, || f.e.storage().instance().get_ttl())
}

#[test]
fn a_request_and_its_epoch_are_written_with_the_full_ttl() {
    let f = setup();
    let user = f.investor(1_000);

    f.vault.request_deposit(&user, &400);

    assert_eq!(
        persistent_ttl(&f, &DataKey::UserDeposit(1, user)),
        PERSISTENT_EXTEND_AMOUNT
    );
    assert_eq!(
        persistent_ttl(&f, &DataKey::Epoch(1)),
        PERSISTENT_EXTEND_AMOUNT
    );
}

#[test]
fn reading_a_decayed_request_restores_its_full_ttl() {
    let f = setup();
    let user = f.investor(1_000);
    f.vault.request_deposit(&user, &400);
    let key = DataKey::UserDeposit(1, user.clone());

    f.advance(TWO_DAYS);
    assert!(persistent_ttl(&f, &key) < PERSISTENT_EXTEND_AMOUNT);

    f.vault.get_deposit_request(&1, &user);

    assert_eq!(persistent_ttl(&f, &key), PERSISTENT_EXTEND_AMOUNT);
}

#[test]
fn reading_a_decayed_epoch_restores_its_full_ttl() {
    let f = setup();

    f.advance(TWO_DAYS);
    assert!(persistent_ttl(&f, &DataKey::Epoch(1)) < PERSISTENT_EXTEND_AMOUNT);

    f.vault.get_epoch(&1);

    assert_eq!(
        persistent_ttl(&f, &DataKey::Epoch(1)),
        PERSISTENT_EXTEND_AMOUNT
    );
}

#[test]
fn a_redemption_request_is_written_with_the_full_ttl() {
    let f = setup();
    let holder = f.holder(100);

    let epoch = f.vault.request_redeem(&holder, &100);

    assert_eq!(
        persistent_ttl(&f, &DataKey::UserRedeem(epoch, holder)),
        PERSISTENT_EXTEND_AMOUNT
    );
}

#[test]
fn any_vault_read_restores_the_instance_ttl() {
    let f = setup();

    f.advance(TWO_DAYS);
    assert!(instance_ttl(&f) < INSTANCE_EXTEND_AMOUNT);

    f.vault.current_epoch();

    assert_eq!(instance_ttl(&f), INSTANCE_EXTEND_AMOUNT);
}

#[test]
fn a_pending_request_still_claims_after_most_of_a_month() {
    let f = setup();
    let user = f.investor(1_000);
    f.vault.request_deposit(&user, &400);
    let epoch = f.close_epoch();

    f.advance(29 * DAY_DURATION);
    f.oracle.attest(
        &NavReport {
            nav_per_share: wad(2),
            timestamp: 0,
            expires_at: u64::MAX,
        },
        &f.attester,
    );
    f.vault.fulfill_epoch(&epoch);

    assert_eq!(f.vault.claim_deposit(&user, &epoch), 200);
}

#[test]
fn a_deposit_claim_writes_the_new_share_balance_with_the_full_ttl() {
    let f = setup();
    let user = f.investor(1_000);
    let epoch = f.vault.request_deposit(&user, &400);
    f.fulfill_epoch(wad(2));
    testnet_minimum(&f.e);

    f.vault.claim_deposit(&user, &epoch);

    assert_eq!(share_balance_ttl(&f, &user), BALANCE_EXTEND_AMOUNT);
}

#[test]
fn the_first_redemption_writes_the_vaults_share_balance_with_the_full_ttl() {
    let f = setup();
    let holder = f.holder(100);
    testnet_minimum(&f.e);

    f.vault.request_redeem(&holder, &100);

    assert_eq!(
        share_balance_ttl(&f, &f.vault.address),
        BALANCE_EXTEND_AMOUNT
    );
}

#[test]
fn the_constructor_writes_each_role_with_the_full_ttl() {
    let e = Env::default();
    testnet_minimum(&e);
    let roles = distinct_roles(&e);

    let vault = register_with(&e, roles.clone());

    for (account, role) in [
        (&roles.manager, MANAGER_ROLE),
        (&roles.treasury, TREASURY_ROLE),
        (&roles.guardian, GUARDIAN_ROLE),
    ] {
        assert_eq!(
            role_entry_ttls(&e, &vault, account, &role),
            [ROLE_EXTEND_AMOUNT; 4]
        );
    }
}

#[test]
fn a_grant_during_setup_writes_the_role_with_the_full_ttl() {
    let f = setup_unfinished();
    let next = Address::generate(&f.e);
    testnet_minimum(&f.e);

    f.vault.grant_role(&next, &GUARDIAN_ROLE, &f.admin);

    assert_eq!(
        role_entry_ttls(&f.e, &f.vault.address, &next, &GUARDIAN_ROLE),
        [ROLE_EXTEND_AMOUNT; 4]
    );
}

#[test]
fn a_grant_through_the_timelock_writes_the_role_with_the_full_ttl() {
    let f = setup();
    let next = Address::generate(&f.e);
    let id = f
        .vault
        .propose_change(&VaultChange::GrantRole(GUARDIAN_ROLE, next.clone()));
    f.advance(MIN_UPGRADE_DELAY);
    testnet_minimum(&f.e);

    f.vault.apply_change(&id);

    assert_eq!(
        role_entry_ttls(&f.e, &f.vault.address, &next, &GUARDIAN_ROLE),
        [ROLE_EXTEND_AMOUNT; 4]
    );
}
