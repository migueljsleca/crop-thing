"use client";

export type CropSettings = {
  backgroundThreshold: number;
  paddingPercent: number;
};

export type CropBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CropResult = {
  bounds: CropBounds;
  croppedWidth: number;
  croppedHeight: number;
  originalWidth: number;
  originalHeight: number;
  hasTransparency: boolean;
};

export type ExportSizing =
  | { mode: "original" }
  | { mode: "scale"; value: number }
  | { mode: "width"; value: number }
  | { mode: "height"; value: number }
  | { mode: "max-side"; value: number };

type RgbSample = {
  r: number;
  g: number;
  b: number;
  count: number;
};

const MAX_ANALYSIS_DIMENSION = 1200;
const ALPHA_THRESHOLD = 16;

export async function autoCropFile(
  source: Blob,
  settings: CropSettings,
): Promise<CropResult> {
  const bitmap = await createImageBitmap(source);

  try {
    const { bounds, hasTransparency } = detectCropBounds(bitmap, settings);
    const paddedBounds = addPadding(
      bounds,
      bitmap.width,
      bitmap.height,
      settings.paddingPercent,
    );

    return {
      bounds: paddedBounds,
      croppedWidth: paddedBounds.width,
      croppedHeight: paddedBounds.height,
      originalWidth: bitmap.width,
      originalHeight: bitmap.height,
      hasTransparency,
    };
  } finally {
    bitmap.close();
  }
}

export async function renderCropFromFile(
  source: Blob,
  bounds: CropBounds,
  sizing: ExportSizing = { mode: "original" },
): Promise<Blob> {
  const bitmap = await createImageBitmap(source);

  try {
    return await renderCrop(bitmap, bounds, sizing);
  } finally {
    bitmap.close();
  }
}

function detectCropBounds(
  bitmap: ImageBitmap,
  settings: CropSettings,
): { bounds: CropBounds; hasTransparency: boolean } {
  const { canvas, context, scale } = createAnalysisCanvas(bitmap);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  const { data, width, height } = context.getImageData(
    0,
    0,
    canvas.width,
    canvas.height,
  );

  const alphaBounds = findOpaqueBounds(data, width, height);
  if (alphaBounds && areaRatio(alphaBounds, width, height) < 0.985) {
    return {
      bounds: scaleBounds(alphaBounds, 1 / scale, bitmap.width, bitmap.height),
      hasTransparency: true,
    };
  }

  const backgroundPalette = estimateBackgroundPalette(data, width, height);
  const backgroundMask = floodFillBackground(
    data,
    width,
    height,
    backgroundPalette,
    settings.backgroundThreshold,
  );
  const foregroundBounds = largestForegroundComponent(
    data,
    width,
    height,
    backgroundMask,
  );

  if (!foregroundBounds || areaRatio(foregroundBounds, width, height) > 0.995) {
    return {
      bounds: {
        x: 0,
        y: 0,
        width: bitmap.width,
        height: bitmap.height,
      },
      hasTransparency: false,
    };
  }

  return {
    bounds: scaleBounds(foregroundBounds, 1 / scale, bitmap.width, bitmap.height),
    hasTransparency: false,
  };
}

function createAnalysisCanvas(bitmap: ImageBitmap) {
  const scale = Math.min(
    1,
    MAX_ANALYSIS_DIMENSION / Math.max(bitmap.width, bitmap.height),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d", {
    willReadFrequently: true,
  });

  if (!context) {
    throw new Error("Canvas 2D context is not available in this browser.");
  }

  return { canvas, context, scale };
}

function findOpaqueBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): CropBounds | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let seenTransparent = false;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3];

      if (alpha <= ALPHA_THRESHOLD) {
        seenTransparent = true;
        continue;
      }

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (!seenTransparent || maxX === -1 || maxY === -1) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

