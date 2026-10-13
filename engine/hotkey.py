"""
Global Hotkey Listener using pynput
Supports Hybrid (Hold-to-Talk OR Tap-to-Toggle), Push-to-Talk, and Toggle modes.
"""
from pynput import keyboard
import threading
import time

class HotkeyManager:
    def __init__(self, hotkey="f8", mode="hybrid", on_trigger_start=None, on_trigger_stop=None):
        self.hotkey_name = hotkey.lower()
        self.mode = mode  # "hybrid" (recommended), "ptt", or "toggle"
        self.on_trigger_start = on_trigger_start
        self.on_trigger_stop = on_trigger_stop
        
        self.is_active = False
        self.is_toggle_latched = False
        self.press_time = 0.0
        self.listener = None
        self._target_key = self._parse_key(self.hotkey_name)
        self.lock = threading.Lock()

    def _parse_key(self, name):
        if hasattr(keyboard.Key, name):
            return getattr(keyboard.Key, name)
        # Single char
        return keyboard.KeyCode.from_char(name)

    def _on_press(self, key):
        if key == self._target_key:
            with self.lock:
                now = time.time()
                if self.mode == "hybrid":
                    if not self.is_active:
                        self.is_active = True
                        self.is_toggle_latched = False
                        self.press_time = now
                        if self.on_trigger_start:
                            self.on_trigger_start()
                    else:
                        # Key pressed again while already recording in toggle mode
                        if self.is_toggle_latched:
                            self.is_active = False
                            self.is_toggle_latched = False
                            if self.on_trigger_stop:
                                self.on_trigger_stop()

                elif self.mode == "ptt":
                    if not self.is_active:
                        self.is_active = True
                        if self.on_trigger_start:
                            self.on_trigger_start()

                elif self.mode == "toggle":
                    self.is_active = not self.is_active
                    if self.is_active:
                        if self.on_trigger_start:
                            self.on_trigger_start()
                    else:
                        if self.on_trigger_stop:
                            self.on_trigger_stop()

    def _on_release(self, key):
        if key == self._target_key:
            with self.lock:
                if self.mode == "hybrid":
                    if self.is_active:
                        hold_duration = time.time() - self.press_time
                        if hold_duration >= 0.35:
                            # User held F8 while speaking -> Push-to-Talk release
                            self.is_active = False
                            self.is_toggle_latched = False
                            if self.on_trigger_stop:
                                self.on_trigger_stop()
                        else:
                            # User quickly tapped F8 (< 350ms) -> Latch into Toggle mode
                            self.is_toggle_latched = True
                            print("[HotkeyManager] Tap detected -> Toggle mode active (speak, then tap F8 to finish)")

                elif self.mode == "ptt":
                    if self.is_active:
                        self.is_active = False
                        if self.on_trigger_stop:
                            self.on_trigger_stop()

    def start(self):
        self.listener = keyboard.Listener(
            on_press=self._on_press,
            on_release=self._on_release
        )
        self.listener.daemon = True
        self.listener.start()
        print(f"[HotkeyManager] Listening for global key: {self.hotkey_name.upper()} (mode: {self.mode} - hold or tap)")

    def stop(self):
        if self.listener:
            self.listener.stop()
            self.listener = None
