use super::*;
use crate::Health;

fn all_healthy() -> Health {
    Health {
        setup_open: false,
        token_bound: true,
        oracle_bound: true,
        sole_token_manager: true,
        allowlisted: true,
        vault_unfrozen: true,
        compliance_bound: true,
        feed_valid: true,
        freshness_covers_notice: true,
    }
}

#[test]
fn a_finished_vault_with_a_fresh_report_is_healthy() {
    let f = setup();
    f.attest(wad(1));

    assert_eq!(f.vault.health(), all_healthy());
}

#[test]
fn an_open_setup_is_reported() {
    let f = setup_unfinished();
    f.attest(wad(1));

    assert_eq!(
        f.vault.health(),
        Health {
            setup_open: true,
            ..all_healthy()
        }
    );
}

#[test]
fn each_missing_wiring_step_shows_in_its_own_flag() {
    let cases = [
        (
            Miswire::TokenUnbound,
            Health {
                token_bound: false,
                ..all_healthy()
            },
        ),
        (
            Miswire::OracleUnbound,
            Health {
                oracle_bound: false,
                ..all_healthy()
            },
        ),
        (
            Miswire::NoManagerRole,
            Health {
                sole_token_manager: false,
                ..all_healthy()
            },
        ),
        (
            Miswire::SecondManager,
            Health {
                sole_token_manager: false,
                ..all_healthy()
            },
        ),
        (
            Miswire::NotAllowlisted,
            Health {
                allowlisted: false,
                ..all_healthy()
            },
        ),
        (
            Miswire::VaultFrozen,
            Health {
                vault_unfrozen: false,
                ..all_healthy()
            },
        ),
        (
            Miswire::ComplianceUnbound,
            Health {
                compliance_bound: false,
                ..all_healthy()
            },
        ),
    ];
    for (miswire, expected) in cases {
        let f = miswired(miswire);
        f.attest(wad(1));

        assert_eq!(
            f.vault.health(),
            Health {
                setup_open: true,
                ..expected
            }
        );
    }
}

#[test]
fn a_feed_with_no_report_or_the_nav_paused_is_not_valid() {
    let f = setup();
    assert!(!f.vault.health().feed_valid);

    f.attest(wad(1));
    f.oracle.pause_nav(&f.guardian);
    assert!(!f.vault.health().feed_valid);
}

#[test]
fn a_notice_longer_than_a_report_lives_is_reported() {
    let f = setup();
    f.attest(wad(1));
    let freshness = f.oracle.config().freshness_duration;

    f.vault.set_notice(&(freshness + 1), &f.admin);

    assert!(!f.vault.health().freshness_covers_notice);
}