function estimateBackgroundPalette(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): RgbSample[] {
  const bucketMap = new Map<string, RgbSample>();
  const borderThickness = Math.max(3, Math.round(Math.min(width, height) * 0.04));

  const addSample = (x: number, y: number) => {
    const index = (y * width + x) * 4;
    const alpha = data[index + 3];

    if (alpha <= ALPHA_THRESHOLD) {
      return;
    }

    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
    const existing = bucketMap.get(key);

    if (existing) {
      existing.r += r;
      existing.g += g;
      existing.b += b;
      existing.count += 1;
      return;
    }

    bucketMap.set(key, { r, g, b, count: 1 });
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const isBorder =
        x < borderThickness ||
        y < borderThickness ||
        x >= width - borderThickness ||
        y >= height - borderThickness;

      if (isBorder) {
        addSample(x, y);
      }
    }
  }

  const ranked = [...bucketMap.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, 4)
    .map((sample) => ({
      r: sample.r / sample.count,
      g: sample.g / sample.count,
      b: sample.b / sample.count,
      count: sample.count,
    }));

  return ranked.length
    ? ranked
    : [
        {
          r: 255,
          g: 255,
          b: 255,
          count: 1,
        },
      ];
}

function floodFillBackground(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  palette: RgbSample[],
  threshold: number,
): Uint8Array {
  const totalPixels = width * height;
  const visited = new Uint8Array(totalPixels);
  const queue = new Int32Array(totalPixels);
  let head = 0;
  let tail = 0;

  const enqueue = (index: number) => {
    visited[index] = 1;
    queue[tail] = index;
    tail += 1;
  };

  for (let x = 0; x < width; x += 1) {
    seedBackgroundPixel(x, 0);
    seedBackgroundPixel(x, height - 1);
  }

  for (let y = 1; y < height - 1; y += 1) {
    seedBackgroundPixel(0, y);
    seedBackgroundPixel(width - 1, y);
  }

  while (head < tail) {
    const current = queue[head];
    head += 1;

    const x = current % width;
    const y = Math.floor(current / width);

    if (x > 0) {
      scanNeighbor(current - 1);
    }
    if (x < width - 1) {
      scanNeighbor(current + 1);
    }
    if (y > 0) {
      scanNeighbor(current - width);
    }
    if (y < height - 1) {
      scanNeighbor(current + width);
    }
  }

  return visited;

  function seedBackgroundPixel(x: number, y: number) {
    const index = y * width + x;

    if (visited[index]) {
      return;
    }

    if (isBackgroundLike(index)) {
      enqueue(index);
    }
  }

  function scanNeighbor(index: number) {
    if (visited[index]) {
      return;
    }

    if (isBackgroundLike(index)) {
      enqueue(index);
    }
  }

  function isBackgroundLike(pixelIndex: number) {
    const offset = pixelIndex * 4;
    const alpha = data[offset + 3];

    if (alpha <= ALPHA_THRESHOLD) {
      return true;
    }

    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];

    let bestDistance = Number.POSITIVE_INFINITY;

    for (const sample of palette) {
      const distance =
        (r - sample.r) * (r - sample.r) +
        (g - sample.g) * (g - sample.g) +
        (b - sample.b) * (b - sample.b);

      if (distance < bestDistance) {
        bestDistance = distance;
      }
    }

    return bestDistance <= threshold * threshold;
  }
}

