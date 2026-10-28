extern crate std;

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    testutils::{
        storage::{Instance as _, Persistent as _},
        Address as _, AuthorizedFunction, AuthorizedInvocation, Events as _, Ledger as _, MockAuth,
        MockAuthInvoke,
    },
    Address, BytesN, Env, Event as _, IntoVal, String, Symbol, Val,
};
use stellar_access::access_control::{AccessControlStorageKey, ROLE_EXTEND_AMOUNT};
use stellar_access::role_transfer::RoleTransferError;
use strata_storage::INSTANCE_EXTEND_AMOUNT;
use strata_timelock::{Clock, DAY_DURATION, MIN_DELAY};

use crate::state::{ATTESTER_ROLE, GUARDIAN_ROLE};
use crate::{
    shortens_freshness_only, ChangeApplied, ChangeProposed, ConfigSet, NavInput, NavOracleContract,
    NavOracleContractClient, OracleChange, OracleConfig, OracleError, OracleState,
    ADMIN_ACCEPT_LEDGERS,
};

const SCALE: i128 = 1_000_000_000_000_000_000;
const TWO_DAYS_IN_LEDGERS: u32 = 2 * 17_280;
/// Testnet's minimum lifetime of a new persistent entry, in ledgers.
const TESTNET_MIN_PERSISTENT_TTL: u32 = 120_960;

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

type OracleArgs = (Address, Address, Address, OracleConfig);

struct Fixture<'a> {
    e: Env,
    oracle: NavOracleContractClient<'a>,
    vault: ClockStubClient<'a>,
    admin: Address,
    attester: Address,
    guardian: Address,
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
        self.oracle.bind_vault(&self.vault.address);
        self.oracle.finish_setup();
    }

    fn propose(&self, change: OracleChange) -> u32 {
        self.oracle.propose_change(&change)
    }

    fn attest(&self, nav_per_share: i128) {
        self.oracle
            .attest(&input(&self.e, nav_per_share), &self.attester);
    }

    /// Lands an `Admin` change for `next` and returns the ledger of the offer.
    fn offer_admin(&self, next: &Address) -> u32 {
        let id = self.propose(OracleChange::Admin(next.clone()));
        self.advance(MIN_DELAY);
        self.oracle.apply_change(&id);
        self.e.ledger().sequence()
    }

    fn instance_ttl(&self) -> u32 {
        self.e.as_contract(&self.oracle.address, || {
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

    /// Signs one call to the oracle as `who` and nothing else, so the call
    /// carries that account's signature but not the admin's.
    fn sign_only_as(&self, who: &Address, fn_name: &str, args: soroban_sdk::Vec<soroban_sdk::Val>) {
        self.e.mock_auths(&[MockAuth {
            address: who,
            invoke: &MockAuthInvoke {
                contract: &self.oracle.address,
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
                        self.oracle.address.clone(),
                        Symbol::new(&self.e, fn_name),
                        args,
                    )),
                    sub_invocations: std::vec![],
                },
            )]
        );
    }
}

fn config() -> OracleConfig {
    OracleConfig {
        freshness_duration: 3_600,
        cooldown_secs: 60,
        max_up_bps: 1_000,
        max_down_bps: 1_000,
        min_answer: SCALE / 2,
        max_answer: SCALE * 100,
    }
}

fn proof(e: &Env) -> BytesN<32> {
    BytesN::from_array(e, &[7; 32])
}

fn input(e: &Env, nav_per_share: i128) -> NavInput {
    NavInput {
        nav_per_share,
        expires_at: u64::MAX,
        proof_hash: proof(e),
        proof_uri: String::from_str(e, "ipfs://strata-proof"),
    }
}

fn setup_with<'a>(register: impl FnOnce(&Env, OracleArgs) -> Address) -> Fixture<'a> {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().set_timestamp(10_000);
    let admin = Address::generate(&e);
    let attester = Address::generate(&e);
    let guardian = Address::generate(&e);
    let oracle = register(
        &e,
        (admin.clone(), attester.clone(), guardian.clone(), config()),
    );
    let vault = ClockStubClient::new(&e, &e.register(ClockStub, ()));
    vault.set(&Clock {
        delay: MIN_DELAY,
        exit_window: 0,
        paused_secs: 0,
        paused: false,
        winding_down: false,
    });
    Fixture {
        oracle: NavOracleContractClient::new(&e, &oracle),
        vault,
        admin,
        attester,
        guardian,
        e,
    }
}

fn setup<'a>() -> Fixture<'a> {
    setup_with(|e, args| e.register(NavOracleContract, args))
}

fn refused<T: core::fmt::Debug + PartialEq, E: core::fmt::Debug + PartialEq>(
    result: Result<Result<T, E>, Result<soroban_sdk::Error, soroban_sdk::InvokeError>>,
    expected: OracleError,
) {
    assert_eq!(result, Err(Ok(expected.into())));
}

