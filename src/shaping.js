/*
Shaping: manages dynamic flow-shaping strokes (start/append/end/get).
Tombstone: was previously embedded inside aeroCore; now isolated.
*/

let dynamicShapes = [];

/* API to manage a single stroke: start, append, end */
export function startShape(x, y) {
  dynamicShapes.push({ points: [{ x, y }], closed: false });
}
export function appendShapePoint(x, y) {
  if (!dynamicShapes.length) return;
  const cur = dynamicShapes[dynamicShapes.length - 1];
  cur.points.push({ x, y });
}
export function endShape() {
  if (!dynamicShapes.length) return;
  const cur = dynamicShapes[dynamicShapes.length - 1];
  cur.closed = true;
  if (dynamicShapes.length > 8) dynamicShapes.shift();
}
export function getDynamicShapes() {
  return dynamicShapes;
}