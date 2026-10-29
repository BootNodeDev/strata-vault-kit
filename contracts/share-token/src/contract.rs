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
    /// Creates the token with 7 decimals, its admin, its compliance authority
    /// and the two contracts that check each `transfer` and mint.
    ///
    /// # Arguments
    ///
    /// * `name`, `symbol` - The token's metadata.
    /// * `admin` - Pauses and changes the token.
    /// * `compliance_authority` - Gets the `compliance` role: freezes, and
    ///   with the admin, legal transfers and recoveries.
    /// * `compliance` - The compliance contract.
    /// * `identity_verifier` - The identity verifier.
    ///
    /// # Events
    ///
    /// * `RoleGranted`, `ComplianceSet` and `IdentityVerifierSet`.
    ///
    /// # Authorization
    ///
    /// None: it runs once, at deployment.
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

    /// The storage layout version, `1` until an upgrade migrates it.
    pub fn schema_version(e: &Env) -> u32 {
        upgradeable::get_schema_version(e)
    }

    /// Names the vault whose timelock this token's changes wait for. Once, and
    /// only during setup.
    ///
    /// # Arguments
    ///
    /// * `vault` - The vault. A contract that does not answer
    ///   `timelock_clock` fails the call.
    ///
    /// # Errors
    ///
    /// * `SetupClosed` - Setup has finished, or a vault is already bound.
    ///
    /// # Events
    ///
    /// * `VaultBound`
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn bind_vault(e: &Env, vault: Address) {
        strata_storage::bump_instance(e);
        governance::bind_vault(e, &vault);
    }

    /// Ends the window in which admin changes are instant. It never reopens.
    ///
    /// # Errors
    ///
    /// * `SetupClosed` - Setup has already finished.
    /// * `AdminTransferPending` - An admin hand-over offered during setup is
    ///   still open.
    /// * `VaultNotBound` - No vault is bound.
    ///
    /// # Events
    ///
    /// * `SetupFinished`
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn finish_setup(e: &Env) {
        strata_storage::bump_instance(e);
        governance::finish_setup(e);
    }

    /// Queues a change behind the vault's timelock and returns its id.
    ///
    /// # Arguments
    ///
    /// * `change` - An upgrade, a role grant or revoke, an admin hand-over,
    ///   or a new compliance contract or identity verifier.
    ///
    /// # Errors
    ///
    /// * `ComplianceNotBound` - The new compliance contract does not list
    ///   this token, or answers `VaultBinding` but does not name this token's
    ///   vault with its setup closed.
    /// * `VerifierRefusesVault` - The new verifier does not accept the vault.
    /// * `UpgradeAlreadyPending` - An upgrade already waits.
    /// * `SetupOpen` - Setup has not finished; change it directly.
    /// * `WindDownActive` - The vault is winding down, and the change is not
    ///   a grant of `compliance`.
    /// * `TooManyPendingChanges` - The queue is full.
    ///
    /// # Events
    ///
    /// * `ChangeProposed`, with its `eta` in seconds.
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn propose_change(e: &Env, change: TokenChange) -> u32 {
        strata_storage::bump_instance(e);
        governance::propose(e, change)
    }

    /// Drops a pending change.
    ///
    /// # Arguments
    ///
    /// * `id` - The id `propose_change` returned.
    ///
    /// # Errors
    ///
    /// * `ChangeNotFound` - No pending change has this id.
    ///
    /// # Events
    ///
    /// * `ChangeCancelled`
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn cancel_change(e: &Env, id: u32) {
        strata_storage::bump_instance(e);
        governance::cancel(e, id);
    }

    /// Lands a change whose delay has run.
    ///
    /// # Arguments
    ///
    /// * `id` - The id `propose_change` returned.
    ///
    /// # Errors
    ///
    /// * `ChangeNotFound` - No pending change has this id.
    /// * `WindDownActive` - The vault is winding down, and the change is not
    ///   a grant of `compliance`.
    /// * `VaultPaused` - The vault is paused.
    /// * `DelayBelowNotice` - The change's delay is shorter than the vault's
    ///   notice now.
    /// * `ChangeNotReady` - The delay, plus any time the vault spent paused
    ///   since, has not run.
    /// * `ComplianceNotBound`, `VerifierRefusesVault` - The new contract no
    ///   longer passes the check `propose_change` made.
    /// * `AccessControlError::RoleNotHeld` - A `RevokeRole` names an account
    ///   without the role.
    /// * An `Upgrade` whose Wasm is not on the network fails the call.
    ///
    /// # Events
    ///
    /// * `ChangeApplied`, after the change's own: `RoleGranted`,
    ///   `RoleRevoked`, `AdminTransferInitiated`, `ComplianceSet` or
    ///   `IdentityVerifierSet`.
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn apply_change(e: &Env, id: u32) {
        strata_storage::bump_instance(e);
        governance::apply(e, id);
    }

    /// Every change still waiting, with the time in seconds it may land on
    /// the vault's clock as it reads now.
    pub fn pending_changes(e: &Env) -> Vec<TokenPendingChange> {
        governance::pending(e)
    }

    /// Moves shares under a legal order, at once. The pause, freezes and the
    /// compliance rules' check do not apply.
    ///
    /// # Arguments
    ///
    /// * `from` - The account debited.
    /// * `to` - The account credited.
    /// * `amount` - Share base units.
    /// * `reference` - The order's reference, 1 to 128 bytes.
    /// * `caller` - A `compliance` holder.
    ///
    /// # Errors
    ///
    /// * `AccessControlError::Unauthorized` - `caller` lacks `compliance`.
    /// * `CoSignRequired` - `caller` is the admin.
    /// * `InvalidReference` - `reference` is empty or too long.
    /// * `VaultAddress` - `from` or `to` is the vault.
    /// * `RWAError::IdentityVerificationFailed` - `to` is not allowlisted.
    /// * `RWAError::InsufficientBalance` - `amount` exceeds the balance.
    /// * `FungibleTokenError::LessThanZero` - `amount` is negative.
    /// * `ComplianceError::TokenNotBound` - Compliance does not list the token.
    ///
    /// # Events
    ///
    /// * `Transfer`, then `LegalTransfer`; `TokensUnfrozen` first when frozen
    ///   shares move.
    ///
    /// # Authorization
    ///
    /// `caller` and the admin sign, as two different accounts.
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
    /// The vault whose timelock this token's changes wait for, once
    /// `bind_vault` has named it.
    fn vault(e: &Env) -> Option<Address> {
        strata_timelock::setup::source(e)
    }

    /// Whether setup is still open, so admin changes are instant.
    fn setup_open(e: &Env) -> bool {
        strata_timelock::setup::is_open(e)
    }
}

