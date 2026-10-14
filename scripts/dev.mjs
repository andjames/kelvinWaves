import { spawn } from "node:child_process";

const server = spawn("python3", ["-m", "http.server", "4173", "--directory", "dist"], { stdio: "inherit" });
server.on("exit", code => process.exit(code ?? 0));
