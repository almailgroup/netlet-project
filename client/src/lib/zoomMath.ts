/**
 * The arithmetic of zooming a photo under a finger, pure, for `ZoomViewer`.
 *
 * A photo sits centred on its stage, moved by `pan` and grown by `scale` about
 * its own middle, so every point here is measured from the stage's centre.
 */
export type Point = { x: number; y: number };

/**
 * The pan that keeps the photo's point under `at` there while the scale goes
 * from `from` to `to`. Points are measured from the stage's centre, where the
 * photo sits at a pan of nothing.
 */
export function panAbout(at: Point, pan: Point, from: number, to: number): Point {
  const ratio = to / from;
  return { x: at.x - (at.x - pan.x) * ratio, y: at.y - (at.y - pan.y) * ratio };
}

/** As far as the photo hangs over the stage on each side, and no further. */
export function clampPan(pan: Point, scale: number, photo: { width: number; height: number }, stage: { width: number; height: number }): Point {
  const limitX = Math.max(0, (photo.width * scale - stage.width) / 2);
  const limitY = Math.max(0, (photo.height * scale - stage.height) / 2);
  /* `|| 0`: a clamp to nothing from below is -0, which reads as a move. */
  return {
    x: Math.min(limitX, Math.max(-limitX, pan.x)) || 0,
    y: Math.min(limitY, Math.max(-limitY, pan.y)) || 0,
  };
}

