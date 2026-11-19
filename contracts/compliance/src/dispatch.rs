//! The exit rule: once a vault is bound, no module may stop a move into it or
//! a burn. Those moves still reach every module, so counters stay right; a
//! refusal or a failure is ignored, and rolls back only that module's changes.

use soroban_sdk::{Address, Env};
use stellar_tokens::rwa::compliance::{
    modules::ComplianceModuleClient,
    storage::{self, get_modules_for_hook, require_auth_from_bound_token},
    AccountSnapshot, ComplianceHook, TransferKind,
};

fn is_bound_vault(e: &Env, account: &Address) -> bool {
    strata_timelock::setup::source(e).is_some_and(|vault| vault == *account)
}

pub(crate) fn transferred(
    e: &Env,
    from: AccountSnapshot,
    to: AccountSnapshot,
    amount: i128,
    kind: TransferKind,
    token: Address,
) {
    if !is_bound_vault(e, &to.address) {
        return storage::transferred(e, from, to, amount, kind, token);
    }
    require_auth_from_bound_token(e, &token);
    for module in get_modules_for_hook(e, ComplianceHook::Transferred).iter() {
        let _ = ComplianceModuleClient::new(e, &module)
            .try_on_transfer(&from, &to, &amount, &kind, &token);
    }
}

pub(crate) fn created(e: &Env, to: AccountSnapshot, amount: i128, token: Address) {
    if !is_bound_vault(e, &to.address) {
        return storage::created(e, to, amount, token);
    }
    require_auth_from_bound_token(e, &token);
    for module in get_modules_for_hook(e, ComplianceHook::Created).iter() {
        let _ = ComplianceModuleClient::new(e, &module).try_on_created(&to, &amount, &token);
    }
}

pub(crate) fn destroyed(e: &Env, from: AccountSnapshot, amount: i128, token: Address) {
    if strata_timelock::setup::source(e).is_none() {
        return storage::destroyed(e, from, amount, token);
    }
    require_auth_from_bound_token(e, &token);
    for module in get_modules_for_hook(e, ComplianceHook::Destroyed).iter() {
        let _ = ComplianceModuleClient::new(e, &module).try_on_destroyed(&from, &amount, &token);
    }
}
