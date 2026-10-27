//! The contract spec keeps the first 1,024 bytes of each doc and drops the rest
//! without a warning, so an over-long doc loses its end, where `# Authorization`
//! sits.

use std::fs;
use std::path::Path;

const SPEC_DOC_LIMIT: usize = 1024;

/// Every entrypoint and error enum of the five contracts lives in these files.
const CONTRACT_SOURCES: [&str; 7] = [
    "contracts/async-vault/src/lib.rs",
    "contracts/async-vault/src/error.rs",
    "contracts/share-token/src/contract.rs",
    "contracts/share-token/src/error.rs",
    "contracts/nav-oracle/src/lib.rs",
    "contracts/compliance/src/lib.rs",
    "contracts/identity-verifier/src/lib.rs",
];

/// The doc of every function, enum and enum variant in `source`, joined the
/// way `soroban-sdk-macros` stores it: each line trimmed, then joined by `\n`.
fn item_docs(source: &str) -> Vec<(String, String)> {
    let mut docs = Vec::new();
    let mut block: Vec<&str> = Vec::new();
    for line in source.lines().map(str::trim) {
        if let Some(text) = line.strip_prefix("///") {
            block.push(text.trim());
            continue;
        }
        if block.is_empty() || line.is_empty() || line.starts_with("#[") {
            continue;
        }
        if let Some(item) = item_name(line) {
            docs.push((item, block.join("\n")));
        }
        block.clear();
    }
    docs
}

fn item_name(line: &str) -> Option<String> {
    if let Some((_, rest)) = line.split_once("fn ") {
        return rest.split('(').next().map(|name| format!("fn {name}"));
    }
    if let Some(rest) = line.strip_prefix("pub enum ") {
        return rest
            .split_whitespace()
            .next()
            .map(|name| format!("enum {name}"));
    }
    let (name, code) = line.split_once(" = ")?;
    let is_variant = name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        && code.trim_end_matches(',').parse::<u32>().is_ok();
    is_variant.then(|| format!("variant {name}"))
}

#[test]
fn every_contract_doc_fits_the_spec() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut too_long = Vec::new();
    for path in CONTRACT_SOURCES {
        let source = fs::read_to_string(root.join(path)).unwrap();
        let docs = item_docs(&source);
        assert!(!docs.is_empty(), "{path}: no documented item found");
        for (item, doc) in docs {
            if doc.len() > SPEC_DOC_LIMIT {
                too_long.push(format!("{path}: {item} has {} bytes", doc.len()));
            }
        }
    }
    assert!(
        too_long.is_empty(),
        "the contract spec keeps {SPEC_DOC_LIMIT} bytes of a doc:\n{}",
        too_long.join("\n")
    );
}
