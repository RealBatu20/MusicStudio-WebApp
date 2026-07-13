function renderCategories() {
  const select = $("#categoryFilter");
  const value = select.value;
  const categories = [...new Set(state.sounds.map(soundCategory))].sort();
  select.replaceChildren(new Option("ALL", ""), ...categories.map((category) => new Option(category.toUpperCase(), category)));
  if (categories.includes(value)) select.value = value;
}

function renderSoundList() {
  const query = $("#soundSearch").value.trim().toLowerCase();
  const category = $("#categoryFilter").value;
  const favouritesOnly = $("#favoritesOnlyBtn").classList.contains("active");
  const list = $("#soundList");
  list.replaceChildren();
  const allMatches = state.sounds.filter((id) => (!query || id.includes(query)) && (!category || soundCategory(id) === category) && (!favouritesOnly || state.favourites.has(id)));
  const matches = allMatches.slice(0, 800);
  for (const sound of matches) {
    const row = document.createElement("div");
    row.className = `sound-row${sound === state.selectedSound ? " selected" : ""}`;
    const preview = document.createElement("button");
    preview.className = "sound-preview";
    preview.textContent = resolveAudioFile(sound) ? "▶" : "◇";
    preview.title = resolveAudioFile(sound) ? "Preview imported Minecraft audio" : "Preview synthesized fallback";
    preview.onclick = () => previewSound(sound);
    const assign = document.createElement("button");
    assign.className = "sound-assign";
    assign.textContent = sound;
    assign.title = `Category: ${soundCategory(sound)}\nAssign to selected channel`;
    assign.onclick = () => assignSound(sound);
    assign.ondblclick = () => previewSound(sound);
    const favourite = document.createElement("button");
    favourite.className = `sound-favourite${state.favourites.has(sound) ? " on" : ""}`;
    favourite.textContent = state.favourites.has(sound) ? "★" : "☆";
    favourite.onclick = () => toggleFavourite(sound);
    row.append(preview, assign, favourite);
    list.append(row);
  }
  if (allMatches.length > matches.length) {
    const note = document.createElement("div");
    note.className = "catalog-status";
    note.textContent = `Showing 800 of ${allMatches.length.toLocaleString()} matches. Refine the search.`;
    list.append(note);
  }
  if (!matches.length) {
    const note = document.createElement("div");
    note.className = "catalog-status";
    note.textContent = "No matching sound IDs.";
    list.append(note);
  }
}

function toggleFavourite(sound) {
  if (state.favourites.has(sound)) state.favourites.delete(sound); else state.favourites.add(sound);
  localStorage.setItem(FAVOURITES_KEY, JSON.stringify([...state.favourites]));
  renderSoundList();
}

function assignSound(sound) {
  const channel = state.channels[state.selectedChannel];
  if (!channel) return;
  pushHistory();
  state.selectedSound = sound;
  channel.sound = sound;
  channel.name = sound.split(".").slice(-2).join(" ").replace(/_/g, " ");
  renderAll();
  previewSound(sound);
  setStatus(`Assigned ${sound} to channel ${state.selectedChannel + 1}.`);
}

function renderPatternSelect() {
  const select = $("#patternSelect");
  select.replaceChildren(...state.patterns.map((pattern, index) => new Option(`${String(index + 1).padStart(2, "0")} • ${pattern.name}`, pattern.id)));
  select.value = state.activePatternId;
}

function renderStepNumbers() {
  const row = $("#stepNumbers");
  row.style.setProperty("--steps", state.steps);
  row.replaceChildren();
  const blank = document.createElement("span");
  blank.textContent = "CHANNEL / SOUND";
  row.append(blank);
  for (let i = 0; i < state.steps; i++) {
    const span = document.createElement("span");
    span.textContent = i + 1;
    row.append(span);
  }
}

function toggleStep(channelIndex, step, force = null) {
  const channel = state.channels[channelIndex];
  if (!channel) return;
  const index = channel.steps.indexOf(step);
  const turnOn = force === null ? index < 0 : force;
  if (turnOn && index < 0) channel.steps.push(step);
  if (!turnOn && index >= 0) channel.steps.splice(index, 1);
  channel.steps.sort((a, b) => a - b);
  saveActivePattern();
}

