const FACE_BODY_HEIGHT_DESKTOP_VH = 300;
const FACE_BODY_HEIGHT_MOBILE_VH = 250;
const FACE_CENTER_RATIO = 0.14;
const FACE_CENTER_DESKTOP_VH = 55;
const FACE_CENTER_MOBILE_VH = 55;

export function calculateFaceCropPresentation(
  bounds,
  desktopVisibleVh = FACE_BODY_HEIGHT_DESKTOP_VH,
  mobileVisibleVh = FACE_BODY_HEIGHT_MOBILE_VH,
  faceCenterRatio = FACE_CENTER_RATIO,
  desktopFaceCenterVh = FACE_CENTER_DESKTOP_VH,
  mobileFaceCenterVh = FACE_CENTER_MOBILE_VH
) {
  const top = Number(bounds?.top ?? 0);
  const height = Number(bounds?.height ?? 1);
  const safeHeight = Number.isFinite(height) && height > 0 ? Math.min(1, height) : 1;
  const safeTop = Number.isFinite(top) ? Math.max(0, Math.min(1 - safeHeight, top)) : 0;
  const safeFaceRatio = Number.isFinite(faceCenterRatio) ? Math.max(0, Math.min(1, faceCenterRatio)) : FACE_CENTER_RATIO;
  const build = (visibleVh, faceCenterVh) => {
    const imageHeightVh = visibleVh / safeHeight;
    const visibleTopVh = faceCenterVh - visibleVh * safeFaceRatio;
    const imageTopVh = visibleTopVh - safeTop * imageHeightVh;
    return { imageHeightVh, imageTopVh };
  };
  return {
    desktop: build(desktopVisibleVh, desktopFaceCenterVh),
    mobile: build(mobileVisibleVh, mobileFaceCenterVh)
  };
}

export function measureAlphaBounds(image, sampleSize = 256, threshold = 8) {
  if (!image?.naturalWidth || !image?.naturalHeight || typeof document === "undefined") return null;
  const scale = Math.min(1, sampleSize / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] <= threshold) continue;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return {
    left: minX / width,
    top: minY / height,
    width: (maxX - minX + 1) / width,
    height: (maxY - minY + 1) / height
  };
}

export function calculateCharacterPositionOffset(bounds, position) {
  const left = Number(bounds?.left ?? 0);
  const width = Number(bounds?.width ?? 1);
  const safeLeft = Number.isFinite(left) ? Math.max(0, Math.min(1, left)) : 0;
  const safeWidth = Number.isFinite(width) && width > 0 ? Math.min(1 - safeLeft, width) : 1 - safeLeft;
  const right = Math.max(0, 1 - safeLeft - safeWidth);
  if (position === "left") return -safeLeft * 100;
  if (position === "right") return right * 100;
  if (position === "center") return (0.5 - (safeLeft + safeWidth / 2)) * 100;
  return 0;
}
