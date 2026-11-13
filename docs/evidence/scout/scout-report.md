

<style>
.markdown-body table {min-width: 100%;width: 100%;display: table;}
thead {min-width: 100%;width: 100%;}
th {min-width: 60%;width: 60%;}
th:last-child {min-width: 20%;width: 20%;}
th:first-child {min-width: 20%;width: 20%;}
</style>



# Scout Report - Scoutme - 2026-11-12

## Summary

| <span style="color:green">Crate</span> | <span style="color:green">Status</span> | <span style="color:green">Critical</span> | <span style="color:green">Medium</span> | <span style="color:green">Minor</span> | <span style="color:green">Enhancement</span> | 
| - | - | - | - | - | - | 
| async_vault | Analyzed | 6 | 1 | 1 | 5 | 
| compliance | Analyzed | 0 | 1 | 0 | 1 | 
| identity_verifier | Analyzed | 0 | 0 | 0 | 1 | 
| nav_oracle | Analyzed | 2 | 1 | 0 | 1 | 
| share_token | Analyzed | 0 | 1 | 0 | 1 | 
| strata_bindings | Analyzed | 0 | 0 | 0 | 2 | 
| strata_storage | Analyzed | 0 | 0 | 0 | 1 | 
| strata_timelock | Analyzed | 1 | 1 | 0 | 1 | 


Issues found:



- [Dos Unexpected Revert With Storage](#dos-unexpected-revert-with-storage) (5 results) (Medium)

- [Integer Overflow Or Underflow](#integer-overflow-or-underflow) (9 results) (Critical)

- [Assert Violation](#assert-violation) (2 results) (Enhancement)

- [Soroban Version](#soroban-version) (12 results) (Enhancement)



## DoS



### Dos Unexpected Revert With Storage

**Impact:** Medium

**Issue:** This storage (vector or map) operation is called without access control

**Description:**  It occurs by preventing transactions by other users from being successfully executed forcing the blockchain state to revert to its original state.

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/soroban/dos-unexpected-revert-with-storage)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 4 | crates | [queue.rs:51:10 - 51:19](crates/strata-timelock/src/queue.rs) |
| 8 | contracts | [governance.rs:145:17 - 145:26](contracts/compliance/src/governance.rs) |
| 10 | contracts | [governance.rs:157:17 - 157:26](contracts/nav-oracle/src/governance.rs) |
| 14 | contracts | [governance.rs:174:17 - 174:26](contracts/share-token/src/governance.rs) |
| 17 | contracts | [governance.rs:312:17 - 312:26](contracts/async-vault/src/governance.rs) |



## Arithmetic



### Integer Overflow Or Underflow

**Impact:** Critical

**Issue:** Potential for integer arithmetic overflow/underflow. Consider checked, wrapping or saturating arithmetic.

**Description:** An overflow/underflow is typically caught and generates an error. When it is not caught, the operation will result in an inexact result which could lead to serious problems.

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/soroban/integer-overflow-or-underflow)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 5 | crates | [queue.rs:53:60 - 53:68](crates/strata-timelock/src/queue.rs) |
| 11 | contracts | [guards.rs:148:16 - 148:52](contracts/nav-oracle/src/guards.rs) |
| 12 | contracts | [guards.rs:149:17 - 149:63](contracts/nav-oracle/src/guards.rs) |
| 16 | contracts | [governance.rs:181:33 - 181:38](contracts/async-vault/src/governance.rs) |
| 18 | contracts | [lock_policy.rs:100:5 - 100:23](contracts/async-vault/src/lock_policy.rs) |
| 19 | contracts | [treasury.rs:25:5 - 25:43](contracts/async-vault/src/treasury.rs) |
| 20 | contracts | [treasury.rs:31:5 - 31:67](contracts/async-vault/src/treasury.rs) |
| 21 | contracts | [treasury.rs:38:5 - 38:46](contracts/async-vault/src/treasury.rs) |
| 22 | contracts | [wind_down.rs:188:5 - 188:18](contracts/async-vault/src/wind_down.rs) |



## Error Handling



### Assert Violation

**Impact:** Enhancement

**Issue:** Assert causes panic. Instead, return a proper error.

**Description:** Using assert! macro in production code can cause unexpected panics. This violates best practices for smart contract error handling.

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/rust/assert-violation)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 0 | crates | [errors.rs:39:9 - 42:10](crates/strata-bindings/src/errors.rs) |


### Unused Return Enum

**Impact:** Minor

**Issue:** If any of the variants (Ok/Err) is not used, the code could be simplified or it could imply a bug

**Description:** Soroban functions can return a Result enum with a custom error type. This is useful for the caller to know what went wrong when the message fails. The definition of the Result type enum consists of two variants: Ok and Err. If any of the variants is not used, the code could be simplified or it could imply a bug.    

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/soroban/unused-return-enum)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 23 | contracts | [lib.rs:1307:9 - 1307:33](contracts/async-vault/src/lib.rs) |



## Best Practices



### Soroban Version

**Impact:** Enhancement

**Issue:** Use the latest version of Soroban

**Description:** Using a older version of Soroban can be dangerous, as it may have bugs or security issues. Use the latest version available.

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/soroban/soroban-version)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 1 | crates | [lib.rs:1:1 - 1:1](crates/strata-storage/src/lib.rs) |
| 2 | crates | [lib.rs:1:1 - 1:1](crates/strata-bindings/src/lib.rs) |
| 3 | crates | [lib.rs:1:1 - 1:1](crates/strata-timelock/src/lib.rs) |
| 6 | contracts | [lib.rs:1:1 - 1:1](contracts/identity-verifier/src/lib.rs) |
| 7 | contracts | [lib.rs:1:1 - 1:1](contracts/compliance/src/lib.rs) |
| 9 | contracts | [lib.rs:1:1 - 1:1](contracts/nav-oracle/src/lib.rs) |
| 13 | contracts | [lib.rs:1:1 - 1:1](contracts/share-token/src/lib.rs) |
| 15 | contracts | [lib.rs:1:1 - 1:1](contracts/async-vault/src/lib.rs) |


### Storage Change Events

**Impact:** Enhancement

**Issue:** Consider emiting an event when storage is modified

**Description:** Emiting an event when storage changes is a good practice to make the contracts more transparent and usable to its clients and observers

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/soroban/storage-change-events)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 24 | contracts | [lib.rs:891:5 - 891:74](contracts/async-vault/src/lib.rs) |
| 25 | contracts | [lib.rs:1030:5 - 1030:73](contracts/async-vault/src/lib.rs) |
| 26 | contracts | [lib.rs:956:5 - 956:74](contracts/async-vault/src/lib.rs) |
| 27 | contracts | [lib.rs:923:5 - 923:75](contracts/async-vault/src/lib.rs) |