function renderRack() {
  const rack = $("#channelRack");
  rack.style.setProperty("--steps", state.steps);
  rack.replaceChildren();
  state.channels.forEach((channel, channelIndex) => {
    const row = document.createElement("div");
    row.className = "channel-row";
    row.style.setProperty("--steps", state.steps);

    const head = document.createElement("div");
    head.className = "channel-head";
    if (channelIndex === state.selectedChannel) head.style.outline = "1px solid var(--accent)";
    const color = document.createElement("button");
    color.className = "channel-color";
    color.style.background = COLORS[channelIndex % COLORS.length];
    color.title = "Select channel";
    color.onclick = () => selectChannel(channelIndex);
    const mute = document.createElement("button");
    mute.className = `channel-toggle mute${channel.mute ? " on" : ""}`;
    mute.textContent = "M";
    mute.onclick = () => { pushHistory(); channel.mute = !channel.mute; renderAll(); };
    const solo = document.createElement("button");
    solo.className = `channel-toggle solo${channel.solo ? " on" : ""}`;
    solo.textContent = "S";
    solo.onclick = () => { pushHistory(); channel.solo = !channel.solo; renderAll(); };
    const name = document.createElement("button");
    name.className = "channel-name";
    name.textContent = channel.name;
    name.title = `${channel.sound}\nClick to select; double-click to preview`;
    name.onclick = () => selectChannel(channelIndex);
    name.ondblclick = () => previewSound(channel.sound);
    const del = document.createElement("button");
    del.className = "channel-delete";
    del.textContent = "×";
    del.title = "Delete channel";
    del.onclick = () => deleteChannel(channelIndex);
    head.append(color, mute, solo, name, del);
    row.append(head);

    for (let step = 0; step < state.steps; step++) {
      const button = document.createElement("button");
      button.className = `step${step % 4 === 0 ? " beat" : ""}${channel.steps.includes(step) ? " on" : ""}`;
      button.dataset.step = step;
      button.dataset.channel = channelIndex;
      button.onpointerdown = (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        pushHistory();
        const turnOn = !channel.steps.includes(step);
        paintSession = { turnOn, visited: new Set([`${channelIndex}:${step}`]) };
        toggleStep(channelIndex, step, turnOn);
        previewSound(channel.sound);
        renderRack();
        updateProjectStats();
      };
      button.onpointerenter = () => {
        if (!paintSession) return;
        const key = `${channelIndex}:${step}`;
        if (paintSession.visited.has(key)) return;
        paintSession.visited.add(key);
        toggleStep(channelIndex, step, paintSession.turnOn);
        button.classList.toggle("on", paintSession.turnOn);
        updateProjectStats();
      };
      row.append(button);
    }
    rack.append(row);
  });
}

function selectChannel(index) {
  state.selectedChannel = clamp(index, 0, Math.max(0, state.channels.length - 1));
  state.selectedSound = state.channels[state.selectedChannel]?.sound || state.selectedSound;
  renderAll();
}

function addChannel() {
  pushHistory();
  const sound = state.selectedSound || "note.harp";
  state.channels.push({ id: uid("ch"), name: sound.split(".").slice(-2).join(" ").replace(/_/g, " "), sound, volume: 0.75, pitch: 1, pan: 0, filter: 20000, delay: 0, mute: false, solo: false, steps: [] });
  state.patterns.forEach((pattern) => pattern.channelSteps.push([]));
  state.selectedChannel = state.channels.length - 1;
  saveActivePattern();
  renderAll();
}

function deleteChannel(index) {
  if (state.channels.length <= 1) return setStatus("A project must keep at least one channel.");
  pushHistory();
  state.channels.splice(index, 1);
  state.patterns.forEach((pattern) => {
    pattern.channelSteps.splice(index, 1);
    pattern.pianoNotes = (pattern.pianoNotes || []).filter((note) => note.channel !== index).map((note) => ({ ...note, channel: note.channel > index ? note.channel - 1 : note.channel }));
  });
  state.pianoNotes = state.pianoNotes.filter((note) => note.channel !== index).map((note) => ({ ...note, channel: note.channel > index ? note.channel - 1 : note.channel }));
  state.selectedChannel = clamp(state.selectedChannel, 0, state.channels.length - 1);
  saveActivePattern();
  renderAll();
}

function pitchFromMidi(midi) {
  return clamp(Math.pow(2, (midi - 60) / 12), 0.1, 4);
}

