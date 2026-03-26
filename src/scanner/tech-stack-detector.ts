import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

// ─── Types ───────────────────────────────────────────────────────────

export interface TechStackInfo {
  runtimeVersion?: string;
  modulePath?: string;
  dependencies: Array<{
    package: string;
    version: string;
    category: string;
  }>;
}

export interface GitContext {
  branch: string;
  commitHash: string;
  commitMessage: string;
}

// ─── Package Category Mapping ────────────────────────────────────────

const PACKAGE_CATEGORIES: Record<string, string> = {
  // HTTP Frameworks
  'gin-gonic/gin': 'HTTP Framework (Gin)',
  'go-chi/chi': 'HTTP Framework (Chi)',
  'labstack/echo': 'HTTP Framework (Echo)',
  'gofiber/fiber': 'HTTP Framework (Fiber)',
  'gorilla/mux': 'HTTP Router (Gorilla)',

  // Database
  'jackc/pgx': 'Database (PostgreSQL)',
  'lib/pq': 'Database (PostgreSQL)',
  'go-sql-driver/mysql': 'Database (MySQL)',
  'mattn/go-sqlite3': 'Database (SQLite)',
  'mongodb/mongo-go-driver': 'Database (MongoDB)',
  'go-gorm/gorm': 'ORM (GORM)',
  'jmoiron/sqlx': 'Database (sqlx)',

  // Cache
  'redis/go-redis': 'Cache (Redis)',
  'bradfitz/gomemcache': 'Cache (Memcached)',

  // Message Queue
  'segmentio/kafka-go': 'Message Queue (Kafka)',
  'confluentinc/confluent-kafka-go': 'Message Queue (Kafka)',
  'rabbitmq/amqp091-go': 'Message Queue (RabbitMQ)',
  'nats-io/nats.go': 'Message Queue (NATS)',
  'Shopify/sarama': 'Message Queue (Kafka)',
  'IBM/sarama': 'Message Queue (Kafka)',

  // gRPC
  'grpc/grpc-go': 'gRPC',
  'google.golang.org/grpc': 'gRPC',
  'bufbuild/connect-go': 'gRPC (Connect)',
  'grpc-ecosystem/grpc-gateway': 'API Gateway (gRPC)',

  // Auth
  'golang-jwt/jwt': 'Auth (JWT)',
  'coreos/go-oidc': 'Auth (OIDC)',
  'dgrijalva/jwt-go': 'Auth (JWT)',

  // Cloud
  'aws/aws-sdk-go': 'Cloud (AWS)',
  'googleapis/google-cloud-go': 'Cloud (GCP)',

  // Logging
  'uber-go/zap': 'Logging (Zap)',
  'sirupsen/logrus': 'Logging (Logrus)',
  'rs/zerolog': 'Logging (Zerolog)',

  // Testing
  'stretchr/testify': 'Testing',
  'onsi/ginkgo': 'Testing (BDD)',

  // API Docs
  'swaggo/swag': 'API Docs (Swagger)',

  // Config
  'spf13/viper': 'Config (Viper)',
  'joho/godotenv': 'Config (dotenv)',
  'spf13/cobra': 'CLI (Cobra)',

  // Observability
  'prometheus/client_golang': 'Metrics (Prometheus)',
  'open-telemetry/opentelemetry-go': 'Tracing (OpenTelemetry)',
  'DataDog/dd-trace-go': 'Tracing (Datadog)',
  'elastic/go-elasticsearch': 'Search (Elasticsearch)',

  // Dependency Injection
  'google/wire': 'DI (Wire)',
  'uber-go/fx': 'DI (Fx)',
  'uber-go/dig': 'DI (Dig)',
};

/**
 * Categorize a Go package by matching against known packages.
 * Handles versioned paths like `jackc/pgx/v5` by partial matching.
 */
export function categorizePackage(pkg: string): string {
  for (const [key, category] of Object.entries(PACKAGE_CATEGORIES)) {
    if (pkg.includes(key)) return category;
  }
  return 'Other';
}

// ─── go.mod Parser ───────────────────────────────────────────────────

/**
 * Parse go.mod file and extract module path, Go version, and dependencies.
 */
