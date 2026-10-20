use crate::error::ShareTokenError;
use crate::event::LegalTransfer;
use crate::extend;
use crate::governance::{self, TokenChange, TokenPendingChange};
use crate::guards;
use crate::roles::COMPLIANCE_ROLE;

use soroban_sdk::{
    contract, contractimpl, panic_with_error, Address, Env, MuxedAddress, String, Symbol, Vec,
};
use stellar_access::access_control::{self as access_control, AccessControl};
use stellar_contract_utils::pausable::{self as pausable, Pausable};
use stellar_contract_utils::upgradeable;
use stellar_macros::{only_admin, only_role};
use stellar_tokens::{
    fungible::{Base, ContractOverrides, FungibleToken},
    rwa::{RWAToken, RWA},
};
use strata_bindings::VaultBinding;

/// Longest order reference a legal transfer accepts, in bytes.
pub const MAX_REFERENCE_LEN: u32 = 128;

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
        let compliance_role = Symbol::new(e, COMPLIANCE_ROLE);
        access_control::grant_role_no_auth(e, &compliance_authority, &compliance_role, &admin);
        extend::role_entries(e, &compliance_authority, &compliance_role);
        RWA::set_compliance(e, &compliance);
        RWA::set_identity_verifier(e, &identity_verifier);
        upgradeable::set_schema_version(e, 1);
        strata_storage::bump_instance(e);
    }

    pub fn schema_version(e: &Env) -> u32 {
        upgradeable::get_schema_version(e)
    }

    /// Names the vault whose clock this token's timelock reads. Once, and only
    /// during setup.
    #[only_admin]
    pub fn bind_vault(e: &Env, vault: Address) {
        strata_storage::bump_instance(e);
        governance::bind_vault(e, &vault);
    }

    /// Ends the window in which admin changes are instant. It never reopens.
    #[only_admin]
    pub fn finish_setup(e: &Env) {
        strata_storage::bump_instance(e);
        governance::finish_setup(e);
    }

    /// Queues a change behind the vault's timelock and returns its id.
    #[only_admin]
    pub fn propose_change(e: &Env, change: TokenChange) -> u32 {
        strata_storage::bump_instance(e);
        governance::propose(e, change)
    }

    #[only_admin]
    pub fn cancel_change(e: &Env, id: u32) {
        strata_storage::bump_instance(e);
        governance::cancel(e, id);
    }

    /// Lands a change whose delay has run. Refused while the vault is paused
    /// or winding down.
    #[only_admin]
    pub fn apply_change(e: &Env, id: u32) {
        strata_storage::bump_instance(e);
        governance::apply(e, id);
    }

    pub fn pending_changes(e: &Env) -> Vec<TokenPendingChange> {
        governance::pending(e)
    }

    /// Moves shares under a legal order, at once. The compliance authority
    /// asks and the admin co-signs the same call. Never out of or into the
    /// vault's address, and only to an account the identity verifier accepts.
    #[only_role(caller, "compliance")]
    pub fn legal_transfer(
        e: &Env,
        from: Address,
        to: Address,
        amount: i128,
        reference: String,
        caller: Address,
    ) {
        guards::admin_co_signs(e, &caller);
        guards::valid_reference(e, &reference);
        guards::not_vault_address(e, &from);
        guards::not_vault_address(e, &to);
        guards::identity_verified(e, &to);
        strata_storage::bump_instance(e);
        RWA::forced_transfer(e, &from, &to, amount);
        extend::balances(e, &[&from, &to]);
        LegalTransfer {
            from,
            to,
            amount,
            reference,
        }
        .publish(e);
    }
}

#[contractimpl(contracttrait)]
impl VaultBinding for ShareToken {
    fn vault(e: &Env) -> Option<Address> {
        strata_timelock::setup::source(e)
    }

    fn setup_open(e: &Env) -> bool {
        strata_timelock::setup::is_open(e)
    }
}