#[test]
fn only_a_shorter_freshness_window_is_instant() {
    let base = config();
    let waits = [
        OracleConfig {
            freshness_duration: 7_200,
            ..config()
        },
        OracleConfig {
            cooldown_secs: 30,
            ..config()
        },
        OracleConfig {
            cooldown_secs: 120,
            ..config()
        },
        OracleConfig {
            max_up_bps: 500,
            ..config()
        },
        OracleConfig {
            max_up_bps: 2_000,
            ..config()
        },
        OracleConfig {
            max_down_bps: 500,
            ..config()
        },
        OracleConfig {
            max_down_bps: 2_000,
            ..config()
        },
        OracleConfig {
            min_answer: SCALE,
            ..config()
        },
        OracleConfig {
            min_answer: SCALE / 4,
            ..config()
        },
        OracleConfig {
            max_answer: SCALE * 50,
            ..config()
        },
        OracleConfig {
            max_answer: SCALE * 200,
            ..config()
        },
        OracleConfig {
            freshness_duration: 1_800,
            max_up_bps: 500,
            ..config()
        },
    ];

    for next in waits.iter() {
        assert!(!shortens_freshness_only(&base, next), "{next:?} waits");
    }
    assert!(shortens_freshness_only(
        &base,
        &OracleConfig {
            freshness_duration: 1_800,
            ..config()
        }
    ));
    assert!(shortens_freshness_only(&base, &base));
}

#[test]
fn a_config_that_tightens_one_field_and_loosens_another_waits() {
    let f = setup();
    f.finish();
    let mixed = OracleConfig {
        max_up_bps: 500,
        freshness_duration: 7_200,
        ..config()
    };

    refused(f.oracle.try_set_config(&mixed), OracleError::UseTimelock);
    assert_eq!(f.oracle.config(), config());
}

#[test]
fn a_shorter_freshness_window_stays_instant_after_setup() {
    let f = setup();
    f.finish();
    let shorter = OracleConfig {
        freshness_duration: 1_800,
        ..config()
    };

    f.oracle.set_config(&shorter);

    assert_eq!(f.oracle.config(), shorter);
}

#[test]
fn a_shorter_freshness_window_with_a_tighter_field_waits() {
    let f = setup();
    f.finish();
    let shorter_and_tighter = OracleConfig {
        freshness_duration: 1_800,
        max_down_bps: 500,
        ..config()
    };

    refused(
        f.oracle.try_set_config(&shorter_and_tighter),
        OracleError::UseTimelock,
    );
    assert_eq!(f.oracle.config(), config());
}

#[test]
fn a_shorter_freshness_window_with_a_looser_field_waits() {
    let f = setup();
    f.finish();
    let shorter_and_looser = OracleConfig {
        freshness_duration: 1_800,
        max_up_bps: 2_000,
        ..config()
    };

    refused(
        f.oracle.try_set_config(&shorter_and_looser),
        OracleError::UseTimelock,
    );
    assert_eq!(f.oracle.config(), config());
}

#[test]
fn a_freshness_cut_below_the_cooldown_is_refused() {
    let f = setup();
    f.finish();
    let below_the_cooldown = OracleConfig {
        freshness_duration: config().cooldown_secs - 1,
        ..config()
    };

    refused(
        f.oracle.try_set_config(&below_the_cooldown),
        OracleError::InvalidConfig,
    );
    assert_eq!(f.oracle.config(), config());
}

#[test]
fn a_tighter_cap_or_band_waits_after_setup() {
    let f = setup();
    f.finish();

    for tighter in [
        OracleConfig {
            max_down_bps: 500,
            ..config()
        },
        OracleConfig {
            cooldown_secs: 120,
            ..config()
        },
        OracleConfig {
            min_answer: SCALE,
            ..config()
        },
    ] {
        refused(f.oracle.try_set_config(&tighter), OracleError::UseTimelock);
    }
    assert_eq!(f.oracle.config(), config());
}

#[test]
fn any_config_is_instant_during_setup() {
    let f = setup();
    let loose = OracleConfig {
        freshness_duration: 7_200,
        ..config()
    };

    f.oracle.set_config(&loose);

    assert_eq!(f.oracle.config(), loose);
}

#[test]
fn a_loosened_config_lands_through_the_timelock() {
    let f = setup();
    f.finish();
    let loose = OracleConfig {
        freshness_duration: 7_200,
        ..config()
    };
    let id = f.propose(OracleChange::Config(loose.clone()));

    f.advance(MIN_DELAY - 1);
    refused(f.oracle.try_apply_change(&id), OracleError::ChangeNotReady);
    f.advance(1);
    f.oracle.apply_change(&id);

    assert_eq!(f.oracle.config(), loose);
    assert_eq!(f.oracle.pending_changes().len(), 0);
}

