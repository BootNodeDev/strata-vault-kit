extern crate std;

use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::{
        storage::Instance as _, Address as _, AuthorizedFunction, AuthorizedInvocation,
        Events as _, Ledger as _, MockAuth, MockAuthInvoke,
    },
    vec, Address, BytesN, Env, Event as _, IntoVal, String, Symbol, Vec,
};
use stellar_access::role_transfer::RoleTransferError;
use strata_storage::INSTANCE_EXTEND_AMOUNT;
use strata_timelock::{Clock, DAY_DURATION, MIN_DELAY};

use crate::{
    ChangeApplied, ChangeProposed, ShareToken, ShareTokenClient, ShareTokenError, TokenChange,
    ADMIN_ACCEPT_LEDGERS,
};
use compliance::{Compliance, ComplianceClient};
use identity_verifier::{IdentityVerifier, IdentityVerifierClient};

const TWO_DAYS_IN_LEDGERS: u32 = 2 * 17_280;

/// Plays the vault: reports whatever clock a test sets, and counts the reads.
#[contract]
struct ClockStub;

#[contractimpl]
impl ClockStub {
    pub fn set(e: Env, clock: Clock) {
        e.storage().instance().set(&symbol_short!("clock"), &clock);
    }

    pub fn reads(e: Env) -> u32 {
        e.storage()
            .instance()
            .get(&symbol_short!("reads"))
            .unwrap_or(0)
    }
}

#[contractimpl(contracttrait)]
impl strata_timelock::ClockSource for ClockStub {
    fn timelock_clock(e: &Env) -> Clock {
        let reads = Self::reads(e.clone()) + 1;
        e.storage().instance().set(&symbol_short!("reads"), &reads);
        e.storage().instance().get(&symbol_short!("clock")).unwrap()
    }
}

fn clock_stub<'a>(e: &Env) -> ClockStubClient<'a> {
    let vault = ClockStubClient::new(e, &e.register(ClockStub, ()));
    vault.set(&Clock {
        delay: MIN_DELAY,
        exit_window: 0,
        paused_secs: 0,
        paused: false,
        winding_down: false,
    });
    vault
}

/// Compliance rules whose answers a test sets, and may change after a swap to
/// them is proposed.
#[contract]
struct RulesStub;

#[contractimpl]
impl RulesStub {
    pub fn report(e: Env, vault: Option<Address>, setup_open: bool, linked: Vec<Address>) {
        let store = e.storage().instance();
        store.set(&symbol_short!("vault"), &vault);
        store.set(&symbol_short!("open"), &setup_open);
        store.set(&symbol_short!("linked"), &linked);
    }

    /// Every view fails from now on.
    pub fn silence(e: Env) {
        let store = e.storage().instance();
        store.remove(&symbol_short!("vault"));
        store.remove(&symbol_short!("open"));
        store.remove(&symbol_short!("linked"));
    }

    /// One view, `vault` or `open`, fails from now on.
    pub fn forget(e: Env, view: Symbol) {
        e.storage().instance().remove(&view);
    }

    pub fn linked_tokens(e: Env) -> Vec<Address> {
        e.storage()
            .instance()
            .get(&symbol_short!("linked"))
            .unwrap()
    }
}

#[contractimpl(contracttrait)]
impl strata_bindings::VaultBinding for RulesStub {
    fn vault(e: &Env) -> Option<Address> {
        e.storage().instance().get(&symbol_short!("vault")).unwrap()
    }

    fn setup_open(e: &Env) -> bool {
        e.storage().instance().get(&symbol_short!("open")).unwrap()
    }
}

/// Rules from outside the kit, such as OpenZeppelin's, with no binding view.
#[contract]
struct ExternalRules;

#[contractimpl]
impl ExternalRules {
    pub fn list(e: Env, linked: Vec<Address>) {
        e.storage()
            .instance()
            .set(&symbol_short!("linked"), &linked);
    }

    pub fn linked_tokens(e: Env) -> Vec<Address> {
        e.storage()
            .instance()
            .get(&symbol_short!("linked"))
            .unwrap()
    }
}

/// A verifier that accepts every account until a test silences it.
#[contract]
struct VerifierStub;

#[contractimpl]
impl VerifierStub {
    pub fn silence(e: Env) {
        e.storage().instance().set(&symbol_short!("silent"), &true);
    }

    pub fn verify_identity(e: Env, _account: Address) {
        assert!(!e.storage().instance().has(&symbol_short!("silent")));
    }
}

struct Fixture<'a> {
    e: Env,
    token: ShareTokenClient<'a>,
    vault: ClockStubClient<'a>,
    admin: Address,
}

