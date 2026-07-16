pub fn parse_rfc3339_ms(value: &str) -> Option<i64> {
    let date = value.get(0..10)?;
    let time = value.get(11..19)?;
    if value.as_bytes().get(10) != Some(&b'T') {
        return None;
    }
    let year = date.get(0..4)?.parse::<i64>().ok()?;
    let month = date.get(5..7)?.parse::<i64>().ok()?;
    let day = date.get(8..10)?.parse::<i64>().ok()?;
    let hour = time.get(0..2)?.parse::<i64>().ok()?;
    let minute = time.get(3..5)?.parse::<i64>().ok()?;
    let second = time.get(6..8)?.parse::<i64>().ok()?;
    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hour > 23
        || minute > 59
        || second > 60
    {
        return None;
    }
    let mut offset = 19;
    let mut millis = 0_i64;
    if value.as_bytes().get(offset) == Some(&b'.') {
        offset += 1;
        let fractional = value[offset..]
            .bytes()
            .take_while(u8::is_ascii_digit)
            .take(3)
            .collect::<Vec<_>>();
        for (index, digit) in fractional.iter().enumerate() {
            millis += i64::from(*digit - b'0') * 10_i64.pow(2_u32.saturating_sub(index as u32));
        }
        offset += value[offset..]
            .bytes()
            .take_while(u8::is_ascii_digit)
            .count();
    }
    let timezone = value.get(offset..)?;
    let offset_seconds = if timezone == "Z" {
        0_i64
    } else {
        let sign = match timezone.as_bytes().first() {
            Some(b'+') => 1_i64,
            Some(b'-') => -1_i64,
            _ => return None,
        };
        let hours = timezone.get(1..3)?.parse::<i64>().ok()?;
        let minutes = timezone.get(4..6)?.parse::<i64>().ok()?;
        sign * (hours * 3_600 + minutes * 60)
    };
    let days = days_from_civil(year, month, day)?;
    Some(
        (days * 86_400 + hour * 3_600 + minute * 60 + second - offset_seconds)
            .saturating_mul(1_000)
            .saturating_add(millis),
    )
}

fn days_from_civil(year: i64, month: i64, day: i64) -> Option<i64> {
    let adjusted_year = year - i64::from(month <= 2);
    let era = adjusted_year.div_euclid(400);
    let year_of_era = adjusted_year - era * 400;
    let shifted_month = month + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * shifted_month + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    let days = era * 146_097 + day_of_era - 719_468;
    let month_length = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap_year(year) => 29,
        2 => 28,
        _ => return None,
    };
    if day > month_length {
        return None;
    }
    Some(days)
}

const fn is_leap_year(year: i64) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

#[cfg(test)]
mod tests {
    use super::parse_rfc3339_ms;

    #[test]
    fn parses_docker_timestamps() {
        assert_eq!(parse_rfc3339_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(
            parse_rfc3339_ms("2025-07-15T10:20:30.123456789Z"),
            Some(1_752_574_830_123)
        );
        assert_eq!(
            parse_rfc3339_ms("2025-07-15T18:20:30.123+08:00"),
            Some(1_752_574_830_123)
        );
    }
}
