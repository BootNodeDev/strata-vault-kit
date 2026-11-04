//! OpenZeppelin extends an entry when it reads it, not when it creates it.

use soroban_sdk::Env;
use stellar_tokens::rwa::{compliance, compliance::ComplianceHook, utils::token_binder};

/// Reads the token count and every bucket, the one a binding wrote included.
pub(crate) fn bound_tokens(e: &Env) {
    token_binder::linked_tokens(e);
}

pub(crate) fn modules(e: &Env, hook: &ComplianceHook) {
    compliance::storage::get_modules_for_hook(e, hook.clone());
}
