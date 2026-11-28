import argparse
import ctypes
from ctypes import wintypes
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import threading
import time
import uuid

MAX_MEMORY_MIB = 12288
MEMORY_BUG_EXIT = 86
GUARD_FAILURE_EXIT = 125
MAX_OUTPUT_BYTES = 1024 * 1024
WORKSPACE = Path(__file__).resolve().parent.parent
EVIDENCE_ROOT = WORKSPACE / ".qa" / "LOCAL-NOTION-001"
RUNTIME_ROOT = EVIDENCE_ROOT / "memory-guard-runtime"


class IoCounters(ctypes.Structure):
    _fields_ = [(name, ctypes.c_ulonglong) for name in [
        "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
        "ReadTransferCount", "WriteTransferCount", "OtherTransferCount",
    ]]


class BasicLimits(ctypes.Structure):
    _fields_ = [
        ("PerProcessUserTimeLimit", ctypes.c_longlong),
        ("PerJobUserTimeLimit", ctypes.c_longlong),
        ("LimitFlags", wintypes.DWORD),
        ("MinimumWorkingSetSize", ctypes.c_size_t),
        ("MaximumWorkingSetSize", ctypes.c_size_t),
        ("ActiveProcessLimit", wintypes.DWORD),
        ("Affinity", ctypes.c_size_t),
        ("PriorityClass", wintypes.DWORD),
        ("SchedulingClass", wintypes.DWORD),
    ]


class ExtendedLimits(ctypes.Structure):
    _fields_ = [("BasicLimitInformation", BasicLimits), ("IoInfo", IoCounters)] + [
        (name, ctypes.c_size_t) for name in [
            "ProcessMemoryLimit", "JobMemoryLimit", "PeakProcessMemoryUsed", "PeakJobMemoryUsed",
        ]
    ]


class JobAccounting(ctypes.Structure):
    _fields_ = [(name, ctypes.c_longlong) for name in [
        "TotalUserTime", "TotalKernelTime", "ThisPeriodTotalUserTime", "ThisPeriodTotalKernelTime",
    ]] + [(name, wintypes.DWORD) for name in [
        "TotalPageFaultCount", "TotalProcesses", "ActiveProcesses", "TotalTerminatedProcesses",
    ]]


class CompletionPortAssociation(ctypes.Structure):
    _fields_ = [("CompletionKey", ctypes.c_void_p), ("CompletionPort", wintypes.HANDLE)]


class MemoryStatus(ctypes.Structure):
    _fields_ = [("length", wintypes.DWORD), ("load", wintypes.DWORD)] + [
        (name, ctypes.c_ulonglong) for name in [
            "total_phys", "avail_phys", "total_page", "avail_page",
            "total_virtual", "avail_virtual", "avail_extended",
        ]
    ]


def native_functions():
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    native = ctypes.WinDLL("ntdll")
    declarations = [
        ("CreateJobObjectW", [wintypes.LPVOID, wintypes.LPCWSTR], wintypes.HANDLE),
        ("SetInformationJobObject", [wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID, wintypes.DWORD], wintypes.BOOL),
        ("QueryInformationJobObject", [wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID, wintypes.DWORD, wintypes.LPVOID], wintypes.BOOL),
        ("AssignProcessToJobObject", [wintypes.HANDLE, wintypes.HANDLE], wintypes.BOOL),
        ("TerminateJobObject", [wintypes.HANDLE, wintypes.UINT], wintypes.BOOL),
        ("CloseHandle", [wintypes.HANDLE], wintypes.BOOL),
        ("CreateIoCompletionPort", [wintypes.HANDLE, wintypes.HANDLE, ctypes.c_size_t, wintypes.DWORD], wintypes.HANDLE),
        ("GetQueuedCompletionStatus", [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD), ctypes.POINTER(ctypes.c_size_t), ctypes.POINTER(ctypes.c_void_p), wintypes.DWORD], wintypes.BOOL),
        ("CreateMutexW", [wintypes.LPVOID, wintypes.BOOL, wintypes.LPCWSTR], wintypes.HANDLE),
        ("ReleaseMutex", [wintypes.HANDLE], wintypes.BOOL),
        ("WaitForSingleObject", [wintypes.HANDLE, wintypes.DWORD], wintypes.DWORD),
        ("GlobalMemoryStatusEx", [ctypes.POINTER(MemoryStatus)], wintypes.BOOL),
        ("GetProcessIoCounters", [wintypes.HANDLE, ctypes.POINTER(IoCounters)], wintypes.BOOL),
        ("OpenProcess", [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD], wintypes.HANDLE),
    ]
    for name, argument_types, result_type in declarations:
        function = getattr(kernel, name)
        function.argtypes = argument_types
        function.restype = result_type
    native.NtResumeProcess.argtypes = [wintypes.HANDLE]
    native.NtResumeProcess.restype = wintypes.LONG
    native.NtQuerySystemInformation.argtypes = [wintypes.ULONG, wintypes.LPVOID, wintypes.ULONG, ctypes.POINTER(wintypes.ULONG)]
    native.NtQuerySystemInformation.restype = wintypes.LONG
    return kernel, native