#[contractimpl(contracttrait)]
impl Pausable for ShareToken {
    /// Stops `transfer` and `transfer_from`. Mints, burns, the vault's escrow
    /// moves and legal transfers go on.
    ///
    /// # Arguments
    ///
    /// * `caller` - The admin.
    ///
    /// # Errors
    ///
    /// * `AdminRequired` - `caller` is not the admin.
    /// * `PausableError::EnforcedPause` - The token is already paused.
    ///
    /// # Events
    ///
    /// * `Paused`
    ///
    /// # Authorization
    ///
    /// `caller` signs.
    fn pause(e: &Env, caller: Address) {
        guards::caller_is_admin(e, &caller);
        caller.require_auth();
        strata_storage::bump_instance(e);
        pausable::pause(e);
    }

    /// Lets `transfer` and `transfer_from` run again.
    ///
    /// # Arguments
    ///
    /// * `caller` - The admin.
    ///
    /// # Errors
    ///
    /// * `AdminRequired` - `caller` is not the admin.
    /// * `PausableError::ExpectedPause` - The token is not paused.
    ///
    /// # Events
    ///
    /// * `Unpaused`
    ///
    /// # Authorization
    ///
    /// `caller` signs.
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

    /// Moves shares between two accounts. Refused while the token is paused,
    /// when either end is frozen or fails the identity check, and when the
    /// compliance rules refuse the move.
    ///
    /// # Arguments
    ///
    /// * `from` - The sender.
    /// * `to` - The receiver. A muxed address is accepted; the event leaves
    ///   out its id.
    /// * `amount` - Share base units.
    ///
    /// # Errors
    ///
    /// * `VaultAddress` - `to` is the vault.
    /// * `PausableError::EnforcedPause` - The token is paused.
    /// * `RWAError::AddressFrozen` - `from` or `to` is frozen.
    /// * `RWAError::InsufficientFreeTokens` - `amount` exceeds `from`'s
    ///   unfrozen shares.
    /// * `RWAError::IdentityVerificationFailed` - `from` or `to` is not
    ///   allowlisted.
    /// * `RWAError::TransferNotCompliant` - The compliance rules refuse it.
    /// * `FungibleTokenError::LessThanZero` - `amount` is negative.
    /// * `ComplianceError::TokenNotBound` - Compliance does not list the token.
    ///
    /// # Events
    ///
    /// * `Transfer`
    ///
    /// # Authorization
    ///
    /// `from` signs.
    fn transfer(e: &Env, from: Address, to: MuxedAddress, amount: i128) {
        guards::not_vault_address(e, &to.address());
        strata_storage::bump_instance(e);
        <Self::ContractType as ContractOverrides>::transfer(e, &from, &to, amount);
        extend::balances(e, &[&from, &to.address()]);
    }