impl Fixture<'_> {
    fn clock(&self, f: impl FnOnce(&mut Clock)) {
        let mut clock =
            strata_timelock::ClockSourceClient::new(&self.e, &self.vault.address).timelock_clock();
        f(&mut clock);
        self.vault.set(&clock);
    }

    fn advance(&self, secs: u64) {
        self.e.ledger().with_mut(|l| {
            l.timestamp += secs;
            l.sequence_number += (secs / 5).max(1) as u32;
        });
    }

    fn finish(&self) {
        self.token.bind_vault(&self.vault.address);
        self.token.finish_setup();
    }

    fn propose(&self, change: TokenChange) -> u32 {
        self.token.propose_change(&change)
    }

    fn rules(&self) -> ComplianceClient<'_> {
        ComplianceClient::new(&self.e, &self.e.register(Compliance, (self.admin.clone(),)))
    }

    /// Rules the token may swap to: they list the token and run on this
    /// vault's clock with their setup finished.
    fn rules_bound_here(&self) -> Address {
        let rules = self.rules();
        rules.bind_token(&self.token.address, &self.admin);
        rules.bind_vault(&self.vault.address);
        rules.finish_setup();
        rules.address
    }

    /// Stub rules that qualify until a test changes their answers.
    fn rules_stub_bound_here(&self) -> RulesStubClient<'_> {
        let rules = RulesStubClient::new(&self.e, &self.e.register(RulesStub, ()));
        rules.report(
            &Some(self.vault.address.clone()),
            &false,
            &vec![&self.e, self.token.address.clone()],
        );
        rules
    }

    fn rules_from_outside(&self, linked: &Vec<Address>) -> ExternalRulesClient<'_> {
        let rules = ExternalRulesClient::new(&self.e, &self.e.register(ExternalRules, ()));
        rules.list(linked);
        rules
    }

    fn verifier(&self) -> IdentityVerifierClient<'_> {
        IdentityVerifierClient::new(
            &self.e,
            &self.e.register(IdentityVerifier, (self.admin.clone(),)),
        )
    }

    fn verifier_accepting_the_vault(&self) -> Address {
        let verifier = self.verifier();
        verifier.allow(&self.vault.address, &true);
        verifier.address
    }

    /// Lands an `Admin` change for `next` and returns the ledger of the offer.
    fn offer_admin(&self, next: &Address) -> u32 {
        let id = self.propose(TokenChange::Admin(next.clone()));
        self.advance(MIN_DELAY);
        self.token.apply_change(&id);
        self.e.ledger().sequence()
    }

    fn instance_ttl(&self) -> u32 {
        self.e.as_contract(&self.token.address, || {
            self.e.storage().instance().get_ttl()
        })
    }

    /// Lets the instance decay past its extend threshold, then checks the call
    /// extends it back to the full TTL.
    fn restores_the_instance(&self, call: impl FnOnce()) {
        self.e
            .ledger()
            .with_mut(|l| l.sequence_number += TWO_DAYS_IN_LEDGERS);
        assert!(self.instance_ttl() < INSTANCE_EXTEND_AMOUNT);
        call();
        assert_eq!(self.instance_ttl(), INSTANCE_EXTEND_AMOUNT);
    }

    /// Signs one call to the token as `who` and nothing else, so the call
    /// carries that account's signature but not the admin's.
    fn sign_only_as(&self, who: &Address, fn_name: &str, args: soroban_sdk::Vec<soroban_sdk::Val>) {
        self.e.mock_auths(&[MockAuth {
            address: who,
            invoke: &MockAuthInvoke {
                contract: &self.token.address,
                fn_name,
                args,
                sub_invokes: &[],
            },
        }]);
    }

    /// The last call asked `who` alone to sign, once, on exactly this call.
    fn signed_once_by(
        &self,
        who: &Address,
        fn_name: &str,
        args: soroban_sdk::Vec<soroban_sdk::Val>,
    ) {
        assert_eq!(
            self.e.auths(),
            std::vec![(
                who.clone(),
                AuthorizedInvocation {
                    function: AuthorizedFunction::Contract((
                        self.token.address.clone(),
                        Symbol::new(&self.e, fn_name),
                        args,
                    )),
                    sub_invocations: std::vec![],
                },
            )]
        );
    }
}

fn setup<'a>() -> Fixture<'a> {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().set_timestamp(10_000);
    let admin = Address::generate(&e);
    let token = e.register(
        ShareToken,
        (
            String::from_str(&e, "Strata Vault USDC"),
            String::from_str(&e, "bvUSDC"),
            admin.clone(),
            Address::generate(&e),
            Address::generate(&e),
            Address::generate(&e),
        ),
    );
    let vault = clock_stub(&e);
    Fixture {
        token: ShareTokenClient::new(&e, &token),
        vault,
        admin,
        e,
    }
}

fn refused<T: core::fmt::Debug + PartialEq, E: core::fmt::Debug + PartialEq>(
    result: Result<Result<T, E>, Result<soroban_sdk::Error, soroban_sdk::InvokeError>>,
    expected: ShareTokenError,
) {
    assert_eq!(result, Err(Ok(expected.into())));
}

fn manager() -> Symbol {
    symbol_short!("manager")
}

