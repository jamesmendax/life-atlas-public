"""Resize only the owned, visible Life Atlas workspace used by the UX walkthrough."""
import ctypes
import json
import sys
import time
from ctypes import wintypes as wt

user32 = ctypes.windll.user32
user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
pid = int(sys.argv[1])
mode = sys.argv[2]
assert mode in {"large", "small", "foreground"}
user32.GetForegroundWindow.restype = wt.HWND
found = []
observed = []
CALLBACK = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)

@CALLBACK
def examine(hwnd, data):
    owner = wt.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
    if owner.value != pid:
        return True
    name = ctypes.create_unicode_buffer(128)
    title = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(hwnd, name, len(name))
    user32.GetWindowTextW(hwnd, title, len(title))
    observed.append([name.value, title.value, bool(user32.IsWindowVisible(hwnd))])
    if name.value == "Chrome_WidgetWin_1" and title.value in {"Life Atlas", sys.argv[3]}:
        found.append(hwnd)
    return True

for attempt in range(15):
    observed.clear()
    found.clear()
    user32.EnumWindows(examine, 0)
    if found:
        break
    time.sleep(.1)
assert len(found) == 1, (pid, found, observed)
hwnd = wt.HWND(found[0])
dpi = user32.GetDpiForWindow(hwnd)
def foreground():
    handle = user32.GetForegroundWindow()
    owner = wt.DWORD()
    user32.GetWindowThreadProcessId(handle, ctypes.byref(owner))
    return {"hwnd": int(handle or 0), "owned": owner.value == pid}

before = foreground()
if mode == "foreground":
    if not before["owned"]:
        user32.SetForegroundWindow(hwnd)
        if not foreground()["owned"]:
            user32.SwitchToThisWindow(hwnd, True)
    for _ in range(30):
        if foreground()["owned"]:
            break
        time.sleep(.04)
elif mode == "large":
    user32.ShowWindow(hwnd, 3)
else:
    user32.ShowWindow(hwnd, 9)
    scale = dpi / 96
    assert user32.SetWindowPos(hwnd, 0, 8, 8, round(960 * scale), round(600 * scale), 0x0014)
rect = wt.RECT()
assert user32.GetWindowRect(hwnd, ctypes.byref(rect))
assert user32.IsWindowVisible(hwnd), (pid, observed)
print(json.dumps({"pid": pid, "hwnd": int(found[0]), "dpi": dpi,
                  "physical": [rect.left, rect.top, rect.right, rect.bottom],
                  "foregroundBefore": before, "foregroundAfter": foreground(),
                  "maximized": bool(user32.IsZoomed(hwnd))}))

