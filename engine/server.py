"""
FlowVoice Native Helper Server & Coordinator
Hosts WebSocket server on 127.0.0.1:48123 for live Electron UI synchronization.
"""
import sys
import os

# Ensure project root is in Python import path
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

import asyncio
import json
import threading
import time
import subprocess
import signal
from engine.whisper_engine import WhisperEngine
from engine.hotkey import HotkeyManager
from engine.injector import inject_text, get_foreground_window_title
import websockets

WS_HOST = "127.0.0.1"
WS_PORT = 48123

def free_port(port):
    """Frees the specified port if it is occupied by an orphaned process."""
    if sys.platform != "win32":
        return
    try:
        cmd = "netstat -ano -p tcp"
        res = subprocess.run(cmd, capture_output=True, text=True, shell=True)
        my_pid = str(os.getpid())
        for line in res.stdout.splitlines():
            if f":{port}" in line and "LISTENING" in line:
                parts = line.strip().split()
                if len(parts) >= 5:
                    pid = parts[-1]
                    if pid.isdigit() and pid != my_pid and pid != "0":
                        print(f"[Engine] Port {port} occupied by PID {pid}. Terminating stale process...")
                        subprocess.run(f"taskkill /F /PID {pid}", shell=True, capture_output=True)
                        time.sleep(0.5)
    except Exception as e:
        print(f"[Engine] Note: Port check encountered: {e}")

class FlowEngineServer:
    def __init__(self, model_size="base.en", hotkey="f8", mode="hybrid"):
        self.connected_clients = set()
        self.loop = None
        self.is_processing = False
        self._server = None

        # Init Whisper engine with live volume callback
        self.whisper = WhisperEngine(
            model_size=model_size,
            on_volume=self._on_volume_update
        )

        # Init Hotkey listener with Hybrid (Hold or Tap) mode
        self.hotkey_mgr = HotkeyManager(
            hotkey=hotkey,
            mode=mode,
            on_trigger_start=self._on_hotkey_start,
            on_trigger_stop=self._on_hotkey_stop
        )

    def _broadcast(self, message_dict):
        """Thread-safe WebSocket broadcast to Electron."""
        if not self.loop or not self.connected_clients:
            return
        payload = json.dumps(message_dict)
        for ws in list(self.connected_clients):
            asyncio.run_coroutine_threadsafe(self._safe_send(ws, payload), self.loop)

    async def _safe_send(self, ws, payload):
        try:
            await ws.send(payload)
        except Exception:
            self.connected_clients.discard(ws)

    def _on_volume_update(self, vol):
        self._broadcast({"type": "volume", "value": vol})

    def _on_hotkey_start(self):
        if self.is_processing:
            print("[Engine] Still processing previous audio, ignoring key press")
            return
        self.current_app_title = get_foreground_window_title() or "Desktop / Active Window"
        print(f"\n[Engine] >>> RECORDING STARTED (Target App: \"{self.current_app_title}\") <<<")
        self._broadcast({"type": "status", "status": "recording", "appTitle": self.current_app_title})
        self.whisper.start_recording()

    def _on_hotkey_stop(self):
        if self.is_processing:
            return
        print("[Engine] >>> RECORDING STOPPED -> Transcribing audio... <<<")
        self._broadcast({"type": "status", "status": "transcribing"})
        self.is_processing = True

        # Run transcription and injection in a background thread to avoid blocking audio
        threading.Thread(target=self._process_and_inject, daemon=True).start()

    def _process_and_inject(self):
        try:
            result = self.whisper.stop_recording()
            if result and result.get("text"):
                text = result["text"]
                press_enter = result.get("press_enter", False)
                print(f"[Engine] >>> SUCCESS: Transcribed text: \"{text}\" (press_enter={press_enter}) <<<")
                
                # Broadcast dictation_completed event with rich metadata for Dashboard & Notes
                self._broadcast({
                    "type": "dictation_completed",
                    "text": text,
                    "press_enter": press_enter,
                    "appTitle": getattr(self, "current_app_title", "Desktop"),
                    "duration": round(result.get("duration", 0), 2),
                    "latency": round(result.get("latency", 0), 2),
                    "timestamp": time.time()
                })

                self._broadcast({"type": "status", "status": "pasting", "text": text})
                inject_text(text, press_enter=press_enter)
                print(f"[Engine] >>> Successfully pasted text into active window! <<<")
            else:
                print("[Engine] >>> No speech detected in audio clip or duration was empty <<<")
        except Exception as e:
            print(f"[Engine] >>> Error during transcription/injection: {e} <<<")
        finally:
            self.is_processing = False
            # Reset to idle quickly for instant snappy responsiveness
            time.sleep(0.08)
            self._broadcast({"type": "status", "status": "idle"})

    async def ws_handler(self, websocket):
        self.connected_clients.add(websocket)
        print(f"[Engine] Electron client connected ({len(self.connected_clients)} active)")
        try:
            async for message in websocket:
                data = json.loads(message)
                action = data.get("action")
                if action == "manual_start":
                    self._on_hotkey_start()
                elif action == "manual_stop":
                    self._on_hotkey_stop()
                elif action == "update_settings":
                    settings = data.get("settings", {})
                    if "mode" in settings:
                        self.hotkey_mgr.mode = settings["mode"]
                        print(f"[Engine] Hotkey mode updated to: {settings['mode']}")
                    if "model" in settings and settings["model"] != getattr(self.whisper, "model_size", None):
                        new_model = settings["model"]
                        print(f"[Engine] Hot-swapping Whisper model to: {new_model}...")
                        self.whisper.load_model(new_model)
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self.connected_clients.discard(websocket)
            print(f"[Engine] Client disconnected ({len(self.connected_clients)} active)")

    def stop(self):
        print("[Engine] Stopping FlowEngine...")
        if self.hotkey_mgr:
            self.hotkey_mgr.stop()
        if self.whisper and self.whisper.is_recording:
            try:
                self.whisper.stop_recording()
            except Exception:
                pass
        if self._server:
            self._server.close()

    def run(self):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)

        # Register signals for clean shutdown
        def _handle_signal(*args):
            self.stop()
            sys.exit(0)

        signal.signal(signal.SIGINT, _handle_signal)
        signal.signal(signal.SIGTERM, _handle_signal)

        # Start hotkey listener
        self.hotkey_mgr.start()

        async def start_server():
            retries = 5
            for attempt in range(retries):
                try:
                    self._server = await websockets.serve(self.ws_handler, WS_HOST, WS_PORT)
                    break
                except OSError as e:
                    if "10048" in str(e) or getattr(e, "errno", None) == 10048:
                        print(f"[Engine] Port {WS_PORT} busy (attempt {attempt + 1}/{retries}). Freeing port...")
                        free_port(WS_PORT)
                        await asyncio.sleep(1.0)
                    else:
                        raise e

            if not self._server:
                raise RuntimeError(f"Could not bind to ws://{WS_HOST}:{WS_PORT} after {retries} retries.")

            print(f"[Engine] FlowEngine WebSocket server listening on ws://{WS_HOST}:{WS_PORT}")
            while True:
                await asyncio.sleep(3600)

        try:
            self.loop.run_until_complete(start_server())
        except (KeyboardInterrupt, SystemExit):
            self.stop()
        except Exception as e:
            print(f"[Engine] Fatal exception in server loop: {e}")
            import traceback
            traceback.print_exc()
            self.stop()

if __name__ == "__main__":
    server = FlowEngineServer()
    server.run()
