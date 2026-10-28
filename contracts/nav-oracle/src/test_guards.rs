//! Each guard passes while its condition holds and refuses with its error once
//! it does not.

use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::{Address as _, Ledger as _},
    Address, BytesN, Env, InvokeError, String,
};
use strata_timelock::{Clock, MIN_DELAY};

use crate::guards;
use crate::{
    NavInput, NavOracleContract, NavOracleContractClient, NavReport, OracleChange, OracleConfig,
    OracleError, MAX_ANSWER, MAX_FRESHNESS_SECS, MAX_PROOF_URI_LEN,
};

const SCALE: i128 = 1_000_000_000_000_000_000;

/// Plays the vault: the oracle binds only to an address that reports a clock.
#[contract]
struct VaultStub;

#[contractimpl(contracttrait)]
impl strata_timelock::ClockSource for VaultStub {
    fn timelock_clock(_e: &Env) -> Clock {
        Clock {
            delay: MIN_DELAY,
            exit_window: 0,
            paused_secs: 0,
            paused: false,
            winding_down: false,
        }
    }
}

struct Fixture<'a> {
    e: Env,
    oracle: NavOracleContractClient<'a>,
    vault: Address,
    attester: Address,
    guardian: Address,
}

impl Fixture<'_> {
    fn finish_setup(&self) {
        self.oracle.bind_vault(&self.vault);
        self.oracle.finish_setup();
    }

    fn attest(&self, nav_per_share: i128) {
        self.oracle.attest(
            &NavInput {
                nav_per_share,
                expires_at: u64::MAX,
                proof_hash: proof(&self.e),
                proof_uri: String::from_str(&self.e, "ipfs://strata-proof"),
            },
            &self.attester,
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

fn setup<'a>() -> Fixture<'a> {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().set_timestamp(10_000);
    let admin = Address::generate(&e);
    let attester = Address::generate(&e);
    let guardian = Address::generate(&e);
    let oracle = NavOracleContractClient::new(
        &e,
        &e.register(
            NavOracleContract,
            (admin, attester.clone(), guardian.clone(), config()),
        ),
    );
    let vault = e.register(VaultStub, ());
    Fixture {
        e,
        oracle,
        vault,
        attester,
        guardian,
    }
}

/// Runs `guard` inside the oracle, as an entrypoint would.
fn run(f: &Fixture, guard: impl FnOnce()) -> Result<(), Result<soroban_sdk::Error, InvokeError>> {
    f.e.try_as_contract::<(), soroban_sdk::Error>(&f.oracle.address, guard)
}

fn holds(f: &Fixture, guard: impl FnOnce()) {
    assert_eq!(run(f, guard), Ok(()));
}

fn refuses(f: &Fixture, error: OracleError, guard: impl FnOnce()) {
    assert_eq!(run(f, guard), Err(Ok(error.into())));
}

fn proof(e: &Env) -> BytesN<32> {
    BytesN::from_array(e, &[7; 32])
}

fn report_at(e: &Env, nav_per_share: i128, accepted_at: u64) -> NavReport {
    NavReport {
        nav_per_share,
        expires_at: u64::MAX,
        accepted_at,
        proof_hash: proof(e),
        proof_uri: String::from_str(e, "ipfs://strata-proof"),
    }
}

#[test]
fn valid_config_refuses_a_config_outside_the_bounds() {
    let f = setup();
    holds(&f, || guards::valid_config(&f.e, &config()));

    for invalid in [
        OracleConfig {
            freshness_duration: 0,
            ..config()
        },
        OracleConfig {
            freshness_duration: MAX_FRESHNESS_SECS + 1,
            ..config()
        },
        OracleConfig {
            cooldown_secs: 0,
            ..config()
        },
        OracleConfig {
            cooldown_secs: 3_601,
            ..config()
        },
        OracleConfig {
            min_answer: 0,
            ..config()
        },
        OracleConfig {
            max_answer: SCALE / 4,
            ..config()
        },
        OracleConfig {
            max_answer: MAX_ANSWER + 1,
            ..config()
        },
        OracleConfig {
            max_up_bps: 0,
            ..config()
        },
        OracleConfig {
            max_down_bps: 10_001,
            ..config()
        },
    ] {
        refuses(&f, OracleError::InvalidConfig, || {
            guards::valid_config(&f.e, &invalid)
        });
    }
}

#[test]
fn setup_open_refuses_once_setup_has_finished() {
    let f = setup();
    holds(&f, || guards::setup_open(&f.e));

    f.finish_setup();
    refuses(&f, OracleError::SetupClosed, || guards::setup_open(&f.e));
}

#[test]
fn no_hand_over_pending_refuses_while_an_offer_is_open() {
    let f = setup();
    holds(&f, || guards::no_hand_over_pending(&f.e));

    let next = Address::generate(&f.e);
    f.oracle
        .transfer_admin_role(&next, &(f.e.ledger().sequence() + 100));
    refuses(&f, OracleError::AdminTransferPending, || {
        guards::no_hand_over_pending(&f.e)
    });

    f.oracle.transfer_admin_role(&next, &0);
    holds(&f, || guards::no_hand_over_pending(&f.e));
}

#[test]
fn direct_change_allowed_refuses_after_setup() {
    let f = setup();
    holds(&f, || guards::direct_change_allowed(&f.e));

    f.finish_setup();
    refuses(&f, OracleError::UseTimelock, || {
        guards::direct_change_allowed(&f.e)
    });
}

#[test]
fn direct_hand_over_allowed_refuses_only_an_offer_after_setup() {
    let f = setup();
    holds(&f, || guards::direct_hand_over_allowed(&f.e, 100));

    f.finish_setup();
    holds(&f, || guards::direct_hand_over_allowed(&f.e, 0));
    refuses(&f, OracleError::UseTimelock, || {
        guards::direct_hand_over_allowed(&f.e, 100)
    });
}

#[test]
fn direct_config_allowed_refuses_all_but_a_shorter_window_after_setup() {
    let f = setup();
    let longer_window = OracleConfig {
        freshness_duration: 7_200,
        ..config()
    };
    let shorter_window = OracleConfig {
        freshness_duration: 1_800,
        ..config()
    };
    let tighter_cap = OracleConfig {
        max_up_bps: 500,
        ..config()
    };
    holds(&f, || guards::direct_config_allowed(&f.e, &longer_window));

    f.finish_setup();
    holds(&f, || guards::direct_config_allowed(&f.e, &config()));
    holds(&f, || guards::direct_config_allowed(&f.e, &shorter_window));
    refuses(&f, OracleError::UseTimelock, || {
        guards::direct_config_allowed(&f.e, &longer_window)
    });
    refuses(&f, OracleError::UseTimelock, || {
        guards::direct_config_allowed(&f.e, &tighter_cap)
    });
}

#[test]
fn change_in_bounds_refuses_an_invalid_config() {
    let f = setup();
    let upgrade = OracleChange::Upgrade(BytesN::from_array(&f.e, &[1; 32]));
    let grant = OracleChange::GrantRole(symbol_short!("attester"), Address::generate(&f.e));
    let unbounded = OracleChange::Config(OracleConfig {
        max_answer: MAX_ANSWER + 1,
        ..config()
    });

    holds(&f, || guards::change_in_bounds(&f.e, &upgrade));
    holds(&f, || guards::change_in_bounds(&f.e, &grant));
    holds(&f, || {
        guards::change_in_bounds(&f.e, &OracleChange::Config(config()))
    });
    refuses(&f, OracleError::InvalidConfig, || {
        guards::change_in_bounds(&f.e, &unbounded)
    });
}

#[test]
fn not_a_second_upgrade_refuses_an_upgrade_while_one_waits() {
    let f = setup();
    f.finish_setup();
    let upgrade = OracleChange::Upgrade(BytesN::from_array(&f.e, &[1; 32]));
    let grant = OracleChange::GrantRole(symbol_short!("attester"), Address::generate(&f.e));
    holds(&f, || guards::not_a_second_upgrade(&f.e, &upgrade));

    f.oracle.propose_change(&upgrade);
    refuses(&f, OracleError::UpgradeAlreadyPending, || {
        guards::not_a_second_upgrade(&f.e, &upgrade)
    });
    holds(&f, || guards::not_a_second_upgrade(&f.e, &grant));
}

#[test]
fn consumable_refuses_a_feed_that_is_not_valid() {
    let f = setup();
    refuses(&f, OracleError::NotConsumable, || guards::consumable(&f.e));

    f.attest(SCALE);
    holds(&f, || guards::consumable(&f.e));

    f.oracle.pause_nav(&f.guardian);
    refuses(&f, OracleError::NotConsumable, || guards::consumable(&f.e));
}

#[test]
fn nav_not_paused_refuses_while_the_nav_is_paused() {
    let f = setup();
    holds(&f, || guards::nav_not_paused(&f.e));

    f.oracle.pause_nav(&f.guardian);
    refuses(&f, OracleError::NavPaused, || guards::nav_not_paused(&f.e));
}

#[test]
fn nav_paused_refuses_until_the_nav_is_paused() {
    let f = setup();
    refuses(&f, OracleError::NavNotPaused, || guards::nav_paused(&f.e));

    f.oracle.pause_nav(&f.guardian);
    holds(&f, || guards::nav_paused(&f.e));
}

#[test]
fn nav_in_band_refuses_a_value_outside_the_band() {
    let f = setup();
    let cfg = config();
    holds(&f, || guards::nav_in_band(&f.e, &cfg, cfg.min_answer));
    holds(&f, || guards::nav_in_band(&f.e, &cfg, cfg.max_answer));
    refuses(&f, OracleError::NavOutOfBand, || {
        guards::nav_in_band(&f.e, &cfg, cfg.min_answer - 1)
    });
    refuses(&f, OracleError::NavOutOfBand, || {
        guards::nav_in_band(&f.e, &cfg, cfg.max_answer + 1)
    });
}

#[test]
fn expires_in_future_refuses_a_report_born_stale() {
    let f = setup();
    let now = f.e.ledger().timestamp();
    holds(&f, || guards::expires_in_future(&f.e, now + 1));
    refuses(&f, OracleError::ExpiresInPast, || {
        guards::expires_in_future(&f.e, now)
    });
}

#[test]
fn proof_hash_not_empty_refuses_an_all_zero_hash() {
    let f = setup();
    let mut last_byte_set = [0; 32];
    last_byte_set[31] = 1;
    let set = BytesN::from_array(&f.e, &last_byte_set);
    let empty = BytesN::from_array(&f.e, &[0; 32]);

    holds(&f, || guards::proof_hash_not_empty(&f.e, &set));
    refuses(&f, OracleError::EmptyProofHash, || {
        guards::proof_hash_not_empty(&f.e, &empty)
    });
}

#[test]
fn proof_uri_fits_refuses_a_uri_past_the_limit() {
    let f = setup();
    let at_limit = String::from_bytes(&f.e, &[b'x'; MAX_PROOF_URI_LEN as usize]);
    let past_it = String::from_bytes(&f.e, &[b'x'; MAX_PROOF_URI_LEN as usize + 1]);

    holds(&f, || guards::proof_uri_fits(&f.e, &at_limit));
    refuses(&f, OracleError::ProofUriTooLong, || {
        guards::proof_uri_fits(&f.e, &past_it)
    });
}

#[test]
fn cooldown_elapsed_refuses_a_report_inside_the_cooldown() {
    let f = setup();
    let cfg = config();
    let now = f.e.ledger().timestamp();
    let elapsed = report_at(&f.e, SCALE, now - cfg.cooldown_secs);
    let running = report_at(&f.e, SCALE, now - cfg.cooldown_secs + 1);

    holds(&f, || guards::cooldown_elapsed(&f.e, &cfg, &elapsed));
    refuses(&f, OracleError::CooldownActive, || {
        guards::cooldown_elapsed(&f.e, &cfg, &running)
    });
}

#[test]
fn within_deviation_refuses_a_move_past_either_cap() {
    let f = setup();
    let cfg = config();
    let last = report_at(&f.e, SCALE, 0);
    let ten_percent = SCALE / 10;

    holds(&f, || {
        guards::within_deviation(&f.e, &cfg, &last, SCALE + ten_percent)
    });
    holds(&f, || {
        guards::within_deviation(&f.e, &cfg, &last, SCALE - ten_percent)
    });
    refuses(&f, OracleError::DeviationExceeded, || {
        guards::within_deviation(&f.e, &cfg, &last, SCALE + ten_percent + 1)
    });
    refuses(&f, OracleError::DeviationExceeded, || {
        guards::within_deviation(&f.e, &cfg, &last, SCALE - ten_percent - 1)
    });
}
