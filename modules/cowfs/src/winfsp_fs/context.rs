use crate::cow::{CopyUpEngine, DirectoryMerger, LayerState, PathResolution};
use std::ffi::c_void;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::os::windows::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use parking_lot::Mutex;

use widestring::U16CStr;
use windows::Win32::Storage::FileSystem::{
    FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL, FILE_ATTRIBUTE_READONLY,
    FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
};
use winfsp::{FspError, Result};
use winfsp::filesystem::{
    DirBuffer, DirInfo, DirMarker, FileInfo, FileSecurity, FileSystemContext,
    OpenFileInfo, VolumeInfo, WideNameInfo,
};
use winfsp_sys::{FILE_ACCESS_RIGHTS, FILE_FLAGS_AND_ATTRIBUTES};

pub struct CowFileHandle {
    pub rel_path: PathBuf,
    pub is_dir: bool,
    pub file: Option<Mutex<File>>,
    pub dir_buffer: DirBuffer,
    pub delete_on_close: AtomicBool,
}

pub struct CowFsContext {
    engine: Arc<CopyUpEngine>,
}

impl CowFsContext {
    pub fn new(lower_dir: PathBuf, upper_dir: PathBuf) -> Self {
        let state = LayerState::new(lower_dir, upper_dir);
        let engine = Arc::new(CopyUpEngine::new(state));
        Self { engine }
    }

    #[allow(dead_code)]
    pub fn engine(&self) -> &Arc<CopyUpEngine> {
        &self.engine
    }

    fn u16cstr_to_rel_path(raw: &U16CStr) -> PathBuf {
        let s = raw.to_string_lossy();
        LayerState::normalize_rel_path(&s)
    }

    fn fill_file_info(path: &Path, is_dir: bool, file_info: &mut FileInfo) {
        if let Ok(meta) = fs::metadata(path) {
            file_info.file_size = if is_dir { 0 } else { meta.len() };
            file_info.allocation_size = (file_info.file_size + 4095) & !4095;
            let mut attrs = if is_dir {
                FILE_ATTRIBUTE_DIRECTORY.0
            } else {
                FILE_ATTRIBUTE_NORMAL.0
            };
            if meta.permissions().readonly() {
                attrs |= FILE_ATTRIBUTE_READONLY.0;
            }
            file_info.file_attributes = attrs;

            if let Ok(created) = meta.created() {
                file_info.creation_time = to_filetime(created);
            }
            if let Ok(modified) = meta.modified() {
                file_info.last_write_time = to_filetime(modified);
                file_info.change_time = to_filetime(modified);
            }
            if let Ok(accessed) = meta.accessed() {
                file_info.last_access_time = to_filetime(accessed);
            }
        } else {
            file_info.file_attributes = if is_dir {
                FILE_ATTRIBUTE_DIRECTORY.0
            } else {
                FILE_ATTRIBUTE_NORMAL.0
            };
        }
    }

    fn not_found() -> FspError {
        FspError::from(io::Error::new(io::ErrorKind::NotFound, "Path not found"))
    }

    fn access_denied() -> FspError {
        FspError::from(io::Error::new(io::ErrorKind::PermissionDenied, "Access denied"))
    }

    fn is_a_directory() -> FspError {
        FspError::from(io::Error::new(io::ErrorKind::IsADirectory, "Is a directory"))
    }

    fn not_a_directory() -> FspError {
        FspError::from(io::Error::new(io::ErrorKind::NotADirectory, "Not a directory"))
    }
}

fn to_filetime(time: std::time::SystemTime) -> u64 {
    match time.duration_since(std::time::UNIX_EPOCH) {
        Ok(dur) => (dur.as_secs() * 10_000_000) + 116_444_736_000_000_000 + (dur.subsec_nanos() as u64 / 100),
        Err(_) => 0,
    }
}

impl FileSystemContext for CowFsContext {
    type FileContext = Arc<CowFileHandle>;

    fn get_volume_info(&self, out_volume_info: &mut VolumeInfo) -> Result<()> {
        out_volume_info.total_size = 1024 * 1024 * 1024 * 1024; // 1 TB virtual
        out_volume_info.free_size = 512 * 1024 * 1024 * 1024;   // 512 GB virtual
        out_volume_info.set_volume_label("COWLINK");
        Ok(())
    }

