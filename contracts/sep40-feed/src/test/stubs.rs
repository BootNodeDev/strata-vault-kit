//! Plays the vault, its oracle and its tokens: each stub answers what a test
//! sets and panics in whichever of its views a test names.

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol, Vec};
use strata_bindings::{OracleFeed, OracleState, VaultView, WindDownInfo};
use strata_timelock::{Clock, ClockSource};

fn trapped_views(e: &Env) -> Vec<Symbol> {
    e.storage()
        .instance()
        .get(&symbol_short!("trap"))
        .unwrap_or(Vec::new(e))
}

fn remember_trap(e: &Env, view: Symbol) {
    let mut views = trapped_views(e);
    views.push_back(view);
    e.storage().instance().set(&symbol_short!("trap"), &views);
}

fn trap_if_named(e: &Env, view: Symbol) {
    if trapped_views(e).contains(&view) {
        panic!("the stub traps");
    }
}

#[contract]
pub(crate) struct VaultStub;

#[contractimpl]
impl VaultStub {
    pub fn set_views(e: Env, asset: Address, share_token: Address, oracle: Address) {
        e.storage().instance().set(&symbol_short!("asset"), &asset);
        e.storage()
            .instance()
            .set(&symbol_short!("share"), &share_token);
        e.storage()
            .instance()
            .set(&symbol_short!("oracle"), &oracle);
    }

    pub fn set_oracle(e: Env, oracle: Address) {
        e.storage()
            .instance()
            .set(&symbol_short!("oracle"), &oracle);
    }

    pub fn set_wind_down(e: Env, wind_down: Option<WindDownInfo>) {
        e.storage()
            .instance()
            .set(&symbol_short!("wind"), &wind_down);
    }

    pub fn set_governance(e: Env, governance: Option<Address>) {
        e.storage()
            .instance()
            .set(&symbol_short!("gov"), &governance);
    }

    pub fn set_clock(e: Env, clock: Clock) {
        e.storage().instance().set(&symbol_short!("clock"), &clock);
    }

    pub fn trap(e: Env, view: Symbol) {
        remember_trap(&e, view);
    }
}

#[contractimpl(contracttrait)]
impl VaultView for VaultStub {
    fn asset(e: &Env) -> Address {
        trap_if_named(e, Symbol::new(e, "asset"));
        e.storage().instance().get(&symbol_short!("asset")).unwrap()
    }

    fn share_token(e: &Env) -> Address {
        trap_if_named(e, Symbol::new(e, "share_token"));
        e.storage().instance().get(&symbol_short!("share")).unwrap()
    }

    fn oracle(e: &Env) -> Address {
        trap_if_named(e, Symbol::new(e, "oracle"));
        e.storage()
            .instance()
            .get(&symbol_short!("oracle"))
            .unwrap()
    }

    fn wind_down(e: &Env) -> Option<WindDownInfo> {
        trap_if_named(e, Symbol::new(e, "wind_down"));
        e.storage()
            .instance()
            .get(&symbol_short!("wind"))
            .unwrap_or(None)
    }

    fn governance(e: &Env) -> Option<Address> {
        trap_if_named(e, Symbol::new(e, "governance"));
        e.storage()
            .instance()
            .get(&symbol_short!("gov"))
            .unwrap_or(None)
    }
}

#[contractimpl(contracttrait)]
impl ClockSource for VaultStub {
    fn timelock_clock(e: &Env) -> Clock {
        trap_if_named(e, Symbol::new(e, "timelock_clock"));
        e.storage().instance().get(&symbol_short!("clock")).unwrap()
    }
}

/// What the oracle stub answers through `OracleFeed`, read and written as one.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct StubReport {
    pub state: OracleState,
    pub nav_per_share: i128,
    pub attested_at: u64,
    pub freshness_duration: u64,
}

#[contract]
pub(crate) struct OracleStub;

#[contractimpl]
impl OracleStub {
    pub fn set_report(e: Env, report: StubReport) {
        e.storage()
            .instance()
            .set(&symbol_short!("report"), &report);
    }

    pub fn trap(e: Env, view: Symbol) {
        remember_trap(&e, view);
    }
}

fn report(e: &Env) -> StubReport {
    e.storage()
        .instance()
        .get(&symbol_short!("report"))
        .unwrap()
}

#[contractimpl(contracttrait)]
impl OracleFeed for OracleStub {
    fn state(e: &Env) -> OracleState {
        trap_if_named(e, Symbol::new(e, "state"));
        report(e).state
    }

    fn nav_per_share(e: &Env) -> i128 {
        trap_if_named(e, Symbol::new(e, "nav_per_share"));
        report(e).nav_per_share
    }

    fn attested_at(e: &Env) -> u64 {
        trap_if_named(e, Symbol::new(e, "attested_at"));
        report(e).attested_at
    }

    fn freshness_duration(e: &Env) -> u64 {
        trap_if_named(e, Symbol::new(e, "freshness_duration"));
        report(e).freshness_duration
    }
}

#[contract]
pub(crate) struct TokenStub;

#[contractimpl]
impl TokenStub {
    pub fn __constructor(e: Env, decimals: u32) {
        e.storage().instance().set(&symbol_short!("dec"), &decimals);
    }

    pub fn decimals(e: Env) -> u32 {
        if e.storage()
            .instance()
            .get(&symbol_short!("trap"))
            .unwrap_or(false)
        {
            panic!("the stub traps");
        }
        e.storage().instance().get(&symbol_short!("dec")).unwrap()
    }

    pub fn trap(e: Env) {
        e.storage().instance().set(&symbol_short!("trap"), &true);
    }
}
