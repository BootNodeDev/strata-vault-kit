use soroban_sdk::{contracttype, Env};
use strata_bindings::{OracleFeedClient, OracleState};

use crate::governance;
use crate::keys::DataKey;
use crate::state;

/// What a deployment checks before it trusts the vault, and what monitoring
/// keeps checking after. On a healthy vault `setup_open` is false and every
/// other field is true.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Health {
    /// False once `finish_setup` has run. While true, every admin change is
    /// instant, and the vault takes no request and seals or prices no epoch.
    pub setup_open: bool,
    pub token_bound: bool,
    pub oracle_bound: bool,
    pub sole_token_manager: bool,
    pub allowlisted: bool,
    pub vault_unfrozen: bool,
    pub compliance_bound: bool,
    pub decimals_match: bool,
    /// The asset, the share token, the oracle and the vault are four
    /// different addresses.
    pub addresses_distinct: bool,
    /// A custodian is set, and it is not the vault.
    pub custodian_set: bool,
    /// The oracle answers `state` and `freshness_duration`, report or not.
    pub feed_answers: bool,
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
        setup_open: strata_timelock::setup::is_open(e),
        token_bound: wiring.token_bound,
        oracle_bound: wiring.oracle_bound,
        sole_token_manager: wiring.sole_token_manager,
        allowlisted: wiring.allowlisted,
        vault_unfrozen: wiring.vault_unfrozen,
        compliance_bound: wiring.compliance_bound,
        decimals_match: wiring.decimals_match,
        addresses_distinct: wiring.addresses_distinct,
        custodian_set: wiring.custodian_set,
        feed_answers: wiring.feed_answers,
        feed_valid: matches!(feed.try_state(), Ok(Ok(OracleState::Valid))),
        freshness_covers_notice: matches!(
            feed.try_freshness_duration(),
            Ok(Ok(freshness)) if freshness >= notice
        ),
    }
}
