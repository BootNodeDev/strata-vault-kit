extern crate std;

use soroban_sdk::{
    symbol_short,
    testutils::{
        storage::Persistent as _, Address as _, Events as _, Ledger as _, MockAuth, MockAuthInvoke,
    },
    Address, BytesN, Env, Event as _, IntoVal, String,
};

use crate::state::DataKey;
use crate::{NavInput, NavOracleContract, NavOracleContractClient, OracleConfig, OracleState};

const SCALE: i128 = 1_000_000_000_000_000_000;
const DAY_IN_LEDGERS: u32 = 17_280;

struct Fixture<'a> {
    #[allow(dead_code)]
    e: Env,
    oracle: NavOracleContractClient<'a>,
    admin: Address,
    attester: Address,
    guardian: Address,
}

impl Fixture<'_> {
    /// Signs one call to the oracle as `who` and nothing else.
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
}

fn config() -> OracleConfig {
    OracleConfig {
        freshness_duration: 3600,
        cooldown_secs: 60,
        max_up_bps: 1_000,
        max_down_bps: 1_000, // 10%
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

fn proof(e: &Env) -> BytesN<32> {
    BytesN::from_array(e, &[7; 32])
}

fn input(e: &Env, nav: i128, expires_at: u64) -> NavInput {
    NavInput {
        nav_per_share: nav,
        expires_at,
        proof_hash: proof(e),
        proof_uri: String::from_str(e, "ipfs://strata-proof"),
    }
}

#[test]
fn attest_then_valid_and_consumable() {
    let f = setup();
    // No record yet: stale, not consumable.
    assert_eq!(f.oracle.state(), OracleState::Stale);
    assert!(f.oracle.is_stale());

    let r = input(&f.e, SCALE, 1_000_000);
    f.oracle.attest(&r, &f.attester);

    assert_eq!(f.oracle.state(), OracleState::Valid);
    assert_eq!(f.oracle.nav_per_share(), SCALE);
    f.oracle.ensure_consumable(); // must not panic
}

#[test]
fn heartbeat_expiry_makes_it_stale() {
    let f = setup();
    let r = input(&f.e, SCALE, 1_000_000);
    f.oracle.attest(&r, &f.attester);
    assert_eq!(f.oracle.state(), OracleState::Valid);

    // Advance past heartbeat (3600s from obs stamp 10_000).
    f.e.ledger().set_timestamp(10_000 + 3601);
    assert_eq!(f.oracle.state(), OracleState::Stale);
    assert!(f.oracle.try_ensure_consumable().is_err());
}

#[test]
fn the_nav_pause_holds_regardless_of_freshness() {
    let f = setup();
    let r = input(&f.e, SCALE, 1_000_000);
    f.oracle.attest(&r, &f.attester);
    assert_eq!(f.oracle.state(), OracleState::Valid);

    f.oracle.set_nav_paused(&true);
    assert_eq!(f.oracle.state(), OracleState::Paused);
    assert!(f.oracle.try_ensure_consumable().is_err());

    f.oracle.set_nav_paused(&false);
    assert_eq!(f.oracle.state(), OracleState::Valid);
}

#[test]
fn attest_rejects_out_of_band() {
    let f = setup();
    // Below min_answer.
    let r = input(&f.e, SCALE / 4, 1_000_000);
    assert!(f.oracle.try_attest(&r, &f.attester).is_err());
    // Zero is out of band (min_answer > 0).
    let r0 = input(&f.e, 0, 1_000_000);
    assert!(f.oracle.try_attest(&r0, &f.attester).is_err());
}

#[test]
fn attest_enforces_cooldown_and_deviation() {
    let f = setup();
    let r1 = input(&f.e, SCALE, 1_000_000);
    f.oracle.attest(&r1, &f.attester);

    // Cooldown: only 30s later (< 60), reject.
    f.e.ledger().set_timestamp(10_030);
    let r2 = input(&f.e, SCALE, 1_000_000);
    assert!(f.oracle.try_attest(&r2, &f.attester).is_err());

    // Past cooldown now.
    f.e.ledger().set_timestamp(10_100);
    // Deviation: +20% exceeds the 10% cap.
    let big = input(&f.e, SCALE + SCALE / 5, 1_000_000);
    assert!(f.oracle.try_attest(&big, &f.attester).is_err());

    // Valid update: +5% within cap.
    let ok = input(&f.e, SCALE + SCALE / 20, 1_000_000);
    f.oracle.attest(&ok, &f.attester);
    assert_eq!(f.oracle.nav_per_share(), SCALE + SCALE / 20);
}

/// The contract stamps ledger time and derives `expires_at` from its own
/// freshness window.
#[test]
fn attest_stamps_its_own_timestamp() {
    let f = setup();
    let r = input(&f.e, SCALE, 1_000_000);
    f.oracle.attest(&r, &f.attester);

    let stored = f.oracle.latest();
    assert_eq!(stored.accepted_at, 10_000);
    assert_eq!(stored.expires_at, 10_000 + 3600);
}

#[test]
fn attesting_publishes_the_stored_valuation() {
    let f = setup();
    f.oracle.attest(&input(&f.e, SCALE, 1_000_000), &f.attester);

    assert_eq!(
        f.e.events().all().filter_by_contract(&f.oracle.address),
        [crate::NavAttested {
            attester: f.attester.clone(),
            nav_per_share: SCALE,
            expires_at: 10_000 + 3600,
            proof_hash: proof(&f.e),
            proof_uri: String::from_str(&f.e, "ipfs://strata-proof"),
        }
        .to_xdr(&f.e, &f.oracle.address)]
    );
}

#[test]
fn the_latest_valuation_keeps_a_full_ttl_while_it_is_read() {
    let f = setup();
    f.oracle.attest(&input(&f.e, SCALE, 1_000_000), &f.attester);

    f.e.ledger()
        .with_mut(|l| l.sequence_number += 2 * DAY_IN_LEDGERS);
    let decayed = f.e.as_contract(&f.oracle.address, || {
        f.e.storage().persistent().get_ttl(&DataKey::Latest)
    });
    assert!(decayed < strata_storage::PERSISTENT_EXTEND_AMOUNT);

    f.oracle.latest();

    let restored = f.e.as_contract(&f.oracle.address, || {
        f.e.storage().persistent().get_ttl(&DataKey::Latest)
    });
    assert_eq!(restored, strata_storage::PERSISTENT_EXTEND_AMOUNT);
}

#[test]
fn set_config_takes_effect() {
    let f = setup();
    let r1 = input(&f.e, SCALE, 1_000_000);
    f.oracle.attest(&r1, &f.attester);

    // Tighten the per-attestation deviation band to 1%; a subsequent +5% move
    // that the original 10% band would admit is now rejected.
    let tight = OracleConfig {
        max_up_bps: 100,
        max_down_bps: 100,
        ..config()
    };
    f.oracle.set_config(&tight);

    f.e.ledger().set_timestamp(10_100);
    let five_pct = input(&f.e, SCALE + SCALE / 20, 1_000_000);
    assert!(
        f.oracle.try_attest(&five_pct, &f.attester).is_err(),
        "the tightened band rejects a +5% move"
    );
}

#[test]
fn attest_is_role_gated() {
    let f = setup();
    let stranger = Address::generate(&f.e);
    let r = input(&f.e, SCALE, 1_000_000);
    assert!(f.oracle.try_attest(&r, &stranger).is_err());
}

#[test]
fn narrowing_the_band_demotes_a_stored_record() {
    let f = setup();
    let r = input(&f.e, SCALE, 1_000_000);
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
        max_down_bps: 10_001,
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
fn only_admin_can_set_config() {
    let f = setup();
    let cfg = config();

    f.e.set_auths(&[]);
    assert!(f.oracle.try_set_config(&cfg).is_err());

    f.e.mock_all_auths();
    f.oracle.set_config(&cfg);
}

#[test]
fn the_guardian_pauses_the_nav_but_unpausing_needs_governance() {
    let f = setup();
    let r = input(&f.e, SCALE, 1_000_000);
    f.oracle.attest(&r, &f.attester);
    assert_eq!(f.oracle.state(), OracleState::Valid);

    f.oracle.pause_nav(&f.guardian);
    assert_eq!(f.oracle.state(), OracleState::Paused);

    f.sign_only_as(&f.guardian, "set_nav_paused", (false,).into_val(&f.e));
    assert!(f.oracle.try_set_nav_paused(&false).is_err());
    f.e.set_auths(&[]);
    assert!(f.oracle.try_set_nav_paused(&false).is_err());
    assert_eq!(f.oracle.state(), OracleState::Paused);

    f.e.mock_all_auths();
    f.oracle.set_nav_paused(&false);
    assert_eq!(f.oracle.state(), OracleState::Valid);
}

#[test]
fn pausing_the_nav_is_limited_to_the_guardian() {
    let f = setup();
    let stranger = Address::generate(&f.e);

    assert!(f.oracle.try_pause_nav(&stranger).is_err());
    assert!(f.oracle.try_pause_nav(&f.attester).is_err());
    assert!(f.oracle.try_pause_nav(&f.admin).is_err());
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
fn a_full_downside_cap_lets_a_large_loss_land_at_once() {
    let mut cfg = config();
    cfg.max_down_bps = 10_000;
    let f = setup_with(cfg);

    f.oracle.attest(&input(&f.e, SCALE, 1_000_000), &f.attester);
    f.e.ledger().set_timestamp(10_100);

    // A 40% fall, far past the 10% upward cap, is admitted at once.
    let crash = input(&f.e, SCALE * 60 / 100, 1_000_000);
    f.oracle.attest(&crash, &f.attester);
    assert_eq!(f.oracle.nav_per_share(), SCALE * 60 / 100);
}

#[test]
fn a_full_downside_cap_still_bounds_a_rise() {
    let mut cfg = config();
    cfg.max_down_bps = 10_000;
    let f = setup_with(cfg);

    f.oracle.attest(&input(&f.e, SCALE, 1_000_000), &f.attester);
    f.e.ledger().set_timestamp(10_100);

    let spike = input(&f.e, SCALE * 140 / 100, 1_000_000);
    assert!(f.oracle.try_attest(&spike, &f.attester).is_err());
}

#[test]
fn a_configured_downside_still_bounds_a_fall() {
    let f = setup();

    f.oracle.attest(&input(&f.e, SCALE, 1_000_000), &f.attester);
    f.e.ledger().set_timestamp(10_100);

    let crash = input(&f.e, SCALE * 60 / 100, 1_000_000);
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
fn the_record_clears_only_while_the_nav_is_paused() {
    let f = setup();
    f.oracle.attest(&input(&f.e, SCALE, 1_000_000), &f.attester);

    assert!(f.oracle.try_clear_latest().is_err());

    f.oracle.pause_nav(&f.guardian);
    f.oracle.clear_latest();

    // With no stored record, one in-band value lands however far it sits.
    f.oracle.set_nav_paused(&false);
    f.e.ledger().set_timestamp(10_100);
    let far = input(&f.e, SCALE * 50, 1_000_000);
    f.oracle.attest(&far, &f.attester);
    assert_eq!(f.oracle.nav_per_share(), SCALE * 50);
}

#[test]
fn only_admin_can_clear_latest() {
    let f = setup();
    let stranger = Address::generate(&f.e);
    let r = input(&f.e, SCALE, 1_000_000);
    f.oracle.attest(&r, &f.attester);
    f.oracle.pause_nav(&f.guardian);

    for who in [&stranger, &f.attester, &f.guardian] {
        f.sign_only_as(who, "clear_latest", soroban_sdk::Vec::new(&f.e));
        assert!(f.oracle.try_clear_latest().is_err());
    }
}

#[test]
fn every_oracle_authority_is_readable_and_rotatable() {
    let f = setup();
    let next = Address::generate(&f.e);

    assert_eq!(f.oracle.get_admin(), Some(f.admin.clone()));
    assert_eq!(
        f.oracle.get_role_member(&symbol_short!("attester"), &0),
        f.attester
    );

    f.oracle
        .grant_role(&next, &symbol_short!("guardian"), &f.admin);
    f.oracle
        .revoke_role(&f.guardian, &symbol_short!("guardian"), &f.admin);

    assert!(f.oracle.try_pause_nav(&f.guardian).is_err());
    f.oracle.pause_nav(&next);
}

#[test]
fn the_oracle_admin_cannot_renounce_itself_away() {
    let f = setup();
    assert!(f.oracle.try_renounce_admin().is_err());
    assert_eq!(f.oracle.get_admin(), Some(f.admin.clone()));
}

/// With the downward cap at 100%, `min_answer` is all that bounds one fall.
#[test]
fn a_full_downside_cap_leaves_min_answer_as_the_only_floor() {
    let mut cfg = config();
    cfg.max_down_bps = 10_000;
    let f = setup_with(cfg);

    f.oracle.attest(&input(&f.e, SCALE, 1_000_000), &f.attester);
    f.e.ledger().set_timestamp(10_100);

    // Straight to the floor in one step, whatever the distance.
    let floor = config().min_answer;
    f.oracle.attest(&input(&f.e, floor, 1_000_000), &f.attester);
    assert_eq!(f.oracle.nav_per_share(), floor);

    // Below the floor is refused, so min_answer is the only bound.
    f.e.ledger().set_timestamp(10_200);
    assert!(f
        .oracle
        .try_attest(&input(&f.e, floor - 1, 1_000_000), &f.attester)
        .is_err());
}

#[test]
fn a_floor_below_a_millionth_of_an_asset_unit_per_share_is_refused() {
    let f = setup();
    assert_eq!(crate::MIN_ANSWER, 1_000_000_000_000);
    assert_eq!(
        f.oracle
            .try_set_config(&OracleConfig {
                min_answer: crate::MIN_ANSWER - 1,
                ..config()
            })
            .err(),
        Some(Ok(crate::OracleError::InvalidConfig.into())),
    );
    f.oracle.set_config(&OracleConfig {
        min_answer: crate::MIN_ANSWER,
        ..config()
    });
}

#[test]
fn a_stored_floor_below_the_minimum_stays_until_a_config_change_raises_it() {
    let f = setup();
    let old = OracleConfig {
        min_answer: 1,
        ..config()
    };
    f.e.as_contract(&f.oracle.address, || crate::state::set_config(&f.e, &old));

    assert_eq!(f.oracle.config(), old);
    assert_eq!(
        f.oracle.try_set_config(&old).err(),
        Some(Ok(crate::OracleError::InvalidConfig.into())),
    );
    f.oracle.set_config(&OracleConfig {
        min_answer: crate::MIN_ANSWER,
        ..old
    });
}

#[test]
fn attested_at_is_when_the_contract_took_the_report() {
    let f = setup();
    f.e.ledger().set_timestamp(50_000);

    f.oracle.attest(&input(&f.e, SCALE, 1_000_000), &f.attester);

    assert_eq!(f.oracle.attested_at(), 50_000);
}

#[test]
fn attested_at_without_a_report_is_refused() {
    let f = setup();

    assert!(f.oracle.try_attested_at().is_err());
}

#[test]
fn a_reporter_expiry_inside_the_window_is_kept() {
    let f = setup();
    f.oracle
        .attest(&input(&f.e, SCALE, 10_000 + 600), &f.attester);

    assert_eq!(f.oracle.latest().expires_at, 10_000 + 600);
    f.e.ledger().set_timestamp(10_000 + 601);
    assert_eq!(f.oracle.state(), OracleState::Stale);
}

#[test]
fn a_reporter_expiry_past_the_window_is_cut_to_the_window() {
    let f = setup();
    f.oracle
        .attest(&input(&f.e, SCALE, 10_000 + 10_000), &f.attester);

    assert_eq!(f.oracle.latest().expires_at, 10_000 + 3600);
}

#[test]
fn attesting_is_refused_while_the_nav_is_paused() {
    let f = setup();
    f.oracle.pause_nav(&f.guardian);

    assert_eq!(
        f.oracle
            .try_attest(&input(&f.e, SCALE, 1_000_000), &f.attester)
            .err(),
        Some(Ok(crate::OracleError::NavPaused.into()))
    );

    f.oracle.set_nav_paused(&false);
    f.oracle.attest(&input(&f.e, SCALE, 1_000_000), &f.attester);
    assert_eq!(f.oracle.state(), OracleState::Valid);
}

#[test]
fn two_reports_in_one_ledger_are_refused_at_the_shortest_cooldown() {
    let mut cfg = config();
    cfg.cooldown_secs = crate::MIN_COOLDOWN_SECS;
    let f = setup_with(cfg);
    f.oracle.attest(&input(&f.e, SCALE, 1_000_000), &f.attester);

    assert_eq!(
        f.oracle
            .try_attest(&input(&f.e, SCALE, 1_000_000), &f.attester)
            .err(),
        Some(Ok(crate::OracleError::CooldownActive.into()))
    );

    f.e.ledger()
        .set_timestamp(10_000 + crate::MIN_COOLDOWN_SECS);
    f.oracle.attest(&input(&f.e, SCALE, 1_000_000), &f.attester);
}

fn refuses_config(cfg: OracleConfig) {
    let f = setup();
    assert_eq!(
        f.oracle.try_set_config(&cfg).err(),
        Some(Ok(crate::OracleError::InvalidConfig.into()))
    );
}

#[test]
fn a_zero_cooldown_is_refused() {
    refuses_config(OracleConfig {
        cooldown_secs: 0,
        ..config()
    });
}

#[test]
fn a_freshness_window_past_the_maximum_is_refused() {
    refuses_config(OracleConfig {
        freshness_duration: crate::MAX_FRESHNESS_SECS + 1,
        ..config()
    });
}

#[test]
fn a_max_answer_past_the_ceiling_is_refused() {
    refuses_config(OracleConfig {
        max_answer: crate::MAX_ANSWER + 1,
        ..config()
    });
}

/// A new report must always be able to replace the last one before the
/// freshness window ends, or the feed would sit stale through every cooldown.
#[test]
fn a_cooldown_longer_than_the_freshness_window_is_refused() {
    refuses_config(OracleConfig {
        cooldown_secs: 3_601,
        ..config()
    });
}

#[test]
fn a_zero_downside_cap_is_refused() {
    refuses_config(OracleConfig {
        max_down_bps: 0,
        ..config()
    });
}

#[test]
fn the_bounds_themselves_are_accepted() {
    let f = setup();
    f.oracle.set_config(&OracleConfig {
        freshness_duration: crate::MAX_FRESHNESS_SECS,
        cooldown_secs: crate::MIN_COOLDOWN_SECS,
        max_up_bps: 10_000,
        max_down_bps: 10_000,
        min_answer: crate::MIN_ANSWER,
        max_answer: crate::MAX_ANSWER,
    });
}

fn implements_the_feed<T: strata_bindings::OracleFeed>() {}

#[test]
fn the_oracle_answers_the_feed_interface_the_vault_reads() {
    implements_the_feed::<NavOracleContract>();
    let f = setup();
    f.oracle.attest(&input(&f.e, SCALE, 1_000_000), &f.attester);

    let feed = strata_bindings::OracleFeedClient::new(&f.e, &f.oracle.address);

    assert_eq!(feed.state(), OracleState::Valid);
    assert_eq!(feed.nav_per_share(), SCALE);
    assert_eq!(feed.attested_at(), 10_000);
    assert_eq!(feed.freshness_duration(), 3600);
}

#[test]
fn a_missing_config_is_refused_by_name() {
    let f = setup();
    f.e.as_contract(&f.oracle.address, || {
        f.e.storage().instance().remove(&DataKey::Config)
    });

    assert_eq!(
        f.oracle.try_config(),
        Err(Ok(crate::OracleError::NotInitialized.into()))
    );
}

mod proof_reference {
    use soroban_sdk::contracttype;
    use soroban_sdk::xdr::{ScErrorCode, ScErrorType};

    use super::*;
    use crate::{OracleError, MAX_PROOF_URI_LEN};

    #[test]
    fn the_latest_report_carries_its_proof() {
        let f = setup();

        f.oracle.attest(&input(&f.e, SCALE, 1_000_000), &f.attester);

        let latest = f.oracle.latest();
        assert_eq!(latest.proof_hash, proof(&f.e));
        assert_eq!(
            latest.proof_uri,
            String::from_str(&f.e, "ipfs://strata-proof")
        );
    }

    #[test]
    fn a_report_without_a_proof_hash_is_refused() {
        let f = setup();
        let mut unproven = input(&f.e, SCALE, 1_000_000);
        unproven.proof_hash = BytesN::from_array(&f.e, &[0; 32]);

        assert_eq!(
            f.oracle.try_attest(&unproven, &f.attester).err(),
            Some(Ok(OracleError::EmptyProofHash.into())),
        );
    }

    #[test]
    fn a_proof_uri_past_the_limit_is_refused() {
        let f = setup();
        let mut long = input(&f.e, SCALE, 1_000_000);
        long.proof_uri = String::from_bytes(&f.e, &[b'x'; (MAX_PROOF_URI_LEN + 1) as usize]);

        assert_eq!(
            f.oracle.try_attest(&long, &f.attester).err(),
            Some(Ok(OracleError::ProofUriTooLong.into())),
        );
    }

    #[test]
    fn a_proof_uri_at_the_limit_is_stored_and_published() {
        let f = setup();
        let mut longest = input(&f.e, SCALE, 1_000_000);
        longest.proof_uri = String::from_bytes(&f.e, &[b'x'; MAX_PROOF_URI_LEN as usize]);

        f.oracle.attest(&longest, &f.attester);

        assert_eq!(
            f.e.events().all().filter_by_contract(&f.oracle.address),
            [crate::NavAttested {
                attester: f.attester.clone(),
                nav_per_share: SCALE,
                expires_at: 10_000 + 3600,
                proof_hash: proof(&f.e),
                proof_uri: longest.proof_uri.clone(),
            }
            .to_xdr(&f.e, &f.oracle.address)]
        );
        assert_eq!(f.oracle.latest().proof_uri, longest.proof_uri);
    }

    #[test]
    fn a_hash_without_a_uri_is_enough() {
        let f = setup();
        let mut bare = input(&f.e, SCALE, 1_000_000);
        bare.proof_uri = String::from_str(&f.e, "");

        f.oracle.attest(&bare, &f.attester);

        assert_eq!(f.oracle.latest().proof_uri.len(), 0);
    }

    /// The report as earlier releases stored it: same fields, same encoding.
    #[contracttype]
    struct EarlierNavReport {
        nav_per_share: i128,
        expires_at: u64,
        timestamp: u64,
    }

    /// What a caller sees when the host cannot run a call, such as one that
    /// reads an entry it cannot decode. A contract error carries its own code.
    fn host_refusal() -> soroban_sdk::Error {
        soroban_sdk::Error::from_type_and_code(ScErrorType::Context, ScErrorCode::InvalidAction)
    }

    #[test]
    fn a_report_of_the_earlier_shape_is_cleared_and_replaced() {
        let f = setup();
        f.e.as_contract(&f.oracle.address, || {
            f.e.storage().persistent().set(
                &DataKey::Latest,
                &EarlierNavReport {
                    nav_per_share: SCALE,
                    expires_at: 10_000 + 3600,
                    timestamp: 10_000,
                },
            )
        });
        // Past the cooldown and inside the cap: only the old entry can refuse it.
        f.e.ledger().set_timestamp(10_100);
        let next = input(&f.e, SCALE + SCALE / 20, 1_000_000);

        assert_eq!(f.oracle.try_latest().err(), Some(Ok(host_refusal())));
        assert_eq!(f.oracle.try_state().err(), Some(Ok(host_refusal())));
        assert_eq!(
            f.oracle.try_attest(&next, &f.attester).err(),
            Some(Ok(host_refusal()))
        );

        f.oracle.pause_nav(&f.guardian);
        assert_eq!(f.oracle.state(), OracleState::Paused);
        f.oracle.clear_latest();
        f.oracle.set_nav_paused(&false);
        f.oracle.attest(&next, &f.attester);

        let latest = f.oracle.latest();
        assert_eq!(latest.nav_per_share, SCALE + SCALE / 20);
        assert_eq!(latest.accepted_at, 10_100);
        assert_eq!(latest.proof_hash, proof(&f.e));
        assert_eq!(
            latest.proof_uri,
            String::from_str(&f.e, "ipfs://strata-proof")
        );
    }
}