#[contractimpl(contracttrait)]
impl Pausable for ShareToken {
    fn pause(e: &Env, caller: Address) {
        guards::caller_is_admin(e, &caller);
        caller.require_auth();
        strata_storage::bump_instance(e);
        pausable::pause(e);
    }
    fn unpause(e: &Env, caller: Address) {
        guards::caller_is_admin(e, &caller);
        caller.require_auth();
        strata_storage::bump_instance(e);
        pausable::unpause(e);
    }
}

/// OpenZeppelin leaves the instance's lifetime to the token, so every call
/// that moves shares extends it before handing over to the library. So do
/// `balance` and `total_supply`, which may be the only calls during a wind-down.
#[contractimpl(contracttrait)]
impl FungibleToken for ShareToken {
    type ContractType = RWA;

    fn transfer(e: &Env, from: Address, to: MuxedAddress, amount: i128) {
        strata_storage::bump_instance(e);
        <Self::ContractType as ContractOverrides>::transfer(e, &from, &to, amount);
        extend::balances(e, &[&from, &to.address()]);
    }

    fn transfer_from(e: &Env, spender: Address, from: Address, to: Address, amount: i128) {
        strata_storage::bump_instance(e);
        <Self::ContractType as ContractOverrides>::transfer_from(e, &spender, &from, &to, amount);
        extend::balances(e, &[&from, &to]);
    }

    fn approve(e: &Env, owner: Address, spender: Address, amount: i128, live_until_ledger: u32) {
        strata_storage::bump_instance(e);
        <Self::ContractType as ContractOverrides>::approve(
            e,
            &owner,
            &spender,
            amount,
            live_until_ledger,
        );
    }

    /// All shares in circulation, in share base units. Reading it extends
    /// the token's instance.
    ///
    /// # Authorization
    ///
    /// None: anyone may call.
    fn total_supply(e: &Env) -> i128 {
        strata_storage::bump_instance(e);
        <Self::ContractType as ContractOverrides>::total_supply(e)
    }

    /// The shares `account` holds, in share base units. Reading it extends
    /// the token's instance.
    ///
    /// # Arguments
    ///
    /// * `account` - The holder.
    ///
    /// # Authorization
    ///
    /// None: anyone may call.
    fn balance(e: &Env, account: Address) -> i128 {
        strata_storage::bump_instance(e);
        <Self::ContractType as ContractOverrides>::balance(e, &account)
    }
}

#[contractimpl(contracttrait)]
impl AccessControl for ShareToken {
    /// Instant during setup; after it, propose the grant through the timelock.
    fn grant_role(e: &Env, account: Address, role: Symbol, caller: Address) {
        guards::direct_change_allowed(e);
        strata_storage::bump_instance(e);
        access_control::grant_role(e, &account, &role, &caller);
        extend::role_entries(e, &account, &role);
    }

    /// Instant for `compliance`. Revoking `manager` waits like a grant,
    /// because the vault needs it to pay claims.
    fn revoke_role(e: &Env, account: Address, role: Symbol, caller: Address) {
        guards::direct_revoke_allowed(e, &role);
        strata_storage::bump_instance(e);
        access_control::revoke_role(e, &account, &role, &caller);
    }

    /// Cancelling a pending hand-over (`live_until_ledger == 0`) keeps the
    /// current admin, so it stays instant.
    fn transfer_admin_role(e: &Env, new_admin: Address, live_until_ledger: u32) {
        guards::direct_hand_over_allowed(e, live_until_ledger);
        strata_storage::bump_instance(e);
        access_control::transfer_admin_role(e, &new_admin, live_until_ledger);
    }

    /// Refused. A role admin could grant that role with no delay.
    fn set_role_admin(e: &Env, _role: Symbol, _admin_role: Symbol) {
        panic_with_error!(e, ShareTokenError::UseTimelock);
    }