function renderPiano() {
  const keys = $("#pianoKeys");
  const grid = $("#pianoGrid");
  keys.replaceChildren();
  grid.replaceChildren();
  const high = 84;
  const low = 36;
  const rowHeight = 24;
  const stepWidth = Number($("#pianoZoom").value || 30);
  const totalRows = high - low + 1;
  grid.style.height = `${totalRows * rowHeight}px`;
  grid.style.width = `${Math.max(grid.parentElement?.clientWidth || 900, state.steps * stepWidth)}px`;
  grid.style.backgroundSize = `100% ${rowHeight}px, ${stepWidth}px 100%, ${stepWidth * 4}px 100%`;

  for (let midi = high; midi >= low; midi--) {
    const noteName = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][midi % 12] + (Math.floor(midi / 12) - 1);
    const key = document.createElement("div");
    key.className = `piano-key${[1, 3, 6, 8, 10].includes(midi % 12) ? " black" : ""}`;
    key.textContent = noteName;
    key.onclick = () => previewSoundAtMidi(midi);
    keys.append(key);
  }

  grid.onpointerdown = (event) => {
    if (event.target !== grid || !state.channels.length) return;
    const rect = grid.getBoundingClientRect();
    const step = clamp(Math.floor((event.clientX - rect.left + grid.parentElement.scrollLeft) / stepWidth), 0, state.steps - 1);
    const row = clamp(Math.floor((event.clientY - rect.top + grid.parentElement.scrollTop) / rowHeight), 0, totalRows - 1);
    const midi = high - row;
    pushHistory();
    state.pianoNotes.push({ channel: state.selectedChannel, step, midi, length: Number($("#noteLengthSelect").value || 2), velocity: Number($("#velocityInput").value || 0.8) });
    saveActivePattern();
    previewSoundAtMidi(midi);
    renderAll();
  };

  for (const note of state.pianoNotes.filter((item) => item.channel === state.selectedChannel && item.step < state.steps)) {
    const el = document.createElement("div");
    el.className = "piano-note";
    el.style.left = `${note.step * stepWidth + 1}px`;
    el.style.top = `${(high - note.midi) * rowHeight + 2}px`;
    el.style.width = `${Math.max(1, note.length) * stepWidth - 2}px`;
    el.style.opacity = String(clamp(0.35 + note.velocity * 0.65, 0.35, 1));
    el.style.background = `linear-gradient(${COLORS[note.channel % COLORS.length]}, #875014)`;
    el.title = `MIDI ${note.midi} • length ${note.length} • velocity ${Math.round(note.velocity * 100)}%\nDrag to move; drag right edge to resize; double-click to remove`;
    el.ondblclick = (event) => {
      event.stopPropagation();
      pushHistory();
      state.pianoNotes.splice(state.pianoNotes.indexOf(note), 1);
      saveActivePattern();
      renderAll();
    };
    el.onpointerdown = (event) => startPianoDrag(event, note, el, { high, rowHeight, stepWidth });
    grid.append(el);
  }
  $("#pianoHint").textContent = state.channels[state.selectedChannel] ? `Channel ${state.selectedChannel + 1}: ${state.channels[state.selectedChannel].sound}` : "Add a channel first";
}

function startPianoDrag(event, note, element, metrics) {
  event.stopPropagation();
  event.preventDefault();
  pushHistory();
  const rect = element.getBoundingClientRect();
  dragSession = {
    type: event.clientX > rect.right - 8 ? "resize-note" : "move-note",
    note,
    element,
    startX: event.clientX,
    startY: event.clientY,
    originalStep: note.step,
    originalMidi: note.midi,
    originalLength: note.length,
    metrics
  };
  element.setPointerCapture?.(event.pointerId);
}

function previewSoundAtMidi(midi) {
  const channel = state.channels[state.selectedChannel];
  if (channel) playSound(channel.sound, { ...channel, mute: false, solo: false }, midi, null, 0.8, 0.22);
}

