// HexJam - Hex grid math utilities
// Uses FLAT-TOP hexes with even-column (even-q) offset coordinates.
//
// Flat-top means the horizontal edges are flat (top/bottom), with vertices
// pointing left and right.  This produces a honeycomb that looks wider than
// tall — the natural "honeycomb" orientation seen in the reference.
//
// Even-q offset: even columns have no vertical offset; odd columns are
// shifted DOWN by half the vertical spacing.

/**
 * Convert even-q grid coordinates to screen pixel position.
 *
 *   hSpacing = 1.5 * size   (center-to-center horizontal)
 *   vSpacing = √3  * size   (center-to-center vertical)
 *   odd cols shifted down by vSpacing / 2
 */
export function hexToPixel(col, row, size, originX, originY) {
  const hSpacing = 1.5 * size;
  const vSpacing = Math.sqrt(3) * size;
  const x = originX + col * hSpacing;
  const y = originY + row * vSpacing + (col % 2) * (vSpacing / 2);
  return { x, y };
}

/**
 * Return the 6 vertex positions (relative to center) for a flat-top hex.
 * Vertex 0 is at the right (0°), continuing clockwise.
 * Returns a flat array [x0,y0, x1,y1, ...] for use with Phaser Graphics.
 */
export function getHexPoints(size) {
  const points = [];
  for (let i = 0; i < 6; i++) {
    const angleDeg = 60 * i;          // flat-top: first vertex at east (0°)
    const angleRad = (Math.PI / 180) * angleDeg;
    points.push(Math.cos(angleRad) * size);
    points.push(Math.sin(angleRad) * size);
  }
  return points;
}

/**
 * Return all valid in-bounds neighbors in even-q (flat-top) offset coordinates.
 *
 * Derivation: neighbor pixel offsets from center (c,r) are ±(hSpacing,0),
 * ±(hSpacing/2, ±vSpacing/2), ±(0, vSpacing) — accounting for odd-column
 * vertical shift gives the dc,dr deltas below.
 */
export function getNeighbors(col, row, cols, rows) {
  const isEvenCol = col % 2 === 0;
  const directions = isEvenCol
    ? [
        [+1, -1], [+1,  0],   // upper-right, lower-right
        [ 0, +1], [-1,  0],   // below, lower-left
        [-1, -1], [ 0, -1],   // upper-left, above
      ]
    : [
        [+1,  0], [+1, +1],   // upper-right, lower-right
        [ 0, +1], [-1, +1],   // below, lower-left
        [-1,  0], [ 0, -1],   // upper-left, above
      ];

  return directions
    .map(([dc, dr]) => ({ col: col + dc, row: row + dr }))
    .filter(({ col: c, row: r }) => c >= 0 && c < cols && r >= 0 && r < rows);
}

/**
 * Canonical string key for a hex cell, used in Maps/Sets.
 */
export function hexKey(col, row) {
  return `${col},${row}`;
}
