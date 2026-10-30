use soroban_sdk::xdr::ToXdr;

use super::*;
use crate::keys::Key;

const FIXTURE: &str = include_str!("../../../../fixtures/timelock-storage-keys.txt");

fn hex(env: &Env, key: Key) -> std::string::String {
    key.to_xdr(env)
        .iter()
        .map(|byte| std::format!("{byte:02x}"))
        .collect()
}

/// "TimelockOpen" or "TimelockPending(<u32>)"; panics on anything else.
fn key_named(name: &str) -> Key {
    if name == "TimelockOpen" {
        return Key::TimelockOpen;
    }
    let id = name
        .strip_prefix("TimelockPending(")
        .and_then(|rest| rest.strip_suffix(')'))
        .and_then(|digits| digits.parse::<u32>().ok());
    match id {
        Some(id) => Key::TimelockPending(id),
        None => panic!("unknown fixture key name: {name}"),
    }
}

#[test]
fn storage_keys_match_the_shared_fixture() {
    let env = Env::default();
    let lines: std::vec::Vec<(&str, &str)> = FIXTURE
        .lines()
        .filter(|l| !l.trim().is_empty() && !l.starts_with('#'))
        .map(|l| l.split_once(' ').expect("<name> <hex>"))
        .collect();
    assert!(lines.iter().any(|(n, _)| *n == "TimelockOpen"));
    assert!(lines.iter().any(|(n, _)| n.starts_with("TimelockPending(")));
    for (name, expected) in lines {
        assert_eq!(hex(&env, key_named(name)), expected, "{name}");
    }
}
