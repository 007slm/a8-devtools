use cowfs::config::WorkspaceMeta;
use cowfs::cow::readdir::DirectoryMerger;
use cowfs::cow::state::LayerState;
use cowfs::cow::state::PathResolution;
use cowfs::cow::whiteout::{create_whiteout, find_whiteout, parse_whiteout_name};
use std::fs;
use std::path::{Path, PathBuf};

fn make_temp_dir(suffix: &str) -> PathBuf {
    let mut p = std::env::temp_dir();
    p.push(format!("cowfs_test_{}_{}", suffix, std::process::id()));
    let _ = fs::remove_dir_all(&p);
    fs::create_dir_all(&p).unwrap();
    p
}

#[test]
fn test_layer_state_resolve_precedence() {
    let lower = make_temp_dir("lower");
    let upper = make_temp_dir("upper");

    // 1. File only in lower
    fs::write(lower.join("base.txt"), b"base").unwrap();
    // 2. File in both -> upper takes precedence
    fs::write(lower.join("common.txt"), b"lower common").unwrap();
    fs::write(upper.join("common.txt"), b"upper common").unwrap();
    // 3. File deleted in upper -> whiteout marker
    create_whiteout(&upper, "deleted.txt").unwrap();
    fs::write(lower.join("deleted.txt"), b"should be hidden").unwrap();

    let state = LayerState::new(&lower, &upper);

    assert_eq!(
        state.resolve(Path::new("base.txt")),
        PathResolution::Lower(lower.join("base.txt"))
    );
    assert_eq!(
        state.resolve(Path::new("common.txt")),
        PathResolution::Upper(upper.join("common.txt"))
    );
    assert_eq!(
        state.resolve(Path::new("deleted.txt")),
        PathResolution::Whiteout
    );
    assert_eq!(
        state.resolve(Path::new("non_existent.txt")),
        PathResolution::NotFound
    );

    let _ = fs::remove_dir_all(&lower);
    let _ = fs::remove_dir_all(&upper);
}

#[test]
fn test_directory_merger_filters_whiteout() {
    let lower = make_temp_dir("lower_merge");
    let upper = make_temp_dir("upper_merge");

    fs::write(lower.join("file_a.txt"), b"a").unwrap();
    fs::write(lower.join("file_b.txt"), b"b").unwrap();
    fs::write(upper.join("file_c.txt"), b"c").unwrap();
    // Delete file_b via whiteout
    create_whiteout(&upper, "file_b.txt").unwrap();

    let state = LayerState::new(&lower, &upper);
    let entries = DirectoryMerger::read_directory(&state, Path::new("")).unwrap();

    let names: Vec<String> = entries.into_iter().map(|e| e.name).collect();

    assert!(names.contains(&"file_a.txt".to_string()));
    assert!(!names.contains(&"file_b.txt".to_string()), "file_b should be hidden by whiteout");
    assert!(names.contains(&"file_c.txt".to_string()));
    assert!(!names.iter().any(|n| n.starts_with(".cow_deleted.")), "whiteout markers must not be enumerated");

    let _ = fs::remove_dir_all(&lower);
    let _ = fs::remove_dir_all(&upper);
}

