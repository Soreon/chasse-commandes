// Map Builder - Editeur de plateaux
// Porte depuis command-board/src/map-builder/

const cellClassToDataMap = {
  blueCheckpoint: { type: 'checkpoint', color: 'blue' },
  greenCheckpoint: { type: 'checkpoint', color: 'green' },
  redCheckpoint: { type: 'checkpoint', color: 'red' },
  yellowCheckpoint: { type: 'checkpoint', color: 'yellow' },
  dice: { type: 'damage', hasDice: true },
  damagePanel: { type: 'damage', noBox: true },
  horizontalTeleporter: { type: 'teleporter', direction: 'horizontal' },
  verticalTeleporter: { type: 'teleporter', direction: 'vertical' },
  bonusPanel: { type: 'bonus' },
  commandPanel: { type: 'command' },
  gpBoosterPanel: { type: 'booster' },
  specialPanel: { type: 'special' },
  startPanel: { type: 'start' },
  empty: {},
};

const cellDataToClassMap = {
  checkpoint: { blue: 'blueCheckpoint', green: 'greenCheckpoint', red: 'redCheckpoint', yellow: 'yellowCheckpoint' },
  teleporter: { horizontal: 'horizontalTeleporter', vertical: 'verticalTeleporter' },
  bonus: 'bonusPanel',
  command: 'commandPanel',
  booster: 'gpBoosterPanel',
  special: 'specialPanel',
  start: 'startPanel',
};

// Zone colors for the editor
const ZONE_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];
const ZONE_IDS = ['A', 'B', 'C', 'D', 'E', 'F'];

export class MapBuilder {
  constructor() {
    this.gridSize = 10;
    this.gridContainer = null;
    this.imageSelector = null;
    this.imagePreview = null;
    this.gridSizeInput = null;
    this.savedBoardsList = null;
    this.statusEl = null;
    this.zoneSelector = null;

    this.usedCheckpoints = new Set();
    this.isStartPanelUsed = false;
    this.mouseDownTarget = null;
    this.history = [];
    this.historyIndex = 0;

    this.presetBoards = {};    // boards.json
    this.currentZone = null;   // Selected zone for painting (null = no zone)

    this._onKeyDown = this._onKeyDown.bind(this);
  }

  init(containerEl, presetBoards) {
    this.presetBoards = presetBoards || {};

    this.gridContainer = containerEl.querySelector('#builder-grid');
    this.imageSelector = containerEl.querySelector('#builder-element');
    this.imagePreview = containerEl.querySelector('#builder-preview');
    this.gridSizeInput = containerEl.querySelector('#builder-grid-size');
    this.savedBoardsList = containerEl.querySelector('#builder-boards-list');
    this.statusEl = containerEl.querySelector('#builder-status');
    this.zoneSelector = containerEl.querySelector('#builder-zone');

    // Events
    this.imageSelector.addEventListener('change', () => this._onElementSelect());
    this.gridSizeInput.addEventListener('change', (e) => this._onGridSizeChange(e));

    containerEl.querySelector('#builder-save').addEventListener('click', () => this._saveBoard());
    containerEl.querySelector('#builder-load').addEventListener('click', () => this._loadBoard());
    containerEl.querySelector('#builder-delete').addEventListener('click', () => this._deleteBoard());
    containerEl.querySelector('#builder-reset').addEventListener('click', () => this._resetGrid());
    containerEl.querySelector('#builder-validate').addEventListener('click', () => this._validate());
    containerEl.querySelector('#builder-shift-up').addEventListener('click', () => this._shiftUp());
    containerEl.querySelector('#builder-shift-down').addEventListener('click', () => this._shiftDown());
    containerEl.querySelector('#builder-shift-left').addEventListener('click', () => this._shiftLeft());
    containerEl.querySelector('#builder-shift-right').addEventListener('click', () => this._shiftRight());

    this.savedBoardsList.addEventListener('change', () => this._updateBoardButtons());

    if (this.zoneSelector) {
      this.zoneSelector.addEventListener('change', () => {
        this.currentZone = this.zoneSelector.value || null;
      });
    }

    // Grid click/drag
    this.gridContainer.addEventListener('click', (e) => {
      if (e.target.classList.contains('builder-cell')) this._onCellClick(e.target);
    });
    this.gridContainer.addEventListener('mousemove', (e) => {
      if (!this.mouseDownTarget) return;
      if (e.target.classList.contains('builder-cell') && e.target !== this.mouseDownTarget) {
        this._onCellClick(e.target);
      }
    });

    document.addEventListener('mousedown', (e) => { this.mouseDownTarget = e.target; });
    document.addEventListener('mouseup', () => { this.mouseDownTarget = null; });

    // Generate initial grid
    this.gridSizeInput.value = this.gridSize;
    this._generateGrid();
    this._refreshBoardsList();
    this._addHistory();
  }