fn compliance(e: &Env) -> Symbol {
    Symbol::new(e, "compliance")
}

#[test]
fn setup_is_open_until_finished_and_never_reopens() {
    let f = setup();
    assert!(f.token.setup_open());
    refused(f.token.try_finish_setup(), ShareTokenError::VaultNotBound);

    f.finish();

    assert!(!f.token.setup_open());
    assert_eq!(f.token.vault(), Some(f.vault.address.clone()));
    refused(f.token.try_finish_setup(), ShareTokenError::SetupClosed);
    refused(
        f.token.try_bind_vault(&Address::generate(&f.e)),
        ShareTokenError::SetupClosed,
    );
}

#[test]
fn a_second_vault_cannot_be_bound() {
    let f = setup();
    f.token.bind_vault(&f.vault.address);

    refused(
        f.token.try_bind_vault(&Address::generate(&f.e)),
        ShareTokenError::SetupClosed,
    );
    assert_eq!(f.token.vault(), Some(f.vault.address.clone()));
}

#[test]
fn an_address_that_reports_no_clock_cannot_be_bound() {
    let f = setup();

    assert!(f.token.try_bind_vault(&Address::generate(&f.e)).is_err());
    assert_eq!(f.token.vault(), None);
}

#[test]
fn only_the_admin_binds_and_finishes() {
    let f = setup();
    let stranger = Address::generate(&f.e);

    f.sign_only_as(
        &stranger,
        "bind_vault",
        (f.vault.address.clone(),).into_val(&f.e),
    );
    assert!(f.token.try_bind_vault(&f.vault.address).is_err());
    assert_eq!(f.token.vault(), None);

    f.e.mock_all_auths();
    f.token.bind_vault(&f.vault.address);
    f.sign_only_as(&stranger, "finish_setup", soroban_sdk::Vec::new(&f.e));
    assert!(f.token.try_finish_setup().is_err());
    assert!(f.token.setup_open());
}

fn implements_the_vault_view<T: strata_bindings::VaultBinding>() {}

#[test]
fn the_token_answers_the_view_the_vault_reads() {
    implements_the_vault_view::<ShareToken>();
    let f = setup();
    let view = strata_bindings::VaultBindingClient::new(&f.e, &f.token.address);
    assert_eq!(view.vault(), None);
    assert!(view.setup_open());

    f.finish();

    assert_eq!(view.vault(), Some(f.vault.address.clone()));
    assert!(!view.setup_open());
}

#[test]
fn grants_and_manager_revokes_wait_after_setup() {
    let f = setup();
    let early = Address::generate(&f.e);
    f.token.grant_role(&early, &manager(), &f.admin);
    assert!(f.token.has_role(&early, &manager()).is_some());

    f.finish();

    refused(
        f.token
            .try_grant_role(&Address::generate(&f.e), &manager(), &f.admin),
        ShareTokenError::UseTimelock,
    );
    refused(
        f.token.try_revoke_role(&early, &manager(), &f.admin),
        ShareTokenError::UseTimelock,
    );
    assert!(f.token.has_role(&early, &manager()).is_some());
}

#[test]
fn rule_and_verifier_swaps_wait_after_setup() {
    let f = setup();
    f.finish();

    refused(
        f.token
            .try_set_compliance(&Address::generate(&f.e), &f.admin),
        ShareTokenError::UseTimelock,
    );
    refused(
        f.token
            .try_set_identity_verifier(&Address::generate(&f.e), &f.admin),
        ShareTokenError::UseTimelock,
    );
}

#[test]
fn revoking_compliance_stays_instant_after_setup() {
    let f = setup();
    let officer = Address::generate(&f.e);
    f.token.grant_role(&officer, &compliance(&f.e), &f.admin);
    f.finish();

    f.token.revoke_role(&officer, &compliance(&f.e), &f.admin);

    assert!(f.token.has_role(&officer, &compliance(&f.e)).is_none());
}

#[test]
fn an_admin_hand_over_waits_but_cancelling_one_does_not() {
    let f = setup();
    f.finish();
    let next = Address::generate(&f.e);

    refused(
        f.token
            .try_transfer_admin_role(&next, &(f.e.ledger().sequence() + 100)),
        ShareTokenError::UseTimelock,
    );

    let id = f.propose(TokenChange::Admin(next.clone()));
    f.advance(MIN_DELAY);
    f.token.apply_change(&id);
    f.token.transfer_admin_role(&next, &0);

    assert!(f.token.try_accept_admin_transfer().is_err());
    assert_eq!(f.token.get_admin(), Some(f.admin.clone()));
}

#[test]
fn setup_cannot_finish_while_a_hand_over_is_pending() {
    let f = setup();
    let next = Address::generate(&f.e);
    f.token.bind_vault(&f.vault.address);
    f.token
        .transfer_admin_role(&next, &(f.e.ledger().sequence() + 100));

    refused(
        f.token.try_finish_setup(),
        ShareTokenError::AdminTransferPending,
    );

    f.token.transfer_admin_role(&next, &0);
    f.token.finish_setup();
    assert!(f.token.try_accept_admin_transfer().is_err());
    assert_eq!(f.token.get_admin(), Some(f.admin.clone()));
}

