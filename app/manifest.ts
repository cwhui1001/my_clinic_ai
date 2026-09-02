import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nightingale",
    short_name: "Nightingale",
    description: "A secure first-touch-to-care experience.",
    start_url: "/",
    display: "standalone",
    background_color: "#f3f7f6",
    theme_color: "#0f766e",
  };
}
