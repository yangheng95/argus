#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(windows)]
mod windows_helper {
    use serde::Deserialize;
    use std::{
        collections::BTreeMap,
        env,
        ffi::c_void,
        fs,
        os::windows::ffi::OsStrExt,
        path::PathBuf,
        ptr::null,
    };
    use windows_sys::Win32::{
        Foundation::{CloseHandle, GetLastError, HANDLE, INVALID_HANDLE_VALUE},
        System::{
            Console::{GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE},
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                JobObjectExtendedLimitInformation,
            },
            Threading::{
                CreateProcessW, GetExitCodeProcess, ResumeThread, WaitForSingleObject,
                CREATE_NO_WINDOW, CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, INFINITE, PROCESS_INFORMATION,
                STARTF_USESTDHANDLES, STARTUPINFOW,
            },
        },
    };

    #[derive(Deserialize)]
    struct Request {
        command: String,
        shell: String,
        cwd: Option<String>,
        env: BTreeMap<String, String>,
        pid_file: String,
    }

    struct Handle(HANDLE);

    impl Drop for Handle {
        fn drop(&mut self) {
            if !self.0.is_null() && self.0 != INVALID_HANDLE_VALUE {
                unsafe {
                    CloseHandle(self.0);
                }
            }
        }
    }

    fn wide_null(value: &str) -> Vec<u16> {
        std::ffi::OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    fn quote_arg(value: &str) -> String {
        if value.is_empty() {
            return "\"\"".to_string();
        }
        let needs_quotes = value.chars().any(|c| c.is_whitespace() || c == '"');
        if !needs_quotes {
            return value.to_string();
        }
        let mut out = String::from("\"");
        let mut backslashes = 0;
        for ch in value.chars() {
            if ch == '\\' {
                backslashes += 1;
                continue;
            }
            if ch == '"' {
                out.push_str(&"\\".repeat(backslashes * 2 + 1));
                out.push('"');
                backslashes = 0;
                continue;
            }
            out.push_str(&"\\".repeat(backslashes));
            backslashes = 0;
            out.push(ch);
        }
        out.push_str(&"\\".repeat(backslashes * 2));
        out.push('"');
        out
    }

    fn shell_args(shell: &str, command: &str) -> Vec<String> {
        let name = PathBuf::from(shell)
            .file_stem()
            .and_then(|v| v.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        match name.as_str() {
            "cmd" => vec!["/d".into(), "/s".into(), "/c".into(), command.into()],
            "powershell" | "pwsh" => vec!["-NoProfile".into(), "-Command".into(), command.into()],
            _ => vec!["-c".into(), command.into()],
        }
    }

    fn environment_block(envs: &BTreeMap<String, String>) -> Vec<u16> {
        let mut block = Vec::new();
        for (key, value) in envs {
            if key.contains('=') || key.is_empty() {
                continue;
            }
            block.extend(std::ffi::OsStr::new(&format!("{key}={value}")).encode_wide());
            block.push(0);
        }
        block.push(0);
        block
    }

    fn create_job() -> Result<Handle, String> {
        let job = unsafe { CreateJobObjectW(null(), null()) };
        if job.is_null() || job == INVALID_HANDLE_VALUE {
            return Err("CreateJobObjectW failed".into());
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let ok = unsafe {
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if ok == 0 {
            unsafe {
                CloseHandle(job);
            }
            return Err("SetInformationJobObject(KILL_ON_JOB_CLOSE) failed".into());
        }
        Ok(Handle(job))
    }

    fn run_request(request: Request) -> Result<u32, String> {
        let job = create_job()?;
        let args = shell_args(&request.shell, &request.command);
        let command_line = std::iter::once(request.shell.as_str())
            .chain(args.iter().map(String::as_str))
            .map(quote_arg)
            .collect::<Vec<_>>()
            .join(" ");
        let mut command_line_w = wide_null(&command_line);
        let application_w = wide_null(&request.shell);
        let cwd_w = request.cwd.as_deref().map(wide_null);
        let mut env_block = environment_block(&request.env);

        let mut startup: STARTUPINFOW = unsafe { std::mem::zeroed() };
        startup.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
        startup.dwFlags = STARTF_USESTDHANDLES;
        startup.hStdInput = unsafe { GetStdHandle(STD_INPUT_HANDLE) };
        startup.hStdOutput = unsafe { GetStdHandle(STD_OUTPUT_HANDLE) };
        startup.hStdError = unsafe { GetStdHandle(STD_ERROR_HANDLE) };

        let mut process_info: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
        let created = unsafe {
            CreateProcessW(
                application_w.as_ptr(),
                command_line_w.as_mut_ptr(),
                null(),
                null(),
                1,
                CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT,
                env_block.as_mut_ptr() as *mut c_void,
                cwd_w.as_ref().map(|v| v.as_ptr()).unwrap_or(null()),
                &startup,
                &mut process_info,
            )
        };
        if created == 0 {
            let err = unsafe { GetLastError() };
            return Err(format!("CreateProcessW failed for shell {} (win32={err})", request.shell));
        }

        let process = Handle(process_info.hProcess);
        let thread = Handle(process_info.hThread);

        let assigned = unsafe { AssignProcessToJobObject(job.0, process.0) };
        if assigned == 0 {
            return Err("AssignProcessToJobObject failed".into());
        }

        fs::write(&request.pid_file, process_info.dwProcessId.to_string())
            .map_err(|err| format!("write pid file failed: {err}"))?;

        let resumed = unsafe { ResumeThread(thread.0) };
        if resumed == u32::MAX {
            return Err("ResumeThread failed".into());
        }

        unsafe {
            WaitForSingleObject(process.0, INFINITE);
        }
        let mut code = 1u32;
        unsafe {
            GetExitCodeProcess(process.0, &mut code);
        }
        drop(job);
        Ok(code)
    }

    pub fn main() {
        let mut args = env::args().skip(1);
        let request_path = match (args.next().as_deref(), args.next()) {
            (Some("--request"), Some(path)) => path,
            _ => {
                eprintln!("usage: opencorvus-process-supervisor --request <json>");
                std::process::exit(2);
            }
        };
        let body = match fs::read_to_string(&request_path) {
            Ok(body) => body,
            Err(err) => {
                eprintln!("read request failed: {err}");
                std::process::exit(2);
            }
        };
        let request: Request = match serde_json::from_str(&body) {
            Ok(request) => request,
            Err(err) => {
                eprintln!("parse request failed: {err}");
                std::process::exit(2);
            }
        };
        match run_request(request) {
            Ok(code) => std::process::exit(code as i32),
            Err(err) => {
                eprintln!("opencorvus process supervisor failed: {err}");
                std::process::exit(125);
            }
        }
    }
}

#[cfg(windows)]
fn main() {
    windows_helper::main();
}

#[cfg(not(windows))]
fn main() {
    eprintln!("opencorvus-process-supervisor is only supported on Windows");
    std::process::exit(125);
}