export function parseGoMod(targetPath: string): TechStackInfo | null {
  const goModPath = path.join(targetPath, 'go.mod');
  if (!fs.existsSync(goModPath)) return null;

  const content = fs.readFileSync(goModPath, 'utf-8');
  const info: TechStackInfo = { dependencies: [] };

  // Extract module path
  const moduleMatch = content.match(/^module\s+(.+)$/m);
  if (moduleMatch) info.modulePath = moduleMatch[1].trim();

  // Extract Go version
  const runtimeVersionMatch = content.match(/^go\s+(\S+)$/m);
  if (runtimeVersionMatch) info.runtimeVersion = runtimeVersionMatch[1].trim();

  // Extract single-line requires: require package version
  const singleRequires = content.matchAll(/^require\s+(\S+)\s+(\S+)\s*$/gm);
  for (const match of singleRequires) {
    info.dependencies.push({
      package: match[1],
      version: match[2],
      category: categorizePackage(match[1]),
    });
  }

  // Extract multi-line require blocks
  const blockPattern = /^require\s*\(\s*\n([\s\S]*?)\n\s*\)/gm;
  let blockMatch;
  while ((blockMatch = blockPattern.exec(content)) !== null) {
    const block = blockMatch[1];
    const lines = block.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//')) continue;
      // Handle: package version [// indirect]
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        info.dependencies.push({
          package: parts[0],
          version: parts[1],
          category: categorizePackage(parts[0]),
        });
      }
    }
  }

  return info;
}

// ─── NPM Package Category Mapping ────────────────────────────────────

const NPM_PACKAGE_CATEGORIES: Record<string, string> = {
  // Frameworks
  'next': 'Framework (Next.js)',
  'react': 'UI Library (React)',
  'react-dom': 'UI Library (React DOM)',
  'vue': 'Framework (Vue)',
  'nuxt': 'Framework (Nuxt)',
  'svelte': 'Framework (Svelte)',
  '@angular/core': 'Framework (Angular)',
  'express': 'HTTP Framework (Express)',
  'fastify': 'HTTP Framework (Fastify)',
  'koa': 'HTTP Framework (Koa)',
  'hono': 'HTTP Framework (Hono)',
  'nestjs': 'Framework (NestJS)',
  '@nestjs/core': 'Framework (NestJS)',

  // State Management
  'redux': 'State Management (Redux)',
  '@reduxjs/toolkit': 'State Management (Redux Toolkit)',
  'zustand': 'State Management (Zustand)',
  'mobx': 'State Management (MobX)',
  'recoil': 'State Management (Recoil)',
  'jotai': 'State Management (Jotai)',

  // Database / ORM
  'prisma': 'ORM (Prisma)',
  '@prisma/client': 'ORM (Prisma)',
  'typeorm': 'ORM (TypeORM)',
  'sequelize': 'ORM (Sequelize)',
  'drizzle-orm': 'ORM (Drizzle)',
  'mongoose': 'Database (MongoDB)',
  'pg': 'Database (PostgreSQL)',
  'mysql2': 'Database (MySQL)',
  'better-sqlite3': 'Database (SQLite)',
  'ioredis': 'Cache (Redis)',
  'redis': 'Cache (Redis)',

  // Auth
  'next-auth': 'Auth (NextAuth)',
  '@auth/core': 'Auth (Auth.js)',
  'jsonwebtoken': 'Auth (JWT)',
  'passport': 'Auth (Passport)',
  'bcrypt': 'Auth (bcrypt)',
  'bcryptjs': 'Auth (bcrypt)',

  // API / HTTP
  'axios': 'HTTP Client (Axios)',
  'swr': 'Data Fetching (SWR)',
  '@tanstack/react-query': 'Data Fetching (React Query)',
  'graphql': 'API (GraphQL)',
  '@apollo/client': 'API (Apollo GraphQL)',
  'trpc': 'API (tRPC)',
  '@trpc/server': 'API (tRPC)',

  // Styling
  'tailwindcss': 'Styling (Tailwind)',
  'styled-components': 'Styling (Styled Components)',
  '@emotion/react': 'Styling (Emotion)',
  'sass': 'Styling (Sass)',
  '@mui/material': 'UI Kit (MUI)',
  'antd': 'UI Kit (Ant Design)',
  '@chakra-ui/react': 'UI Kit (Chakra)',
  'shadcn-ui': 'UI Kit (shadcn)',

  // Testing
  'jest': 'Testing (Jest)',
  'vitest': 'Testing (Vitest)',
  '@testing-library/react': 'Testing (React Testing Library)',
  'cypress': 'Testing (Cypress)',
  'playwright': 'Testing (Playwright)',

  // Build / Tools
  'typescript': 'Language (TypeScript)',
  'vite': 'Build (Vite)',
  'webpack': 'Build (Webpack)',
  'turbo': 'Build (Turborepo)',
  'eslint': 'Lint (ESLint)',
  'prettier': 'Formatter (Prettier)',

  // Message Queue / Realtime
  'socket.io': 'Realtime (Socket.IO)',
  'ws': 'Realtime (WebSocket)',
  'bullmq': 'Queue (BullMQ)',
  'amqplib': 'Queue (RabbitMQ)',
  'kafkajs': 'Queue (Kafka)',

  // Cloud / Storage
  'aws-sdk': 'Cloud (AWS)',
  '@aws-sdk/client-s3': 'Cloud (AWS S3)',
  'firebase': 'Cloud (Firebase)',
  '@supabase/supabase-js': 'Cloud (Supabase)',

  // Logging / Monitoring
  'winston': 'Logging (Winston)',
  'pino': 'Logging (Pino)',
  '@sentry/nextjs': 'Monitoring (Sentry)',
  '@sentry/node': 'Monitoring (Sentry)',
};

