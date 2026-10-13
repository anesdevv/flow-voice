"""
Win32 Text Injector & Clipboard Management
Uses pynput Controller + Win32 keybd_event fallback for 100% reliable keystroke simulation.
"""
import ctypes
from ctypes import wintypes
import time
import pyperclip
from pynput.keyboard import Controller, Key

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

keyboard_controller = Controller()

def is_foreground_terminal():
    """Detects whether active window is a console or terminal window."""
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        return False
    class_buf = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(hwnd, class_buf, 256)
    cname = class_buf.value.lower()
    return any(t in cname for t in [
        "consolewindowclass", "windowsterminal", "mintty", "putty", "xshell", "conhost"
    ])

def get_foreground_window_title():
    """Gets the title of the active foreground window."""
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        return ""
    length = user32.GetWindowTextLengthW(hwnd)
    if length == 0:
        return ""
    buf = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buf, length + 1)
    return buf.value

def inject_text(text, press_enter=False):
    """
    Injects text into active foreground window (Notepad, YouTube search, Word, Slack, etc.):
    1. Copies text to clipboard.
    2. Simulates paste keystroke via pynput Controller (Shift+Insert for terminal, Ctrl+V for GUI).
    3. Fallback to keybd_event if needed.
    4. Simulates Enter key if requested.
    """
    if not text:
        return

    # Put dictated text on clipboard
    try:
        pyperclip.copy(text)
    except Exception as e:
        print(f"[Injector] Clipboard write error: {e}")
        return

    # Rapid clipboard settling
    time.sleep(0.015)

    is_term = is_foreground_terminal()
    print(f"[Injector] Dispatching paste into {'Terminal' if is_term else 'GUI App'}...")

    try:
        if is_term:
            with keyboard_controller.pressed(Key.shift):
                keyboard_controller.tap(Key.insert)
        else:
            with keyboard_controller.pressed(Key.ctrl):
                keyboard_controller.tap('v')
    except Exception as e:
        print(f"[Injector] pynput paste failed ({e}), using keybd_event fallback...")
        # Direct Win32 keybd_event fallback
        VK_CONTROL = 0x11
        VK_SHIFT = 0x10
        VK_INSERT = 0x2D
        VK_V = 0x56
        KEYEVENTF_KEYUP = 0x0002

        if is_term:
            user32.keybd_event(VK_SHIFT, 0, 0, 0)
            user32.keybd_event(VK_INSERT, 0, 0, 0)
            time.sleep(0.01)
            user32.keybd_event(VK_INSERT, 0, KEYEVENTF_KEYUP, 0)
            user32.keybd_event(VK_SHIFT, 0, KEYEVENTF_KEYUP, 0)
        else:
            user32.keybd_event(VK_CONTROL, 0, 0, 0)
            user32.keybd_event(VK_V, 0, 0, 0)
            time.sleep(0.01)
            user32.keybd_event(VK_V, 0, KEYEVENTF_KEYUP, 0)
            user32.keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0)

    # Simulate Enter if requested
    if press_enter:
        time.sleep(0.02)
        keyboard_controller.tap(Key.enter)
        print("[Injector] Dispatched Enter keypress")