    fn get_security_by_name(
        &self,
        file_name: &U16CStr,
        _security_descriptor: Option<&mut [c_void]>,
        _reparse_point_resolver: impl FnOnce(&U16CStr) -> Option<FileSecurity>,
    ) -> Result<FileSecurity> {
        let rel_path = Self::u16cstr_to_rel_path(file_name);

        let res = self.engine.state().resolve(&rel_path);

        match res {
            PathResolution::Upper(p) | PathResolution::Lower(p) => {
                let is_dir = p.is_dir();
                let mut attributes = if is_dir {
                    FILE_ATTRIBUTE_DIRECTORY.0
                } else {
                    FILE_ATTRIBUTE_NORMAL.0
                };
                if let Ok(meta) = fs::metadata(&p) {
                    if meta.permissions().readonly() {
                        attributes |= FILE_ATTRIBUTE_READONLY.0;
                    }
                }
                Ok(FileSecurity {
                    reparse: false,
                    sz_security_descriptor: 0,
                    attributes,
                })
            }
            PathResolution::Whiteout | PathResolution::NotFound => Err(Self::not_found()),
        }
    }

    fn open(
        &self,
        file_name: &U16CStr,
        _create_options: u32,
        granted_access: FILE_ACCESS_RIGHTS,
        file_info: &mut OpenFileInfo,
    ) -> Result<Self::FileContext> {
        let rel_path = Self::u16cstr_to_rel_path(file_name);

        let wants_write = (granted_access & (0x0002 | 0x0004 | 0x0010000 | 0x10000000 | 0x40000000)) != 0;

        let physical_path = if wants_write {
            // Trigger Copy-Up if needed
            self.engine.copy_up(&rel_path).map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    Self::not_found()
                } else {
                    Self::access_denied()
                }
            })?
        } else {
            match self.engine.state().resolve(&rel_path) {
                PathResolution::Upper(p) | PathResolution::Lower(p) => p,
                PathResolution::Whiteout | PathResolution::NotFound => {
                    return Err(Self::not_found());
                }
            }
        };

        let is_dir = physical_path.is_dir();
        Self::fill_file_info(&physical_path, is_dir, file_info.as_mut());

        let file = if is_dir {
            None
        } else {
            let mut options = OpenOptions::new();
            options.read(true);
            if wants_write {
                options.write(true);
            }
            options.share_mode(FILE_SHARE_READ.0 | FILE_SHARE_WRITE.0 | FILE_SHARE_DELETE.0);
            let f = options.open(&physical_path).map_err(|_| Self::access_denied())?;
            Some(Mutex::new(f))
        };

        Ok(Arc::new(CowFileHandle {
            rel_path,
            is_dir,
            file,
            dir_buffer: DirBuffer::new(),
            delete_on_close: AtomicBool::new(false),
        }))
    }

    fn close(&self, _context: Self::FileContext) {
        // Handle closes automatically when Arc dropped
    }

    fn create(
        &self,
        file_name: &U16CStr,
        create_options: u32,
        _granted_access: FILE_ACCESS_RIGHTS,
        _file_attributes: FILE_FLAGS_AND_ATTRIBUTES,
        _security_descriptor: Option<&[c_void]>,
        _allocation_size: u64,
        _extra_buffer: Option<&[u8]>,
        _extra_buffer_is_reparse_point: bool,
        file_info: &mut OpenFileInfo,
    ) -> Result<Self::FileContext> {
        let rel_path = Self::u16cstr_to_rel_path(file_name);
        let is_dir = (create_options & 0x00000001) != 0; // FILE_DIRECTORY_FILE

        let upper_path = self.engine.prepare_for_create(&rel_path, is_dir).map_err(|_| {
            Self::access_denied()
        })?;

        let file = if is_dir {
            None
        } else {
            let mut options = OpenOptions::new();
            options.read(true).write(true).create(true).truncate(true);
            options.share_mode(FILE_SHARE_READ.0 | FILE_SHARE_WRITE.0 | FILE_SHARE_DELETE.0);
            let f = options.open(&upper_path).map_err(|_| Self::access_denied())?;
            Some(Mutex::new(f))
        };

        Self::fill_file_info(&upper_path, is_dir, file_info.as_mut());

        Ok(Arc::new(CowFileHandle {
            rel_path,
            is_dir,
            file,
            dir_buffer: DirBuffer::new(),
            delete_on_close: AtomicBool::new(false),
        }))
    }

    fn cleanup(&self, context: &Self::FileContext, _file_name: Option<&U16CStr>, _flags: u32) {
        if context.delete_on_close.load(Ordering::SeqCst) {
            let _ = self.engine.delete_path(&context.rel_path);
        }
    }

    fn set_delete(&self, context: &Self::FileContext, _file_name: &U16CStr, delete_file: bool) -> Result<()> {
        context.delete_on_close.store(delete_file, Ordering::SeqCst);
        Ok(())
    }

    fn set_basic_info(
        &self,
        _context: &Self::FileContext,
        file_attributes: u32,
        _creation_time: u64,
        _last_access_time: u64,
        _last_write_time: u64,
        _last_change_time: u64,
        file_info: &mut FileInfo,
    ) -> Result<()> {
        if file_attributes != 0 && file_attributes != u32::MAX {
            file_info.file_attributes = file_attributes;
        }
        Ok(())
    }

    fn overwrite(
        &self,
        context: &Self::FileContext,
        _file_attributes: FILE_FLAGS_AND_ATTRIBUTES,
        _replace_file_attributes: bool,
        _allocation_size: u64,
        _extra_buffer: Option<&[u8]>,
        file_info: &mut FileInfo,
    ) -> Result<()> {
        if let Some(ref file_mutex) = context.file {
            let file = file_mutex.lock();
            file.set_len(0).map_err(|_| Self::access_denied())?;
            file_info.file_size = 0;
            file_info.allocation_size = 0;
            Ok(())
        } else {
            Err(Self::is_a_directory())
        }
    }

    fn read(&self, context: &Self::FileContext, buffer: &mut [u8], offset: u64) -> Result<u32> {
        if let Some(ref file_mutex) = context.file {
            let mut file = file_mutex.lock();
            file.seek(SeekFrom::Start(offset)).map_err(|_| Self::access_denied())?;
            let bytes_read = file.read(buffer).map_err(|_| Self::access_denied())?;
            Ok(bytes_read as u32)
        } else {
            Err(Self::is_a_directory())
        }
    }

    fn write(
        &self,
        context: &Self::FileContext,
        buffer: &[u8],
        offset: u64,
        write_to_eof: bool,
        _constrained_io: bool,
        file_info: &mut FileInfo,
    ) -> Result<u32> {
        if let Some(ref file_mutex) = context.file {
            let mut file = file_mutex.lock();
            if write_to_eof {
                file.seek(SeekFrom::End(0)).map_err(|_| Self::access_denied())?;
            } else {
                file.seek(SeekFrom::Start(offset)).map_err(|_| Self::access_denied())?;
            }
            file.write_all(buffer).map_err(|_| Self::access_denied())?;

            let len = file.metadata().map(|m| m.len()).unwrap_or(0);
            file_info.file_size = len;
            file_info.allocation_size = (len + 4095) & !4095;
            Ok(buffer.len() as u32)
        } else {
            Err(Self::is_a_directory())
        }
    }

    fn get_file_info(&self, context: &Self::FileContext, file_info: &mut FileInfo) -> Result<()> {
        let res = self.engine.state().resolve(&context.rel_path);
        match res {
            PathResolution::Upper(p) | PathResolution::Lower(p) => {
                Self::fill_file_info(&p, context.is_dir, file_info);
                Ok(())
            }
            PathResolution::Whiteout | PathResolution::NotFound => Err(Self::not_found()),
        }
    }

    fn set_file_size(&self, context: &Self::FileContext, new_size: u64, _set_allocation_size: bool, file_info: &mut FileInfo) -> Result<()> {
        if let Some(ref file_mutex) = context.file {
            let file = file_mutex.lock();
            file.set_len(new_size).map_err(|_| Self::access_denied())?;
            file_info.file_size = new_size;
            file_info.allocation_size = (new_size + 4095) & !4095;
            Ok(())
        } else {
            Err(Self::is_a_directory())
        }
    }

    fn read_directory(
        &self,
        context: &Self::FileContext,
        _pattern: Option<&U16CStr>,
        marker: DirMarker,
        buffer: &mut [u8],
    ) -> Result<u32> {
        if !context.is_dir {
            return Err(Self::not_a_directory());
        }

        if let Ok(dir_buf) = context.dir_buffer.acquire(marker.is_none(), None) {
            // Add "." and ".."
            let mut dot_info: DirInfo<255> = DirInfo::new();
            let _ = dot_info.set_name(".");
            dot_info.file_info_mut().file_attributes = FILE_ATTRIBUTE_DIRECTORY.0;
            let _ = dir_buf.write(&mut dot_info);

            let mut dotdot_info: DirInfo<255> = DirInfo::new();
            let _ = dotdot_info.set_name("..");
            dotdot_info.file_info_mut().file_attributes = FILE_ATTRIBUTE_DIRECTORY.0;
            let _ = dir_buf.write(&mut dotdot_info);

            // Enumerate merged entries
            if let Ok(entries) = DirectoryMerger::read_directory(self.engine.state(), &context.rel_path) {
                for entry in entries {
                    let mut item_info: DirInfo<255> = DirInfo::new();
                    let _ = item_info.set_name(&entry.name);
                    Self::fill_file_info(&entry.physical_path, entry.is_dir, item_info.file_info_mut());
                    let _ = dir_buf.write(&mut item_info);
                }
            }
        }

        let bytes_read = context.dir_buffer.read(marker, buffer);
        Ok(bytes_read)
    }
}
