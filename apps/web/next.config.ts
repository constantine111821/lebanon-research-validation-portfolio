import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@rvw/domain"],
  poweredByHeader: false,
  // Focused preparation builds cannot replace the running human-preview output.
  distDir: process.env.RVW_PREPARATION_BUILD === '1' ? '.next-preparation' : '.next',
  env: { RVW_BUILD_COMMIT: execFileSync('git',['-c','safe.directory='+fs.realpathSync(path.resolve(process.cwd(),'../..')).replaceAll('\\','/'),'rev-parse','HEAD'],{encoding:'utf8'}).trim() },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default config;
