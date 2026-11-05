use crate::price::share_price;

const WAD: i128 = 1_000_000_000_000_000_000;

#[test]
fn equal_decimals_drop_four_digits() {
    assert_eq!(share_price(WAD, 7, 7), Some(100_000_000_000_000));
    assert_eq!(
        share_price(1_050_000_000_000_000_000, 7, 7),
        Some(105_000_000_000_000)
    );
}

#[test]
fn more_share_decimals_raise_the_price() {
    // 1 share = 2 assets; asset 7, share 9: 0.02 asset base units per share base unit.
    assert_eq!(
        share_price(20_000_000_000_000_000, 7, 9),
        Some(200_000_000_000_000)
    );
}

#[test]
fn fewer_share_decimals_lower_the_price() {
    // 1 share = 2 assets; asset 7, share 6: 20 asset base units per share base unit.
    assert_eq!(
        share_price(20_000_000_000_000_000_000, 7, 6),
        Some(200_000_000_000_000)
    );
}

#[test]
fn the_price_rounds_down() {
    assert_eq!(
        share_price(123_456_789_012_345_678, 7, 7),
        Some(12_345_678_901_234)
    );
}

#[test]
fn an_overflow_gives_no_price() {
    assert_eq!(share_price(WAD, 0, 38), None); // nav × 10^38 overflows
    assert_eq!(share_price(WAD, 0, 39), None); // 10^39 overflows
    assert_eq!(share_price(WAD, 40, 0), None); // 10^44 overflows
}

#[test]
fn a_price_of_zero_or_less_is_no_price() {
    assert_eq!(share_price(0, 7, 7), None);
    assert_eq!(share_price(-WAD, 7, 7), None);
    assert_eq!(share_price(WAD, 22, 7), None); // floors to 0
}
