import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Move the Next.js dev-mode indicator to the bottom-right so it doesn't sit on
  // top of the sidebar's "Sign out" button. (It never shows in production.)
  devIndicators: {
    position: "bottom-right",
  },
};

export default nextConfig;
