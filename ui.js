/*
UI module: wires DOM controls and emits callbacks for image import and parameter changes.
Exports:
 - setupUI(callbacks)
 - getUIState()
*/

let uiState = {
  baseWindSpeed: 80,
  turbulence: 0.18,
  vortexStrength: 0.9,
  gustsEnabled: false,
  particleCount: 900,
  colorMode: "mono",
};

export function getUIState() {
  return { ...uiState };
}

export function setupUI({ onTogglePause, onExport, onReset, onImageLoad, onParamsChange }) {
  const fileInput = document.getElementById("imageInput");
  const dragLabel = document.getElementById("dragLabel");

  const togSettings = document.getElementById("togSettings");
  const settingsPanel = document.getElementById("settingsPanel");
  const windSpeedInput = document.getElementById("windSpeed");
  const windVal = document.getElementById("windVal");
  const turbInput = document.getElementById("turbulence");
  const turbVal = document.getElementById("turbVal");
  const vortexInput = document.getElementById("vortex");
  const vortexVal = document.getElementById("vortexVal");
  const gustToggle = document.getElementById("gustToggle");
  const particleCountInput = document.getElementById("particleCount");
  const particleCountVal = document.getElementById("particleCountVal");
  const colorModeSelect = document.getElementById("colorMode");
  const pauseBtn = document.getElementById("pauseBtn");
  const exportBtn = document.getElementById("exportBtn");
  const resetBtn = document.getElementById("resetBtn");

  togSettings?.addEventListener("click", () => settingsPanel.classList.toggle("show"));

  windSpeedInput?.addEventListener("input", (e) => {
    uiState.baseWindSpeed = parseFloat(e.target.value);
    windVal.textContent = uiState.baseWindSpeed.toFixed(0);
    onParamsChange && onParamsChange({ baseWindSpeed: uiState.baseWindSpeed, vortexStrength: uiState.vortexStrength });
  });

  turbInput?.addEventListener("input", (e) => {
    uiState.turbulence = parseFloat(e.target.value);
    turbVal.textContent = uiState.turbulence.toFixed(2);
    onParamsChange && onParamsChange({ turbulence: uiState.turbulence });
  });

  vortexInput?.addEventListener("input", (e) => {
    uiState.vortexStrength = parseFloat(e.target.value);
    vortexVal.textContent = uiState.vortexStrength.toFixed(2);
    onParamsChange && onParamsChange({ vortexStrength: uiState.vortexStrength });
  });

  gustToggle?.addEventListener("change", (e) => {
    uiState.gustsEnabled = e.target.checked;
    onParamsChange && onParamsChange({ gustsEnabled: uiState.gustsEnabled });
  });

  particleCountInput?.addEventListener("input", (e) => {
    uiState.particleCount = parseInt(e.target.value, 10);
    particleCountVal.textContent = uiState.particleCount;
    onParamsChange && onParamsChange({ particleCount: uiState.particleCount });
  });

  colorModeSelect?.addEventListener("change", (e) => {
    uiState.colorMode = e.target.value;
    onParamsChange && onParamsChange({ colorMode: uiState.colorMode });
  });

  pauseBtn?.addEventListener("click", () => {
    const paused = pauseBtn.textContent !== "Resume";
    pauseBtn.textContent = paused ? "Resume" : "Pause";
    onTogglePause && onTogglePause(paused);
  });

  exportBtn?.addEventListener("click", () => onExport && onExport());
  resetBtn?.addEventListener("click", () => onReset && onReset());

  // file import handling
  fileInput?.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      onImageLoad && onImageLoad(img);
    };
    img.onerror = () => {
      if (dragLabel) dragLabel.textContent = "Drag index: –";
    };
    img.src = URL.createObjectURL(file);
  });
}

