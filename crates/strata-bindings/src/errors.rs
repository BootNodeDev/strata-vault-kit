//! The block of error codes each kit contract owns. A failure inside a called
//! contract reaches the caller with that contract's code, so the blocks never
//! overlap.

/// An inclusive block of contract error codes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ErrorRange {
    pub first: u32,
    pub last: u32,
}

impl ErrorRange {
    pub const fn contains(&self, code: u32) -> bool {
        self.first <= code && code <= self.last
    }
}

pub const ORACLE_ERRORS: ErrorRange = ErrorRange {
    first: 3000,
    last: 3999,
};
pub const VAULT_ERRORS: ErrorRange = ErrorRange {
    first: 6000,
    last: 6999,
};
pub const TOKEN_ERRORS: ErrorRange = ErrorRange {
    first: 7000,
    last: 7999,
};
pub const COMPLIANCE_ERRORS: ErrorRange = ErrorRange {
    first: 8000,
    last: 8999,
};

const _: () = {
    let ranges = [ORACLE_ERRORS, VAULT_ERRORS, TOKEN_ERRORS, COMPLIANCE_ERRORS];
    let mut i = 1;
    while i < ranges.len() {
        assert!(
            ranges[i - 1].last < ranges[i].first,
            "two contracts' error ranges overlap"
        );
        i += 1;
    }
};

/// Declares a contract's error enum. The build fails if a variant's code
/// leaves the range the contract owns.
///
/// ```
/// strata_bindings::error_enum! {
///     strata_bindings::VAULT_ERRORS,
///     #[repr(u32)]
///     pub enum DemoError {
///         First = 6000,
///         Last = 6999,
///     }
/// }
/// assert_eq!(DemoError::Last as u32, 6999);
/// ```
///
/// ```compile_fail,E0080
/// strata_bindings::error_enum! {
///     strata_bindings::VAULT_ERRORS,
///     #[repr(u32)]
///     pub enum DemoError {
///         First = 6000,
///         FromTheToken = 7000,
///     }
/// }
/// ```
#[macro_export]
macro_rules! error_enum {
    (
        $range:path,
        $(#[$attr:meta])*
        $vis:vis enum $name:ident {
            // `tt`, not `literal`: `contracterror` reads each code as a bare literal.
            $($(#[$variant_attr:meta])* $variant:ident = $code:tt),+ $(,)?
        }
    ) => {
        $(#[$attr])*
        $vis enum $name {
            $($(#[$variant_attr])* $variant = $code,)+
        }

        const _: () = {
            let range: $crate::ErrorRange = $range;
            $(assert!(
                range.contains($code),
                concat!(
                    stringify!($name),
                    "::",
                    stringify!($variant),
                    " is outside its contract's error range",
                ),
            );)+
        };
    };
}