  activate() {
    document.addEventListener('keydown', this._onKeyDown);
  }

  deactivate() {
    document.removeEventListener('keydown', this._onKeyDown);
  }

  // Get custom boards from localStorage (for game setup)
  static getCustomBoards() {
    try {
      return JSON.parse(localStorage.getItem('customBoards')) || {};
    } catch { return {}; }
  }

  // === Grid generation ===

  _generateGrid() {
    this.gridContainer.innerHTML = '';
    this.gridContainer.style.setProperty('--builder-grid-size', this.gridSize);

    const fragment = document.createDocumentFragment();
    for (let i = 0; i < this.gridSize * this.gridSize; i++) {
      const cell = document.createElement('div');
      cell.className = 'builder-cell';
      cell.draggable = false;
      fragment.appendChild(cell);
    }
    this.gridContainer.appendChild(fragment);
  }

  // === Cell painting ===

  _onCellClick(cell) {
    const selectedClass = this.imageSelector.value;

    // Re-enable singleton if removing it
    const oldClass = this._getCellTypeClass(cell);
    if (oldClass) {
      if (['blueCheckpoint', 'greenCheckpoint', 'redCheckpoint', 'yellowCheckpoint'].includes(oldClass)) {
        this.usedCheckpoints.delete(oldClass);
        this._enableOption(oldClass);
      }
      if (oldClass === 'startPanel') {
        this.isStartPanelUsed = false;
        this._enableOption('startPanel');
      }
    }

    // Reset cell
    cell.className = 'builder-cell';
    cell.removeAttribute('data-zone');
    cell.style.removeProperty('--zone-color');

    if (selectedClass !== 'empty') {
      cell.classList.add(selectedClass);

      // Disable singletons
      if (selectedClass.includes('Checkpoint')) {
        this.usedCheckpoints.add(selectedClass);
        this._disableOption(selectedClass);
        this.imageSelector.value = 'empty';
        this._onElementSelect();
      } else if (selectedClass === 'startPanel') {
        this.isStartPanelUsed = true;
        this._disableOption('startPanel');
        this.imageSelector.value = 'empty';
        this._onElementSelect();
      }

      // Apply zone to command panels
      if (selectedClass === 'commandPanel' && this.currentZone) {
        cell.dataset.zone = this.currentZone;
        const zIdx = ZONE_IDS.indexOf(this.currentZone);
        if (zIdx >= 0) cell.style.setProperty('--zone-color', ZONE_COLORS[zIdx]);
      }
    }

    this._addHistory();
  }

  _getCellTypeClass(cell) {
    for (const cls of Object.keys(cellClassToDataMap)) {
      if (cls !== 'empty' && cell.classList.contains(cls)) return cls;
    }
    return null;
  }

  _onElementSelect() {
    const val = this.imageSelector.value;
    this.imagePreview.className = 'builder-preview ' + val;
  }

  // === Board data ===

  _getBoardData() {
    const cells = this.gridContainer.querySelectorAll('.builder-cell');
    const data = [];
    for (let r = 0; r < this.gridSize; r++) {
      const row = [];
      for (let c = 0; c < this.gridSize; c++) {
        const cell = cells[r * this.gridSize + c];
        let cellData = {};
        for (const [cls, dataObj] of Object.entries(cellClassToDataMap)) {
          if (cell.classList.contains(cls)) {
            cellData = JSON.parse(JSON.stringify(dataObj));
            break;
          }
        }
        // Zone
        if (cell.dataset.zone && cellData.type === 'command') {
          cellData.zone = cell.dataset.zone;
        }
        row.push(cellData);
      }
      data.push(row);
    }
    return data;
  }

