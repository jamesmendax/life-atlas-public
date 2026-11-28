"""File-scoped release-test broker: prove a suspended process before running it."""

import base64
import ctypes
from ctypes import wintypes
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time

PROTOCOL = 1
MAX_FRAME = 65536
MAX_OUTPUT = 8 * 1024 * 1024
CHUNK = 16384
CREATION_FLAGS = 0x08080404  # NO_WINDOW | EXTENDED_STARTUPINFO | UNICODE_ENV | SUSPENDED
FILETIME_EPOCH = 116444736000000000
SMOKE_CODE = "import sys; sys.stdout.buffer.write(b'native-fast-exit\\n'); sys.stderr.buffer.write(b'native-fast-diagnostic\\n'); sys.exit(7)"
SMOKE_ARGS = ["-I", "-B", "-c", SMOKE_CODE, "space value", 'quote"value', "trail\\", "中文"]
REPOSITORY = Path(os.path.abspath(__file__)).parents[2]
ULONG_PTR = ctypes.c_size_t
DIAGNOSTIC_PHASE = "native-functions"


def phase(value):
    global DIAGNOSTIC_PHASE
    DIAGNOSTIC_PHASE = value


class SecurityAttributes(ctypes.Structure):
    _fields_ = [("length", wintypes.DWORD), ("descriptor", wintypes.LPVOID), ("inherit", wintypes.BOOL)]


class StartupInfo(ctypes.Structure):
    _fields_ = [
        ("cb", wintypes.DWORD), ("reserved", wintypes.LPWSTR),
        ("desktop", wintypes.LPWSTR), ("title", wintypes.LPWSTR),
        ("x", wintypes.DWORD), ("y", wintypes.DWORD),
        ("xsize", wintypes.DWORD), ("ysize", wintypes.DWORD),
        ("xchars", wintypes.DWORD), ("ychars", wintypes.DWORD),
        ("fill", wintypes.DWORD), ("flags", wintypes.DWORD),
        ("show", wintypes.WORD), ("reserved_bytes", wintypes.WORD),
        ("reserved_pointer", ctypes.POINTER(ctypes.c_byte)),
        ("stdin", wintypes.HANDLE), ("stdout", wintypes.HANDLE), ("stderr", wintypes.HANDLE),
    ]


class StartupInfoEx(ctypes.Structure):
    _fields_ = [("startup", StartupInfo), ("attributes", wintypes.LPVOID)]


class ProcessInformation(ctypes.Structure):
    _fields_ = [("process", wintypes.HANDLE), ("thread", wintypes.HANDLE), ("pid", wintypes.DWORD), ("tid", wintypes.DWORD)]


class BasicInformation(ctypes.Structure):
    _fields_ = [
        ("reserved1", wintypes.LPVOID), ("peb", wintypes.LPVOID),
        ("reserved2", wintypes.LPVOID * 2),
        ("pid", ULONG_PTR), ("parent_pid", ULONG_PTR),
    ]


class UnicodeString(ctypes.Structure):
    _fields_ = [("length", wintypes.USHORT), ("maximum", wintypes.USHORT), ("buffer", wintypes.LPVOID)]


