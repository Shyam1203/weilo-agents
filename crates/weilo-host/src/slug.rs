//! Channel and folder names: lowercase, one or two words joined by a hyphen.

/// `"Shop Launch 2026!"` → `"shop-launch"`. Empty when there are no letters or digits.
pub fn slugify(title: &str) -> String {
    title
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .take(2)
        .map(|w| w.to_lowercase())
        .collect::<Vec<_>>()
        .join("-")
}

/// The first of `base`, `base-2`, `base-3`… that `taken` says is free.
pub fn unique(base: &str, taken: impl Fn(&str) -> bool) -> String {
    let base = if base.is_empty() { "channel" } else { base };
    if !taken(base) {
        return base.to_string();
    }
    (2..)
        .map(|n| format!("{base}-{n}"))
        .find(|s| !taken(s))
        .expect("an unused name")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_two_lowercase_words() {
        assert_eq!(slugify("Shop Launch 2026!"), "shop-launch");
        assert_eq!(slugify("  Trip  "), "trip");
        assert_eq!(slugify("Taxes_2026"), "taxes-2026");
        assert_eq!(slugify("Équipe Été"), "équipe-été");
        assert_eq!(slugify("!!!"), "");
    }

    #[test]
    fn unique_adds_a_number() {
        let taken = ["general", "general-2"];
        assert_eq!(unique("general", |s| taken.contains(&s)), "general-3");
        assert_eq!(unique("trip", |s| taken.contains(&s)), "trip");
        assert_eq!(unique("", |_| false), "channel");
    }
}