#[test]
fn test_whiteout_name_conversion() {
    let dir = make_temp_dir("whiteout_conv");
    let marker = create_whiteout(&dir, "foo.txt").unwrap();
    assert!(marker.exists());
    assert_eq!(marker.file_name().unwrap().to_str().unwrap(), ".cow_deleted.foo.txt");

    let found = find_whiteout(&dir, "foo.txt");
    assert_eq!(found, Some(marker));

    let parsed = parse_whiteout_name(".cow_deleted.foo.txt");
    assert_eq!(parsed, Some("foo.txt".to_string()));

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_workspace_meta_serialization() {
    let temp_source = make_temp_dir("meta_source");
    let temp_diff = make_temp_dir("meta_diff");
    let temp_target = make_temp_dir("meta_target");
    let meta = WorkspaceMeta::new(&temp_source, &temp_diff, &temp_target, "native");

    meta.save_both().unwrap();
    let loaded = WorkspaceMeta::load_global(&temp_target).unwrap();

    assert_eq!(meta.source_dir, loaded.source_dir);
    assert_eq!(meta.target_dir, loaded.target_dir);
    assert_eq!(meta.mode, loaded.mode);
    assert!(loaded.active);

    let _ = WorkspaceMeta::delete_global(&temp_target, true);
    let _ = fs::remove_dir_all(&temp_source);
    let _ = fs::remove_dir_all(&temp_diff);
    let _ = fs::remove_dir_all(&temp_target);
}

#[test]
fn test_cowdiff_isolation_and_hiding() {
    let lower = make_temp_dir("lower_cowdiff");
    let upper = make_temp_dir("upper_cowdiff");

    // Create a .cowdiff directory inside lower
    fs::create_dir_all(lower.join(".cowdiff/ws_test_12345/diff")).unwrap();
    fs::write(lower.join(".cowdiff/ws_test_12345/meta.json"), b"{}").unwrap();
    fs::write(lower.join("normal.txt"), b"visible").unwrap();

    let state = LayerState::new(&lower, &upper);

    // 1. .cowdiff should be completely invisible in resolution
    let res_meta = state.resolve(Path::new(".cowdiff/ws_test_12345/meta.json"));
    assert_eq!(res_meta, PathResolution::NotFound);

    let res_cowdiff = state.resolve(Path::new(".cowdiff"));
    assert_eq!(res_cowdiff, PathResolution::NotFound);

    // 2. .cowdiff should not appear in DirectoryMerger::read_directory
    let entries = DirectoryMerger::read_directory(&state, Path::new("")).unwrap();
    let names: Vec<String> = entries.into_iter().map(|e| e.name).collect();
    assert!(names.contains(&"normal.txt".to_string()));
    assert!(!names.contains(&".cowdiff".to_string()));

    let _ = fs::remove_dir_all(&lower);
    let _ = fs::remove_dir_all(&upper);
}

#[test]
fn test_cowdiff_path_hash_and_structure() {
    let source = PathBuf::from("E:\\my_source_repo");
    let target = PathBuf::from("E:\\workspaces\\client_dev");

    let path_hash = WorkspaceMeta::compute_path_hash(&target);
    assert!(path_hash.starts_with("client_dev_"));

    let diff_dir = WorkspaceMeta::diff_dir_for(&source, &target);
    assert_eq!(
        diff_dir,
        source.join(".cowdiff").join(&path_hash).join("diff")
    );

    let local_meta = WorkspaceMeta::local_meta_path(&source, &target);
    assert_eq!(
        local_meta,
        source.join(".cowdiff").join(&path_hash).join("meta.json")
    );
}

#[test]
fn test_strict_filtering_and_clean_deletion() {
    let source = make_temp_dir("source_strict");
    let diff = make_temp_dir("diff_strict");
    let target = make_temp_dir("target_strict");

    let meta = WorkspaceMeta::new(&source, &diff, &target, "driver");
    meta.save_both().unwrap();

    // 1. Normal state: list_all should include this workspace
    let all = WorkspaceMeta::list_all();
    assert!(all.iter().any(|m| m.target_dir == target));

    // 2. Load by exact target path
    let loaded = WorkspaceMeta::load_global(&target).unwrap();
    assert_eq!(loaded.target_dir, target);

    // 3. Delete cleanly
    WorkspaceMeta::delete_global(&target, true).unwrap();

    // 4. Confirm it is gone
    let loaded_after = WorkspaceMeta::load_global(&target);
    assert!(loaded_after.is_err());

    let all_after = WorkspaceMeta::list_all();
    assert!(!all_after.iter().any(|m| m.target_dir == target));

    let _ = fs::remove_dir_all(&source);
    let _ = fs::remove_dir_all(&diff);
    let _ = fs::remove_dir_all(&target);
}