def native_functions():
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    native = ctypes.WinDLL("ntdll", use_last_error=True)
    shell = ctypes.WinDLL("shell32", use_last_error=True)
    declarations = [
        ("GetCurrentProcess", [], wintypes.HANDLE),
        ("GetProcessId", [wintypes.HANDLE], wintypes.DWORD),
        ("GetThreadId", [wintypes.HANDLE], wintypes.DWORD),
        ("GetProcessIdOfThread", [wintypes.HANDLE], wintypes.DWORD),
        ("GetStdHandle", [wintypes.DWORD], wintypes.HANDLE),
        ("GetProcessTimes", [wintypes.HANDLE, *([ctypes.POINTER(wintypes.FILETIME)] * 4)], wintypes.BOOL),
        ("QueryFullProcessImageNameW", [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)], wintypes.BOOL),
        ("IsProcessInJob", [wintypes.HANDLE, wintypes.HANDLE, ctypes.POINTER(wintypes.BOOL)], wintypes.BOOL),
        ("CreatePipe", [ctypes.POINTER(wintypes.HANDLE), ctypes.POINTER(wintypes.HANDLE), ctypes.POINTER(SecurityAttributes), wintypes.DWORD], wintypes.BOOL),
        ("SetHandleInformation", [wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD], wintypes.BOOL),
        ("CreateFileW", [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(SecurityAttributes), wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE], wintypes.HANDLE),
        ("InitializeProcThreadAttributeList", [wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(ctypes.c_size_t)], wintypes.BOOL),
        ("UpdateProcThreadAttribute", [wintypes.LPVOID, wintypes.DWORD, ULONG_PTR, wintypes.LPVOID, ctypes.c_size_t, wintypes.LPVOID, wintypes.LPVOID], wintypes.BOOL),
        ("DeleteProcThreadAttributeList", [wintypes.LPVOID], None),
        ("CreateProcessW", [wintypes.LPCWSTR, wintypes.LPWSTR, wintypes.LPVOID, wintypes.LPVOID, wintypes.BOOL, wintypes.DWORD, wintypes.LPVOID, wintypes.LPCWSTR, ctypes.POINTER(StartupInfoEx), ctypes.POINTER(ProcessInformation)], wintypes.BOOL),
        ("ResumeThread", [wintypes.HANDLE], wintypes.DWORD),
        ("WaitForSingleObject", [wintypes.HANDLE, wintypes.DWORD], wintypes.DWORD),
        ("GetExitCodeProcess", [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)], wintypes.BOOL),
        ("TerminateProcess", [wintypes.HANDLE, wintypes.UINT], wintypes.BOOL),
        ("PeekNamedPipe", [wintypes.HANDLE, wintypes.LPVOID, wintypes.DWORD, wintypes.LPVOID, ctypes.POINTER(wintypes.DWORD), wintypes.LPVOID], wintypes.BOOL),
        ("ReadFile", [wintypes.HANDLE, wintypes.LPVOID, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD), wintypes.LPVOID], wintypes.BOOL),
        ("CloseHandle", [wintypes.HANDLE], wintypes.BOOL),
        ("LocalFree", [wintypes.HLOCAL], wintypes.HLOCAL),
    ]
    for name, arguments, result in declarations:
        function = getattr(kernel, name)
        function.argtypes = arguments
        function.restype = result
    native.NtQueryInformationProcess.argtypes = [wintypes.HANDLE, wintypes.ULONG, wintypes.LPVOID, wintypes.ULONG, ctypes.POINTER(wintypes.ULONG)]
    native.NtQueryInformationProcess.restype = wintypes.LONG
    shell.CommandLineToArgvW.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(ctypes.c_int)]
    shell.CommandLineToArgvW.restype = ctypes.POINTER(wintypes.LPWSTR)
    return kernel, native, shell


def require_native(success):
    if not success:
        raise ctypes.WinError(ctypes.get_last_error())


def physical_path(value, *, file=False):
    if not isinstance(value, str) or not value or any(character in value for character in "\0\r\n"):
        raise ValueError("Invalid physical path")
    path = Path(value)
    if not path.is_absolute() or value.startswith(("\\\\?\\", "\\\\.\\")) or "appdata" in [part.lower() for part in path.parts]:
        raise ValueError("Use an absolute physical path outside AppData")
    for part in [path, *path.parents]:
        metadata = os.lstat(part)
        if stat.S_ISLNK(metadata.st_mode) or metadata.st_file_attributes & 0x400:
            raise ValueError("Physical paths cannot contain reparse points")
    if file and not path.is_file() or not file and not path.is_dir():
        raise ValueError("Physical file or directory does not exist")
    return path


def in_job(kernel, handle):
    value = wintypes.BOOL()
    require_native(kernel.IsProcessInJob(handle, None, ctypes.byref(value)))
    if not value.value:
        raise RuntimeError("Native release launch requires the inherited parent JobObject")
    return True