function renderPlaylist() {
  saveActivePattern();
  const ruler = $("#playlistRuler");
  const grid = $("#playlistGrid");
  ruler.replaceChildren();
  grid.replaceChildren();
  const totalSteps = state.playlistBars * 16;
  const width = 95 + totalSteps * 28;
  const height = Math.max(460, state.playlistTracks * 46);
  grid.style.width = `${width}px`;
  grid.style.minWidth = `${width}px`;
  grid.style.height = `${height}px`;
  grid.style.backgroundPosition = "95px 0, 95px 0, 95px 0";
  for (let bar = 0; bar < state.playlistBars; bar++) {
    const span = document.createElement("span");
    span.textContent = `BAR ${bar + 1}`;
    ruler.append(span);
  }
  for (let track = 0; track < state.playlistTracks; track++) {
    const label = document.createElement("div");
    label.className = "playlist-track-label";
    label.style.position = "absolute";
    label.style.top = `${track * 46}px`;
    label.textContent = `TRACK ${track + 1}`;
    grid.append(label);
  }
  if (!state.playlistClips.length) {
    const hint = document.createElement("div");
    hint.className = "playlist-empty-hint";
    hint.textContent = "Click the grid to place the selected pattern. Drag clips to arrange. Double-click a clip to delete.";
    grid.append(hint);
  }
  for (const clip of state.playlistClips) {
    const patternIndex = state.patterns.findIndex((pattern) => pattern.id === clip.patternId);
    const pattern = state.patterns[patternIndex];
    if (!pattern) continue;
    const el = document.createElement("div");
    el.className = `playlist-clip${clip.id === state.selectedClipId ? " selected" : ""}`;
    el.style.left = `${95 + clip.startStep * 28 + 2}px`;
    el.style.top = `${clip.track * 46 + 4}px`;
    el.style.width = `${Math.max(54, clip.lengthSteps * 28 - 4)}px`;
    el.style.background = `linear-gradient(${COLORS[Math.max(0, patternIndex) % COLORS.length]}, #774711)`;
    el.textContent = `${pattern.name} • ${clip.lengthSteps / 4} beats`;
    el.onclick = (event) => { event.stopPropagation(); state.selectedClipId = clip.id; renderPlaylist(); };
    el.ondblclick = (event) => { event.stopPropagation(); pushHistory(); state.playlistClips.splice(state.playlistClips.indexOf(clip), 1); state.selectedClipId = null; renderAll(); };
    el.onpointerdown = (event) => startClipDrag(event, clip, el);
    grid.append(el);
  }
  grid.onclick = (event) => {
    if (event.target !== grid) return;
    const rect = grid.getBoundingClientRect();
    const x = event.clientX - rect.left + grid.scrollLeft - 95;
    const y = event.clientY - rect.top + grid.scrollTop;
    if (x < 0) return;
    const startStep = clamp(Math.floor(x / 28 / 4) * 4, 0, totalSteps - 1);
    const track = clamp(Math.floor(y / 46), 0, state.playlistTracks - 1);
    pushHistory();
    state.playlistClips.push({ id: uid("clip"), patternId: state.activePatternId, startStep, track, lengthSteps: state.steps });
    renderAll();
  };
}

function startClipDrag(event, clip, element) {
  event.stopPropagation();
  event.preventDefault();
  pushHistory();
  dragSession = { type: "move-clip", clip, element, startX: event.clientX, startY: event.clientY, originalStep: clip.startStep, originalTrack: clip.track };
  element.setPointerCapture?.(event.pointerId);
}

function renderMixer() {
  const mixer = $("#mixer");
  mixer.replaceChildren();
  state.channels.forEach((channel, index) => {
    const strip = document.createElement("div");
    strip.className = `mixer-strip${index === state.selectedChannel ? " selected" : ""}`;
    strip.onclick = () => selectChannel(index);
    const title = document.createElement("strong");
    title.textContent = `INS ${index + 1} • ${channel.name}`;
    const toggles = document.createElement("div");
    toggles.className = "mixer-toggles";
    const mute = document.createElement("button");
    mute.textContent = "MUTE";
    mute.className = channel.mute ? "on" : "";
    mute.onclick = (event) => { event.stopPropagation(); pushHistory(); channel.mute = !channel.mute; renderAll(); };
    const solo = document.createElement("button");
    solo.textContent = "SOLO";
    solo.className = channel.solo ? "on" : "";
    solo.onclick = (event) => { event.stopPropagation(); pushHistory(); channel.solo = !channel.solo; renderAll(); };
    toggles.append(mute, solo);
    const wrap = document.createElement("div");
    wrap.className = "fader-wrap";
    const fader = document.createElement("input");
    fader.className = "fader";
    fader.type = "range"; fader.min = "0"; fader.max = "2"; fader.step = "0.01"; fader.value = channel.volume;
    fader.onpointerdown = (event) => { event.stopPropagation(); pushHistory(); };
    fader.oninput = () => { channel.volume = Number(fader.value); value.textContent = `${Math.round(channel.volume * 100)}%`; renderInspector(); updateProjectStats(); scheduleAutosave(); };
    const value = document.createElement("div");
    value.className = "mixer-value";
    value.textContent = `${Math.round(channel.volume * 100)}%`;
    wrap.append(fader);
    const knobs = document.createElement("div");
    knobs.className = "mixer-knobs";
    knobs.append(
      makeMiniControl("PAN", -1, 1, 0.01, channel.pan, (next) => channel.pan = next),
      makeMiniControl("CUT", 100, 20000, 100, channel.filter, (next) => channel.filter = next),
      makeMiniControl("DLY", 0, 0.75, 0.01, channel.delay, (next) => channel.delay = next)
    );
    strip.append(title, toggles, wrap, value, knobs);
    mixer.append(strip);
  });
}

