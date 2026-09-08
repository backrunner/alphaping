import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { installCommand } from "./install-command.js";

it.runIf(process.platform !== "win32")(
  "passes shell metacharacters as literal installer arguments and checks the downloaded bytes",
  () => {
    const directory = mkdtempSync(join(tmpdir(), "alphaping-command-"));
    try {
      const bin = join(directory, "bin");
      mkdirSync(bin);
      const payload = join(directory, "installer");
      const output = join(directory, "arguments");
      const contents = '#!/bin/sh\nprintf "%s\\0" "$@" > "$INSTALL_COMMAND_OUTPUT"\n';
      writeFileSync(payload, contents);
      writeFileSync(join(bin, "id"), "#!/bin/sh\necho 0\n", { mode: 0o755 });
      writeFileSync(
        join(bin, "curl"),
        '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do\n if [ "$1" = -o ]; then cp "$INSTALL_COMMAND_PAYLOAD" "$2"; exit; fi\n shift\ndone\nexit 2\n',
        { mode: 0o755 },
      );
      const options = {
        machineId: "machine'$(exit 91); &",
        token: "secret'\n$(exit 92) `exit 93` ; $HOME",
        ingestOrigin: "https://ingest.example.test",
        installOrigin: "https://monitor.example.test",
        checksum: createHash("sha256").update(contents).digest("hex"),
      };
      const env = {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin`,
        INSTALL_COMMAND_PAYLOAD: payload,
        INSTALL_COMMAND_OUTPUT: output,
      };
      const result = spawnSync("/bin/sh", ["-c", installCommand("unix", options)], {
        env,
        encoding: "utf8",
      });
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(output, "utf8").split("\0")).toEqual([
        "--endpoint",
        options.ingestOrigin,
        "--manifest-origin",
        options.installOrigin,
        "--machine",
        options.machineId,
        "--token",
        options.token,
        "",
      ]);
      rmSync(output);
      writeFileSync(payload, `${contents}# tampered\n`);
      const rejected = spawnSync("/bin/sh", ["-c", installCommand("unix", options)], {
        env,
        encoding: "utf8",
      });
      expect(rejected.status).not.toBe(0);
      expect(rejected.stderr).toContain("Installer checksum mismatch");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

it("quotes PowerShell interpolation literally and refuses malformed checksum values", () => {
  const options = {
    machineId: "machine",
    token: "secret'$(exit 1)`n; $env:HOME",
    ingestOrigin: "https://ingest.example.test",
    installOrigin: "https://monitor.example.test",
    checksum: "a".repeat(64),
  };
  expect(installCommand("windows", options)).toContain("-Token 'secret''$(exit 1)`n; $env:HOME'");
  expect(() => installCommand("unix", { ...options, checksum: "$(exit 1)" })).toThrow(
    "Invalid installer checksum",
  );
  expect(() => installCommand("windows", { ...options, checksum: "'" })).toThrow(
    "Invalid installer checksum",
  );
});
