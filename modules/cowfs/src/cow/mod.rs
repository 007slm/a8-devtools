pub mod copy_up;
pub mod desktop_ini;
pub mod readdir;
pub mod state;
pub mod whiteout;

pub use copy_up::CopyUpEngine;
pub use desktop_ini::{resolve_icon_resource, synthesize_desktop_ini};
pub use readdir::DirectoryMerger;
pub use state::{LayerState, PathResolution};
#[allow(unused_imports)]
pub use whiteout::{create_whiteout, find_whiteout, parse_whiteout_name, remove_whiteout_if_exists};
