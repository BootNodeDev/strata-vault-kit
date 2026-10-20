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
    f.identity.allow(&investor, &false);

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
    f.identity.allow(&investor, &false);

    f.identity.allow(&investor, &true);

    assert_eq!(f.vault.claim_deposit(&investor, &1), 200);
    assert_eq!(f.shares(&investor), 200);
}

/// Delisted after pricing, she cannot cancel, and a wind-down still pays her slice.
#[test]
fn a_holder_delisted_after_pricing_is_paid_through_a_wind_down() {
    let f = setup();
    let investor = f.investor(1_000);
    let epoch = f.vault.request_deposit(&investor, &400);
    f.fulfill_epoch(wad(2));
    assert_eq!(f.vault.cancellable_escrow(), 0);
    assert_eq!(f.vault.pending_mint_shares(), 200);
    f.identity.allow(&investor, &false);

    refused(
        f.vault.try_cancel_deposit(&investor, &epoch),
        VaultError::AlreadyPriced,
    );

    f.vault.propose_wind_down(&f.admin);
    f.advance(MIN_WIND_DOWN_DELAY);
    f.vault.activate_wind_down();
    assert_eq!(f.vault.claim_deposit(&investor, &epoch), 0);
    assert_eq!(f.vault.finalize_wind_down_round(), 400);
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
    f.add_compliance_module(ComplianceHook::CanCreate, &module);

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

    f.identity.allow(&user, &false);

    assert_eq!(f.vault.request_redeem(&user, &200), epoch);
    assert_eq!(f.shares(&f.vault.address), 200);
}

#[test]
fn a_delisted_holder_can_still_claim_their_exit() {
    let f = setup();
    let user = f.holder(500);
    let epoch = f.vault.request_redeem(&user, &200);
    f.fulfill_epoch(wad(2));

    f.identity.allow(&user, &false);

    assert_eq!(f.vault.claim_redeem(&user, &epoch), 400);
    assert_eq!(f.balance(&user), 400);
}

#[test]
fn a_delisted_investor_can_cancel_deposit_and_receive_asset() {
    let f = setup();
    let investor = f.investor(1_000);
    let epoch = f.vault.request_deposit(&investor, &400);

    // Investor gets delisted
    f.identity.allow(&investor, &false);

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
    f.identity.allow(&user, &false);

    refused(
        f.vault.try_cancel_redeem(&user, &epoch),
        VaultError::NotAllowlisted,
    );
    assert_eq!(f.shares(&user), 300);

    // Exit proceeds through cash claim once fulfilled
    f.fulfill_epoch(wad(2));
    assert_eq!(f.vault.claim_redeem(&user, &epoch), 400);
    assert_eq!(f.balance(&user), 400);
}

#[test]
fn a_frozen_holder_is_paid_only_after_the_freeze_lifts() {
    let f = setup();
    let user = f.holder(500);
    let epoch = f.vault.request_redeem(&user, &200);
    f.share.set_address_frozen(&user, &true, &f.compliance);

    refused(f.vault.try_cancel_redeem(&user, &epoch), VaultError::Frozen);
    f.fulfill_epoch(wad(2));
    refused(f.vault.try_claim_redeem(&user, &epoch), VaultError::Frozen);
    assert_eq!(f.vault.committed(), 400);
    assert_eq!(f.shares(&user), 300);

    f.share.set_address_frozen(&user, &false, &f.compliance);
    assert_eq!(f.vault.claim_redeem(&user, &epoch), 400);
    assert_eq!(f.vault.committed(), 0);
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
    f.identity.allow(&user, &false);
    assert!(f.share.try_transfer(&user, &recipient, &100).is_err());

    // Restore allowlist, then freeze sender
    f.identity.allow(&user, &true);
    f.share.set_address_frozen(&user, &true, &f.compliance);
    assert!(f.share.try_transfer(&user, &recipient, &100).is_err());
}

#[test]
fn a_frozen_investor_cannot_request_a_deposit() {
    let f = setup();
    let investor = f.investor(1_000);
    f.share.set_address_frozen(&investor, &true, &f.compliance);

    refused(
        f.vault.try_request_deposit(&investor, &400),
        VaultError::Frozen,
    );
    assert_eq!(f.balance(&investor), 1_000);
}