function largestForegroundComponent(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  backgroundMask: Uint8Array,
): CropBounds | null {
  const totalPixels = width * height;
  const visited = new Uint8Array(totalPixels);
  const queue = new Int32Array(totalPixels);
  let bestArea = 0;
  let bestBounds: CropBounds | null = null;

  for (let index = 0; index < totalPixels; index += 1) {
    if (visited[index] || !isForeground(index)) {
      continue;
    }

    let head = 0;
    let tail = 0;
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    visited[index] = 1;
    queue[tail] = index;
    tail += 1;

    while (head < tail) {
      const current = queue[head];
      head += 1;
      area += 1;

      const x = current % width;
      const y = Math.floor(current / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      if (x > 0) {
        const left = current - 1;
        if (!visited[left] && isForeground(left)) {
          visited[left] = 1;
          queue[tail] = left;
          tail += 1;
        }
      }
      if (x < width - 1) {
        const right = current + 1;
        if (!visited[right] && isForeground(right)) {
          visited[right] = 1;
          queue[tail] = right;
          tail += 1;
        }
      }
      if (y > 0) {
        const up = current - width;
        if (!visited[up] && isForeground(up)) {
          visited[up] = 1;
          queue[tail] = up;
          tail += 1;
        }
      }
      if (y < height - 1) {
        const down = current + width;
        if (!visited[down] && isForeground(down)) {
          visited[down] = 1;
          queue[tail] = down;
          tail += 1;
        }
      }
    }

    if (area > bestArea) {
      bestArea = area;
      bestBounds = {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
      };
    }
  }

  return bestBounds;

  function isForeground(pixelIndex: number) {
    if (backgroundMask[pixelIndex]) {
      return false;
    }

    return data[pixelIndex * 4 + 3] > ALPHA_THRESHOLD;
  }
}

function addPadding(
  bounds: CropBounds,
  imageWidth: number,
  imageHeight: number,
  paddingPercent: number,
): CropBounds {
  const padding = Math.round(
    Math.max(imageWidth, imageHeight) * (paddingPercent / 100),
  );
  const x = Math.max(0, bounds.x - padding);
  const y = Math.max(0, bounds.y - padding);
  const width = Math.min(imageWidth - x, bounds.width + padding * 2);
  const height = Math.min(imageHeight - y, bounds.height + padding * 2);

  return { x, y, width, height };
}

function scaleBounds(
  bounds: CropBounds,
  scale: number,
  imageWidth: number,
  imageHeight: number,
): CropBounds {
  const x = Math.max(0, Math.floor(bounds.x * scale));
  const y = Math.max(0, Math.floor(bounds.y * scale));
  const width = Math.min(imageWidth - x, Math.ceil(bounds.width * scale));
  const height = Math.min(imageHeight - y, Math.ceil(bounds.height * scale));

  return {
    x,
    y,
    width: Math.max(1, width),
    height: Math.max(1, height),
  };
}

function areaRatio(bounds: CropBounds, width: number, height: number) {
  return (bounds.width * bounds.height) / (width * height);
}

async function renderCrop(
  bitmap: ImageBitmap,
  bounds: CropBounds,
  sizing: ExportSizing,
) {
  const { width: outputWidth, height: outputHeight } = getOutputSize(
    bounds,
    sizing,
  );
  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas 2D context is not available in this browser.");
  }

  context.drawImage(
    bitmap,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    outputWidth,
    outputHeight,
  );

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Unable to create cropped image."));
        return;
      }

      resolve(blob);
    }, "image/png");
  });
}

function getOutputSize(bounds: CropBounds, sizing: ExportSizing) {
  if (sizing.mode === "original") {
    return {
      width: bounds.width,
      height: bounds.height,
    };
  }

  if (sizing.mode === "scale") {
    return {
      width: Math.max(1, Math.round(bounds.width * sizing.value)),
      height: Math.max(1, Math.round(bounds.height * sizing.value)),
    };
  }

  if (sizing.mode === "width") {
    const scale = sizing.value / bounds.width;
    return {
      width: Math.max(1, Math.round(sizing.value)),
      height: Math.max(1, Math.round(bounds.height * scale)),
    };
  }

  if (sizing.mode === "height") {
    const scale = sizing.value / bounds.height;
    return {
      width: Math.max(1, Math.round(bounds.width * scale)),
      height: Math.max(1, Math.round(sizing.value)),
    };
  }

  const scale = sizing.value / Math.max(bounds.width, bounds.height);
  return {
    width: Math.max(1, Math.round(bounds.width * scale)),
    height: Math.max(1, Math.round(bounds.height * scale)),
  };
}
