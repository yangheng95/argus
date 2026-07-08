#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(windows)]
mod windows_helper {
    use serde::Deserialize;
    use std::{
        collections::BTreeMap, env, ffi::c_void, fs, os::windows::ffi::OsStrExt, path::PathBuf,
        ptr::null,
    };
    use windows_sys::Win32::{
        Foundation::{
            CloseHandle, GetLastError, ERROR_INVALID_PARAMETER, HANDLE, INVALID_HANDLE_VALUE,
            WAIT_OBJECT_0,
        },
        System::{
            Console::{GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE},
            Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
                TH32CS_SNAPPROCESS,
            },
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
                SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            },
            Threading::{
                CreateProcessW, GetExitCodeProcess, OpenProcess, ResumeThread, TerminateProcess,
                WaitForSingleObject, CREATE_NO_WINDOW, CREATE_SUSPENDED,
                CREATE_UNICODE_ENVIRONMENT, INFINITE, PROCESS_INFORMATION, PROCESS_SYNCHRONIZE,
                PROCESS_TERMINATE, STARTF_USESTDHANDLES, STARTUPINFOW,
            },
        },
    };

    #[derive(Deserialize)]
    #[serde(tag = "kind", rename_all = "snake_case")]
    enum Request {
        Shell {
            command: String,
            shell: String,
            cwd: Option<String>,
            env: BTreeMap<String, String>,
            pid_file: String,
        },
        Command {
            executable: String,
            args: Vec<String>,
            cwd: Option<String>,
            env: BTreeMap<String, String>,
            pid_file: String,
        },
    }

    struct LaunchRequest {
        application: String,
        command_line: String,
        cwd: Option<String>,
        env: BTreeMap<String, String>,
        pid_file: String,
    }

    #[derive(Clone)]
    struct ProcessInfo {
        pid: u32,
        parent_pid: u32,
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

    fn launch_request(request: Request) -> LaunchRequest {
        match request {
            Request::Shell {
                command,
                shell,
                cwd,
                env,
                pid_file,
            } => {
                let args = shell_args(&shell, &command);
                let command_line = std::iter::once(shell.as_str())
                    .chain(args.iter().map(String::as_str))
                    .map(quote_arg)
                    .collect::<Vec<_>>()
                    .join(" ");
                LaunchRequest {
                    application: shell,
                    command_line,
                    cwd,
                    env,
                    pid_file,
                }
            }
            Request::Command {
                executable,
                args,
                cwd,
                env,
                pid_file,
            } => {
                let command_line = std::iter::once(executable.as_str())
                    .chain(args.iter().map(String::as_str))
                    .map(quote_arg)
                    .collect::<Vec<_>>()
                    .join(" ");
                LaunchRequest {
                    application: executable,
                    command_line,
                    cwd,
                    env,
                    pid_file,
                }
            }
        }
    }

    fn run_request(request: Request) -> Result<u32, String> {
        let request = launch_request(request);
        let job = create_job()?;
        let mut command_line_w = wide_null(&request.command_line);
        let application_w = wide_null(&request.application);
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
            return Err(format!(
                "CreateProcessW failed for {} (win32={err})",
                request.application
            ));
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

    fn snapshot_processes() -> Result<Vec<ProcessInfo>, String> {
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if snapshot == INVALID_HANDLE_VALUE {
            let err = unsafe { GetLastError() };
            return Err(format!("CreateToolhelp32Snapshot failed (win32={err})"));
        }
        let snapshot = Handle(snapshot);
        let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

        let first = unsafe { Process32FirstW(snapshot.0, &mut entry) };
        if first == 0 {
            let err = unsafe { GetLastError() };
            return Err(format!("Process32FirstW failed (win32={err})"));
        }

        let mut processes = Vec::new();
        loop {
            processes.push(ProcessInfo {
                pid: entry.th32ProcessID,
                parent_pid: entry.th32ParentProcessID,
            });
            let next = unsafe { Process32NextW(snapshot.0, &mut entry) };
            if next == 0 {
                break;
            }
        }
        Ok(processes)
    }

    fn descendant_pids(root_pid: u32, processes: &[ProcessInfo]) -> Vec<u32> {
        let mut result = Vec::new();
        let mut stack = vec![root_pid];
        while let Some(parent_pid) = stack.pop() {
            for process in processes
                .iter()
                .filter(|process| process.parent_pid == parent_pid)
            {
                if process.pid == root_pid || result.contains(&process.pid) {
                    continue;
                }
                result.push(process.pid);
                stack.push(process.pid);
            }
        }
        result
    }

    fn open_terminable_process(pid: u32) -> Result<Option<Handle>, String> {
        let handle = unsafe { OpenProcess(PROCESS_TERMINATE | PROCESS_SYNCHRONIZE, 0, pid) };
        if handle.is_null() {
            let err = unsafe { GetLastError() };
            if err == ERROR_INVALID_PARAMETER {
                return Ok(None);
            }
            return Err(format!("OpenProcess failed for pid {pid} (win32={err})"));
        }
        Ok(Some(Handle(handle)))
    }

    fn terminate_pid(pid: u32) -> Result<(), String> {
        let Some(process) = open_terminable_process(pid)? else {
            return Ok(());
        };

        let initial_state = unsafe { WaitForSingleObject(process.0, 0) };
        if initial_state == WAIT_OBJECT_0 {
            return Ok(());
        }

        let terminated = unsafe { TerminateProcess(process.0, 1) };
        if terminated == 0 {
            let err = unsafe { GetLastError() };
            let next_state = unsafe { WaitForSingleObject(process.0, 0) };
            if next_state == WAIT_OBJECT_0 {
                return Ok(());
            }
            return Err(format!(
                "TerminateProcess failed for pid {pid} (win32={err})"
            ));
        }

        let waited = unsafe { WaitForSingleObject(process.0, 1000) };
        if waited != WAIT_OBJECT_0 {
            return Err(format!(
                "process {pid} did not exit after TerminateProcess (wait={waited})"
            ));
        }
        Ok(())
    }

    fn terminate_process_tree(pid: u32) -> Result<(), String> {
        let processes = snapshot_processes()?;
        let mut targets = descendant_pids(pid, &processes);
        targets.reverse();
        targets.push(pid);
        for target in targets {
            terminate_pid(target)?;
        }
        Ok(())
    }

    pub fn main() {
        let mut args = env::args().skip(1);
        match (args.next().as_deref(), args.next()) {
            (Some("--request"), Some(request_path)) => {
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
            (Some("--kill-tree"), Some(pid)) => {
                let pid = match pid.parse::<u32>() {
                    Ok(pid) if pid > 0 => pid,
                    _ => {
                        eprintln!("invalid process id for --kill-tree");
                        std::process::exit(2);
                    }
                };
                match terminate_process_tree(pid) {
                    Ok(()) => std::process::exit(0),
                    Err(err) => {
                        eprintln!("opencorvus process tree cleanup failed: {err}");
                        std::process::exit(125);
                    }
                }
            }
            _ => {
                eprintln!(
                    "usage: opencorvus-process-supervisor --request <json> | --kill-tree <pid>"
                );
                std::process::exit(2);
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
