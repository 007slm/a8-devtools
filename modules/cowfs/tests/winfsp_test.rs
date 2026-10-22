use cowfs::winfsp_fs::context::CowFsContext;
use std::ffi::OsStr;
use std::fs;
use winfsp::host::{FileSystemHost, VolumeParams};

#[test]
fn test_winfsp_mount_probe() {
    let temp = std::env::temp_dir().join(format!("winfsp_probe_{}", std::process::id()));
    let lower = temp.join("lower");
    let upper = temp.join("upper");
    let mount_dir = temp.join("mount");

    let _ = fs::create_dir_all(&lower);
    let _ = fs::create_dir_all(&upper);
    let _ = fs::remove_dir_all(&mount_dir);

    fs::write(lower.join("test.txt"), b"hello from lower").unwrap();

    let mut volume_params = VolumeParams::new();
    volume_params
        .filesystem_name(OsStr::new("NTFS"))
        .case_preserved_names(true)
        .case_sensitive_search(false)
        .unicode_on_disk(true)
        .sector_size(4096)
        .sectors_per_allocation_unit(1);

    let context = CowFsContext::new(lower.clone(), upper.clone());
    let mut host = FileSystemHost::<CowFsContext, winfsp::host::FineGuard>::new(volume_params, context).unwrap();
    host.mount(&mount_dir).unwrap();
    host.start().unwrap();

    println!("FileSystemHost mounted and dispatcher started at {:?}", mount_dir);

    // Verify reading from mount point
    let read_back = fs::read_to_string(mount_dir.join("test.txt")).unwrap();
    println!("Read back from virtual mount: {:?}", read_back);
    assert_eq!(read_back, "hello from lower");

    // Verify writing to virtual mount (triggers Copy-Up)
    fs::write(mount_dir.join("test.txt"), b"modified in workspace").unwrap();
    let mod_read = fs::read_to_string(mount_dir.join("test.txt")).unwrap();
    println!("Modified in virtual mount: {:?}", mod_read);
    assert_eq!(mod_read, "modified in workspace");

    // Verify lower file is UNTOUCHED!
    let lower_read = fs::read_to_string(lower.join("test.txt")).unwrap();
    println!("Lower file content: {:?}", lower_read);
    assert_eq!(lower_read, "hello from lower");

    // Verify upper file has the modification!
    let upper_read = fs::read_to_string(upper.join("test.txt")).unwrap();
    println!("Upper file content: {:?}", upper_read);
    assert_eq!(upper_read, "modified in workspace");

    host.unmount();
    host.stop();

    let _ = fs::remove_dir_all(&temp);
}