#[test]
fn a_frozen_investor_is_not_minted_until_unfrozen() {
    let f = setup();
    let investor = f.investor(1_000);
    f.vault.request_deposit(&investor, &400);
    f.fulfill_epoch(wad(2));
    f.share.set_address_frozen(&investor, &true, &f.compliance);

    refused(f.vault.try_claim_deposit(&investor, &1), VaultError::Frozen);
    assert_eq!(f.shares(&investor), 0);
    assert!(!f.vault.get_deposit_request(&1, &investor).unwrap().claimed);

    f.share.set_address_frozen(&investor, &false, &f.compliance);
    assert_eq!(f.vault.claim_deposit(&investor, &1), 200);
    assert_eq!(f.shares(&investor), 200);
}

#[test]
fn a_frozen_investors_zero_share_refund_is_held() {
    let f = setup();
    let investor = f.investor(10);
    let epoch = f.vault.request_deposit(&investor, &1);
    f.fulfill_epoch(wad(2));
    f.share.set_address_frozen(&investor, &true, &f.compliance);

    refused(
        f.vault.try_claim_deposit(&investor, &epoch),
        VaultError::Frozen,
    );
    assert_eq!(f.balance(&investor), 9);
    assert!(f.vault.get_deposit_request(&epoch, &investor).is_some());

    f.share.set_address_frozen(&investor, &false, &f.compliance);
    assert_eq!(f.vault.claim_deposit(&investor, &epoch), 0);
    assert_eq!(f.balance(&investor), 10);
}

#[test]
fn a_frozen_holder_cannot_queue_an_exit() {
    let f = setup();
    let user = f.holder(500);
    f.share.set_address_frozen(&user, &true, &f.compliance);

    refused(f.vault.try_request_redeem(&user, &200), VaultError::Frozen);
    assert_eq!(f.shares(&user), 500);
    assert_eq!(f.shares(&f.vault.address), 0);
}

#[test]
fn a_partial_freeze_limits_an_exit_to_the_free_shares() {
    let f = setup();
    let user = f.holder(500);
    f.share.freeze_partial_tokens(&user, &400, &f.compliance);

    refused(f.vault.try_request_redeem(&user, &101), VaultError::Frozen);
    f.vault.request_redeem(&user, &100);

    assert_eq!(f.shares(&user), 400);
    assert_eq!(f.share.get_frozen_tokens(&user), 400);
}

#[test]
fn a_frozen_investors_escrow_stays_until_the_freeze_lifts() {
    let f = setup();
    let investor = f.investor(1_000);
    let epoch = f.vault.request_deposit(&investor, &400);
    f.share.set_address_frozen(&investor, &true, &f.compliance);

    refused(
        f.vault.try_cancel_deposit(&investor, &epoch),
        VaultError::Frozen,
    );
    assert_eq!(f.vault.cancellable_escrow(), 400);

    f.share.set_address_frozen(&investor, &false, &f.compliance);
    assert_eq!(f.vault.cancel_deposit(&investor, &epoch), 400);
}

#[test]
fn a_frozen_holder_does_not_get_a_worthless_exit_back() {
    let f = setup();
    let user = f.holder(1);
    let epoch = f.vault.request_redeem(&user, &1);
    f.fulfill_epoch(WAD_SCALE / 2);
    f.share.set_address_frozen(&user, &true, &f.compliance);

    refused(f.vault.try_claim_redeem(&user, &epoch), VaultError::Frozen);
    assert_eq!(f.vault.pending_burn_shares(), 1);
    assert!(f.vault.get_redeem_request(&epoch, &user).is_some());
}

#[test]
fn a_frozen_holder_is_not_moved_into_the_exit_queue() {
    let f = setup();
    let investor = f.investor(1_000);
    let epoch = f.vault.request_deposit(&investor, &400);
    f.fulfill_epoch(wad(2));
    f.identity.allow(&investor, &false);
    f.share.set_address_frozen(&investor, &true, &f.compliance);

    refused(
        f.vault.try_claim_deposit(&investor, &epoch),
        VaultError::Frozen,
    );
    assert!(f
        .vault
        .get_redeem_request(&f.vault.current_epoch(), &investor)
        .is_none());
}