def creation_time(kernel, handle, label="target"):
    phase(f"{label}:times")
    created, exited, system, user = (wintypes.FILETIME() for _ in range(4))
    require_native(kernel.GetProcessTimes(handle, ctypes.byref(created), ctypes.byref(exited), ctypes.byref(system), ctypes.byref(user)))
    ticks = created.dwLowDateTime | created.dwHighDateTime << 32
    seconds, remainder = divmod(ticks - FILETIME_EPOCH, 10000000)
    prefix = datetime.fromtimestamp(seconds, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    # CIM/DMTF carries microseconds; preserve the full native ticks independently.
    return str(ticks), f"{prefix}.{remainder // 10:06d}0Z", f"{prefix}.{remainder:07d}Z"


def image_path(kernel, handle, label="target"):
    phase(f"{label}:image")
    buffer = ctypes.create_unicode_buffer(32768)
    length = wintypes.DWORD(len(buffer))
    require_native(kernel.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(length)))
    if not 0 < length.value < len(buffer):
        raise RuntimeError("Native image path is unavailable or oversized")
    return buffer.value


def native_command_line(native, handle, label="target"):
    phase(f"{label}:command-size")
    required = wintypes.ULONG()
    status = native.NtQueryInformationProcess(handle, 60, None, 0, ctypes.byref(required))
    if status & 0xffffffff not in (0xC0000004, 0xC0000023) or not ctypes.sizeof(UnicodeString) <= required.value <= MAX_FRAME:
        raise RuntimeError("Native command-line size proof is unavailable")
    buffer = ctypes.create_string_buffer(required.value)
    phase(f"{label}:command")
    status = native.NtQueryInformationProcess(handle, 60, buffer, len(buffer), ctypes.byref(required))
    if status != 0 or required.value > len(buffer):
        raise RuntimeError("Native command-line query failed")
    text = UnicodeString.from_buffer(buffer)
    start = ctypes.addressof(buffer)
    if not text.buffer or text.length % 2 or not 0 < text.length <= text.maximum or text.buffer < start + ctypes.sizeof(UnicodeString) or text.buffer + text.length > start + len(buffer):
        raise RuntimeError("Native command-line buffer is invalid")
    return ctypes.string_at(text.buffer, text.length).decode("utf-16-le")


def native_arguments(kernel, shell, command_line):
    count = ctypes.c_int()
    pointer = shell.CommandLineToArgvW(command_line, ctypes.byref(count))
    require_native(bool(pointer))
    try:
        if not 1 <= count.value <= 256:
            raise RuntimeError("Native argument vector is oversized")
        values = [pointer[index] for index in range(count.value)]
        if sum(map(len, values)) > 32768:
            raise RuntimeError("Native argument vector is oversized")
        return values
    finally:
        kernel.LocalFree(ctypes.cast(pointer, wintypes.HLOCAL))


def identity(kernel, native, shell, handle, label):
    phase(f"{label}:basic-information")
    basic = BasicInformation()
    returned = wintypes.ULONG()
    status = native.NtQueryInformationProcess(handle, 0, ctypes.byref(basic), ctypes.sizeof(basic), ctypes.byref(returned))
    if status != 0 or returned.value != ctypes.sizeof(basic):
        raise RuntimeError("Native PID and ancestry proof is unavailable")
    phase(f"{label}:pid")
    pid = kernel.GetProcessId(handle)
    require_native(pid)
    if pid != basic.pid:
        raise RuntimeError("Native handle PID differs from basic process information")
    command_line = native_command_line(native, handle, label)
    phase(f"{label}:arguments")
    arguments = native_arguments(kernel, shell, command_line)
    ticks, created, exact = creation_time(kernel, handle, label)
    image = image_path(kernel, handle, label)
    phase(f"{label}:job")
    return {"pid": pid, "parentPid": basic.parent_pid, "executablePath": image, "commandLine": command_line, "args": arguments[1:], "createdAt": created, "createdAtExact": exact, "createdFileTime": ticks, "inJob": in_job(kernel, handle)}