#[test]
fn an_invalid_config_cannot_be_proposed() {
    let f = setup();
    f.finish();
    let invalid = OracleConfig {
        freshness_duration: 0,
        ..config()
    };

    refused(
        f.oracle.try_propose_change(&OracleChange::Config(invalid)),
        OracleError::InvalidConfig,
    );
}

#[test]
fn a_config_outside_the_bounds_is_refused_when_it_applies() {
    let f = setup();
    f.finish();
    let invalid = OracleConfig {
        freshness_duration: 0,
        ..config()
    };
    // Skips the proposal's check, like a change proposed before a later
    // version narrowed the bounds.
    let id = f.e.as_contract(&f.oracle.address, || {
        strata_timelock::queue::propose::<NavOracleContract, _>(
            &f.e,
            &OracleChange::Config(invalid),
        )
        .unwrap()
    });
    f.advance(MIN_DELAY);

    refused(f.oracle.try_apply_change(&id), OracleError::InvalidConfig);
    assert_eq!(f.oracle.config(), config());
    assert_eq!(f.oracle.pending_changes().len(), 1);
}

#[test]
fn setup_is_open_until_finished_and_never_reopens() {
    let f = setup();
    assert!(f.oracle.setup_open());
    refused(f.oracle.try_finish_setup(), OracleError::VaultNotBound);

    f.finish();

    assert!(!f.oracle.setup_open());
    assert_eq!(f.oracle.vault(), Some(f.vault.address.clone()));
    refused(f.oracle.try_finish_setup(), OracleError::SetupClosed);
    refused(
        f.oracle.try_bind_vault(&Address::generate(&f.e)),
        OracleError::SetupClosed,
    );
}

#[test]
fn a_second_vault_cannot_be_bound() {
    let f = setup();
    f.oracle.bind_vault(&f.vault.address);

    refused(
        f.oracle.try_bind_vault(&Address::generate(&f.e)),
        OracleError::SetupClosed,
    );
    assert_eq!(f.oracle.vault(), Some(f.vault.address.clone()));
}

#[test]
fn an_address_that_reports_no_clock_cannot_be_bound() {
    let f = setup();

    assert!(f.oracle.try_bind_vault(&Address::generate(&f.e)).is_err());
    assert_eq!(f.oracle.vault(), None);
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
    assert!(f.oracle.try_bind_vault(&f.vault.address).is_err());
    assert_eq!(f.oracle.vault(), None);

    f.e.mock_all_auths();
    f.oracle.bind_vault(&f.vault.address);
    f.sign_only_as(&stranger, "finish_setup", soroban_sdk::Vec::new(&f.e));
    assert!(f.oracle.try_finish_setup().is_err());
    assert!(f.oracle.setup_open());
}

fn implements_the_vault_view<T: strata_bindings::VaultBinding>() {}

#[test]
fn the_oracle_answers_the_view_the_vault_reads() {
    implements_the_vault_view::<NavOracleContract>();
    let f = setup();
    let view = strata_bindings::VaultBindingClient::new(&f.e, &f.oracle.address);
    assert_eq!(view.vault(), None);
    assert!(view.setup_open());

    f.finish();

    assert_eq!(view.vault(), Some(f.vault.address.clone()));
    assert!(!view.setup_open());
}

#[test]
fn setup_cannot_finish_while_a_hand_over_is_pending() {
    let f = setup();
    let next = Address::generate(&f.e);
    f.oracle.bind_vault(&f.vault.address);
    f.oracle
        .transfer_admin_role(&next, &(f.e.ledger().sequence() + 100));

    refused(
        f.oracle.try_finish_setup(),
        OracleError::AdminTransferPending,
    );

    f.oracle.transfer_admin_role(&next, &0);
    f.oracle.finish_setup();
    assert!(f.oracle.try_accept_admin_transfer().is_err());
    assert_eq!(f.oracle.get_admin(), Some(f.admin.clone()));
}

#[test]
fn an_expired_hand_over_does_not_hold_setup_open() {
    let f = setup();
    f.oracle.bind_vault(&f.vault.address);
    f.oracle
        .transfer_admin_role(&Address::generate(&f.e), &(f.e.ledger().sequence() + 10));
    f.e.ledger().with_mut(|l| l.sequence_number += 11);

    f.oracle.finish_setup();

    assert!(!f.oracle.setup_open());
    assert_eq!(
        f.oracle.try_accept_admin_transfer(),
        Err(Ok(RoleTransferError::NoPendingTransfer.into()))
    );
    assert_eq!(f.oracle.get_admin(), Some(f.admin.clone()));
}

