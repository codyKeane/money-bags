import type { MetadataRoute } from "next";

// Installability = this manifest + HTTPS (tailscale serve provides the TLS).
// Deliberately no service worker: the app is server-rendered and local-only —
// no offline mode, no push.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Finance Engine",
    short_name: "Finance",
    description: "Private, locally self-hosted personal finance engine",
    start_url: "/",
    display: "standalone",
    background_color: "#f9f9f7",
    theme_color: "#f9f9f7",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