    /// Refused. A token without an admin could never be unpaused, never rotate
    /// the manager role and never replace the vault that holds it. The way out
    /// is a hand-over: propose and apply an `Admin` change (`transfer_admin_role`
    /// during setup), then the nominee calls `accept_admin_transfer`.
    fn renounce_admin(e: &Env) {
        panic_with_error!(e, ShareTokenError::AdminRequired);
    }
}

#[contractimpl(contracttrait)]
impl RWAToken for ShareToken {
    #[only_role(operator, "manager")]
    fn mint(e: &Env, to: Address, amount: i128, operator: Address) {
        strata_storage::bump_instance(e);
        RWA::mint(e, &to, amount);
        extend::balances(e, &[&to]);
    }
    #[only_role(operator, "manager")]
    fn burn(e: &Env, user_address: Address, amount: i128, operator: Address) {
        strata_storage::bump_instance(e);
        RWA::burn(e, &user_address, amount);
        extend::balances(e, &[&user_address]);
    }
    /// The vault escrows redemptions through it. Compliance moves shares with
    /// `legal_transfer` instead.
    #[only_role(operator, "manager")]
    fn forced_transfer(e: &Env, from: Address, to: Address, amount: i128, operator: Address) {
        strata_storage::bump_instance(e);
        RWA::forced_transfer(e, &from, &to, amount);
        extend::balances(e, &[&from, &to]);
    }
    /// Moves a whole balance to the account the identity verifier names, so
    /// it needs the admin's co-signature like a legal transfer, and never
    /// moves shares out of or into the vault's address.
    #[only_role(operator, "compliance")]
    fn recover_balance(
        e: &Env,
        old_account: Address,
        new_account: Address,
        operator: Address,
    ) -> bool {
        guards::admin_co_signs(e, &operator);
        guards::not_vault_address(e, &old_account);
        guards::not_vault_address(e, &new_account);
        strata_storage::bump_instance(e);
        let recovered = RWA::recover_balance(e, &old_account, &new_account);
        extend::balances(e, &[&new_account]);
        extend::address_frozen(e, &new_account);
        extend::frozen_tokens(e, &new_account);
        recovered
    }
    #[only_role(operator, "compliance")]
    fn set_address_frozen(e: &Env, user_address: Address, freeze: bool, operator: Address) {
        guards::not_freezing_vault(e, &user_address, freeze);
        strata_storage::bump_instance(e);
        RWA::set_address_frozen(e, &user_address, freeze);
        extend::address_frozen(e, &user_address);
    }
    #[only_role(operator, "compliance")]
    fn freeze_partial_tokens(e: &Env, user_address: Address, amount: i128, operator: Address) {
        guards::not_vault_address(e, &user_address);
        strata_storage::bump_instance(e);
        RWA::freeze_partial_tokens(e, &user_address, amount);
        extend::frozen_tokens(e, &user_address);
    }
    #[only_role(operator, "compliance")]
    fn unfreeze_partial_tokens(e: &Env, user_address: Address, amount: i128, operator: Address) {
        strata_storage::bump_instance(e);
        RWA::unfreeze_partial_tokens(e, &user_address, amount);
        extend::frozen_tokens(e, &user_address);
    }
    fn set_compliance(e: &Env, compliance: Address, operator: Address) {
        guards::caller_is_admin(e, &operator);
        operator.require_auth();
        guards::direct_change_allowed(e);
        strata_storage::bump_instance(e);
        RWA::set_compliance(e, &compliance);
    }
    fn set_identity_verifier(e: &Env, identity_verifier: Address, operator: Address) {
        guards::caller_is_admin(e, &operator);
        operator.require_auth();
        guards::direct_change_allowed(e);
        strata_storage::bump_instance(e);
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
    pub fn migrate(e: &Env) {
        strata_storage::bump_instance(e);
        if upgradeable::get_schema_version(e) >= 2 {
            panic_with_error!(e, ProbeError::AlreadyMigrated);
        }
        upgradeable::set_schema_version(e, 2);
    }

    pub fn probe(_e: &Env) -> bool {
        true
    }
}
