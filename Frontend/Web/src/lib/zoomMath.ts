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

/** As close as either viewer goes. */
export const MAX_ZOOM = 4;
/** Where a double click, a double tap or the first press of + takes the photo. */
export const TAP_ZOOM = 2.5;

/**
 * The scale one turn of the wheel leads to. A mouse's notch is about 100
 * pixels of `deltaY` and a trackpad sends many small ones, so the step is an
 * exponent of the distance and both feel even; a trackpad's pinch arrives as a
 * wheel with Ctrl held and small deltas, so it is read four times as strongly.
 * A delta in lines or pages is turned into pixels first. Held between 1 and
 * `MAX_ZOOM`.
 */
export function wheelZoom(scale: number, wheel: { deltaY: number; deltaMode: number; ctrlKey: boolean }, pageHeight: number): number {
  const pixels = wheel.deltaMode === 1 ? wheel.deltaY * 16 : wheel.deltaMode === 2 ? wheel.deltaY * pageHeight : wheel.deltaY;
  const next = scale * Math.exp(-pixels * (wheel.ctrlKey ? 0.008 : 0.002));
  return Math.min(MAX_ZOOM, Math.max(1, next));
}

/**
 * The pan that puts a point of the photo — given as a fraction of its width
 * and height, as a click measured it on the product page — under `at` at
 * `scale`. The photo is `photo` big at its own size and centred, so the
 * point sits at its fraction less a half of each side from the middle.
 */
export function panToPoint(fraction: Point, photo: { width: number; height: number }, scale: number, at: Point): Point {
  const point = { x: (fraction.x - 0.5) * photo.width, y: (fraction.y - 0.5) * photo.height };
  return { x: at.x - point.x * scale, y: at.y - point.y * scale };
}

/**
 * Where a viewer opens zoomed in: the point of the photo (fractions, as
 * `panToPoint` takes them) and where the pointer is on the screen, which the
 * point is put under when it is over the stage.
 */
export type ZoomStart = Point & { client: Point };
