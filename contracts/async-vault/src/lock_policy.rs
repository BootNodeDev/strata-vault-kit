use soroban_sdk::{Address, Env};
use stellar_tokens::{
    fungible::FungibleTokenClient,
    rwa::{identity_verification::IdentityVerifierClient, RWATokenClient},
};

use crate::error::VaultError;
use crate::keys::DataKey;
use crate::state;

/// Where a holder stands with the share token.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Standing {
    Listed,
    Delisted,
    Frozen,
}

/// The holder's standing, asked of the share token and its identity verifier,
/// so the vault and the token never disagree.
pub(crate) fn standing(e: &Env, holder: &Address) -> Standing {
    let token = RWATokenClient::new(e, &state::get_addr(e, &DataKey::ShareToken));
    if token.is_frozen(holder) {
        return Standing::Frozen;
    }
    let verifier = token.identity_verifier();
    match IdentityVerifierClient::new(e, &verifier).try_verify_identity(holder) {
        Ok(Ok(())) => Standing::Listed,
        _ => Standing::Delisted,
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
pub(crate) fn decide(exit: Exit, standing: Standing, winding_down: bool) -> Decision {
    match (exit, standing, winding_down) {
        (Exit::RequestDeposit, Standing::Listed, _) => Decision::Proceed,
        (Exit::RequestDeposit, Standing::Delisted | Standing::Frozen, _) => Decision::Refuse,

        (Exit::ClaimDeposit, Standing::Listed, _) => Decision::Proceed,
        (Exit::ClaimDeposit, Standing::Delisted, false) => Decision::ConvertToExit,
        (Exit::ClaimDeposit, Standing::Delisted, true) => Decision::Surrender,
        (Exit::ClaimDeposit, Standing::Frozen, _) => Decision::Hold,

        (Exit::CancelRedeem, Standing::Listed, false) => Decision::Proceed,
        (Exit::CancelRedeem, Standing::Delisted, false) => Decision::Refuse,
        (Exit::CancelRedeem, Standing::Listed | Standing::Delisted, true) => Decision::Surrender,
        (Exit::CancelRedeem, Standing::Frozen, _) => Decision::Hold,

        (Exit::CancelDeposit, Standing::Listed | Standing::Delisted, _) => Decision::Proceed,
        (Exit::CancelDeposit, Standing::Frozen, _) => Decision::Hold,

        (Exit::RequestRedeem, Standing::Listed | Standing::Delisted, _) => Decision::Proceed,
        (Exit::RequestRedeem, Standing::Frozen, _) => Decision::Hold,

        (Exit::ClaimRedeem, Standing::Listed | Standing::Delisted, _) => Decision::Proceed,
        (Exit::ClaimRedeem, Standing::Frozen, _) => Decision::Hold,

        (Exit::ClaimWindDown, Standing::Listed | Standing::Delisted, _) => Decision::Proceed,
        (Exit::ClaimWindDown, Standing::Frozen, _) => Decision::Hold,
    }
}

/// The error an exit fails with when `decide` refuses or holds it.
pub(crate) fn refused_with(standing: Standing) -> VaultError {
    match standing {
        Standing::Frozen => VaultError::Frozen,
        Standing::Listed | Standing::Delisted => VaultError::NotAllowlisted,
    }
}

/// Shares the holder can move: the balance less any partial freeze.
pub(crate) fn free_shares(e: &Env, holder: &Address) -> i128 {
    let token = state::get_addr(e, &DataKey::ShareToken);
    let balance = FungibleTokenClient::new(e, &token).balance(holder);
    let frozen = RWATokenClient::new(e, &token).get_frozen_tokens(holder);
    (balance - frozen).max(0)
}
