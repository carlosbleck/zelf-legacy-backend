#![no_std]

/// Compares two equal-sized byte slices in constant time.
#[inline]
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut sum = 0u8;
    for i in 0..a.len() {
        sum |= a[i] ^ b[i];
    }
    sum == 0
}

/// Compares two 32-byte arrays in constant time.
#[inline]
pub fn constant_time_eq_32(a: &[u8; 32], b: &[u8; 32]) -> bool {
    let mut sum = 0u8;
    for i in 0..32 {
        sum |= a[i] ^ b[i];
    }
    sum == 0
}

/// Compares two 64-byte arrays in constant time.
#[inline]
pub fn constant_time_eq_64(a: &[u8; 64], b: &[u8; 64]) -> bool {
    let mut sum = 0u8;
    for i in 0..64 {
        sum |= a[i] ^ b[i];
    }
    sum == 0
}