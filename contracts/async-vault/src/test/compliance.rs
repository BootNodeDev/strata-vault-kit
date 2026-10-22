use soroban_sdk::{contract, contractimpl};
use stellar_tokens::rwa::compliance::ComplianceHook;

use super::*;

#[test]
fn an_investor_who_was_never_allowlisted_is_refused_before_any_cash_moves() {
    let f = setup();
    let stranger = f.unverified_investor(1_000);

    refused(
        f.vault.try_request_deposit(&stranger, &400),
        VaultError::NotAllowlisted,
    );

    assert_eq!(f.balance(&stranger), 1_000);
    assert_eq!(f.balance(&f.vault.address), 0);
    assert_eq!(f.vault.cancellable_escrow(), 0);
    assert_eq!(f.vault.get_epoch(&1).unwrap().total_deposited, 0);
    assert_eq!(f.vault.get_deposit_request(&1, &stranger), None);
}

#[test]
fn a_delisted_investor_cannot_request_a_deposit() {
    let f = setup();
    let investor = f.investor(1_000);
    f.identity.allow(&investor, &false, &f.compliance);

    refused(
        f.vault.try_request_deposit(&investor, &400),
        VaultError::NotAllowlisted,
    );
    assert_eq!(f.balance(&investor), 1_000);
}

#[test]
fn an_allowlisted_investor_still_requests_a_deposit() {
    let f = setup();
    let investor = f.investor(1_000);

    assert_eq!(f.vault.request_deposit(&investor, &400), 1);
    assert_eq!(f.balance(&f.vault.address), 400);
}

#[test]
fn relisting_after_pricing_lets_the_claim_through() {
    let f = setup();
    let investor = f.investor(1_000);
    f.vault.request_deposit(&investor, &400);
    f.fulfill_epoch(wad(2));
    f.identity.allow(&investor, &false, &f.compliance);
    assert!(f.vault.try_claim_deposit(&investor, &1).is_err());

    f.identity.allow(&investor, &true, &f.compliance);

    assert_eq!(f.vault.claim_deposit(&investor, &1), 200);
    assert_eq!(f.shares(&investor), 200);
}

/// Today's behaviour for a holder delisted after their deposit was priced:
/// relisting is the only way out. The cash joined the reserve at pricing, so
/// her claim is to shares, and the wind-down holds her part in `owed` where
/// nobody can collect it.
#[test]
fn a_holder_delisted_after_pricing_can_only_leave_by_being_relisted() {
    let f = setup();
    let investor = f.investor(1_000);
    let epoch = f.vault.request_deposit(&investor, &400);
    f.fulfill_epoch(wad(2));
    assert_eq!(f.vault.cancellable_escrow(), 0);
    assert_eq!(f.vault.pending_mint_shares(), 200);

    f.identity.allow(&investor, &false, &f.compliance);

    assert_eq!(
        f.vault.try_claim_deposit(&investor, &epoch).err(),
        Some(Ok(soroban_sdk::Error::from_contract_error(304)))
    );
    refused(
        f.vault.try_cancel_deposit(&investor, &epoch),
        VaultError::AlreadyPriced,
    );

    f.vault.propose_wind_down(&f.admin);
    f.vault.activate_wind_down();
    assert_eq!(f.vault.finalize_wind_down_round(), 400);
    refused(
        f.vault.try_claim_wind_down(&investor),
        VaultError::NoEntitlement,
    );
    assert_eq!(f.vault.wind_down_owed(), 400);

    f.identity.allow(&investor, &true, &f.compliance);
    assert_eq!(f.vault.claim_deposit(&investor, &epoch), 200);
    assert_eq!(f.vault.claim_wind_down(&investor), 400);
    assert_eq!(f.vault.wind_down_owed(), 0);
}

#[contract]
pub(super) struct RefusesEveryMint;

#[contractimpl]
impl RefusesEveryMint {
    pub fn can_create(_e: Env, _to: Address, _amount: i128, _token: Address) -> bool {
        false
    }
}

/// A compliance module can refuse the mint of a priced deposit even for an
/// allowlisted holder. The kit cannot stop it; it is a trust assumption.
#[test]
fn a_compliance_module_that_refuses_the_mint_blocks_a_priced_claim() {
    let f = setup();
    let investor = f.investor(1_000);
    let epoch = f.vault.request_deposit(&investor, &400);
    f.fulfill_epoch(wad(2));

    let module = f.e.register(RefusesEveryMint, ());
    ComplianceClient::new(&f.e, &f.share.compliance()).add_module_to(
        &ComplianceHook::CanCreate,
        &module,
        &f.admin,
    );

    assert_eq!(
        f.vault.try_claim_deposit(&investor, &epoch).err(),
        Some(Ok(soroban_sdk::Error::from_contract_error(306)))
    );
    refused(
        f.vault.try_cancel_deposit(&investor, &epoch),
        VaultError::AlreadyPriced,
    );
}