#[test]
fn an_expired_hand_over_does_not_hold_setup_open() {
    let f = setup();
    f.token.bind_vault(&f.vault.address);
    f.token
        .transfer_admin_role(&Address::generate(&f.e), &(f.e.ledger().sequence() + 10));
    f.e.ledger().with_mut(|l| l.sequence_number += 11);

    f.token.finish_setup();

    assert!(!f.token.setup_open());
    assert_eq!(
        f.token.try_accept_admin_transfer(),
        Err(Ok(RoleTransferError::NoPendingTransfer.into()))
    );
    assert_eq!(f.token.get_admin(), Some(f.admin.clone()));
}

#[test]
fn no_role_ever_gets_a_role_admin() {
    let f = setup();

    refused(
        f.token
            .try_set_role_admin(&manager(), &symbol_short!("guardian")),
        ShareTokenError::UseTimelock,
    );
}

#[test]
fn nothing_is_proposed_during_setup() {
    let f = setup();

    refused(
        f.token
            .try_propose_change(&TokenChange::GrantRole(manager(), f.admin.clone())),
        ShareTokenError::SetupOpen,
    );
    assert_eq!(f.token.pending_changes().len(), 0);
}

#[test]
fn a_grant_lands_one_vault_delay_after_it_was_proposed() {
    let f = setup();
    f.finish();
    let next = Address::generate(&f.e);

    let id = f.propose(TokenChange::GrantRole(manager(), next.clone()));
    let pending = f.token.pending_changes();
    assert_eq!(pending.len(), 1);
    assert_eq!(
        pending.get(0).unwrap().eta,
        f.e.ledger().timestamp() + MIN_DELAY
    );

    f.advance(MIN_DELAY - 1);
    refused(
        f.token.try_apply_change(&id),
        ShareTokenError::ChangeNotReady,
    );

    f.advance(1);
    f.token.apply_change(&id);
    assert!(f.token.has_role(&next, &manager()).is_some());
    assert_eq!(f.token.pending_changes().len(), 0);
}

#[test]
fn a_revoke_lands_through_the_timelock() {
    let f = setup();
    let holder = Address::generate(&f.e);
    f.token.grant_role(&holder, &manager(), &f.admin);
    f.finish();

    let id = f.propose(TokenChange::RevokeRole(manager(), holder.clone()));
    f.advance(MIN_DELAY);
    f.token.apply_change(&id);

    assert!(f.token.has_role(&holder, &manager()).is_none());
}

#[test]
fn a_vault_pause_moves_the_eta_and_holds_the_change() {
    let f = setup();
    f.finish();
    let id = f.propose(TokenChange::GrantRole(manager(), Address::generate(&f.e)));
    let eta = f.token.pending_changes().get(0).unwrap().eta;

    f.advance(DAY_DURATION);
    f.clock(|c| c.paused = true);
    f.advance(3 * DAY_DURATION);
    f.clock(|c| c.paused_secs = 3 * DAY_DURATION);
    f.advance(MIN_DELAY);

    refused(f.token.try_apply_change(&id), ShareTokenError::VaultPaused);

    f.clock(|c| c.paused = false);
    assert_eq!(
        f.token.pending_changes().get(0).unwrap().eta,
        eta + 3 * DAY_DURATION
    );
    f.advance(3 * DAY_DURATION);
    f.token.apply_change(&id);
}

#[test]
fn the_proposal_event_carries_the_eta_pending_changes_reports_then() {
    let f = setup();
    f.finish();
    f.clock(|c| {
        c.paused = true;
        c.paused_secs = DAY_DURATION;
    });

    let change = TokenChange::GrantRole(manager(), Address::generate(&f.e));
    let eta = f.e.ledger().timestamp() + MIN_DELAY;
    let id = f.token.propose_change(&change);

    assert_eq!(
        f.e.events().all().filter_by_contract(&f.token.address),
        [ChangeProposed { id, change, eta }.to_xdr(&f.e, &f.token.address)]
    );
    assert_eq!(f.token.pending_changes().get(0).unwrap().eta, eta);

    f.clock(|c| c.paused_secs = 2 * DAY_DURATION);
    assert_eq!(
        f.token.pending_changes().get(0).unwrap().eta,
        eta + DAY_DURATION
    );
}

