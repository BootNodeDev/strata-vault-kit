use soroban_sdk::{panic_with_error, Address, Env};
use strata_bindings::VaultViewClient;
use strata_timelock::{queue, ClockSourceClient};

use crate::{bound_vault, FeedChange, FeedError};

/// Refuses an address that does not answer every view the feed reads from a
/// vault, so the feed never binds to one it cannot follow.
pub(crate) fn answers_as_vault(e: &Env, vault: &Address) {
    if !vault_reports_fully(e, vault) {
        panic_with_error!(e, FeedError::NotAVault);
    }
}

fn vault_reports_fully(e: &Env, vault: &Address) -> bool {
    let view = VaultViewClient::new(e, vault);
    matches!(view.try_asset(), Ok(Ok(_)))
        && matches!(view.try_share_token(), Ok(Ok(_)))
        && matches!(view.try_oracle(), Ok(Ok(_)))
        && matches!(view.try_wind_down(), Ok(Ok(_)))
        && matches!(view.try_governance(), Ok(Ok(_)))
        && matches!(
            ClockSourceClient::new(e, vault).try_timelock_clock(),
            Ok(Ok(_))
        )
}

/// The feed stores no admin: every change asks the vault's current governance
/// to sign, read fresh so a hand-over on the vault carries straight over.
pub(crate) fn signed_by_governance(e: &Env) {
    match VaultViewClient::new(e, &bound_vault(e)).try_governance() {
        Ok(Ok(Some(governance))) => governance.require_auth(),
        _ => panic_with_error!(e, FeedError::NoGovernance),
    }
}

/// One upgrade at a time, so a standing eta is never quietly replaced.
pub(crate) fn no_upgrade_pending(e: &Env) {
    let pending = queue::open_ids(e)
        .iter()
        .any(|id| queue::pending::<FeedChange>(e, id).is_some());
    if pending {
        panic_with_error!(e, FeedError::UpgradeAlreadyPending);
    }
}
