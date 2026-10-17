use bindings::{OracleFeedClient, OracleState};
use soroban_sdk::{contracttype, Env};

use crate::governance;
use crate::keys::DataKey;
use crate::state;

/// What a deployment checks before it trusts the vault, and what monitoring
/// keeps checking after. Every field is true on a healthy vault.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Health {
    /// False once `finish_setup` has run. While true, every admin change is
    /// instant and deposits are refused.
    pub setup_open: bool,
    pub token_bound: bool,
    pub oracle_bound: bool,
    pub sole_token_manager: bool,
    pub allowlisted: bool,
    pub vault_unfrozen: bool,
    pub compliance_bound: bool,
    pub feed_valid: bool,
    /// A report outlives the notice, so an epoch's cancellation window does
    /// not reopen on its own while the notice runs.
    pub freshness_covers_notice: bool,
}

pub(crate) fn health(e: &Env) -> Health {
    let wiring = governance::wiring(e);
    let feed = OracleFeedClient::new(e, &state::get_addr(e, &DataKey::Oracle));
    let notice = state::notice(e);
    Health {
        setup_open: timelock::setup::is_open(e),
        token_bound: wiring.token_bound,
        oracle_bound: wiring.oracle_bound,
        sole_token_manager: wiring.sole_token_manager,
        allowlisted: wiring.allowlisted,
        vault_unfrozen: wiring.vault_unfrozen,
        compliance_bound: wiring.compliance_bound,
        feed_valid: matches!(feed.try_state(), Ok(Ok(OracleState::Valid))),
        freshness_covers_notice: matches!(
            feed.try_freshness_duration(),
            Ok(Ok(freshness)) if freshness >= notice
        ),
    }
}