    /// Moves shares against `spender`'s allowance, with the checks of
    /// `transfer`.
    ///
    /// # Arguments
    ///
    /// * `spender` - Spends its allowance.
    /// * `from` - The sender.
    /// * `to` - The receiver.
    /// * `amount` - Share base units.
    ///
    /// # Errors
    ///
    /// * `VaultAddress` - `to` is the vault.
    /// * The errors of `transfer`.
    /// * `FungibleTokenError::InsufficientAllowance` - `amount` exceeds the
    ///   allowance.
    ///
    /// # Events
    ///
    /// * `Transfer`
    ///
    /// # Authorization
    ///
    /// `spender` signs.
    fn transfer_from(e: &Env, spender: Address, from: Address, to: Address, amount: i128) {
        guards::not_vault_address(e, &to);
        strata_storage::bump_instance(e);
        <Self::ContractType as ContractOverrides>::transfer_from(e, &spender, &from, &to, amount);
        extend::balances(e, &[&from, &to]);
    }

    /// Sets how many of `owner`'s shares `spender` may move, replacing any
    /// earlier allowance.
    ///
    /// # Arguments
    ///
    /// * `owner` - The holder.
    /// * `spender` - The account allowed to spend.
    /// * `amount` - Share base units.
    /// * `live_until_ledger` - The last ledger number the allowance lasts.
    ///
    /// # Errors
    ///
    /// * `FungibleTokenError::LessThanZero` - `amount` is negative.
    /// * `FungibleTokenError::InvalidLiveUntilLedger` - The ledger is beyond
    ///   the longest entry lifetime, or has passed while `amount` is positive.
    ///
    /// # Events
    ///
    /// * `Approve`
    ///
    /// # Authorization
    ///
    /// `owner` signs.
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
    fn balance(e: &Env, account: Address) -> i128 {
        strata_storage::bump_instance(e);
        <Self::ContractType as ContractOverrides>::balance(e, &account)
    }
}

#[contractimpl(contracttrait)]
impl AccessControl for ShareToken {
    /// Grants `role` to `account` at once. Only during setup; after it, propose
    /// a `GrantRole` change.
    ///
    /// # Arguments
    ///
    /// * `account` - The account that gets the role.
    /// * `role` - `manager` (the vault) or `compliance`.
    /// * `caller` - The admin.
    ///
    /// # Errors
    ///
    /// * `UseTimelock` - Setup has finished.
    /// * `AccessControlError::Unauthorized` - `caller` is not the admin.
    ///
    /// # Events
    ///
    /// * `RoleGranted`, unless `account` already holds `role`.
    ///
    /// # Authorization
    ///
    /// `caller` signs.
    fn grant_role(e: &Env, account: Address, role: Symbol, caller: Address) {
        guards::direct_change_allowed(e);
        strata_storage::bump_instance(e);
        access_control::grant_role(e, &account, &role, &caller);
        extend::role_entries(e, &account, &role);
    }

    /// Takes `role` from `account`. Instant for `compliance`. Revoking
    /// `manager` waits like a grant after setup, because the vault needs it
    /// to pay claims: propose a `RevokeRole` change. Revoking the last
    /// `compliance` holder stays instant; a successor's grant waits one
    /// delay, during a wind-down too.
    ///
    /// # Arguments
    ///
    /// * `account` - The account that loses the role.
    /// * `role` - `manager` or `compliance`.
    /// * `caller` - The admin.
    ///
    /// # Errors
    ///
    /// * `UseTimelock` - `manager`, after setup.
    /// * `AccessControlError::Unauthorized` - `caller` is not the admin.
    /// * `AccessControlError::RoleNotHeld` - `account` does not hold `role`.
    ///
    /// # Events
    ///
    /// * `RoleRevoked`
    ///
    /// # Authorization
    ///
    /// `caller` signs.
    fn revoke_role(e: &Env, account: Address, role: Symbol, caller: Address) {
        guards::direct_revoke_allowed(e, &role);
        strata_storage::bump_instance(e);
        access_control::revoke_role(e, &account, &role, &caller);
    }

