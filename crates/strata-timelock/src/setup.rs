//! The window after deployment in which wiring is instant and no change is
//! queued. It closes once and never reopens.

use soroban_sdk::{Address, Env};

use crate::clock::{ClockSourceClient, TimelockHost};
use crate::keys::Key;
use crate::refusal::Refusal;

pub fn is_open(e: &Env) -> bool {
    !strata_storage::get_instance::<_, bool>(e, &Key::TimelockSetupDone).unwrap_or(false)
}

/// The clock source this contract is bound to.
pub fn source(e: &Env) -> Option<Address> {
    strata_storage::get_instance(e, &Key::TimelockSource)
}

/// Binds this contract to a clock source, once and only during setup.
pub fn bind_source(e: &Env, source: &Address) -> Result<(), Refusal> {
    if !is_open(e) {
        return Err(Refusal::SetupClosed);
    }
    if self::source(e).is_some() {
        return Err(Refusal::AlreadyBound);
    }
    // An address that does not answer as a clock source fails the call here.
    ClockSourceClient::new(e, source).timelock_clock();
    strata_storage::set_instance(e, &Key::TimelockSource, source);
    Ok(())
}

/// Closes the window for good, once the host can read its clock.
pub fn finish<H: TimelockHost>(e: &Env) -> Result<(), Refusal> {
    if !is_open(e) {
        return Err(Refusal::SetupClosed);
    }
    H::clock(e)?;
    strata_storage::set_instance(e, &Key::TimelockSetupDone, &true);
    Ok(())
}
