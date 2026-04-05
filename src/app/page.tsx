"use client";

import JSZip from "jszip";
import Image from "next/image";
import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import {
  Download,
  LoaderCircle,
  Menu,
  MoreHorizontal,
  Package,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  CropResult,
  ExportSizing,
  CropSettings,
  autoCropFile,
  renderCropFromFile,
} from "@/lib/auto-crop";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

type ImageItem = {
  id: string;
  file: File;
  originalUrl: string;
  previewUrl: string | null;
  result: CropResult | null;
  status: "processing" | "ready" | "error";
  error: string | null;
};

type ExportMode = "scale" | "width" | "height" | "max-side";
type ThumbnailMenuState = {
  id: string;
  x: number;
  y: number;
};

const DEFAULT_SETTINGS: CropSettings = {
  backgroundThreshold: 52,
  paddingPercent: 1,
};

const DEFAULT_EXPORT_MODE: ExportMode = "scale";
const DEFAULT_EXPORT_VALUE = getDefaultExportValue(DEFAULT_EXPORT_MODE);

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<ImageItem[]>([]);
  const requestVersionRef = useRef<Record<string, number>>({});

  const [items, setItems] = useState<ImageItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settings, setSettings] = useState<CropSettings>(DEFAULT_SETTINGS);
  const [exportMode, setExportMode] = useState<ExportMode>(DEFAULT_EXPORT_MODE);
  const [exportValue, setExportValue] = useState(DEFAULT_EXPORT_VALUE);
  const [isDragging, setIsDragging] = useState(false);
  const [isExportingZip, setIsExportingZip] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [thumbnailMenu, setThumbnailMenu] = useState<ThumbnailMenuState | null>(
    null,
  );

  itemsRef.current = items;

  useEffect(() => {
    return () => {
      for (const item of itemsRef.current) {
        URL.revokeObjectURL(item.originalUrl);

        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
      }
    };
  }, []);

  useEffect(() => {
    if (!thumbnailMenu) {
      return;
    }

    const handlePointerDown = () => {
      setThumbnailMenu(null);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setThumbnailMenu(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [thumbnailMenu]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 800px)");

    const handleChange = (event: MediaQueryList | MediaQueryListEvent) => {
      if (event.matches) {
        setIsSidebarOpen(false);
      }
    };

    handleChange(mediaQuery);
    mediaQuery.addEventListener("change", handleChange);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  useEffect(() => {
    if (!isSidebarOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSidebarOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isSidebarOpen]);

  const readyItems = items.filter((item) => item.status === "ready" && item.result);
  const activeItem =
    items.find((item) => item.id === selectedId) ?? items[0] ?? null;
  const exportSizing = getExportSizing(exportMode, exportValue);

  const processItem = async (
    itemId: string,
    file: File,
    nextSettings: CropSettings,
  ) => {
    const token = (requestVersionRef.current[itemId] ?? 0) + 1;
    requestVersionRef.current[itemId] = token;

    setItems((current) =>
      current.map((item) =>
        item.id === itemId
          ? { ...item, status: "processing", error: null }
          : item,
      ),
    );

    try {
      const nextResult = await autoCropFile(file, nextSettings);
      const previewBlob = await renderCropFromFile(file, nextResult.bounds, {
        mode: "max-side",
        value: 1400,
      });

      if (requestVersionRef.current[itemId] !== token) {
        return;
      }

      const nextPreviewUrl = URL.createObjectURL(previewBlob);
      const previousPreviewUrl =
        itemsRef.current.find((item) => item.id === itemId)?.previewUrl ?? null;

      setItems((current) =>
        current.map((item) =>
          item.id === itemId
            ? {
                ...item,
                previewUrl: nextPreviewUrl,
                result: nextResult,
                status: "ready",
                error: null,
              }
            : item,
        ),
      );

      if (previousPreviewUrl && previousPreviewUrl !== nextPreviewUrl) {
        URL.revokeObjectURL(previousPreviewUrl);
      }
    } catch (caughtError: unknown) {
      if (requestVersionRef.current[itemId] !== token) {
        return;
      }

      setItems((current) =>
        current.map((item) =>
          item.id === itemId
            ? {
                ...item,
                status: "error",
                error:
                  caughtError instanceof Error
                    ? caughtError.message
                    : "Something went wrong while analyzing the image.",
              }
            : item,
        ),
      );
    }
  };

  const processMany = (
    targets: Array<{ id: string; file: File }>,
    nextSettings: CropSettings,
  ) => {
    for (const target of targets) {
      void processItem(target.id, target.file, nextSettings);
    }
  };

  const reprocessAll = (nextSettings: CropSettings) => {
    setSettings(nextSettings);

    const targets = itemsRef.current.map((item) => ({
      id: item.id,
      file: item.file,
    }));

    if (targets.length > 0) {
      processMany(targets, nextSettings);
    }
  };

  const pickFiles = (fileList: FileList | File[] | null) => {
    if (!fileList) {
      return;
    }

    const imageFiles = [...fileList].filter((file) =>
      file.type.startsWith("image/"),
    );

    if (imageFiles.length === 0) {
      return;
    }

    const nextItems = imageFiles.map<ImageItem>((file) => ({
      id: crypto.randomUUID(),
      file,
      originalUrl: URL.createObjectURL(file),
      previewUrl: null,
      result: null,
      status: "processing",
      error: null,
    }));

    setItems((current) => [...nextItems, ...current]);
    setSelectedId((current) => current ?? nextItems[0]?.id ?? null);
    processMany(
      nextItems.map((item) => ({ id: item.id, file: item.file })),
      settings,
    );
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    pickFiles(event.target.files);
  };

  const handleDragEnter = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();

    if (!isDragging) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();

    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }

    setIsDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    pickFiles(event.dataTransfer.files);
  };

  const clearAll = () => {
    for (const item of itemsRef.current) {
      URL.revokeObjectURL(item.originalUrl);

      if (item.previewUrl) {
        URL.revokeObjectURL(item.previewUrl);
      }
    }

    requestVersionRef.current = {};
    setItems([]);
    setSelectedId(null);
    setSettings(DEFAULT_SETTINGS);
    setExportMode(DEFAULT_EXPORT_MODE);
    setExportValue(DEFAULT_EXPORT_VALUE);

    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  const deleteItem = (itemId: string) => {
    const currentItems = itemsRef.current;
    const targetIndex = currentItems.findIndex((item) => item.id === itemId);

    if (targetIndex === -1) {
      return;
    }

    const target = currentItems[targetIndex];
    URL.revokeObjectURL(target.originalUrl);

    if (target.previewUrl) {
      URL.revokeObjectURL(target.previewUrl);
    }

    delete requestVersionRef.current[itemId];
    setThumbnailMenu((current) => (current?.id === itemId ? null : current));
    setItems((current) => current.filter((item) => item.id !== itemId));
    setSelectedId((current) => {
      if (current !== itemId) {
        return current;
      }

      const nextItem = currentItems[targetIndex + 1] ?? currentItems[targetIndex - 1];
      return nextItem?.id ?? null;
    });
  };

  const exportSingle = async (item: ImageItem) => {
    if (!item.result) {
      return;
    }

    const blob = await renderCropFromFile(
      item.file,
      item.result.bounds,
      exportSizing,
    );
    downloadBlob(blob, `${sanitizeFileName(item.file.name)}-cropped.png`);
  };

  const exportBulk = async () => {
    if (readyItems.length === 0) {
      return;
    }

    setIsExportingZip(true);

    try {
      const zip = new JSZip();

      for (const item of readyItems) {
        if (!item.result) {
          continue;
        }

        const blob = await renderCropFromFile(
          item.file,
          item.result.bounds,
          exportSizing,
        );
        zip.file(`${sanitizeFileName(item.file.name)}-cropped.png`, blob);
      }

      const archive = await zip.generateAsync({ type: "blob" });
      downloadBlob(archive, "crop-thing-export.zip");
    } finally {
      setIsExportingZip(false);
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen min-[800px]:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)]">
        {isSidebarOpen ? (
          <button
            type="button"
            aria-label="Close controls panel"
            className="fixed inset-0 z-30 bg-background/70 backdrop-blur-[2px] min-[800px]:hidden"
            onClick={() => setIsSidebarOpen(false)}
          />
        ) : null}

        <aside
          className={cn(
            "border-border bg-background",
            "max-[799px]:fixed max-[799px]:inset-y-0 max-[799px]:left-0 max-[799px]:z-40 max-[799px]:w-[min(22rem,calc(100vw-2rem))] max-[799px]:border-r max-[799px]:shadow-xl max-[799px]:transition-transform max-[799px]:duration-200",
            "min-[800px]:border-r",
            isSidebarOpen
              ? "max-[799px]:translate-x-0"
              : "max-[799px]:-translate-x-[calc(100%+1px)]",
          )}
        >
          <div className="flex h-full flex-col min-[800px]:sticky min-[800px]:top-0 min-[800px]:h-screen">
            <div className="border-b border-border px-4 py-4 md:px-5">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <Image
                    src="/crop-thing-logo.svg"
                    alt="Crop Thing logo"
                    width={168}
                    height={39}
                    priority
                    className="h-[39px] w-auto"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="min-[800px]:hidden"
                    onClick={() => setIsSidebarOpen(false)}
                    aria-label="Close controls"
                  >
                    <X />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Crop PNGs right to the subject.
                </p>
              </div>
            </div>

            <div className="flex-1 px-4 py-4 min-[800px]:overflow-y-auto md:px-5">
              <div className="flex flex-col gap-4">
                <div className="space-y-3">
                  <CardHeader className="px-0">
                    <CardTitle>Import</CardTitle>
                    <CardDescription>
                      Drop images here or browse from disk.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 px-0">
                    <Button
                      type="button"
                      variant="outline"
                      className={`h-24 w-full flex-col gap-2 border-dashed ${
                        isDragging ? "border-ring bg-muted" : ""
                      }`}
                      onClick={() => inputRef.current?.click()}
                      onDragEnter={() => setIsDragging(true)}
                      onDragLeave={() => setIsDragging(false)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={handleDrop}
                    >
                      <Upload />
                      <span>Import images</span>
                    </Button>
                    <input
                      ref={inputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={handleFileChange}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>{items.length} imported</span>
                      <span>{readyItems.length} ready</span>
                    </div>
                  </CardContent>
                  <CardFooter className="border-0 px-0 pt-0">
                    <Button variant="outline" onClick={clearAll}>
                      Clear all
                    </Button>
                  </CardFooter>
                </div>

                <div className="space-y-3">
                  <CardHeader className="px-0">
                    <CardTitle>Crop detection</CardTitle>
                    <CardDescription>
                      Adjust the final crop breathing room.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5 px-0">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Padding</span>
                        <span>{settings.paddingPercent}%</span>
                      </div>
                      <Slider
                        value={[settings.paddingPercent]}
                        min={0}
                        max={12}
                        step={0.5}
                        onValueChange={([value]) =>
                          reprocessAll({
                            ...settings,
                            paddingPercent: value ?? settings.paddingPercent,
                          })
                        }
                      />
                    </div>
                  </CardContent>
                </div>

                <div className="space-y-3 pt-6">
                  <CardHeader className="px-0">
                    <CardTitle>Export</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 px-0">
                    <div className="grid gap-2 min-[460px]:grid-cols-[minmax(0,1fr)_120px]">
                      <Select
                        value={exportMode}
                        onValueChange={(value) => {
                          const nextMode = value as ExportMode;
                          setExportMode(nextMode);
                          setExportValue(getDefaultExportValue(nextMode));
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select mode" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="scale">Scale (x)</SelectItem>
                          <SelectItem value="width">Width (w)</SelectItem>
                          <SelectItem value="height">Height (h)</SelectItem>
                          <SelectItem value="max-side">Largest side</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        min="0.1"
                        step={exportMode === "scale" ? "0.1" : "1"}
                        value={exportValue}
                        onChange={(event) =>
                          setExportValue(event.target.value)
                        }
                      />
                    </div>
                  </CardContent>
                  <CardFooter className="flex flex-col gap-2 border-0 px-0 pt-0">
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => activeItem && void exportSingle(activeItem)}
                      disabled={activeItem?.status !== "ready" || isExportingZip}
                    >
                      <Download />
                      Export selected image
                    </Button>
                    <Button
                      className="w-full"
                      onClick={() => void exportBulk()}
                      disabled={readyItems.length < 2 || isExportingZip}
                    >
                      {isExportingZip ? (
                        <LoaderCircle className="animate-spin" />
                      ) : (
                        <Package />
                      )}
                      Bulk export ZIP
                    </Button>
                  </CardFooter>
                </div>
              </div>
            </div>

            <div className="px-4 pb-4 pt-2 text-xs text-muted-foreground md:px-5">
              Built by Miguel Leca
            </div>
          </div>
        </aside>

        <section
          className="relative flex min-h-[50svh] flex-col min-[800px]:h-screen min-[800px]:min-h-screen"
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="absolute left-4 top-4 z-30 min-[800px]:hidden">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70"
              onClick={() => setIsSidebarOpen(true)}
              aria-label="Open controls"
              aria-expanded={isSidebarOpen}
            >
              <Menu />
            </Button>
          </div>

          {items.length > 0 ? (
            <div className="absolute left-0 right-0 top-0 z-10 px-4 py-4 pl-20 min-[800px]:px-6 min-[800px]:pl-6">
              <div className="flex gap-3 overflow-x-auto">
                {items.map((item) => {
                  const isActive = item.id === activeItem?.id;
                  const thumbnailUrl = item.previewUrl ?? item.originalUrl;

                  return (
                    <div key={item.id} className="group relative shrink-0">
                      <button
                        type="button"
                        className={`relative shrink-0 overflow-hidden text-left transition-all ${
                          isActive
                            ? "h-[72px] opacity-100"
                            : "h-[72px] opacity-30 hover:opacity-60"
                        }`}
                        onClick={() => {
                          setSelectedId(item.id);
                          setThumbnailMenu(null);
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={thumbnailUrl}
                          alt={item.file.name}
                          className="h-full w-auto max-w-none object-contain"
                        />
                      </button>

                      <button
                        type="button"
                        className="absolute right-1 top-1 z-20 flex h-6 w-6 items-center justify-center border border-border bg-background/90 opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={(event) => {
                          event.stopPropagation();
                          const rect = event.currentTarget.getBoundingClientRect();
                          setThumbnailMenu((current) =>
                            current?.id === item.id
                              ? null
                              : {
                                  id: item.id,
                                  x: rect.right,
                                  y: rect.bottom + 6,
                                },
                          );
                        }}
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {thumbnailMenu ? (
            <div
              className="fixed z-40 min-w-36 border border-border bg-background p-1 shadow-sm"
              style={{
                left: thumbnailMenu.x,
                top: thumbnailMenu.y,
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted"
                onClick={() => {
                  const item = itemsRef.current.find(
                    (candidate) => candidate.id === thumbnailMenu.id,
                  );

                  if (!item) {
                    setThumbnailMenu(null);
                    return;
                  }

                  setSelectedId(item.id);
                  setThumbnailMenu(null);
                  void exportSingle(item);
                }}
              >
                <Download className="h-3.5 w-3.5" />
                Export image
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-destructive hover:bg-muted"
                onClick={() => {
                  deleteItem(thumbnailMenu.id);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete image
              </button>
            </div>
          ) : null}

          <div
            className={cn(
              "flex min-h-0 flex-1 items-center justify-center px-4 pb-8 transition-colors min-[800px]:px-6 min-[800px]:pb-10 min-[800px]:pt-6",
              items.length > 0 ? "pt-24" : "pt-18",
              isDragging ? "bg-muted/20" : "",
            )}
          >
            <CropCanvasPreview
              item={activeItem}
              onImportClick={() => inputRef.current?.click()}
            />
          </div>

          {isDragging ? (
            <div
              className="absolute inset-0 z-20 border-2 border-dashed border-foreground/40 bg-muted/10"
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            />
          ) : null}
        </section>
      </div>
    </main>
  );
}

function getExportSizing(mode: ExportMode, value: string): ExportSizing {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { mode: "scale", value: 1 };
  }

  if (mode === "scale") {
    return { mode: "scale", value: parsed };
  }

  if (mode === "width") {
    return { mode: "width", value: parsed };
  }

  if (mode === "height") {
    return { mode: "height", value: parsed };
  }

  return { mode: "max-side", value: parsed };
}

function getDefaultExportValue(mode: ExportMode) {
  return mode === "scale" ? "1" : "1200";
}

function sanitizeFileName(name: string) {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9-_]+/gi, "-")
    .toLowerCase();
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

function CropCanvasPreview({
  item,
  onImportClick,
}: {
  item: ImageItem | null;
  onImportClick: () => void;
}) {
  if (!item?.originalUrl) {
    return (
      <div className="flex min-h-[60vh] w-full items-center justify-center">
        <Button
          type="button"
          variant="ghost"
          className="h-auto flex-col gap-2 px-4 py-3"
          onClick={onImportClick}
        >
          <Upload />
          <span>Import images</span>
        </Button>
      </div>
    );
  }

  const result = item.result;
  const cropFrame = result
    ? {
        left: (result.bounds.x / result.originalWidth) * 100,
        top: (result.bounds.y / result.originalHeight) * 100,
        width: (result.bounds.width / result.originalWidth) * 100,
        height: (result.bounds.height / result.originalHeight) * 100,
      }
    : null;

  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center">
      <div className="relative flex w-full items-center justify-center">
        {item.status === "processing" ? (
          <Badge variant="outline" className="absolute right-0 top-0 z-10">
            <LoaderCircle className="animate-spin" />
            Processing
          </Badge>
        ) : null}

        {item.error ? (
          <Badge variant="destructive" className="absolute left-0 top-0 z-10">
            {item.error}
          </Badge>
        ) : null}

        <div className="flex w-full items-center justify-center">
          {result ? (
            <div className="relative">
              <div
                className="relative mx-auto h-[60vh] max-w-full"
                style={{
                  aspectRatio: `${result.originalWidth} / ${result.originalHeight}`,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.originalUrl}
                  alt="Uploaded source image"
                  className="h-full w-full object-contain"
                />

                <div className="pointer-events-none absolute inset-0">
                  <div className="absolute left-0 top-0 -translate-y-[calc(100%+8px)] text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    original
                  </div>
                  <div className="absolute inset-0 border border-dashed border-foreground/70" />
                  <div
                    className="absolute left-0 top-0 w-full bg-background/70"
                    style={{ height: `${cropFrame?.top ?? 0}%` }}
                  />
                  <div
                    className="absolute left-0 bg-background/70"
                    style={{
                      top: `${cropFrame?.top ?? 0}%`,
                      width: `${cropFrame?.left ?? 0}%`,
                      height: `${cropFrame?.height ?? 0}%`,
                    }}
                  />
                  <div
                    className="absolute right-0 bg-background/70"
                    style={{
                      top: `${cropFrame?.top ?? 0}%`,
                      width: `${100 - (cropFrame?.left ?? 0) - (cropFrame?.width ?? 0)}%`,
                      height: `${cropFrame?.height ?? 0}%`,
                    }}
                  />
                  <div
                    className="absolute bottom-0 left-0 w-full bg-background/70"
                    style={{
                      height: `${100 - (cropFrame?.top ?? 0) - (cropFrame?.height ?? 0)}%`,
                    }}
                  />
                  <div
                    className="absolute border border-foreground/30"
                    style={{
                      left: `${cropFrame?.left ?? 0}%`,
                      top: `${cropFrame?.top ?? 0}%`,
                      width: `${cropFrame?.width ?? 0}%`,
                      height: `${cropFrame?.height ?? 0}%`,
                    }}
                  />
                  <div
                    className="absolute -translate-y-[calc(100%+8px)] text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
                    style={{
                      left: `${cropFrame?.left ?? 0}%`,
                      top: `${cropFrame?.top ?? 0}%`,
                    }}
                  >
                    cropped
                  </div>
                </div>
              </div>

            </div>
          ) : (
            <div className="relative mx-auto flex h-[60vh] max-w-full items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.originalUrl}
                alt="Uploaded source image"
                className="h-full w-auto max-w-full object-contain"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
