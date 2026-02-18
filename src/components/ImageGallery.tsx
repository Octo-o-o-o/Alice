import React, { useState } from "react";
import { X, Download, ZoomIn } from "lucide-react";
import { ImageContent } from "../lib/types";
import { convertFileSrc } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { useToast } from "../contexts/ToastContext";

interface ImageGalleryProps {
  images: ImageContent[];
  sessionId: string;
}

function getImageSrc(image: ImageContent): string {
  if (image.data) {
    const mediaType = image.media_type || "image/png";
    return `data:${mediaType};base64,${image.data}`;
  }
  if (image.path) {
    return convertFileSrc(image.path);
  }
  return "";
}

async function getImageBytes(image: ImageContent): Promise<Uint8Array | null> {
  if (image.data) {
    return Uint8Array.from(atob(image.data), (c) => c.charCodeAt(0));
  }
  if (image.path) {
    return readFile(image.path);
  }
  return null;
}

export default function ImageGallery({ images, sessionId }: ImageGalleryProps): React.ReactElement | null {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const toast = useToast();

  if (images.length === 0) {
    return null;
  }

  async function handleDownload(image: ImageContent, index: number): Promise<void> {
    try {
      const ext = image.media_type?.split("/")[1] || "png";
      const defaultPath = `session-${sessionId.slice(0, 8)}-image-${index + 1}.${ext}`;

      const filePath = await save({
        defaultPath,
        filters: [{ name: "Image", extensions: [ext] }],
      });

      if (!filePath) return;

      const bytes = await getImageBytes(image);
      if (!bytes) return;

      await writeFile(filePath, bytes);
      toast.success(`Image saved to ${filePath.split(/[/\\]/).pop()}`);
    } catch (error) {
      console.error("Failed to save image:", error);
      toast.error("Failed to save image");
    }
  }

  function stopAndCall(e: React.MouseEvent, fn: () => void): void {
    e.stopPropagation();
    fn();
  }

  return (
    <>
      {/* Thumbnail Grid */}
      <div className="bg-white/[0.03] border border-white/10 rounded-lg p-3">
        <div className="flex items-center gap-2 mb-2">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-purple-500" />
            <span className="text-xs font-medium text-gray-300">
              Images ({images.length})
            </span>
          </div>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
          {images.map((image, index) => (
            <div
              key={index}
              className="group relative aspect-square rounded-lg overflow-hidden bg-gray-900 border border-white/10 hover:border-purple-500/50 transition-all cursor-pointer"
              onClick={() => setSelectedIndex(index)}
            >
              <img
                src={getImageSrc(image)}
                alt={`Image ${index + 1}`}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <ZoomIn size={20} className="text-white" />
              </div>
              <div className="absolute top-1 left-1 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded">
                {index + 1}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Fullscreen Modal */}
      {selectedIndex !== null && (
        <div
          className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center"
          onClick={() => setSelectedIndex(null)}
        >
          <div className="relative w-full h-full flex items-center justify-center p-4">
            <button
              onClick={() => setSelectedIndex(null)}
              className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors z-10"
              title="Close (Esc)"
            >
              <X size={20} className="text-white" />
            </button>

            <button
              onClick={(e) => stopAndCall(e, () => handleDownload(images[selectedIndex], selectedIndex))}
              className="absolute top-4 right-16 p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors z-10"
              title="Download"
            >
              <Download size={20} className="text-white" />
            </button>

            <div className="absolute top-4 left-4 bg-white/10 text-white text-sm px-3 py-1.5 rounded-lg">
              {selectedIndex + 1} / {images.length}
            </div>

            {selectedIndex > 0 && (
              <button
                onClick={(e) => stopAndCall(e, () => setSelectedIndex(selectedIndex - 1))}
                className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                title="Previous"
              >
                <span className="text-white text-xl">&larr;</span>
              </button>
            )}

            {selectedIndex < images.length - 1 && (
              <button
                onClick={(e) => stopAndCall(e, () => setSelectedIndex(selectedIndex + 1))}
                className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                title="Next"
              >
                <span className="text-white text-xl">&rarr;</span>
              </button>
            )}

            <img
              src={getImageSrc(images[selectedIndex])}
              alt={`Image ${selectedIndex + 1}`}
              className="max-w-full max-h-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </>
  );
}