  _loadBoardData(boardData) {
    const maxRows = boardData.length;
    const maxCols = Math.max(...boardData.map(r => r.length));
    const size = Math.max(maxRows, maxCols);

    if (size !== this.gridSize) {
      this.gridSize = size;
      this.gridSizeInput.value = size;
      this._generateGrid();
    }

    const cells = this.gridContainer.querySelectorAll('.builder-cell');
    this.usedCheckpoints.clear();
    this.isStartPanelUsed = false;

    for (let r = 0; r < boardData.length; r++) {
      for (let c = 0; c < boardData[r].length; c++) {
        const idx = r * this.gridSize + c;
        if (idx >= cells.length) continue;
        const cell = cells[idx];
        const d = boardData[r][c];

        cell.className = 'builder-cell';
        cell.removeAttribute('data-zone');
        cell.style.removeProperty('--zone-color');

        if (!d || !d.type) continue;

        if (d.type === 'checkpoint') {
          const cls = cellDataToClassMap.checkpoint[d.color];
          if (cls) { cell.classList.add(cls); this.usedCheckpoints.add(cls); }
        } else if (d.type === 'damage') {
          cell.classList.add(d.hasDice ? 'dice' : 'damagePanel');
        } else if (d.type === 'teleporter') {
          const cls = cellDataToClassMap.teleporter[d.direction];
          if (cls) cell.classList.add(cls);
        } else if (d.type === 'start') {
          cell.classList.add('startPanel');
          this.isStartPanelUsed = true;
        } else {
          const cls = cellDataToClassMap[d.type];
          if (cls) cell.classList.add(cls);
        }

        // Zone
        if (d.zone) {
          cell.dataset.zone = d.zone;
          const zIdx = ZONE_IDS.indexOf(d.zone);
          if (zIdx >= 0) cell.style.setProperty('--zone-color', ZONE_COLORS[zIdx]);
        }
      }
    }

    // Update option states
    this._enableAllOptions();
    for (const cp of this.usedCheckpoints) this._disableOption(cp);
    if (this.isStartPanelUsed) this._disableOption('startPanel');
  }

  // === Zone assignment from boards.json zones array ===

  _applyZoneDefs(boardData, zones) {
    if (!zones || !zones.length) return boardData;
    for (const zone of zones) {
      if (!zone.tiles) continue;
      for (const [r, c] of zone.tiles) {
        if (boardData[r] && boardData[r][c] && boardData[r][c].type === 'command') {
          boardData[r][c].zone = zone.id;
        }
      }
    }
    return boardData;
  }

  // === Save / Load / Delete ===

  _saveBoard() {
    const name = prompt('Nom du plateau :');
    if (!name) return;

    const boards = MapBuilder.getCustomBoards();
    if (boards[name]) {
      if (!confirm(`"${name}" existe deja. Ecraser ?`)) return;
    }

    boards[name] = { grid: this._getBoardData(), zones: this._buildZoneDefs() };
    localStorage.setItem('customBoards', JSON.stringify(boards));
    this._refreshBoardsList();
    this._setStatus(`Plateau "${name}" sauvegarde.`);
  }

  _buildZoneDefs() {
    const boardData = this._getBoardData();
    const zonesMap = {};
    for (let r = 0; r < boardData.length; r++) {
      for (let c = 0; c < boardData[r].length; c++) {
        const d = boardData[r][c];
        if (d.zone) {
          if (!zonesMap[d.zone]) zonesMap[d.zone] = [];
          zonesMap[d.zone].push([r, c]);
        }
      }
    }
    return Object.entries(zonesMap).map(([id, tiles], i) => ({
      id,
      name: `Zone ${id}`,
      color: ZONE_COLORS[ZONE_IDS.indexOf(id)] || ZONE_COLORS[i % ZONE_COLORS.length],
      tiles,
    }));
  }

  _loadBoard() {
    const sel = this.savedBoardsList.value;
    if (!sel || sel === '') return;

    let boardData, zones;
    if (sel.startsWith('preset:')) {
      const name = sel.substring(7);
      const entry = this.presetBoards[name];
      if (!entry) return;
      boardData = JSON.parse(JSON.stringify(entry.grid || entry));
      zones = entry.zones || [];
      boardData = this._applyZoneDefs(boardData, zones);
    } else {
      const boards = MapBuilder.getCustomBoards();
      const entry = boards[sel];
      if (!entry) return;
      boardData = JSON.parse(JSON.stringify(entry.grid || entry));
      zones = entry.zones || [];
      boardData = this._applyZoneDefs(boardData, zones);
    }

    this._loadBoardData(boardData);
    this._resetHistory();
    this._addHistory();
    this._setStatus(`Plateau charge.`);
  }

  _deleteBoard() {
    const sel = this.savedBoardsList.value;
    if (!sel || sel === '' || sel.startsWith('preset:')) return;

    const boards = MapBuilder.getCustomBoards();
    delete boards[sel];
    localStorage.setItem('customBoards', JSON.stringify(boards));
    this._refreshBoardsList();
    this._setStatus(`Plateau supprime.`);
  }

