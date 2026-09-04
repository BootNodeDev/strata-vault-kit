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
}

fn config() -> OracleConfig {
    OracleConfig {
        freshness_duration: 3600,
        cooldown_secs: 60,
        max_deviation_bps: 1_000, // 10%
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
    let cfg = config();
    let addr = e.register(NavOracleContract, (admin.clone(), attester.clone(), cfg));

    Fixture {
        oracle: NavOracleContractClient::new(&e, &addr),
        admin,
        attester,
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
        max_deviation_bps: 100,
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