#[test]
fn nothing_is_proposed_during_setup() {
    let f = setup();

    refused(
        f.oracle.try_propose_change(&OracleChange::Config(config())),
        OracleError::SetupOpen,
    );
    assert_eq!(f.oracle.pending_changes().len(), 0);
}

#[test]
fn grants_wait_after_setup_and_land_through_the_timelock() {
    let f = setup();
    f.finish();
    let next = Address::generate(&f.e);

    refused(
        f.oracle.try_grant_role(&next, &GUARDIAN_ROLE, &f.admin),
        OracleError::UseTimelock,
    );

    let grant = f.propose(OracleChange::GrantRole(GUARDIAN_ROLE, next.clone()));
    f.advance(MIN_DELAY);
    f.oracle.apply_change(&grant);

    f.oracle.pause_nav(&next);
    assert_eq!(f.oracle.state(), OracleState::Paused);
}

#[test]
fn revoking_an_attester_or_a_guardian_stays_instant_after_setup() {
    let f = setup();
    f.finish();

    f.oracle.revoke_role(&f.attester, &ATTESTER_ROLE, &f.admin);
    f.oracle.revoke_role(&f.guardian, &GUARDIAN_ROLE, &f.admin);

    assert!(f.oracle.has_role(&f.attester, &ATTESTER_ROLE).is_none());
    assert!(f.oracle.has_role(&f.guardian, &GUARDIAN_ROLE).is_none());
    assert!(f
        .oracle
        .try_attest(&input(&f.e, SCALE), &f.attester)
        .is_err());
    assert!(f.oracle.try_pause_nav(&f.guardian).is_err());
}

#[test]
fn only_the_admin_revokes_a_role() {
    let f = setup();
    f.finish();
    let stranger = Address::generate(&f.e);

    assert!(f
        .oracle
        .try_revoke_role(&f.attester, &ATTESTER_ROLE, &stranger)
        .is_err());
    f.e.set_auths(&[]);
    assert!(f
        .oracle
        .try_revoke_role(&f.attester, &ATTESTER_ROLE, &f.admin)
        .is_err());
    assert!(f.oracle.has_role(&f.attester, &ATTESTER_ROLE).is_some());
}

#[test]
fn a_revoke_lands_through_the_timelock() {
    let f = setup();
    f.finish();

    let id = f.propose(OracleChange::RevokeRole(GUARDIAN_ROLE, f.guardian.clone()));
    f.advance(MIN_DELAY);
    f.oracle.apply_change(&id);

    assert!(f.oracle.has_role(&f.guardian, &GUARDIAN_ROLE).is_none());
}

#[test]
fn no_role_ever_gets_a_role_admin() {
    let f = setup();

    refused(
        f.oracle.try_set_role_admin(&GUARDIAN_ROLE, &ATTESTER_ROLE),
        OracleError::UseTimelock,
    );
}

#[test]
fn an_admin_hand_over_waits_but_cancelling_one_does_not() {
    let f = setup();
    f.finish();
    let next = Address::generate(&f.e);

    refused(
        f.oracle
            .try_transfer_admin_role(&next, &(f.e.ledger().sequence() + 100)),
        OracleError::UseTimelock,
    );

    let id = f.propose(OracleChange::Admin(next.clone()));
    f.advance(MIN_DELAY);
    f.oracle.apply_change(&id);
    f.oracle.transfer_admin_role(&next, &0);

    assert!(f.oracle.try_accept_admin_transfer().is_err());
    assert_eq!(f.oracle.get_admin(), Some(f.admin.clone()));
}

#[test]
fn an_applied_admin_change_starts_a_hand_over_the_next_admin_accepts() {
    let f = setup();
    f.finish();
    let next = Address::generate(&f.e);
    let id = f.propose(OracleChange::Admin(next.clone()));
    f.advance(MIN_DELAY);

    // One admin signature covers the call; the hand-over inside asks for none.
    f.sign_only_as(&f.admin, "apply_change", (id,).into_val(&f.e));
    f.oracle.apply_change(&id);

    f.e.mock_all_auths();
    assert_eq!(f.oracle.get_admin(), Some(f.admin.clone()));
    f.oracle.accept_admin_transfer();
    assert_eq!(f.oracle.get_admin(), Some(next));
}

#[test]
fn the_hand_over_offer_is_open_on_its_last_ledger() {
    let f = setup();
    f.finish();
    let next = Address::generate(&f.e);
    let offered_at = f.offer_admin(&next);

    f.e.ledger()
        .with_mut(|l| l.sequence_number = offered_at + ADMIN_ACCEPT_LEDGERS);
    f.oracle.accept_admin_transfer();

    assert_eq!(f.oracle.get_admin(), Some(next));
}