function makeMiniControl(labelText, min, max, step, current, setter) {
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = "range"; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(current);
  input.onpointerdown = (event) => { event.stopPropagation(); pushHistory(); };
  input.oninput = (event) => { event.stopPropagation(); setter(Number(input.value)); renderInspector(); scheduleAutosave(); };
  label.append(input);
  return label;
}

function renderInspector() {
  const container = $("#channelInspector");
  const channel = state.channels[state.selectedChannel];
  if (!channel) { container.textContent = "No channel selected."; return; }
  container.innerHTML = `
    <div class="inspector-form">
      <label>Channel name<input id="inspectName" value="${escapeHtml(channel.name)}" maxlength="36"></label>
      <label>Sound ID<input id="inspectSound" value="${escapeHtml(channel.sound)}" list="soundSuggestions"></label>
      <datalist id="soundSuggestions">${state.sounds.slice(0, 300).map((sound) => `<option value="${escapeHtml(sound)}"></option>`).join("")}</datalist>
      <div class="row">
        <label>Volume <span class="readout" id="inspectVolumeReadout">${Math.round(channel.volume * 100)}%</span><input id="inspectVolume" type="range" min="0" max="2" step="0.01" value="${channel.volume}"></label>
        <label>Pitch <span class="readout" id="inspectPitchReadout">${channel.pitch.toFixed(2)}×</span><input id="inspectPitch" type="range" min="0.1" max="4" step="0.01" value="${channel.pitch}"></label>
      </div>
      <div class="row">
        <label>Pan <span class="readout" id="inspectPanReadout">${channel.pan.toFixed(2)}</span><input id="inspectPan" type="range" min="-1" max="1" step="0.01" value="${channel.pan}"></label>
        <label>Filter <span class="readout" id="inspectFilterReadout">${Math.round(channel.filter)} Hz</span><input id="inspectFilter" type="range" min="100" max="20000" step="100" value="${channel.filter}"></label>
      </div>
      <label>Delay <span class="readout" id="inspectDelayReadout">${channel.delay.toFixed(2)} s</span><input id="inspectDelay" type="range" min="0" max="0.75" step="0.01" value="${channel.delay}"></label>
      <div class="inspector-buttons">
        <button id="inspectPreview">PREVIEW</button>
        <button id="inspectClear">CLEAR STEPS</button>
        <button id="inspectMute">${channel.mute ? "UNMUTE" : "MUTE"}</button>
        <button id="inspectSolo">${channel.solo ? "UNSOLO" : "SOLO"}</button>
      </div>
    </div>`;
  const bindRange = (id, prop, readout, format) => {
    const input = $(`#${id}`);
    input.onpointerdown = pushHistory;
    input.oninput = () => { channel[prop] = Number(input.value); $(`#${readout}`).textContent = format(channel[prop]); renderMixer(); updateProjectStats(); scheduleAutosave(); };
  };
  $("#inspectName").onchange = (event) => { pushHistory(); channel.name = event.target.value.trim() || "Channel"; renderAll(); };
  $("#inspectSound").onchange = (event) => { const value = event.target.value.trim(); if (!value) return; pushHistory(); channel.sound = value; state.selectedSound = value; renderAll(); };
  bindRange("inspectVolume", "volume", "inspectVolumeReadout", (value) => `${Math.round(value * 100)}%`);
  bindRange("inspectPitch", "pitch", "inspectPitchReadout", (value) => `${value.toFixed(2)}×`);
  bindRange("inspectPan", "pan", "inspectPanReadout", (value) => value.toFixed(2));
  bindRange("inspectFilter", "filter", "inspectFilterReadout", (value) => `${Math.round(value)} Hz`);
  bindRange("inspectDelay", "delay", "inspectDelayReadout", (value) => `${value.toFixed(2)} s`);
  $("#inspectPreview").onclick = () => previewSound(channel.sound);
  $("#inspectClear").onclick = () => { pushHistory(); channel.steps = []; state.pianoNotes = state.pianoNotes.filter((note) => note.channel !== state.selectedChannel); saveActivePattern(); renderAll(); };
  $("#inspectMute").onclick = () => { pushHistory(); channel.mute = !channel.mute; renderAll(); };
  $("#inspectSolo").onclick = () => { pushHistory(); channel.solo = !channel.solo; renderAll(); };
}

