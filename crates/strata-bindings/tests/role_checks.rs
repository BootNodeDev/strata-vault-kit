//! `#[only_role(caller, "<role>")]` and its siblings spell a role as a string
//! literal. This ties each literal to the role constant it must match, so a
//! misspelt one fails here instead of granting the wrong role silently.

use std::fs;
use std::path::{Path, PathBuf};

const ROLE_ATTRIBUTES: [&str; 4] = [
    "#[only_role(",
    "#[has_role(",
    "#[only_any_role(",
    "#[has_any_role(",
];

/// `.rs` files under `src`, skipping test modules: `test.rs`, `test_*.rs`,
/// and anything inside a `test/` directory.
fn production_sources(dir: &Path, sources: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        let name = path.file_name().unwrap().to_str().unwrap().to_string();
        if path.is_dir() {
            if name != "test" {
                production_sources(&path, sources);
            }
            continue;
        }
        if name == "test.rs" || name.starts_with("test_") {
            continue;
        }
        if path.extension().and_then(|ext| ext.to_str()) == Some("rs") {
            sources.push(path);
        }
    }
}

/// The first `"..."` substring on `line`, if any.
fn quoted(line: &str) -> Option<String> {
    let (_, rest) = line.split_once('"')?;
    let (value, _) = rest.split_once('"')?;
    Some(value.to_string())
}

/// The string value of every `pub const ..._ROLE: ... = ...;` declared in
/// `source`.
fn role_constants(source: &str) -> Vec<String> {
    source
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with("pub const") && line.contains("ROLE"))
        .filter_map(quoted)
        .collect()
}

#[test]
fn every_only_role_literal_matches_its_role_constant() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut mismatches = Vec::new();
    for contract in fs::read_dir(root.join("contracts")).unwrap() {
        let src = contract.unwrap().path().join("src");
        if !src.is_dir() {
            continue;
        }
        let mut sources = Vec::new();
        production_sources(&src, &mut sources);
        let roles: Vec<String> = sources
            .iter()
            .flat_map(|path| role_constants(&fs::read_to_string(path).unwrap()))
            .collect();
        for path in &sources {
            let source = fs::read_to_string(path).unwrap();
            for (number, line) in source.lines().enumerate() {
                let line = line.trim();
                if !ROLE_ATTRIBUTES.iter().any(|attr| line.starts_with(attr)) {
                    continue;
                }
                let Some(literal) = quoted(line) else {
                    continue;
                };
                if !roles.contains(&literal) {
                    mismatches.push(format!(
                        "{}:{}: \"{literal}\" matches none of this contract's role constants",
                        path.display(),
                        number + 1
                    ));
                }
            }
        }
    }
    assert!(
        mismatches.is_empty(),
        "role checks must match the role constants:\n{}",
        mismatches.join("\n")
    );
}
