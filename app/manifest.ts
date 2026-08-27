import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "THE THREAD AIコーチ",
    short_name: "AIコーチ",
    description: "呼吸を整えながら、自己と再びつながるAIコーチ",
    start_url: "/",
    display: "standalone",
    background_color: "#f1e8d6",
    theme_color: "#191428",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
