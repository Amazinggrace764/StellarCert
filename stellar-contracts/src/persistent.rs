#[path = "storage/ttl.rs"]
mod ttl;

pub use ttl::{extend_instance_ttl, extend_ttl, DEFAULT_TTL};