    /// Gives up `role`. The last `compliance` holder cannot: without one, no
    /// freeze can be lifted until a grant waits out the timelock.
    ///
    /// # Arguments
    ///
    /// * `role` - The role to give up.
    /// * `caller` - The holder.
    ///
    /// # Errors
    ///
    /// * `LastComplianceHolder` - `role` is `compliance` and has at most one
    ///   holder.
    /// * `AccessControlError::RoleNotHeld` - `caller` does not hold `role`.
    ///
    /// # Events
    ///
    /// * `RoleRevoked`
    ///
    /// # Authorization
    ///
    /// `caller` signs.
    fn renounce_role(e: &Env, role: Symbol, caller: Address) {
        guards::not_last_compliance_holder(e, &role);
        strata_storage::bump_instance(e);
        access_control::renounce_role(e, &role, &caller);
    }

    /// Offers the admin role to `new_admin`, who takes it with
    /// `accept_admin_transfer`. An offer is instant only during setup; after
    /// it, propose an `Admin` change. Cancelling an offer stays instant.
    ///
    /// # Arguments
    ///
    /// * `new_admin` - The nominee, or the pending nominee when cancelling.
    /// * `live_until_ledger` - The last ledger number the nominee can accept
    ///   in; `0` cancels the pending offer.
    ///
    /// # Errors
    ///
    /// * `UseTimelock` - An offer after setup.
    /// * `RoleTransferError::InvalidLiveUntilLedger` - The ledger has passed or
    ///   is beyond the longest entry lifetime.
    /// * `RoleTransferError::NoPendingTransfer` - Nothing to cancel.
    /// * `RoleTransferError::InvalidPendingAccount` - The cancel names another
    ///   nominee.
    ///
    /// # Events
    ///
    /// * `AdminTransferInitiated`
    ///
    /// # Authorization
    ///
    /// The admin signs.
    fn transfer_admin_role(e: &Env, new_admin: Address, live_until_ledger: u32) {
        guards::direct_hand_over_allowed(e, live_until_ledger);
        strata_storage::bump_instance(e);
        access_control::transfer_admin_role(e, &new_admin, live_until_ledger);
    }

    /// Makes the nominee of a pending hand-over the admin. Refused while the
    /// vault winds down: no admin power changes hands then.
    ///
    /// # Errors
    ///
    /// * `WindDownActive` - The vault is winding down.
    /// * `RoleTransferError::NoPendingTransfer` - No offer is pending.
    /// * `RoleTransferError::TransferExpired` - The offer's last ledger has
    ///   passed.
    ///
    /// # Events
    ///
    /// * `AdminTransferCompleted`
    ///
    /// # Authorization
    ///
    /// The nominee signs.
    fn accept_admin_transfer(e: &Env) {
        guards::vault_not_winding_down(e);
        strata_storage::bump_instance(e);
        access_control::accept_admin_transfer(e);
    }

    /// Refused. A role admin could grant that role with no delay.
    ///
    /// # Arguments
    ///
    /// * `role`, `admin_role` - Not read.
    ///
    /// # Errors
    ///
    /// * `UseTimelock` - Always.
    fn set_role_admin(e: &Env, _role: Symbol, _admin_role: Symbol) {
        panic_with_error!(e, ShareTokenError::UseTimelock);
    }

    /// Refused. A token without an admin could never be unpaused, never rotate
    /// the manager role and never replace the vault that holds it. The way out
    /// is a hand-over: propose and apply an `Admin` change (`transfer_admin_role`
    /// during setup), then the nominee calls `accept_admin_transfer`.
    ///
    /// # Errors
    ///
    /// * `AdminRequired` - Always.
    fn renounce_admin(e: &Env) {
        panic_with_error!(e, ShareTokenError::AdminRequired);
    }
}

