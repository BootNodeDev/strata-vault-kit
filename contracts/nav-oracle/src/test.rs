extern crate std;

use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, Address, Env};

use crate::{NavOracleContract, NavOracleContractClient, NavReport, OracleConfig, OracleState};

const SCALE: i128 = 1_000_000_000_000_000_000;

struct Fixture<'a> {
    #[allow(dead_code)]
    e: Env,
    oracle: NavOracleContractClient<'a>,
    admin: Address,
    attester: Address,
    guardian: Address,
}

fn config() -> OracleConfig {
    OracleConfig {
        freshness_duration: 3600,
        cooldown_secs: 60,
        max_up_bps: 1_000,
        max_down_bps: Some(1_000), // 10%
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
    let cfg = config();
    let addr = e.register(
        NavOracleContract,
        (admin.clone(), attester.clone(), guardian.clone(), cfg),
    );

    Fixture {
        oracle: NavOracleContractClient::new(&e, &addr),
        admin,
        attester,
        guardian,
        e,
    }
}

fn report(_e: &Env, nav: i128, timestamp: u64, expires_at: u64) -> NavReport {
    NavReport {
        nav_per_share: nav,
        timestamp,
        expires_at,
    }
}

#[test]
fn attest_then_valid_and_consumable() {
    let f = setup();
    // No record yet: stale, not consumable.
    assert_eq!(f.oracle.state(), OracleState::Stale);
    assert!(f.oracle.is_stale());

    let r = report(&f.e, SCALE, 1, 1_000_000);
    f.oracle.attest(&r, &f.attester);

    assert_eq!(f.oracle.state(), OracleState::Valid);
    assert_eq!(f.oracle.nav_per_share(), SCALE);
    f.oracle.ensure_consumable(); // must not panic
}

#[test]
fn heartbeat_expiry_makes_it_stale() {
    let f = setup();
    let r = report(&f.e, SCALE, 1, 1_000_000);
    f.oracle.attest(&r, &f.attester);
    assert_eq!(f.oracle.state(), OracleState::Valid);

    // Advance past heartbeat (3600s from obs stamp 10_000).
    f.e.ledger().set_timestamp(10_000 + 3601);
    assert_eq!(f.oracle.state(), OracleState::Stale);
    assert!(f.oracle.try_ensure_consumable().is_err());
}

#[test]
fn ripcord_pauses_regardless_of_freshness() {
    let f = setup();
    let r = report(&f.e, SCALE, 1, 1_000_000);
    f.oracle.attest(&r, &f.attester);
    assert_eq!(f.oracle.state(), OracleState::Valid);

    f.oracle.set_ripcord(&true, &f.admin);
    assert_eq!(f.oracle.state(), OracleState::Paused);
    assert!(f.oracle.try_ensure_consumable().is_err());

    f.oracle.set_ripcord(&false, &f.admin);
    assert_eq!(f.oracle.state(), OracleState::Valid);
}

#[test]
fn attest_rejects_out_of_band() {
    let f = setup();
    // Below min_answer.
    let r = report(&f.e, SCALE / 4, 1, 1_000_000);
    assert!(f.oracle.try_attest(&r, &f.attester).is_err());
    // Zero is out of band (min_answer > 0).
    let r0 = report(&f.e, 0, 1, 1_000_000);
    assert!(f.oracle.try_attest(&r0, &f.attester).is_err());
}

#[test]
fn attest_enforces_cooldown_and_deviation() {
    let f = setup();
    let r1 = report(&f.e, SCALE, 1, 1_000_000);
    f.oracle.attest(&r1, &f.attester);

    // Cooldown: only 30s later (< 60), reject.
    f.e.ledger().set_timestamp(10_030);
    let r2 = report(&f.e, SCALE, 2, 1_000_000);
    assert!(f.oracle.try_attest(&r2, &f.attester).is_err());

    // Past cooldown now.
    f.e.ledger().set_timestamp(10_100);
    // Deviation: +20% exceeds the 10% cap.
    let big = report(&f.e, SCALE + SCALE / 5, 2, 1_000_000);
    assert!(f.oracle.try_attest(&big, &f.attester).is_err());

    // Valid update: +5% within cap.
    let ok = report(&f.e, SCALE + SCALE / 20, 2, 1_000_000);
    f.oracle.attest(&ok, &f.attester);
    assert_eq!(f.oracle.nav_per_share(), SCALE + SCALE / 20);
}

/// The caller's `timestamp` is advisory: the contract stamps ledger time and
/// derives `expires_at` from its own freshness window.
#[test]
fn attest_stamps_its_own_timestamp() {
    let f = setup();
    let r = report(&f.e, SCALE, 1, 1_000_000);
    f.oracle.attest(&r, &f.attester);

    let stored = f.oracle.latest();
    assert_eq!(stored.timestamp, 10_000);
    assert_eq!(stored.expires_at, 10_000 + 3600);
}

#[test]
fn set_config_takes_effect() {
    let f = setup();
    let r1 = report(&f.e, SCALE, 1, 1_000_000);
    f.oracle.attest(&r1, &f.attester);

    // Tighten the per-attestation deviation band to 1%; a subsequent +5% move
    // that the original 10% band would admit is now rejected.
    let tight = OracleConfig {
        max_up_bps: 100,
        max_down_bps: Some(100),
        ..config()
    };
    f.oracle.set_config(&tight);

    f.e.ledger().set_timestamp(10_100);
    let five_pct = report(&f.e, SCALE + SCALE / 20, 2, 1_000_000);
    assert!(
        f.oracle.try_attest(&five_pct, &f.attester).is_err(),
        "the tightened band rejects a +5% move"
    );
}

#[test]
fn attest_is_role_gated() {
    let f = setup();
    let stranger = Address::generate(&f.e);
    let r = report(&f.e, SCALE, 1, 1_000_000);
    assert!(f.oracle.try_attest(&r, &stranger).is_err());
}

#[test]
fn narrowing_the_band_demotes_a_stored_record() {
    let f = setup();
    let r = report(&f.e, SCALE, 1, 1_000_000);
    f.oracle.attest(&r, &f.attester);
    assert_eq!(f.oracle.state(), OracleState::Valid);

    let narrow = OracleConfig {
        max_answer: SCALE / 2,
        ..config()
    };
    f.oracle.set_config(&narrow);

    assert_eq!(f.oracle.state(), OracleState::Stale);
    assert!(f.oracle.is_stale());
    assert!(f.oracle.try_ensure_consumable().is_err());
}

#[test]
#[should_panic(expected = "#3001")]
fn constructor_rejects_an_unbounded_max_answer() {
    let e = Env::default();
    let admin = Address::generate(&e);
    let attester = Address::generate(&e);
    let cfg = OracleConfig {
        max_answer: i128::MAX,
        ..config()
    };
    e.register(
        NavOracleContract,
        (admin, attester, Address::generate(&e), cfg),
    );
}

#[test]
#[should_panic(expected = "#3001")]
fn constructor_rejects_a_deviation_above_one_hundred_percent() {
    let e = Env::default();
    let admin = Address::generate(&e);
    let attester = Address::generate(&e);
    let cfg = OracleConfig {
        max_up_bps: 10_001,
        max_down_bps: Some(10_001),
        ..config()
    };
    e.register(
        NavOracleContract,
        (admin, attester, Address::generate(&e), cfg),
    );
}

#[test]
fn set_config_rejects_an_unbounded_max_answer() {
    let f = setup();
    let cfg = OracleConfig {
        max_answer: i128::MAX,
        ..config()
    };
    assert!(f.oracle.try_set_config(&cfg).is_err());
}

#[test]
fn set_config_rejects_a_zero_freshness_duration() {
    let f = setup();
    let cfg = OracleConfig {
        freshness_duration: 0,
        ..config()
    };
    assert!(f.oracle.try_set_config(&cfg).is_err());
}

#[test]
fn the_guardian_raises_the_ripcord_but_lowering_needs_governance() {
    let f = setup();
    let r = report(&f.e, SCALE, 1, 1_000_000);
    f.oracle.attest(&r, &f.attester);
    assert_eq!(f.oracle.state(), OracleState::Valid);

    f.oracle.raise_ripcord(&f.guardian);
    assert_eq!(f.oracle.state(), OracleState::Paused);

    f.e.set_auths(&[]);
    assert!(f.oracle.try_set_ripcord(&false, &f.guardian).is_err());
    assert!(f.oracle.try_set_ripcord(&false, &f.admin).is_err());
    assert_eq!(f.oracle.state(), OracleState::Paused);

    f.e.mock_all_auths();
    f.oracle.set_ripcord(&false, &f.admin);
    assert_eq!(f.oracle.state(), OracleState::Valid);
}

#[test]
fn raising_the_ripcord_is_limited_to_the_guardian() {
    let f = setup();
    let stranger = Address::generate(&f.e);

    assert!(f.oracle.try_raise_ripcord(&stranger).is_err());
    assert!(f.oracle.try_raise_ripcord(&f.attester).is_err());
    assert!(f.oracle.try_raise_ripcord(&f.admin).is_err());
    assert_eq!(f.oracle.state(), OracleState::Stale);
}

/// Builds the fixture with a caller-chosen cap, so both directions are testable.
fn setup_with(cfg: OracleConfig) -> Fixture<'static> {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().set_timestamp(10_000);

    let admin = Address::generate(&e);
    let attester = Address::generate(&e);
    let guardian = Address::generate(&e);
    let addr = e.register(
        NavOracleContract,
        (admin.clone(), attester.clone(), guardian.clone(), cfg),
    );

    Fixture {
        oracle: NavOracleContractClient::new(&e, &addr),
        admin,
        attester,
        guardian,
        e,
    }
}