def physical_path(value, *, file_required=False):
    original = Path(value)
    if not original.is_absolute() or "appdata" in [part.lower() for part in original.parts]:
        raise ValueError("Use an absolute physical path outside AppData")
    for part in [original, *original.parents]:
        if part.is_symlink() or part.is_junction():
            raise ValueError("Symbolic links and junctions are not allowed on guarded execution paths")
    result = original.resolve(strict=True)
    if file_required and not result.is_file():
        raise ValueError("The executable must be an existing physical file")
    return result


def memory_snapshot(kernel):
    snapshot = MemoryStatus()
    snapshot.length = ctypes.sizeof(snapshot)
    if not kernel.GlobalMemoryStatusEx(ctypes.byref(snapshot)):
        raise ctypes.WinError(ctypes.get_last_error())
    return {
        "available_physical_bytes": snapshot.avail_phys,
        "total_physical_bytes": snapshot.total_phys,
        "available_commit_bytes": snapshot.avail_page,
        "commit_limit_bytes": snapshot.total_page,
    }


def ntfc_snapshot(native, buffer):
    returned = wintypes.ULONG()
    status = native.NtQuerySystemInformation(22, buffer, ctypes.sizeof(buffer), ctypes.byref(returned))
    if status:
        raise RuntimeError(f"Exact NtFC pool snapshot unavailable: {status & 0xffffffff:08x}")
    count = struct.unpack_from("<I", buffer, 0)[0]
    if 8 + count * 40 > ctypes.sizeof(buffer):
        raise RuntimeError("Pool snapshot exceeds the bounded buffer")
    for index in range(count):
        offset = 8 + index * 40
        if ctypes.string_at(ctypes.addressof(buffer) + offset, 4) == b"NtFC":
            return struct.unpack_from("<Q", buffer, offset + 32)[0]
    return 0