def validate_request(request):
    expected = {"protocol", "type", "nonce", "kind", "executablePath", "args", "cwd", "nodePid", "deadlineAt"}
    if not isinstance(request, dict) or set(request) != expected or request["protocol"] != PROTOCOL or request["type"] != "launch" or not re.fullmatch(r"[0-9a-f]{32}", request["nonce"] or ""):
        raise ValueError("Invalid native launch request")
    if type(request["nodePid"]) is not int or request["nodePid"] < 1 or type(request["deadlineAt"]) not in (int, float) or not math.isfinite(request["deadlineAt"]) or request["deadlineAt"] <= time.time() * 1000:
        raise ValueError("Native launch request is expired or has no parent")
    args = request["args"]
    if not isinstance(args, list) or len(args) > 128 or any(not isinstance(argument, str) or any(character in argument for character in "\0\r\n") for argument in args):
        raise ValueError("Invalid native launch arguments")
    executable = physical_path(request["executablePath"], file=True)
    cwd = physical_path(request["cwd"])
    if cwd != REPOSITORY:
        raise ValueError("Native release launch must use the existing repository cwd")
    if request["kind"] == "smoke":
        if executable != physical_path(sys.executable, file=True) or args != SMOKE_ARGS:
            raise ValueError("The native smoke permits only its fixed fast-exit program")
    elif request["kind"] == "silent":
        if executable.is_relative_to(REPOSITORY / "release"):
            if not re.fullmatch(r"Life Atlas Install Test Setup \d+\.\d+\.\d+\.exe", executable.name):
                raise ValueError("Unexpected release installer executable")
        else:
            task_runtime = physical_path(os.environ.get("LIFE_ATLAS_RELEASE_TEST_RUNTIME"))
            if not executable.is_relative_to(task_runtime) or executable.name != "Uninstall Life Atlas Install Test.exe":
                raise ValueError("Unexpected task-owned uninstaller executable")
    else:
        raise ValueError("Unexpected native launch kind")
    command = '"' + str(executable).replace('"', '\\"') + '"'
    if args:
        command += " " + subprocess.list2cmdline(args)
    if len(command) >= 32768:
        raise ValueError("Native command line is oversized")
    return str(executable), command


class Broker:
    def __init__(self, kernel):
        self.kernel = kernel
        self.stdin = kernel.GetStdHandle(0xfffffff6)
        self.pending = bytearray()
        self.nonce = None
        self.sequence = 0

    def emit(self, message):
        record = {"protocol": PROTOCOL, "nonce": self.nonce, "sequence": self.sequence, **message}
        encoded = json.dumps(record, ensure_ascii=True, separators=(",", ":")).encode("utf-8") + b"\n"
        if len(encoded) > MAX_FRAME:
            raise RuntimeError("Native protocol record is oversized")
        self.sequence += 1
        sys.stdout.buffer.write(encoded)
        sys.stdout.buffer.flush()

    def pipe_read(self, handle, label):
        phase(f"{label}:peek")
        available = wintypes.DWORD()
        if not self.kernel.PeekNamedPipe(handle, None, 0, None, ctypes.byref(available), None):
            if ctypes.get_last_error() in (109, 232):
                return None
            raise ctypes.WinError(ctypes.get_last_error())
        if not available.value:
            return b""
        buffer = ctypes.create_string_buffer(min(available.value, CHUNK))
        received = wintypes.DWORD()
        phase(f"{label}:read")
        require_native(self.kernel.ReadFile(handle, buffer, len(buffer), ctypes.byref(received), None))
        return buffer.raw[:received.value]

    def message(self, deadline, *, wait, label):
        while True:
            if b"\n" in self.pending:
                line, _, remainder = self.pending.partition(b"\n")
                self.pending = bytearray(remainder)
                if not line or len(line) >= MAX_FRAME:
                    raise ValueError("Invalid native input frame")
                return json.loads(line.decode("utf-8"))
            chunk = self.pipe_read(self.stdin, f"{label}:stdin")
            if chunk is None:
                raise RuntimeError("Native broker input closed before completion")
            self.pending.extend(chunk)
            if len(self.pending) > MAX_FRAME:
                raise ValueError("Native input frame is oversized")
            if not wait:
                return None
            if time.time() * 1000 >= deadline:
                raise TimeoutError("Native launch handshake exceeded the original command deadline")
            if not chunk:
                time.sleep(0.005)


