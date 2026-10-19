use soroban_sdk::{contract, contractimpl};

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
    feed.bind_vault(&f.vault.address, &f.admin);
    feed.finish_setup(&f.admin);
    feed
}

fn attest_on(f: &Fixture, feed: &NavOracleContractClient, nav_per_share: i128) {
    feed.attest(
        &NavReport {
            nav_per_share,
            timestamp: 0,
            expires_at: u64::MAX,
        },
        &f.attester,
    );
}

#[test]
fn the_oracle_changes_only_through_the_timelock() {
    let f = setup();
    let next = second_feed(&f);

    let id = f
        .vault
        .propose_change(&VaultChange::Oracle(next.address.clone()), &f.admin);
    f.advance(MIN_UPGRADE_DELAY - 1);
    refused(
        f.vault.try_apply_change(&id, &f.admin),
        VaultError::ChangeNotReady,
    );
    assert_eq!(f.vault.oracle(), f.oracle.address);

    f.advance(1);
    f.vault.apply_change(&id, &f.admin);
    assert_eq!(f.vault.oracle(), next.address);
}

#[test]
fn the_next_epoch_prices_from_the_new_feed() {
    let f = setup();
    let next = second_feed(&f);
    let id = f
        .vault
        .propose_change(&VaultChange::Oracle(next.address.clone()), &f.admin);
    f.advance(MIN_UPGRADE_DELAY);
    f.vault.apply_change(&id, &f.admin);
    let investor = f.investor(1_000);
    f.vault.request_deposit(&investor, &400);
    let epoch = f.close_epoch();

    f.attest(wad(2));
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
        .propose_change(&VaultChange::Oracle(next.address.clone()), &f.admin);
    f.advance(MIN_UPGRADE_DELAY);
    f.vault.apply_change(&id, &f.admin);
    attest_on(&f, &next, wad(4));
    f.vault.fulfill_epoch(&epoch);

    assert_eq!(f.vault.claim_deposit(&investor, &epoch), 100);
}

#[test]
fn a_feed_outside_this_vault_is_never_proposed() {
    let f = setup();
    let open = unbound_feed(&f);
    open.bind_vault(&f.vault.address, &f.admin);
    let elsewhere = unbound_feed(&f);
    elsewhere.bind_vault(&register_with(&f.e, distinct_roles(&f.e)), &f.admin);
    elsewhere.finish_setup(&f.admin);

    for feed in [
        Address::generate(&f.e),
        unbound_feed(&f).address,
        open.address,
        elsewhere.address,
    ] {
        refused(
            f.vault
                .try_propose_change(&VaultChange::Oracle(feed), &f.admin),
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
        .propose_change(&VaultChange::Oracle(stub.address.clone()), &f.admin);

    stub.report(&Some(Address::generate(&f.e)));
    f.advance(MIN_UPGRADE_DELAY);

    refused(
        f.vault.try_apply_change(&id, &f.admin),
        VaultError::FeedNotBound,
    );
    assert_eq!(f.vault.oracle(), f.oracle.address);
}
