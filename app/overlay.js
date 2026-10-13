// FlowVoice Overlay WebSocket Client & Reactive Visualizer
const pill = document.getElementById("pill");
const statusText = document.getElementById("statusText");
const bars = document.querySelectorAll(".equalizer .bar");

let ws = null;
let reconnectTimer = null;

function connectWS() {
  ws = new WebSocket("ws://127.0.0.1:48123");

  ws.onopen = () => {
    console.log("[Overlay] Connected to FlowVoice native engine");
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleEngineEvent(data);
    } catch (e) {
      console.error("[Overlay] Message parse error:", e);
    }
  };

  ws.onclose = () => {
    console.log("[Overlay] Disconnected from engine, reconnecting...");
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectWS, 1500);
  };

  ws.onerror = () => {
    ws.close();
  };
}

function handleEngineEvent(data) {
  if (data.type === "status") {
    const status = data.status;
    pill.classList.remove("transcribing", "pasting");

    if (status === "recording") {
      pill.classList.add("visible");
      statusText.textContent = "Listening...";
    } else if (status === "transcribing") {
      pill.classList.add("visible", "transcribing");
      statusText.textContent = "Transcribing...";
      // Static pulse during transcription
      bars.forEach((b, i) => {
        b.style.height = `${6 + (i % 2) * 5}px`;
      });
    } else if (status === "pasting") {
      pill.classList.add("visible", "pasting");
      statusText.textContent = "Pasting...";
      bars.forEach(b => b.style.height = "14px");
    } else if (status === "idle") {
      pill.classList.remove("visible");
      bars.forEach(b => b.style.height = "4px");
    }
  } else if (data.type === "volume") {
    // Dynamic equalizer animation
    const vol = data.value || 0;
    const heights = [
      Math.max(4, Math.round(vol * 12 + 2)),
      Math.max(4, Math.round(vol * 20 + 3)),
      Math.max(4, Math.round(vol * 24 + 4)),
      Math.max(4, Math.round(vol * 18 + 3)),
      Math.max(4, Math.round(vol * 10 + 2))
    ];
    bars.forEach((bar, idx) => {
      bar.style.height = `${heights[idx]}px`;
    });
  }
}

connectWS();