def run():
    if sys.platform != "win32" or ctypes.sizeof(ctypes.c_void_p) != 8:
        raise RuntimeError("Native release launch requires 64-bit Windows Python")
    kernel, native, shell = native_functions()
    broker = Broker(kernel)
    process = thread = None
    read_handles = {}
    write_handles = []
    attributes = None
    attribute_ready = False
    retained_identity = None
    completed = False
    resumed = False
    try:
        phase("request")
        request = broker.message(int(time.time() * 1000) + 10000, wait=True, label="request")
        phase("request-validation")
        executable, command = validate_request(request)
        broker.nonce = request["nonce"]
        own = identity(kernel, native, shell, kernel.GetCurrentProcess(), "broker.identity")
        if own["parentPid"] != request["nodePid"] or own["args"] != ["-I", "-B", "-u", str(Path(os.path.abspath(__file__)))] or Path(own["executablePath"]) != physical_path(sys.executable, file=True):
            raise RuntimeError("Native broker does not belong to the requesting Node process")
        security = SecurityAttributes(ctypes.sizeof(SecurityAttributes), None, True)
        for label in ("stdout", "stderr"):
            reading, writing = wintypes.HANDLE(), wintypes.HANDLE()
            phase(f"pipes:{label}:create")
            require_native(kernel.CreatePipe(ctypes.byref(reading), ctypes.byref(writing), ctypes.byref(security), 0))
            read_handles[label] = reading.value
            write_handles.append(writing.value)
            require_native(kernel.SetHandleInformation(reading, 1, 0))
        phase("pipes:stdin:null")
        null_input = kernel.CreateFileW("NUL", 0x80000000, 3, ctypes.byref(security), 3, 0x80, None)
        if null_input in (None, ctypes.c_void_p(-1).value):
            raise ctypes.WinError(ctypes.get_last_error())
        write_handles.append(null_input)
        required = ctypes.c_size_t()
        phase("attributes:size")
        kernel.InitializeProcThreadAttributeList(None, 1, 0, ctypes.byref(required))
        if not 0 < required.value <= 4096:
            raise RuntimeError("Native inherited-handle attribute size is unavailable")
        attributes = ctypes.create_string_buffer(required.value)
        phase("attributes:initialize")
        require_native(kernel.InitializeProcThreadAttributeList(attributes, 1, 0, ctypes.byref(required)))
        attribute_ready = True
        inherited = (wintypes.HANDLE * 3)(null_input, write_handles[0], write_handles[1])
        phase("attributes:update")
        require_native(kernel.UpdateProcThreadAttribute(attributes, 0, 0x00020002, inherited, ctypes.sizeof(inherited), None, None))
        startup = StartupInfoEx()
        startup.startup.cb = ctypes.sizeof(startup)
        startup.startup.flags = 0x101
        startup.startup.show = 0
        startup.startup.stdin, startup.startup.stdout, startup.startup.stderr = inherited
        startup.attributes = ctypes.cast(attributes, wintypes.LPVOID)
        information = ProcessInformation()
        phase("create-process")
        require_native(kernel.CreateProcessW(executable, ctypes.create_unicode_buffer(command), None, None, True, CREATION_FLAGS, None, request["cwd"], ctypes.byref(startup), ctypes.byref(information)))
        process, thread = information.process, information.thread
        while write_handles:
            require_native(kernel.CloseHandle(write_handles.pop()))
        retained_identity = identity(kernel, native, shell, process, "target.identity")
        target_args = native_arguments(kernel, shell, retained_identity["commandLine"])
        if retained_identity["pid"] != information.pid or retained_identity["parentPid"] != own["pid"] or Path(retained_identity["executablePath"]) != Path(executable) or target_args != [executable, *request["args"]] or retained_identity["commandLine"] != command:
            raise RuntimeError("Suspended target native identity differs from the launch request")
        phase("target:thread")
        thread_pid, thread_id = kernel.GetProcessIdOfThread(thread), kernel.GetThreadId(thread)
        if thread_pid != information.pid or thread_id != information.tid:
            raise RuntimeError("Primary thread does not belong to the retained target handle")
        broker.emit({"type": "suspended", "broker": own, "target": retained_identity, "native": {"creationFlags": CREATION_FLAGS, "createdSuspended": True, "processHandleRetained": True, "threadHandleRetained": True, "processIdFromHandle": information.pid, "threadProcessIdFromHandle": thread_pid, "threadIdFromHandle": thread_id}})
        acknowledgement = broker.message(min(request["deadlineAt"], int(time.time() * 1000) + 15000), wait=True, label="resume-ack")
        if acknowledgement != {"protocol": PROTOCOL, "type": "resume", "nonce": broker.nonce}:
            raise RuntimeError("Native target has no exact one-resume acknowledgement")
        phase("target:resume")
        previous = kernel.ResumeThread(thread)
        if previous != 1:
            raise RuntimeError("Native primary thread did not have exactly one initial suspension")
        resumed = True
        resumed_thread = thread
        thread = None
        require_native(kernel.CloseHandle(resumed_thread))
        broker.emit({"type": "resumed", "pid": information.pid, "createdFileTime": retained_identity["createdFileTime"], "previousSuspendCount": previous})
        output_bytes = 0
        while True:
            message = broker.message(request["deadlineAt"], wait=False, label="running")
            if message is not None:
                if message == {"protocol": PROTOCOL, "type": "abort", "nonce": broker.nonce}:
                    raise RuntimeError("Native target aborted by its requesting owner")
                raise RuntimeError("Unexpected or repeated native launch acknowledgement")
            for label, handle in list(read_handles.items()):
                chunk = broker.pipe_read(handle, f"running:{label}")
                if chunk is None:
                    del read_handles[label]
                    require_native(kernel.CloseHandle(handle))
                elif chunk:
                    output_bytes += len(chunk)
                    if output_bytes > MAX_OUTPUT:
                        raise RuntimeError("Native target output exceeded the bounded release pipe budget")
                    broker.emit({"type": label, "bytes": base64.b64encode(chunk).decode("ascii")})
            phase("target.exit:wait")
            status = kernel.WaitForSingleObject(process, 0)
            if status not in (0, 258):
                raise RuntimeError("Retained native target wait failed")
            if status == 0 and not read_handles:
                code = wintypes.DWORD()
                phase("target.exit:code")
                require_native(kernel.GetExitCodeProcess(process, ctypes.byref(code)))
                ticks, _, _ = creation_time(kernel, process, "target.exit")
                phase("target.exit:pid")
                if kernel.GetProcessId(process) != information.pid or ticks != retained_identity["createdFileTime"]:
                    raise RuntimeError("Retained native target identity changed before exit receipt")
                # Windows rejects a new image-name query after this process has terminated.
                # The uninterrupted CreateProcess handle still binds its pre-resume image.
                broker.emit({"type": "exit", "pid": information.pid, "createdFileTime": ticks, "executablePath": retained_identity["executablePath"], "commandLine": retained_identity["commandLine"], "args": retained_identity["args"], "parentPid": retained_identity["parentPid"], "imageProvenAt": "suspended", "handleRetained": True, "signaled": True, "exitCode": code.value})
                completed = True
                return 0
            if time.time() * 1000 >= request["deadlineAt"]:
                raise TimeoutError("Native target or inherited pipes exceeded the original command deadline")
            time.sleep(0.005)
    except Exception as error:
        failed_phase = DIAGNOSTIC_PHASE
        cleanup_error = None
        if process and kernel.WaitForSingleObject(process, 0) != 0:
            try:
                # The exact CreateProcessW handle remains owned even before proof/resume.
                require_native(kernel.TerminateProcess(process, 0xE0000001))
                if kernel.WaitForSingleObject(process, 5000) != 0:
                    raise RuntimeError("Owned native target did not stop after handle-only abort")
            except Exception as stopping_error:
                cleanup_error = str(stopping_error)
        text = str(error)[:2000]
        if cleanup_error:
            text += "; owned target abort failed: " + cleanup_error[:1000]
        try:
            broker.emit({"type": "error", "message": text, "phase": failed_phase, "targetCreated": bool(process), "targetVerified": retained_identity is not None, "targetResumed": resumed})
        except Exception:
            sys.stderr.write("Native launch broker failure: " + text + "\n")
        return 1
    finally:
        if attribute_ready:
            kernel.DeleteProcThreadAttributeList(attributes)
        close_failed = False
        for handle in [*write_handles, *read_handles.values(), thread, process]:
            if handle:
                close_failed = not bool(kernel.CloseHandle(handle)) or close_failed
        if close_failed:
            sys.stderr.write("Native launch failed to close an owned handle exactly once\n")
            sys.stderr.flush()
            return 1
        if not completed:
            sys.stderr.flush()


if __name__ == "__main__":
    sys.exit(run())
