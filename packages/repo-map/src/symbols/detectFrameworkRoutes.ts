import type { WorkspaceScanResult, RepoMapRoute, RepoMapFile } from "@wma/core";
import { readFileSync } from "node:fs";

function nextRouterRelativePath(relativePath: string): { router: "app" | "pages"; path: string } | null {
  const segments = relativePath.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    if (segments[index] === "src" && (segments[index + 1] === "app" || segments[index + 1] === "pages")) {
      return { router: segments[index + 1] as "app" | "pages", path: segments.slice(index + 2).join("/") };
    }
    if (segments[index] === "app" || segments[index] === "pages") {
      return { router: segments[index] as "app" | "pages", path: segments.slice(index + 1).join("/") };
    }
  }
  return null;
}

function normalizeNextRoute(route: string): string {
  return route
    .replace(/\/index$/, "")
    .replace(/\[\.\.\.(\w+)\]/g, ":$1*")
    .replace(/\[(\w+)\]/g, ":$1");
}

export function detectFrameworkRoutes(
  scanResult: WorkspaceScanResult,
  files: RepoMapFile[],
): RepoMapRoute[] {
  const routes: RepoMapRoute[] = [];
  const pathSet = new Set(files.map((f) => f.relativePath));

  for (const file of scanResult.files) {
    if (!pathSet.has(file.relativePath)) continue;
    const rp = file.relativePath.replace(/\\/g, "/");
    const routerPath = nextRouterRelativePath(rp);
    if (!routerPath) continue;

    if (routerPath.router === "app") {
      const match = routerPath.path.match(/^(?:(.*)\/)?(page|layout|route)\.(?:js|jsx|ts|tsx)$/);
      if (!match) continue;
      const route = normalizeNextRoute(match[1] ?? "");
      routes.push({
        relativePath: rp,
        routePattern: `/${route}`,
        framework: "nextjs",
        reason: `Next.js App Router ${match[2]}: ${rp}`,
      });
      continue;
    }

    const pagesMatch = routerPath.path.match(/^(.*)(?:\.js|\.jsx|\.ts|\.tsx)$/);
    if (pagesMatch) {
      const route = normalizeNextRoute(pagesMatch[1]);
      routes.push({
        relativePath: rp,
        routePattern: `/${route}`,
        framework: "nextjs",
        reason: `Next.js Pages Router: ${rp}`,
      });
    }
  }

  // Express-style route detection
  for (const file of scanResult.files) {
    if (!pathSet.has(file.relativePath)) continue;
    if (![".ts", ".tsx", ".js", ".jsx"].includes(file.extension)) continue;
    try {
      const content = readFileSync(file.path, "utf-8");
      const routeRegex = /(?:app|router)\.(get|post|put|delete|patch|use)\s*\(\s*['"`]([^'"`]+)['"`]/g;
      let m: RegExpExecArray | null;
      while ((m = routeRegex.exec(content)) !== null) {
        routes.push({
          relativePath: file.relativePath,
          routePattern: m[2],
          framework: "express",
          reason: `${m[1].toUpperCase()} ${m[2]}`,
        });
      }
    } catch {
      // Skip files that can't be read
    }
  }

  for (const file of scanResult.files) {
    if (!pathSet.has(file.relativePath) || ![".py", ".java", ".kt"].includes(file.extension)) continue;
    try {
      const content = readFileSync(file.path, "utf-8");
      const patterns = file.extension === ".py"
        ? [
            { regex: /@(app|router)\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g, framework: "fastapi" as const },
            { regex: /@app\.route\s*\(\s*['"]([^'"]+)['"]/g, framework: "flask" as const },
          ]
        : [{ regex: /@(Get|Post|Put|Delete|Patch|Request)Mapping\s*\(\s*(?:value\s*=\s*)?['"]([^'"]+)['"]/g, framework: "spring" as const }];
      for (const { regex, framework } of patterns) {
        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
          const route = match[3] ?? match[2] ?? match[1];
          routes.push({ relativePath: file.relativePath, routePattern: route, framework, reason: `${framework} route: ${route}` });
        }
      }
    } catch {
      // Skip files that cannot be read.
    }
  }

  return routes;
}
