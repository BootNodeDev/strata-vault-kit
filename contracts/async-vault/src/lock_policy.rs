use soroban_sdk::{Address, Env};
use stellar_tokens::rwa::{identity_verification::IdentityVerifierClient, RWATokenClient};

use crate::keys::DataKey;
use crate::state;

/// Where a holder stands with the share token.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Standing {
    Listed,
    Delisted,
}

/// The holder's standing, asked of the identity verifier the share token
/// itself uses, so the vault and the token never disagree.
pub(crate) fn standing(e: &Env, holder: &Address) -> Standing {
    let token = state::get_addr(e, &DataKey::ShareToken);
    let verifier = RWATokenClient::new(e, &token).identity_verifier();
    match IdentityVerifierClient::new(e, &verifier).try_verify_identity(holder) {
        Ok(Ok(())) => Standing::Listed,
        _ => Standing::Delisted,
    }
}

/// The vault's entrypoints that move a holder's value.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Exit {
    RequestDeposit,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Decision {
    Proceed,
    Refuse,
}

/// What `exit` does for a holder in `standing`. No storage, no calls.
pub(crate) fn decide(exit: Exit, standing: Standing) -> Decision {
    match (exit, standing) {
        (Exit::RequestDeposit, Standing::Listed) => Decision::Proceed,
        (Exit::RequestDeposit, Standing::Delisted) => Decision::Refuse,
    }
}
