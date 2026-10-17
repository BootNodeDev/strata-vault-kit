use crate::error::ShareTokenError;
use crate::governance::{self, TokenChange, TokenPendingChange};
use crate::roles::COMPLIANCE_ROLE;

use bindings::VaultBound;
use soroban_sdk::{
    contract, contractimpl, panic_with_error, Address, Env, MuxedAddress, String, Symbol, Vec,
};
use stellar_access::access_control::{self as access_control, AccessControl};
use stellar_contract_utils::pausable::{self as pausable, Pausable};
use stellar_contract_utils::upgradeable;
use stellar_macros::{only_admin, only_any_role, only_role};
use stellar_tokens::{
    fungible::{Base, ContractOverrides, FungibleToken},
    rwa::{RWAToken, RWA},
};

#[contract]
pub struct ShareToken;

#[contractimpl]
impl ShareToken {
    pub fn __constructor(
        e: &Env,
        name: String,
        symbol: String,
        admin: Address,
        compliance_authority: Address,
        compliance: Address,
        identity_verifier: Address,
    ) {
        Base::set_metadata(e, 7, name, symbol);
        access_control::set_admin(e, &admin);
        access_control::grant_role_no_auth(
            e,
            &compliance_authority,
            &Symbol::new(e, COMPLIANCE_ROLE),
            &admin,
        );
        RWA::set_compliance(e, &compliance);
        RWA::set_identity_verifier(e, &identity_verifier);
        upgradeable::set_schema_version(e, 1);
        storage::bump_instance(e);
    }

    pub fn schema_version(e: &Env) -> u32 {
        upgradeable::get_schema_version(e)
    }

    /// Names the vault whose clock this token's timelock reads. Once, and only
    /// during setup.
    #[only_admin]
    pub fn bind_vault(e: &Env, vault: Address, caller: Address) {
        caller.require_auth();
        storage::bump_instance(e);
        governance::bind_vault(e, &vault);
    }

    /// Ends the window in which admin changes are instant. It never reopens.
    #[only_admin]
    pub fn finish_setup(e: &Env, caller: Address) {
        caller.require_auth();
        storage::bump_instance(e);
        governance::finish_setup(e);
    }

    /// Queues a change behind the vault's timelock and returns its id.
    #[only_admin]
    pub fn propose_change(e: &Env, change: TokenChange, caller: Address) -> u32 {
        caller.require_auth();
        storage::bump_instance(e);
        governance::propose(e, change)
    }

    #[only_admin]
    pub fn cancel_change(e: &Env, id: u32, caller: Address) {
        caller.require_auth();
        storage::bump_instance(e);
        governance::cancel(e, id);
    }

    /// Lands a change whose delay has run. Refused while the vault is paused
    /// or winding down.
    #[only_admin]
    pub fn apply_change(e: &Env, id: u32, caller: Address) {
        caller.require_auth();
        storage::bump_instance(e);
        governance::apply(e, id);
    }

    pub fn pending_changes(e: &Env) -> Vec<TokenPendingChange> {
        governance::pending(e)
    }
}

#[contractimpl(contracttrait)]
impl VaultBound for ShareToken {
    fn vault(e: &Env) -> Option<Address> {
        timelock::setup::source(e)
    }

    fn setup_open(e: &Env) -> bool {
        timelock::setup::is_open(e)
    }
}

#[contractimpl(contracttrait)]
impl Pausable for ShareToken {
    #[only_admin]
    fn pause(e: &Env, caller: Address) {
        caller.require_auth();
        storage::bump_instance(e);
        pausable::pause(e);
    }
    #[only_admin]
    fn unpause(e: &Env, caller: Address) {
        caller.require_auth();
        storage::bump_instance(e);
        pausable::unpause(e);
    }
}

/// OpenZeppelin leaves the instance's lifetime to the token, so every call
/// that moves shares extends it before handing over to the library.
#[contractimpl(contracttrait)]
impl FungibleToken for ShareToken {
    type ContractType = RWA;

    fn transfer(e: &Env, from: Address, to: MuxedAddress, amount: i128) {
        storage::bump_instance(e);
        <Self::ContractType as ContractOverrides>::transfer(e, &from, &to, amount);
    }

    fn transfer_from(e: &Env, spender: Address, from: Address, to: Address, amount: i128) {
        storage::bump_instance(e);
        <Self::ContractType as ContractOverrides>::transfer_from(e, &spender, &from, &to, amount);
    }

    fn approve(e: &Env, owner: Address, spender: Address, amount: i128, live_until_ledger: u32) {
        storage::bump_instance(e);
        <Self::ContractType as ContractOverrides>::approve(
            e,
            &owner,
            &spender,
            amount,
            live_until_ledger,
        );
    }
}

