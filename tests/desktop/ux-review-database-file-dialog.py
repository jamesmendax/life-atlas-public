"""Select a QA-owned file in a verified Windows dialog of the isolated release process."""
import ctypes
from ctypes import wintypes as wt
import json
from pathlib import Path
import sys
import time

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32
pid, mode, name = sys.argv[1:]
pid = int(pid)
target = Path(name).resolve()
qa_root = Path(__file__).resolve().parents[2] / ".qa"
assert target.parent.parent == qa_root and target.parent.name.startswith(("ux-review-database-", "ux-page-export-"))
assert mode in {"open", "cancel-open", "save", "cancel-save"}
selecting_input = mode in {"open", "cancel-open"}
cancelled = mode in {"cancel-open", "cancel-save"}
assert target.is_file() if selecting_input else not target.exists()
visit = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
user32.SendMessageW.argtypes = [wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM]
user32.SendMessageW.restype = wt.LPARAM
user32.PostMessageW.argtypes = [wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM]
user32.GetWindow.argtypes = [wt.HWND, wt.UINT]
user32.GetWindow.restype = wt.HWND
user32.GetForegroundWindow.restype = wt.HWND
kernel32.CreateToolhelp32Snapshot.argtypes = [wt.DWORD, wt.DWORD]
kernel32.CreateToolhelp32Snapshot.restype = wt.HANDLE
opened = []
observed = set()
owner_windows = set()

class ProcessEntry(ctypes.Structure):
    _fields_ = [("size", wt.DWORD), ("unused", wt.DWORD), ("pid", wt.DWORD),
                ("heap", ctypes.c_size_t), ("module", wt.DWORD), ("threads", wt.DWORD),
                ("parent", wt.DWORD), ("priority", wt.LONG), ("flags", wt.DWORD),
                ("exe", wt.WCHAR * 260)]

def related_pids():
    owned = {pid}
    snapshot = kernel32.CreateToolhelp32Snapshot(2, 0)
    entry = ProcessEntry()
    entry.size = ctypes.sizeof(entry)
    edges = []
    try:
        valid = kernel32.Process32FirstW(snapshot, ctypes.byref(entry))
        while valid:
            if entry.exe.casefold() == "life atlas.exe":
                edges.append((entry.pid, entry.parent))
            valid = kernel32.Process32NextW(snapshot, ctypes.byref(entry))
    finally:
        kernel32.CloseHandle(snapshot)
    for _ in range(8):
        owned.update(child for child, parent in edges if parent in owned)
    return owned

def window_text(hwnd, class_name=False):
    text = ctypes.create_unicode_buffer(320)
    if class_name:
        user32.GetClassNameW(hwnd, text, len(text))
    else:
        user32.SendMessageW(hwnd, 13, len(text), ctypes.addressof(text))
    return text.value

@visit
def match(hwnd, _):
    owner = wt.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
    if not user32.IsWindowVisible(hwnd):
        return True
    window_class = window_text(hwnd, True)
    if owner.value in family:
        owner_windows.add((window_class, window_text(hwnd)))
    if window_class != "#32770":
        return True
    parent = hwnd
    while parent:
        ancestor_pid = wt.DWORD()
        user32.GetWindowThreadProcessId(parent, ctypes.byref(ancestor_pid))
        if ancestor_pid.value in family:
            break
        parent = user32.GetWindow(parent, 4)
    if not parent:
        return True
    title = window_text(hwnd)
    observed.add(title)
    controls = []
    @visit
    def collect(child, unused):
        if user32.IsWindowVisible(child):
            controls.append((child, user32.GetDlgCtrlID(child), window_text(child, True), window_text(child)))
        return True
    user32.EnumChildWindows(hwnd, collect, 0)
    buttons = {ident: (control, text) for control, ident, cls, text in controls if cls == "Button"}
    edits = [control for control, ident, cls, _ in controls if cls == "Edit" and ident in (1001, 1148)]
    if not edits or 1 not in buttons or 2 not in buttons:
        return True
    if selecting_input:
        ok = buttons[1][1].lower().replace("&", "")
        if not ("打开" in ok or "open" in ok or title in {"打开", "Open", "选择要上传的文件"}):
            return True
    elif title != "保存导出文件":
        return True
    opened.append((hwnd, title, buttons, edits[0], owner.value))
    return True

def foreground():
    hwnd = user32.GetForegroundWindow()
    owner = wt.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
    return {"hwnd": int(hwnd or 0), "owned": owner.value in family}

family = related_pids()
before_open = foreground()
deadline = time.monotonic() + 11
started = time.monotonic()
while time.monotonic() < deadline:
    opened.clear()
    family = related_pids()
    user32.EnumWindows(match, 0)
    if opened:
        break
    time.sleep(.1)
assert len(opened) == 1, (pid, mode, sorted(observed), sorted(owner_windows))
hwnd, title, buttons, edit, owner_pid = opened[0]
shown = time.monotonic()
shown_epoch_ms = time.time_ns() // 1000000
typed = None
if not cancelled:
    if mode == "save" and "after-reading" in target.name:
        time.sleep(1.6)
    text = ctypes.create_unicode_buffer(str(target))
    assert user32.SendMessageW(edit, 12, 0, ctypes.addressof(text))
    typed = window_text(edit)
    assert Path(typed) == target
before_confirm = foreground()
assert user32.PostMessageW(buttons[2 if cancelled else 1][0], 245, 0, 0)
while time.monotonic() < deadline and user32.IsWindowVisible(hwnd):
    time.sleep(.03)
assert not user32.IsWindowVisible(hwnd), (mode, title, "dialog stayed open")
closed = time.monotonic()
at_hide = foreground()
after_close = at_hide
expected_parent = before_open["hwnd"] if before_open["owned"] and before_open["hwnd"] != hwnd else None
foreground_returned = False
while time.monotonic()-closed < .8:
    after_close = foreground()
    owner_window = after_close["hwnd"]
    if after_close["owned"] and owner_window != hwnd and user32.IsWindowVisible(owner_window) and (not expected_parent or owner_window == expected_parent):
        foreground_returned = True
        break
    time.sleep(.02)
print(json.dumps({"pid": pid, "dialogOwnerPid": owner_pid, "hwnd": hwnd, "dialog": title, "action": mode, "file": target.name, "typed": typed, "closed": True, "dialogShownMs": round((shown-started)*1000), "dialogSeenAt": shown_epoch_ms, "dialogDurationMs": round((closed-shown)*1000), "foregroundBeforeOpen": before_open, "foregroundBeforeConfirm": before_confirm, "foregroundAtHide": at_hide, "foregroundAfterClose": after_close, "appForegroundAfter": foreground_returned}))