#[test]
fn a_large_loss_lands_in_one_attestation() {
    let mut cfg = config();
    cfg.max_down_bps = None;
    let f = setup_with(cfg);

    f.oracle
        .attest(&report(&f.e, SCALE, 1, 1_000_000), &f.attester);
    f.e.ledger().set_timestamp(10_100);

    // A 40% fall, far past the 10% upward cap, is admitted at once.
    let crash = report(&f.e, SCALE * 60 / 100, 2, 1_000_000);
    f.oracle.attest(&crash, &f.attester);
    assert_eq!(f.oracle.nav_per_share(), SCALE * 60 / 100);
}

#[test]
fn an_unbounded_rise_is_still_refused() {
    let mut cfg = config();
    cfg.max_down_bps = None;
    let f = setup_with(cfg);

    f.oracle
        .attest(&report(&f.e, SCALE, 1, 1_000_000), &f.attester);
    f.e.ledger().set_timestamp(10_100);

    let spike = report(&f.e, SCALE * 140 / 100, 2, 1_000_000);
    assert!(f.oracle.try_attest(&spike, &f.attester).is_err());
}

#[test]
fn a_configured_downside_still_bounds_a_fall() {
    let f = setup();

    f.oracle
        .attest(&report(&f.e, SCALE, 1, 1_000_000), &f.attester);
    f.e.ledger().set_timestamp(10_100);

    let crash = report(&f.e, SCALE * 60 / 100, 2, 1_000_000);
    assert!(f.oracle.try_attest(&crash, &f.attester).is_err());
}

#[test]
#[should_panic(expected = "Error(Contract, #3001)")]
fn constructor_rejects_a_zero_upside_cap() {
    let e = Env::default();
    let admin = Address::generate(&e);
    let cfg = OracleConfig {
        max_up_bps: 0,
        ..config()
    };
    e.register(
        NavOracleContract,
        (admin.clone(), admin.clone(), admin, cfg),
    );
}

#[test]
fn the_record_clears_only_while_the_ripcord_is_raised() {
    let f = setup();
    f.oracle
        .attest(&report(&f.e, SCALE, 1, 1_000_000), &f.attester);

    assert!(f.oracle.try_clear_latest(&f.admin).is_err());

    f.oracle.raise_ripcord(&f.guardian);
    f.oracle.clear_latest(&f.admin);

    // With no stored record, one in-band value lands however far it sits.
    f.oracle.set_ripcord(&false, &f.admin);
    f.e.ledger().set_timestamp(10_100);
    let far = report(&f.e, SCALE * 50, 2, 1_000_000);
    f.oracle.attest(&far, &f.attester);
    assert_eq!(f.oracle.nav_per_share(), SCALE * 50);
}
