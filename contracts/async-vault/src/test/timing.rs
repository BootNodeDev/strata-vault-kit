use crate::error::VaultError;
use crate::timing::{FulfilmentTiming, StandardTiming};
use proptest::prelude::*;
use proptest::test_runner::TestCaseResult;

fn priceable_at_never_precedes_the_close<W: FulfilmentTiming>(
    closed_at: u64,
    notice: u64,
) -> TestCaseResult {
    prop_assert!(W::priceable_at(closed_at, notice) >= closed_at);
    Ok(())
}

fn a_longer_notice_never_prices_sooner<W: FulfilmentTiming>(
    closed_at: u64,
    shorter: u64,
    longer: u64,
) -> TestCaseResult {
    prop_assume!(shorter <= longer);
    prop_assert!(W::priceable_at(closed_at, longer) >= W::priceable_at(closed_at, shorter));
    Ok(())
}

fn a_zero_notice_prices_at_the_close<W: FulfilmentTiming>(closed_at: u64) -> TestCaseResult {
    prop_assert_eq!(W::priceable_at(closed_at, 0), closed_at);
    Ok(())
}

fn check<W: FulfilmentTiming>(
    now: u64,
    priceable_at: u64,
    closed_at: u64,
    attested_at: u64,
) -> Result<(), VaultError> {
    if !W::notice_elapsed(now, priceable_at) {
        return Err(VaultError::NoticeNotElapsed);
    }
    if !W::price_is_current(closed_at, attested_at) {
        return Err(VaultError::AttestationBeforeClose);
    }
    Ok(())
}

fn check_accepts_exactly_when_both_rules_hold<W: FulfilmentTiming>(
    now: u64,
    priceable_at: u64,
    closed_at: u64,
    attested_at: u64,
) -> TestCaseResult {
    prop_assert_eq!(
        check::<W>(now, priceable_at, closed_at, attested_at).is_ok(),
        W::notice_elapsed(now, priceable_at) && W::price_is_current(closed_at, attested_at)
    );
    Ok(())
}

fn the_notice_is_reported_before_the_price<W: FulfilmentTiming>(
    now: u64,
    priceable_at: u64,
    closed_at: u64,
    attested_at: u64,
) -> TestCaseResult {
    prop_assume!(!W::notice_elapsed(now, priceable_at));
    prop_assume!(!W::price_is_current(closed_at, attested_at));
    prop_assert_eq!(
        check::<W>(now, priceable_at, closed_at, attested_at),
        Err(VaultError::NoticeNotElapsed)
    );
    Ok(())
}

proptest! {
    #[test]
    fn standard_priceable_at_never_precedes_the_close(c: u64, n: u64) {
        priceable_at_never_precedes_the_close::<StandardTiming>(c, n)?;
    }

    #[test]
    fn standard_a_longer_notice_never_prices_sooner(c: u64, a: u64, b: u64) {
        a_longer_notice_never_prices_sooner::<StandardTiming>(c, a, b)?;
    }

    #[test]
    fn standard_a_zero_notice_prices_at_the_close(c: u64) {
        a_zero_notice_prices_at_the_close::<StandardTiming>(c)?;
    }

    #[test]
    fn standard_check_accepts_exactly_when_both_rules_hold(
        now: u64, p: u64, c: u64, a: u64
    ) {
        check_accepts_exactly_when_both_rules_hold::<StandardTiming>(now, p, c, a)?;
    }

    #[test]
    fn standard_the_notice_is_reported_before_the_price(
        now: u64, p: u64, c: u64, a: u64
    ) {
        the_notice_is_reported_before_the_price::<StandardTiming>(now, p, c, a)?;
    }
}

#[test]
fn an_attestation_in_the_closing_ledger_counts() {
    assert!(StandardTiming::price_is_current(1_000, 1_000));
}

#[test]
fn an_attestation_before_the_close_does_not() {
    assert!(!StandardTiming::price_is_current(1_000, 999));
}

#[test]
fn the_notice_ends_on_its_last_second() {
    assert!(StandardTiming::notice_elapsed(1_060, 1_060));
    assert!(!StandardTiming::notice_elapsed(1_059, 1_060));
}

#[test]
fn a_notice_that_would_overflow_saturates() {
    assert_eq!(StandardTiming::priceable_at(u64::MAX, 1), u64::MAX);
}