#[test]
fn nothing_is_proposed_or_applied_while_the_vault_winds_down() {
    let f = setup();
    f.finish();
    let id = f.propose(TokenChange::GrantRole(manager(), Address::generate(&f.e)));
    f.clock(|c| c.winding_down = true);
    f.advance(MIN_DELAY);

    refused(
        f.token
            .try_propose_change(&TokenChange::GrantRole(manager(), Address::generate(&f.e))),
        ShareTokenError::WindDownActive,
    );
    refused(
        f.token.try_propose_change(&TokenChange::RevokeRole(
            compliance(&f.e),
            Address::generate(&f.e),
        )),
        ShareTokenError::WindDownActive,
    );
    refused(
        f.token.try_apply_change(&id),
        ShareTokenError::WindDownActive,
    );
    f.token.cancel_change(&id);
}

#[test]
fn a_compliance_grant_lands_through_the_timelock_during_a_wind_down() {
    let f = setup();
    f.finish();
    f.clock(|c| c.winding_down = true);
    let successor = Address::generate(&f.e);
    let id = f.propose(TokenChange::GrantRole(compliance(&f.e), successor.clone()));

    refused(
        f.token.try_apply_change(&id),
        ShareTokenError::ChangeNotReady,
    );
    f.advance(MIN_DELAY);
    f.token.apply_change(&id);
    assert!(f.token.has_role(&successor, &compliance(&f.e)).is_some());
}

#[test]
fn a_compliance_grant_proposed_before_the_wind_down_lands_during_it() {
    let f = setup();
    f.finish();
    let successor = Address::generate(&f.e);
    let id = f.propose(TokenChange::GrantRole(compliance(&f.e), successor.clone()));
    f.clock(|c| c.winding_down = true);
    f.advance(MIN_DELAY);

    f.token.apply_change(&id);
    assert!(f.token.has_role(&successor, &compliance(&f.e)).is_some());
}

#[test]
fn a_paused_vault_still_holds_a_compliance_grant_in_a_wind_down() {
    let f = setup();
    f.finish();
    f.clock(|c| {
        c.winding_down = true;
        c.paused = true;
    });
    let id = f.propose(TokenChange::GrantRole(
        compliance(&f.e),
        Address::generate(&f.e),
    ));
    f.advance(MIN_DELAY);

    refused(f.token.try_apply_change(&id), ShareTokenError::VaultPaused);
}

#[test]
fn governance_still_revokes_the_last_compliance_holder_at_once() {
    let f = setup();
    f.finish();
    let holder = f.token.get_role_member(&compliance(&f.e), &0);

    f.token.revoke_role(&holder, &compliance(&f.e), &f.admin);
    assert_eq!(f.token.get_role_member_count(&compliance(&f.e)), 0);
}

#[test]
fn an_admin_hand_over_cannot_be_accepted_while_the_vault_winds_down() {
    let f = setup();
    f.finish();
    let next = Address::generate(&f.e);
    f.offer_admin(&next);
    f.clock(|c| c.winding_down = true);

    refused(
        f.token.try_accept_admin_transfer(),
        ShareTokenError::WindDownActive,
    );
    assert_eq!(f.token.get_admin(), Some(f.admin.clone()));
}

#[test]
fn a_change_shorter_than_a_raised_notice_never_lands() {
    let f = setup();
    f.finish();
    let id = f.propose(TokenChange::GrantRole(manager(), Address::generate(&f.e)));
    f.clock(|c| {
        c.delay = 30 * DAY_DURATION;
        c.exit_window = 20 * DAY_DURATION;
    });
    f.advance(30 * DAY_DURATION);

    refused(
        f.token.try_apply_change(&id),
        ShareTokenError::DelayBelowNotice,
    );
}

#[test]
fn one_upgrade_waits_at_a_time() {
    let f = setup();
    f.finish();
    f.propose(TokenChange::Upgrade(BytesN::from_array(&f.e, &[7; 32])));

    refused(
        f.token
            .try_propose_change(&TokenChange::Upgrade(BytesN::from_array(&f.e, &[9; 32]))),
        ShareTokenError::UpgradeAlreadyPending,
    );
}

#[test]
fn only_the_admin_proposes_cancels_and_applies() {
    let f = setup();
    f.finish();
    let stranger = Address::generate(&f.e);
    let change = TokenChange::GrantRole(manager(), Address::generate(&f.e));
    let id = f.propose(change.clone());
    f.advance(MIN_DELAY);

    f.sign_only_as(
        &stranger,
        "propose_change",
        (change.clone(),).into_val(&f.e),
    );
    assert!(f.token.try_propose_change(&change).is_err());
    f.sign_only_as(&stranger, "cancel_change", (id,).into_val(&f.e));
    assert!(f.token.try_cancel_change(&id).is_err());
    f.sign_only_as(&stranger, "apply_change", (id,).into_val(&f.e));
    assert!(f.token.try_apply_change(&id).is_err());
    assert_eq!(f.token.pending_changes().len(), 1);
}