  _refreshBoardsList() {
    this.savedBoardsList.innerHTML = '<option value="">-- Choisir --</option>';

    // Custom boards
    const custom = MapBuilder.getCustomBoards();
    if (Object.keys(custom).length > 0) {
      const grp = document.createElement('optgroup');
      grp.label = 'Mes plateaux';
      for (const name of Object.keys(custom)) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        grp.appendChild(opt);
      }
      this.savedBoardsList.appendChild(grp);
    }

    // Preset boards
    if (Object.keys(this.presetBoards).length > 0) {
      const grp = document.createElement('optgroup');
      grp.label = 'Presets';
      for (const name of Object.keys(this.presetBoards)) {
        const opt = document.createElement('option');
        opt.value = `preset:${name}`;
        opt.textContent = name;
        grp.appendChild(opt);
      }
      this.savedBoardsList.appendChild(grp);
    }

    this._updateBoardButtons();
  }

  _updateBoardButtons() {
    const sel = this.savedBoardsList.value;
    const hasSelection = sel && sel !== '';
    const container = this.savedBoardsList.closest('.builder-field');
    if (container) {
      const loadBtn = container.querySelector('#builder-load');
      const delBtn = container.querySelector('#builder-delete');
      if (loadBtn) loadBtn.disabled = !hasSelection;
      if (delBtn) delBtn.disabled = !hasSelection || sel.startsWith('preset:');
    }
  }

  // === Validation ===

  _validate() {
    const boardData = this._getBoardData();
    const msgs = [];
    const flat = [];

    for (const row of boardData) {
      for (const cell of row) {
        let code = ' ';
        if (cell.type === 'checkpoint') {
          code = { blue: 'B', green: 'G', red: 'R', yellow: 'Y' }[cell.color] || '?';
        } else if (cell.type === 'damage') {
          code = cell.hasDice ? 'D' : 'P';
        } else if (cell.type === 'teleporter') {
          code = cell.direction === 'horizontal' ? 'H' : 'V';
        } else if (cell.type === 'bonus') code = 'O';
        else if (cell.type === 'command') code = 'C';
        else if (cell.type === 'booster') code = 'M';
        else if (cell.type === 'special') code = 'S';
        else if (cell.type === 'start') code = 'A';
        flat.push(code);
      }
    }

    if (!flat.includes('A')) msgs.push('Il manque la case Depart.');
    if (!flat.includes('B') || !flat.includes('G') || !flat.includes('R') || !flat.includes('Y')) {
      msgs.push('Il manque un ou plusieurs checkpoints (4 requis).');
    }

    for (let i = 0; i < flat.length; i++) {
      if (flat[i] === ' ') continue;
      const neighbors = this._getNeighborCodes(flat, i);
      const nonEmpty = neighbors.filter(n => n !== ' ');
      if (nonEmpty.length < 2 && flat[i] !== 'H' && flat[i] !== 'V') {
        const r = Math.floor(i / this.gridSize), c = i % this.gridSize;
        msgs.push(`Case isolee en (${r}, ${c}).`);
      }
      if (flat[i] === 'D' && !neighbors.includes('P')) {
        const r = Math.floor(i / this.gridSize), c = i % this.gridSize;
        msgs.push(`Dice en (${r}, ${c}) sans case damage adjacente.`);
      }
    }

    if (msgs.length === 0) {
      this._setStatus('Le plateau est valide !');
      alert('Le plateau est valide !');
    } else {
      this._setStatus(`${msgs.length} probleme(s) detecte(s).`);
      alert(msgs.join('\n'));
    }
    return msgs.length === 0;
  }

  _getNeighborCodes(flat, idx) {
    const r = Math.floor(idx / this.gridSize), c = idx % this.gridSize;
    const codes = [];
    if (r > 0) codes.push(flat[(r - 1) * this.gridSize + c]);
    else codes.push(' ');
    if (r < this.gridSize - 1) codes.push(flat[(r + 1) * this.gridSize + c]);
    else codes.push(' ');
    if (c > 0) codes.push(flat[r * this.gridSize + (c - 1)]);
    else codes.push(' ');
    if (c < this.gridSize - 1) codes.push(flat[r * this.gridSize + (c + 1)]);
    else codes.push(' ');
    return codes;
  }

  // === Grid shifting ===

  _shiftUp() {
    const cells = this.gridContainer.querySelectorAll('.builder-cell');
    for (let i = 0; i < this.gridSize; i++) {
      const cell = cells[i];
      cell.className = 'builder-cell';
      cell.removeAttribute('data-zone');
      cell.style.removeProperty('--zone-color');
      this.gridContainer.appendChild(cell);
    }
    this._addHistory();
  }

  _shiftDown() {
    const cells = this.gridContainer.querySelectorAll('.builder-cell');
    const start = (this.gridSize - 1) * this.gridSize;
    for (let i = this.gridSize - 1; i >= 0; i--) {
      const cell = cells[start + i];
      cell.className = 'builder-cell';
      cell.removeAttribute('data-zone');
      cell.style.removeProperty('--zone-color');
      this.gridContainer.prepend(cell);
    }
    this._addHistory();
  }

  _shiftLeft() {
    const cells = Array.from(this.gridContainer.querySelectorAll('.builder-cell'));
    for (let r = 0; r < this.gridSize; r++) {
      const cell = cells[r * this.gridSize];
      cell.className = 'builder-cell';
      cell.removeAttribute('data-zone');
      cell.style.removeProperty('--zone-color');
      // Move to end of row (append to container, grid reflows)
    }
    // Simpler: just reload from shifted data
    const data = this._getBoardData();
    for (let r = 0; r < data.length; r++) {
      data[r].shift();
      data[r].push({});
    }
    this._loadBoardData(data);
    this._addHistory();
  }

  _shiftRight() {
    const data = this._getBoardData();
    for (let r = 0; r < data.length; r++) {
      data[r].pop();
      data[r].unshift({});
    }
    this._loadBoardData(data);
    this._addHistory();
  }

  // === Grid resize ===

  _onGridSizeChange(e) {
    const newSize = parseInt(e.target.value, 10);
    if (newSize < 3 || newSize > 30) return;

    const oldData = this._getBoardData();
    this.gridSize = newSize;
    this._generateGrid();

    // Preserve existing data
    const newData = [];
    for (let r = 0; r < newSize; r++) {
      const row = [];
      for (let c = 0; c < newSize; c++) {
        if (r < oldData.length && c < oldData[r].length) {
          row.push(oldData[r][c]);
        } else {
          row.push({});
        }
      }
      newData.push(row);
    }
    this._loadBoardData(newData);
    this._addHistory();
  }

  // === History (undo/redo) ===

  _addHistory() {
    const state = JSON.stringify(this._getBoardData());
    if (this.history[this.history.length - 1] === state) return;

    if (this.history.length > 0 && this.historyIndex < this.history.length - 1) {
      this.history.splice(this.historyIndex + 1);
    }
    this.history.push(state);
    this.historyIndex = this.history.length - 1;
  }

  _resetHistory() {
    this.history = [];
    this.historyIndex = 0;
  }

  _undo() {
    if (this.historyIndex <= 0) return;
    this.historyIndex--;
    this._loadBoardData(JSON.parse(this.history[this.historyIndex]));
  }

  _redo() {
    if (this.historyIndex >= this.history.length - 1) return;
    this.historyIndex++;
    this._loadBoardData(JSON.parse(this.history[this.historyIndex]));
  }

  _onKeyDown(e) {
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); this._undo(); }
    if (e.ctrlKey && e.key === 'y') { e.preventDefault(); this._redo(); }
  }

  // === Reset ===

  _resetGrid() {
    if (!confirm('Reinitialiser la grille ?')) return;
    this.usedCheckpoints.clear();
    this.isStartPanelUsed = false;
    this._enableAllOptions();
    const cells = this.gridContainer.querySelectorAll('.builder-cell');
    cells.forEach(c => {
      c.className = 'builder-cell';
      c.removeAttribute('data-zone');
      c.style.removeProperty('--zone-color');
    });
    this._resetHistory();
    this._addHistory();
    this._setStatus('Grille reinitialisee.');
  }

  // === Helpers ===

  _enableOption(val) {
    const opt = this.imageSelector.querySelector(`option[value="${val}"]`);
    if (opt) opt.disabled = false;
  }

  _disableOption(val) {
    const opt = this.imageSelector.querySelector(`option[value="${val}"]`);
    if (opt) opt.disabled = true;
  }

  _enableAllOptions() {
    this.imageSelector.querySelectorAll('option').forEach(o => { o.disabled = false; });
  }

  _setStatus(msg) {
    if (this.statusEl) this.statusEl.textContent = msg;
  }
}
