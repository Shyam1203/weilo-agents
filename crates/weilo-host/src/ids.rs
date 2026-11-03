use uuid::Uuid;

/// A new time-ordered id (UUID v7).
pub fn new_id() -> Uuid {
    Uuid::now_v7()
}