#[test]
fn an_applied_admin_change_starts_a_hand_over_the_next_admin_accepts() {
    let f = setup();
    f.finish();
    let next = Address::generate(&f.e);
    let id = f.propose(TokenChange::Admin(next.clone()));
    f.advance(MIN_DELAY);

    // One admin signature covers the call; the hand-over inside asks for none.
    f.sign_only_as(&f.admin, "apply_change", (id,).into_val(&f.e));
    f.token.apply_change(&id);

    f.e.mock_all_auths();
    assert_eq!(f.token.get_admin(), Some(f.admin.clone()));
    f.token.accept_admin_transfer();
    assert_eq!(f.token.get_admin(), Some(next));
}

#[test]
fn the_hand_over_offer_is_open_on_its_last_ledger() {
    let f = setup();
    f.finish();
    let next = Address::generate(&f.e);
    let offered_at = f.offer_admin(&next);

    f.e.ledger()
        .with_mut(|l| l.sequence_number = offered_at + ADMIN_ACCEPT_LEDGERS);
    f.token.accept_admin_transfer();

    assert_eq!(f.token.get_admin(), Some(next));
}

#[test]
fn the_hand_over_offer_lasts_seven_days_of_ledgers() {
    let f = setup();
    f.finish();
    let offered_at = f.offer_admin(&Address::generate(&f.e));

    f.e.ledger()
        .with_mut(|l| l.sequence_number = offered_at + ADMIN_ACCEPT_LEDGERS + 1);

    assert_eq!(
        f.token.try_accept_admin_transfer(),
        Err(Ok(RoleTransferError::NoPendingTransfer.into()))
    );
    assert_eq!(f.token.get_admin(), Some(f.admin.clone()));
}

#[test]
fn applied_rule_and_verifier_changes_take_effect() {
    let f = setup();
    f.finish();
    let rules = f.rules_bound_here();
    let verifier = f.verifier_accepting_the_vault();
    let first = f.propose(TokenChange::Compliance(rules.clone()));
    let second = f.propose(TokenChange::IdentityVerifier(verifier.clone()));
    f.advance(MIN_DELAY);

    f.token.apply_change(&first);
    f.token.apply_change(&second);

    assert_eq!(f.token.compliance(), rules);
    assert_eq!(f.token.identity_verifier(), verifier);
}

#[test]
fn rules_off_this_vaults_clock_or_without_the_token_are_never_proposed() {
    let f = setup();
    f.finish();
    let unlisted = f.rules();
    unlisted.bind_vault(&f.vault.address);
    unlisted.finish_setup();
    let elsewhere = f.rules();
    elsewhere.bind_token(&f.token.address, &f.admin);
    elsewhere.bind_vault(&clock_stub(&f.e).address);
    elsewhere.finish_setup();
    let in_setup = f.rules();
    in_setup.bind_token(&f.token.address, &f.admin);
    in_setup.bind_vault(&f.vault.address);
    let outside_for_another_token = f.rules_from_outside(&vec![&f.e, Address::generate(&f.e)]);
    let not_a_contract = Address::generate(&f.e);

    for rules in [
        unlisted.address,
        elsewhere.address,
        in_setup.address,
        outside_for_another_token.address,
        not_a_contract,
    ] {
        refused(
            f.token.try_propose_change(&TokenChange::Compliance(rules)),
            ShareTokenError::ComplianceNotBound,
        );
    }
    assert_eq!(f.token.pending_changes().len(), 0);
}

/// Proposes a swap to rules that qualify, lets `turn` change their answers,
/// then checks the swap no longer lands.
fn refused_once_the_rules_turn(f: &Fixture, turn: impl FnOnce(&RulesStubClient)) {
    let rules = f.rules_stub_bound_here();
    let id = f.propose(TokenChange::Compliance(rules.address.clone()));
    turn(&rules);
    f.advance(MIN_DELAY);

    refused(
        f.token.try_apply_change(&id),
        ShareTokenError::ComplianceNotBound,
    );
    assert_ne!(f.token.compliance(), rules.address);
}

#[test]
fn rules_that_stop_qualifying_are_never_installed() {
    let f = setup();
    f.finish();
    let here = Some(f.vault.address.clone());
    let listed = vec![&f.e, f.token.address.clone()];

    refused_once_the_rules_turn(&f, |rules| rules.report(&here, &false, &vec![&f.e]));
    refused_once_the_rules_turn(&f, |rules| {
        rules.report(&Some(clock_stub(&f.e).address), &false, &listed)
    });
    refused_once_the_rules_turn(&f, |rules| rules.report(&None, &false, &listed));
    refused_once_the_rules_turn(&f, |rules| rules.report(&here, &true, &listed));
    refused_once_the_rules_turn(&f, |rules| rules.silence());
}

/// Their own governance is a trust assumption, as at the vault's setup.
#[test]
fn rules_from_outside_the_kit_are_installed_while_they_list_the_token() {
    let f = setup();
    f.finish();
    let listed = vec![&f.e, f.token.address.clone()];
    let kept = f.rules_from_outside(&listed);
    let dropped = f.rules_from_outside(&listed);
    let first = f.propose(TokenChange::Compliance(kept.address.clone()));
    let second = f.propose(TokenChange::Compliance(dropped.address.clone()));
    dropped.list(&vec![&f.e]);
    f.advance(MIN_DELAY);

    refused(
        f.token.try_apply_change(&second),
        ShareTokenError::ComplianceNotBound,
    );
    f.token.apply_change(&first);
    assert_eq!(f.token.compliance(), kept.address);
}

