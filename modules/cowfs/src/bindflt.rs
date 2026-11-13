use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

pub const SERVICE_NAME: &str = "CowFsBindService";
pub const SERVICE_DISPLAY_NAME: &str = "a8-devtools CowFs BindFlt Kernel Bridge Service";
pub const PIPE_NAME: &str = r"\\.\pipe\cowfs-bindflt-v1";

pub fn strip_unc_prefix(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{}", rest))
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        path.to_path_buf()
    }
}

#[cfg(windows)]
pub fn has_reparse_point(path: &Path) -> bool {
    use widestring::U16CString;
    use windows::Win32::Storage::FileSystem::{
        GetFileAttributesW, FILE_ATTRIBUTE_REPARSE_POINT, INVALID_FILE_ATTRIBUTES,
    };

    if let Ok(wide) = U16CString::from_os_str(path.as_os_str()) {
        unsafe {
            let attrs = GetFileAttributesW(windows::core::PCWSTR(wide.as_ptr()));
            return attrs != INVALID_FILE_ATTRIBUTES
                && (attrs & FILE_ATTRIBUTE_REPARSE_POINT.0) != 0;
        }
    }
    false
}

#[cfg(not(windows))]
pub fn has_reparse_point(_path: &Path) -> bool {
    false
}

#[cfg(windows)]
mod win_impl {
    use super::*;
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicBool, AtomicPtr, Ordering};
    use widestring::U16CString;
    use windows::core::{s, w, HRESULT, PCWSTR, PWSTR};
    use windows::Win32::Foundation::{
        CloseHandle, GetLastError, ERROR_PIPE_CONNECTED, ERROR_SERVICE_ALREADY_RUNNING,
        ERROR_SERVICE_EXISTS, HANDLE, HMODULE, INVALID_HANDLE_VALUE, WAIT_OBJECT_0,
    };
    use windows::Win32::Security::{
        InitializeSecurityDescriptor, SetSecurityDescriptorDacl, PSECURITY_DESCRIPTOR,
        SECURITY_ATTRIBUTES, SECURITY_DESCRIPTOR,
    };
    use windows::Win32::Storage::FileSystem::{
        FlushFileBuffers, ReadFile, WriteFile, PIPE_ACCESS_DUPLEX,
    };
    use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
    use windows::Win32::System::Pipes::{
        ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, PIPE_READMODE_BYTE,
        PIPE_TYPE_BYTE, PIPE_UNLIMITED_INSTANCES, PIPE_WAIT,
    };
    use windows::Win32::System::Services::{
        ChangeServiceConfigW, CloseServiceHandle, ControlService, CreateServiceW, OpenSCManagerW,
        OpenServiceW, QueryServiceStatus, RegisterServiceCtrlHandlerW, SetServiceStatus,
        StartServiceCtrlDispatcherW, StartServiceW, ENUM_SERVICE_TYPE, SC_MANAGER_ALL_ACCESS,
        SERVICE_ALL_ACCESS, SERVICE_AUTO_START, SERVICE_CONTROL_INTERROGATE,
        SERVICE_CONTROL_SHUTDOWN, SERVICE_CONTROL_STOP, SERVICE_ERROR, SERVICE_ERROR_NORMAL,
        SERVICE_NO_CHANGE, SERVICE_RUNNING, SERVICE_START, SERVICE_START_PENDING, SERVICE_STATUS,
        SERVICE_STATUS_HANDLE, SERVICE_STOPPED, SERVICE_STOP_PENDING, SERVICE_TABLE_ENTRYW,
        SERVICE_WIN32_OWN_PROCESS,
    };
    use windows::Win32::System::SystemServices::SECURITY_DESCRIPTOR_REVISION;
    use windows::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject};
    use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
    use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;

    type CreateBindLinkFn = unsafe extern "system" fn(
        virtual_path: PCWSTR,
        backing_path: PCWSTR,
        create_flags: u32,
        exception_count: u32,
        exception_paths: *const PCWSTR,
    ) -> HRESULT;

    type RemoveBindLinkFn = unsafe extern "system" fn(virtual_path: PCWSTR) -> HRESULT;

    struct BindFltApi {
        _module: HMODULE,
        create_bind_link: CreateBindLinkFn,
        remove_bind_link: RemoveBindLinkFn,
    }

    impl BindFltApi {
        fn load() -> Result<Self, String> {
            unsafe {
                let module = LoadLibraryW(w!("bindfltapi.dll"))
                    .map_err(|e| format!("无法加载系统 bindfltapi.dll (需要 Windows 11 / 22H2+): {}", e))?;
                let create_proc = GetProcAddress(module, s!("CreateBindLink"))
                    .ok_or_else(|| "bindfltapi.dll 缺少 CreateBindLink 导出函数".to_string())?;
                let remove_proc = GetProcAddress(module, s!("RemoveBindLink"))
                    .ok_or_else(|| "bindfltapi.dll 缺少 RemoveBindLink 导出函数".to_string())?;

                Ok(Self {
                    _module: module,
                    create_bind_link: std::mem::transmute(create_proc),
                    remove_bind_link: std::mem::transmute(remove_proc),
                })
            }
        }
    }

    pub fn apply_bind_link(virtual_path: &Path, backing_path: &Path) -> Result<(), String> {
        let v_clean = strip_unc_prefix(virtual_path);
        let b_clean = strip_unc_prefix(backing_path);

        if !b_clean.exists() || !b_clean.is_dir() {
            return Err(format!("后端目录不存在或无效: {}", b_clean.display()));
        }

        let api = BindFltApi::load()?;
        let v_wide = U16CString::from_os_str(v_clean.as_os_str())
            .map_err(|e| format!("目标路径编码失败: {}", e))?;
        let b_wide = U16CString::from_os_str(b_clean.as_os_str())
            .map_err(|e| format!("后端路径编码失败: {}", e))?;

        unsafe {
            // 清理可能残留的旧内核绑定
            let _ = (api.remove_bind_link)(PCWSTR(v_wide.as_ptr()));
        }

        if has_reparse_point(&v_clean) {
            let _ = fs::remove_dir(&v_clean);
        }

        if v_clean.exists() {
            if !v_clean.is_dir() {
                return Err(format!("目标路径存在同名文件: {}", v_clean.display()));
            }
            let is_empty = fs::read_dir(&v_clean)
                .map(|mut d| d.next().is_none())
                .unwrap_or(false);
            if !is_empty {
                return Err(format!(
                    "目标挂载点目录非空 ({})，BindFlt 要求目标为空目录",
                    v_clean.display()
                ));
            }
        } else {
            fs::create_dir_all(&v_clean)
                .map_err(|e| format!("创建目标空目录失败 {}: {}", v_clean.display(), e))?;
        }

        unsafe {
            let hr = (api.create_bind_link)(
                PCWSTR(v_wide.as_ptr()),
                PCWSTR(b_wide.as_ptr()),
                0,
                0,
                std::ptr::null(),
            );
            if hr.is_err() {
                return Err(format!(
                    "CreateBindLink 内核调用失败 (HRESULT=0x{:08X}): virtual='{}' backing='{}'",
                    hr.0 as u32,
                    v_clean.display(),
                    b_clean.display()
                ));
            }
        }
        Ok(())
    }

    pub fn remove_bind_link(virtual_path: &Path) -> Result<(), String> {
        let v_clean = strip_unc_prefix(virtual_path);
        let api = BindFltApi::load()?;
        let v_wide = U16CString::from_os_str(v_clean.as_os_str())
            .map_err(|e| format!("路径编码失败: {}", e))?;

        unsafe {
            let hr = (api.remove_bind_link)(PCWSTR(v_wide.as_ptr()));
            // 若该路径原本未绑定，忽略不存在类错误，其余错误透传
            let code = hr.0 as u32;
            if hr.is_err() && code != 0x80070490 && code != 0x80070002 && code != 0x80070003 {
                return Err(format!(
                    "RemoveBindLink 失败 (HRESULT=0x{:08X}): {}",
                    code,
                    v_clean.display()
                ));
            }
        }

        if v_clean.exists() {
            let _ = fs::remove_dir(&v_clean);
        }
        Ok(())
    }

    static STOP_REQUESTED: AtomicBool = AtomicBool::new(false);
    static SERVICE_STATUS_PTR: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());

    fn set_svc_state(state: u32, exit_code: u32, wait_hint: u32) {
        let ptr = SERVICE_STATUS_PTR.load(Ordering::SeqCst);
        if ptr.is_null() {
            return;
        }
        let handle = SERVICE_STATUS_HANDLE(ptr);
        unsafe {
            let mut status = SERVICE_STATUS {
                dwServiceType: SERVICE_WIN32_OWN_PROCESS,
                dwCurrentState: windows::Win32::System::Services::SERVICE_STATUS_CURRENT_STATE(state),
                dwControlsAccepted: if state == SERVICE_RUNNING.0 {
                    windows::Win32::System::Services::SERVICE_ACCEPT_STOP
                        | windows::Win32::System::Services::SERVICE_ACCEPT_SHUTDOWN
                } else {
                    0
                },
                dwWin32ExitCode: exit_code,
                dwServiceSpecificExitCode: 0,
                dwCheckPoint: 0,
                dwWaitHint: wait_hint,
            };
            let _ = SetServiceStatus(handle, &mut status);
        }
    }

    unsafe extern "system" fn service_ctrl_handler(control: u32) {
        match control {
            SERVICE_CONTROL_STOP | SERVICE_CONTROL_SHUTDOWN => {
                STOP_REQUESTED.store(true, Ordering::SeqCst);
                set_svc_state(SERVICE_STOP_PENDING.0, 0, 2000);
                // 唤醒可能阻塞在 ConnectNamedPipe 的服务端循环
                let _ = ping_pipe();
            }
            SERVICE_CONTROL_INTERROGATE => {}
            _ => {}
        }
    }

    unsafe extern "system" fn service_main(_argc: u32, _argv: *mut PWSTR) {
        let name_wide = U16CString::from_str(SERVICE_NAME).unwrap();
        unsafe {
            if let Ok(h) =
                RegisterServiceCtrlHandlerW(PCWSTR(name_wide.as_ptr()), Some(service_ctrl_handler))
            {
                SERVICE_STATUS_PTR.store(h.0, Ordering::SeqCst);
            }
        }
        set_svc_state(SERVICE_START_PENDING.0, 0, 1000);
        STOP_REQUESTED.store(false, Ordering::SeqCst);
        set_svc_state(SERVICE_RUNNING.0, 0, 0);

        let _ = run_pipe_server_loop();

        set_svc_state(SERVICE_STOPPED.0, 0, 0);
    }

    pub fn run_service() -> Result<(), String> {
        let mut name_buf: Vec<u16> = SERVICE_NAME.encode_utf16().chain(Some(0)).collect();
        let table = [
            SERVICE_TABLE_ENTRYW {
                lpServiceName: PWSTR(name_buf.as_mut_ptr()),
                lpServiceProc: Some(service_main),
            },
            SERVICE_TABLE_ENTRYW::default(),
        ];
        unsafe {
            if StartServiceCtrlDispatcherW(table.as_ptr()).is_err() {
                // 非 SCM 环境直接调试运行命名管道服务器
                STOP_REQUESTED.store(false, Ordering::SeqCst);
                return run_pipe_server_loop();
            }
        }
        Ok(())
    }

    fn handle_pipe_request(req: &str) -> String {
        let line = req.trim_end_matches(&['\r', '\n'][..]);
        if line == "PING" {
            return "OK\tv2\n".to_string();
        }
        let mut parts = line.split('\t');
        let op = parts.next().unwrap_or("");
        match op {
            "BIND" => {
                let v = parts.next().unwrap_or("");
                let b = parts.next().unwrap_or("");
                if v.is_empty() || b.is_empty() {
                    return "ERR\t参数不完整\n".to_string();
                }
                match apply_bind_link(Path::new(v), Path::new(b)) {
                    Ok(()) => "OK\n".to_string(),
                    Err(e) => format!("ERR\t{}\n", e.replace('\n', " ")),
                }
            }
            "UNBIND" => {
                let v = parts.next().unwrap_or("");
                if v.is_empty() {
                    return "ERR\t参数不完整\n".to_string();
                }
                match remove_bind_link(Path::new(v)) {
                    Ok(()) => "OK\n".to_string(),
                    Err(e) => format!("ERR\t{}\n", e.replace('\n', " ")),
                }
            }
            _ => format!("ERR\t未知指令: {}\n", op),
        }
    }

    fn run_pipe_server_loop() -> Result<(), String> {
        let pipe_wide = U16CString::from_str(PIPE_NAME).unwrap();

        while !STOP_REQUESTED.load(Ordering::SeqCst) {
            unsafe {
                let mut sd = SECURITY_DESCRIPTOR::default();
                let p_sd = PSECURITY_DESCRIPTOR(&mut sd as *mut _ as *mut c_void);
                if InitializeSecurityDescriptor(p_sd, SECURITY_DESCRIPTOR_REVISION).is_err() {
                    return Err("InitializeSecurityDescriptor 失败".to_string());
                }
                if SetSecurityDescriptorDacl(p_sd, true, None, false).is_err() {
                    return Err("SetSecurityDescriptorDacl 失败".to_string());
                }
                let mut sa = SECURITY_ATTRIBUTES {
                    nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
                    lpSecurityDescriptor: &mut sd as *mut _ as *mut c_void,
                    bInheritHandle: false.into(),
                };

                let pipe_handle: HANDLE = CreateNamedPipeW(
                    PCWSTR(pipe_wide.as_ptr()),
                    PIPE_ACCESS_DUPLEX,
                    PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                    PIPE_UNLIMITED_INSTANCES,
                    4096,
                    4096,
                    0,
                    Some(&mut sa as *const SECURITY_ATTRIBUTES),
                );

                if pipe_handle == INVALID_HANDLE_VALUE {
                    std::thread::sleep(Duration::from_millis(100));
                    continue;
                }

                let connected = ConnectNamedPipe(pipe_handle, None).is_ok()
                    || GetLastError() == ERROR_PIPE_CONNECTED;

                if connected && !STOP_REQUESTED.load(Ordering::SeqCst) {
                    let mut buf = [0u8; 4096];
                    let mut read_bytes = 0u32;
                    if ReadFile(pipe_handle, Some(&mut buf), Some(&mut read_bytes), None).is_ok()
                        && read_bytes > 0
                    {
                        let req = String::from_utf8_lossy(&buf[..read_bytes as usize]).to_string();
                        let resp = handle_pipe_request(&req);
                        let mut written = 0u32;
                        let _ = WriteFile(
                            pipe_handle,
                            Some(resp.as_bytes()),
                            Some(&mut written),
                            None,
                        );
                        let _ = FlushFileBuffers(pipe_handle);
                    }
                }

                let _ = DisconnectNamedPipe(pipe_handle);
                let _ = CloseHandle(pipe_handle);
            }
        }
        Ok(())
    }

    fn send_pipe_command(cmd: &str) -> Result<String, String> {
        let mut last_err = None;
        for attempt in 0..10 {
            match fs::OpenOptions::new().read(true).write(true).open(PIPE_NAME) {
                Ok(mut f) => {
                    f.write_all(cmd.as_bytes())
                        .map_err(|e| format!("发送 IPC 指令失败: {}", e))?;
                    f.flush().map_err(|e| format!("刷新 IPC 管道失败: {}", e))?;

                    let mut buf = [0u8; 2048];
                    let n = match f.read(&mut buf) {
                        Ok(n) => n,
                        Err(e) => return Err(format!("读取 IPC 响应失败: {}", e)),
                    };
                    let resp = String::from_utf8_lossy(&buf[..n]).to_string();
                    let trimmed = resp.trim_end_matches(&['\r', '\n'][..]);
                    if trimmed == "OK" || trimmed == "OK\tv2" {
                        return Ok(trimmed.to_string());
                    } else if let Some(err_msg) = trimmed.strip_prefix("ERR\t") {
                        return Err(err_msg.to_string());
                    } else {
                        return Err(format!("未知服务端响应: {}", trimmed));
                    }
                }
                Err(e) if e.raw_os_error() == Some(231) && attempt < 9 => {
                    last_err = Some(e);
                    std::thread::sleep(Duration::from_millis(50));
                }
                Err(e) => {
                    return Err(format!("无法连接 CowFs 内核桥接服务 ({}): {}", PIPE_NAME, e));
                }
            }
        }
        Err(format!(
            "连接 CowFs 内核桥接服务超时 ({}): {:?}",
            PIPE_NAME, last_err
        ))
    }

    pub fn ping_pipe() -> bool {
        matches!(send_pipe_command("PING\n"), Ok(s) if s == "OK\tv2")
    }

    pub fn client_bind(virtual_path: &Path, backing_path: &Path) -> Result<(), String> {
        let v = strip_unc_prefix(virtual_path);
        let b = strip_unc_prefix(backing_path);
        let cmd = format!("BIND\t{}\t{}\n", v.display(), b.display());
        send_pipe_command(&cmd).map(|_| ())
    }

    pub fn client_unbind(virtual_path: &Path) -> Result<(), String> {
        let v = strip_unc_prefix(virtual_path);
        let cmd = format!("UNBIND\t{}\n", v.display());
        send_pipe_command(&cmd).map(|_| ())
    }

    fn start_existing_service(scm: windows::Win32::System::Services::SC_HANDLE, name: &str) {
        let wide = U16CString::from_str(name).unwrap();
        unsafe {
            if let Ok(svc) = OpenServiceW(scm, PCWSTR(wide.as_ptr()), SERVICE_START) {
                let _ = StartServiceW(svc, None);
                let _ = CloseServiceHandle(svc);
            }
        }
    }

    pub fn setup_service_as_admin() -> Result<(), String> {
        let current_exe = std::env::current_exe()
            .map_err(|e| format!("获取当前可执行文件路径失败: {}", e))?;
        let cowfs_exe = {
            let file_name = current_exe
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if file_name == "cowfs.exe" {
                current_exe
            } else {
                current_exe
                    .parent()
                    .unwrap_or_else(|| Path::new("."))
                    .join("cowfs.exe")
            }
        };

        if !cowfs_exe.exists() {
            return Err(format!("未找到 cowfs.exe: {}", cowfs_exe.display()));
        }

        // 将服务二进制托管至 %ProgramData%\CowFs\cowfs-service.exe，避免锁定原工作目录 exe
        let prog_data = std::env::var("ProgramData").unwrap_or_else(|_| r"C:\ProgramData".to_string());
        let svc_dir = PathBuf::from(prog_data).join("CowFs");
        fs::create_dir_all(&svc_dir)
            .map_err(|e| format!("创建服务托管目录失败 {}: {}", svc_dir.display(), e))?;
        let svc_exe = svc_dir.join("cowfs-service.exe");
        let svc_old = svc_dir.join("cowfs-service.old.exe");
        let _ = fs::remove_file(&svc_old);
        if svc_exe.exists() {
            let _ = fs::rename(&svc_exe, &svc_old);
        }
        fs::copy(&cowfs_exe, &svc_exe)
            .map_err(|e| format!("部署服务二进制失败 {}: {}", svc_exe.display(), e))?;

        // 同步复制 winfsp-x64.dll 至服务托管目录，确保 LocalSystem 服务可加载运行时库
        let dll_dest = svc_dir.join("winfsp-x64.dll");
        let dll_candidates = [
            cowfs_exe
                .parent()
                .map(|p| p.join("winfsp-x64.dll"))
                .unwrap_or_default(),
            PathBuf::from(r"C:\Program Files (x86)\WinFsp\bin\winfsp-x64.dll"),
            PathBuf::from(r"C:\Program Files\WinFsp\bin\winfsp-x64.dll"),
        ];
        if let Some(src_dll) = dll_candidates.iter().find(|p| p.is_file()) {
            let _ = fs::copy(src_dll, &dll_dest);
        }

        let bin_cmd = format!("\"{}\" service-run", svc_exe.display());
        let svc_name_w = U16CString::from_str(SERVICE_NAME).unwrap();
        let display_w = U16CString::from_str(SERVICE_DISPLAY_NAME).unwrap();
        let bin_w = U16CString::from_str(&bin_cmd).unwrap();

        unsafe {
            let scm = OpenSCManagerW(None, None, SC_MANAGER_ALL_ACCESS)
                .map_err(|e| format!("打开 Windows 服务管理器失败（需要管理员权限）: {}", e))?;

            // 1. 启动 Windows 原生 bindflt 微过滤驱动与 WinFsp 启动器
            start_existing_service(scm, "bindflt");
            start_existing_service(scm, "WinFsp.Launcher");

            // 2. 安装或更新 CowFsBindService (LocalSystem, 开机自启)
            let svc_handle = match CreateServiceW(
                scm,
                PCWSTR(svc_name_w.as_ptr()),
                PCWSTR(display_w.as_ptr()),
                SERVICE_ALL_ACCESS,
                SERVICE_WIN32_OWN_PROCESS,
                SERVICE_AUTO_START,
                SERVICE_ERROR_NORMAL,
                PCWSTR(bin_w.as_ptr()),
                None,
                None,
                None,
                None,
                None,
            ) {
                Ok(h) => h,
                Err(e) if e.code() == ERROR_SERVICE_EXISTS.into() => {
                    let h = OpenServiceW(scm, PCWSTR(svc_name_w.as_ptr()), SERVICE_ALL_ACCESS)
                        .map_err(|e2| {
                            let _ = CloseServiceHandle(scm);
                            format!("打开已有 {} 服务失败: {}", SERVICE_NAME, e2)
                        })?;
                    let mut st = SERVICE_STATUS::default();
                    let _ = ControlService(h, SERVICE_CONTROL_STOP, &mut st);
                    for _ in 0..50 {
                        let mut cur = SERVICE_STATUS::default();
                        if QueryServiceStatus(h, &mut cur).is_ok()
                            && cur.dwCurrentState == SERVICE_STOPPED
                        {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(100));
                    }
                    let _ = ChangeServiceConfigW(
                        h,
                        ENUM_SERVICE_TYPE(SERVICE_NO_CHANGE),
                        SERVICE_AUTO_START,
                        SERVICE_ERROR(SERVICE_NO_CHANGE),
                        PCWSTR(bin_w.as_ptr()),
                        None,
                        None,
                        None,
                        None,
                        None,
                        PCWSTR(display_w.as_ptr()),
                    );
                    h
                }
                Err(e) => {
                    let _ = CloseServiceHandle(scm);
                    return Err(format!("注册 {} 服务失败: {}", SERVICE_NAME, e));
                }
            };

            let mut started = false;
            for _ in 0..20 {
                let mut cur = SERVICE_STATUS::default();
                if QueryServiceStatus(svc_handle, &mut cur).is_ok()
                    && cur.dwCurrentState == SERVICE_RUNNING
                {
                    started = true;
                    break;
                }
                match StartServiceW(svc_handle, None) {
                    Ok(()) => {
                        started = true;
                        break;
                    }
                    Err(e) if e.code() == ERROR_SERVICE_ALREADY_RUNNING.into() => {
                        // 若服务正处于 STOP_PENDING 尾端，等待其彻底停止后再启动
                        std::thread::sleep(Duration::from_millis(150));
                    }
                    Err(e) => {
                        let _ = CloseServiceHandle(svc_handle);
                        let _ = CloseServiceHandle(scm);
                        return Err(format!("启动 {} 服务失败: {}", SERVICE_NAME, e));
                    }
                }
            }
            if !started {
                let _ = CloseServiceHandle(svc_handle);
                let _ = CloseServiceHandle(scm);
                return Err(format!("等待旧服务停止并启动 {} 超时", SERVICE_NAME));
            }

            let _ = CloseServiceHandle(svc_handle);
            let _ = CloseServiceHandle(scm);
        }

        // 3. 等待 Named Pipe 就绪
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if ping_pipe() {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(120));
        }

        Err(format!("{} 已安装并启动，但 Named Pipe ({}) 在 5 秒内未就绪", SERVICE_NAME, PIPE_NAME))
    }

    pub fn ensure_service_installed_and_running(cowfs_bin: &Path) -> Result<(), String> {
        if ping_pipe() {
            return Ok(());
        }

        if crate::doctor::SystemDoctor::check_admin() {
            return setup_service_as_admin();
        }

        if !cowfs_bin.exists() {
            return Err(format!("未找到 cowfs 可执行文件: {}", cowfs_bin.display()));
        }

        let verb_w = U16CString::from_str("runas").unwrap();
        let file_w = U16CString::from_os_str(cowfs_bin.as_os_str())
            .map_err(|e| format!("路径编码失败: {}", e))?;
        let params_w = U16CString::from_str("service-setup").unwrap();

        unsafe {
            let mut exec_info = SHELLEXECUTEINFOW {
                cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
                fMask: SEE_MASK_NOCLOSEPROCESS,
                lpVerb: PCWSTR(verb_w.as_ptr()),
                lpFile: PCWSTR(file_w.as_ptr()),
                lpParameters: PCWSTR(params_w.as_ptr()),
                nShow: SW_HIDE.0,
                ..Default::default()
            };

            ShellExecuteExW(&mut exec_info).map_err(|e| {
                format!(
                    "需要管理员权限安装内核桥接服务 ({})，提权未通过: {}",
                    SERVICE_NAME, e
                )
            })?;

            if !exec_info.hProcess.is_invalid() && !exec_info.hProcess.0.is_null() {
                let wait_res = WaitForSingleObject(exec_info.hProcess, 30_000);
                let mut exit_code = 1u32;
                let _ = GetExitCodeProcess(exec_info.hProcess, &mut exit_code);
                let _ = CloseHandle(exec_info.hProcess);

                if wait_res != WAIT_OBJECT_0 {
                    return Err("等待管理员安装内核服务超时".to_string());
                }
                if exit_code != 0 {
                    return Err(format!("service-setup 退出码异常: {}", exit_code));
                }
            }
        }

        if ping_pipe() {
            Ok(())
        } else {
            Err(format!("服务安装完成但 {} 仍未就绪", SERVICE_NAME))
        }
    }

    pub fn ensure_overlay_registered(cowfs_bin: &Path) {
        use windows::Win32::System::Registry::{
            RegCloseKey, RegOpenKeyExW, HKEY, HKEY_LOCAL_MACHINE, KEY_READ,
        };

        let subkey = r"Software\Microsoft\Windows\CurrentVersion\Explorer\ShellIconOverlayIdentifiers\       A8CowFsOverlay";
        if let Ok(wide) = U16CString::from_str(subkey) {
            let mut hkey = HKEY::default();
            let res = unsafe {
                RegOpenKeyExW(
                    HKEY_LOCAL_MACHINE,
                    PCWSTR(wide.as_ptr()),
                    None,
                    KEY_READ,
                    &mut hkey,
                )
            };
            if res.is_ok() {
                unsafe {
                    let _ = RegCloseKey(hkey);
                }
                return;
            }
        }

        let dll = match cowfs_bin.parent() {
            Some(dir) => dir.join("cowlink_overlay.dll"),
            None => return,
        };
        if !dll.is_file() {
            return;
        }

        if crate::doctor::SystemDoctor::check_admin() {
            let _ = std::process::Command::new("regsvr32.exe")
                .arg("/s")
                .arg(&dll)
                .status();
            return;
        }

        let verb_w = U16CString::from_str("runas").unwrap();
        let file_w = U16CString::from_str("regsvr32.exe").unwrap();
        let params_str = format!("/s \"{}\"", dll.display());
        let params_w = match U16CString::from_str(&params_str) {
            Ok(w) => w,
            Err(_) => return,
        };

        unsafe {
            let mut exec_info = SHELLEXECUTEINFOW {
                cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
                fMask: SEE_MASK_NOCLOSEPROCESS,
                lpVerb: PCWSTR(verb_w.as_ptr()),
                lpFile: PCWSTR(file_w.as_ptr()),
                lpParameters: PCWSTR(params_w.as_ptr()),
                nShow: SW_HIDE.0,
                ..Default::default()
            };

            if ShellExecuteExW(&mut exec_info).is_ok()
                && !exec_info.hProcess.is_invalid()
                && !exec_info.hProcess.0.is_null()
            {
                let _ = WaitForSingleObject(exec_info.hProcess, 15_000);
                let _ = CloseHandle(exec_info.hProcess);
            }
        }
    }
}

#[cfg(not(windows))]
mod win_impl {
    use super::*;
    pub fn run_service() -> Result<(), String> {
        Err("仅支持 Windows".to_string())
    }
    pub fn ping_pipe() -> bool {
        false
    }
    pub fn client_bind(_v: &Path, _b: &Path) -> Result<(), String> {
        Err("仅支持 Windows".to_string())
    }
    pub fn client_unbind(_v: &Path) -> Result<(), String> {
        Ok(())
    }
    pub fn setup_service_as_admin() -> Result<(), String> {
        Err("仅支持 Windows".to_string())
    }
    pub fn ensure_service_installed_and_running(_bin: &Path) -> Result<(), String> {
        Err("仅支持 Windows".to_string())
    }
    pub fn ensure_overlay_registered(_bin: &Path) {}
}

pub use win_impl::{
    client_bind, client_unbind, ensure_overlay_registered, ensure_service_installed_and_running,
    run_service, setup_service_as_admin,
};

pub fn is_service_ready() -> bool {
    win_impl::ping_pipe()
}
