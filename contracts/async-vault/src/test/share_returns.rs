use soroban_sdk::{contract, contracterror, contractimpl, panic_with_error};
use stellar_contract_utils::pausable::PausableError;
use stellar_tokens::rwa::{
    compliance::ComplianceHook, identity_verification::identity_registry_storage::IRSError,
    RWAError, RWA,
};

use super::*;

#[contract]
pub(super) struct RefusesEveryTransfer;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
enum ModuleError {
    CheckFailed = 1,
}

#[contract]
struct FailsEveryTransferCheck;

#[contractimpl]
impl FailsEveryTransferCheck {
    pub fn can_transfer(
        e: Env,
        _from: Address,
        _to: Address,
        _amount: i128,
        _token: Address,
    ) -> bool {
        panic_with_error!(&e, ModuleError::CheckFailed)
    }
}

/// An identity verifier that fails every check with one contract error code.
#[contract]
struct VerifierFailingWith;

#[contractimpl]
impl VerifierFailingWith {
    pub fn __constructor(e: Env, code: u32) {
        e.storage().instance().set(&symbol_short!("code"), &code);
    }

    pub fn verify_identity(e: Env, _account: Address) {
        let code: u32 = e.storage().instance().get(&symbol_short!("code")).unwrap();
        e.panic_with_error(soroban_sdk::Error::from_contract_error(code));
    }
}

/// Points the share token at a verifier that fails every check with `code`.
fn verifier_failing_with(f: &Fixture, code: u32) {
    let verifier = f.e.register(VerifierFailingWith, (code,));
    f.e.as_contract(&f.share.address, || {
        RWA::set_identity_verifier(&f.e, &verifier)
    });
}

/// A holder with one share escrowed in a redemption priced at half a unit a
/// share, which pays nothing.
fn worthless_exit(f: &Fixture) -> (Address, u64) {
    let holder = f.holder(10);
    let epoch = f.vault.request_redeem(&holder, &1);
    f.fulfill_epoch(WAD_SCALE / 2);
    (holder, epoch)
}

fn still_open(f: &Fixture, holder: &Address, epoch: u64) {
    assert_eq!(f.shares(holder), 9);
    assert_eq!(f.shares(&f.vault.address), 1);
    assert_eq!(f.vault.pending_burn_shares(), 1);
    assert!(!f.vault.get_redeem_request(&epoch, holder).unwrap().claimed);
    assert_eq!(
        f.vault.get_epoch_settlement(&epoch).unwrap().redeems_open,
        1
    );
}

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

    f.identity.allow(&f.vault.address, &false);
    assert!(!f.vault.health().allowlisted);

    assert_eq!(f.vault.cancel_redeem(&holder, &epoch), 200);
    assert_eq!(f.shares(&holder), 500);
}

#[test]
fn a_delisted_holder_cannot_take_shares_back() {
    let f = setup();
    let holder = f.holder(500);
    let epoch = f.vault.request_redeem(&holder, &200);
    f.identity.allow(&holder, &false);

    refused(
        f.vault.try_cancel_redeem(&holder, &epoch),
        VaultError::NotAllowlisted,
    );
    assert_eq!(f.shares(&holder), 300);
    assert!(f.vault.get_redeem_request(&epoch, &holder).is_some());
}

#[test]
fn a_frozen_holder_cannot_take_shares_back() {
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
fn a_worthless_exit_the_compliance_rules_refuse_to_return_burns() {
    let f = setup();
    let holder = f.holder(10);
    let epoch = f.vault.request_redeem(&holder, &1);
    // Priced at half a unit per share, one share pays nothing.
    f.fulfill_epoch(WAD_SCALE / 2);
    let module = f.e.register(RefusesEveryTransfer, ());
    f.add_compliance_module(ComplianceHook::CanTransfer, &module);

    assert_eq!(f.vault.claim_redeem(&holder, &epoch), 0);

    assert_eq!(f.shares(&holder), 9);
    assert_eq!(f.shares(&f.vault.address), 0);
    assert_eq!(f.vault.pending_burn_shares(), 0);
    assert!(f.vault.get_redeem_request(&epoch, &holder).unwrap().claimed);
    assert_eq!(
        f.vault.get_epoch_settlement(&epoch).unwrap().redeems_open,
        0
    );
}

/// A verifier that fails is not an answer that the holder is ineligible, so
/// nothing burns: the claim fails and can be retried once it answers again.
#[test]
fn a_worthless_exit_waits_while_the_verifier_cannot_answer() {
    let f = setup();
    let (holder, epoch) = worthless_exit(&f);
    let verifier = f.share.identity_verifier();
    let silent = Address::generate(&f.e);
    f.e.as_contract(&f.share.address, || {
        RWA::set_identity_verifier(&f.e, &silent)
    });

    refused(
        f.vault.try_claim_redeem(&holder, &epoch),
        VaultError::VerifierFailed,
    );
    still_open(&f, &holder, epoch);

    f.e.as_contract(&f.share.address, || {
        RWA::set_identity_verifier(&f.e, &verifier)
    });
    assert_eq!(f.vault.claim_redeem(&holder, &epoch), 0);
    assert_eq!(f.shares(&holder), 10);
}

#[test]
fn a_worthless_exit_waits_while_the_compliance_rules_cannot_answer() {
    let f = setup();
    let (holder, epoch) = worthless_exit(&f);
    let module = f.e.register(FailsEveryTransferCheck, ());
    f.add_compliance_module(ComplianceHook::CanTransfer, &module);

    assert_eq!(
        f.vault.try_claim_redeem(&holder, &epoch),
        Err(Ok(ModuleError::CheckFailed.into()))
    );
    still_open(&f, &holder, epoch);
}

/// OpenZeppelin's verifier reports a holder with no identity in its registry,
/// the state after off-boarding, as `IdentityNotFound`. That is an answer, so
/// the worthless exit burns and the request settles.
#[test]
fn a_worthless_exit_burns_for_a_holder_with_no_identity() {
    let f = setup();
    let (holder, epoch) = worthless_exit(&f);
    verifier_failing_with(&f, IRSError::IdentityNotFound as u32);

    assert_eq!(f.vault.claim_redeem(&holder, &epoch), 0);

    assert_eq!(f.shares(&holder), 9);
    assert_eq!(f.shares(&f.vault.address), 0);
    assert_eq!(f.vault.pending_burn_shares(), 0);
    assert!(f.vault.get_redeem_request(&epoch, &holder).unwrap().claimed);
    let s = f.vault.get_epoch_settlement(&epoch).unwrap();
    assert_eq!(s.redeems_open, 0);
    assert!(s.cash_reconciled);
}

/// Only the two refusals count as an answer. Any other code, including the
/// neighbours of both, is a failure: nothing moves.
#[test]
fn a_worthless_exit_waits_while_the_verifier_fails_with_any_other_code() {
    for code in [
        RWAError::InsufficientFreeTokens as u32,
        IRSError::CountryDataNotFound as u32,
        IRSError::AccountRecovered as u32,
        1,
    ] {
        let f = setup();
        let (holder, epoch) = worthless_exit(&f);
        verifier_failing_with(&f, code);

        refused(
            f.vault.try_claim_redeem(&holder, &epoch),
            VaultError::VerifierFailed,
        );
        still_open(&f, &holder, epoch);
    }
}
