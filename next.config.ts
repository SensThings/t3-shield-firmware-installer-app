import type { NextConfig } from 'next';
import { readFileSync } from 'fs';

const version = readFileSync('./VERSION', 'utf-8').trim();

const nextConfig: NextConfig = {
  output: 'standalone',
  env: {
    APP_VERSION: version,
  },
};

export default nextConfig;