#[contractimpl(contracttrait)]
impl AccessControl for ShareToken {
    /// Instant during setup; after it, propose the grant through the timelock.
    fn grant_role(e: &Env, account: Address, role: Symbol, caller: Address) {
        governance::require_setup_open(e);
        storage::bump_instance(e);
        access_control::grant_role(e, &account, &role, &caller);
    }

    /// Instant for `compliance`. Revoking `manager` waits like a grant,
    /// because the vault needs it to pay claims.
    fn revoke_role(e: &Env, account: Address, role: Symbol, caller: Address) {
        governance::require_revoke_allowed(e, &role);
        storage::bump_instance(e);
        access_control::revoke_role(e, &account, &role, &caller);
    }

    /// Cancelling a pending hand-over (`live_until_ledger == 0`) keeps the
    /// current admin, so it stays instant.
    fn transfer_admin_role(e: &Env, new_admin: Address, live_until_ledger: u32) {
        if live_until_ledger != 0 {
            governance::require_setup_open(e);
        }
        storage::bump_instance(e);
        access_control::transfer_admin_role(e, &new_admin, live_until_ledger);
    }

    /// Refused. A role admin could grant that role with no delay.
    fn set_role_admin(e: &Env, _role: Symbol, _admin_role: Symbol) {
        panic_with_error!(e, ShareTokenError::UseTimelock);
    }

    /// Refused. A token without an admin could never be unpaused, never rotate
    /// the manager role and never replace the vault that holds it.
    /// `transfer_admin_role` and `accept_admin_transfer` are the way out.
    fn renounce_admin(e: &Env) {
        panic_with_error!(e, ShareTokenError::AdminRequired);
    }
}

#[contractimpl(contracttrait)]
impl RWAToken for ShareToken {
    #[only_role(operator, "manager")]
    fn mint(e: &Env, to: Address, amount: i128, operator: Address) {
        storage::bump_instance(e);
        RWA::mint(e, &to, amount);
    }
    #[only_role(operator, "manager")]
    fn burn(e: &Env, user_address: Address, amount: i128, operator: Address) {
        storage::bump_instance(e);
        RWA::burn(e, &user_address, amount);
    }
    /// The vault escrows redemptions through it; compliance intervenes with it.
    #[only_any_role(operator, ["manager", "compliance"])]
    fn forced_transfer(e: &Env, from: Address, to: Address, amount: i128, operator: Address) {
        storage::bump_instance(e);
        RWA::forced_transfer(e, &from, &to, amount);
    }
    #[only_role(operator, "compliance")]
    fn recover_balance(
        e: &Env,
        old_account: Address,
        new_account: Address,
        operator: Address,
    ) -> bool {
        storage::bump_instance(e);
        RWA::recover_balance(e, &old_account, &new_account)
    }
    #[only_role(operator, "compliance")]
    fn set_address_frozen(e: &Env, user_address: Address, freeze: bool, operator: Address) {
        storage::bump_instance(e);
        RWA::set_address_frozen(e, &user_address, freeze);
    }
    #[only_role(operator, "compliance")]
    fn freeze_partial_tokens(e: &Env, user_address: Address, amount: i128, operator: Address) {
        storage::bump_instance(e);
        RWA::freeze_partial_tokens(e, &user_address, amount);
    }
    #[only_role(operator, "compliance")]
    fn unfreeze_partial_tokens(e: &Env, user_address: Address, amount: i128, operator: Address) {
        storage::bump_instance(e);
        RWA::unfreeze_partial_tokens(e, &user_address, amount);
    }
    #[only_admin]
    fn set_compliance(e: &Env, compliance: Address, operator: Address) {
        operator.require_auth();
        governance::require_setup_open(e);
        storage::bump_instance(e);
        RWA::set_compliance(e, &compliance);
    }
    #[only_admin]
    fn set_identity_verifier(e: &Env, identity_verifier: Address, operator: Address) {
        operator.require_auth();
        governance::require_setup_open(e);
        storage::bump_instance(e);
        RWA::set_identity_verifier(e, &identity_verifier);
    }
}

/// Stands in for a later token version in the upgrade tests. Never deployed.
#[cfg(feature = "upgrade_probe")]
#[soroban_sdk::contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ProbeError {
    AlreadyMigrated = 7100,
}

#[cfg(feature = "upgrade_probe")]
#[contractimpl]
impl ShareToken {
    #[only_admin]
    pub fn migrate(e: &Env, caller: Address) {
        caller.require_auth();
        storage::bump_instance(e);
        if upgradeable::get_schema_version(e) >= 2 {
            panic_with_error!(e, ProbeError::AlreadyMigrated);
        }
        upgradeable::set_schema_version(e, 2);
    }

    pub fn probe(_e: &Env) -> bool {
        true
    }
}