/// Like `refused_once_the_rules_turn`, but the swap still lands.
fn installed_once_the_rules_turn(f: &Fixture, turn: impl FnOnce(&RulesStubClient)) {
    let rules = f.rules_stub_bound_here();
    let id = f.propose(TokenChange::Compliance(rules.address.clone()));
    turn(&rules);
    f.advance(MIN_DELAY);

    f.token.apply_change(&id);
    assert_eq!(f.token.compliance(), rules.address);
}

/// As at the vault's setup, once one view fails, the other is ignored.
#[test]
fn rules_that_stop_answering_a_binding_view_are_installed_as_external() {
    let f = setup();
    f.finish();
    let here = Some(f.vault.address.clone());
    let listed = vec![&f.e, f.token.address.clone()];

    installed_once_the_rules_turn(&f, |rules| {
        rules.report(&Some(clock_stub(&f.e).address), &false, &listed);
        rules.forget(&symbol_short!("open"));
    });
    installed_once_the_rules_turn(&f, |rules| {
        rules.report(&here, &true, &listed);
        rules.forget(&symbol_short!("vault"));
    });
}

#[test]
fn a_verifier_that_refuses_the_vault_or_cannot_answer_is_never_proposed() {
    let f = setup();
    f.finish();
    let refusing = f.verifier().address;
    let not_a_verifier = f.vault.address.clone();
    let not_a_contract = Address::generate(&f.e);

    for verifier in [refusing, not_a_verifier, not_a_contract] {
        refused(
            f.token
                .try_propose_change(&TokenChange::IdentityVerifier(verifier)),
            ShareTokenError::VerifierRefusesVault,
        );
    }
    assert_eq!(f.token.pending_changes().len(), 0);
}

#[test]
fn a_verifier_that_stops_accepting_the_vault_is_never_installed() {
    let f = setup();
    f.finish();
    let delisting = f.verifier();
    delisting.allow(&f.vault.address, &true);
    let silenced = VerifierStubClient::new(&f.e, &f.e.register(VerifierStub, ()));
    let first = f.propose(TokenChange::IdentityVerifier(delisting.address.clone()));
    let second = f.propose(TokenChange::IdentityVerifier(silenced.address.clone()));

    delisting.allow(&f.vault.address, &false);
    silenced.silence();
    f.advance(MIN_DELAY);

    for id in [first, second] {
        refused(
            f.token.try_apply_change(&id),
            ShareTokenError::VerifierRefusesVault,
        );
    }
    assert_eq!(f.token.pending_changes().len(), 2);
}

#[test]
fn proposing_and_applying_publish_the_change() {
    let f = setup();
    f.finish();
    let change = TokenChange::GrantRole(manager(), Address::generate(&f.e));
    let eta = f.e.ledger().timestamp() + MIN_DELAY;

    let id = f.propose(change.clone());
    assert_eq!(
        f.e.events().all().filter_by_contract(&f.token.address),
        [ChangeProposed {
            id,
            change: change.clone(),
            eta,
        }
        .to_xdr(&f.e, &f.token.address)]
    );

    f.advance(MIN_DELAY);
    f.token.apply_change(&id);
    let events = f.e.events().all().filter_by_contract(&f.token.address);
    assert_eq!(
        events.events().last(),
        Some(&ChangeApplied { id, change }.to_xdr(&f.e, &f.token.address))
    );
}

#[test]
fn proposing_reads_the_vault_clock_once() {
    let f = setup();
    f.finish();
    let before = f.vault.reads();

    f.propose(TokenChange::GrantRole(manager(), Address::generate(&f.e)));

    assert_eq!(f.vault.reads(), before + 1);
}

#[test]
fn a_proposal_after_a_past_pause_waits_one_delay_from_now() {
    let f = setup();
    f.finish();
    f.clock(|c| c.paused_secs = 3 * DAY_DURATION);
    let change = TokenChange::GrantRole(manager(), Address::generate(&f.e));
    let eta = f.e.ledger().timestamp() + MIN_DELAY;

    let id = f.propose(change.clone());

    assert_eq!(
        f.e.events().all().filter_by_contract(&f.token.address),
        [ChangeProposed { id, change, eta }.to_xdr(&f.e, &f.token.address)]
    );
    assert_eq!(f.token.pending_changes().get(0).unwrap().eta, eta);
}

#[test]
fn the_schema_version_is_one_after_construction() {
    let f = setup();

    assert_eq!(f.token.schema_version(), 1);
}

