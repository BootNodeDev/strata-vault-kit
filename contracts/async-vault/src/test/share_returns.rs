use soroban_sdk::{contract, contractimpl};
use stellar_contract_utils::pausable::PausableError;
use stellar_tokens::rwa::compliance::ComplianceHook;

use super::*;

#[contract]
struct RefusesEveryTransfer;

#[contractimpl]
impl RefusesEveryTransfer {
    pub fn can_transfer(
        _e: Env,
        _from: Address,
        _to: Address,
        _amount: i128,
        _token: Address,
    ) -> bool {
        false
    }
}

#[test]
fn a_delisted_vault_still_returns_escrowed_shares() {
    let f = setup();
    let holder = f.holder(500);
    let epoch = f.vault.request_redeem(&holder, &200);

    f.identity.allow(&f.vault.address, &false, &f.compliance);
    assert!(!f.vault.health().allowlisted);

    assert_eq!(f.vault.cancel_redeem(&holder, &epoch), 200);
    assert_eq!(f.shares(&holder), 500);
}

#[test]
fn a_delisted_controller_cannot_take_shares_back() {
    let f = setup();
    let holder = f.holder(500);
    let epoch = f.vault.request_redeem(&holder, &200);
    f.identity.allow(&holder, &false, &f.compliance);

    refused(
        f.vault.try_cancel_redeem(&holder, &epoch),
        VaultError::NotAllowlisted,
    );
    assert_eq!(f.shares(&holder), 300);
    assert!(f.vault.get_redeem_request(&epoch, &holder).is_some());
}

#[test]
fn a_frozen_controller_cannot_take_shares_back() {
    let f = setup();
    let holder = f.holder(500);
    let epoch = f.vault.request_redeem(&holder, &200);
    f.share.set_address_frozen(&holder, &true, &f.compliance);

    refused(
        f.vault.try_cancel_redeem(&holder, &epoch),
        VaultError::Frozen,
    );
    assert_eq!(f.shares(&holder), 300);
}

#[test]
fn a_return_the_compliance_rules_refuse_stays_escrowed() {
    let f = setup();
    let holder = f.holder(500);
    let epoch = f.vault.request_redeem(&holder, &200);
    let module = f.e.register(RefusesEveryTransfer, ());
    f.add_compliance_module(ComplianceHook::CanTransfer, &module);

    refused(
        f.vault.try_cancel_redeem(&holder, &epoch),
        VaultError::HolderNotEligible,
    );
    assert_eq!(f.shares(&f.vault.address), 200);
    assert!(f.vault.get_redeem_request(&epoch, &holder).is_some());
}

#[test]
fn a_token_pause_stops_trading_but_not_a_share_return() {
    let f = setup();
    let holder = f.holder(500);
    let other = f.holder(10);
    let epoch = f.vault.request_redeem(&holder, &200);
    f.share.pause(&f.admin);

    assert_eq!(f.vault.cancel_redeem(&holder, &epoch), 200);
    assert_eq!(f.shares(&holder), 500);
    assert_eq!(
        f.share.try_transfer(&holder, &other, &1),
        Err(Ok(PausableError::EnforcedPause.into()))
    );
    assert_eq!(f.shares(&holder), 500);
}

#[test]
fn a_token_pause_does_not_stop_a_worthless_exit_coming_back() {
    let f = setup();
    let holder = f.holder(10);
    let epoch = f.vault.request_redeem(&holder, &1);
    // Priced at half a unit per share, one share pays nothing.
    f.fulfill_epoch(WAD_SCALE / 2);
    f.share.pause(&f.admin);

    assert_eq!(f.vault.claim_redeem(&holder, &epoch), 0);
    assert_eq!(f.shares(&holder), 10);
}

#[test]
fn a_partial_freeze_does_not_stop_a_return() {
    let f = setup();
    let holder = f.holder(500);
    let epoch = f.vault.request_redeem(&holder, &200);
    f.share.freeze_partial_tokens(&holder, &100, &f.compliance);

    assert_eq!(f.vault.cancel_redeem(&holder, &epoch), 200);
    assert_eq!(f.shares(&holder), 500);
    assert_eq!(f.share.get_frozen_tokens(&holder), 100);
}

#[test]
fn a_delisted_controller_with_a_worthless_exit_keeps_the_request() {
    let f = setup();
    let holder = f.holder(10);
    let epoch = f.vault.request_redeem(&holder, &1);
    // Priced at half a unit per share, one share pays nothing.
    f.fulfill_epoch(WAD_SCALE / 2);
    f.identity.allow(&holder, &false, &f.compliance);

    refused(
        f.vault.try_claim_redeem(&holder, &epoch),
        VaultError::HolderNotEligible,
    );
    assert_eq!(f.vault.pending_burn_shares(), 1);
    assert!(f.vault.get_redeem_request(&epoch, &holder).is_some());
}