def run_guarded(command, cwd, memory_mib, timeout):
    kernel, native = native_functions()
    limit_bytes = memory_mib * 1024 * 1024
    accounting_reserve = min(16 * 1024 * 1024, limit_bytes // 8)
    native_limit_bytes = limit_bytes - accounting_reserve
    job_query_name = "Local\\LifeAtlasMemoryGuardOwned-" + uuid.uuid4().hex
    report = {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "command": command,
        "cwd": str(cwd),
        "memory_metric": "aggregate committed virtual memory of the newly owned process tree",
        "hard_limit_bytes": limit_bytes,
        "native_job_memory_limit_bytes": native_limit_bytes,
        "accounting_reserve_bytes": accounting_reserve,
        "job_query_name": job_query_name,
        "user_maximum_bytes": MAX_MEMORY_MIB * 1024 * 1024,
        "reason": "guard_setup_failed",
        "exit_code": GUARD_FAILURE_EXIT,
        "owned_pid": None,
        "owned_descendant_pids": [],
        "memory_limit_notifications": [],
        "job_assigned_before_execution": False,
        "owned_process_reaped": False,
    }
    mutex_name = "Local\\LifeAtlasMemoryGuard-" + hashlib.sha256(str(cwd).lower().encode()).hexdigest()[:24]
    mutex = kernel.CreateMutexW(None, False, mutex_name)
    job = None
    completion = None
    process = None
    assigned = False
    acquired = False
    threads = []
    chunks = [[], []]
    counts = [0, 0]
    output_lock = threading.Lock()
    overflow = threading.Event()
    pool_buffer = ctypes.create_string_buffer(4 * 1024 * 1024)
    started = time.monotonic()
    child_ids = set()
    exited_ids = set()

    def drain(stream, stream_index):
        try:
            while True:
                data = os.read(stream.fileno(), 65536)
                if not data:
                    break
                with output_lock:
                    available = max(0, MAX_OUTPUT_BYTES - sum(counts))
                    kept = data[:available]
                    if kept:
                        chunks[stream_index].append(kept)
                        counts[stream_index] += len(kept)
                    if len(data) > available:
                        overflow.set()
        except (OSError, ValueError):
            return

    def read_notifications(wait_ms=0):
        while True:
            message = wintypes.DWORD()
            key = ctypes.c_size_t()
            pointer = ctypes.c_void_p()
            success = kernel.GetQueuedCompletionStatus(completion, ctypes.byref(message), ctypes.byref(key), ctypes.byref(pointer), wait_ms)
            if not success:
                error = ctypes.get_last_error()
                if error == 258:
                    return
                raise ctypes.WinError(error)
            wait_ms = 0
            process_id = pointer.value or 0
            if message.value == 6:
                child_ids.add(process_id)
            elif message.value in (7, 8):
                exited_ids.add(process_id)
            elif message.value in (9, 10):
                report["memory_limit_notifications"].append({"kind": "process_memory" if message.value == 9 else "job_memory", "pid": process_id})

    try:
        if not mutex:
            raise ctypes.WinError(ctypes.get_last_error())
        wait_result = kernel.WaitForSingleObject(mutex, 0)
        if wait_result not in (0, 0x80):
            report["reason"] = "workspace_runtime_busy"
            return report, b"", b""
        acquired = True
        report["system_before"] = memory_snapshot(kernel)
        if report["system_before"]["available_physical_bytes"] < 1024 ** 3 or report["system_before"]["available_commit_bytes"] < 2 * 1024 ** 3:
            report["reason"] = "insufficient_system_headroom"
            return report, b"", b""
        report["ntfc_before"] = ntfc_snapshot(native, pool_buffer)
        report["ntfc_peak"] = report["ntfc_before"]
        job = kernel.CreateJobObjectW(None, job_query_name)
        if not job:
            raise ctypes.WinError(ctypes.get_last_error())
        if ctypes.get_last_error() == 183:
            raise RuntimeError("The unique owned JobObject name already exists")
        limits = ExtendedLimits()
        limits.BasicLimitInformation.LimitFlags = 0x2000 | 0x200 | 0x100
        limits.JobMemoryLimit = native_limit_bytes
        limits.ProcessMemoryLimit = native_limit_bytes
        if not kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            raise ctypes.WinError(ctypes.get_last_error())
        completion = kernel.CreateIoCompletionPort(wintypes.HANDLE(-1), None, 0, 1)
        if not completion:
            raise ctypes.WinError(ctypes.get_last_error())
        association = CompletionPortAssociation(ctypes.c_void_p(1), completion)
        if not kernel.SetInformationJobObject(job, 7, ctypes.byref(association), ctypes.sizeof(association)):
            raise ctypes.WinError(ctypes.get_last_error())
        startup = subprocess.STARTUPINFO()
        startup.dwFlags = subprocess.STARTF_USESHOWWINDOW
        startup.wShowWindow = 0
        environment = {**os.environ, "TEMP": str(RUNTIME_ROOT), "TMP": str(RUNTIME_ROOT), "LIFE_ATLAS_MEMORY_JOB_QUERY_NAME": job_query_name}
        process = subprocess.Popen(command, cwd=str(cwd), env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=0x4 | subprocess.CREATE_NO_WINDOW, startupinfo=startup)
        report["owned_pid"] = process.pid
        if not kernel.AssignProcessToJobObject(job, wintypes.HANDLE(int(process._handle))):
            raise ctypes.WinError(ctypes.get_last_error())
        assigned = True
        report["job_assigned_before_execution"] = True
        for stream_index, stream in enumerate([process.stdout, process.stderr]):
            thread = threading.Thread(target=drain, args=(stream, stream_index), daemon=True)
            thread.start()
            threads.append(thread)
        status = native.NtResumeProcess(wintypes.HANDLE(int(process._handle)))
        if status:
            raise RuntimeError(f"Cannot resume owned process: {status & 0xffffffff:08x}")
        while True:
            read_notifications(50)
            if report["memory_limit_notifications"]:
                report["reason"] = "memory_limit_bug"
                report["exit_code"] = MEMORY_BUG_EXIT
                break
            if overflow.is_set():
                report["reason"] = "diagnostic_output_limit_bug"
                report["exit_code"] = MEMORY_BUG_EXIT
                break
            current_ntfc = ntfc_snapshot(native, pool_buffer)
            report["ntfc_peak"] = max(report["ntfc_peak"], current_ntfc)
            if current_ntfc > report["ntfc_before"] + 16 * 1024 * 1024:
                report["reason"] = "ntfc_growth_bug"
                report["exit_code"] = MEMORY_BUG_EXIT
                break
            system = memory_snapshot(kernel)
            if system["available_physical_bytes"] < 768 * 1024 * 1024 or system["available_commit_bytes"] < 1024 ** 3:
                report["reason"] = "system_memory_pressure_bug"
                report["exit_code"] = MEMORY_BUG_EXIT
                break
            accounting = JobAccounting()
            if not kernel.QueryInformationJobObject(job, 1, ctypes.byref(accounting), ctypes.sizeof(accounting), None):
                raise ctypes.WinError(ctypes.get_last_error())
            if process.poll() is not None and accounting.ActiveProcesses == 0:
                read_notifications(50)
                report["reason"] = "memory_limit_bug" if report["memory_limit_notifications"] else "exited"
                report["exit_code"] = MEMORY_BUG_EXIT if report["memory_limit_notifications"] else process.returncode if 0 <= process.returncode <= 255 else 1
                break
            if time.monotonic() - started >= timeout:
                report["reason"] = "timeout"
                report["exit_code"] = 124
                break
    except KeyboardInterrupt:
        report["reason"] = "interrupted"
        report["exit_code"] = 130
    except Exception as error:
        report["error"] = str(error)
    finally:
        if job:
            recorded_limits = ExtendedLimits()
            if kernel.QueryInformationJobObject(job, 9, ctypes.byref(recorded_limits), ctypes.sizeof(recorded_limits), None):
                report["peak_job_commit_bytes"] = recorded_limits.PeakJobMemoryUsed
                report["peak_process_commit_bytes"] = recorded_limits.PeakProcessMemoryUsed
            active = JobAccounting()
            if not kernel.QueryInformationJobObject(job, 1, ctypes.byref(active), ctypes.sizeof(active), None):
                report["owned_job_cleanup_error"] = str(ctypes.WinError(ctypes.get_last_error()))
                report["exit_code"] = GUARD_FAILURE_EXIT
            elif active.ActiveProcesses:
                # Query-only child handles can outlive our handle. Terminate this
                # exact owned job explicitly before closing it, never by PID/name.
                report["explicit_owned_job_termination"] = bool(kernel.TerminateJobObject(job, report["exit_code"] or GUARD_FAILURE_EXIT))
                if not report["explicit_owned_job_termination"]:
                    report["owned_job_cleanup_error"] = str(ctypes.WinError(ctypes.get_last_error()))
                    report["exit_code"] = GUARD_FAILURE_EXIT
            kernel.CloseHandle(job)
        if process:
            if not assigned and process.poll() is None:
                process.terminate()
            process.wait(timeout=10)
            for thread in threads:
                thread.join(timeout=2)
            if completion:
                read_notifications(50)
            for stream in [process.stdout, process.stderr]:
                stream.close()
            report["owned_process_reaped"] = process.poll() is not None
            report["command_exit_code"] = process.returncode
            counters = IoCounters()
            if kernel.GetProcessIoCounters(wintypes.HANDLE(int(process._handle)), ctypes.byref(counters)):
                report["root_process_io"] = {name: getattr(counters, name) for name, _ in IoCounters._fields_}
        if report["memory_limit_notifications"]:
            report["reason"] = "memory_limit_bug"
            report["exit_code"] = MEMORY_BUG_EXIT
        report["owned_descendant_pids"] = sorted(child_ids - {report["owned_pid"]})
        remaining = []
        for process_id in report["owned_descendant_pids"]:
            handle = kernel.OpenProcess(0x101000, False, process_id)
            if handle:
                try:
                    if kernel.WaitForSingleObject(handle, 2000) != 0:
                        remaining.append(process_id)
                finally:
                    kernel.CloseHandle(handle)
        report["remaining_owned_descendants"] = remaining
        report["owned_descendants_reaped"] = not remaining
        if remaining and report["exit_code"] == 0:
            report["reason"] = "owned_cleanup_incomplete"
            report["exit_code"] = GUARD_FAILURE_EXIT
        if report.get("peak_job_commit_bytes", 0) > limit_bytes:
            report["reason"] = "memory_limit_bug"
            report["exit_code"] = MEMORY_BUG_EXIT
        report["job_exit_notifications"] = sorted(exited_ids)
        if completion:
            kernel.CloseHandle(completion)
        if acquired:
            kernel.ReleaseMutex(mutex)
        if mutex:
            kernel.CloseHandle(mutex)
        report["elapsed_seconds"] = round(time.monotonic() - started, 3)
        report["captured_output_bytes"] = sum(counts)
        if "ntfc_before" in report:
            report["ntfc_after"] = ntfc_snapshot(native, pool_buffer)
        report["system_after"] = memory_snapshot(kernel)
    return report, b"".join(chunks[0]), b"".join(chunks[1])


def main():
    parser = argparse.ArgumentParser(description="Run a new process tree with a hard committed-memory ceiling, at most 12 GiB")
    parser.add_argument("--memory-mib", type=int, default=MAX_MEMORY_MIB)
    parser.add_argument("--timeout", type=int, default=600)
    parser.add_argument("--output")
    parser.add_argument("--cwd", default=str(WORKSPACE))
    parser.add_argument("command", nargs=argparse.REMAINDER)
    options = parser.parse_args()
    if sys.platform != "win32":
        raise ValueError("This command requires Windows JobObjects")
    if not 64 <= options.memory_mib <= MAX_MEMORY_MIB or not 1 <= options.timeout <= 3600:
        raise ValueError("Memory must be 64..12288 MiB and timeout must be 1..3600 seconds")
    cwd = physical_path(options.cwd)
    if cwd != WORKSPACE:
        raise ValueError("The guarded workspace must match this project")
    command = options.command[1:] if options.command[:1] == ["--"] else options.command
    if not command:
        raise ValueError("An explicit command is required after --")
    command[0] = str(physical_path(command[0], file_required=True))
    output = Path(options.output).resolve() if options.output else EVIDENCE_ROOT / f"memory-guard-{datetime.now(timezone.utc):%Y%m%dT%H%M%S}-{uuid.uuid4().hex[:8]}.json"
    if not output.is_relative_to(EVIDENCE_ROOT) or output.suffix != ".json":
        raise ValueError("Evidence must be a new JSON file under .qa/LOCAL-NOTION-001")
    output.parent.mkdir(parents=True, exist_ok=True)
    physical_path(output.parent)
    RUNTIME_ROOT.mkdir(parents=True, exist_ok=True)
    physical_path(RUNTIME_ROOT)
    stdout_path = output.with_suffix(".stdout.log")
    stderr_path = output.with_suffix(".stderr.log")
    if any(target.exists() for target in [output, stdout_path, stderr_path]):
        raise FileExistsError("Evidence already exists; use a new output name")
    report, stdout, stderr = run_guarded(command, cwd, options.memory_mib, options.timeout)
    report.update({"stdout_path": str(stdout_path), "stderr_path": str(stderr_path)})
    stdout_path.write_bytes(stdout)
    stderr_path.write_bytes(stderr)
    with output.open("x", encoding="utf-8") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    print(f"[guard:memory] {report['reason']} exit={report['exit_code']} cap={options.memory_mib}MiB peak={report.get('peak_job_commit_bytes', 0)} bytes owned_pid={report['owned_pid']}")
    print(f"[guard:memory] evidence={output}")
    print("\n".join(stdout.decode("utf-8", errors="replace").splitlines()[-20:]))
    print("\n".join(stderr.decode("utf-8", errors="replace").splitlines()[-20:]), file=sys.stderr)
    return report["exit_code"]


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError) as error:
        print(f"[guard:memory] setup failed: {error}", file=sys.stderr)
        raise SystemExit(GUARD_FAILURE_EXIT)