#[contractimpl(contracttrait)]
impl RWAToken for ShareToken {
    /// Mints shares: the vault paying a priced deposit. The pause does not
    /// apply.
    ///
    /// # Arguments
    ///
    /// * `to` - The account credited.
    /// * `amount` - Share base units.
    /// * `operator` - A `manager`: the vault.
    ///
    /// # Errors
    ///
    /// * `AccessControlError::Unauthorized` - `operator` is not a `manager`.
    /// * `RWAError::IdentityVerificationFailed` - `to` is not allowlisted.
    /// * `RWAError::MintNotCompliant` - The compliance rules refuse it.
    /// * `FungibleTokenError::LessThanZero` - `amount` is negative.
    /// * `FungibleTokenError::MathOverflow` - The supply would overflow.
    /// * `ComplianceError::TokenNotBound` - Compliance does not list the token.
    ///
    /// # Events
    ///
    /// * `Mint`
    ///
    /// # Authorization
    ///
    /// `operator` signs.
    #[only_role(operator, "manager")]
    fn mint(e: &Env, to: Address, amount: i128, operator: Address) {
        strata_storage::bump_instance(e);
        RWA::mint(e, &to, amount);
        extend::balances(e, &[&to]);
    }

    /// Burns shares, frozen ones included, without their holder's
    /// signature: the vault burns the escrow it holds, and a holder's shares
    /// surrendered in a wind-down. The pause does not apply.
    ///
    /// # Arguments
    ///
    /// * `user_address` - The account debited.
    /// * `amount` - Share base units.
    /// * `operator` - A `manager`: the vault.
    ///
    /// # Errors
    ///
    /// * `AccessControlError::Unauthorized` - `operator` is not a `manager`.
    /// * `RWAError::InsufficientBalance` - `amount` exceeds the balance.
    /// * `FungibleTokenError::LessThanZero` - `amount` is negative.
    /// * `ComplianceError::TokenNotBound` - Compliance does not list the token.
    ///
    /// # Events
    ///
    /// * `Burn`; `TokensUnfrozen` first when frozen shares burn.
    ///
    /// # Authorization
    ///
    /// `operator` signs.
    #[only_role(operator, "manager")]
    fn burn(e: &Env, user_address: Address, amount: i128, operator: Address) {
        strata_storage::bump_instance(e);
        RWA::burn(e, &user_address, amount);
        extend::balances(e, &[&user_address]);
    }

    /// Moves shares without the sender's signature: the vault escrows
    /// redemptions and returns escrow through it. The pause, freezes, the
    /// identity check and the compliance rules' check do not apply. Compliance
    /// moves shares with `legal_transfer` instead.
    ///
    /// # Arguments
    ///
    /// * `from` - The sender.
    /// * `to` - The receiver.
    /// * `amount` - Share base units.
    /// * `operator` - A `manager`: the vault.
    ///
    /// # Errors
    ///
    /// * `AccessControlError::Unauthorized` - `operator` is not a `manager`.
    /// * `RWAError::InsufficientBalance` - `amount` exceeds `from`'s balance.
    /// * `FungibleTokenError::LessThanZero` - `amount` is negative.
    /// * `ComplianceError::TokenNotBound` - Compliance does not list the token.
    ///
    /// # Events
    ///
    /// * `Transfer`; `TokensUnfrozen` first when frozen shares move.
    ///
    /// # Authorization
    ///
    /// `operator` signs.
    #[only_role(operator, "manager")]
    fn forced_transfer(e: &Env, from: Address, to: Address, amount: i128, operator: Address) {
        strata_storage::bump_instance(e);
        RWA::forced_transfer(e, &from, &to, amount);
        extend::balances(e, &[&from, &to]);
    }

    /// Moves a lost account's whole balance, and any freeze on it, to the
    /// recovery account the identity verifier names. Returns false when there
    /// was nothing to move.
    ///
    /// # Arguments
    ///
    /// * `old_account` - The lost account.
    /// * `new_account` - Its recovery account.
    /// * `operator` - A `compliance` holder.
    ///
    /// # Errors
    ///
    /// * `AccessControlError::Unauthorized` - `operator` lacks `compliance`.
    /// * `CoSignRequired` - `operator` is the admin.
    /// * `VaultAddress` - Either account is the vault.
    /// * `RWAError::IdentityVerificationFailed` - `new_account` is not
    ///   allowlisted.
    /// * `RWAError::IdentityMismatch` - The verifier names another recovery
    ///   account, or none.
    /// * `ComplianceError::TokenNotBound` - Compliance does not list the token.
    ///
    /// # Events
    ///
    /// * `Transfer` and `RecoverySuccess`, with the freeze events when a
    ///   freeze carries over.
    ///
    /// # Authorization
    ///
    /// `operator` and the admin sign, as two different accounts.
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

