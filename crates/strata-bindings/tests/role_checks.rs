//! `#[only_role(caller, "<role>")]` and its siblings spell a role as a string
//! literal. This ties each literal to the role constant it must match, so a
//! misspelt one fails here instead of granting the wrong role silently.

use std::fs;
use std::path::{Path, PathBuf};

const ROLE_ATTRIBUTE_NAMES: [&str; 4] = ["only_role", "has_role", "only_any_role", "has_any_role"];

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

/// The first `"..."` substring in `text`, if any.
fn quoted(text: &str) -> Option<String> {
    let (_, rest) = text.split_once('"')?;
    let (value, _) = rest.split_once('"')?;
    Some(value.to_string())
}

fn is_path_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == ':'
}

/// The byte offset of the `#` that opens the attribute whose name starts at
/// `name_start`, if `name_start` is written as an attribute: `#[name(...)]`
/// or, with a path prefix, `#[some::path::name(...)]`.
fn attribute_start(source: &str, name_start: usize) -> Option<usize> {
    let prefix = &source[..name_start];
    let path_start = prefix
        .rfind(|c: char| !is_path_char(c))
        .map(|i| i + 1)
        .unwrap_or(0);
    prefix[..path_start]
        .ends_with("#[")
        .then_some(path_start - 2)
}

/// The text between the parens that open at `open` (which must point at
/// `(`), and the byte offset just past the matching close. Parens inside a
/// string literal do not count.
fn matching_parens(source: &str, open: usize) -> Option<(&str, usize)> {
    let mut depth = 0i32;
    let mut in_string = false;
    for (offset, ch) in source[open..].char_indices() {
        match ch {
            '"' => in_string = !in_string,
            '(' if !in_string => depth += 1,
            ')' if !in_string => {
                depth -= 1;
                if depth == 0 {
                    return Some((&source[open + 1..open + offset], open + offset + 1));
                }
            }
            _ => {}
        }
    }
    None
}

fn line_number(source: &str, byte_offset: usize) -> usize {
    source[..byte_offset].matches('\n').count() + 1
}

/// Every role-attribute call in `source` — `#[only_role(...)]` and its
/// siblings, spanning one line or several, with or without a path prefix
/// such as `stellar_macros::only_role(...)` — as (line, name, argument
/// text). A plain function or method call of the same name (not written as
/// an attribute) is not a match.
fn role_attribute_calls(source: &str) -> Vec<(usize, &'static str, String)> {
    let mut calls = Vec::new();
    for name in ROLE_ATTRIBUTE_NAMES {
        let mut from = 0;
        while let Some(rel) = source[from..].find(name) {
            let start = from + rel;
            let after = start + name.len();
            from = after;
            if !source[after..].starts_with('(') {
                continue;
            }
            let boundary_ok = match source[..start].chars().next_back() {
                Some(c) => !(c.is_ascii_alphanumeric() || c == '_'),
                None => true,
            };
            if !boundary_ok {
                continue;
            }
            let Some(attr_start) = attribute_start(source, start) else {
                continue;
            };
            let Some((args, _end)) = matching_parens(source, after) else {
                continue;
            };
            calls.push((line_number(source, attr_start), name, args.to_string()));
        }
    }
    calls
}

/// The string value of every `const ..._ROLE: ... = ...;` declared in
/// `source`, `pub` or not.
fn role_constants(source: &str) -> Vec<String> {
    source
        .lines()
        .map(str::trim)
        .map(|line| line.strip_prefix("pub ").unwrap_or(line))
        .filter(|line| line.starts_with("const") && line.contains("ROLE"))
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
            for (line, name, args) in role_attribute_calls(&source) {
                match quoted(&args) {
                    Some(literal) if roles.contains(&literal) => {}
                    Some(literal) => mismatches.push(format!(
                        "{}:{line}: \"{literal}\" matches none of this contract's role constants",
                        path.display()
                    )),
                    None => mismatches.push(format!(
                        "{}:{line}: {name}(...) carries no role literal",
                        path.display()
                    )),
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

/// A refactor that drops a role check silently should fail here instead.
#[test]
fn only_role_sites_do_not_quietly_shrink() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut sites = 0;
    for contract in fs::read_dir(root.join("contracts")).unwrap() {
        let src = contract.unwrap().path().join("src");
        if !src.is_dir() {
            continue;
        }
        let mut sources = Vec::new();
        production_sources(&src, &mut sources);
        for path in &sources {
            let source = fs::read_to_string(path).unwrap();
            sites += role_attribute_calls(&source)
                .iter()
                .filter(|(_, name, _)| *name == "only_role")
                .count();
        }
    }
    assert!(sites >= 12, "found only {sites} #[only_role] sites");
}

#[test]
fn role_attribute_calls_spans_lines_and_paths() {
    let fixture = concat!(
        "#[only_role(\n",
        "    caller,\n",
        "    \"treasury\"\n",
        ")]\n",
        "fn deploy() {}\n",
        "\n",
        "#[stellar_macros::only_role(caller, \"guardian\")]\n",
        "fn pause() {}\n",
        "\n",
        "fn not_an_attribute() {\n",
        "    access_control::has_role(e, caller, &MANAGER_ROLE)\n",
        "}\n",
    );
    let literals: Vec<String> = role_attribute_calls(fixture)
        .iter()
        .map(|(_, _, args)| quoted(args).unwrap())
        .collect();
    assert_eq!(
        literals,
        vec!["treasury".to_string(), "guardian".to_string()]
    );
}
