import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

// ─── Types ───────────────────────────────────────────────────────────

export interface TechStackInfo {
  goVersion?: string;
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
  const goVersionMatch = content.match(/^go\s+(\S+)$/m);
  if (goVersionMatch) info.goVersion = goVersionMatch[1].trim();

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
