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

/// Small words that tell sessions apart poorly ("fix the…", "add a…").
const FILLER: &[&str] = &[
    "a", "an", "and", "at", "for", "from", "in", "into", "it", "its", "my", "of", "on", "our",
    "please", "the", "this", "that", "to", "with",
];

/// A session's folder and branch name: up to four words of its name, small words
/// left out ("Fix the checkout total" → `fix-checkout-total`), at most 40 characters.
/// When only small words are left, the first of them are kept.
pub fn session_slug(title: &str) -> String {
    let words: Vec<String> = title
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_lowercase)
        .collect();
    let mut kept: Vec<&str> = words
        .iter()
        .map(String::as_str)
        .filter(|w| !FILLER.contains(w))
        .take(4)
        .collect();
    if kept.is_empty() {
        kept = words.iter().map(String::as_str).take(2).collect();
    }
    let mut slug = String::new();
    for w in kept {
        let next = if slug.is_empty() {
            w.to_string()
        } else {
            format!("{slug}-{w}")
        };
        if next.chars().count() > 40 {
            if slug.is_empty() {
                slug = w.chars().take(40).collect();
            }
            break;
        }
        slug = next;
    }
    slug
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
    fn session_slugs_skip_small_words() {
        assert_eq!(session_slug("Fix the checkout total"), "fix-checkout-total");
        assert_eq!(session_slug("Fix the tax rounding"), "fix-tax-rounding");
        assert_eq!(
            session_slug("Add a dark mode to the settings page"),
            "add-dark-mode-settings"
        );
        assert_eq!(session_slug("shop 2"), "shop-2");
        assert_eq!(session_slug("To the"), "to-the");
        assert_eq!(session_slug("!!!"), "");
        let long = "a".repeat(60);
        assert_eq!(session_slug(&long).chars().count(), 40);
        assert!(session_slug("Supercalifragilistic expialidocious extraordinarily").len() <= 40);
    }

    #[test]
    fn unique_adds_a_number() {
        let taken = ["general", "general-2"];
        assert_eq!(unique("general", |s| taken.contains(&s)), "general-3");
        assert_eq!(unique("trip", |s| taken.contains(&s)), "trip");
        assert_eq!(unique("", |_| false), "channel");
    }
}
