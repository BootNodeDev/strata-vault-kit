use soroban_sdk::{contract, contractimpl, Symbol};

use super::*;

/// A feed whose answer to "which vault?" a test can change after proposing it.
#[contract]
struct FeedStub;

#[contractimpl]
impl FeedStub {
    pub fn report(e: Env, vault: Option<Address>) {
        e.storage().instance().set(&symbol_short!("vault"), &vault);
    }

    pub fn state(_e: Env) -> strata_bindings::OracleState {
        strata_bindings::OracleState::Valid
    }

    pub fn freshness_duration(_e: Env) -> u64 {
        3_600
    }
}

#[contractimpl(contracttrait)]
impl strata_bindings::VaultBinding for FeedStub {
    fn vault(e: &Env) -> Option<Address> {
        e.storage()
            .instance()
            .get(&symbol_short!("vault"))
            .unwrap_or(None)
    }

    fn setup_open(_e: &Env) -> bool {
        false
    }
}

/// A feed that passes the swap check, then traps on the one view a test names.
#[contract]
struct TrappingFeed;

#[contractimpl]
impl TrappingFeed {
    pub fn __constructor(e: Env, vault: Address) {
        e.storage().instance().set(&symbol_short!("vault"), &vault);
    }

    pub fn trap(e: Env, view: Symbol) {
        e.storage().instance().set(&symbol_short!("trap"), &view);
    }

    pub fn state(e: Env) -> strata_bindings::OracleState {
        trap_on(&e, symbol_short!("state"));
        strata_bindings::OracleState::Valid
    }

    pub fn freshness_duration(_e: Env) -> u64 {
        3_600
    }

    pub fn attested_at(e: Env) -> u64 {
        trap_on(&e, symbol_short!("attested"));
        e.ledger().timestamp()
    }

    pub fn nav_per_share(e: Env) -> i128 {
        trap_on(&e, symbol_short!("nav"));
        WAD_SCALE
    }
}

#[contractimpl(contracttrait)]
impl strata_bindings::VaultBinding for TrappingFeed {
    fn vault(e: &Env) -> Option<Address> {
        e.storage().instance().get(&symbol_short!("vault"))
    }

    fn setup_open(_e: &Env) -> bool {
        false
    }
}

fn trap_on(e: &Env, view: Symbol) {
    let trap: Option<Symbol> = e.storage().instance().get(&symbol_short!("trap"));
    if trap == Some(view) {
        panic!("the feed traps");
    }
}

/// Installs the feed the way governance would (propose, wait, apply), then sets its trap.
fn swap_to_a_feed_that_traps_on(f: &Fixture, view: Symbol) {
    let feed = TrappingFeedClient::new(
        &f.e,
        &f.e.register(TrappingFeed, (f.vault.address.clone(),)),
    );
    let id = f
        .vault
        .propose_change(&VaultChange::Oracle(feed.address.clone()));
    f.advance(MIN_UPGRADE_DELAY);
    f.vault.apply_change(&id);
    assert_eq!(f.vault.oracle(), feed.address);
    feed.trap(&view);
}

fn unbound_feed<'a>(f: &Fixture<'a>) -> NavOracleContractClient<'a> {
    NavOracleContractClient::new(
        &f.e,
        &f.e.register(
            NavOracleContract,
            (
                f.admin.clone(),
                f.attester.clone(),
                f.guardian.clone(),
                open_feed(),
            ),
        ),
    )
}

fn second_feed<'a>(f: &Fixture<'a>) -> NavOracleContractClient<'a> {
    let feed = unbound_feed(f);
    feed.bind_vault(&f.vault.address);
    feed.finish_setup();
    feed
}

fn attest_on(f: &Fixture, feed: &NavOracleContractClient, nav_per_share: i128) {
    feed.attest(&nav_input(&f.e, nav_per_share, u64::MAX), &f.attester);
}

#[test]
fn the_oracle_changes_only_through_the_timelock() {
    let f = setup();
    let next = second_feed(&f);

    let id = f
        .vault
        .propose_change(&VaultChange::Oracle(next.address.clone()));
    f.advance(MIN_UPGRADE_DELAY - 1);
    refused(f.vault.try_apply_change(&id), VaultError::ChangeNotReady);
    assert_eq!(f.vault.oracle(), f.oracle.address);

    f.advance(1);
    f.vault.apply_change(&id);
    assert_eq!(f.vault.oracle(), next.address);
}

#[test]
fn the_next_epoch_prices_from_the_new_feed() {
    let f = setup();
    let next = second_feed(&f);
    let id = f
        .vault
        .propose_change(&VaultChange::Oracle(next.address.clone()));
    f.advance(MIN_UPGRADE_DELAY);
    f.vault.apply_change(&id);
    attest_on(&f, &next, wad(2));
    let investor = f.investor(1_000);
    f.vault.request_deposit(&investor, &400);
    let epoch = f.close_epoch();

    f.attest(wad(2));
    f.advance(next.config().cooldown_secs);
    attest_on(&f, &next, wad(4));
    f.vault.fulfill_epoch(&epoch);

    assert_eq!(f.vault.get_epoch(&epoch).unwrap().share_price, wad(4));
}

