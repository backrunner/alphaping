import shellInstaller from "../../../../../scripts/install/install.sh?raw";
import powershellInstaller from "../../../../../scripts/install/install.ps1?raw";

export type InstallerKind = "unix" | "windows";

const installers: Record<InstallerKind, { content: string; contentType: string }> = {
  unix: { content: shellInstaller, contentType: "text/x-shellscript; charset=utf-8" },
  windows: { content: powershellInstaller, contentType: "text/plain; charset=utf-8" },
};

async function checksum(content: string): Promise<{ hex: string; base64: string }> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content)),
  );
  let binary = "";
  let hex = "";
  for (const byte of digest) {
    binary += String.fromCharCode(byte);
    hex += byte.toString(16).padStart(2, "0");
  }
  return { hex, base64: btoa(binary) };
}

const checksumPromises: Record<InstallerKind, Promise<{ hex: string; base64: string }>> = {
  unix: checksum(shellInstaller),
  windows: checksum(powershellInstaller),
};

export async function installerChecksums(): Promise<Record<InstallerKind, string>> {
  const [unix, windows] = await Promise.all([checksumPromises.unix, checksumPromises.windows]);
  return { unix: unix.hex, windows: windows.hex };
}

export async function installerResponse(kind: InstallerKind): Promise<Response> {
  const installer = installers[kind];
  const digest = await checksumPromises[kind];
  return new Response(installer.content, {
    headers: {
      "cache-control": "public, max-age=300",
      "content-digest": `sha-256=:${digest.base64}:`,
      "content-type": installer.contentType,
      "x-alphaping-sha256": digest.hex,
      "x-content-type-options": "nosniff",
    },
  });
}
