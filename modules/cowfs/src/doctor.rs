use std::path::Path;

pub struct DoctorReport {
    pub is_windows: bool,
    pub is_admin: bool,
    pub winfsp_dll_found: bool,
    pub winfsp_driver_running: bool,
    pub bindflt_service_running: bool,
}

pub struct SystemDoctor;

impl SystemDoctor {
    pub fn diagnose() -> DoctorReport {
        let is_windows = cfg!(windows);
        let is_admin = Self::check_admin();
        let winfsp_dll_found = Self::check_winfsp_dll();
        let winfsp_driver_running = Self::check_winfsp_driver();
        let bindflt_service_running = crate::bindflt::is_service_ready();

        DoctorReport {
            is_windows,
            is_admin,
            winfsp_dll_found,
            winfsp_driver_running,
            bindflt_service_running,
        }
    }

    #[cfg(windows)]
    pub fn check_admin() -> bool {
        use std::mem::size_of;
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::Security::{
            GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
        };
        use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

        unsafe {
            let mut token = Default::default();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_ok() {
                let mut elevation = TOKEN_ELEVATION::default();
                let mut return_length = 0;
                let res = GetTokenInformation(
                    token,
                    TokenElevation,
                    Some(&mut elevation as *mut _ as *mut _),
                    size_of::<TOKEN_ELEVATION>() as u32,
                    &mut return_length,
                );
                let _ = CloseHandle(token);
                if res.is_ok() {
                    return elevation.TokenIsElevated != 0;
                }
            }
        }
        false
    }

    #[cfg(not(windows))]
    pub fn check_admin() -> bool {
        false
    }

    fn check_winfsp_dll() -> bool {
        let paths = [
            Path::new(r"C:\Program Files (x86)\WinFsp\bin\winfsp-x64.dll"),
            Path::new(r"C:\Program Files\WinFsp\bin\winfsp-x64.dll"),
            Path::new(r"E:\winfsp-extracted\DYNAMIC\SxS\DYNAMIC\bin\winfsp-x64.dll"),
            Path::new("winfsp-x64.dll"),
        ];
        paths.iter().any(|p| p.exists())
    }

    #[cfg(windows)]
    fn check_winfsp_driver() -> bool {
        use windows::core::HSTRING;
        use windows::Win32::System::Services::{
            CloseServiceHandle, OpenSCManagerW, OpenServiceW, QueryServiceStatus,
            SC_MANAGER_CONNECT, SERVICE_QUERY_STATUS, SERVICE_RUNNING, SERVICE_STATUS,
        };

        unsafe {
            if let Ok(scm) = OpenSCManagerW(None, None, SC_MANAGER_CONNECT) {
                let service_candidates = ["winfsp", "WinFsp.Launcher"];
                for svc_name in &service_candidates {
                    let wide_svc = HSTRING::from(*svc_name);
                    if let Ok(service) = OpenServiceW(scm, &wide_svc, SERVICE_QUERY_STATUS) {
                        let mut status = SERVICE_STATUS::default();
                        let success = QueryServiceStatus(service, &mut status).is_ok();
                        let _ = CloseServiceHandle(service);
                        if success && status.dwCurrentState == SERVICE_RUNNING {
                            let _ = CloseServiceHandle(scm);
                            return true;
                        }
                    }
                }
                let _ = CloseServiceHandle(scm);
            }
        }
        false
    }

    #[cfg(not(windows))]
    fn check_winfsp_driver() -> bool {
        false
    }

    pub fn print_report(report: &DoctorReport) {
        println!("============================================================");
        println!("             cowlink 环境自检与就绪诊断报告                  ");
        println!("============================================================");
        println!("1. 操作系统支持 (Windows):      {}", if report.is_windows { "√ 正常" } else { "× 不支持" });
        println!("2. WinFsp 运行时库 (DLL):        {}", if report.winfsp_dll_found { "√ 找到可用运行时" } else { "× 未检测到" });
        println!("3. WinFsp 内核驱动 (winfsp.sys): {}", if report.winfsp_driver_running { "√ 驱动已启动" } else { "× 未启动 (请先启动 WinFsp 服务)" });
        println!("4. BindFlt 内核桥接 (CowFsBind):  {}", if report.bindflt_service_running { "√ 服务在线 (零拷贝透明目录映射)" } else { "× 未就绪 (需运行 cowfs service-setup 安装)" });
        println!("5. 当前管理员执行权限:          {}", if report.is_admin { "√ 是" } else { "○ 普通用户权限" });
        println!("------------------------------------------------------------");
        if report.winfsp_driver_running && report.bindflt_service_running {
            println!("系统状态: 内核双引擎就绪，随时可执行 cowfs link 零拷贝挂载");
        } else {
            println!("提示: 请运行 a8-devtools 或执行 cowfs service-setup 完成内核服务初始化");
        }
        println!("============================================================");
    }
}