#[test]
fn every_admin_call_restores_the_instance_ttl() {
    let f = setup();
    let holder = Address::generate(&f.e);
    let next = Address::generate(&f.e);

    f.restores_the_instance(|| f.token.grant_role(&holder, &manager(), &f.admin));
    f.restores_the_instance(|| f.token.revoke_role(&holder, &manager(), &f.admin));
    f.restores_the_instance(|| {
        f.token
            .transfer_admin_role(&next, &(f.e.ledger().sequence() + ADMIN_ACCEPT_LEDGERS))
    });
    f.restores_the_instance(|| f.token.transfer_admin_role(&next, &0));
    f.restores_the_instance(|| f.token.bind_vault(&f.vault.address));
    f.restores_the_instance(|| f.token.finish_setup());

    let grant = TokenChange::GrantRole(manager(), Address::generate(&f.e));
    let mut id = 0;
    f.restores_the_instance(|| id = f.propose(grant.clone()));
    f.restores_the_instance(|| f.token.cancel_change(&id));

    let id = f.propose(grant);
    f.advance(MIN_DELAY);
    f.restores_the_instance(|| f.token.apply_change(&id));

    f.offer_admin(&next);
    f.restores_the_instance(|| f.token.accept_admin_transfer());
}

#[test]
fn each_admin_call_asks_the_admin_for_one_signature() {
    let f = setup();
    let holder = Address::generate(&f.e);
    let rules = Address::generate(&f.e);
    let verifier = Address::generate(&f.e);
    let live_until = f.e.ledger().sequence() + ADMIN_ACCEPT_LEDGERS;

    f.token.pause(&f.admin);
    f.signed_once_by(&f.admin, "pause", (f.admin.clone(),).into_val(&f.e));
    f.token.unpause(&f.admin);
    f.signed_once_by(&f.admin, "unpause", (f.admin.clone(),).into_val(&f.e));
    f.token.set_compliance(&rules, &f.admin);
    f.signed_once_by(
        &f.admin,
        "set_compliance",
        (rules.clone(), f.admin.clone()).into_val(&f.e),
    );
    f.token.set_identity_verifier(&verifier, &f.admin);
    f.signed_once_by(
        &f.admin,
        "set_identity_verifier",
        (verifier, f.admin.clone()).into_val(&f.e),
    );
    f.token.grant_role(&holder, &manager(), &f.admin);
    f.signed_once_by(
        &f.admin,
        "grant_role",
        (holder.clone(), manager(), f.admin.clone()).into_val(&f.e),
    );
    f.token.revoke_role(&holder, &manager(), &f.admin);
    f.signed_once_by(
        &f.admin,
        "revoke_role",
        (holder.clone(), manager(), f.admin.clone()).into_val(&f.e),
    );
    f.token.transfer_admin_role(&holder, &live_until);
    f.signed_once_by(
        &f.admin,
        "transfer_admin_role",
        (holder.clone(), live_until).into_val(&f.e),
    );
    f.token.transfer_admin_role(&holder, &0);
    f.signed_once_by(
        &f.admin,
        "transfer_admin_role",
        (holder.clone(), 0_u32).into_val(&f.e),
    );

    f.token.bind_vault(&f.vault.address);
    f.signed_once_by(
        &f.admin,
        "bind_vault",
        (f.vault.address.clone(),).into_val(&f.e),
    );
    f.token.finish_setup();
    f.signed_once_by(&f.admin, "finish_setup", soroban_sdk::Vec::new(&f.e));

    let change = TokenChange::Compliance(f.rules_bound_here());
    let id = f.token.propose_change(&change);
    f.signed_once_by(&f.admin, "propose_change", (change.clone(),).into_val(&f.e));
    f.token.cancel_change(&id);
    f.signed_once_by(&f.admin, "cancel_change", (id,).into_val(&f.e));

    let id = f.token.propose_change(&TokenChange::Admin(holder.clone()));
    f.advance(MIN_DELAY);
    f.token.apply_change(&id);
    f.signed_once_by(&f.admin, "apply_change", (id,).into_val(&f.e));
    f.token.accept_admin_transfer();
    f.signed_once_by(
        &holder,
        "accept_admin_transfer",
        soroban_sdk::Vec::new(&f.e),
    );
}

#[test]
fn a_caller_other_than_the_admin_is_refused_even_when_it_signs() {
    let f = setup();
    let stranger = Address::generate(&f.e);

    refused(f.token.try_pause(&stranger), ShareTokenError::AdminRequired);
    f.token.pause(&f.admin);
    refused(
        f.token.try_unpause(&stranger),
        ShareTokenError::AdminRequired,
    );
    refused(
        f.token
            .try_set_compliance(&Address::generate(&f.e), &stranger),
        ShareTokenError::AdminRequired,
    );
    refused(
        f.token
            .try_set_identity_verifier(&Address::generate(&f.e), &stranger),
        ShareTokenError::AdminRequired,
    );
    assert!(f.token.paused());
}