#[test]
fn a_delisted_holder_can_still_queue_an_exit() {
    let f = setup();
    let user = f.holder(500);
    let epoch = f.vault.current_epoch();

    f.identity.allow(&user, &false, &f.compliance);

    assert_eq!(f.vault.request_redeem(&user, &200), epoch);
    assert_eq!(f.shares(&f.vault.address), 200);
}

#[test]
fn a_delisted_holder_can_still_claim_their_exit() {
    let f = setup();
    let user = f.holder(500);
    let epoch = f.vault.request_redeem(&user, &200);
    f.fulfill_epoch(wad(2));

    f.identity.allow(&user, &false, &f.compliance);

    assert_eq!(f.vault.claim_redeem(&user, &epoch), 400);
    assert_eq!(f.balance(&user), 400);
}

#[test]
fn a_delisted_investor_can_cancel_deposit_and_receive_asset() {
    let f = setup();
    let investor = f.investor(1_000);
    let epoch = f.vault.request_deposit(&investor, &400);

    // Investor gets delisted
    f.identity.allow(&investor, &false, &f.compliance);

    // Delisted investor can still cancel deposit and receive settlement asset
    assert_eq!(f.vault.cancel_deposit(&investor, &epoch), 400);
    assert_eq!(f.balance(&investor), 1_000);
}

#[test]
fn a_delisted_holder_cannot_cancel_redemption_back_to_shares() {
    let f = setup();
    let user = f.holder(500);
    let epoch = f.vault.request_redeem(&user, &200);

    // Delisted before pricing
    f.identity.allow(&user, &false, &f.compliance);

    // Cannot return shares to a delisted account (refused by share transfer compliance)
    assert!(f.vault.try_cancel_redeem(&user, &epoch).is_err());
    assert_eq!(f.shares(&user), 300);

    // Exit proceeds through cash claim once fulfilled
    f.fulfill_epoch(wad(2));
    assert_eq!(f.vault.claim_redeem(&user, &epoch), 400);
    assert_eq!(f.balance(&user), 400);
}

#[test]
fn a_frozen_holder_cannot_cancel_redemption_back_to_shares() {
    let f = setup();
    let user = f.holder(500);
    let epoch = f.vault.request_redeem(&user, &200);

    // Freeze address
    f.share.set_address_frozen(&user, &true, &f.compliance);
    assert!(f.share.is_frozen(&user));

    // Cannot return shares to a frozen account
    assert!(f.vault.try_cancel_redeem(&user, &epoch).is_err());
    assert_eq!(f.shares(&user), 300);

    // Exit proceeds through cash claim once fulfilled
    f.fulfill_epoch(wad(2));
    assert_eq!(f.vault.claim_redeem(&user, &epoch), 400);
    assert_eq!(f.balance(&user), 400);
}

#[test]
fn a_frozen_or_delisted_holder_cannot_transfer_shares() {
    let f = setup();
    let user = f.holder(500);
    let recipient = f.investor(0);

    // Transfer works when both allowlisted
    f.share.transfer(&user, &recipient, &100);
    assert_eq!(f.shares(&recipient), 100);

    // Delisted sender cannot transfer
    f.identity.allow(&user, &false, &f.compliance);
    assert!(f.share.try_transfer(&user, &recipient, &100).is_err());

    // Restore allowlist, then freeze sender
    f.identity.allow(&user, &true, &f.compliance);
    f.share.set_address_frozen(&user, &true, &f.compliance);
    assert!(f.share.try_transfer(&user, &recipient, &100).is_err());
}

#[test]
fn a_frozen_investor_on_the_allowlist_is_still_minted() {
    let f = setup();
    let investor = f.investor(1_000);
    f.vault.request_deposit(&investor, &400);
    f.fulfill_epoch(wad(2));

    f.share.set_address_frozen(&investor, &true, &f.compliance);

    assert_eq!(f.vault.claim_deposit(&investor, &1), 200);
    assert_eq!(f.shares(&investor), 200);
}

#[test]
fn a_frozen_holder_can_still_queue_an_exit() {
    let f = setup();
    let user = f.holder(500);
    let epoch = f.vault.current_epoch();

    f.share.set_address_frozen(&user, &true, &f.compliance);

    assert_eq!(f.vault.request_redeem(&user, &200), epoch);
    assert_eq!(f.shares(&f.vault.address), 200);
}

#[test]
fn queueing_an_exit_releases_a_partial_freeze() {
    let f = setup();
    let user = f.holder(500);
    f.share.freeze_partial_tokens(&user, &400, &f.compliance);

    f.vault.request_redeem(&user, &300);

    assert_eq!(f.shares(&user), 200);
    assert_eq!(f.share.get_frozen_tokens(&user), 200);
}
