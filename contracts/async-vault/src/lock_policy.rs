use soroban_sdk::{panic_with_error, Address, Env, Error};
use stellar_tokens::{
    fungible::FungibleTokenClient,
    rwa::{
        identity_verification::{identity_registry_storage::IRSError, IdentityVerifierClient},
        RWAError, RWATokenClient,
    },
};

use crate::error::VaultError;
use crate::keys::DataKey;
use crate::state;

/// Where a holder stands with the share token.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Standing {
    Listed,
    Delisted,
    /// The verifier failed instead of answering.
    Unverifiable,
    Frozen,
}

/// The standard refusal of an identity verifier: the holder does not verify.
const NOT_VERIFIED: Error = Error::from_contract_error(RWAError::IdentityVerificationFailed as u32);
/// OpenZeppelin's registry holds no identity for the holder, as after off-boarding.
const NO_IDENTITY: Error = Error::from_contract_error(IRSError::IdentityNotFound as u32);

/// What the identity verifier said of a holder.
enum Verdict {
    Verified,
    Refused,
    /// The verifier failed instead of answering.
    Failed,
}

fn verdict(e: &Env, token: &RWATokenClient, holder: &Address) -> Verdict {
    let verifier = token.identity_verifier();
    match IdentityVerifierClient::new(e, &verifier).try_verify_identity(holder) {
        Ok(Ok(())) => Verdict::Verified,
        Err(Ok(error)) if error == NOT_VERIFIED || error == NO_IDENTITY => Verdict::Refused,
        _ => Verdict::Failed,
    }
}

/// The holder's standing, asked of the share token and its identity verifier,
/// so the vault and the token never disagree. Only a refusal delists; a
/// verifier that fails leaves the holder unverifiable.
pub(crate) fn standing(e: &Env, holder: &Address) -> Standing {
    let token = RWATokenClient::new(e, &state::get_addr(e, &DataKey::ShareToken));
    if token.is_frozen(holder) {
        return Standing::Frozen;
    }
    match verdict(e, &token, holder) {
        Verdict::Verified => Standing::Listed,
        Verdict::Refused => Standing::Delisted,
        Verdict::Failed => Standing::Unverifiable,
    }
}

/// The vault's entrypoints that move a holder's value.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Exit {
    RequestDeposit,
    ClaimDeposit,
    CancelRedeem,
    CancelDeposit,
    RequestRedeem,
    ClaimRedeem,
    ClaimWindDown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Decision {
    Proceed,
    Refuse,
    /// The priced shares join the holder's redemption in the open epoch.
    ConvertToExit,
    /// The shares join the holder's wind-down entitlement.
    Surrender,
    /// Nothing moves until the freeze is lifted.
    Hold,
}

/// What `exit` does for a holder in `standing`. No storage, no calls.
///
/// A fault lets no one in and forces no one out: wherever a listed and a
/// delisted holder part ways, an unverifiable one waits, except in a
/// wind-down, which reads the fault as a refusal.
pub(crate) fn decide(exit: Exit, standing: Standing, winding_down: bool) -> Decision {
    use Standing::{Delisted, Frozen, Listed, Unverifiable};
    match (exit, standing, winding_down) {
        (Exit::RequestDeposit, Listed, _) => Decision::Proceed,
        (Exit::RequestDeposit, Delisted | Unverifiable | Frozen, _) => Decision::Refuse,

        (Exit::ClaimDeposit, Listed, _) => Decision::Proceed,
        (Exit::ClaimDeposit, Delisted, false) => Decision::ConvertToExit,
        (Exit::ClaimDeposit, Unverifiable, false) => Decision::Refuse,
        (Exit::ClaimDeposit, Delisted | Unverifiable, true) => Decision::Surrender,
        (Exit::ClaimDeposit, Frozen, _) => Decision::Hold,

        (Exit::CancelRedeem, Listed, false) => Decision::Proceed,
        (Exit::CancelRedeem, Delisted | Unverifiable, false) => Decision::Refuse,
        (Exit::CancelRedeem, Listed | Delisted | Unverifiable, true) => Decision::Surrender,
        (Exit::CancelRedeem, Frozen, _) => Decision::Hold,

        (Exit::CancelDeposit, Listed | Delisted | Unverifiable, _) => Decision::Proceed,
        (Exit::CancelDeposit, Frozen, _) => Decision::Hold,

        (Exit::RequestRedeem, Listed | Delisted | Unverifiable, _) => Decision::Proceed,
        (Exit::RequestRedeem, Frozen, _) => Decision::Hold,

        (Exit::ClaimRedeem, Listed | Delisted | Unverifiable, _) => Decision::Proceed,
        (Exit::ClaimRedeem, Frozen, _) => Decision::Hold,

        (Exit::ClaimWindDown, Listed | Delisted | Unverifiable, _) => Decision::Proceed,
        (Exit::ClaimWindDown, Frozen, _) => Decision::Hold,
    }
}

/// The error an exit fails with when `decide` refuses or holds it.
pub(crate) fn refused_with(standing: Standing) -> VaultError {
    match standing {
        Standing::Frozen => VaultError::Frozen,
        Standing::Unverifiable => VaultError::VerifierFailed,
        Standing::Listed | Standing::Delisted => VaultError::NotAllowlisted,
    }
}

/// Sends escrowed shares back to the holder when the holder may hold them.
/// It moves them as the token's manager, so neither the vault's listing nor
/// the token pause applies, while the compliance rules still judge the move.
/// Returns whether they moved: any move that fails rolls back and reads as
/// "may not", whether a module refused it or failed. A verifier that fails
/// fails the caller, so no verifier fault is read as a refusal.
/// Module authors: see the compliance matrix (`docs/COMPLIANCE_MATRIX.md`).
pub(crate) fn send_back(e: &Env, holder: &Address, shares: i128) -> bool {
    let token = state::get_addr(e, &DataKey::ShareToken);
    let share = RWATokenClient::new(e, &token);
    if share.is_frozen(holder) {
        return false;
    }
    match verdict(e, &share, holder) {
        Verdict::Verified => {}
        Verdict::Refused => return false,
        Verdict::Failed => panic_with_error!(e, VaultError::VerifierFailed),
    }
    let vault = e.current_contract_address();
    let sent = share.try_forced_transfer(&vault, holder, &shares, &vault);
    matches!(sent, Ok(Ok(())))
}

/// Shares the holder can move: the balance less any partial freeze.
pub(crate) fn free_shares(e: &Env, holder: &Address) -> i128 {
    let token = state::get_addr(e, &DataKey::ShareToken);
    let balance = FungibleTokenClient::new(e, &token).balance(holder);
    let frozen = RWATokenClient::new(e, &token).get_frozen_tokens(holder);
    (balance - frozen).max(0)
}
