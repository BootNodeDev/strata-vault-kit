//! A new bound-token or module entry gets its full TTL in the call that creates it.

use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{storage::Persistent as _, Address as _, Ledger as _},
    Address, Env, IntoVal, Val,
};
use stellar_tokens::rwa::{
    compliance::{storage::ComplianceDataKey, ComplianceHook, COMPLIANCE_EXTEND_AMOUNT},
    utils::token_binder::{BUCKET_SIZE, TOKEN_BINDER_EXTEND_AMOUNT},
};
use strata_timelock::{Clock, MIN_DELAY};

use crate::{Compliance, ComplianceChange, ComplianceClient};

/// Testnet's minimum lifetime of a new persistent entry, in ledgers.
const TESTNET_MIN_PERSISTENT_TTL: u32 = 120_960;

/// Plays the vault: its clock lets a timelocked change land.
#[contract]
struct VaultStub;

#[contractimpl(contracttrait)]
impl strata_timelock::ClockSource for VaultStub {
    fn timelock_clock(_e: &Env) -> Clock {
        Clock {
            delay: MIN_DELAY,
            exit_window: 0,
            paused_secs: 0,
            paused: false,
            winding_down: false,
        }
    }
}

/// Mirrors OpenZeppelin's private token-binder key: same variants, same encoding.
#[contracttype]
enum TokenBinderStorageKey {
    TokenBucket(u32),
    TotalCount,
}

struct Fixture<'a> {
    e: Env,
    rules: ComplianceClient<'a>,
    admin: Address,
}

impl Fixture<'_> {
    fn persistent_ttl<K: IntoVal<Env, Val>>(&self, key: &K) -> u32 {
        self.e.as_contract(&self.rules.address, || {
            self.e.storage().persistent().get_ttl(key)
        })
    }

    /// Every entry a first binding writes: the token count and the first bucket.
    fn bound_token_ttls(&self) -> [u32; 2] {
        [
            self.persistent_ttl(&TokenBinderStorageKey::TotalCount),
            self.persistent_ttl(&TokenBinderStorageKey::TokenBucket(0)),
        ]
    }

    fn modules_ttl(&self, hook: ComplianceHook) -> u32 {
        self.persistent_ttl(&ComplianceDataKey::HookModules(hook))
    }

    fn land(&self, change: &ComplianceChange) {
        let id = self.rules.propose_change(change);
        self.e.ledger().with_mut(|l| {
            l.timestamp += MIN_DELAY;
            l.sequence_number += (MIN_DELAY / 5) as u32;
        });
        self.rules.apply_change(&id);
    }
}

/// A compliance contract in setup on a ledger with testnet's minimum lifetime.
fn setup<'a>() -> Fixture<'a> {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger()
        .set_min_persistent_entry_ttl(TESTNET_MIN_PERSISTENT_TTL);
    let admin = Address::generate(&e);
    let rules = ComplianceClient::new(&e, &e.register(Compliance, (admin.clone(),)));
    Fixture { e, rules, admin }
}

fn finished<'a>() -> Fixture<'a> {
    let f = setup();
    f.rules.bind_vault(&f.e.register(VaultStub, ()));
    f.rules.finish_setup();
    f
}

#[test]
fn a_binding_during_setup_writes_the_bound_tokens_with_the_full_ttl() {
    let f = setup();

    f.rules.bind_token(&Address::generate(&f.e), &f.admin);

    assert_eq!(f.bound_token_ttls(), [TOKEN_BINDER_EXTEND_AMOUNT; 2]);
}

#[test]
fn a_binding_through_the_timelock_writes_the_bound_tokens_with_the_full_ttl() {
    let f = finished();

    f.land(&ComplianceChange::BindToken(Address::generate(&f.e)));

    assert_eq!(f.bound_token_ttls(), [TOKEN_BINDER_EXTEND_AMOUNT; 2]);
}

#[test]
fn the_binding_that_opens_a_second_bucket_writes_it_with_the_full_ttl() {
    let f = setup();

    for _ in 0..=BUCKET_SIZE {
        f.rules.bind_token(&Address::generate(&f.e), &f.admin);
    }

    assert_eq!(
        f.persistent_ttl(&TokenBinderStorageKey::TokenBucket(1)),
        TOKEN_BINDER_EXTEND_AMOUNT
    );
}

#[test]
fn a_module_added_during_setup_writes_the_hooks_modules_with_the_full_ttl() {
    let f = setup();

    f.rules.add_module_to(
        &ComplianceHook::CanTransfer,
        &Address::generate(&f.e),
        &f.admin,
    );

    assert_eq!(
        f.modules_ttl(ComplianceHook::CanTransfer),
        COMPLIANCE_EXTEND_AMOUNT
    );
}

#[test]
fn a_module_added_through_the_timelock_writes_the_hooks_modules_with_the_full_ttl() {
    let f = finished();

    f.land(&ComplianceChange::AddModule(
        ComplianceHook::Created,
        Address::generate(&f.e),
    ));

    assert_eq!(
        f.modules_ttl(ComplianceHook::Created),
        COMPLIANCE_EXTEND_AMOUNT
    );
}
