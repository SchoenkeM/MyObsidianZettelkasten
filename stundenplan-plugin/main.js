/*
 * STUNDENPLAN PLUGIN  –  main.js
 * Obsidian 1.x  (no build step needed – plain JS plugin)
 *
 * Features implemented:
 *  1  6-col × 13-row grid (col1=time, col2-6=Mon-Fri)
 *  2  Times 07:00–18:00 in col1, bold
 *  3  Day headers in row1 col2-6, thick separators between day cols
 *  4  Minimal white/light-grey background style
 *  5  Thick lines every 2 rows, alternating bg
 *  6  Right-click → new card (only in day cells)
 *  7  Cards persisted in plugin data
 *  8  Card width = column width – 0.5%
 *  9  Card height drag-resizable (min = 0.5 row height)
 * 10  Card text, H1 size, scrollable
 * 11  Left-click toggles active state
 * 12  Ctrl+C / copy copies active card (placed 0.5 col width below)
 * 13  Drag-and-drop cards across cells; Del deletes active card
 * 14  Context menu: delete, colour picker, edit text
 */

const { Plugin, ItemView, WorkspaceLeaf } = require("obsidian");

const VIEW_TYPE = "stundenplan-view";
const DAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"];
const HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
const CARD_COLORS = [
  "#a8d8ea", "#b8e0d2", "#ffd6a5", "#ffadad",
  "#caffbf", "#e0bbff", "#fdffb6", "#cfcfcf"
];

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ─────────────────────────────────────────────────────────────
//  View
// ─────────────────────────────────────────────────────────────
class StundenplanView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.cards = plugin.data.cards || {};   // id → card object
    this.activeCardId = null;
    this.contextMenu = null;
    this._boundKeydown = this._onKeydown.bind(this);
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "Stundenplan"; }
  getIcon() { return "calendar-days"; }

  async onOpen() {
    this.containerEl.empty();
    this.containerEl.addClass("stundenplan-view");
    this._buildGrid();
    this._renderAllCards();
    document.addEventListener("keydown", this._boundKeydown);
    document.addEventListener("click", this._onDocClick.bind(this));
  }

  async onClose() {
    document.removeEventListener("keydown", this._boundKeydown);
    this._closeContextMenu();
  }

  // ── Build the empty grid ─────────────────────────────────
  _buildGrid() {
    const grid = document.createElement("div");
    grid.className = "stundenplan-grid";
    this.grid = grid;
    this.cellEls = {}; // "row-col" → td-like div

    for (let row = 0; row < 13; row++) {
      for (let col = 0; col < 6; col++) {
        const cell = document.createElement("div");
        cell.className = "stundenplan-cell";
        cell.dataset.row = row;
        cell.dataset.col = col;

        // ── Row 0: header ──
        if (row === 0) {
          cell.classList.add("header");
          if (col === 0) {
            /* empty top-left */
          } else {
            cell.classList.add("day-header");
            cell.textContent = DAYS[col - 1];
          }
        }
        // ── Col 0: time ──
        else if (col === 0) {
          cell.classList.add("time-cell");
          const hour = HOURS[row - 1];
          const nextHour = HOURS[row];   // undefined for last row → "19:00"
          const end = nextHour !== undefined ? nextHour : hour + 1;
          cell.textContent = `${hour}:00 – ${end}:00`;
        }
        // ── Content cells ──
        else {
          // Day column separator
          if (col < 5) cell.classList.add("day-col");

          // Alternating background every 2 content rows
          // row 1-2 → "odd" (white), row 3-4 → "even" (grey), …
          const band = Math.floor((row - 1) / 2);
          cell.classList.add(band % 2 === 0 ? "row-even" : "row-odd");

          // Horizontal line thickness
          if (row > 1) {
            if ((row - 1) % 2 === 0) {
              cell.classList.add("thick-top");
            } else {
              cell.classList.add("thin-top");
            }
          }

          // Right-click to create card
          cell.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            this._openCellContextMenu(e, row, col);
          });
        }

        grid.appendChild(cell);
        this.cellEls[`${row}-${col}`] = cell;
      }
    }

    this.containerEl.appendChild(grid);
    window.addEventListener("resize", () => this._renderAllCards());
  }

  // ── Cell geometry ─────────────────────────────────────────
  _getCellRect(row, col) {
    const el = this.cellEls[`${row}-${col}`];
    if (!el) return null;
    return el.getBoundingClientRect();
  }

  _getGridRect() {
    return this.grid.getBoundingClientRect();
  }

  _getRowHeight() {
    const el = this.cellEls["1-1"];
    return el ? el.getBoundingClientRect().height : 0;
  }

  _getColWidth() {
    const el = this.cellEls["0-1"];
    return el ? el.getBoundingClientRect().width : 0;
  }

  // ── Render all cards ──────────────────────────────────────
  _renderAllCards() {
    // Remove existing card els
    this.grid.querySelectorAll(".stundenplan-card").forEach(el => el.remove());

    Object.values(this.cards).forEach(card => this._renderCard(card));
  }

  _renderCard(card) {
    const gridRect = this._getGridRect();
    const colWidth = this._getColWidth();
    const rowHeight = this._getRowHeight();
    if (!colWidth || !rowHeight) return;

    const cellEl = this.cellEls[`1-${card.col}`];
    if (!cellEl) return;
    const cellRect = cellEl.getBoundingClientRect();

    // ── Width: 90% of column, centred horizontally ───────────
    const cardWidth = colWidth * 0.90;
    const hMargin = (colWidth - cardWidth) / 2;

    // ── Vertical margin: 10% of row height, top + bottom ─────
    const vMargin = rowHeight * 0.10;
    const totalSlotPx = Math.max(card.heightFrac, 0.5) * rowHeight;
    const cardHeight = Math.max(totalSlotPx - vMargin * 2, rowHeight * 0.3);

    const slotTopPx = (cellRect.top - gridRect.top) + card.topRowFrac * rowHeight;
    const cardTopPx = slotTopPx + vMargin;

    const el = document.createElement("div");
    el.className = "stundenplan-card";
    el.dataset.id = card.id;
    el.style.left   = (cellRect.left - gridRect.left + hMargin) + "px";
    el.style.top    = cardTopPx + "px";
    el.style.width  = cardWidth + "px";
    el.style.height = cardHeight + "px";
    el.style.background = card.color || CARD_COLORS[0];

    if (card.id === this.activeCardId) el.classList.add("active");

    // Text area – centred via flex
    const textEl = document.createElement("div");
    textEl.className = "card-text";
    textEl.contentEditable = "false";
    textEl.textContent = card.text || "";
    el.appendChild(textEl);

    // Resize handle
    const handle = document.createElement("div");
    handle.className = "card-resize-handle";
    el.appendChild(handle);

    // ── Drag to move ──
    el.addEventListener("mousedown", (e) => {
      if (e.target === handle) return;
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const origTop = parseFloat(el.style.top);
      const origLeft = parseFloat(el.style.left);
      let moved = false;

      const onMove = (me) => {
        const dx = me.clientX - startX;
        const dy = me.clientY - startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
        if (!moved) return;
        el.style.top = (origTop + dy) + "px";
        el.style.left = (origLeft + dx) + "px";
      };

      const onUp = (me) => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        if (moved) {
          this._snapCardToGrid(card.id, el);
        } else {
          // Single click: activate AND open text editor immediately
          this.activeCardId = card.id;
          this._updateActiveVisual();
          this._editCard(card.id);
        }
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    // ── Resize ──
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startY = e.clientY;
      const origHeight = parseFloat(el.style.height);

      const onMove = (me) => {
        const newH = Math.max(rowHeight * 0.5, origHeight + (me.clientY - startY));
        el.style.height = newH + "px";
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        // Snap height to 0.5 row increments
        const snapped = Math.round((parseFloat(el.style.height) / rowHeight) * 2) / 2;
        const margin2 = colWidth * 0.005;
        card.heightFrac = Math.max(0.5, snapped);
        el.style.height = (card.heightFrac * rowHeight) + "px";
        // Add top/bottom margin
        this._saveCards();
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    // ── Right-click on card ──
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._openCardContextMenu(e, card.id);
    });

    this.grid.appendChild(el);
  }

  _snapCardToGrid(cardId, el) {
    const card = this.cards[cardId];
    if (!card) return;
    const gridRect = this._getGridRect();
    const rowHeight = this._getRowHeight();
    const colWidth = this._getColWidth();

    const elLeft = parseFloat(el.style.left) + gridRect.left;
    const elTop = parseFloat(el.style.top) + gridRect.top;

    // Find which day column center is closest
    let bestCol = 1;
    let bestDist = Infinity;
    for (let c = 1; c <= 5; c++) {
      const cellRect = this._getCellRect(1, c);
      if (!cellRect) continue;
      const dist = Math.abs(cellRect.left + cellRect.width / 2 - (elLeft + parseFloat(el.style.width) / 2));
      if (dist < bestDist) { bestDist = dist; bestCol = c; }
    }

    // Find vertical position: top relative to row 1
    const row1Rect = this._getCellRect(1, bestCol);
    if (!row1Rect) return;
    const rowsFromTop = (elTop - row1Rect.top) / rowHeight;
    // Snap to 0.5 increments but keep within rows 1-12 (0 to 12)
    const snapped = Math.round(rowsFromTop * 2) / 2;
    const clampedTop = Math.max(0, Math.min(11.5, snapped));

    card.col = bestCol;
    card.topRowFrac = clampedTop;
    this._saveCards();
    this._renderAllCards();
  }

  // ── Context menus ─────────────────────────────────────────
  _openCellContextMenu(e, row, col) {
    this._closeContextMenu();
    const menu = document.createElement("div");
    menu.className = "stundenplan-context-menu";
    menu.style.left = e.clientX + "px";
    menu.style.top = e.clientY + "px";

    const addItem = (icon, label, fn) => {
      const item = document.createElement("div");
      item.className = "menu-item";
      item.innerHTML = `<span>${icon}</span><span>${label}</span>`;
      item.addEventListener("click", () => { this._closeContextMenu(); fn(); });
      menu.appendChild(item);
    };

    addItem("➕", "Neue Karte hier", () => {
      this._createCard(row, col);
    });

    document.body.appendChild(menu);
    this.contextMenu = menu;
  }

  _openCardContextMenu(e, cardId) {
    this._closeContextMenu();
    this.activeCardId = cardId;
    this._updateActiveVisual();

    const menu = document.createElement("div");
    menu.className = "stundenplan-context-menu";
    menu.style.left = e.clientX + "px";
    menu.style.top = e.clientY + "px";

    const addItem = (icon, label, fn) => {
      const item = document.createElement("div");
      item.className = "menu-item";
      item.innerHTML = `<span>${icon}</span><span>${label}</span>`;
      item.addEventListener("click", () => { this._closeContextMenu(); fn(); });
      menu.appendChild(item);
    };

    const addSep = () => {
      const s = document.createElement("div");
      s.className = "menu-separator";
      menu.appendChild(s);
    };

    addItem("✏️", "Bearbeiten", () => this._editCard(cardId));
    addSep();

    // Color picker row
    const colorLabel = document.createElement("div");
    colorLabel.className = "menu-item";
    colorLabel.innerHTML = `<span>🎨</span><span>Farbe</span>`;
    menu.appendChild(colorLabel);

    const colorRow = document.createElement("div");
    colorRow.className = "stundenplan-color-row";
    CARD_COLORS.forEach(c => {
      const swatch = document.createElement("div");
      swatch.className = "stundenplan-color-swatch";
      swatch.style.background = c;
      if (this.cards[cardId] && this.cards[cardId].color === c) swatch.classList.add("selected");
      swatch.addEventListener("click", () => {
        this._closeContextMenu();
        this._setCardColor(cardId, c);
      });
      colorRow.appendChild(swatch);
    });
    menu.appendChild(colorRow);

    addSep();
    addItem("🗑️", "Löschen", () => this._deleteCard(cardId));

    document.body.appendChild(menu);
    this.contextMenu = menu;
  }

  _closeContextMenu() {
    if (this.contextMenu) {
      this.contextMenu.remove();
      this.contextMenu = null;
    }
  }

  _onDocClick(e) {
    if (this.contextMenu && !this.contextMenu.contains(e.target)) {
      this._closeContextMenu();
    }
  }

  // ── Card operations ───────────────────────────────────────
  _createCard(row, col) {
    const id = uid();
    // topRowFrac: how many rows from top of row1 (row=1 = 0 offset)
    const topRowFrac = row - 1;
    const card = {
      id,
      col,
      topRowFrac,
      heightFrac: 1,
      text: "Neue Karte",
      color: CARD_COLORS[0]
    };
    this.cards[id] = card;
    this.activeCardId = id;
    this._saveCards();
    this._renderAllCards();
    // Auto-enter edit mode
    setTimeout(() => this._editCard(id), 50);
  }

  _editCard(cardId) {
    const el = this.grid.querySelector(`.stundenplan-card[data-id="${cardId}"] .card-text`);
    if (!el) return;
    el.contentEditable = "true";
    el.focus();
    // Select all
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const done = () => {
      el.contentEditable = "false";
      if (this.cards[cardId]) {
        this.cards[cardId].text = el.textContent;
        this._saveCards();
      }
      el.removeEventListener("blur", done);
    };
    el.addEventListener("blur", done);
  }

  _deleteCard(cardId) {
    delete this.cards[cardId];
    if (this.activeCardId === cardId) this.activeCardId = null;
    this._saveCards();
    this._renderAllCards();
  }

  _setCardColor(cardId, color) {
    if (this.cards[cardId]) {
      this.cards[cardId].color = color;
      this._saveCards();
      this._renderAllCards();
    }
  }

  _toggleActive(cardId) {
    if (this.activeCardId === cardId) {
      this.activeCardId = null;
    } else {
      this.activeCardId = cardId;
    }
    this._updateActiveVisual();
  }

  _updateActiveVisual() {
    this.grid.querySelectorAll(".stundenplan-card").forEach(el => {
      el.classList.toggle("active", el.dataset.id === this.activeCardId);
    });
  }

  _copyActiveCard() {
    if (!this.activeCardId) return;
    const orig = this.cards[this.activeCardId];
    if (!orig) return;
    const newId = uid();
    const newCard = Object.assign({}, orig, {
      id: newId,
      topRowFrac: orig.topRowFrac + orig.heightFrac + 0.5
    });
    this.cards[newId] = newCard;
    this.activeCardId = newId;
    this._saveCards();
    this._renderAllCards();
  }

  _onKeydown(e) {
    // Only act when view is visible
    if (!this.containerEl.isConnected) return;

    if (e.key === "Delete" && this.activeCardId) {
      e.preventDefault();
      this._deleteCard(this.activeCardId);
    }

    if ((e.ctrlKey || e.metaKey) && e.key === "c" && this.activeCardId) {
      e.preventDefault();
      this._copyActiveCard();
    }
  }

  async _saveCards() {
    this.plugin.data.cards = this.cards;
    await this.plugin.saveData(this.plugin.data);
  }
}

// ─────────────────────────────────────────────────────────────
//  Plugin
// ─────────────────────────────────────────────────────────────
class StundenplanPlugin extends Plugin {
  async onload() {
    this.data = (await this.loadData()) || { cards: {} };

    this.registerView(VIEW_TYPE, (leaf) => new StundenplanView(leaf, this));

    this.addRibbonIcon("calendar-days", "Stundenplan öffnen", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-stundenplan",
      name: "Stundenplan öffnen",
      callback: () => this.activateView()
    });
  }

  async onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
  }
}

module.exports = StundenplanPlugin;