#[test]
fn the_hand_over_offer_lasts_seven_days_of_ledgers() {
    let f = setup();
    f.finish();
    let offered_at = f.offer_admin(&Address::generate(&f.e));

    f.e.ledger()
        .with_mut(|l| l.sequence_number = offered_at + ADMIN_ACCEPT_LEDGERS + 1);

    assert_eq!(
        f.oracle.try_accept_admin_transfer(),
        Err(Ok(RoleTransferError::NoPendingTransfer.into()))
    );
    assert_eq!(f.oracle.get_admin(), Some(f.admin.clone()));
}

#[test]
fn the_nav_pause_and_clearing_stay_instant_after_setup() {
    let f = setup();
    f.attest(SCALE);
    f.finish();

    f.oracle.pause_nav(&f.guardian);
    f.oracle.set_nav_paused(&false);
    f.oracle.set_nav_paused(&true);
    f.oracle.clear_latest();

    assert_eq!(f.oracle.state(), OracleState::Paused);
    assert_eq!(
        f.oracle.try_latest().err(),
        Some(Ok(OracleError::NoRecord.into()))
    );
}

#[test]
fn a_vault_pause_moves_the_eta_and_holds_the_change() {
    let f = setup();
    f.finish();
    let id = f.propose(OracleChange::Config(OracleConfig {
        freshness_duration: 7_200,
        ..config()
    }));
    let eta = f.oracle.pending_changes().get(0).unwrap().eta;

    f.advance(DAY_DURATION);
    f.clock(|c| c.paused = true);
    f.advance(3 * DAY_DURATION);
    f.clock(|c| c.paused_secs = 3 * DAY_DURATION);
    f.advance(MIN_DELAY - 4 * DAY_DURATION);

    refused(f.oracle.try_apply_change(&id), OracleError::VaultPaused);

    f.clock(|c| c.paused = false);
    assert_eq!(
        f.oracle.pending_changes().get(0).unwrap().eta,
        eta + 3 * DAY_DURATION
    );
    refused(f.oracle.try_apply_change(&id), OracleError::ChangeNotReady);

    f.advance(3 * DAY_DURATION);
    f.oracle.apply_change(&id);
    assert_eq!(f.oracle.config().freshness_duration, 7_200);
}

#[test]
fn nothing_is_proposed_or_applied_while_the_vault_winds_down() {
    let f = setup();
    f.finish();
    let id = f.propose(OracleChange::GrantRole(
        GUARDIAN_ROLE,
        Address::generate(&f.e),
    ));
    f.clock(|c| c.winding_down = true);
    f.advance(MIN_DELAY);

    refused(
        f.oracle.try_propose_change(&OracleChange::Config(config())),
        OracleError::WindDownActive,
    );
    refused(f.oracle.try_apply_change(&id), OracleError::WindDownActive);
    f.oracle.cancel_change(&id);
}

#[test]
fn an_admin_hand_over_cannot_be_accepted_while_the_vault_winds_down() {
    let f = setup();
    f.finish();
    let next = Address::generate(&f.e);
    f.offer_admin(&next);
    f.clock(|c| c.winding_down = true);

    refused(
        f.oracle.try_accept_admin_transfer(),
        OracleError::WindDownActive,
    );
    assert_eq!(f.oracle.get_admin(), Some(f.admin.clone()));
}

#[test]
fn a_change_shorter_than_a_raised_notice_never_lands() {
    let f = setup();
    f.finish();
    let id = f.propose(OracleChange::GrantRole(
        GUARDIAN_ROLE,
        Address::generate(&f.e),
    ));
    f.clock(|c| {
        c.delay = 30 * DAY_DURATION;
        c.exit_window = 20 * DAY_DURATION;
    });
    f.advance(30 * DAY_DURATION);

    refused(
        f.oracle.try_apply_change(&id),
        OracleError::DelayBelowNotice,
    );
}

#[test]
fn one_upgrade_waits_at_a_time() {
    let f = setup();
    f.finish();
    f.propose(OracleChange::Upgrade(BytesN::from_array(&f.e, &[7; 32])));

    refused(
        f.oracle
            .try_propose_change(&OracleChange::Upgrade(BytesN::from_array(&f.e, &[9; 32]))),
        OracleError::UpgradeAlreadyPending,
    );
}

#[test]
fn only_the_admin_proposes_cancels_and_applies() {
    let f = setup();
    f.finish();
    let stranger = Address::generate(&f.e);
    let change = OracleChange::Config(config());
    let id = f.propose(change.clone());
    f.advance(MIN_DELAY);

    f.sign_only_as(
        &stranger,
        "propose_change",
        (change.clone(),).into_val(&f.e),
    );
    assert!(f.oracle.try_propose_change(&change).is_err());
    f.sign_only_as(&stranger, "cancel_change", (id,).into_val(&f.e));
    assert!(f.oracle.try_cancel_change(&id).is_err());
    f.sign_only_as(&stranger, "apply_change", (id,).into_val(&f.e));
    assert!(f.oracle.try_apply_change(&id).is_err());
    assert_eq!(f.oracle.pending_changes().len(), 1);
}

