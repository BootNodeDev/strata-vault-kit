//! OpenZeppelin extends a role entry when it reads it, not when it creates it.

use soroban_sdk::{Address, Env, Symbol};
use stellar_access::access_control;

/// The role, its member-list slot, the member count and the role list: all a grant writes.
pub(crate) fn role_entries(e: &Env, account: &Address, role: &Symbol) {
    if let Some(index) = access_control::has_role(e, account, role) {
        access_control::get_role_member(e, role, index);
    }
    access_control::get_role_member_count(e, role);
    access_control::get_existing_roles(e);
}
