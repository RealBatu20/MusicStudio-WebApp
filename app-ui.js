function renderAll() {
  renderPatternSelect();
  renderStepNumbers();
  renderRack();
  renderPiano();
  renderPlaylist();
  renderMixer();
  renderInspector();
  renderSoundList();
  updateProjectStats();
}

function setActiveView(name) {
  activeMobileView = name;
  const mobile = matchMedia("(max-width: 900px)").matches;
  $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
  $$(".mobile-nav button").forEach((button) => button.classList.toggle("active", button.dataset.mobileTab === name));
  $$(".view").forEach((view) => view.classList.remove("active"));
  const view = $(`#${name}View`);
  if (view) view.classList.add("active");
  if (mobile) {
    $("#browserPanel").style.display = name === "browser" ? "grid" : "none";
    $("#inspectorPanel").style.display = name === "inspector" ? "grid" : "none";
    $(".center").style.display = ["browser", "inspector"].includes(name) ? "none" : "grid";
  } else {
    $("#browserPanel").style.display = "";
    $("#inspectorPanel").style.display = "";
    $(".center").style.display = "";
  }
  if (name === "piano") renderPiano();
  if (name === "playlist") renderPlaylist();
}

function showMenu(anchor, items) {
  $(".floating-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "floating-menu";
  Object.assign(menu.style, { position: "fixed", zIndex: 1000, minWidth: "180px", padding: "4px", background: "#2b2f34", border: "1px solid #090a0b", boxShadow: "0 10px 28px #000b", borderRadius: "4px" });
  items.forEach((item) => {
    const button = document.createElement("button");
    button.textContent = item.label;
    Object.assign(button.style, { width: "100%", minHeight: "32px", display: "block", textAlign: "left", padding: "5px 9px", border: "0", background: "transparent" });
    button.onclick = () => { menu.remove(); item.action(); };
    menu.append(button);
  });
  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${Math.min(rect.left, innerWidth - menu.offsetWidth - 6)}px`;
  menu.style.top = `${Math.min(rect.bottom + 2, innerHeight - menu.offsetHeight - 6)}px`;
  setTimeout(() => addEventListener("pointerdown", (event) => { if (!menu.contains(event.target)) menu.remove(); }, { once: true }), 0);
}

async function enableMidi() {
  if (!navigator.requestMIDIAccess) return setStatus("Web MIDI is not supported in this browser.");
  try {
    const access = await navigator.requestMIDIAccess();
    for (const input of access.inputs.values()) input.onmidimessage = (event) => {
      const [command, note, velocity] = event.data;
      if ((command & 0xf0) === 0x90 && velocity > 0) recordMidiNote(note, velocity / 127);
    };
    setStatus(`MIDI enabled with ${access.inputs.size} input device(s).`);
  } catch (error) { setStatus(`MIDI access failed: ${error}`); }
}

function recordMidiNote(midi, velocity = 0.8) {
  previewSoundAtMidi(midi);
  if (!state.recordArmed) return;
  pushHistory();
  state.pianoNotes.push({ channel: state.selectedChannel, step: state.currentStep % state.steps, midi: clamp(midi, 36, 84), length: Number($("#noteLengthSelect").value || 2), velocity: clamp(velocity, 0.05, 1) });
  saveActivePattern(); renderAll();
}

function handleKeyDown(event) {
  const target = event.target;
  if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); saveProjectFile(); return; }
  if (event.code === "Space") { event.preventDefault(); startPlayback(); return; }
  if (event.key === "Escape") { stopPlayback(); return; }
  if (event.key === "Delete") { clearSelectedChannel(); return; }
  const keyboard = { z: 60, s: 61, x: 62, d: 63, c: 64, v: 65, g: 66, b: 67, h: 68, n: 69, j: 70, m: 71, ",": 72 };
  const midi = keyboard[event.key.toLowerCase()];
  if (midi) recordMidiNote(midi, Number($("#velocityInput").value || 0.8));
}

function clearSelectedChannel() {
  const channel = state.channels[state.selectedChannel];
  if (!channel) return;
  pushHistory(); channel.steps = []; state.pianoNotes = state.pianoNotes.filter((note) => note.channel !== state.selectedChannel); saveActivePattern(); renderAll();
}

function handlePointerMove(event) {
  if (!dragSession) return;
  if (dragSession.type === "move-note") {
    const deltaStep = Math.round((event.clientX - dragSession.startX) / dragSession.metrics.stepWidth);
    const deltaRow = Math.round((event.clientY - dragSession.startY) / dragSession.metrics.rowHeight);
    dragSession.note.step = clamp(dragSession.originalStep + deltaStep, 0, state.steps - dragSession.note.length);
    dragSession.note.midi = clamp(dragSession.originalMidi - deltaRow, 36, 84);
    dragSession.element.style.left = `${dragSession.note.step * dragSession.metrics.stepWidth + 1}px`;
    dragSession.element.style.top = `${(dragSession.metrics.high - dragSession.note.midi) * dragSession.metrics.rowHeight + 2}px`;
  } else if (dragSession.type === "resize-note") {
    const delta = Math.round((event.clientX - dragSession.startX) / dragSession.metrics.stepWidth);
    dragSession.note.length = clamp(dragSession.originalLength + delta, 1, state.steps - dragSession.note.step);
    dragSession.element.style.width = `${dragSession.note.length * dragSession.metrics.stepWidth - 2}px`;
  } else if (dragSession.type === "move-clip") {
    const deltaStep = Math.round((event.clientX - dragSession.startX) / 28 / 4) * 4;
    const deltaTrack = Math.round((event.clientY - dragSession.startY) / 46);
    dragSession.clip.startStep = clamp(dragSession.originalStep + deltaStep, 0, state.playlistBars * 16 - 1);
    dragSession.clip.track = clamp(dragSession.originalTrack + deltaTrack, 0, state.playlistTracks - 1);
    dragSession.element.style.left = `${95 + dragSession.clip.startStep * 28 + 2}px`;
    dragSession.element.style.top = `${dragSession.clip.track * 46 + 4}px`;
  }
}

function finishDrag() {
  if (dragSession) { saveActivePattern(); dragSession = null; renderAll(); }
  paintSession = null;
}

function bindUi() {
  $("#syncCatalogBtn").onclick = syncOfficialCatalog;
  $("#catalogFile").onchange = (event) => event.target.files[0] && importCatalogFile(event.target.files[0]);
  $("#soundSearch").oninput = renderSoundList;
  $("#categoryFilter").onchange = renderSoundList;
  $("#favoritesOnlyBtn").onclick = (event) => { event.currentTarget.classList.toggle("active"); event.currentTarget.textContent = event.currentTarget.classList.contains("active") ? "★ FAV" : "☆ FAV"; renderSoundList(); };
  $("#loadAudioBtn").onclick = () => $("#audioDialog").showModal();
  $("#audioAssetsBtn").onclick = () => $("#audioDialog").showModal();
  $("#audioFolderInput").onchange = (event) => indexAudioFiles(event.target.files, $("#rememberAudioInput").checked);
  $("#audioFilesInput").onchange = (event) => indexAudioFiles(event.target.files, $("#rememberAudioInput").checked);
  $("#clearAudioBtn").onclick = clearStoredAudio;
  const drop = $("#audioDropZone");
  ["dragenter", "dragover"].forEach((name) => drop.addEventListener(name, (event) => { event.preventDefault(); drop.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((name) => drop.addEventListener(name, (event) => { event.preventDefault(); drop.classList.remove("dragover"); }));
  drop.ondrop = (event) => indexAudioFiles(event.dataTransfer.files, $("#rememberAudioInput").checked);

  $("#addChannelBtn").onclick = addChannel;
  $("#playBtn").onclick = startPlayback;
  $("#stopBtn").onclick = () => stopPlayback();
  $("#recordBtn").onclick = (event) => { state.recordArmed = !state.recordArmed; event.currentTarget.classList.toggle("armed", state.recordArmed); setStatus(state.recordArmed ? "Record armed. Play notes with Z–M or a MIDI keyboard." : "Record disarmed."); };
  $("#patternModeBtn").onclick = () => setPlaybackMode("pattern");
  $("#songModeBtn").onclick = () => setPlaybackMode("song");
  $("#tapTempoBtn").onclick = () => {
    const now = performance.now(); tapTimes = tapTimes.filter((time) => now - time < 2500); tapTimes.push(now);
    if (tapTimes.length >= 2) {
      const intervals = tapTimes.slice(1).map((time, index) => time - tapTimes[index]);
      state.bpm = clamp(Math.round(60000 / (intervals.reduce((a, b) => a + b, 0) / intervals.length)), 40, 300);
      $("#bpmInput").value = state.bpm; setStatus(`Tempo set to ${state.bpm} BPM.`); updateProjectStats();
    }
  };
  $("#bpmInput").onchange = (event) => { pushHistory(); state.bpm = clamp(Number(event.target.value) || 120, 40, 300); event.target.value = state.bpm; updateProjectStats(); };
  $("#swingInput").oninput = (event) => { state.swing = Number(event.target.value); $("#swingValue").value = `${state.swing}%`; updateProjectStats(); };
  $("#masterInput").oninput = (event) => { state.master = Number(event.target.value); $("#masterValue").value = `${Math.round(state.master * 100)}%`; if (masterGain) masterGain.gain.value = state.master; updateProjectStats(); };
  $("#loopInput").onchange = (event) => { state.loop = event.target.checked; updateProjectStats(); };
  $("#metronomeInput").onchange = (event) => { state.metronome = event.target.checked; updateProjectStats(); };
  $("#titleInput").oninput = (event) => { state.title = event.target.value; updateProjectStats(); };

  $("#patternSelect").onchange = (event) => loadPattern(event.target.value);
  $("#addPatternBtn").onclick = () => addPattern(false);
  $("#duplicatePatternBtn").onclick = () => addPattern(true);
  $("#deletePatternBtn").onclick = deletePattern;
  $("#randomizeBtn").onclick = randomizeSelectedChannel;
  $("#rotateLeftBtn").onclick = () => rotateSelectedChannel(-1);
  $("#rotateRightBtn").onclick = () => rotateSelectedChannel(1);
  $("#stepsSelect").onchange = (event) => {
    pushHistory(); state.steps = Number(event.target.value); state.channels.forEach((channel) => channel.steps = channel.steps.filter((step) => step < state.steps)); state.pianoNotes = state.pianoNotes.filter((note) => note.step < state.steps); state.patterns.forEach((pattern) => { pattern.channelSteps = pattern.channelSteps.map((steps) => steps.filter((step) => step < state.steps)); pattern.pianoNotes = pattern.pianoNotes.filter((note) => note.step < state.steps); }); saveActivePattern(); renderAll();
  };
  $("#pianoZoom").oninput = renderPiano;
  $("#clearPianoBtn").onclick = () => { pushHistory(); state.pianoNotes = state.pianoNotes.filter((note) => note.channel !== state.selectedChannel); saveActivePattern(); renderAll(); };
  $("#playlistBars").onchange = (event) => { state.playlistBars = Number(event.target.value); renderPlaylist(); updateProjectStats(); };
  $("#addPlaylistTrackBtn").onclick = () => { pushHistory(); state.playlistTracks = clamp(state.playlistTracks + 1, 1, 32); renderAll(); };
  $("#clearPlaylistBtn").onclick = () => { pushHistory(); state.playlistClips = []; renderAll(); };
  $("#resetMixerBtn").onclick = resetMixer;

  $("#saveProjectBtn").onclick = saveProjectFile;
  $("#exportBtn").onclick = () => { $("#lengthInput").value = state.playbackMode === "song" && state.playlistClips.length ? Math.max(...state.playlistClips.map((clip) => (clip.startStep + clip.lengthSteps) / 4)) : state.steps / 4; $("#exportModeSelect").value = state.playbackMode; $("#exportDialog").showModal(); };
  $("#downloadSongBtn").onclick = downloadSong;
  $("#copyJsonBtn").onclick = copyCompactJson;
  $("#projectImportInput").onchange = (event) => event.target.files[0] && importProjectFile(event.target.files[0]);
  $("#songImportInput").onchange = (event) => event.target.files[0] && importProjectFile(event.target.files[0]);

  $$(".tab").forEach((tab) => tab.onclick = () => setActiveView(tab.dataset.tab));
  $$(".mobile-nav button").forEach((button) => button.onclick = () => setActiveView(button.dataset.mobileTab));
  $("#mobileMenuBtn").onclick = () => setActiveView("browser");
  $("#closeBrowserBtn").onclick = () => setActiveView("rack");
  $("#closeInspectorBtn").onclick = () => setActiveView("rack");
  $("#fullscreenBtn").onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
  $("#helpBtn").onclick = () => $("#helpDialog").showModal();

  $("#newProjectBtn").onclick = (event) => showMenu(event.currentTarget, [
    { label: "New project", action: newProject }, { label: "Open .msproject", action: () => $("#projectImportInput").click() },
    { label: "Import .mssong", action: () => $("#songImportInput").click() }, { label: "Save project", action: saveProjectFile },
    { label: "Export song", action: () => $("#exportBtn").click() }
  ]);
  $("#undoMenuBtn").onclick = (event) => showMenu(event.currentTarget, [{ label: "Undo  Ctrl+Z", action: undo }, { label: "Redo  Ctrl+Y", action: redo }, { label: "Clear selected channel", action: clearSelectedChannel }, { label: "Clear current pattern", action: clearCurrentPattern }]);
  $("#addMenuBtn").onclick = (event) => showMenu(event.currentTarget, [{ label: "Add channel", action: addChannel }, { label: "Add pattern", action: () => addPattern(false) }, { label: "Enable MIDI input", action: enableMidi }, { label: "Load Minecraft audio", action: () => $("#audioDialog").showModal() }]);
  $("#patternMenuBtn").onclick = (event) => showMenu(event.currentTarget, [{ label: "New pattern", action: () => addPattern(false) }, { label: "Duplicate pattern", action: () => addPattern(true) }, { label: "Randomize channel", action: randomizeSelectedChannel }, { label: "Delete pattern", action: deletePattern }]);
  $("#viewMenuBtn").onclick = (event) => showMenu(event.currentTarget, ["rack", "piano", "playlist", "mixer"].map((name) => ({ label: name.replace(/^./, (char) => char.toUpperCase()), action: () => setActiveView(name) })));

  addEventListener("keydown", handleKeyDown);
  addEventListener("pointermove", handlePointerMove);
  addEventListener("pointerup", finishDrag);
  addEventListener("pointercancel", finishDrag);
  addEventListener("resize", () => setActiveView(activeMobileView));

  addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); deferredInstallPrompt = event; $("#installBtn").classList.remove("hidden"); });
  $("#installBtn").onclick = async () => { if (!deferredInstallPrompt) return; deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; $("#installBtn").classList.add("hidden"); };
}

function loadAutosave() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROJECT_KEY) || "null");
    if (saved && saved.version >= 2) restoreCore(saved);
  } catch (error) { console.warn("Autosave could not be restored", error); }
}

bindUi();
loadAutosave();
syncUiFromState();
renderCategories();
renderAll();
updateAudioStatus();
loadStoredAudio();
syncOfficialCatalog();
setActiveView("rack");

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(() => {});