#[test]
fn proposing_and_applying_publish_the_change() {
    let f = setup();
    f.finish();
    let loose = OracleConfig {
        freshness_duration: 7_200,
        ..config()
    };
    let change = OracleChange::Config(loose.clone());
    let eta = f.e.ledger().timestamp() + MIN_DELAY;

    let id = f.propose(change.clone());
    assert_eq!(
        f.e.events().all().filter_by_contract(&f.oracle.address),
        [ChangeProposed {
            id,
            change: change.clone(),
            eta,
        }
        .to_xdr(&f.e, &f.oracle.address)]
    );

    f.advance(MIN_DELAY);
    f.oracle.apply_change(&id);
    assert_eq!(
        f.e.events().all().filter_by_contract(&f.oracle.address),
        [
            ConfigSet {
                freshness_duration: loose.freshness_duration,
                cooldown_secs: loose.cooldown_secs,
                max_up_bps: loose.max_up_bps,
                max_down_bps: loose.max_down_bps,
                min_answer: loose.min_answer,
                max_answer: loose.max_answer,
            }
            .to_xdr(&f.e, &f.oracle.address),
            ChangeApplied { id, change }.to_xdr(&f.e, &f.oracle.address),
        ]
    );
}

#[test]
fn proposing_reads_the_vault_clock_once() {
    let f = setup();
    f.finish();
    let before = f.vault.reads();

    f.propose(OracleChange::Config(config()));

    assert_eq!(f.vault.reads(), before + 1);
}

#[test]
fn a_proposal_after_a_past_pause_waits_one_delay_from_now() {
    let f = setup();
    f.finish();
    f.clock(|c| c.paused_secs = 3 * DAY_DURATION);
    let change = OracleChange::Config(config());
    let eta = f.e.ledger().timestamp() + MIN_DELAY;

    let id = f.propose(change.clone());

    assert_eq!(
        f.e.events().all().filter_by_contract(&f.oracle.address),
        [ChangeProposed { id, change, eta }.to_xdr(&f.e, &f.oracle.address)]
    );
    assert_eq!(f.oracle.pending_changes().get(0).unwrap().eta, eta);
}

#[test]
fn the_schema_version_is_one_after_construction() {
    let f = setup();

    assert_eq!(f.oracle.schema_version(), 1);
}

#[test]
fn setup_grants_hand_overs_and_changes_restore_the_instance_ttl() {
    let f = setup();
    let holder = Address::generate(&f.e);
    let next = Address::generate(&f.e);

    f.restores_the_instance(|| f.oracle.grant_role(&holder, &GUARDIAN_ROLE, &f.admin));
    f.restores_the_instance(|| {
        f.oracle
            .transfer_admin_role(&next, &(f.e.ledger().sequence() + ADMIN_ACCEPT_LEDGERS))
    });
    f.restores_the_instance(|| f.oracle.transfer_admin_role(&next, &0));
    f.restores_the_instance(|| f.oracle.bind_vault(&f.vault.address));
    f.restores_the_instance(|| f.oracle.finish_setup());

    let change = OracleChange::Config(config());
    let mut id = 0;
    f.restores_the_instance(|| id = f.propose(change.clone()));
    f.restores_the_instance(|| f.oracle.cancel_change(&id));

    let id = f.propose(change);
    f.advance(MIN_DELAY);
    f.restores_the_instance(|| f.oracle.apply_change(&id));
}

/// Mirrors OpenZeppelin's private member-list key: same variant and fields, same encoding.
#[contracttype]
struct RoleAccountKey {
    role: Symbol,
    index: u32,
}

#[contracttype]
enum RoleMemberKey {
    RoleAccounts(RoleAccountKey),
}

impl Fixture<'_> {
    fn persistent_ttl<K: IntoVal<Env, Val>>(&self, key: &K) -> u32 {
        self.e.as_contract(&self.oracle.address, || {
            self.e.storage().persistent().get_ttl(key)
        })
    }

    /// Every entry a grant writes: the role, its member-list slot, the member count, the role list.
    fn role_entry_ttls(&self, account: &Address, role: &Symbol) -> [u32; 4] {
        let has_role = AccessControlStorageKey::HasRole(account.clone(), role.clone());
        let index: u32 = self.e.as_contract(&self.oracle.address, || {
            self.e.storage().persistent().get(&has_role).unwrap()
        });
        [
            self.persistent_ttl(&has_role),
            self.persistent_ttl(&RoleMemberKey::RoleAccounts(RoleAccountKey {
                role: role.clone(),
                index,
            })),
            self.persistent_ttl(&AccessControlStorageKey::RoleAccountsCount(role.clone())),
            self.persistent_ttl(&AccessControlStorageKey::ExistingRoles),
        ]
    }
}

