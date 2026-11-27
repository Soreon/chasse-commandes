// Infobulle de case, partagée par la vue 3D et la minimap.

import { TileType, TILE_TYPE_NAMES, getUpgradeCost, getBuyCost } from './engine/board.js';
import { RULES } from './engine/config.js';

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

// Contenu HTML de l'infobulle d'une case
export function tileTooltipHTML(game, tileId) {
  const tile = game.tiles[tileId];
  if (!tile) return null;

  const lines = [`<div class="tt-title">${TILE_TYPE_NAMES[tile.type] || tile.type} n° ${tile.id}</div>`];

  if (tile.zone) {
    const zoneDef = game.boardData.zones?.find(z => z.id === tile.zone);
    lines.push(`<div class="tt-zone">Zone : ${escapeHtml(zoneDef?.name || tile.zone)}</div>`);
  }

  if (tile.type === TileType.NORMAL || tile.type === TileType.BONUS) {
    if (tile.owner !== null) {
      const owner = game.players[tile.owner];
      const doubled = owner.doubleTollTurns > 0;
      lines.push(`<div class="tt-owner">Propriétaire : <span style="color:${owner.color}">${escapeHtml(owner.name)}</span></div>`);
      lines.push(`<div class="tt-level">Niveau ${tile.level} — valeur ${tile.currentValue.toLocaleString('fr-FR')} GP</div>`);
      lines.push(`<div class="tt-toll">Péage : ${(tile.tollValue * (doubled ? 2 : 1)).toLocaleString('fr-FR')} GP${doubled ? ' (doublé)' : ''}</div>`);
      if (tile.cardPlaced) lines.push(`<div class="tt-zone">Carte : ${escapeHtml(tile.cardPlaced.name)} (${tile.cardPlaced.value})</div>`);
      if (tile.level < RULES.maxLevel) {
        lines.push(`<div class="tt-zone">Amélioration : ${getUpgradeCost(tile).toLocaleString('fr-FR')} GP</div>`);
      }
    } else if (tile.type === TileType.BONUS) {
      const card = tile.presetCard;
      lines.push(`<div class="tt-value">Libre — coût : ${getBuyCost(tile, card).toLocaleString('fr-FR')} GP</div>`);
      lines.push(`<div class="tt-zone">Carte déjà posée : ${escapeHtml(card.name)} (${card.value}). Aucune carte à dépenser.</div>`);
    } else {
      const cost = RULES.buyCostIncludesCard
        ? `${tile.baseValue} GP + ${RULES.cardValueGP} GP par point de la carte posée`
        : `${tile.baseValue} GP`;
      lines.push(`<div class="tt-value">Libre — coût : ${cost}</div>`);
    }
  }

  for (const cube of game.prizeCubes.filter(c => c.tileId === tile.id)) {
    const rider = cube.riderId !== null ? ` — chevauché par ${escapeHtml(game.players[cube.riderId].name)}` : '';
    lines.push(`<div class="tt-cube">Prize Cube : ${cube.accumulatedGP} GP, ${cube.counter} pas restant${cube.counter > 1 ? 's' : ''}${rider}</div>`);
  }

  if (game.honeyPots.some(p => p.tileId === tile.id)) {
    lines.push('<div class="tt-cube">Pot de miel à ramasser</div>');
  }

  const here = game.players.filter(p => !p.eliminated && p.position === tile.id);
  if (here.length > 0) {
    const names = here.map(p => `<span style="color:${p.color}">${escapeHtml(p.name)}</span>`).join(', ');
    lines.push(`<div class="tt-owner">Ici : ${names}</div>`);
  }

  return lines.join('');
}

// Place l'infobulle près du pointeur sans sortir de l'écran
export function showTooltip(el, html, clientX, clientY) {
  if (!html) {
    el.classList.add('hidden');
    return;
  }
  el.innerHTML = html;
  el.classList.remove('hidden');

  const offset = 14;
  let x = clientX + offset;
  let y = clientY + offset;
  if (x + el.offsetWidth > window.innerWidth - 8) x = clientX - el.offsetWidth - offset;
  if (y + el.offsetHeight > window.innerHeight - 8) y = clientY - el.offsetHeight - offset;
  el.style.left = `${Math.max(4, x)}px`;
  el.style.top = `${Math.max(4, y)}px`;
}

export function hideTooltip(el) {
  el.classList.add('hidden');
}