#[test]
fn a_sealed_epoch_is_priced_by_the_feed_standing_at_fulfilment() {
    let f = setup();
    let next = second_feed(&f);
    let investor = f.investor(1_000);
    f.vault.request_deposit(&investor, &400);
    let epoch = f.close_epoch();

    let id = f
        .vault
        .propose_change(&VaultChange::Oracle(next.address.clone()));
    f.advance(MIN_UPGRADE_DELAY);
    f.vault.apply_change(&id);
    attest_on(&f, &next, wad(4));
    f.vault.fulfill_epoch(&epoch);

    assert_eq!(f.vault.claim_deposit(&investor, &epoch), 100);
}

#[test]
fn a_feed_outside_this_vault_is_never_proposed() {
    let f = setup();
    let open = unbound_feed(&f);
    open.bind_vault(&f.vault.address);
    let elsewhere = unbound_feed(&f);
    elsewhere.bind_vault(&register_with(&f.e, distinct_roles(&f.e)));
    elsewhere.finish_setup();

    for feed in [
        Address::generate(&f.e),
        unbound_feed(&f).address,
        open.address,
        elsewhere.address,
    ] {
        refused(
            f.vault.try_propose_change(&VaultChange::Oracle(feed)),
            VaultError::FeedNotBound,
        );
    }
    assert_eq!(f.vault.pending_changes().len(), 0);
}

#[test]
fn a_feed_that_stops_naming_this_vault_is_never_installed() {
    let f = setup();
    let stub = FeedStubClient::new(&f.e, &f.e.register(FeedStub, ()));
    stub.report(&Some(f.vault.address.clone()));
    let id = f
        .vault
        .propose_change(&VaultChange::Oracle(stub.address.clone()));

    stub.report(&Some(Address::generate(&f.e)));
    f.advance(MIN_UPGRADE_DELAY);

    refused(f.vault.try_apply_change(&id), VaultError::FeedNotBound);
    assert_eq!(f.vault.oracle(), f.oracle.address);
}

#[test]
fn a_contract_that_is_not_a_feed_is_refused_when_proposed_and_when_applied() {
    let f = setup();
    // Bound to this vault with its setup closed, but it answers no feed view.
    let change = VaultChange::Oracle(f.share.compliance());

    refused(
        f.vault.try_propose_change(&change),
        VaultError::FeedNotBound,
    );

    // Skips the proposal's check, as a change queued by an earlier version would.
    let id = f.e.as_contract(&f.vault.address, || {
        strata_timelock::queue::propose::<AsyncVault, _>(&f.e, &change).unwrap()
    });
    f.advance(MIN_UPGRADE_DELAY);

    refused(f.vault.try_apply_change(&id), VaultError::FeedNotBound);
    assert_eq!(f.vault.oracle(), f.oracle.address);
}

#[test]
fn a_sealed_deposit_cancels_when_the_feed_traps() {
    let f = setup();
    let investor = f.investor(1_000);
    let epoch = f.vault.request_deposit(&investor, &400);
    f.close_epoch();
    swap_to_a_feed_that_traps_on(&f, symbol_short!("attested"));

    assert_eq!(f.vault.cancel_deposit(&investor, &epoch), 400);
    assert_eq!(f.balance(&investor), 1_000);
}

#[test]
fn a_sealed_redemption_cancels_when_the_feed_traps() {
    let f = setup();
    let holder = f.holder(200);
    let epoch = f.vault.request_redeem(&holder, &200);
    f.close_epoch();
    swap_to_a_feed_that_traps_on(&f, symbol_short!("attested"));

    assert_eq!(f.vault.cancel_redeem(&holder, &epoch), 200);
    assert_eq!(f.shares(&holder), 200);
}

#[test]
fn a_feed_that_traps_on_its_attestation_refuses_fulfilment() {
    let f = setup();
    let investor = f.investor(1_000);
    f.vault.request_deposit(&investor, &400);
    let epoch = f.close_epoch();
    swap_to_a_feed_that_traps_on(&f, symbol_short!("attested"));

    refused(f.vault.try_fulfill_epoch(&epoch), VaultError::FeedNotValid);
}

#[test]
fn a_feed_that_traps_on_its_price_refuses_fulfilment() {
    let f = setup();
    let investor = f.investor(1_000);
    f.vault.request_deposit(&investor, &400);
    let epoch = f.close_epoch();
    swap_to_a_feed_that_traps_on(&f, symbol_short!("nav"));

    refused(f.vault.try_fulfill_epoch(&epoch), VaultError::FeedNotValid);
}

/// Deposits read only the feed's state, so they still land; cancelling is the way out.
#[test]
fn a_deposit_still_lands_and_can_leave_when_the_feed_traps() {
    let f = setup();
    swap_to_a_feed_that_traps_on(&f, symbol_short!("attested"));
    let investor = f.investor(1_000);

    let epoch = f.vault.request_deposit(&investor, &400);
    assert_eq!(f.balance(&investor), 600);
    f.close_epoch();

    assert_eq!(f.vault.cancel_deposit(&investor, &epoch), 400);
    assert_eq!(f.balance(&investor), 1_000);
}

#[test]
fn a_feed_that_traps_on_its_state_neither_prices_nor_blocks_a_cancel() {
    let f = setup();
    let investor = f.investor(1_000);
    let epoch = f.vault.request_deposit(&investor, &400);
    f.close_epoch();
    swap_to_a_feed_that_traps_on(&f, symbol_short!("state"));

    refused(f.vault.try_fulfill_epoch(&epoch), VaultError::FeedNotValid);
    assert_eq!(f.vault.cancel_deposit(&investor, &epoch), 400);
}