fn testnet_minimum(e: &Env) {
    e.ledger()
        .set_min_persistent_entry_ttl(TESTNET_MIN_PERSISTENT_TTL);
}

#[test]
fn the_constructor_writes_each_role_with_the_full_ttl() {
    let f = setup_with(|e, args| {
        testnet_minimum(e);
        e.register(NavOracleContract, args)
    });

    assert_eq!(
        f.role_entry_ttls(&f.attester, &ATTESTER_ROLE),
        [ROLE_EXTEND_AMOUNT; 4]
    );
    assert_eq!(
        f.role_entry_ttls(&f.guardian, &GUARDIAN_ROLE),
        [ROLE_EXTEND_AMOUNT; 4]
    );
}

#[test]
fn a_grant_during_setup_writes_the_role_with_the_full_ttl() {
    let f = setup();
    let next = Address::generate(&f.e);
    testnet_minimum(&f.e);

    f.oracle.grant_role(&next, &GUARDIAN_ROLE, &f.admin);

    assert_eq!(
        f.role_entry_ttls(&next, &GUARDIAN_ROLE),
        [ROLE_EXTEND_AMOUNT; 4]
    );
}

#[test]
fn a_grant_through_the_timelock_writes_the_role_with_the_full_ttl() {
    let f = setup();
    f.finish();
    let next = Address::generate(&f.e);
    let id = f.propose(OracleChange::GrantRole(GUARDIAN_ROLE, next.clone()));
    f.advance(MIN_DELAY);
    testnet_minimum(&f.e);

    f.oracle.apply_change(&id);

    assert_eq!(
        f.role_entry_ttls(&next, &GUARDIAN_ROLE),
        [ROLE_EXTEND_AMOUNT; 4]
    );
}

#[test]
fn each_admin_call_asks_the_admin_for_one_signature() {
    let f = setup();
    let holder = Address::generate(&f.e);
    let live_until = f.e.ledger().sequence() + ADMIN_ACCEPT_LEDGERS;

    f.oracle.set_config(&config());
    f.signed_once_by(&f.admin, "set_config", (config(),).into_val(&f.e));
    f.oracle.grant_role(&holder, &ATTESTER_ROLE, &f.admin);
    f.signed_once_by(
        &f.admin,
        "grant_role",
        (holder.clone(), ATTESTER_ROLE, f.admin.clone()).into_val(&f.e),
    );
    f.oracle.revoke_role(&holder, &ATTESTER_ROLE, &f.admin);
    f.signed_once_by(
        &f.admin,
        "revoke_role",
        (holder.clone(), ATTESTER_ROLE, f.admin.clone()).into_val(&f.e),
    );
    f.oracle.transfer_admin_role(&holder, &live_until);
    f.signed_once_by(
        &f.admin,
        "transfer_admin_role",
        (holder.clone(), live_until).into_val(&f.e),
    );
    f.oracle.transfer_admin_role(&holder, &0);
    f.signed_once_by(
        &f.admin,
        "transfer_admin_role",
        (holder.clone(), 0_u32).into_val(&f.e),
    );

    f.oracle.bind_vault(&f.vault.address);
    f.signed_once_by(
        &f.admin,
        "bind_vault",
        (f.vault.address.clone(),).into_val(&f.e),
    );
    f.oracle.finish_setup();
    f.signed_once_by(&f.admin, "finish_setup", soroban_sdk::Vec::new(&f.e));

    let change = OracleChange::Config(config());
    let id = f.oracle.propose_change(&change);
    f.signed_once_by(&f.admin, "propose_change", (change.clone(),).into_val(&f.e));
    f.oracle.cancel_change(&id);
    f.signed_once_by(&f.admin, "cancel_change", (id,).into_val(&f.e));
    let id = f.oracle.propose_change(&change);
    f.advance(MIN_DELAY);
    f.oracle.apply_change(&id);
    f.signed_once_by(&f.admin, "apply_change", (id,).into_val(&f.e));

    f.oracle.pause_nav(&f.guardian);
    f.oracle.clear_latest();
    f.signed_once_by(&f.admin, "clear_latest", soroban_sdk::Vec::new(&f.e));
    f.oracle.set_nav_paused(&false);
    f.signed_once_by(&f.admin, "set_nav_paused", (false,).into_val(&f.e));
}

