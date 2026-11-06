use soroban_sdk::{panic_with_error, Address, Env};
use strata_bindings::VaultViewClient;
use strata_timelock::ClockSourceClient;

use crate::FeedError;

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