function categorizeNpmPackage(pkg: string): string {
  if (NPM_PACKAGE_CATEGORIES[pkg]) return NPM_PACKAGE_CATEGORIES[pkg];
  // Partial match for scoped packages
  for (const [key, category] of Object.entries(NPM_PACKAGE_CATEGORIES)) {
    if (pkg.startsWith(key)) return category;
  }
  return 'Other';
}

// ─── package.json Parser ─────────────────────────────────────────────

export function parsePackageJson(targetPath: string): TechStackInfo | null {
  const pkgPath = path.join(targetPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;

  try {
    const content = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const info: TechStackInfo = { dependencies: [] };

    // Detect Node/runtime version from engines
    if (content.engines?.node) {
      info.runtimeVersion = undefined; // reuse field as generic version
      info.modulePath = content.name || undefined;
    } else {
      info.modulePath = content.name || undefined;
    }

    // Categorized deps from both dependencies and devDependencies
    const allDeps: Record<string, string> = {
      ...(content.dependencies || {}),
      ...(content.devDependencies || {}),
    };

    for (const [pkg, version] of Object.entries(allDeps)) {
      const category = categorizeNpmPackage(pkg);
      if (category !== 'Other') {
        info.dependencies.push({
          package: pkg,
          version: String(version),
          category,
        });
      }
    }

    // Include uncategorized production deps (not devDependencies — those are build tools)
    const prodDeps = content.dependencies || {};
    for (const [pkg, version] of Object.entries(prodDeps)) {
      const category = categorizeNpmPackage(pkg);
      if (category === 'Other') {
        // Skip type packages and common noise
        if (pkg.startsWith('@types/') || pkg === 'tslib') continue;
        info.dependencies.push({
          package: pkg,
          version: String(version as string),
          category: 'Dependency',
        });
      }
    }

    // Sort: frameworks first, then alphabetical
    info.dependencies.sort((a, b) => {
      const aIsFramework = a.category.includes('Framework') || a.category.includes('UI Library');
      const bIsFramework = b.category.includes('Framework') || b.category.includes('UI Library');
      if (aIsFramework && !bIsFramework) return -1;
      if (!aIsFramework && bIsFramework) return 1;
      return a.category.localeCompare(b.category);
    });

    return info.dependencies.length > 0 ? info : null;
  } catch {
    return null;
  }
}

// ─── Git Context ─────────────────────────────────────────────────────

/**
 * Get git context (branch, commit hash, commit message).
 * Returns null if not a git repo or git not available.
 */
export function getGitContext(targetPath: string): GitContext | null {
  try {
    const opts = { cwd: targetPath, encoding: 'utf-8' as const, stdio: 'pipe' as const };
    const commitHash = execSync('git rev-parse --short HEAD', opts).trim();
    const commitMessage = execSync('git log -1 --format="%s"', opts).trim();
    const branch = execSync('git branch --show-current', opts).trim();
    return { branch, commitHash, commitMessage };
  } catch {
    return null;
  }
}