#[test]
fn each_role_call_asks_its_holder_for_one_signature() {
    let f = setup();
    let next = Address::generate(&f.e);

    f.oracle.attest(&input(&f.e, SCALE), &f.attester);
    f.signed_once_by(
        &f.attester,
        "attest",
        (input(&f.e, SCALE), f.attester.clone()).into_val(&f.e),
    );
    f.oracle.pause_nav(&f.guardian);
    f.signed_once_by(
        &f.guardian,
        "pause_nav",
        (f.guardian.clone(),).into_val(&f.e),
    );
    f.oracle.renounce_role(&ATTESTER_ROLE, &f.attester);
    f.signed_once_by(
        &f.attester,
        "renounce_role",
        (ATTESTER_ROLE, f.attester.clone()).into_val(&f.e),
    );

    f.oracle
        .transfer_admin_role(&next, &(f.e.ledger().sequence() + ADMIN_ACCEPT_LEDGERS));
    f.oracle.accept_admin_transfer();
    f.signed_once_by(&next, "accept_admin_transfer", soroban_sdk::Vec::new(&f.e));
}

#[cfg(feature = "upgrade_wasm")]
mod with_wasm {
    use soroban_sdk::xdr::{ContractEventBody, ScError, ScErrorCode, ScErrorType, ScSymbol, ScVal};

    use super::*;

    mod oracle_v1 {
        soroban_sdk::contractimport!(file = "../../target/wasm32v1-none/release/nav_oracle.wasm");
    }

    mod oracle_probe {
        soroban_sdk::contractimport!(
            file = "../../target/upgrade-probe/wasm32v1-none/release/nav_oracle.wasm"
        );
    }

    /// What a caller sees when the host refuses a call: every host error is
    /// narrowed to this one.
    fn host_refusal() -> soroban_sdk::Error {
        soroban_sdk::Error::from_type_and_code(ScErrorType::Context, ScErrorCode::InvalidAction)
    }

    /// Whether the host refused a call to `function` because the contract
    /// exports no function of that name. The reason is only in the
    /// diagnostic events.
    fn exports_no(e: &Env, function: &str) -> bool {
        let missing = ScVal::Error(ScError::WasmVm(ScErrorCode::MissingValue));
        let name = ScVal::Symbol(ScSymbol(function.try_into().unwrap()));
        e.host()
            .get_diagnostic_events()
            .unwrap()
            .0
            .iter()
            .any(|event| {
                let ContractEventBody::V0(body) = &event.event.body;
                body.topics.contains(&missing)
                    && matches!(&body.data, ScVal::Vec(Some(args)) if args.contains(&name))
            })
    }

    #[test]
    fn the_oracle_exposes_no_immediate_upgrade() {
        let f = setup_with(|e, args| e.register(oracle_v1::WASM, args));
        let probe_hash = f.e.deployer().upload_contract_wasm(oracle_probe::WASM);
        let upgrader =
            stellar_contract_utils::upgradeable::UpgradeableClient::new(&f.e, &f.oracle.address);

        assert_eq!(
            upgrader.try_upgrade(&probe_hash, &f.admin),
            Err(Ok(host_refusal()))
        );
        assert!(exports_no(&f.e, "upgrade"));
        assert_eq!(
            oracle_probe::Client::new(&f.e, &f.oracle.address).try_probe(),
            Err(Ok(host_refusal()))
        );
        assert!(exports_no(&f.e, "probe"));
        assert_eq!(f.oracle.schema_version(), 1);
    }

    #[test]
    fn the_oracle_upgrades_under_a_live_valuation() {
        let f = setup_with(|e, args| e.register(oracle_v1::WASM, args));
        f.attest(SCALE);
        f.finish();
        let probe_hash = f.e.deployer().upload_contract_wasm(oracle_probe::WASM);
        let id = f.propose(OracleChange::Upgrade(probe_hash));
        f.advance(MIN_DELAY);

        f.oracle.apply_change(&id);

        let probe = oracle_probe::Client::new(&f.e, &f.oracle.address);
        assert!(probe.probe());
        assert_eq!(probe.schema_version(), 1);
        probe.migrate();
        assert_eq!(probe.schema_version(), 2);
        assert_eq!(
            probe.try_migrate(),
            Err(Ok(oracle_probe::ProbeError::AlreadyMigrated.into()))
        );

        let kept = f.oracle.latest();
        assert_eq!(
            (kept.nav_per_share, kept.accepted_at, kept.expires_at),
            (SCALE, 10_000, 10_000 + config().freshness_duration)
        );
        assert_eq!(kept.proof_hash, proof(&f.e));
        assert_eq!(f.oracle.config(), config());
        assert_eq!(f.oracle.get_admin(), Some(f.admin.clone()));
        assert_eq!(f.oracle.vault(), Some(f.vault.address.clone()));
        assert!(!f.oracle.setup_open());
        assert_eq!(f.oracle.pending_changes().len(), 0);

        f.attest(SCALE + SCALE / 20);
        assert_eq!(f.oracle.nav_per_share(), SCALE + SCALE / 20);
        f.oracle.pause_nav(&f.guardian);
        assert_eq!(f.oracle.state(), OracleState::Paused);
    }
}