    /// Freezes or unfreezes an account: a frozen account can neither send nor
    /// receive a `transfer`, and the vault holds what it owes the account.
    /// Never freezes the vault's address once the token is bound to it.
    ///
    /// # Arguments
    ///
    /// * `user_address` - The account.
    /// * `freeze` - True freezes, false unfreezes.
    /// * `operator` - A `compliance` holder.
    ///
    /// # Errors
    ///
    /// * `AccessControlError::Unauthorized` - `operator` lacks `compliance`.
    /// * `VaultAddress` - Freezing the vault's address.
    ///
    /// # Events
    ///
    /// * `AddressFrozen`
    ///
    /// # Authorization
    ///
    /// `operator` signs.
    #[only_role(operator, "compliance")]
    fn set_address_frozen(e: &Env, user_address: Address, freeze: bool, operator: Address) {
        guards::not_freezing_vault(e, &user_address, freeze);
        strata_storage::bump_instance(e);
        RWA::set_address_frozen(e, &user_address, freeze);
        extend::address_frozen(e, &user_address);
    }

    /// Freezes part of an account's shares, which then cannot be transferred.
    /// Never on the vault's address once the token is bound to it.
    ///
    /// # Arguments
    ///
    /// * `user_address` - The account.
    /// * `amount` - Share base units added to the frozen amount.
    /// * `operator` - A `compliance` holder.
    ///
    /// # Errors
    ///
    /// * `AccessControlError::Unauthorized` - `operator` lacks `compliance`.
    /// * `VaultAddress` - `user_address` is the vault.
    /// * `RWAError::LessThanZero` - `amount` is negative.
    /// * `RWAError::InsufficientBalance` - The frozen amount would exceed the
    ///   balance.
    ///
    /// # Events
    ///
    /// * `TokensFrozen`
    ///
    /// # Authorization
    ///
    /// `operator` signs.
    #[only_role(operator, "compliance")]
    fn freeze_partial_tokens(e: &Env, user_address: Address, amount: i128, operator: Address) {
        guards::not_vault_address(e, &user_address);
        strata_storage::bump_instance(e);
        RWA::freeze_partial_tokens(e, &user_address, amount);
        extend::frozen_tokens(e, &user_address);
    }

    /// Unfreezes part of an account's frozen shares.
    ///
    /// # Arguments
    ///
    /// * `user_address` - The account.
    /// * `amount` - Share base units taken off the frozen amount.
    /// * `operator` - A `compliance` holder.
    ///
    /// # Errors
    ///
    /// * `AccessControlError::Unauthorized` - `operator` lacks `compliance`.
    /// * `RWAError::LessThanZero` - `amount` is negative.
    /// * `RWAError::InsufficientFreeTokens` - `amount` exceeds the frozen
    ///   shares.
    ///
    /// # Events
    ///
    /// * `TokensUnfrozen`
    ///
    /// # Authorization
    ///
    /// `operator` signs.
    #[only_role(operator, "compliance")]
    fn unfreeze_partial_tokens(e: &Env, user_address: Address, amount: i128, operator: Address) {
        strata_storage::bump_instance(e);
        RWA::unfreeze_partial_tokens(e, &user_address, amount);
        extend::frozen_tokens(e, &user_address);
    }

    /// Points the token at another compliance contract. Instant during setup;
    /// after it, propose a `Compliance` change.
    ///
    /// # Arguments
    ///
    /// * `compliance` - The compliance contract.
    /// * `operator` - The admin.
    ///
    /// # Errors
    ///
    /// * `AdminRequired` - `operator` is not the admin.
    /// * `UseTimelock` - Setup has finished.
    ///
    /// # Events
    ///
    /// * `ComplianceSet`
    ///
    /// # Authorization
    ///
    /// `operator` signs.
    fn set_compliance(e: &Env, compliance: Address, operator: Address) {
        guards::caller_is_admin(e, &operator);
        operator.require_auth();
        guards::direct_change_allowed(e);
        strata_storage::bump_instance(e);
        RWA::set_compliance(e, &compliance);
    }

    /// Points the token at another identity verifier. Instant during setup;
    /// after it, propose an `IdentityVerifier` change.
    ///
    /// # Arguments
    ///
    /// * `identity_verifier` - The identity verifier.
    /// * `operator` - The admin.
    ///
    /// # Errors
    ///
    /// * `AdminRequired` - `operator` is not the admin.
    /// * `UseTimelock` - Setup has finished.
    ///
    /// # Events
    ///
    /// * `IdentityVerifierSet`
    ///
    /// # Authorization
    ///
    /// `operator` signs.
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
